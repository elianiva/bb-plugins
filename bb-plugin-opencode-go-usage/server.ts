// bb-plugin-opencode-go-usage — OpenCode Go usage via https://opencode.ai/zen/go/v1/usage
// Auth is auto-discovered from pi's auth.json (~/.pi/agent/auth.json, or $PI_CODING_AGENT_DIR)
// so users who already use pi + opencode-go need no extra config.
import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { defineRpcContract, type BbPluginApi } from "@get-bb/plugin-sdk";
import { z } from "zod";

// ── Shapes ────────────────────────────────────────────────────────────────

const windowSchema = z.object({
  key: z.enum(["rolling", "weekly", "monthly"]),
  label: z.string(),
  windowId: z.string(),
  percent: z.number(),
  status: z.enum(["ok", "rate-limited"]),
  resetsAt: z.string(), // ISO
  resetsAtMs: z.number(),
  usedFraction: z.number(),
  remainingFraction: z.number(),
});

const usageResponseSchema = z.object({
  fetchedAt: z.string(),
  endpoint: z.string(),
  usage: z.object({
    rolling: windowSchema,
    weekly: windowSchema,
    monthly: windowSchema,
  }),
  raw: z.unknown(),
});

export type WindowUsage = z.infer<typeof windowSchema>;
export type UsageResponse = z.infer<typeof usageResponseSchema>;

export const rpcContract = defineRpcContract({
  usage_get: {
    input: z.object({ apiKey: z.string().optional() }).strict(),
    output: z.object({
      ok: z.boolean(),
      error: z.string().optional(),
      status: z.number().optional(),
      data: usageResponseSchema.optional(),
      cached: z.boolean().optional(),
      source: z.string().optional(),
    }),
  },
});

// ── Helpers ───────────────────────────────────────────────────────────────

const DEFAULT_ENDPOINT = "https://opencode.ai/zen/go";
const USAGE_PATH = "/v1/usage";
const CACHE_KEY = "opencode-go:usage-cache";
const CACHE_TTL_MS = 60_000;

type CachedUsage = { fetchedAt: number; data: UsageResponse };

function normalizeBaseUrl(baseUrl?: string): string {
  if (!baseUrl?.trim()) return DEFAULT_ENDPOINT;
  const trimmed = baseUrl.trim().replace(/\/+$/, "");
  if (trimmed.endsWith(USAGE_PATH)) return trimmed.slice(0, -USAGE_PATH.length) || DEFAULT_ENDPOINT;
  if (/\/v1$/i.test(trimmed)) return trimmed.replace(/\/v1$/i, "") || DEFAULT_ENDPOINT;
  return trimmed;
}

const WINDOW_META = [
  { key: "rolling" as const, label: "5 Hour", windowId: "5h" },
  { key: "weekly" as const, label: "Weekly", windowId: "7d" },
  { key: "monthly" as const, label: "Monthly", windowId: "monthly" },
] as const;

type UnknownRecord = Record<string, unknown>;

function buildWindow(
  meta: (typeof WINDOW_META)[number],
  payload: unknown,
): WindowUsage | null {
  if (typeof payload !== "object" || payload === null) return null;
  const r: UnknownRecord = payload as UnknownRecord;
  const percent = r.percent;
  const status = r.status;
  const resetsAt = r.resetsAt;
  if (
    typeof percent !== "number" ||
    !Number.isFinite(percent) ||
    percent < 0 ||
    percent > 100 ||
    (status !== "ok" && status !== "rate-limited") ||
    typeof resetsAt !== "string"
  )
    return null;
  const resetsAtMs = Date.parse(resetsAt);
  if (!Number.isFinite(resetsAtMs)) return null;
  const usedFraction = percent / 100;
  return {
    key: meta.key,
    label: meta.label,
    windowId: meta.windowId,
    percent,
    status,
    resetsAt,
    resetsAtMs,
    usedFraction,
    remainingFraction: Math.max(0, 1 - usedFraction),
  };
}

async function readUpstreamErrorMessage(res: Response): Promise<string | undefined> {
  try {
    const payload = (await res.json()) as unknown;
    if (typeof payload === "object" && payload !== null) {
      const rec: UnknownRecord = payload as UnknownRecord;
      if (typeof rec.error === "object" && rec.error !== null) {
        const errRec: UnknownRecord = rec.error as UnknownRecord;
        if (typeof errRec.message === "string") return errRec.message;
      }
      if (typeof rec.message === "string") return rec.message;
    }
  } catch (error) {
    void error;
  }
  return undefined;
}

type ErrorWithStatus = { status?: number };

function getErrorStatus(error: unknown): number | undefined {
  if (typeof error !== "object" || error === null) return undefined;
  const candidate: ErrorWithStatus = error as ErrorWithStatus;
  const status = candidate.status;
  return typeof status === "number" ? status : undefined;
}

async function fetchUsage(apiKey: string, baseUrl: string): Promise<UsageResponse> {
  const normalized = normalizeBaseUrl(baseUrl);
  const url = `${normalized}${USAGE_PATH}`;
  const res = await fetch(url, {
    headers: { accept: "application/json", authorization: `Bearer ${apiKey}` },
  });
  if (!res.ok) {
    const detail = await readUpstreamErrorMessage(res);
    const suffix = detail ? `: ${detail}` : ` ${res.statusText}`.trimEnd();
    throw Object.assign(new Error(`OpenCode Go usage ${res.status}${suffix ? ` — ${suffix}` : ""}`), {
      status: res.status,
    });
  }
  const payload = (await res.json()) as unknown;
  if (typeof payload !== "object" || payload === null) throw new Error("Invalid JSON from usage endpoint");
  const rec: UnknownRecord = payload as UnknownRecord;
  const usageCandidate = rec.usage;
  const usageObj: UnknownRecord =
    usageCandidate !== null && typeof usageCandidate === "object"
      ? (usageCandidate as UnknownRecord)
      : rec;
  const rollingRaw = usageObj.rolling ?? rec.rolling;
  const weeklyRaw = usageObj.weekly ?? rec.weekly;
  const monthlyRaw = usageObj.monthly ?? rec.monthly;

  const rolling = buildWindow(WINDOW_META[0], rollingRaw);
  const weekly = buildWindow(WINDOW_META[1], weeklyRaw);
  const monthly = buildWindow(WINDOW_META[2], monthlyRaw);

  if (!rolling || !weekly || !monthly) {
    throw new Error(`Malformed usage payload — expected rolling/weekly/monthly with { percent, status, resetsAt }`);
  }

  return {
    fetchedAt: new Date().toISOString(),
    endpoint: url,
    usage: { rolling, weekly, monthly },
    raw: payload,
  };
}

// ── pi auth reuse ─────────────────────────────────────────────────────────

function getPiAuthPath(): string {
  const envDir = process.env.PI_CODING_AGENT_DIR;
  if (envDir) {
    const expanded =
      envDir === "~" ? homedir() : envDir.startsWith("~/") ? `${homedir()}${envDir.slice(1)}` : envDir;
    return join(expanded, "auth.json");
  }
  return join(homedir(), ".pi", "agent", "auth.json");
}

function resolveConfigValue(value: string): string | undefined {
  // Mirrors pi's resolveConfigValue: env var name → env value, "!" → shell (skip), else literal
  if (value.startsWith("!")) return undefined; // shell commands not supported for bb plugin
  const envVal = process.env[value];
  if (envVal) return envVal;
  return value;
}

function readPiApiKey(): { key: string; source: string } | null {
  // 1. Try auth.json
  const authPath = getPiAuthPath();
  try {
    if (existsSync(authPath)) {
      const raw = readFileSync(authPath, "utf-8");
      const data: UnknownRecord = JSON.parse(raw) as UnknownRecord;
      for (const provider of ["opencode-go", "opencode"] as const) {
        const rawEntry: unknown = data[provider];
        const entry: UnknownRecord | undefined =
          rawEntry !== null && typeof rawEntry === "object" ? (rawEntry as UnknownRecord) : undefined;
        if (entry && entry.type === "api_key" && typeof entry.key === "string" && entry.key.trim()) {
          const resolved = resolveConfigValue(entry.key.trim());
          if (resolved) return { key: resolved, source: `pi auth.json (${provider}) at ${authPath}` };
        }
      }
    }
  } catch (error) {
    void error;
  }
  // 2. Fallback to env var (pi's getEnvApiKey for opencode)
  const envKey = process.env.OPENCODE_API_KEY;
  if (envKey?.trim()) return { key: envKey.trim(), source: "env OPENCODE_API_KEY" };
  return null;
}

function resolveApiKey(opts: {
  override?: string;
  settingsKey?: string;
}): { key: string; source: string } | null {
  const trimmedOverride = opts.override?.trim();
  if (trimmedOverride) return { key: trimmedOverride, source: "override --api-key" };
  const trimmedSettings = opts.settingsKey?.trim();
  if (trimmedSettings) {
    const resolved = resolveConfigValue(trimmedSettings);
    if (resolved) return { key: resolved, source: "plugin settings apiKey" };
  }
  const pi = readPiApiKey();
  if (pi) return pi;
  return null;
}

// ── Plugin ────────────────────────────────────────────────────────────────

export default async function plugin(bb: BbPluginApi) {
  bb.log.info("loaded");

  const settings = bb.settings.define({
    apiKey: {
      type: "string",
      label: "OpenCode Go API key (optional — auto-uses pi auth.json if empty)",
      secret: true,
    },
    baseUrl: {
      type: "string",
      label: "OpenCode Go base URL",
      default: DEFAULT_ENDPOINT,
    },
  });

  // Only warn if neither settings nor pi auth has a key
  const initial = await settings.get();
  const initialResolved = resolveApiKey({ settingsKey: initial.apiKey });
  if (!initialResolved) {
    bb.status.needsConfiguration(
      "No OpenCode Go key found. Either set it with: bb plugin config opencode-go-usage set apiKey <key> — or log in via pi (/login opencode-go) — then bb plugin reload opencode-go-usage",
    );
  } else {
    bb.log.info(`using key from ${initialResolved.source}`);
  }

  async function getUsageWithCache(apiKey: string, baseUrl: string): Promise<{ data: UsageResponse; cached: boolean }> {
    const cached = await bb.storage.kv.get<CachedUsage>(CACHE_KEY);
    const now = Date.now();
    if (cached && now - cached.fetchedAt < CACHE_TTL_MS) {
      return { data: cached.data, cached: true };
    }
    const data = await fetchUsage(apiKey, baseUrl);
    await bb.storage.kv.set(CACHE_KEY, { fetchedAt: now, data } satisfies CachedUsage);
    return { data, cached: false };
  }

  // RPC — frontend calls this
  bb.rpc.register(rpcContract, {
    usage_get: async ({ apiKey: override }) => {
      const { apiKey: stored, baseUrl } = await settings.get();
      const resolved = resolveApiKey({ override, settingsKey: stored });
      if (!resolved) {
        return {
          ok: false,
          error:
            "No API key found. Tried: --api-key override, plugin settings (bb plugin config opencode-go-usage set apiKey <key>), pi auth.json (~/.pi/agent/auth.json → opencode-go/opencode), and env OPENCODE_API_KEY. Log in with pi via /login opencode-go or set the plugin key.",
        };
      }
      try {
        if (override?.trim()) {
          const data = await fetchUsage(resolved.key, baseUrl || DEFAULT_ENDPOINT);
          await bb.storage.kv.set(CACHE_KEY, { fetchedAt: Date.now(), data } satisfies CachedUsage);
          return { ok: true, data, cached: false, source: resolved.source };
        }
        const { data, cached } = await getUsageWithCache(resolved.key, baseUrl || DEFAULT_ENDPOINT);
        return { ok: true, data, cached, source: resolved.source };
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        const status = getErrorStatus(e);
        return { ok: false, error: msg, status, source: resolved.source };
      }
    },
  });

  // ── CLI ────────────────────────────────────────────────────────────────

  function fmtWindow(w: WindowUsage): string {
    const barLen = 20;
    const filled = Math.round(w.usedFraction * barLen);
    const bar = "█".repeat(filled) + "░".repeat(barLen - filled);
    const remaining = w.remainingFraction * 100;
    const statusTag = w.status === "rate-limited" ? " RATE-LIMITED" : "";
    const resetsIn = formatResetsIn(w.resetsAtMs);
    return `${w.label.padEnd(8)} ${w.percent.toFixed(1).padStart(5)}% used  ${bar}  ${remaining.toFixed(1)}% left  resets ${resetsIn}${statusTag}`;
  }
  function formatResetsIn(ms: number): string {
    const diff = ms - Date.now();
    if (diff <= 0) return "now";
    const hours = Math.floor(diff / 3_600_000);
    const mins = Math.floor((diff % 3_600_000) / 60_000);
    if (hours > 24) {
      const days = Math.floor(hours / 24);
      return `in ${days}d ${hours % 24}h`;
    }
    if (hours > 0) return `in ${hours}h ${mins}m`;
    return `in ${mins}m`;
  }

  bb.cli.register({
    name: "opencode-go-usage",
    summary: "Show OpenCode Go quota (5h / weekly / monthly) from /zen/go/v1/usage",
    commands: [
      {
        name: "show",
        summary: "Fetch and display usage",
        usage: "bb opencode-go-usage [show] [--json] [--api-key <key>] [--base-url <url>]",
      },
      {
        name: "status",
        summary: "Alias for show",
        usage: "bb opencode-go-usage status [--json]",
      },
    ],
    async run(argv) {
      const json = argv.includes("--json");
      const getFlag = (name: string): string | undefined => {
        const idx = argv.indexOf(name);
        if (idx !== -1 && idx + 1 < argv.length) return argv[idx + 1];
        const pref = argv.find((a) => a.startsWith(`${name}=`));
        if (pref) return pref.slice(name.length + 1);
        return undefined;
      };
      const flagApiKey = getFlag("--api-key") ?? getFlag("--key");
      const flagBaseUrl = getFlag("--base-url") ?? getFlag("--baseUrl");
      const filtered = argv.filter(
        (a) =>
          a !== "--json" &&
          a !== "--api-key" &&
          a !== "--key" &&
          a !== "--base-url" &&
          a !== "--baseUrl" &&
          !a.startsWith("--api-key=") &&
          !a.startsWith("--key=") &&
          !a.startsWith("--base-url=") &&
          !a.startsWith("--baseUrl="),
      );
      const positional: string[] = [];
      for (let i = 0; i < filtered.length; i++) {
        const a = filtered[i]!;
        if ((a === "--api-key" || a === "--key" || a === "--base-url" || a === "--baseUrl") && i + 1 < filtered.length) {
          i++;
          continue;
        }
        positional.push(a);
      }
      if (flagApiKey && positional.includes(flagApiKey)) {
        const idx = positional.indexOf(flagApiKey);
        if (idx !== -1) positional.splice(idx, 1);
      }
      if (flagBaseUrl && positional.includes(flagBaseUrl)) {
        const idx = positional.indexOf(flagBaseUrl);
        if (idx !== -1) positional.splice(idx, 1);
      }
      const sub = positional[0]?.toLowerCase();
      if (sub === "help" || sub === "--help" || sub === "-h") {
        const usage = [
          "Usage:",
          "  bb opencode-go-usage [show] [--json] [--api-key <key>] [--base-url <url>]",
          "  bb opencode-go-usage status [--json]",
          "",
          "Fetches https://opencode.ai/zen/go/v1/usage with Authorization: Bearer <key>.",
          "Key resolution (first match wins):",
          "  1. --api-key <key>",
          "  2. plugin settings  (bb plugin config opencode-go-usage set apiKey <key>)",
          "  3. pi auth.json     (~/.pi/agent/auth.json → opencode-go, then opencode)",
          "     respects $PI_CODING_AGENT_DIR, or ~/.pi/agent/auth.json by default",
          "  4. env OPENCODE_API_KEY",
          "Base URL defaults to https://opencode.ai/zen/go (--base-url overrides).",
        ].join("\n");
        return { exitCode: 0, stdout: usage };
      }
      if (sub && sub !== "show" && sub !== "status") {
        return {
          exitCode: 1,
          stderr: `Unknown command "${positional[0]}". Usage: bb opencode-go-usage [show|status] [--json]`,
        };
      }

      const stored = await settings.get();
      const baseUrl = flagBaseUrl?.trim() || stored.baseUrl?.trim() || DEFAULT_ENDPOINT;
      const resolved = resolveApiKey({ override: flagApiKey, settingsKey: stored.apiKey });

      if (!resolved) {
        const msg =
          "No API key found.\nTried (first match wins):\n  1. --api-key <key>\n  2. bb plugin config opencode-go-usage set apiKey <key>\n  3. pi auth.json (~/.pi/agent/auth.json → opencode-go/opencode) — run /login opencode-go in pi\n  4. env OPENCODE_API_KEY";
        if (json) return { exitCode: 1, stdout: JSON.stringify({ ok: false, error: msg }) };
        return { exitCode: 1, stderr: msg };
      }

      try {
        const data = await fetchUsage(resolved.key, baseUrl);
        await bb.storage.kv.set(CACHE_KEY, { fetchedAt: Date.now(), data } satisfies CachedUsage);
        if (json) {
          return { exitCode: 0, stdout: JSON.stringify({ ok: true, data, source: resolved.source }, null, 2) };
        }
        const lines = [
          `OpenCode Go usage  (${data.endpoint})  [${resolved.source}]  fetched ${new Date(data.fetchedAt).toLocaleString()}`,
          "─".repeat(72),
          fmtWindow(data.usage.rolling),
          `         resets at ${new Date(data.usage.rolling.resetsAt).toLocaleString()}`,
          "",
          fmtWindow(data.usage.weekly),
          `         resets at ${new Date(data.usage.weekly.resetsAt).toLocaleString()}`,
          "",
          fmtWindow(data.usage.monthly),
          `         resets at ${new Date(data.usage.monthly.resetsAt).toLocaleString()}`,
        ];
        return { exitCode: 0, stdout: lines.join("\n") };
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        const status = getErrorStatus(e);
        if (json) return { exitCode: 1, stdout: JSON.stringify({ ok: false, error: msg, status, source: resolved.source }) };
        return { exitCode: 1, stderr: `${msg} [${resolved.source}]${status ? ` (HTTP ${status})` : ""}` };

      }
    },
  });

  bb.onDispose(() => {
    bb.log.info("disposed");
  });
}
