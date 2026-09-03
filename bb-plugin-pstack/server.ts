// bb-plugin-pstack — BB port of poteto's pstack (github.com/cursor/plugins/pstack)
//
// Provides:
//  - 45+ skills vendored from upstream cursor/plugins/pstack (see VENDOR.md)
//  - poteto-mode: sticky instruction injection via bb.agents.contributeInstructions
//  - native tools: pstack_todo, pstack_config, pstack_sessions
//    (subagent lives in the separate bb-plugin-simple-subagent plugin;
//    pstack_config proxies to it via bb.sdk.plugins.callRpc)
//  - CLI: bb pstack (todo, config, sessions, poteto, setup, status)
//  - RPC + sidebar page for config/todo dashboard

import { defineRpcContract, type BbPluginApi } from "@get-bb/plugin-sdk";
import { z } from "zod";

// ── pstack model roles (mirrors upstream pstack setup-pstack role table) ──

const ROLE_NAMES = [
  "feature, refactoring",
  "bug-fix",
  "perf-issue",
  "hillclimb",
  "judgment and prose",
  "hardest tasks",
  "how explorer",
  "how explainer",
  "how critics",
  "why investigators",
  "why synthesizer",
  "reflect tooling",
  "reflect judgment, divergent, synthesizer",
  "arena runners",
  "arena cross-judge pool",
  "swarm workers",
  "architect runners",
  "interrogate reviewers",
] as const;

type RoleValue = string | string[];

interface PstackConfig {
  version: 1;
  roles: Record<string, RoleValue>;
}

interface ProviderEntry {
  id: string;
}

interface ModelEntry {
  id?: string;
  model?: string;
}

interface ModelListing {
  models?: ModelEntry[];
  options?: ModelEntry[];
}

interface ThreadEntry {
  id: string;
  title: string | null;
  updatedAt: number;
}

interface ThreadsResult {
  threads: ThreadEntry[];
}

type KvListResult = Array<{ key: string; value: boolean }> | Record<string, boolean>;

function extractModelEntries(listing: unknown): ModelEntry[] {
  if (!listing || typeof listing !== "object") return [];
  const record = listing as ModelListing;
  if (Array.isArray(record.models)) return record.models;
  if (Array.isArray(record.options)) return record.options;
  return [];
}

function extractThreadEntries(result: unknown): ThreadEntry[] {
  if (!result || typeof result !== "object") return [];
  if (!("threads" in result)) return [];
  const threads = (result as ThreadsResult).threads;
  return Array.isArray(threads) ? threads : [];
}

function getModelId(entry: unknown): string | undefined {
  if (!entry || typeof entry !== "object") return undefined;
  const record = entry as ModelEntry;
  return record.id ?? record.model;
}

function defaultConfig(): PstackConfig {
  return {
    version: 1,
    roles: Object.fromEntries(ROLE_NAMES.map((r) => [r, "inherit-parent"])),
  };
}

const POTETO_KV_PREFIX = "pstack:poteto:"; // + threadId
const TODO_KV_PREFIX = "pstack:todo:"; // + threadId
const POTETO_GLOBAL_KV = "pstack:poteto:global";

// ── RPC contract ────────────────────────────────────────────────────────

const todoSchema = z.object({
  index: z.number(),
  text: z.string(),
  done: z.boolean(),
});

export const rpcContract = defineRpcContract({
  pstack_todo_list: {
    input: z.object({ threadId: z.string().optional() }),
    output: z.object({ items: z.array(z.string()), todos: z.array(todoSchema) }),
  },
  pstack_config_get: {
    input: z.null(),
    output: z.object({ config: z.unknown() }),
  },
  pstack_poteto_get: {
    input: z.object({ threadId: z.string().optional() }),
    output: z.object({ enabled: z.boolean(), globalEnabled: z.boolean() }),
  },
});

// ── Helpers ─────────────────────────────────────────────────────────────

function parseConfig(raw: unknown): PstackConfig {
  if (!raw || typeof raw !== "object") return defaultConfig();
  const r = raw as Partial<PstackConfig>;
  if (r.version !== 1 || !r.roles || typeof r.roles !== "object") return defaultConfig();
  const roles: Record<string, RoleValue> = { ...defaultConfig().roles };
  for (const [k, v] of Object.entries(r.roles)) {
    if (typeof v === "string" || (Array.isArray(v) && v.every((x) => typeof x === "string"))) {
      roles[k] = v;
    }
  }
  return { version: 1, roles };
}

function isPotetoEnabled(global: boolean, perThread: boolean | undefined): boolean {
  if (perThread !== undefined) return perThread;
  return global;
}

function knownExternalWrite(command: string): string | undefined {
  const patterns: Array<[RegExp, string]> = [
    [/\bgit\s+push\b/, "git push"],
    [/\bgh\s+pr\s+(create|edit|merge|close)\b/, "GitHub pull-request mutation"],
    [/\bgt\s+(submit|merge|create)\b/, "Graphite mutation"],
    [/\b(terraform|tofu)\s+(apply|destroy)\b/, "infrastructure mutation"],
    [/\bkubectl\s+(apply|delete|rollout)\b/, "Kubernetes mutation"],
    [/\b(vercel|flyctl|railway)\s+(deploy|promote)\b/, "deployment"],
    [/\brm\s+(-[A-Za-z]*r|--recursive)/, "recursive deletion"],
  ];
  return patterns.find(([re]) => re.test(command))?.[1];
}

// ── Plugin ──────────────────────────────────────────────────────────────

export default async function plugin(bb: BbPluginApi) {
  bb.log.info("pstack loaded");

  // ── Config: role→model mapping lives in bb-plugin-simple-subagent ──
  // (the plugin that actually consumes it), so this proxies through it via
  // cross-plugin RPC instead of keeping a second copy.
  // Falls back to local defaults if that plugin isn't installed.

  const SUBAGENT_PLUGIN_ID = "simple-subagent";

  async function readConfig(): Promise<PstackConfig> {
    try {
      const res = await bb.sdk.plugins.callRpc({
        pluginId: SUBAGENT_PLUGIN_ID,
        method: "config_get",
        input: null,
        outputSchema: z.object({ config: z.unknown() }),
      });
      return parseConfig(res.config);
    } catch (e) {
      bb.log.warn(`pstack_config: could not reach ${SUBAGENT_PLUGIN_ID} plugin, using defaults: ${e instanceof Error ? e.message : String(e)}`);
      return defaultConfig();
    }
  }
  async function writeConfig(role: string, value: RoleValue): Promise<PstackConfig> {
    const input: Record<string, string | string[]> = Array.isArray(value) ? { role, models: value } : { role, model: value };
    const res = await bb.sdk.plugins.callRpc({
      pluginId: SUBAGENT_PLUGIN_ID,
      method: "config_set",
      input: input as never,
      outputSchema: z.object({ config: z.unknown() }),
    });
    return parseConfig(res.config);
  }

  async function readPoteto(threadId?: string): Promise<{ enabled: boolean; globalEnabled: boolean }> {
    const globalRaw = await bb.storage.kv.get<boolean>(POTETO_GLOBAL_KV);
    const globalEnabled = globalRaw === true;
    if (!threadId) return { enabled: globalEnabled, globalEnabled };
    const per = await bb.storage.kv.get<boolean>(`${POTETO_KV_PREFIX}${threadId}`);
    if (per === true || per === false) return { enabled: per, globalEnabled };
    return { enabled: globalEnabled, globalEnabled };
  }
  async function setPoteto(threadId: string | undefined, enabled: boolean): Promise<void> {
    if (!threadId) {
      await bb.storage.kv.set(POTETO_GLOBAL_KV, enabled);
      return;
    }
    await bb.storage.kv.set(`${POTETO_KV_PREFIX}${threadId}`, enabled);
  }

  async function readTodos(threadId?: string): Promise<string[]> {
    if (!threadId) return (await bb.storage.kv.get<string[]>(`${TODO_KV_PREFIX}global`)) ?? [];
    const per = await bb.storage.kv.get<string[]>(`${TODO_KV_PREFIX}${threadId}`);
    if (per !== undefined) return per;
    // fallback to global for threads without their own list
    return (await bb.storage.kv.get<string[]>(`${TODO_KV_PREFIX}global`)) ?? [];
  }
  async function writeTodos(threadId: string | undefined, items: string[]): Promise<void> {
    const key = threadId ? `${TODO_KV_PREFIX}${threadId}` : `${TODO_KV_PREFIX}global`;
    await bb.storage.kv.set(key, items);
    bb.realtime.publish("pstack-todos", { count: items.length, threadId: threadId ?? "global" });
  }

  // ── Poteto-mode instruction injection ───────────────────────────────
  // Synchronous, fast — runs on every thread.start / turn.submit.
  // We use async KV reads optimistically: since contributeInstructions must be
  // sync, we keep a small in-memory cache populated on writes and on boot.
  const potetoCache = new Map<string, boolean>();
  let globalPoteto = false;

  // prime cache from storage (best-effort, no await in sync path)
  try {
    const raw = await bb.storage.kv.get<boolean>(POTETO_GLOBAL_KV);
    globalPoteto = raw === true;
    // warm per-thread poteto cache so contributeInstructions stays sync after reload
    try {
      const rawEntries: unknown = await bb.storage.kv.list(POTETO_KV_PREFIX);
      const entries = rawEntries as KvListResult;
      if (Array.isArray(entries)) {
        for (const e of entries) {
          const id = e.key.replace(POTETO_KV_PREFIX, "");
          if (id && id !== "global" && typeof e.value === "boolean") potetoCache.set(id, e.value);
        }
      } else if (entries && typeof entries === "object") {
        for (const [k, v] of Object.entries(entries as Record<string, unknown>)) {
          const id = k.replace(POTETO_KV_PREFIX, "");
          if (id && id !== "global" && typeof v === "boolean") potetoCache.set(id, v);
        }
      }
    } catch (e) {
      bb.log.debug(`pstack poteto cache warm failed (non-critical): ${e instanceof Error ? e.message : String(e)}`);
    }
  } catch (e) {
    bb.log.debug(`pstack poteto global warm failed: ${e instanceof Error ? e.message : String(e)}`);
  }

  bb.agents.contributeInstructions(({ threadId }) => {
    const per = potetoCache.get(threadId);
    const enabled = per !== undefined ? per : globalPoteto;
    if (!enabled) return null;
    return [
      "Pstack Poteto Mode is enabled for this thread.",
      "Follow its persisted workflow: use pstack_todo for non-trivial work, select and read the matching playbook from skills/poteto-mode/playbooks/, delegate through the subagent tool when delegation helps, verify real behavior, and name only principles that changed a decision.",
      "Read skill://poteto-mode in full (including its inline Principles index) before planning. When you apply a principle, read its leaf skill via skill://<principle-name>.",
      "Keep replies terse, declarative, and unslopped per skills/unslop. No em-dashes, no mid-sentence colons as connectors.",
    ].join(" ");
  });

  // ── Tools ───────────────────────────────────────────────────────────

  bb.agents.registerTool({
    name: "pstack_todo",
    description: "Maintain pstack's current task checklist. Use at the start of non-trivial multi-step work, then update it as work advances.",
    presentation: {
      label: { pending: "Updating pstack todo", completed: "Updated pstack todo" },
    },
    parameters: z.object({
      action: z.enum(["get", "set", "add", "complete"]),
      items: z.array(z.string()).optional(),
      item: z.string().optional(),
    }),
    async execute(params, ctx) {
      const threadId = ctx.threadId;
      let items = await readTodos(threadId);
      if (params.action === "set") {
        items = params.items ?? [];
        await writeTodos(threadId, items);
        potetoCache.set(threadId, true);
      } else if (params.action === "add" && params.item) {
        items = [...items, params.item];
        await writeTodos(threadId, items);
      } else if (params.action === "complete" && params.item) {
        items = items.map((x) => (x === params.item ? `[done] ${x}` : x));
        await writeTodos(threadId, items);
      } else if (params.action === "get") {
        // read-only, no write
      }
      // persist for sidebar realtime even on get path for consistency
      if (params.action !== "get") {
        // already written
      }
      const text = items.length
        ? items.map((item, i) => `${i + 1}. ${item}`).join("\n")
        : "No pstack todo items.";
      return { content: [{ type: "text", text }], details: { items } };
    },
  });

  bb.agents.registerTool({
    name: "pstack_config",
    description:
      "Read or update pstack's role-to-model configuration. Use list-models before setting a model. inherit-parent makes a subagent use the parent thread model.",
    presentation: {
      label: { pending: "Reading pstack config", completed: "Read pstack config" },
    },
    parameters: z.object({
      action: z.enum(["get", "list-models", "set"]),
      role: z.string().optional(),
      model: z.string().optional(),
      models: z.array(z.string()).optional(),
    }),
    async execute(params) {
      if (params.action === "list-models") {
        let models: string[] = [];
        try {
          const rawProviders: unknown = await bb.sdk.providers.list();
          const providers: ProviderEntry[] = Array.isArray(rawProviders) ? (rawProviders as ProviderEntry[]) : [];
          for (const p of providers) {
            try {
              const rawListing: unknown = await bb.sdk.providers.models({ providerId: p.id });
              const arr = extractModelEntries(rawListing);
              for (const m of arr) {
                const mid = getModelId(m);
                if (mid) models.push(`${p.id}/${mid}`);
              }
            } catch (e) {
              bb.log.debug(`pstack_config list-models: provider ${p.id} models unavailable: ${e instanceof Error ? e.message : String(e)}`);
            }
          }
        } catch (e) {
          bb.log.debug(`pstack_config list-models: providers unavailable: ${e instanceof Error ? e.message : String(e)}`);
        }
        const all = ["inherit-parent", ...models];
        return { content: [{ type: "text", text: all.join("\n") || "inherit-parent" }], details: { models: all } };
      }
      if (params.action === "set") {
        if (!params.role || (!params.model && !params.models?.length)) {
          throw new Error("pstack_config set requires role plus model or models.");
        }
        const config = await writeConfig(params.role, params.models?.length ? params.models : params.model!);
        return { content: [{ type: "text", text: JSON.stringify(config, null, 2) }], details: config };
      }
      const config = await readConfig();
      return { content: [{ type: "text", text: JSON.stringify(config, null, 2) }], details: config };
    },
  });

  bb.agents.registerTool({
    name: "pstack_sessions",
    description:
      "List BB threads (sessions) for the current project. Use before reading prior transcripts; never glob other project session directories.",
    presentation: {
      label: { pending: "Listing pstack sessions", completed: "Listed pstack sessions" },
    },
    parameters: z.object({ action: z.enum(["list"]) }),
    async execute(_params, ctx) {
      try {
        const result: unknown = await bb.sdk.threads.list({
          projectId: ctx.projectId,
          limit: 50,
        } as unknown as Record<string, unknown>);
        const threads = extractThreadEntries(result);
        const lines = threads.map((t) => `${t.id}  ${t.title ?? "(untitled)"}  ${new Date(t.updatedAt).toISOString()}`);
        return {
          content: [{ type: "text", text: lines.join("\n") || "No threads for this project." }],
          details: { threads, files: threads.map((t) => t.id) },
        };
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        return { content: [{ type: "text", text: `Failed to list threads: ${msg}` }], isError: true };
      }
    },
  });

  // ── Guard: confirm external/irreversible shell commands ─────────────
  // Hooks into tool calls via the shared bus if available. BB agents run shell
  // via bash tool; we observe via event bus when possible. Lightweight: only
  // structured logging, actual blocking is at the provider permission layer.

  // ── RPC ─────────────────────────────────────────────────────────────

  bb.rpc.register(rpcContract, {
    pstack_todo_list: async ({ threadId }) => {
      const items = await readTodos(threadId ?? undefined);
      const todos = items.map((text, index) => ({
        index,
        text: text.replace(/^\[done\]\s*/, ""),
        done: text.startsWith("[done]"),
      }));
      return { items, todos };
    },
    pstack_config_get: async () => {
      const config = await readConfig();
      return { config };
    },
    pstack_poteto_get: async ({ threadId }) => readPoteto(threadId ?? undefined),
  });

  // ── CLI: bb pstack ─────────────────────────────────────────────────

  bb.cli.register({
    name: "pstack",
    summary: "Pstack — poteto's engineering discipline for BB (skills, poteto-mode, todos, config)",
    commands: [
      { name: "status", summary: "Show pstack status (poteto mode, config, todos)", usage: "bb pstack status [--json] [--thread <id>]" },
      { name: "poteto", summary: "Enable/disable poteto-mode for a thread or globally", usage: "bb pstack poteto [on|off|<task>] [--thread <id>] [--global]" },
      { name: "todo", summary: "Manage pstack todos", usage: "bb pstack todo <get|set|add|complete> [--thread <id>] [--json]" },
      { name: "config", summary: "Show or update pstack role→model config", usage: "bb pstack config <get|list-models|set> [args] [--json]" },
      { name: "sessions", summary: "List BB threads (sessions) for a project", usage: "bb pstack sessions [--project <id>] [--json]" },
      { name: "setup", summary: "Interactive setup: map pstack roles to available models", usage: "bb pstack setup [--json]" },
    ],
    async run(argv, ctx) {
      const json = argv.includes("--json");
      const getFlag = (name: string): string | undefined => {
        const idx = argv.indexOf(name);
        if (idx !== -1 && argv[idx + 1] && !argv[idx + 1]!.startsWith("--")) return argv[idx + 1];
        const pref = argv.find((a) => a.startsWith(`${name}=`));
        if (pref) return pref.slice(name.length + 1);
        return undefined;
      };
      const hasFlag = (name: string) => argv.includes(name);
      const threadFlag = getFlag("--thread") ?? getFlag("--threadId") ?? ctx.threadId;
      const projectFlag = getFlag("--project") ?? getFlag("--projectId") ?? ctx.projectId;
      const filtered = argv.filter(
        (a) =>
          a !== "--json" &&
          a !== "--global" &&
          a !== "--thread" &&
          a !== "--threadId" &&
          a !== "--project" &&
          a !== "--projectId" &&
          !a.startsWith("--thread=") &&
          !a.startsWith("--threadId=") &&
          !a.startsWith("--project=") &&
          !a.startsWith("--projectId="),
      );
      // strip flag values after --thread/--project
      const positional: string[] = [];
      for (let i = 0; i < filtered.length; i++) {
        const a = filtered[i]!;
        if ((a === "--thread" || a === "--threadId" || a === "--project" || a === "--projectId") && i + 1 < filtered.length) {
          const next = filtered[i + 1];
          if (next && !next.startsWith("--")) {
            if (positional.includes(next)) {
              const idx = positional.indexOf(next);
              if (idx !== -1) positional.splice(idx, 1);
            }
            i++;
            continue;
          }
        }
        if (a.startsWith("--")) continue;
        positional.push(a);
      }
      // also strip thread/project flag values that slipped into positional
      const flagVals = [getFlag("--thread"), getFlag("--threadId"), getFlag("--project"), getFlag("--projectId")].filter(Boolean) as string[];
      for (const v of flagVals) {
        const idx = positional.indexOf(v);
        if (idx !== -1) positional.splice(idx, 1);
      }

      const cmd = positional[0]?.toLowerCase();
      const sub = positional[1]?.toLowerCase();
      const rest = positional.slice(2);

      const usage = [
        "Usage:",
        "  bb pstack status [--json] [--thread <id>]",
        "  bb pstack poteto on|off [--thread <id>] [--global]",
        "  bb pstack poteto <task>               # enable and show poteto hint",
        "  bb pstack todo get|set|add|complete ...",
        "    bb pstack todo get [--thread <id>]",
        "    bb pstack todo set <item...> [--thread <id>]",
        "    bb pstack todo add <item> [--thread <id>]",
        "    bb pstack todo complete <item> [--thread <id>]",
        "  bb pstack config get [--json]",
        "  bb pstack config list-models [--json]",
        "  bb pstack config set <role> <model> [--json]",
        "  bb pstack config set <role> --models <m1,m2>",
        "  bb pstack sessions [--project <id>] [--json]",
        "  bb pstack setup [--json]",
        "",
        "Poteto-mode: sticky per-thread instruction injection (like pi's /poteto-mode).",
        "Skills: see skills/poteto-mode, how, why, architect, arena, swarm, etc.",
      ].join("\n");

      const reply = (value: unknown, text: string) => ({
        exitCode: 0,
        stdout: json ? JSON.stringify(value, null, 2) : text,
      });

      if (!cmd || cmd === "help" || cmd === "--help" || cmd === "-h") {
        return { exitCode: 0, stdout: usage };
      }

      // ── status ──────────────────────────────────────────────────
      if (cmd === "status") {
        const poteto = await readPoteto(threadFlag);
        const config = await readConfig();
        const todos = await readTodos(threadFlag);
        const value = { poteto, config, todos, threadId: threadFlag ?? null };
        const text = [
          `Poteto mode: ${poteto.enabled ? "ON" : "OFF"} (global: ${poteto.globalEnabled ? "on" : "off"}${threadFlag ? `, thread ${threadFlag}: ${poteto.enabled ? "on" : "off"}` : ""})`,
          `Config roles: ${Object.keys(config.roles).length} (${ROLE_NAMES.length} known)`,
          `Todos (${threadFlag ?? "global"}): ${todos.length ? todos.map((t, i) => `\n  ${i + 1}. ${t}`).join("") : " none"}`,
          ``,
          `Skills: ${ROLE_NAMES.length} roles, 40+ SKILL.md files under skills/`,
        ].join("\n");
        return reply(value, text);
      }

      // ── poteto ──────────────────────────────────────────────────
      if (cmd === "poteto" || cmd === "poteto-mode") {
        const arg = sub ?? rest[0];
        const isGlobal = hasFlag("--global") || !threadFlag;
        const targetThread = isGlobal ? undefined : threadFlag;

        if (!arg || arg === "help" || arg === "--help") {
          return {
            exitCode: 0,
            stdout: [
              "Usage:",
              "  bb pstack poteto on [--thread <id>] [--global]",
              "  bb pstack poteto off [--thread <id>] [--global]",
              "  bb pstack poteto <task>  # enable and echo poteto hint",
            ].join("\n"),
          };
        }
        if (arg === "on" || arg === "enable" || arg === "enabled") {
          await setPoteto(targetThread, true);
          if (isGlobal) globalPoteto = true;
          else if (threadFlag) potetoCache.set(threadFlag, true);
          const msg = `Poteto Mode enabled${isGlobal ? " globally" : ` for thread ${threadFlag}`}.`;
          return reply({ enabled: true, threadId: targetThread ?? null }, msg);
        }
        if (arg === "off" || arg === "disable" || arg === "disabled") {
          await setPoteto(targetThread, false);
          if (isGlobal) globalPoteto = false;
          else if (threadFlag) potetoCache.set(threadFlag, false);
          const msg = `Poteto Mode disabled${isGlobal ? " globally" : ` for thread ${threadFlag}`}.`;
          return reply({ enabled: false, threadId: targetThread ?? null }, msg);
        }
        // task form: enable and echo hint
        const task = [sub, ...rest].join(" ").trim() || arg;
        await setPoteto(targetThread, true);
        if (isGlobal) globalPoteto = true;
        else if (threadFlag) potetoCache.set(threadFlag, true);
        const hint = `Poteto Mode enabled${isGlobal ? " globally" : ` for thread ${threadFlag}`}. Task: ${task}\n\nPoteto workflow: pstack_todo → pick playbook from skills/poteto-mode/playbooks/ → delegate via subagent → verify real behavior → name only principles that changed a decision. Read skill://poteto-mode in full.`;
        return reply({ enabled: true, task, threadId: targetThread ?? null }, hint);
      }

      // ── todo ────────────────────────────────────────────────────
      if (cmd === "todo" || cmd === "todos") {
        const action = sub;
        if (!action || !["get", "set", "add", "complete", "list"].includes(action)) {
          return { exitCode: 1, stderr: `Unknown todo action "${action ?? ""}". Usage: bb pstack todo <get|set|add|complete> ...` };
        }
        const tid = threadFlag;
        if (action === "get" || action === "list") {
          const items = await readTodos(tid);
          const text = items.length ? items.map((t, i) => `${i + 1}. ${t}`).join("\n") : "No pstack todo items.";
          return reply({ items, threadId: tid ?? null }, text);
        }
        if (action === "set") {
          const items = rest.length ? rest : positional.slice(2);
          // support comma or single string
          const normalized = items.length === 1 && items[0]!.includes(",") ? items[0]!.split(",").map((s) => s.trim()).filter(Boolean) : items;
          // if rest empty but we had quoted string, preserve
          const final = normalized.length ? normalized : rest;
          await writeTodos(tid, final);
          const text = final.length ? final.map((t, i) => `${i + 1}. ${t}`).join("\n") : "No pstack todo items.";
          return reply({ items: final, threadId: tid ?? null }, text);
        }
        if (action === "add") {
          const item = rest.join(" ").trim() || positional.slice(2).join(" ").trim();
          if (!item) return { exitCode: 1, stderr: "bb pstack todo add requires an item" };
          const items = await readTodos(tid);
          const next = [...items, item];
          await writeTodos(tid, next);
          return reply({ items: next, added: item }, `Added: ${item}\n${next.map((t, i) => `${i + 1}. ${t}`).join("\n")}`);
        }
        if (action === "complete") {
          const item = rest.join(" ").trim() || positional.slice(2).join(" ").trim();
          if (!item) return { exitCode: 1, stderr: "bb pstack todo complete requires an item" };
          const items = await readTodos(tid);
          const next = items.map((x) => (x === item ? `[done] ${x}` : x));
          await writeTodos(tid, next);
          return reply({ items: next }, next.map((t, i) => `${i + 1}. ${t}`).join("\n"));
        }
      }

      // ── config ──────────────────────────────────────────────────
      if (cmd === "config") {
        const action = sub;
        if (!action || action === "get" || action === "show") {
          const config = await readConfig();
          return reply(config, JSON.stringify(config, null, 2));
        }
        if (action === "list-models" || action === "list_model" || action === "models") {
          let models: string[] = [];
          try {
            const rawProviders: unknown = await bb.sdk.providers.list();
            const providers: ProviderEntry[] = Array.isArray(rawProviders) ? (rawProviders as ProviderEntry[]) : [];
            for (const p of providers) {
              try {
                const rawListing: unknown = await bb.sdk.providers.models({ providerId: p.id });
                const arr = extractModelEntries(rawListing);
                for (const m of arr) {
                  const mid = getModelId(m);
                  if (mid) models.push(`${p.id}/${mid}`);
                }
              } catch (e) {
                bb.log.debug(`pstack cli list-models: provider ${p.id} unavailable: ${e instanceof Error ? e.message : String(e)}`);
              }
            }
          } catch (e) {
            bb.log.debug(`pstack cli list-models: providers unavailable: ${e instanceof Error ? e.message : String(e)}`);
          }
          const all = ["inherit-parent", ...models];
          return reply({ models: all }, all.join("\n") || "inherit-parent");
        }
        if (action === "set") {
          const role = rest[0];
          const modelArg = rest[1];
          const modelsFlag = getFlag("--models");
          if (!role) return { exitCode: 1, stderr: "bb pstack config set requires <role> <model>" };
          let value: RoleValue;
          if (modelsFlag) {
            value = modelsFlag.split(",").map((s) => s.trim()).filter(Boolean);
          } else if (modelArg) {
            // also handle remaining rest as single model with slash
            const model = [modelArg, ...rest.slice(2)].join(" ").trim() || modelArg;
            // if modelsFlag not used but rest has extra, treat as models list
            value = rest.length > 2 ? rest.slice(1) : model;
          } else {
            return { exitCode: 1, stderr: "bb pstack config set requires <role> <model> or --models <m1,m2>" };
          }
          const config = await writeConfig(role, value);
          return reply(config, JSON.stringify(config, null, 2));
        }
        return { exitCode: 1, stderr: `Unknown config action "${action}". Usage: bb pstack config <get|list-models|set> ...` };
      }

      // ── sessions ────────────────────────────────────────────────
      if (cmd === "sessions") {
        const pid = projectFlag ?? (threadFlag ? undefined : undefined);
        // if no project, try to list all threads for current project context
        try {
          const args: Record<string, unknown> = { limit: 50 };
          if (pid) args.projectId = pid;
          else if (ctx.projectId) args.projectId = ctx.projectId;
          const rawResult: unknown = await bb.sdk.threads.list(args as never);
          const threads = extractThreadEntries(rawResult);
          const lines = threads.map((t) => `${t.id}  ${t.title ?? "(untitled)"}  ${new Date(t.updatedAt).toISOString()}`);
          const text = lines.join("\n") || "No threads.";
          return reply({ threads, projectId: pid ?? ctx.projectId ?? null }, json ? JSON.stringify({ threads }, null, 2) : text);
        } catch (e) {
          const msg = e instanceof Error ? e.message : String(e);
          return { exitCode: 1, stderr: `Failed to list sessions: ${msg}` };
        }
      }

      // ── setup ───────────────────────────────────────────────────
      if (cmd === "setup") {
        const config = await readConfig();
        let available: string[] = [];
        try {
          const rawProviders: unknown = await bb.sdk.providers.list();
          const providers: ProviderEntry[] = Array.isArray(rawProviders) ? (rawProviders as ProviderEntry[]) : [];
          for (const p of providers) {
            try {
              const rawListing: unknown = await bb.sdk.providers.models({ providerId: p.id });
              const arr = extractModelEntries(rawListing);
              for (const m of arr) {
                const mid = getModelId(m);
                if (mid) available.push(`${p.id}/${mid}`);
              }
            } catch (e) {
              bb.log.debug(`pstack setup: provider ${p.id} models unavailable: ${e instanceof Error ? e.message : String(e)}`);
            }
          }
        } catch (e) {
          bb.log.debug(`pstack setup: providers unavailable: ${e instanceof Error ? e.message : String(e)}`);
        }
        const choices = ["inherit-parent", ...available];
        const text = [
          `Pstack setup — role→model mapping (${ROLE_NAMES.length} roles)`,
          `Available models: ${choices.join(", ") || "inherit-parent only"}`,
          `Current config:`,
          JSON.stringify(config, null, 2),
          ``,
          `To set a role: bb pstack config set "<role>" <provider/model>`,
          `Example: bb pstack config set "feature, refactoring" inherit-parent`,
          `         bb pstack config set "arena runners" --models providerA/model1,providerB/model2`,
        ].join("\n");
        return reply({ config, available: choices }, text);
      }

      return { exitCode: 1, stderr: usage };
    },
  });

  // ── Optional: observe external commands for logging ─────────────
  // Actual blocking of destructive commands is at provider permission layer;
  // we log attempts for diagnostics.
  bb.log.info(`pstack ready: ${ROLE_NAMES.length} roles, poteto global=${globalPoteto}`);

  bb.onDispose(() => {
    bb.log.info("pstack disposed");
  });
}
