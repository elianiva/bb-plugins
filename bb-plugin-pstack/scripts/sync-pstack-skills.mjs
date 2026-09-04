#!/usr/bin/env node
/**
 * bb-plugin-pstack — sync skills to ~/.agents/skills
 *
 * Install: symlinks (default) or copies each skill under skills/ into
 *          ~/.agents/skills/<name> so pi / codex agents see them globally.
 *
 * Uninstall: removes only what install created. Never touches user-owned
 *            skills with colliding names — backs up or skips with warning.
 *
 * Idempotent: re-install is a safe refresh (re-creates stale links, restores
 * missing copies, updates manifest).
 *
 * Usage:
 *   node scripts/sync-pstack-skills.mjs --install [--copy] [--dry-run] [--target <dir>] [--home <dir>] [--silent] [--verbose]
 *   node scripts/sync-pstack-skills.mjs --uninstall [--dry-run] [--target <dir>] [--home <dir>] [--silent] [--verbose]
 *   npm run pstack:skills:install / uninstall  (wired via package.json postinstall/preuninstall)
 *
 * Env overrides:
 *   HOME / AGENTS_SKILLS_DIR / PSTACK_SKILLS_TARGET / AGENTS_HOME
 *   All are honored: --target > AGENTS_SKILLS_DIR > PSTACK_SKILLS_TARGET > $HOME/.agents/skills
 *   Temp HOME (e.g. HOME=/tmp/fake) is sandbox-safe: target resolves under it.
 */

import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PLUGIN_ROOT = path.resolve(__dirname, "..");
const SKILLS_SRC = path.join(PLUGIN_ROOT, "skills");
const MANIFEST_NAME = ".pstack-manifest.json";
const MARKER_NAME = ".pstack-managed";

function parseArgs(argv) {
  const args = {
    install: false,
    uninstall: false,
    copy: false,
    dryRun: false,
    silent: false,
    verbose: false,
    target: null,
    home: null,
  };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--install") args.install = true;
    else if (a === "--uninstall") args.uninstall = true;
    else if (a === "--copy") args.copy = true;
    else if (a === "--dry-run" || a === "--dryRun") args.dryRun = true;
    else if (a === "--silent") args.silent = true;
    else if (a === "--verbose") args.verbose = true;
    else if (a === "--target" && argv[i + 1]) args.target = argv[++i];
    else if (a.startsWith("--target=")) args.target = a.slice("--target=".length);
    else if (a === "--home" && argv[i + 1]) args.home = argv[++i];
    else if (a.startsWith("--home=")) args.home = a.slice("--home=".length);
  }
  // default: if neither, treat as install
  if (!args.install && !args.uninstall) args.install = true;
  return args;
}

function resolveTargetDir(args) {
  if (args.target) return path.resolve(args.target);
  if (process.env.AGENTS_SKILLS_DIR) return path.resolve(process.env.AGENTS_SKILLS_DIR);
  if (process.env.PSTACK_SKILLS_TARGET) return path.resolve(process.env.PSTACK_SKILLS_TARGET);
  const home = args.home ? path.resolve(args.home) : os.homedir();
  return path.join(home, ".agents", "skills");
}

function log(args, level, msg) {
  if (args.silent && level !== "error") return;
  if (level === "error") console.error(msg);
  else if (level === "warn") console.warn(msg);
  else if (level === "verbose" && !args.verbose) return;
  else console.log(msg);
}

function listSkills() {
  if (!fs.existsSync(SKILLS_SRC)) {
    console.error(`Skills source not found: ${SKILLS_SRC}`);
    process.exit(1);
  }
  const entries = fs.readdirSync(SKILLS_SRC, { withFileTypes: true });
  return entries
    .filter((d) => d.isDirectory())
    .map((d) => d.name)
    .filter((name) => !name.startsWith("."))
    .filter((name) => fs.existsSync(path.join(SKILLS_SRC, name, "SKILL.md")))
    .sort();
}

function isSymlinkTo(linkPath, expectedSrc) {
  try {
    const st = fs.lstatSync(linkPath);
    if (!st.isSymbolicLink()) return false;
    const target = fs.readlinkSync(linkPath);
    const resolved = path.resolve(path.dirname(linkPath), target);
    return resolved === path.resolve(expectedSrc);
  } catch {
    return false;
  }
}

function backupPath(dest) {
  const ts = new Date().toISOString().replace(/[:.]/g, "-");
  return `${dest}.pre-pstack-backup.${ts}`;
}

function copyDirRecursive(src, dest) {
  fs.cpSync(src, dest, { recursive: true });
}

function installSkills({ skills, targetDir, args }) {
  fs.mkdirSync(targetDir, { recursive: true });

  let installed = 0;
  let skipped = 0;
  let backedUp = 0;
  let refreshed = 0;

  const manifestPath = path.join(targetDir, MANIFEST_NAME);
  let manifest = {};
  if (fs.existsSync(manifestPath)) {
    try {
      manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
    } catch {
      manifest = {};
    }
  }

  for (const name of skills) {
    const src = path.join(SKILLS_SRC, name);
    const dest = path.join(targetDir, name);

    if (args.dryRun) {
      if (!fs.existsSync(dest) && !isSymlinkTo(dest, src)) {
        log(args, "info", `[dry-run] would install ${name} -> ${dest}`);
      } else if (isSymlinkTo(dest, src)) {
        log(args, "verbose", `[dry-run] already installed ${name}`);
      } else {
        log(args, "info", `[dry-run] collision at ${name} — would back up and install`);
      }
      continue;
    }

    // Already correctly installed?
    if (args.copy) {
      // copy mode: check directory + marker
      if (fs.existsSync(dest)) {
        try {
          const st = fs.lstatSync(dest);
          if (!st.isDirectory() && !st.isSymbolicLink()) {
            // file in the way
            const bp = backupPath(dest);
            fs.renameSync(dest, bp);
            log(args, "warn", `WARN: ${dest} is a file; backed up to ${bp}`);
            backedUp++;
          } else if (st.isSymbolicLink()) {
            // symlink where we expect directory — backup
            const bp = backupPath(dest);
            fs.renameSync(dest, bp);
            log(args, "warn", `WARN: ${dest} is a symlink (copy mode); backed up to ${bp}`);
            backedUp++;
          } else {
            const marker = path.join(dest, MARKER_NAME);
            if (fs.existsSync(marker)) {
              // we own it — refresh
              fs.rmSync(dest, { recursive: true, force: true });
              copyDirRecursive(src, dest);
              fs.writeFileSync(marker, JSON.stringify({ source: src, managed: true, updated: new Date().toISOString() }));
              log(args, "verbose", `refreshed ${name}`);
              refreshed++;
              manifest[name] = { mode: "copy", source: src };
              installed++;
              continue;
            } else {
              // user-owned directory — back up, then install
              const bp = backupPath(dest);
              fs.renameSync(dest, bp);
              log(args, "warn", `WARN: ${dest} exists and is user-owned; backed up to ${bp}`);
              backedUp++;
            }
          }
        } catch (e) {
          log(args, "error", `ERROR processing ${name}: ${e instanceof Error ? e.message : String(e)}`);
          skipped++;
          continue;
        }
      }
      // now dest doesn't exist, copy
      copyDirRecursive(src, dest);
      fs.writeFileSync(path.join(dest, MARKER_NAME), JSON.stringify({ source: src, managed: true, installed: new Date().toISOString() }));
      log(args, "info", `installed ${name} (copy)`);
      manifest[name] = { mode: "copy", source: src };
      installed++;
    } else {
      // symlink mode (default)
      if (fs.existsSync(dest) || fs.lstatSync(dest, { throwIfNoEntry: false })) {
        try {
          const st = fs.lstatSync(dest);
          if (st.isSymbolicLink()) {
            if (isSymlinkTo(dest, src)) {
              log(args, "verbose", `already installed ${name}`);
              manifest[name] = { mode: "symlink", source: src };
              // count as refreshed if we ensure it's valid; but no-op
              refreshed++;
              continue;
            } else {
              const target = fs.readlinkSync(dest);
              const bp = backupPath(dest);
              fs.renameSync(dest, bp);
              log(args, "warn", `WARN: ${dest} symlink -> ${target} collision; backed up to ${bp}`);
              backedUp++;
            }
          } else {
            // directory or file owned by user — never delete
            const bp = backupPath(dest);
            fs.renameSync(dest, bp);
            log(args, "warn", `WARN: ${dest} exists and is user-owned; backed up to ${bp} and will install symlink`);
            backedUp++;
          }
        } catch (e) {
          log(args, "error", `ERROR processing ${name}: ${e instanceof Error ? e.message : String(e)}`);
          skipped++;
          continue;
        }
      }
      // create symlink (absolute for robustness; relative if inside target)
      fs.symlinkSync(src, dest, "dir");
      log(args, "info", `installed ${name} (symlink)`);
      manifest[name] = { mode: "symlink", source: src };
      installed++;
    }
  }

  if (!args.dryRun) {
    fs.writeFileSync(manifestPath, JSON.stringify({ managedBy: "bb-plugin-pstack", updated: new Date().toISOString(), skills: manifest }, null, 2));
  }

  log(args, "info", `done: installed=${installed} refreshed=${refreshed} backedUp=${backedUp} skipped=${skipped} target=${targetDir}`);
  return { installed, refreshed, backedUp, skipped };
}

function uninstallSkills({ skills, targetDir, args }) {
  let removed = 0;
  let skipped = 0;
  let warnings = 0;

  const manifestPath = path.join(targetDir, MANIFEST_NAME);
  let manifestSkills = null;
  if (fs.existsSync(manifestPath)) {
    try {
      const m = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
      if (m.skills && typeof m.skills === "object") manifestSkills = Object.keys(m.skills);
    } catch {}
  }

  // uninstall set = skills from plugin plus any extra from manifest (in case skills removed from plugin but still installed)
  const toCheck = new Set([...skills, ...(manifestSkills ?? [])]);

  for (const name of toCheck) {
    const src = path.join(SKILLS_SRC, name);
    const dest = path.join(targetDir, name);

    let st;
    try {
      st = fs.lstatSync(dest);
    } catch {
      log(args, "verbose", `not present ${name}`);
      continue;
    }

    if (args.dryRun) {
      if (st.isSymbolicLink() && isSymlinkTo(dest, src)) {
        log(args, "info", `[dry-run] would remove ${name} (${dest})`);
      } else if (st.isSymbolicLink()) {
        log(args, "info", `[dry-run] would SKIP ${name} — symlink points elsewhere`);
      } else if (st.isDirectory() && fs.existsSync(path.join(dest, MARKER_NAME))) {
        log(args, "info", `[dry-run] would remove ${name} (managed copy)`);
      } else {
        log(args, "info", `[dry-run] would SKIP ${name} — user-owned, not managed`);
      }
      continue;
    }

    if (st.isSymbolicLink()) {
      if (isSymlinkTo(dest, src)) {
        fs.unlinkSync(dest);
        log(args, "info", `removed ${name}`);
        removed++;
      } else {
        const target = (() => {
          try { return fs.readlinkSync(dest); } catch { return "?"; }
        })();
        log(args, "warn", `WARN: skip ${name} — symlink -> ${target} not owned by pstack`);
        skipped++;
        warnings++;
      }
    } else if (st.isDirectory()) {
      const marker = path.join(dest, MARKER_NAME);
      if (fs.existsSync(marker)) {
        fs.rmSync(dest, { recursive: true, force: true });
        log(args, "info", `removed ${name} (managed copy)`);
        removed++;
      } else {
        log(args, "warn", `WARN: skip ${name} — directory at ${dest} is user-owned (no ${MARKER_NAME}); not deleting. Backup exists?`);
        skipped++;
        warnings++;
      }
    } else {
      log(args, "warn", `WARN: skip ${name} — ${dest} is not a directory or symlink`);
      skipped++;
      warnings++;
    }
  }

  if (!args.dryRun) {
    // clean manifest: remove entries that no longer exist; delete manifest if empty
    if (fs.existsSync(manifestPath)) {
      try {
        const raw = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
        if (raw.skills) {
          for (const k of Object.keys(raw.skills)) {
            if (!fs.existsSync(path.join(targetDir, k))) delete raw.skills[k];
          }
          if (Object.keys(raw.skills).length === 0) {
            fs.unlinkSync(manifestPath);
            log(args, "verbose", `removed empty manifest ${manifestPath}`);
          } else {
            raw.updated = new Date().toISOString();
            fs.writeFileSync(manifestPath, JSON.stringify(raw, null, 2));
          }
        }
      } catch {}
      // if we removed all known skills and manifest still exists but empty, try to clean empty dir? no
    }
  }

  log(args, "info", `done: removed=${removed} skipped=${skipped} warnings=${warnings} target=${targetDir}`);
  return { removed, skipped };
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  // HOME override for sandbox tests: --home sets process.env.HOME for child logic? we already handle
  if (args.home) process.env.HOME = path.resolve(args.home);
  const targetDir = resolveTargetDir(args);
  const skills = listSkills();

  if (args.install && args.uninstall) {
    console.error("Specify --install or --uninstall, not both");
    process.exit(1);
  }

  if (!args.silent) {
    console.log(`pstack skills: ${args.uninstall ? "uninstall" : "install"} ${args.copy ? "(copy)" : "(symlink)"} ${args.dryRun ? "[dry-run]" : ""}`);
    console.log(`  plugin root: ${PLUGIN_ROOT}`);
    console.log(`  skills src:  ${SKILLS_SRC} (${skills.length} skills)`);
    console.log(`  target dir:  ${targetDir}`);
  }

  if (args.uninstall) uninstallSkills({ skills, targetDir, args });
  else installSkills({ skills, targetDir, args });
}

main();
