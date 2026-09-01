// bb-plugin-opencode-go-usage — frontend: inject OpenCode Go usage into Settings → Usage limits
// No sidebar navPanel — per user request, show inside the existing usage page.
import { definePluginApp } from "@get-bb/plugin-sdk/app";

// Types must stay in sync with server's WindowUsage
type WindowUsage = {
  key: "rolling" | "weekly" | "monthly";
  label: string;
  windowId: string;
  percent: number;
  status: "ok" | "rate-limited";
  resetsAt: string;
  resetsAtMs: number;
  usedFraction: number;
  remainingFraction: number;
};

type UsageResponse = {
  fetchedAt: string;
  endpoint: string;
  usage: { rolling: WindowUsage; weekly: WindowUsage; monthly: WindowUsage };
  raw: unknown;
};

type OuterRpcWrapper = { result?: unknown };

type RpcOk = { ok: true; data: UsageResponse; cached?: boolean; source?: string };
type RpcErr = { ok: false; error?: string; status?: number; source?: string };
type RpcResponse = RpcOk | RpcErr;

function formatResetsIn(ms: number): string {
  const diff = ms - Date.now();
  if (diff <= 0) return "now";
  const d = Math.floor(diff / 86_400_000);
  const h = Math.floor((diff % 86_400_000) / 3_600_000);
  const m = Math.floor((diff % 3_600_000) / 60_000);
  if (d > 0) return `in ${d}d ${h}h`;
  if (h > 0) return `in ${h}h ${m}m`;
  return `in ${m}m`;
}

async function fetchUsageViaRpc(signal?: AbortSignal): Promise<RpcResponse> {
  const res = await fetch("/api/v1/plugins/opencode-go-usage/rpc/usage_get", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({}),
    signal,
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(text || `RPC ${res.status} ${res.statusText}`);
  }
  const json = (await res.json()) as unknown;
  if (json !== null && typeof json === "object" && "result" in json) {
    const outer: OuterRpcWrapper = json as OuterRpcWrapper;
    if (outer.result !== null && typeof outer.result === "object") return outer.result as RpcResponse;
  }
  return json as RpcResponse;
}

function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  className?: string,
  text?: string,
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

function createProgress(value: number, warning?: boolean, exhausted?: boolean): HTMLDivElement {
  const pct = Math.max(0, Math.min(100, value));
  const outer = el("div", "h-2 w-full overflow-hidden rounded-full bg-muted");
  const inner = el("div", exhausted ? "h-full rounded-full bg-destructive" : warning ? "h-full rounded-full bg-amber-500" : "h-full rounded-full bg-primary");
  inner.style.width = `${pct}%`;
  outer.appendChild(inner);
  return outer;
}

function createWindowRow(w: WindowUsage): HTMLDivElement {
  const exhausted = w.status === "rate-limited" || w.percent >= 100;
  const warning = !exhausted && w.percent >= 80;
  const row = el("div", "space-y-1");
  const labelRow = el("div", "flex items-baseline justify-between gap-2");
  const label = el("span", "text-xs text-foreground", w.label);
  const pctText = el("span", "text-xs tabular-nums text-muted-foreground", `${w.percent.toFixed(1)}% used`);
  if (exhausted) pctText.textContent = `${w.percent.toFixed(1)}% used · rate limited`;
  labelRow.append(label, pctText);
  const progress = createProgress(w.percent, warning, exhausted);
  // Make progress thin like native (h-1.5)
  progress.className = "h-1.5 w-full overflow-hidden rounded-full bg-muted";
  const inner = progress.firstElementChild as HTMLElement;
  if (inner) inner.className = exhausted ? "h-full rounded-full bg-destructive" : warning ? "h-full rounded-full bg-amber-500" : "h-full rounded-full bg-primary";
  const reset = el("p", "text-xs text-muted-foreground", `Resets ${formatResetsIn(w.resetsAtMs)}`);
  row.append(labelRow, progress, reset);
  return row;
}

function renderUsageSection(container: HTMLElement, data: UsageResponse, source?: string, cached?: boolean): void {
  container.replaceChildren();

  const headerRow = el("div", "mb-3 flex items-start justify-between gap-2");
  const titleBlock = el("div", "flex-1 min-w-0");
  const heading = el("h3", "text-sm font-semibold", "OpenCode Go");
  heading.id = "opencode-go-heading";
  const subtitle = el("p", "mt-1 text-xs text-muted-foreground");
  subtitle.textContent = source ? `via ${source}` : "via pi auth.json / plugin settings";
  const meta = el("p", "mt-1 text-xs text-muted-foreground");
  meta.textContent = `Fetched ${new Date(data.fetchedAt).toLocaleString()}${cached ? " · cached (60s)" : ""} · ${data.endpoint}`;
  titleBlock.append(heading, subtitle, meta);

  const refreshBtn = el("button", "inline-flex h-7 shrink-0 items-center gap-1.5 rounded-md border border-input bg-background px-2.5 text-xs font-medium hover:bg-accent hover:text-accent-foreground");
  refreshBtn.type = "button";
  refreshBtn.textContent = "Refresh";
  refreshBtn.addEventListener("click", () => {
    container.replaceChildren(el("p", "text-sm text-muted-foreground p-4", "Refreshing…"));
    void refreshAndRender(container);
  });

  headerRow.append(titleBlock, refreshBtn);

  // Windows like native provider sections (pl-6, space-y-3.5)
  const windowsWrap = el("div", "pl-6");
  const windowsInner = el("div", "space-y-3.5");
  windowsInner.append(createWindowRow(data.usage.rolling), createWindowRow(data.usage.weekly), createWindowRow(data.usage.monthly));
  windowsWrap.appendChild(windowsInner);

  const footer = el("div", "mt-3 pl-6 text-xs text-muted-foreground");
  footer.textContent = cached ? "Cached (60s)" : "";

  container.append(headerRow, windowsWrap, footer);
}

function renderError(container: HTMLElement, message: string, source?: string): void {
  container.replaceChildren();
  const heading = el("h3", "text-sm font-semibold", "OpenCode Go");
  const err = el("p", "mt-2 rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-xs text-destructive");
  err.textContent = message + (source ? ` [${source}]` : "");
  const hint = el("p", "mt-2 text-xs text-muted-foreground");
  hint.textContent = "Set key: bb plugin config opencode-go-usage set apiKey <key> — or /login opencode-go in pi — then reload plugin.";
  container.append(heading, err, hint);
}

function renderLoading(container: HTMLElement): void {
  container.replaceChildren(el("p", "text-sm text-muted-foreground p-2", "Loading OpenCode Go usage…"));
}

async function refreshAndRender(container: HTMLElement, signal?: AbortSignal): Promise<void> {
  renderLoading(container);
  try {
    const rpc = await fetchUsageViaRpc(signal);
    if (!rpc.ok) {
      renderError(container, rpc.error ?? "Failed to fetch usage", rpc.source);
      return;
    }
    if (rpc.data) renderUsageSection(container, rpc.data, rpc.source, rpc.cached);
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    renderError(container, msg);
  }
}

function findUsageLimitsContainer(): HTMLElement | null {
  const headings = Array.from(document.querySelectorAll("h2"));
  const usageHeading = headings.find((h) => h.textContent?.trim() === "Usage limits");
  if (!usageHeading) return null;
  // Provider list is the .divide-y element near the heading
  const card = usageHeading.closest("section")?.parentElement as HTMLElement | null;
  // The card contains <div class="divide-y divide-border">
  const divide = card?.querySelector("div.divide-y") as HTMLElement | null;
  if (divide) return divide;
  // Fallback: search whole doc
  const anyDivide = document.querySelector("div.divide-y.divide-border") as HTMLElement | null;
  if (anyDivide) return anyDivide;
  return usageHeading.closest("main") as HTMLElement | null;
}

function findOrCreateInjectionTarget(container: HTMLElement): HTMLElement {
  const existing = document.getElementById("opencode-go-usage-injected");
  if (existing) return existing as HTMLElement;

  // Create a new section matching native provider sections (py-3.5, border split via parent divide-y)
  const section = document.createElement("section");
  section.id = "opencode-go-usage-injected";
  section.className = "space-y-3.5 py-3.5 first:pt-0 last:pb-0";
  section.setAttribute("aria-labelledby", "opencode-go-heading");

  // If container is the divide-y, append as last provider section
  if (container.classList.contains("divide-y")) {
    container.appendChild(section);
  } else {
    // Fallback: insert after heading
    const heading = container.querySelector("h2");
    heading?.insertAdjacentElement("afterend", section);
    if (!section.parentElement) container.appendChild(section);
  }
  return section;
}

function isUsageLimitsRoute(): boolean {
  return window.location.pathname === "/settings/usage" || window.location.pathname.startsWith("/settings/usage");
}

export default definePluginApp((app) => {
  // No navPanel — inject into existing Settings → Usage limits page via content script
  app.contentScripts.register({
    id: "usage-limits",
    mount(context) {
      let target: HTMLElement | null = null;
      let pollTimer: number | null = null;
      let observer: MutationObserver | null = null;
      let refreshTimer: number | null = null;
      const abort = new AbortController();
      context.signal.addEventListener("abort", () => abort.abort(), { once: true });

      const ensureInjected = () => {
        if (!isUsageLimitsRoute()) {
          const stale = document.getElementById("opencode-go-usage-injected");
          if (stale) stale.remove();
          target = null;
          return;
        }
        const container = findUsageLimitsContainer();
        if (!container) return;
        if (!document.getElementById("opencode-go-usage-injected")) {
          target = findOrCreateInjectionTarget(container);
          void refreshAndRender(target, abort.signal);
          // Auto-refresh every 60s while on page
          if (refreshTimer !== null) window.clearInterval(refreshTimer);
          refreshTimer = window.setInterval(() => {
            const live = document.getElementById("opencode-go-usage-injected") as HTMLElement | null;
            if (live && isUsageLimitsRoute()) void refreshAndRender(live, abort.signal);
          }, 60_000);
        } else {
          target = document.getElementById("opencode-go-usage-injected") as HTMLElement;
        }
      };

      // Initial check + poll for SPA navigation
      ensureInjected();
      pollTimer = window.setInterval(ensureInjected, 1000);

      // Observe DOM for heading appearance (SPA transitions)
      observer = new MutationObserver(() => ensureInjected());
      observer.observe(document.body, { childList: true, subtree: true });

      // Also listen to popstate/pushState
      const onNav = () => window.setTimeout(ensureInjected, 100);
      window.addEventListener("popstate", onNav);
      // Patch pushState to catch programmatic navigations
      const origPush = history.pushState.bind(history);
      history.pushState = (...args: Parameters<typeof history.pushState>) => {
        const ret = origPush(...args);
        onNav();
        return ret;
      };

      return () => {
        if (pollTimer !== null) window.clearInterval(pollTimer);
        if (refreshTimer !== null) window.clearInterval(refreshTimer);
        observer?.disconnect();
        window.removeEventListener("popstate", onNav);
        history.pushState = origPush;
        document.getElementById("opencode-go-usage-injected")?.remove();
        abort.abort();
      };
    },
  });
});
