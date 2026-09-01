// bb-plugin-reasoning-split — reasoning level as a fully separate dropdown beside the model picker.
//
// Before: single combined picker "Claude Opus 4.5 · High" triggered model+reasoning popover.
// After:  [ Claude Opus 4.5 ▾ ]  |  [ High ▾ ]  |  Build | Full access
// The new reasoning button has its own popover listing only reasoning levels.
// Selecting there updates the host via the same path as the native picker —
// but without ever opening the model picker UI.

import { definePluginApp } from "@get-bb/plugin-sdk/app";

const STYLE_ID = "reasoning-split-style";
const PROCESSED = "data-reasoning-split";
const REASONING_BTN = "data-reasoning-split-btn";
const POPOVER_ID = "reasoning-split-popover";

function injectStyle() {
  if (document.getElementById(STYLE_ID)) return;
  const s = document.createElement("style");
  s.id = STYLE_ID;
  s.textContent = `
    button[${PROCESSED}] [data-promptbox-hide-compact] { display: none !important; }
    .reasoning-split-sep {
      width: 1px;
      height: 18px;
      align-self: center;
      background: var(--border);
      opacity: 0.9;
      flex-shrink: 0;
    }
    button[${REASONING_BTN}] { white-space: nowrap; }
    #${POPOVER_ID} {
      position: fixed;
      z-index: 9999;
      min-width: 180px;
      max-width: 260px;
      background: var(--popover, #ffffff);
      color: var(--popover-foreground, var(--foreground));
      border: 1px solid var(--border);
      border-radius: 0.5rem;
      box-shadow: 0 8px 24px rgba(0,0,0,0.12), 0 2px 8px rgba(0,0,0,0.08);
      padding: 4px;
      display: none;
    }
    #${POPOVER_ID}[data-open="true"] { display: block; }
    .reasoning-split-opt {
      display: flex;
      width: 100%;
      align-items: center;
      justify-content: space-between;
      gap: 8px;
      padding: 6px 8px;
      border-radius: 6px;
      font-size: 12px;
      line-height: 1;
      text-align: left;
      cursor: pointer;
      border: 0;
      background: transparent;
      color: var(--foreground);
    }
    .reasoning-split-opt:hover { background: var(--accent); }
    .reasoning-split-opt[data-selected="true"] {
      background: var(--accent);
      font-weight: 500;
    }
    .reasoning-split-opt[disabled] { opacity: 0.5; pointer-events: none; }
    .reasoning-split-check { width: 14px; height: 14px; flex-shrink: 0; }
    .reasoning-split-empty {
      padding: 12px 8px;
      font-size: 12px;
      color: var(--muted-foreground);
      text-align: center;
    }
    /* ── Model picker: limit height, rely on search ──────────────────────── */
    /* Host popover is Radix; our reasoning popover is not in Radix portal so it is not affected */
    [data-radix-popper-content-wrapper] [role="listbox"],
    [data-radix-popper-content-wrapper] div[role="listbox"] {
      max-height: 224px !important;
      overflow-y: auto !important;
      overscroll-behavior: contain;
    }
    /* Fallback for hosts that render list without explicit role */
    [data-radix-popper-content-wrapper] .min-h-0.flex-1.overflow-y-auto {
      max-height: 224px !important;
    }
    /* Cap the whole popover so it never fills screen */
    [data-radix-popper-content-wrapper] > div {
      max-height: min(68vh, 420px) !important;
    }
  `;
  document.head.appendChild(s);
}

function sleep(ms: number) {
  return new Promise<void>((r) => window.setTimeout(r, ms));
}

function getReasoningText(trigger: HTMLElement): string {
  const span = trigger.querySelector<HTMLElement>("[data-promptbox-hide-compact]");
  if (span) {
    const t = span.textContent?.trim();
    if (t && t.length > 0 && t.length < 40) return t;
  }
  const titleEl = trigger.querySelector<HTMLElement>("span[title]");
  const title = titleEl?.getAttribute("title") ?? trigger.getAttribute("title") ?? "";
  const m = title.match(/·\s*([^·]+?)\s+reasoning/i);
  if (m) return m[1].trim();
  return "";
}

// ── Fiber helpers — try to get reasoning without opening host popover ──────
function getFiber(el: HTMLElement): unknown | null {
  for (const k of Object.keys(el)) {
    if (k.startsWith("__reactFiber$")) return (el as unknown as Record<string, unknown>)[k];
  }
  // also check __reactProps
  return null;
}

type ReasoningData = { value: string; options: Array<{ value: string; label: string }>; onChange: (v: string) => void };

function findReasoningFromFiber(trigger: HTMLElement): ReasoningData | null {
  const fiberKey = Object.keys(trigger).find((k) => k.startsWith("__reactFiber$"));
  if (!fiberKey) return null;
  let fiber: unknown = (trigger as unknown as Record<string, unknown>)[fiberKey] as unknown;
  for (let i = 0; i < 45 && fiber; i++) {
    const f = fiber as Record<string, unknown>;
    const props = (f["memoizedProps"] ?? f["pendingProps"]) as Record<string, unknown> | null;
    const stateNode = f["stateNode"] as Record<string, unknown> | null;
    const candidates: Array<Record<string, unknown>> = [];
    if (props) candidates.push(props);
    if (stateNode && typeof stateNode === "object" && "props" in stateNode) {
      const sp = (stateNode["props"] as Record<string, unknown> | null);
      if (sp) candidates.push(sp);
    }
    for (const p of candidates) {
      // Direct reasoning prop (custom popover internal)
      if (p["reasoning"] && typeof p["reasoning"] === "object") {
        const r = p["reasoning"] as Record<string, unknown>;
        if (Array.isArray(r["options"]) && typeof r["onChange"] === "function") {
          return r as unknown as ReasoningData;
        }
      }
      if (p["execution"] && typeof p["execution"] === "object") {
        const ex = p["execution"] as Record<string, unknown>;
        const r = ex["reasoning"] as Record<string, unknown> | undefined;
        if (r && Array.isArray(r["options"]) && typeof r["onChange"] === "function") {
          return r as unknown as ReasoningData;
        }
      }
      // Alternative naming from host
      if (Array.isArray(p["reasoningOptions"]) && typeof p["onReasoningChange"] === "function") {
        return {
          value: (p["reasoningValue"] as string) ?? (p["value"] as string) ?? "",
          options: p["reasoningOptions"] as Array<{ value: string; label: string }>,
          onChange: p["onReasoningChange"] as (v: string) => void,
        };
      }
    }
    fiber = f["return"] as unknown;
  }
  return null;
}

const HOST_HIDE_STYLE_ID = "reasoning-split-host-hide";
function injectHostHide() {
  if (document.getElementById(HOST_HIDE_STYLE_ID)) return;
  const s = document.createElement("style");
  s.id = HOST_HIDE_STYLE_ID;
  // Hide any Radix popover while we scrape — our custom popover is not in Radix portal so it stays visible
  s.textContent = `
    [data-radix-popper-content-wrapper], [data-radix-portal] [data-state="open"], [role="dialog"][data-state="open"] {
      visibility: hidden !important;
      opacity: 0 !important;
      pointer-events: none !important;
    }
  `;
  document.head.appendChild(s);
}
function removeHostHide() {
  document.getElementById(HOST_HIDE_STYLE_ID)?.remove();
}

// ── Host popover helpers ───────────────────────────────────────────────

function isHostPopoverOpen(): HTMLElement | null {
  return (
    (document.querySelector<HTMLElement>("[data-radix-popper-content-wrapper]")) ??
    (document.querySelector<HTMLElement>("[role='dialog'][data-state='open']")) ??
    (document.querySelector<HTMLElement>("[data-radix-portal] [data-state='open']"))
  );
}

function waitForPopover(open: boolean, timeout = 1500): Promise<HTMLElement | null> {
  return new Promise((resolve) => {
    const start = Date.now();
    const tick = () => {
      const el = isHostPopoverOpen();
      if (open ? el : !el) return resolve(el);
      if (Date.now() - start > timeout) return resolve(isHostPopoverOpen());
      window.requestAnimationFrame(tick);
    };
    tick();
  });
}

function findReasoningContainer(popover: HTMLElement): HTMLElement | null {
  // Find the "Reasoning" header inside popover. Header is rendered via kc({children:"Reasoning"})
  // It is a sticky div with text "Reasoning". Search inside popover.
  const candidates = Array.from(popover.querySelectorAll<HTMLElement>("*")).filter(
    (el) => el.textContent?.trim() === "Reasoning" && el.childNodes.length === 1
  );
  // Also check inside document if popover is portal outside wrapper
  const header =
    candidates.find((el) => popover.contains(el)) ??
    Array.from(document.querySelectorAll<HTMLElement>("*")).find(
      (el) => el.textContent?.trim() === "Reasoning" && el.closest("[data-radix-popper-content-wrapper], [role='dialog']")
    ) ??
    null;
  if (!header) return null;
  // container is the px-1 div that holds header + buttons
  // In bundle: div px-1 pb-1 pt-0 > kc(Reasoning) + nt.map(Fc)
  const container = header.closest<HTMLElement>("div");
  if (!container) return null;
  // container's parent holds header+buttons; buttons are inside container
  // If container only holds header, go one up
  let target: HTMLElement | null = container;
  // Ensure target contains buttons: check for button children
  if (target.querySelectorAll("button").length === 0) {
    target = target.parentElement as HTMLElement | null;
  }
  return target;
}

function extractReasoningOptions(popover: HTMLElement): Array<{ label: string; selected: boolean }> {
  const container = findReasoningContainer(popover);
  if (!container) return [];
  const buttons = Array.from(container.querySelectorAll<HTMLButtonElement>("button"));
  // Filter to reasoning buttons only: they are direct children after header, not provider tabs (those are above)
  // Provider tabs are in a different container with border-b. Reasoning container is after model list.
  // So buttons in reasoning container are exactly reasoning options.
  const opts: Array<{ label: string; selected: boolean }> = [];
  for (const b of buttons) {
    // Skip "More models" / provider tabs which shouldn't be in this container
    const label = (b.getAttribute("aria-label") ?? b.textContent ?? "").trim().split("\n")[0].trim();
    // Real label is like "High", "Medium" — filter out empty / too long
    if (!label || label.length > 30) continue;
    // Skip buttons that are actually model toggles (have qualifier like provider id) — but reasoning labels are single word
    // Use a allowlist-ish check: reasoning labels are Low, Medium, High, Max, Ultra, XHigh, etc. But be permissive.
    // Detect selected: host marks selected via class bg-state-active/border-foreground or aria-selected
    const isSelected =
      b.getAttribute("data-selected") === "true" ||
      b.getAttribute("aria-selected") === "true" ||
      b.getAttribute("aria-current") === "true" ||
      b.className.includes("bg-state-active") ||
      b.className.includes("border-foreground") ||
      b.className.includes("bg-accent") && b.textContent?.trim() === label;
    // Fallback: check if button contains check icon
    const hasCheck = b.querySelector<HTMLElement>("[data-selected], svg");
    // Heuristic: if button appears selected via parent state, we can also infer via current reasoning text
    opts.push({ label, selected: Boolean(isSelected) });
  }
  // Filter duplicates and ensure we have at least plausible reasoning labels
  const seen = new Set<string>();
  const dedup: typeof opts = [];
  for (const o of opts) {
    const key = o.label.toLowerCase();
    if (seen.has(key)) continue;
    // Only keep plausible reasoning labels (avoid "More models", "Fewer models")
    if (/^(more|fewer) models$/i.test(o.label)) continue;
    seen.add(key);
    dedup.push(o);
  }
  return dedup;
}

async function openHostHidden(trigger: HTMLElement): Promise<HTMLElement | null> {
  if (isHostPopoverOpen()) {
    trigger.click();
    await waitForPopover(false, 600);
    await sleep(50);
  }
  injectHostHide();
  trigger.click();
  const pop = await waitForPopover(true, 1200);
  if (!pop) {
    removeHostHide();
    return null;
  }
  // keep hidden via global style; also hide via inline for extra safety
  await sleep(40);
  return pop;
}

function restoreHostHidden() {
  removeHostHide();
}

async function closeHost(trigger: HTMLElement) {
  if (!isHostPopoverOpen()) {
    removeHostHide();
    return;
  }
  document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", code: "Escape", bubbles: true }));
  await sleep(40);
  if (isHostPopoverOpen()) {
    trigger.click();
    await waitForPopover(false, 700);
  }
  removeHostHide();
  await sleep(30);
  // Ensure any leftover hidden style removed
  removeHostHide();
}

async function fetchHostReasoningOptions(trigger: HTMLElement): Promise<Array<{ label: string; selected: boolean; value: string }>> {
  // First try fiber — no host popover flash at all
  const fiberData = findReasoningFromFiber(trigger);
  if (fiberData && Array.isArray(fiberData.options) && fiberData.options.length > 0) {
    const cur = fiberData.value ?? getReasoningText(trigger);
    return fiberData.options.map((o) => ({
      label: o.label,
      value: o.value,
      selected: o.value === cur || o.label.toLowerCase() === cur.toLowerCase(),
    }));
  }
  // Fallback: scrape host popover hidden
  const pop = await openHostHidden(trigger);
  if (!pop) return [];
  await sleep(80);
  const actual = (document.querySelector<HTMLElement>("[data-radix-popper-content-wrapper]") ??
    document.querySelector<HTMLElement>("[role='dialog'][data-state='open']") ??
    pop) as HTMLElement;
  const portalContent = document.querySelector<HTMLElement>("[data-radix-portal]") ?? actual;
  const raw = extractReasoningOptions(portalContent);
  await closeHost(trigger);
  if (raw.length === 0) {
    const cur = getReasoningText(trigger);
    if (cur) return [{ label: cur, value: cur.toLowerCase().replace(/\s+/g, "-"), selected: true }];
  }
  const cur = getReasoningText(trigger);
  if (cur && raw.every((o) => !o.selected)) {
    for (const o of raw) if (o.label.toLowerCase() === cur.toLowerCase()) o.selected = true;
  }
  // raw has no value; infer from label
  return raw.map((o) => ({ label: o.label, value: o.label.toLowerCase().replace(/\s+/g, "-"), selected: o.selected }));
}

async function applyHostReasoning(trigger: HTMLElement, targetLabel: string, targetValue?: string): Promise<boolean> {
  // Try fiber onChange first — instant, no popover flash
  const fiberData = findReasoningFromFiber(trigger);
  if (fiberData && typeof fiberData.onChange === "function") {
    const opt = fiberData.options.find((o) => o.label.toLowerCase() === targetLabel.toLowerCase() || (targetValue && o.value === targetValue));
    const value = opt?.value ?? targetValue ?? targetLabel.toLowerCase().replace(/\s+/g, "-");
    try {
      fiberData.onChange(value);
      await sleep(30);
      return true;
    } catch {}
  }
  // Fallback: hidden host click
  const pop = await openHostHidden(trigger);
  if (!pop) return false;
  await sleep(80);
  const portal = (document.querySelector<HTMLElement>("[data-radix-portal]") ??
    document.querySelector<HTMLElement>("[data-radix-popper-content-wrapper]") ??
    pop) as HTMLElement;
  const container = findReasoningContainer(portal);
  if (!container) {
    await closeHost(trigger);
    return false;
  }
  const buttons = Array.from(container.querySelectorAll<HTMLButtonElement>("button"));
  let target: HTMLButtonElement | null = null;
  for (const b of buttons) {
    const label = (b.textContent ?? "").trim().split("\n")[0].trim();
    if (label.toLowerCase() === targetLabel.toLowerCase()) {
      target = b;
      break;
    }
  }
  if (!target) {
    await closeHost(trigger);
    return false;
  }
  // Need to make host visible for click to register (hidden pointer-events none blocks)
  removeHostHide();
  await sleep(10);
  target.click();
  await sleep(120);
  if (isHostPopoverOpen()) await closeHost(trigger);
  else removeHostHide();
  return true;
}

// ── Custom popover singleton ────────────────────────────────────────────

let singleton: HTMLElement | null = null;
let currentTrigger: HTMLElement | null = null;
let outsideHandler: ((e: MouseEvent) => void) | null = null;
let escHandler: ((e: KeyboardEvent) => void) | null = null;

function getPopover(): HTMLElement {
  if (singleton && document.contains(singleton)) return singleton;
  const el = document.createElement("div");
  el.id = POPOVER_ID;
  el.setAttribute("role", "dialog");
  el.setAttribute("aria-label", "Reasoning level");
  document.body.appendChild(el);
  singleton = el;
  return el;
}

function positionPopover(btn: HTMLElement, pop: HTMLElement) {
  const rect = btn.getBoundingClientRect();
  const popRect = pop.getBoundingClientRect();
  const gap = 6;
  let top = rect.bottom + gap;
  let left = rect.left;
  // Keep in viewport
  const vw = window.innerWidth;
  const vh = window.innerHeight;
  if (left + popRect.width > vw - 8) left = Math.max(8, vw - popRect.width - 8);
  if (top + popRect.height > vh - 8) top = Math.max(8, rect.top - popRect.height - gap);
  pop.style.top = `${Math.round(top)}px`;
  pop.style.left = `${Math.round(left)}px`;
}

function hidePopover() {
  const pop = singleton;
  if (!pop) return;
  pop.setAttribute("data-open", "false");
  pop.style.display = "none";
  currentTrigger = null;
  if (outsideHandler) {
    document.removeEventListener("mousedown", outsideHandler, true);
    outsideHandler = null;
  }
  if (escHandler) {
    document.removeEventListener("keydown", escHandler, true);
    escHandler = null;
  }
}

async function showPopover(btn: HTMLElement, trigger: HTMLElement) {
  const pop = getPopover();
  currentTrigger = trigger;

  // Loading state
  pop.innerHTML = '<div class="reasoning-split-empty">Loading…</div>';
  pop.setAttribute("data-open", "true");
  pop.style.display = "block";
  positionPopover(btn, pop);

  let opts: Array<{ label: string; selected: boolean; value: string }> = [];
  try {
    opts = await fetchHostReasoningOptions(trigger);
  } catch {
    opts = [];
  }

  if (!document.contains(pop) || currentTrigger !== trigger) return;

  if (opts.length === 0) {
    const cur = getReasoningText(trigger);
    if (cur) opts = [{ label: cur, value: cur.toLowerCase().replace(/\s+/g, "-"), selected: true }];
    else {
      pop.innerHTML = '<div class="reasoning-split-empty">No reasoning levels for this model</div>';
      positionPopover(btn, pop);
      return;
    }
  }

  pop.replaceChildren();
  for (const o of opts) {
    const b = document.createElement("button");
    b.type = "button";
    b.className = "reasoning-split-opt";
    b.setAttribute("data-selected", String(o.selected));
    b.textContent = o.label;
    if (o.selected) {
      const check = document.createElement("span");
      check.className = "reasoning-split-check";
      check.textContent = "✓";
      check.setAttribute("aria-hidden", "true");
      b.appendChild(check);
    }
    b.addEventListener("click", async (e) => {
      e.preventDefault();
      e.stopPropagation();
      // Optimistic update
      const labelEl = (btn.querySelector("span") as HTMLElement | null) ?? btn;
      // Don't hide immediately — apply
      b.style.opacity = "0.6";
      b.setAttribute("disabled", "true");
      const ok = await applyHostReasoning(trigger, o.label, o.value);
      if (ok) {
        // Update button label optimistically; host observer will also sync
        const span = btn.querySelector<HTMLElement>("span");
        if (span) span.textContent = o.label;
      }
      hidePopover();
      b.removeAttribute("disabled");
      b.style.opacity = "";
    });
    pop.appendChild(b);
  }
  positionPopover(btn, pop);

  // Outside click / Esc
  if (outsideHandler) document.removeEventListener("mousedown", outsideHandler, true);
  outsideHandler = (e: MouseEvent) => {
    const t = e.target as HTMLElement;
    if (pop.contains(t) || btn.contains(t)) return;
    // Also ignore clicks inside host popover (should be closed)
    if (t.closest("[data-radix-popper-content-wrapper], [data-radix-portal]")) return;
    hidePopover();
  };
  // Delay to avoid immediate close from the opening click
  window.setTimeout(() => document.addEventListener("mousedown", outsideHandler!, true), 0);

  if (escHandler) document.removeEventListener("keydown", escHandler, true);
  escHandler = (e: KeyboardEvent) => {
    if (e.key === "Escape") {
      e.stopPropagation();
      hidePopover();
    }
  };
  document.addEventListener("keydown", escHandler, true);

  // Reposition on scroll/resize
  const onReposition = () => {
    if (pop.getAttribute("data-open") === "true" && currentTrigger === trigger) positionPopover(btn, pop);
  };
  window.addEventListener("scroll", onReposition, true);
  window.addEventListener("resize", onReposition);
  const mo = new MutationObserver(onReposition);
  mo.observe(document.body, { attributes: true, subtree: true });
  const cleanup = () => {
    window.removeEventListener("scroll", onReposition, true);
    window.removeEventListener("resize", onReposition);
    mo.disconnect();
  };
  // Auto cleanup when hidden
  const origHide = hidePopover;
  const wrappedHide = () => {
    cleanup();
    origHide();
  };
  // Replace for this session (simple)
  (pop as unknown as { __cleanup?: () => void }).__cleanup = cleanup;
}

// ── Trigger processing ─────────────────────────────────────────────────

function getReasoningTextForSync(trigger: HTMLElement): string {
  return getReasoningText(trigger);
}

function createReasoningButton(trigger: HTMLElement): {
  btn: HTMLButtonElement;
  label: HTMLSpanElement;
  sepBefore: HTMLDivElement;
  sepAfter: HTMLDivElement;
} {
  const btn = document.createElement("button");
  btn.type = "button";
  btn.setAttribute(REASONING_BTN, "true");
  btn.className = trigger.className;
  btn.setAttribute("aria-label", "Reasoning level");
  btn.setAttribute("aria-haspopup", "dialog");
  btn.setAttribute("aria-expanded", "false");

  const label = document.createElement("span");
  label.className = "min-w-0 truncate";
  label.textContent = getReasoningText(trigger) || "Medium";
  btn.appendChild(label);

  const chev = document.createElement("span");
  chev.setAttribute("aria-hidden", "true");
  chev.className = "ml-0.5 inline-flex shrink-0 items-center justify-center text-muted-foreground";
  chev.style.fontSize = "12px";
  chev.style.lineHeight = "1";
  chev.textContent = "▾";
  const hostChev = trigger.querySelector<HTMLElement>("svg");
  if (hostChev) {
    try {
      const clone = hostChev.cloneNode(true) as HTMLElement;
      chev.textContent = "";
      chev.appendChild(clone);
      (clone as HTMLElement).style.width = "14px";
      (clone as HTMLElement).style.height = "14px";
      clone.classList.add("text-muted-foreground");
    } catch {}
  }
  btn.appendChild(chev);

  const sepBefore = document.createElement("div");
  sepBefore.className = "reasoning-split-sep";
  sepBefore.setAttribute("aria-hidden", "true");

  const sepAfter = document.createElement("div");
  sepAfter.className = "reasoning-split-sep";
  sepAfter.setAttribute("aria-hidden", "true");

  return { btn, label, sepBefore, sepAfter };
}

function processTrigger(trigger: HTMLElement) {
  if (trigger.hasAttribute(PROCESSED)) return;
  trigger.setAttribute(PROCESSED, "true");

  const hiddenSpan = trigger.querySelector<HTMLElement>("[data-promptbox-hide-compact]");
  if (hiddenSpan) hiddenSpan.style.display = "none";

  const { btn, label, sepBefore, sepAfter } = createReasoningButton(trigger);

  trigger.insertAdjacentElement("afterend", sepBefore);
  sepBefore.insertAdjacentElement("afterend", btn);
  const next = btn.nextElementSibling;
  if (next && !next.classList.contains("reasoning-split-sep")) {
    btn.insertAdjacentElement("afterend", sepAfter);
  } else if (!next) {
    sepAfter.remove();
  }

  const onClick = async (e: MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    const pop = getPopover();
    const isOpenForThisBtn = pop.getAttribute("data-open") === "true" && currentTrigger === trigger;
    if (isOpenForThisBtn) {
      hidePopover();
      btn.setAttribute("aria-expanded", "false");
      return;
    }
    btn.setAttribute("aria-expanded", "true");
    await showPopover(btn, trigger);
    // aria-expanded will be reset on hide
    const obs = new MutationObserver(() => {
      if (pop.getAttribute("data-open") !== "true") {
        btn.setAttribute("aria-expanded", "false");
        obs.disconnect();
      }
    });
    obs.observe(pop, { attributes: true, attributeFilter: ["data-open"] });
  };
  btn.addEventListener("click", onClick);

  const sync = () => {
    const t = getReasoningTextForSync(trigger);
    if (t) label.textContent = t;
    const title = trigger.querySelector<HTMLElement>("span[title]")?.getAttribute("title") ?? "";
    const hasReasoning = Boolean(t) || title.toLowerCase().includes("reasoning");
    const isLoading = trigger.querySelector("[data-model-loading-placeholder]");
    if (!hasReasoning && !isLoading) {
      const hide = !t;
      btn.style.display = hide ? "none" : "";
      sepBefore.style.display = hide ? "none" : "";
      sepAfter.style.display = hide ? "none" : "";
    } else {
      btn.style.display = "";
      sepBefore.style.display = "";
      if (sepAfter.parentElement) sepAfter.style.display = "";
    }
  };

  const mo = new MutationObserver(sync);
  mo.observe(trigger, { childList: true, subtree: true, characterData: true, attributes: true, attributeFilter: ["title", "aria-label"] });
  const titleSpan = trigger.querySelector("span[title]");
  if (titleSpan) mo.observe(titleSpan, { attributes: true, attributeFilter: ["title"] });
  sync();

  (btn as unknown as { __mo?: MutationObserver; __onClick?: (e: MouseEvent) => void }).__mo = mo;
  (btn as unknown as { __onClick?: (e: MouseEvent) => void }).__onClick = onClick;
  (trigger as unknown as { __reasoningBtn?: HTMLButtonElement }).__reasoningBtn = btn;
  (trigger as unknown as { __sepBefore?: HTMLDivElement }).__sepBefore = sepBefore;
  (trigger as unknown as { __sepAfter?: HTMLDivElement }).__sepAfter = sepAfter;
}

function unprocessTrigger(trigger: HTMLElement) {
  const btn = (trigger as unknown as { __reasoningBtn?: HTMLButtonElement }).__reasoningBtn;
  const sepBefore = (trigger as unknown as { __sepBefore?: HTMLDivElement }).__sepBefore;
  const sepAfter = (trigger as unknown as { __sepAfter?: HTMLDivElement }).__sepAfter;
  const mo = (btn as unknown as { __mo?: MutationObserver } | undefined)?.__mo;
  mo?.disconnect();
  if (btn) {
    const onClick = (btn as unknown as { __onClick?: (e: MouseEvent) => void }).__onClick;
    if (onClick) btn.removeEventListener("click", onClick);
  }
  // If this trigger's popover is open, close it
  if (currentTrigger === trigger) hidePopover();
  btn?.remove();
  sepBefore?.remove();
  sepAfter?.remove();
  trigger.removeAttribute(PROCESSED);
  const hidden = trigger.querySelector<HTMLElement>("[data-promptbox-hide-compact]");
  if (hidden) hidden.style.display = "";
  delete (trigger as unknown as { __reasoningBtn?: unknown }).__reasoningBtn;
  delete (trigger as unknown as { __sepBefore?: unknown }).__sepBefore;
  delete (trigger as unknown as { __sepAfter?: unknown }).__sepAfter;
}

function scan() {
  injectStyle();
  const triggers = Array.from(document.querySelectorAll<HTMLElement>('button[aria-label^="Provider, model and reasoning"]'));
  for (const t of triggers) {
    if (!document.contains(t)) continue;
    processTrigger(t);
  }
  const orphaned = Array.from(document.querySelectorAll<HTMLElement>(`button[${REASONING_BTN}]`));
  for (const b of orphaned) {
    const prev = b.previousElementSibling as HTMLElement | null;
    const isSep = prev?.classList.contains("reasoning-split-sep");
    const trigger = isSep ? (prev?.previousElementSibling as HTMLElement | null) : prev;
    if (!trigger || !trigger.hasAttribute(PROCESSED) || !document.contains(trigger)) {
      const mo = (b as unknown as { __mo?: MutationObserver }).__mo;
      mo?.disconnect();
      const sepBefore = b.previousElementSibling?.classList.contains("reasoning-split-sep") ? (b.previousElementSibling as HTMLElement) : null;
      const sepAfter = b.nextElementSibling?.classList.contains("reasoning-split-sep") ? (b.nextElementSibling as HTMLElement) : null;
      if (currentTrigger && b === (currentTrigger as unknown as { __reasoningBtn?: HTMLButtonElement }).__reasoningBtn) hidePopover();
      b.remove();
      sepBefore?.remove();
      sepAfter?.remove();
    }
  }
}

export default definePluginApp((app) => {
  app.contentScripts.register({
    id: "reasoning-split",
    mount(context) {
      injectStyle();
      scan();
      const interval = window.setInterval(scan, 800);
      const observer = new MutationObserver(() => scan());
      observer.observe(document.body, { childList: true, subtree: true });

      const origPush = history.pushState.bind(history);
      const onNav = () => window.setTimeout(scan, 100);
      history.pushState = (...args: Parameters<typeof history.pushState>) => {
        const ret = origPush(...args);
        onNav();
        return ret;
      };
      window.addEventListener("popstate", onNav);

      const onHideCleanup = () => hidePopover();

      context.signal.addEventListener(
        "abort",
        () => {
          window.clearInterval(interval);
          observer.disconnect();
          window.removeEventListener("popstate", onNav);
          history.pushState = origPush;
          document.getElementById(STYLE_ID)?.remove();
          hidePopover();
          document.getElementById(POPOVER_ID)?.remove();
          singleton = null;
          const processed = Array.from(document.querySelectorAll<HTMLElement>(`button[${PROCESSED}]`));
          for (const t of processed) unprocessTrigger(t);
          for (const b of Array.from(document.querySelectorAll<HTMLElement>(`button[${REASONING_BTN}]`))) {
            const mo = (b as unknown as { __mo?: MutationObserver }).__mo;
            mo?.disconnect();
            b.remove();
          }
          for (const s of Array.from(document.querySelectorAll(".reasoning-split-sep"))) s.remove();
        },
        { once: true }
      );

      // Close popover on navigation
      window.addEventListener("popstate", onHideCleanup);
      const origReplace = history.replaceState.bind(history);
      history.replaceState = (...args: Parameters<typeof history.replaceState>) => {
        const ret = origReplace(...args);
        onHideCleanup();
        return ret;
      };

      return () => {
        window.clearInterval(interval);
        observer.disconnect();
        window.removeEventListener("popstate", onNav);
        window.removeEventListener("popstate", onHideCleanup);
        history.pushState = origPush;
        history.replaceState = origReplace;
        document.getElementById(STYLE_ID)?.remove();
        hidePopover();
        document.getElementById(POPOVER_ID)?.remove();
        singleton = null;
        const processed = Array.from(document.querySelectorAll<HTMLElement>(`button[${PROCESSED}]`));
        for (const t of processed) unprocessTrigger(t);
        for (const b of Array.from(document.querySelectorAll<HTMLElement>(`button[${REASONING_BTN}]`))) {
          const mo = (b as unknown as { __mo?: MutationObserver }).__mo;
          mo?.disconnect();
          b.remove();
        }
        for (const s of Array.from(document.querySelectorAll(".reasoning-split-sep"))) s.remove();
      };
    },
  });
});
