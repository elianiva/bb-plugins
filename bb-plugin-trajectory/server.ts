// bb-plugin-trajectory — DeepSeek-harness-style debug view: full log of agent operations
//
// Backend proxies BB's thread event timeline with typed RPC so the frontend can
// render a complete, filterable trajectory without bundling SDK knowledge.
// Inspired by DeepSeek's harness trajectory view: every tool call, reasoning
// step, file op, and turn boundary in one scrollable debug log.

import { defineRpcContract, type BbPluginApi } from "@get-bb/plugin-sdk";
import { z } from "zod";

// ── RPC contract ─────────────────────────────────────────────────────────

export const rpcContract = defineRpcContract({
  trajectory_list_threads: {
    input: z
      .object({
        projectId: z.string().optional(),
        limit: z.number().int().min(1).max(100).optional(),
        offset: z.number().int().min(0).optional(),
        search: z.string().optional(),
      })
      .strict(),
    output: z.object({
      threads: z.array(z.unknown()),
      total: z.number().optional(),
    }),
  },
  trajectory_list_projects: {
    input: z.null(),
    output: z.object({ projects: z.array(z.unknown()) }),
  },
  trajectory_get: {
    input: z
      .object({
        threadId: z.string().min(1),
        limit: z.number().int().min(1).max(1000).optional(),
        afterSeq: z.number().int().min(0).optional(),
        beforeSeq: z.number().int().min(0).optional(),
        order: z.enum(["asc", "desc"]).optional(),
      })
      .strict(),
    output: z.object({
      thread: z.unknown(),
      events: z.array(z.unknown()),
      hasMore: z.boolean(),
      nextSeq: z.number().nullable(),
    }),
  },
  trajectory_timeline: {
    input: z.object({ threadId: z.string().min(1) }).strict(),
    output: z.object({ timeline: z.unknown() }),
  },
  trajectory_output: {
    input: z.object({ threadId: z.string().min(1) }).strict(),
    output: z.object({ output: z.string().nullable() }),
  },
});

type TrajectoryGetInput = {
  threadId: string;
  limit?: number;
  afterSeq?: number;
  beforeSeq?: number;
  order?: "asc" | "desc";
};

// ── Plugin ───────────────────────────────────────────────────────────────

export default async function plugin(bb: BbPluginApi) {
  bb.log.info("trajectory loaded — debug view for agent operations");

  // Realtime channel to nudge frontend when any thread changes (cheap invalidation)
  const TRAJECTORY_SIGNAL = "trajectory:changed";

  // Lightweight thread-change broadcaster so the UI can auto-refresh active trajectories
  bb.events.on("thread.active", () => bb.realtime.publish(TRAJECTORY_SIGNAL, { at: Date.now() }));
  bb.events.on("thread.idle", () => bb.realtime.publish(TRAJECTORY_SIGNAL, { at: Date.now() }));
  bb.events.on("thread.created", () => bb.realtime.publish(TRAJECTORY_SIGNAL, { at: Date.now() }));
  bb.events.on("thread.failed", () => bb.realtime.publish(TRAJECTORY_SIGNAL, { at: Date.now() }));

  bb.rpc.register(rpcContract, {
    trajectory_list_projects: async () => {
      try {
        const res = await bb.sdk.projects.list({ includePersonal: true } as never);
        const projects = (res as unknown as { projects?: unknown[] }).projects
          ?? (res as unknown as unknown[]);
        return { projects: Array.isArray(projects) ? projects : [] };
      } catch (e) {
        bb.log.warn(`trajectory_list_projects failed: ${e instanceof Error ? e.message : String(e)}`);
        return { projects: [] };
      }
    },

    trajectory_list_threads: async ({ projectId, limit, offset, search }) => {
      // Use SDK search when query present, otherwise list
      try {
        if (search && search.trim()) {
          const res = await bb.sdk.threads.search({
            query: search.trim(),
            limit: limit ?? 30,
          } as never);
          // search returns threads under different key depending on version — normalize
          const threads =
            (res as unknown as { threads?: unknown[] }).threads
            ?? (res as unknown as { results?: unknown[] }).results
            ?? (Array.isArray(res) ? res : []);
          return { threads: threads as unknown[] };
        }
        const args: Record<string, unknown> = { limit: limit ?? 30, offset: offset ?? 0, includeHidden: true };
        if (projectId) args.projectId = projectId;
        const res = await bb.sdk.threads.list(args as never);
        const threads = (res as unknown as { threads?: unknown[] }).threads
          ?? (Array.isArray(res) ? res : []);
        return { threads: threads as unknown[] };
      } catch (e) {
        bb.log.warn(`trajectory_list_threads failed: ${e instanceof Error ? e.message : String(e)} stack=${(e as Error).stack?.slice(0, 500)}`);
        return { threads: [] };
      }
    },

    trajectory_get: async ({ threadId, limit, afterSeq, beforeSeq, order }: TrajectoryGetInput) => {
      const fetchLimit = limit ?? 500;
      // Fetch thread meta + events in parallel
      const [thread, events] = await Promise.all([
        bb.sdk.threads.get({ threadId } as never).catch((e) => {
          bb.log.warn(`trajectory_get thread ${threadId} failed: ${String(e)}`);
          return null;
        }),
        bb.sdk.threads.events
          .list({
            threadId,
            limit: String(fetchLimit),
            ...(afterSeq !== undefined ? { afterSeq: String(afterSeq) } : {}),
            ...(beforeSeq !== undefined ? { beforeSeq: String(beforeSeq) } : {}),
            ...(order ? { order } : {}),
          } as never)
          .catch((e) => {
            bb.log.warn(`trajectory_get events ${threadId} failed: ${String(e)}`);
            return [] as unknown[];
          }),
      ]);

      const arr = Array.isArray(events) ? events : [];
      const hasMore = arr.length >= fetchLimit;
      const nextSeq = arr.length ? (arr[arr.length - 1] as { seq?: number }).seq ?? null : null;

      return {
        thread: thread ?? { id: threadId },
        events: arr as unknown[],
        hasMore,
        nextSeq: typeof nextSeq === "number" ? nextSeq : null,
      };
    },

    trajectory_timeline: async ({ threadId }) => {
      try {
        const timeline = await bb.sdk.threads.timeline({ threadId } as never);
        return { timeline: timeline as unknown };
      } catch (e) {
        bb.log.warn(`trajectory_timeline ${threadId} failed: ${String(e)}`);
        return { timeline: null };
      }
    },

    trajectory_output: async ({ threadId }) => {
      try {
        const res = await bb.sdk.threads.output({ threadId } as never);
        const out = (res as unknown as { output?: string | null; text?: string | null }).output
          ?? (res as unknown as { text?: string | null }).text
          ?? null;
        return { output: out };
      } catch {
        return { output: null };
      }
    },
  });

  // ── CLI: bb trajectory ──────────────────────────────────────────────
  bb.cli.register({
    name: "trajectory",
    summary: "Trajectory debug view — full log of agent operations (DeepSeek harness style)",
    commands: [
      { name: "list", summary: "List threads", usage: "bb trajectory list [--project <id>] [--search <q>] [--json]" },
      { name: "show", summary: "Show full trajectory for a thread", usage: "bb trajectory show <threadId> [--limit 500] [--json]" },
      { name: "projects", summary: "List projects", usage: "bb trajectory projects [--json]" },
    ],
    async run(argv) {
      const json = argv.includes("--json");
      const getFlag = (name: string): string | undefined => {
        const i = argv.indexOf(name);
        if (i !== -1 && argv[i + 1] && !String(argv[i + 1]).startsWith("--")) return argv[i + 1];
        const pref = argv.find((a) => a.startsWith(`${name}=`));
        return pref ? pref.slice(name.length + 1) : undefined;
      };
      const filtered = argv.filter((a) => a !== "--json" && !a.startsWith("--project") && !a.startsWith("--search") && !a.startsWith("--limit"));
      // strip flag values
      const projectFlag = getFlag("--project");
      const searchFlag = getFlag("--search");
      const limitFlag = getFlag("--limit");
      // remove flag values that leaked into positional
      const positional = filtered.filter((a) => a !== projectFlag && a !== searchFlag && a !== limitFlag && !a.startsWith("--"));
      const cmd = positional[0]?.toLowerCase();
      const arg1 = positional[1];

      const reply = (value: unknown, text: string) => ({
        exitCode: 0,
        stdout: json ? JSON.stringify(value, null, 2) : text,
      });

      if (!cmd || cmd === "help" || cmd === "--help") {
        return {
          exitCode: 0,
          stdout: [
            "Usage:",
            "  bb trajectory list [--project <id>] [--search <q>] [--json]",
            "  bb trajectory show <threadId> [--limit 500] [--json]   # full event log",
            "  bb trajectory projects [--json]",
            "",
            "DeepSeek-harness-style trajectory view — every tool call, file op, turn boundary, token usage.",
            "Open BB → Trajectory panel for the interactive debug view.",
          ].join("\n"),
        };
      }

      if (cmd === "projects") {
        try {
          const res = await bb.sdk.projects.list({ includePersonal: true } as never);
          const projects = (res as unknown as { projects?: unknown[] }).projects ?? [];
          const text = (projects as Array<{ id: string; name: string | null }>).map((p) => `${p.id}  ${p.name ?? "(unnamed)"}`).join("\n") || "No projects.";
          return reply({ projects }, text);
        } catch (e) {
          return { exitCode: 1, stderr: String(e) };
        }
      }

      if (cmd === "list") {
        const threadIdArg = arg1 && !arg1.startsWith("--") ? arg1 : undefined;
        // allow `bb trajectory list <search>` shorthand
        const q = searchFlag ?? threadIdArg;
        try {
          let threads: unknown[] = [];
          if (q) {
            const res = await bb.sdk.threads.search({ query: q, limit: 30 } as never);
            threads = (res as unknown as { threads?: unknown[] }).threads
              ?? (res as unknown as { results?: unknown[] }).results ?? [];
          } else {
            const args: Record<string, unknown> = { limit: 30, includeHidden: true };
            if (projectFlag) args.projectId = projectFlag;
            const res = await bb.sdk.threads.list(args as never);
            threads = (res as unknown as { threads?: unknown[] }).threads ?? (Array.isArray(res) ? res : []);
          }
          const list = threads as Array<{ id: string; title: string | null; status: string; updatedAt: number }>;
          const text = list.map((t) => `${t.id}  [${t.status}]  ${t.title ?? "(untitled)"}  ${new Date(t.updatedAt).toISOString()}`).join("\n") || "No threads.";
          return reply({ threads }, text);
        } catch (e) {
          return { exitCode: 1, stderr: String(e) };
        }
      }

      if (cmd === "show") {
        const threadId = arg1 ?? getFlag("--thread") ?? projectFlag;
        if (!threadId) return { exitCode: 1, stderr: "bb trajectory show <threadId> — missing thread id" };
        const lim = limitFlag ? Number(limitFlag) : 500;
        try {
          const [thread, events] = await Promise.all([
            bb.sdk.threads.get({ threadId } as never),
            bb.sdk.threads.events.list({ threadId, limit: String(lim) } as never),
          ]);
          const arr = Array.isArray(events) ? events : [];
          if (json) return reply({ thread, events: arr }, "");
          const lines = arr.map((e: unknown) => {
            const ev = e as { seq: number; type: string; createdAt: number; data?: unknown };
            const ts = new Date(ev.createdAt).toISOString().slice(11, 23);
            return `${String(ev.seq).padStart(4, " ")}  ${ts}  ${ev.type}`;
          });
          const header = `Thread ${threadId} — ${arr.length} events\n` + lines.join("\n");
          return { exitCode: 0, stdout: header };
        } catch (e) {
          return { exitCode: 1, stderr: String(e) };
        }
      }

      return { exitCode: 1, stderr: `Unknown command "${cmd}". Try: bb trajectory --help` };
    },
  });

  bb.onDispose(() => bb.log.info("trajectory disposed"));
}
