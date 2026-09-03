import { spawnSync } from "node:child_process";
import {
  existsSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  writeFileSync,
  rmSync,
} from "node:fs";
import { join, resolve } from "node:path";

const root = resolve(import.meta.dirname, "..");
const read = (path) => readFileSync(resolve(root, path), "utf8");
const fail = (message) => {
  throw new Error(`GitHub Plus package check failed: ${message}`);
};
const npmCommand = process.platform === "win32" ? "npm.cmd" : "npm";
const commandText = (result) =>
  [result.stdout, result.stderr].filter(Boolean).join("\n").trim();

const manifest = JSON.parse(read("package.json"));
if (manifest.bb?.app !== "./src/app.tsx" || manifest.bb?.server !== "./src/server.ts") {
  fail("bb.app and bb.server must point to canonical TypeScript sources");
}
if (!manifest.files.includes("src") || manifest.files.some((entry) => entry.includes("recovery"))) {
  fail("package files must include src and exclude recovery references");
}
if (existsSync(resolve(root, "app.tsx"))) {
  fail("a root app.tsx wrapper must not be present");
}

const workspaceDependencies = Object.entries({
  ...manifest.dependencies,
  ...manifest.devDependencies,
  ...manifest.optionalDependencies,
  ...manifest.peerDependencies,
}).filter(([, version]) => typeof version === "string" && version.startsWith("workspace:"));
if (workspaceDependencies.length > 0) {
  fail(
    `published package still declares workspace-only dependencies: ${workspaceDependencies
      .map(([name, version]) => `${name}@${version}`)
      .join(", ")}`,
  );
}

const sourceApp = read("src/app.tsx");
const sourceLogic = read("src/app-logic.ts");
const sourceServer = read("src/server.ts");
for (const [name, source] of [["src/app.tsx", sourceApp], ["src/app-logic.ts", sourceLogic], ["src/server.ts", sourceServer]]) {
  if (source.includes("dist/")) {
    fail(`${name} must not import generated dist files`);
  }
}
for (const marker of ["definePluginApp", "Tracked repositories", "SavedViewsBar", "Files changed"]) {
  if (!sourceApp.includes(marker)) fail(`canonical app marker missing: ${marker}`);
}
for (const marker of ["parseSubPath", "routeToSubPath"]) {
  if (!sourceLogic.includes(marker)) fail(`canonical app-logic marker missing: ${marker}`);
}
for (const marker of [
  "repo_sync_health",
  "repoStatusSchema",
  "parseExtraRepos",
  "--active",
]) {
  if (!sourceServer.includes(marker)) fail(`canonical server marker missing: ${marker}`);
}

const distPath = resolve(root, "dist");
if (!existsSync(distPath)) fail("dist is missing; run npm run build");
const duplicateArtifacts = readdirSync(distPath).filter((entry) => / \d+\.(?:js|css|map|json)$/.test(entry));
if (duplicateArtifacts.length > 0) {
  fail(`duplicate generated artifacts present: ${duplicateArtifacts.join(", ")}; run npm run build`);
}

for (const artifact of ["app", "server"]) {
  if (!existsSync(resolve(root, `dist/${artifact}.js`))) fail(`dist/${artifact}.js is missing; run npm run build`);
  if (!existsSync(resolve(root, `dist/${artifact}.meta.json`))) fail(`dist/${artifact}.meta.json is missing`);
  const metadata = JSON.parse(read(`dist/${artifact}.meta.json`));
  if (metadata.pluginId !== "github-plus") {
    fail(`${artifact} metadata has the wrong plugin id`);
  }
  if (metadata.pluginVersion !== manifest.version) {
    fail(`${artifact} metadata is for ${metadata.pluginVersion}, expected ${manifest.version}`);
  }
}
const app = read("dist/app.js");
const server = read("dist/server.js");
const css = read("dist/app.css");
for (const marker of ["Tracked repositories", "Saved views", "Files changed", "Review with agent"]) {
  if (!app.includes(marker)) fail(`generated app marker missing: ${marker}`);
}
for (const marker of ["repo_sync_health", "parseExtraRepos"]) {
  if (!server.includes(marker)) fail(`generated server marker missing: ${marker}`);
}
for (const marker of ["min-h-48", "resize-y", "text-red-500"]) {
  if (!css.includes(marker)) fail(`stylesheet marker missing: ${marker}`);
}

const consumerRoot = mkdtempSync(join(root, ".package-consumer-"));
const npmCache = join(consumerRoot, "npm-cache");
const runNpm = (args, cwd) =>
  spawnSync(npmCommand, args, {
    cwd,
    encoding: "utf8",
    env: { ...process.env, npm_config_cache: npmCache, npm_config_dry_run: "false" },
  });

try {
  const pack = runNpm(
    ["pack", "--ignore-scripts", "--json", "--pack-destination", consumerRoot],
    root,
  );
  if (pack.status !== 0) {
    fail(`could not create verification tarball: ${commandText(pack)}`);
  }

  let records;
  try {
    records = JSON.parse(pack.stdout);
  } catch {
    fail(`npm pack returned invalid JSON: ${commandText(pack)}`);
  }
  const record = records[0];
  const packagedDuplicates = (record?.files ?? [])
    .map(({ path }) => path)
    .filter((path) => /^dist\/.+ \d+\.(?:js|css|map|json)$/.test(path));
  if (packagedDuplicates.length > 0) {
    fail(`packed tarball contains duplicate generated artifacts: ${packagedDuplicates.join(", ")}`);
  }
  const tarball = typeof record?.filename === "string"
    ? resolve(consumerRoot, record.filename)
    : null;
  if (tarball === null || !existsSync(tarball)) {
    fail("npm pack did not produce a verification tarball");
  }

  writeFileSync(
    join(consumerRoot, "package.json"),
    JSON.stringify({ name: "github-plus-package-consumer", private: true, version: "0.0.0" }),
  );

  const install = runNpm(
    ["install", "--ignore-scripts", "--no-audit", "--no-fund", "--no-package-lock", tarball],
    consumerRoot,
  );
  if (install.status !== 0) {
    fail(
      `clean packed-consumer install failed: ${commandText(install)}; check package dependencies and remove workspace:* declarations`,
    );
  }
} finally {
  rmSync(consumerRoot, { recursive: true, force: true });
}

console.log("GitHub Plus package checks passed (including clean packed-consumer install)");
