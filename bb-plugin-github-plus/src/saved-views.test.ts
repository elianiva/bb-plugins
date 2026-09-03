import { describe, expect, it } from "vitest";
import {
  DEFAULT_QUERY,
  QUERY_STATE_KEY,
  SAVED_VIEWS_KEY,
  deleteSavedView,
  loadQueryState,
  loadSavedViews,
  saveQueryState,
  saveSavedViews,
  upsertSavedView,
} from "./saved-views";

function storage(initial: Record<string, string> = {}) {
  const values = new Map(Object.entries(initial));
  return {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, next: string) => {
      values.set(key, next);
    },
    read: (key: string) => values.get(key) ?? null,
  };
}

describe("saved GitHub views", () => {
  it("isolates tabs and falls back from malformed storage", () => {
    const broken = storage({ [SAVED_VIEWS_KEY]: "not json" });
    expect(loadSavedViews(broken)).toEqual({ issues: [], pulls: [] });

    const saved = upsertSavedView(
      loadSavedViews(broken),
      "issues",
      "My bugs",
      "is:open label:bug",
    );
    saveSavedViews(broken, saved);
    expect(loadSavedViews(broken)).toEqual({
      issues: [{ name: "My bugs", query: "is:open label:bug" }],
      pulls: [],
    });
    expect(deleteSavedView(saved, "pulls", "My bugs")).toEqual(saved);
  });

  it("persists independent query state", () => {
    const store = storage();
    const state = {
      issues: "is:open label:bug",
      pulls: "is:open author:alice",
    };
    saveQueryState(store, state);

    expect(store.read(QUERY_STATE_KEY)).toBe(JSON.stringify(state));
    expect(loadQueryState(store)).toEqual(state);

    const empty = storage();
    expect(loadQueryState(empty)).toEqual({
      issues: DEFAULT_QUERY,
      pulls: DEFAULT_QUERY,
    });
  });

  it("keeps named views isolated across Issues and Pull requests", () => {
    let views = loadSavedViews(storage());
    views = upsertSavedView(views, "issues", "Open bugs", "is:open label:bug");
    views = upsertSavedView(views, "pulls", "Needs review", "is:open");

    const store = storage();
    saveSavedViews(store, views);
    expect(loadSavedViews(store)).toEqual(views);
  });
});
