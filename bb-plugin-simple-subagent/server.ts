// bb-plugin-simple-subagent — delegate work to isolated BB child threads.
//
// Split out of bb-plugin-pstack so the delegation primitive works standalone.
// Owns role->model config as the single source of truth: pstack's pstack_config
// tool proxies here via bb.sdk.plugins.callRpc instead of keeping its own copy.

import { defineRpcContract, type BbPluginApi } from "@get-bb/plugin-sdk";
import { z } from "zod";

// Mirrors pi-pstack's default role table (extensions/pstack/config.ts) so
// existing pstack workflows (interrogate, swarm, reflect, ...) keep working.
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

interface RoleConfig {
  version: 1;
  roles: Record<string, RoleValue>;
}

function defaultConfig(): RoleConfig {
  return {
    version: 1,
    roles: Object.fromEntries(ROLE_NAMES.map((r) => [r, "inherit-parent"])),
  };
}

function parseConfig(raw: unknown): RoleConfig {
  if (!raw || typeof raw !== "object") return defaultConfig();
  const r = raw as Partial<RoleConfig>;
  if (r.version !== 1 || !r.roles || typeof r.roles !== "object") return defaultConfig();
  const roles: Record<string, RoleValue> = { ...defaultConfig().roles };
  for (const [k, v] of Object.entries(r.roles)) {
    if (typeof v === "string" || (Array.isArray(v) && v.every((x) => typeof x === "string"))) {
      roles[k] = v;
    }
  }
  return { version: 1, roles };
}

function modelsForRole(config: RoleConfig, role: string | undefined): string[] {
  if (!role) return [];
  const v = config.roles[role];
  const arr = typeof v === "string" ? [v] : Array.isArray(v) ? v : [];
  return arr.filter((m) => m !== "inherit-parent" && m !== "auto");
}

const CONFIG_KV = "simple-subagent:config";

const TITLE_MAX_LENGTH = 80;

function titleFromTask(task: string): string {
  const collapsed = task.replace(/\s+/g, " ").trim();
  if (collapsed.length <= TITLE_MAX_LENGTH) return collapsed || "subagent task";
  return `${collapsed.slice(0, TITLE_MAX_LENGTH - 1)}…`;
}

export const rpcContract = defineRpcContract({
  config_get: {
    input: z.null(),
    output: z.object({ config: z.unknown() }),
  },
  config_set: {
    input: z.object({ role: z.string(), model: z.string().optional(), models: z.array(z.string()).optional() }),
    output: z.object({ config: z.unknown() }),
  },
  config_list_models: {
    input: z.null(),
    output: z.object({ models: z.array(z.string()) }),
  },
});

export default function plugin(bb: BbPluginApi) {
  async function readConfig(): Promise<RoleConfig> {
    const raw = await bb.storage.kv.get<unknown>(CONFIG_KV);
    return parseConfig(raw);
  }
  async function writeConfig(cfg: RoleConfig): Promise<void> {
    await bb.storage.kv.set(CONFIG_KV, cfg);
  }
  async function listModels(): Promise<string[]> {
    const models: string[] = [];
    try {
      const providers = (await bb.sdk.providers.list()) as unknown as Array<{ id: string }>;
      for (const p of providers ?? []) {
        try {
          const listing = (await bb.sdk.providers.models({ providerId: p.id })) as unknown as {
            models?: Array<{ id: string }>;
            options?: Array<{ model?: string; id?: string }>;
          };
          const arr = listing.models ?? (listing as unknown as { options: Array<{ id: string }> }).options ?? [];
          for (const m of arr as Array<{ id: string; model?: string }>) {
            const mid = (m as { id?: string; model?: string }).id ?? (m as { model?: string }).model;
            if (mid) models.push(`${p.id}/${mid}`);
          }
        } catch {
          // provider may not expose models listing
        }
      }
    } catch {
      // sdk not ready or no providers
    }
    return ["inherit-parent", ...models];
  }

  bb.rpc.register(rpcContract, {
    async config_get() {
      return { config: await readConfig() };
    },
    async config_set({ role, model, models }) {
      if (!model && !models?.length) throw new Error("config_set requires model or models.");
      const config = await readConfig();
      config.roles[role] = models?.length ? models : model!;
      await writeConfig(config);
      return { config };
    },
    async config_list_models() {
      return { models: await listModels() };
    },
  });

  bb.agents.registerTool({
    name: "subagent",
    description:
      "Delegate work to one or more isolated subagents (BB child threads). Each subagent runs as a separate thread and returns only its final result. Supports single task, parallel tasks[], and chain sequential modes. Use role for model selection via subagent_config, or model for a one-off provider/model override.",
    presentation: {
      label: { pending: "Delegating to subagent", completed: "Subagent completed" },
    },
    parameters: z.object({
      task: z.string().optional(),
      tasks: z.array(z.string()).optional(),
      agent: z.string().optional(),
      role: z.string().optional(),
      model: z.string().optional(),
      chain: z.array(z.string()).optional(),
    }),
    async execute(params, ctx) {
      const parentThreadId = ctx.threadId;

      const allTasks: string[] = [];
      if (params.tasks?.length) allTasks.push(...params.tasks);
      else if (params.task) allTasks.push(params.task);
      else if (params.chain?.length) allTasks.push(params.chain[0]!);
      else throw new Error("subagent requires task, tasks, or chain");

      if (allTasks.length > 8) throw new Error("subagent allows at most 8 tasks");

      const config = await readConfig();
      const roleModels = modelsForRole(config, params.role);
      const preferredModel = params.model ?? roleModels[0];

      // `threads.spawn` requires both `projectId` and `environment` — ctx.projectId
      // can be empty for personal/projectless threads, and there is no environment
      // default, so both must be resolved from the parent thread up front.
      const parent = (await bb.sdk.threads.get({ threadId: parentThreadId })) as unknown as {
        projectId?: string;
        providerId?: string;
        model?: string;
        environmentId?: string | null;
      };

      const projectId = ctx.projectId || parent.projectId;
      if (!projectId) throw new Error("subagent could not resolve a projectId from the parent thread");

      const environment = parent.environmentId
        ? { type: "reuse" as const, environmentId: parent.environmentId }
        : { type: "project-default" as const };

      // Resolve provider/model for child threads
      let spawnProviderId: string | undefined;
      let spawnModel: string | undefined;
      if (preferredModel && preferredModel !== "inherit-parent") {
        const slash = preferredModel.indexOf("/");
        if (slash > 0) {
          spawnProviderId = preferredModel.slice(0, slash);
          spawnModel = preferredModel.slice(slash + 1);
        } else {
          spawnModel = preferredModel;
        }
      }
      // Fallback: inherit parent's execution options (also covers "inherit-parent")
      spawnProviderId = spawnProviderId ?? parent.providerId;
      spawnModel = spawnModel ?? parent.model;

      const agentHint = params.agent ? ` (agent: ${params.agent})` : "";
      const childIds: string[] = [];
      const results: string[] = [];

      // Spawn children (concurrency capped at 4 for parallel mode)
      const spawnOne = async (task: string, idx: number): Promise<void> => {
        const title = titleFromTask(task);
        const spawnArgs: Record<string, unknown> = {
          projectId,
          parentThreadId,
          environment,
          title,
          prompt: task,
        };
        if (spawnProviderId) spawnArgs.providerId = spawnProviderId;
        if (spawnModel) spawnArgs.model = spawnModel;

        const child = (await bb.sdk.threads.spawn(spawnArgs as never)) as unknown as { id: string };
        childIds.push(child.id);

        // Wait for the child to settle. `idle` is the happy path, but a child that
        // errors out never reaches `idle` — waiting on that status alone means an
        // errored (or slow) child just times out after 10 minutes and its real
        // output gets thrown away, reported only as "wait failed". Race both
        // terminal statuses instead, and always try to fetch whatever output
        // exists afterward so a child's work is never silently dropped.
        let settleStatus: "idle" | "error" | "timeout" = "timeout";
        try {
          settleStatus = await Promise.any([
            bb.sdk.threads.wait({ threadId: child.id, status: "idle", timeoutMs: 600_000 }).then(() => "idle" as const),
            bb.sdk.threads.wait({ threadId: child.id, status: "error", timeoutMs: 600_000 }).then(() => "error" as const),
          ]);
        } catch {
          settleStatus = "timeout";
        }

        try {
          const out = (await bb.sdk.threads.output({ threadId: child.id })) as unknown as { output?: string | null };
          const text = out.output ?? "(no output)";
          const suffix =
            settleStatus === "error"
              ? " — child ended in error state"
              : settleStatus === "timeout"
                ? " — wait timed out, output may be incomplete"
                : "";
          results.push(`[subagent ${idx + 1} ${child.id}${agentHint}${suffix}]\n${text}`);
        } catch (e) {
          const msg = e instanceof Error ? e.message : String(e);
          results.push(`[subagent ${idx + 1} ${child.id} — failed to fetch output: ${msg}]`);
        }
      };

      if (params.chain?.length) {
        // Sequential chain with {previous} interpolation
        let previous = "";
        for (let i = 0; i < params.chain.length; i++) {
          const raw = params.chain[i]!;
          const task = raw.replaceAll("{previous}", previous);
          await spawnOne(task, i);
          previous = results[results.length - 1] ?? "";
        }
      } else if (allTasks.length === 1) {
        await spawnOne(allTasks[0]!, 0);
      } else {
        // Parallel — cap concurrency 4
        const pool = 4;
        for (let i = 0; i < allTasks.length; i += pool) {
          const batch = allTasks.slice(i, i + pool);
          await Promise.all(batch.map((t, j) => spawnOne(t, i + j)));
        }
      }

      const summary = results.join("\n\n---\n\n") || "(no subagent output)";
      const details = { childIds, agent: params.agent, role: params.role, model: preferredModel };
      return {
        content: [{ type: "text", text: summary }],
        details,
      };
    },
  });

  bb.agents.registerTool({
    name: "subagent_config",
    description:
      "Read or update subagent's role-to-model configuration. Use list-models before setting a model. inherit-parent makes a subagent use the parent thread model.",
    presentation: {
      label: { pending: "Reading subagent config", completed: "Read subagent config" },
    },
    parameters: z.object({
      action: z.enum(["get", "list-models", "set"]),
      role: z.string().optional(),
      model: z.string().optional(),
      models: z.array(z.string()).optional(),
    }),
    async execute(params) {
      if (params.action === "list-models") {
        const models = await listModels();
        return { content: [{ type: "text", text: models.join("\n") }], details: { models } };
      }
      const config = await readConfig();
      if (params.action === "set") {
        if (!params.role || (!params.model && !params.models?.length)) {
          throw new Error("subagent_config set requires role plus model or models.");
        }
        config.roles[params.role] = params.models?.length ? params.models : params.model!;
        await writeConfig(config);
      }
      return { content: [{ type: "text", text: JSON.stringify(config, null, 2) }], details: config };
    },
  });
}
