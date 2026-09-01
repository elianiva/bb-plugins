// bb-plugin-trajectory — compact, integrated trajectory debug view
// Right sidebar (Thread → Trajectory) is primary; left nav is global picker.
// Visual target: dense list like the second screenshot — thin rows, muted
// borders, no pink cards, stable header, no flickering count.

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { definePluginApp, useRealtime, useRpc } from "@get-bb/plugin-sdk/app";
import type { rpcContract } from "./server";

// ── Types ───────────────────────────────────────────────────────────────────

type BBEvent = {
  id: string;
  seq: number;
  type: string;
  threadId: string;
  createdAt: number;
  scope?: { kind: string; turnId?: string };
  data?: unknown;
};

type ThreadRow = {
  id: string;
  title?: string | null;
  titleFallback?: string | null;
  status?: string;
  providerId?: string | null;
  model?: string | null;
  updatedAt?: number;
  createdAt?: number;
  projectId?: string;
  environmentId?: string | null;
  parentThreadId?: string | null;
};

// ── Helpers ─────────────────────────────────────────────────────────────────

function fmtTime(ms: number): string {
  try {
    return new Date(ms).toISOString().slice(11, 23);
  } catch {
    return String(ms);
  }
}
function fmtAgo(ms: number): string {
  const s = Math.floor((Date.now() - ms) / 1000);
  if (s < 60) return `${s}s ago`;
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  return `${Math.floor(s / 86400)}d ago`;
}
function truncate(s: string, n: number): string {
  return s.length > n ? s.slice(0, n) + "…" : s;
}
function pretty(obj: unknown): string {
  try {
    return JSON.stringify(obj, null, 2);
  } catch {
    return String(obj);
  }
}

type Category = "all" | "turn" | "tool" | "file" | "system" | "error" | "token";

function categorize(ev: BBEvent): Category[] {
  const t = ev.type;
  const cats: Category[] = [];
  if (t.startsWith("turn/") || t.startsWith("client/turn") || t.startsWith("client/thread")) cats.push("turn");
  if (t.startsWith("item/")) {
    const item = (ev.data as { item?: { type?: string } })?.item;
    const kind = item?.type ?? "";
    if (["fileRead", "fileWrite", "fileEdit", "fileCreate", "read", "write", "edit"].some((k) => kind.toLowerCase().includes(k))) cats.push("file");
    else cats.push("tool");
    cats.push("tool");
  }
  if (t.startsWith("system/") || t.startsWith("thread/identity") || t.startsWith("provider/warning") || t.includes("provisioning")) cats.push("system");
  if (t.includes("error") || t.includes("failed") || t === "provider/error") cats.push("error");
  if (t.includes("token") || t.includes("contextWindow")) cats.push("token");
  return cats.length ? cats : ["system"];
}

function compactSummary(ev: BBEvent): string {
  const d = ev.data as Record<string, unknown> | undefined;
  const item = d?.["item"] as Record<string, unknown> | undefined;
  if (item) {
    const cmd = (item["cmd"] as string) ?? "";
    const path = (item["path"] as string) ?? "";
    const label = (item["label"] as string) ?? "";
    const type = (item["type"] as string) ?? "";
    // Prefer human label/cmd/path — short
    if (label) return truncate(label, 96);
    if (cmd) return truncate(cmd, 96);
    if (path) return truncate(path, 96);
    if (type) return type;
  }
  if (ev.type === "client/turn/requested") {
    const input = (d?.["input"] as Array<{ text?: string }>) ?? [];
    const text = input[0]?.text ?? "";
    if (text) return truncate(text.replace(/\s+/g, " ").trim(), 96);
  }
  if (ev.type.includes("provisioning")) {
    const entries = (d?.["entries"] as Array<{ text?: string }>) ?? [];
    if (entries[0]?.text) return truncate(entries[0].text, 96);
  }
  // fallback: short preview of data keys
  if (d && typeof d === "object" && Object.keys(d).length) {
    const keys = Object.keys(d).slice(0, 3).join(", ");
    return keys ? `{ ${keys} }` : "";
  }
  return "";
}

function rowIcon(ev: BBEvent): string {
  const t = ev.type;
  if (t.includes("failed") || t.includes("error")) return "✕";
  if (t === "client/turn/requested") return "›";
  if (t.includes("turn/started") || t.includes("turn/input")) return "›";
  if (t.startsWith("item/")) {
    const item = (ev.data as { item?: { type?: string } })?.item;
    const k = item?.type ?? "";
    if (k.toLowerCase().includes("file")) return "›";
    if (k.toLowerCase().includes("bash") || k.toLowerCase().includes("shell")) return "›";
    return "›";
  }
  if (t.includes("token")) return "·";
  return "·";
}

// Left accent per category — subtle, like native focus ring
function accent(cat: Category): string {
  switch (cat) {
    case "turn": return "border-l-violet-500/60";
    case "tool": return "border-l-sky-500/60";
    case "file": return "border-l-emerald-500/60";
    case "error": return "border-l-red-500/70";
    case "token": return "border-l-amber-500/60";
    case "system": return "border-l-zinc-300 dark:border-l-zinc-600";
    default: return "border-l-transparent";
  }
}

// ── Compact row — second screenshot style ──────────────────────────────────

function CompactRow({
  ev,
  expanded,
  onToggle,
}: {
  ev: BBEvent;
  expanded: boolean;
  onToggle: () => void;
}) {
  const cats = categorize(ev);
  const primary = cats[0] ?? "system";
  const summary = compactSummary(ev);
  const item = (ev.data as { item?: Record<string, unknown> })?.item;
  const status = (item?.["status"] as string) ?? "";

  return (
    <div className={`group/row border-b border-border/40 hover:bg-muted/40 ${expanded ? "bg-muted/20" : "bg-transparent"}`}>
      <button
        type="button"
        onClick={onToggle}
        className={`flex w-full items-center gap-2 border-l-2 px-2.5 py-[7px] text-left ${accent(primary)}`}
      >
        {/* seq */}
        <span className="hidden shrink-0 font-mono text-[10px] leading-none text-muted-foreground/70 sm:inline">#{ev.seq}</span>
        {/* icon */}
        <span className={`flex size-[18px] shrink-0 items-center justify-center rounded-[4px] border bg-background font-mono text-[11px] leading-none ${primary === "error" ? "border-red-500/30 text-red-600" : primary === "turn" ? "border-violet-500/20 text-violet-600" : "border-border text-muted-foreground"}`}>
          {rowIcon(ev)}
        </span>
        {/* type */}
        <span className="shrink-0 font-mono text-[11px] font-medium leading-none text-foreground/90">{ev.type}</span>
        {/* status dot */}
        {status === "pending" ? <span className="size-1.5 shrink-0 rounded-full bg-amber-500" /> : status === "completed" ? <span className="size-1.5 shrink-0 rounded-full bg-emerald-500/70" /> : null}
        {/* summary */}
        {summary ? (
          <span className="min-w-0 flex-1 truncate font-mono text-[11px] leading-none text-muted-foreground">{summary}</span>
        ) : (
          <span className="flex-1" />
        )}
        {/* time */}
        <span className="hidden shrink-0 font-mono text-[10px] leading-none text-muted-foreground/60 md:inline">{fmtTime(ev.createdAt).slice(0, 8)}</span>
        {/* chevron */}
        <span className="shrink-0 text-[10px] text-muted-foreground/50 group-hover/row:text-muted-foreground">{expanded ? "▾" : "▸"}</span>
      </button>

      {expanded ? (
        <div className="border-t border-border bg-muted/30 px-3 py-2.5">
          {/* item detail when present */}
          {item ? (
            <div className="mb-2 rounded border border-border bg-card px-2.5 py-2">
              <div className="flex flex-wrap items-center gap-2 font-mono text-[11px] text-muted-foreground">
                <span className="rounded bg-muted px-1.5 py-0.5 text-[10px] font-medium text-foreground">{String(item["type"] ?? "item")}</span>
                {item["id"] ? <span className="text-[10px] text-muted-foreground/70">{String(item["id"]).slice(0, 16)}</span> : null}
                {status ? <span className={`rounded px-1 py-0 text-[10px] font-medium ${status === "completed" ? "bg-emerald-500/15 text-emerald-700 dark:text-emerald-300 border border-emerald-500/20" : status === "pending" ? "bg-amber-500/15 text-amber-700 dark:text-amber-300 border border-amber-500/20" : "bg-muted text-muted-foreground border border-border"}`}>{status}</span> : null}
              </div>
              {item["path"] ? <div className="mt-1 font-mono text-[11px] text-muted-foreground">{String(item["path"])}</div> : null}
              {item["cmd"] ? <div className="mt-1 font-mono text-[11px] text-muted-foreground">{String(item["cmd"])}</div> : null}
              {item["label"] ? <div className="mt-1 font-mono text-[11px] text-foreground/80">{String(item["label"])}</div> : null}
            </div>
          ) : null}
          <pre className="max-h-[28rem] overflow-auto rounded-md border border-border bg-card px-3 py-2.5 font-mono text-[11px] leading-relaxed text-foreground">{pretty(ev)}</pre>
          <div className="mt-2 flex gap-2">
            <button
              type="button"
              onClick={async () => {
                await navigator.clipboard.writeText(pretty(ev));
              }}
              className="rounded-md border border-border bg-background px-2.5 py-1 font-mono text-[11px] font-medium text-foreground hover:bg-accent hover:text-accent-foreground"
            >
              Copy JSON
            </button>
          </div>
        </div>
      ) : null}
    </div>
  );
}

// ── Shared toolbar + list ───────────────────────────────────────────────────

function TrajectoryList({
  events,
  isInitialLoading,
  isRefreshing,
  hasMore,
  filter,
  setFilter,
  q,
  setQ,
  limit,
  setLimit,
  onRefresh,
  threadMeta,
}: {
  events: BBEvent[] | null;
  isInitialLoading: boolean;
  isRefreshing: boolean;
  hasMore: boolean;
  filter: Category;
  setFilter: (c: Category) => void;
  q: string;
  setQ: (v: string) => void;
  limit: number;
  setLimit: (n: number) => void;
  onRefresh: () => void;
  threadMeta: ThreadRow | null;
}) {
  const filtered = useMemo(() => {
    if (!events) return [];
    let out = events;
    if (filter !== "all") out = out.filter((e) => categorize(e).includes(filter));
    if (q.trim()) {
      const needle = q.trim().toLowerCase();
      out = out.filter((e) => JSON.stringify(e).toLowerCase().includes(needle));
    }
    return out;
  }, [events, filter, q]);

  // Keep counts stable — derive once per events change, don't flicker with loading text
  const counts = useMemo(() => {
    if (!events) return null;
    const turns = new Set(events.map((e) => e.scope?.turnId).filter(Boolean)).size;
    return { total: events.length, filtered: filtered.length, turns };
  }, [events, filtered.length]);

  const [expanded, setExpanded] = useState<Set<number>>(new Set());
  const toggle = useCallback((seq: number) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(seq)) next.delete(seq);
      else next.add(seq);
      return next;
    });
  }, []);

  // Autoscroll to bottom like chat thread — always goes to bottom when follow is on
  const [followTail] = useState(true);
  const listRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (followTail && listRef.current) {
      // Use rAF so it runs after DOM paint, then jump straight to bottom
      requestAnimationFrame(() => {
        const el = listRef.current;
        if (el) el.scrollTop = el.scrollHeight;
      });
    }
  }, [filtered, followTail]);

  return (
    <div className="flex min-h-0 flex-1 flex-col bg-transparent">
      {/* Toolbar — compact, native segmentation */}
      <div className="shrink-0 border-b border-border">
        <div className="flex flex-wrap items-center gap-1.5 px-2.5 py-2">
          <div className="flex items-center rounded-md border border-border bg-background p-0.5">
            {(["all", "turn", "tool", "file", "system", "error", "token"] as Category[]).map((c) => (
              <button
                key={c}
                type="button"
                onClick={() => setFilter(c)}
                className={`rounded-[5px] px-2 py-1 text-[11px] font-medium capitalize leading-none transition-colors ${filter === c ? "bg-foreground text-background shadow-sm" : "text-muted-foreground hover:text-foreground"}`}
              >
                {c}
              </button>
            ))}
          </div>

          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Filter…"
            className="h-7 min-w-[8rem] max-w-[14rem] flex-1 rounded-md border border-input bg-background px-2 text-xs placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
          />

          <select value={String(limit)} onChange={(e) => setLimit(Number(e.target.value))} className="h-7 rounded-md border border-input bg-background px-1.5 font-mono text-[11px]">
            <option value="100">100</option>
            <option value="250">250</option>
            <option value="500">500</option>
            <option value="1000">1000</option>
          </select>

          <button type="button" onClick={onRefresh} title="Refresh" className="inline-flex size-7 items-center justify-center rounded-md border border-border bg-background text-muted-foreground hover:bg-accent hover:text-foreground">
            <span className={`text-xs ${isRefreshing ? "animate-spin" : ""}`}>↻</span>
          </button>
        </div>

        {/* Stable meta line — fixed height, tabular-nums, bar is opacity-only (no layout shift) */}
        <div className="flex h-[28px] items-center gap-2 border-t border-border/60 px-2.5">
          <span className="shrink-0 whitespace-nowrap font-mono text-[11px] tabular-nums text-muted-foreground">
            {isInitialLoading ? (
              <span className="inline-flex items-center gap-1.5">
                <span className="size-2 animate-pulse rounded-full bg-muted-foreground/30" />
                loading
              </span>
            ) : counts ? (
              <>
                <span className="text-foreground tabular-nums">{counts.filtered}</span>
                <span className="mx-1 text-muted-foreground/60">/</span>
                <span className="tabular-nums">{counts.total}</span>
                <span className="ml-1.5 whitespace-nowrap">· {counts.turns} turns</span>
              </>
            ) : (
              <span>—</span>
            )}
          </span>
          <span className="flex-1" />
          {threadMeta ? (
            <span className="hidden shrink-0 whitespace-nowrap items-center gap-1.5 font-mono text-[11px] text-muted-foreground sm:inline-flex">
              <span className={`size-1.5 rounded-full ${threadMeta.status === "active" ? "bg-emerald-500" : threadMeta.status === "idle" ? "bg-zinc-400" : "bg-amber-500"}`} />
              {threadMeta.id.slice(0, 8)} · {threadMeta.status ?? "—"}
            </span>
          ) : (
            <span className="hidden sm:block h-1 w-[96px] shrink-0" aria-hidden />
          )}
          <span className={`ml-1 h-1 w-8 shrink-0 rounded-full bg-foreground/15 transition-opacity duration-300 ${isRefreshing && !isInitialLoading ? "opacity-100 animate-pulse" : "opacity-0"}`} aria-hidden />
        </div>
      </div>

      {/* List — autoscrolls to bottom when follow is on */}
      <div ref={listRef} className="min-h-0 flex-1 overflow-auto divide-y divide-border/40 bg-transparent">
        {isInitialLoading ? (
          // Skeleton — no flicker, keeps layout
          <div className="divide-y divide-border/40">
            {Array.from({ length: 12 }).map((_, i) => (
              <div key={i} className="flex items-center gap-2 px-2.5 py-[9px]">
                <span className="h-3 w-8 animate-pulse rounded bg-muted" />
                <span className="size-[18px] animate-pulse rounded-[4px] bg-muted" />
                <span className="h-3 w-32 animate-pulse rounded bg-muted" />
                <span className="h-3 flex-1 animate-pulse rounded bg-muted/60" />
              </div>
            ))}
          </div>
        ) : filtered.length === 0 ? (
          <div className="px-4 py-10 text-center">
            <div className="text-sm font-medium text-foreground">No events match</div>
            <div className="mt-1 text-xs text-muted-foreground">{events?.length ?? 0} total — try “All” or clear filter.</div>
            <button type="button" onClick={() => { setFilter("all"); setQ(""); }} className="mt-3 rounded-md border border-border bg-background px-3 py-1.5 text-xs font-medium hover:bg-accent">Clear filters</button>
          </div>
        ) : (
          <>
            <div className="divide-y divide-border/30">
              {filtered.map((ev) => (
                <CompactRow key={`${ev.seq}-${ev.id}`} ev={ev} expanded={expanded.has(ev.seq)} onToggle={() => toggle(ev.seq)} />
              ))}
            </div>
            {hasMore ? (
              <div className="border-t border-amber-500/20 bg-amber-500/[0.04] px-3 py-2 text-center font-mono text-[11px] text-amber-700 dark:text-amber-300">
                Showing first {events?.length} — raise limit.
              </div>
            ) : null}
          </>
        )}
      </div>
    </div>
  );
}

// ── Right sidebar panel (primary) ───────────────────────────────────────────

function TrajectoryThreadPanel({ threadId }: { threadId: string }) {
  const rpc = useRpc<typeof rpcContract>();
  const [events, setEvents] = useState<BBEvent[] | null>(null);
  const [threadMeta, setThreadMeta] = useState<ThreadRow | null>(null);
  const [hasMore, setHasMore] = useState(false);
  const [isInitialLoading, setIsInitialLoading] = useState(true);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState<Category>("all");
  const [q, setQ] = useState("");
  const [limit, setLimit] = useState(500);
  const reqIdRef = useRef(0);

  const load = useCallback(
    async (opts?: { silent?: boolean }) => {
      if (!threadId) return;
      const reqId = ++reqIdRef.current;
      const silent = opts?.silent ?? false;
      if (!silent && events === null) setIsInitialLoading(true);
      else if (!silent) setIsRefreshing(true);
      setError(null);
      try {
        const res = await rpc.call("trajectory_get", { threadId, limit, order: "asc" });
        if (reqId !== reqIdRef.current) return;
        const r = res as unknown as { thread: ThreadRow; events: BBEvent[]; hasMore: boolean };
        const nextEvents = (r.events as BBEvent[]) ?? [];
        const nextThread = (r.thread as ThreadRow) ?? null;
        // Avoid re-render flicker when nothing changed (polling)
        const sameEvents =
          events !== null &&
          nextEvents.length === events.length &&
          (nextEvents.length === 0 || nextEvents[nextEvents.length - 1]?.seq === events[events.length - 1]?.seq);
        const sameThread = threadMeta !== null && nextThread !== null && nextThread.id === threadMeta.id && nextThread.status === threadMeta.status;
        if (sameEvents && sameThread) {
          setHasMore(r.hasMore);
        } else {
          setThreadMeta(nextThread);
          setEvents(nextEvents);
          setHasMore(r.hasMore);
        }
      } catch (e) {
        if (reqId !== reqIdRef.current) return;
        setError(e instanceof Error ? e.message : String(e));
        setEvents([]);
      } finally {
        if (reqId !== reqIdRef.current) return;
        setIsInitialLoading(false);
        setIsRefreshing(false);
      }
    },
    [rpc, threadId, limit, events, threadMeta],
  );

  useEffect(() => {
    void load();
  }, [load]);

  // Poll active threads — silent refresh so header count doesn't flicker
  useEffect(() => {
    const iv = setInterval(() => void load({ silent: true }), 5000);
    return () => clearInterval(iv);
  }, [load]);

  useRealtime("trajectory:changed", () => void load({ silent: true }));

  if (!threadId) return <div className="p-4 text-sm text-muted-foreground">No thread.</div>;

  return (
    <div className="flex h-full min-h-0 flex-col bg-transparent">
      {/* Header — matches BB's native panel header: small, no pink */}
      <div className="shrink-0 border-b border-border px-3 py-2.5">
        <div className="flex items-center gap-2">
          <span className="text-xs font-semibold tracking-tight text-foreground">Trajectory</span>
          <span className="rounded bg-muted px-1.5 py-0 font-mono text-[10px] font-medium tracking-widest text-muted-foreground">DEBUG</span>
          <span className="ml-auto font-mono text-[10px] text-muted-foreground">{threadId.slice(0, 12)}</span>
        </div>
        <p className="mt-1 line-clamp-1 text-xs text-muted-foreground">{threadMeta?.title ?? threadMeta?.titleFallback ?? "Full trace — grouped by turn"}</p>
        {error ? <div role="alert" className="mt-2 rounded border border-destructive/20 bg-destructive/5 px-2 py-1 text-xs text-destructive">{error}</div> : null}
      </div>

      <TrajectoryList
        events={events}
        isInitialLoading={isInitialLoading}
        isRefreshing={isRefreshing}
        hasMore={hasMore}
        filter={filter}
        setFilter={setFilter}
        q={q}
        setQ={setQ}
        limit={limit}
        setLimit={setLimit}
        onRefresh={() => void load()}
        threadMeta={threadMeta}
      />
    </div>
  );
}

// ── Left nav — global picker (secondary, same compact list) ─────────────────

function TrajectoryPage() {
  const rpc = useRpc<typeof rpcContract>();
  const [threads, setThreads] = useState<ThreadRow[] | null>(null);
  const [projects, setProjects] = useState<Array<{ id: string; name: string | null }>>([]);
  const [selectedId, setSelectedId] = useState<string>("");
  const [search, setSearch] = useState("");
  const [projectFilter, setProjectFilter] = useState<string>("all");
  const [events, setEvents] = useState<BBEvent[] | null>(null);
  const [threadMeta, setThreadMeta] = useState<ThreadRow | null>(null);
  const [hasMore, setHasMore] = useState(false);
  const [isInitialLoading, setIsInitialLoading] = useState(false);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState<Category>("all");
  const [q, setQ] = useState("");
  const [limit, setLimit] = useState(500);
  const reqIdRef = useRef(0);

  const refreshThreads = useCallback(async () => {
    try {
      const [projRes, threadRes] = await Promise.all([
        rpc.call("trajectory_list_projects", null).catch(() => ({ projects: [] })),
        rpc.call("trajectory_list_threads", {
          projectId: projectFilter !== "all" ? projectFilter : undefined,
          limit: 50,
          search: search.trim() || undefined,
        }),
      ]);
      const projs = (projRes as { projects: Array<{ id: string; name: string | null }> }).projects ?? [];
      setProjects(projs);
      const ths = (threadRes as { threads: ThreadRow[] }).threads ?? [];
      setThreads(ths);
      if (!selectedId && ths.length) setSelectedId(ths[0]!.id);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }, [rpc, projectFilter, search, selectedId]);

  useEffect(() => {
    void refreshThreads();
  }, [refreshThreads]);

  const loadTrajectory = useCallback(
    async (id: string, opts?: { silent?: boolean }) => {
      if (!id) return;
      const reqId = ++reqIdRef.current;
      const silent = opts?.silent ?? false;
      if (!silent && events === null) setIsInitialLoading(true);
      else if (!silent) setIsRefreshing(true);
      setError(null);
      try {
        const res = await rpc.call("trajectory_get", { threadId: id, limit, order: "asc" });
        if (reqId !== reqIdRef.current) return;
        const r = res as unknown as { thread: ThreadRow; events: BBEvent[]; hasMore: boolean };
        const nextEvents = (r.events as BBEvent[]) ?? [];
        const nextThread = (r.thread as ThreadRow) ?? null;
        const sameEvents =
          events !== null &&
          nextEvents.length === events.length &&
          (nextEvents.length === 0 || nextEvents[nextEvents.length - 1]?.seq === events[events.length - 1]?.seq);
        const sameThread = threadMeta !== null && nextThread !== null && nextThread.id === threadMeta.id && nextThread.status === threadMeta.status;
        if (sameEvents && sameThread) {
          setHasMore(r.hasMore);
        } else {
          setThreadMeta(nextThread);
          setEvents(nextEvents);
          setHasMore(r.hasMore);
        }
      } catch (e) {
        if (reqId !== reqIdRef.current) return;
        setError(e instanceof Error ? e.message : String(e));
        setEvents([]);
      } finally {
        if (reqId !== reqIdRef.current) return;
        setIsInitialLoading(false);
        setIsRefreshing(false);
      }
    },
    [rpc, limit, events, threadMeta],
  );

  useEffect(() => {
    if (selectedId) void loadTrajectory(selectedId);
  }, [selectedId, loadTrajectory]);

  useEffect(() => {
    if (!selectedId) return;
    const iv = setInterval(() => void loadTrajectory(selectedId, { silent: true }), 5000);
    return () => clearInterval(iv);
  }, [selectedId, loadTrajectory]);

  useRealtime("trajectory:changed", () => {
    void refreshThreads();
  });

  return (
    <div className="flex h-full min-h-0 flex-col bg-transparent">
      <div className="shrink-0 border-b border-border px-4 py-3">
        <h1 className="text-sm font-semibold tracking-tight text-foreground">Trajectory</h1>
        <p className="mt-1 text-xs text-muted-foreground">Global view — pick a thread. For the current thread, use the right-sidebar Trajectory tab.</p>
      </div>

      <div className="shrink-0 border-b border-border px-3 py-2.5">
        <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
          <select
            value={selectedId}
            onChange={(e) => setSelectedId(e.target.value)}
            className="h-7 min-w-0 flex-1 rounded-md border border-input bg-background px-2 font-mono text-xs"
          >
            {!threads ? <option>Loading…</option> : threads.length === 0 ? <option value="">No threads</option> : null}
            {threads?.map((t) => (
              <option key={t.id} value={t.id}>
                {t.id.slice(0, 12)} · {(t.title ?? t.titleFallback ?? "(untitled)").slice(0, 40)} · {t.status ?? "?"}
                {t.updatedAt ? ` · ${fmtAgo(t.updatedAt)}` : ""}
              </option>
            ))}
          </select>
          <select value={projectFilter} onChange={(e) => setProjectFilter(e.target.value)} className="hidden h-7 rounded-md border border-input bg-background px-2 text-xs sm:block">
            <option value="all">All projects</option>
            {projects.map((p) => (
              <option key={p.id} value={p.id}>{p.name ?? p.id.slice(0, 8)}</option>
            ))}
          </select>
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search threads…"
            className="h-7 w-full rounded-md border border-input bg-background px-2 text-xs placeholder:text-muted-foreground sm:w-40"
          />
        </div>
        {error ? <div role="alert" className="mt-2 rounded border border-destructive/20 bg-destructive/5 px-2 py-1 text-xs text-destructive">{error}</div> : null}
      </div>

      <div className="min-h-0 flex-1 overflow-auto">
        <TrajectoryList
          events={events}
          isInitialLoading={isInitialLoading}
          isRefreshing={isRefreshing}
          hasMore={hasMore}
          filter={filter}
          setFilter={setFilter}
          q={q}
          setQ={setQ}
          limit={limit}
          setLimit={setLimit}
          onRefresh={() => void loadTrajectory(selectedId)}
          threadMeta={threadMeta}
        />
      </div>
    </div>
  );
}

export default definePluginApp((app) => {
  app.slots.threadPanelAction({
    id: "trajectory",
    title: "Trajectory",
    component: TrajectoryThreadPanel as never,
  });
});
