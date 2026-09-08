// bb-plugin-centered-home — center the new-thread homepage and greet.
//
// The host renders the new-thread surface top-aligned on wide viewports
// (inner `mx-auto max-w-[760px]` stack with `pt-14`, inside an
// `overflow-y-auto` scroll region). This content script vertically centers
// that stack with a margin-auto trick (so tall content still scrolls
// normally) and prepends a centered time-based greeting above the composer:
//
//   Good afternoon
//   Monday, September 7
//   [ composer ]
//
// On compact viewports the composer is absolutely docked at the bottom, so
// we only prepend the greeting to the scroll content and leave the docked
// composer alone. The empty-bits state (no projects yet, bb logo + buttons)
// is already centered — we just add the greeting above it.
//
// Anti-flicker design (the host owns this DOM via React, so we must never
// fight it):
// - All visual styling lives in one static <style> tag, keyed off data-*
//   attributes. We never write inline styles, so host re-renders cannot
//   wipe our styling and there is no apply/restore flapping.
// - Data attributes are set once and guarded — re-setting is a no-op.
// - The greeting node is inserted once and left alone. It is only moved if
//   it somehow ends up outside the target container, and never removed
//   until the compose surface has been gone for several consecutive scans
//   (transient unmounts mid-render must not tear it down).
// - No entrance animation: any re-insert would replay it as a visible blink.
// - The MutationObserver ignores mutations inside our own greeting subtree.

import { definePluginApp } from "@get-bb/plugin-sdk/app";

const STYLE_ID = "centered-home-style";
const GREETING_ID = "centered-home-greeting";
const SCROLL_ATTR = "data-centered-home-scroll";
const INNER_ATTR = "data-centered-home-inner";
// Consecutive scans with no compose surface before tearing down. Covers
// transient unmounts while the host re-renders between route changes.
const GONE_THRESHOLD = 10;

function injectStyle(): void {
  if (document.getElementById(STYLE_ID)) return;
  const s = document.createElement("style");
  s.id = STYLE_ID;
  s.textContent = `
    #${GREETING_ID} {
      text-align: center;
      padding: 0 1rem 1.75rem;
    }
    #${GREETING_ID} h1 {
      margin: 0;
      font-size: clamp(1.75rem, 1.2rem + 2.5vw, 2.5rem);
      font-weight: 650;
      letter-spacing: -0.02em;
      line-height: 1.15;
      color: var(--foreground);
      text-wrap: balance;
    }
    #${GREETING_ID} p {
      margin: 0.5rem 0 0;
      font-size: 0.875rem;
      line-height: 1.4;
      color: var(--muted-foreground);
    }
    /* Wide layout: flex column + margin-auto centers short content and
       degrades to normal top-aligned scrolling when content overflows. */
    [${SCROLL_ATTR}] {
      display: flex !important;
      flex-direction: column !important;
    }
    [${INNER_ATTR}] {
      margin-top: auto !important;
      margin-bottom: auto !important;
      padding-top: 0 !important;
      justify-content: center !important;
    }
  `;
  document.head.appendChild(s);
}

function greetingFor(now: Date): { title: string; subtitle: string } {
  const h = now.getHours();
  const title =
    h >= 5 && h < 12
      ? "Good morning"
      : h >= 12 && h < 17
        ? "Good afternoon"
        : h >= 17 && h < 22
          ? "Good evening"
          : "Good night";
  const subtitle = now.toLocaleDateString(undefined, {
    weekday: "long",
    month: "long",
    day: "numeric",
  });
  return { title, subtitle };
}

function renderGreeting(el: HTMLElement, now: Date): void {
  const { title, subtitle } = greetingFor(now);
  let h1 = el.querySelector("h1");
  let p = el.querySelector("p");
  if (!h1 || !p) {
    el.replaceChildren();
    h1 = document.createElement("h1");
    p = document.createElement("p");
    el.append(h1, p);
  }
  if (h1.textContent !== title) h1.textContent = title;
  if (p.textContent !== subtitle) p.textContent = subtitle;
}

function createGreeting(): HTMLElement {
  const el = document.createElement("div");
  el.id = GREETING_ID;
  el.setAttribute("role", "heading");
  el.setAttribute("aria-label", "Greeting");
  renderGreeting(el, new Date());
  return el;
}

type CenteredTargets = {
  /** "none" is never returned — absence is null. */
  kind: "wide" | "compact" | "empty";
  inner: HTMLElement;
};

function closestInnerStack(from: HTMLElement): HTMLElement | null {
  // The compose surface content lives inside a
  // `div.mx-auto...max-w-[760px]` stack on every layout.
  let el: HTMLElement | null = from;
  for (let i = 0; i < 8 && el; i++) {
    if (
      el.tagName === "DIV" &&
      el.classList.contains("mx-auto") &&
      el.className.includes("max-w-[760px]")
    ) {
      return el;
    }
    el = el.parentElement;
  }
  return null;
}

function findWideScroll(inner: HTMLElement): HTMLElement | null {
  // The scroll region is the `overflow-y-auto` ancestor (the
  // `@container/page` div). Walk up from the inner stack.
  let el: HTMLElement | null = inner.parentElement;
  for (let i = 0; i < 5 && el; i++) {
    if (el.classList.contains("overflow-y-auto")) return el;
    el = el.parentElement;
  }
  return null;
}

function isCompactSurface(): boolean {
  // Document-level check, decided before anything else: the compact home
  // reuses the same `mx-auto max-w-[760px]` classes, so layout must be
  // classified by surface, never by walking up from the composer.
  return !!document.querySelector('[data-testid="root-compose-compact-home"]');
}

function findTargets(): CenteredTargets | null {
  if (isCompactSurface()) {
    // Compact layout: composer is absolutely docked at the bottom; the
    // scrollable content above it gets the greeting only, no restyling.
    const compactViewport = document.querySelector<HTMLElement>(
      '[data-testid="root-compose-compact-scroll-viewport"]',
    );
    if (!compactViewport || !document.contains(compactViewport)) return null;
    const inner = compactViewport.querySelector<HTMLElement>("div.mx-auto");
    if (!inner) return null;
    return { kind: "compact", inner };
  }

  // Wide composer case: the host gives the prompt composer a stable id.
  const composer = document.getElementById("root-compose-prompt");
  if (composer && document.contains(composer)) {
    const inner = closestInnerStack(composer);
    if (inner) return { kind: "wide", inner };
    return null;
  }

  // Empty state (no projects yet): bb logo + action buttons, already
  // centered. Just prepend the greeting to the same inner stack.
  const logo = document.querySelector<HTMLElement>(
    '[role="img"][aria-label="bb"]',
  );
  if (logo && document.contains(logo)) {
    const inner = closestInnerStack(logo);
    if (inner) return { kind: "empty", inner };
  }

  return null;
}

function markCentering(inner: HTMLElement): void {
  // Attribute-only: the static stylesheet does the visual work, so host
  // re-renders cannot wipe it and there is no style flapping. Guarded to
  // stay a no-op after the first application.
  const scroll = findWideScroll(inner);
  if (scroll && !scroll.hasAttribute(SCROLL_ATTR)) {
    scroll.setAttribute(SCROLL_ATTR, "");
  }
  if (!inner.hasAttribute(INNER_ATTR)) {
    inner.setAttribute(INNER_ATTR, "");
  }
}

function unmarkCentering(): void {
  for (const el of Array.from(
    document.querySelectorAll<HTMLElement>(
      `[${SCROLL_ATTR}],[${INNER_ATTR}]`,
    ),
  )) {
    el.removeAttribute(SCROLL_ATTR);
    el.removeAttribute(INNER_ATTR);
  }
}

function ensureGreeting(targets: CenteredTargets): void {
  let el = document.getElementById(GREETING_ID);
  if (!el || !document.contains(el)) {
    el = el && !document.contains(el) ? el : createGreeting();
    if (!document.contains(el)) {
      targets.inner.prepend(el);
    }
  }
  if (el.parentElement !== targets.inner) {
    // Ended up elsewhere (host reordered); move back on top.
    targets.inner.prepend(el);
  }
  // Already first child of the right container: strictly do nothing.
  // Any DOM write here would replay through the observer and risk loops.
  renderGreeting(el, new Date());

  if (targets.kind === "wide" || targets.kind === "empty") {
    markCentering(targets.inner);
  }
  // Compact: leave the docked composer and all host styles alone.
}

function teardown(): void {
  document.getElementById(GREETING_ID)?.remove();
  unmarkCentering();
}

export default definePluginApp((app) => {
  app.contentScripts.register({
    id: "centered-home",
    mount({ signal }) {
      injectStyle();

      let disposed = false;
      let scheduled = 0;
      let goneStreak = 0;

      const scan = (): void => {
        if (disposed || signal.aborted) return;
        const targets = findTargets();
        if (!targets) {
          goneStreak += 1;
          if (goneStreak >= GONE_THRESHOLD) {
            goneStreak = 0;
            teardown();
          }
          return;
        }
        goneStreak = 0;
        // prepend/attribute writes never throw on detached nodes, so no
        // try/catch needed; the next scan reconciles whatever raced us.
        ensureGreeting(targets);
      };

      const schedule = (): void => {
        if (disposed || signal.aborted) return;
        if (scheduled) return;
        scheduled = window.setTimeout(() => {
          scheduled = 0;
          scan();
        }, 120);
      };

      scan();
      const observer = new MutationObserver((mutations) => {
        // Our own greeting subtree writes must not reschedule work.
        for (const m of mutations) {
          const t = m.target as HTMLElement | null;
          if (
            t &&
            t instanceof HTMLElement &&
            (t.id === GREETING_ID || t.closest(`#${GREETING_ID}`))
          ) {
            continue;
          }
          schedule();
          return;
        }
      });
      observer.observe(document.body, { childList: true, subtree: true });

      // Refresh the time-based greeting as the day rolls over.
      const ticker = window.setInterval(() => {
        const el = document.getElementById(GREETING_ID);
        if (el && document.contains(el)) renderGreeting(el, new Date());
      }, 60_000);

      const dispose = (): void => {
        if (disposed) return;
        disposed = true;
        if (scheduled) window.clearTimeout(scheduled);
        window.clearInterval(ticker);
        observer.disconnect();
        teardown();
        document.getElementById(STYLE_ID)?.remove();
      };

      signal.addEventListener("abort", dispose, { once: true });
      return dispose;
    },
  });
});
