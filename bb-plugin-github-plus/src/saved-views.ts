export type SavedViewTab = "issues" | "pulls";

export interface SavedView {
  name: string;
  query: string;
}

export type SavedViews = Record<SavedViewTab, SavedView[]>;

export const SAVED_VIEWS_KEY = "bb-plugin-github-plus:saved-views";

export const QUERY_STATE_KEY = "bb-plugin-github-plus:queries";
export const DEFAULT_QUERY = "is:open ";

export type QueryState = Record<SavedViewTab, string>;

const emptyQueryState = (): QueryState => ({
  issues: DEFAULT_QUERY,
  pulls: DEFAULT_QUERY,
});

export function loadQueryState(
  storage: Pick<Storage, "getItem">,
): QueryState {
  const result = emptyQueryState();
  try {
    const raw = storage.getItem(QUERY_STATE_KEY);
    const parsed: unknown = raw === null ? null : JSON.parse(raw);
    if (
      typeof parsed === "object" &&
      parsed !== null &&
      !Array.isArray(parsed)
    ) {
      for (const tab of ["issues", "pulls"] as const) {
        const value = (parsed as Record<string, unknown>)[tab];
        if (typeof value === "string") result[tab] = value;
      }
      return result;
    }
  } catch {
    void 0;
  }
  return result;
}

export function saveQueryState(
  storage: Pick<Storage, "setItem">,
  state: QueryState,
): void {
  try {
    storage.setItem(QUERY_STATE_KEY, JSON.stringify(state));
  } catch {
    void 0;
  }
}

const emptySavedViews = (): SavedViews => ({
  issues: [],
  pulls: [],
});

function isTab(value: string): value is SavedViewTab {
  return value === "issues" || value === "pulls";
}

export function loadSavedViews(
  storage: Pick<Storage, "getItem">,
  key = SAVED_VIEWS_KEY,
): SavedViews {
  try {
    const parsed: unknown = JSON.parse(storage.getItem(key) ?? "null");
    const result = emptySavedViews();
    if (typeof parsed !== "object" || parsed === null) return result;
    for (const tab of Object.keys(result)) {
      const entries = (parsed as Record<string, unknown>)[tab];
      if (!Array.isArray(entries)) continue;
      result[tab as SavedViewTab] = entries
        .filter((entry): entry is { name: string; query: string } => {
          if (typeof entry !== "object" || entry === null) return false;
          const record = entry as Record<string, unknown>;
          return (
            typeof record.name === "string" &&
            typeof record.query === "string" &&
            record.name.trim().length > 0
          );
        })
        .map((entry) => ({ name: entry.name.trim(), query: entry.query }))
        .slice(0, 50);
    }
    return result;
  } catch {
    void 0;
    return emptySavedViews();
  }
}

export function saveSavedViews(
  storage: Pick<Storage, "setItem">,
  views: SavedViews,
  key = SAVED_VIEWS_KEY,
): void {
  try {
    storage.setItem(key, JSON.stringify(views));
  } catch {
    void 0;
  }
}

export function upsertSavedView(
  views: SavedViews,
  tab: SavedViewTab,
  name: string,
  query: string,
): SavedViews {
  if (!isTab(tab) || name.trim().length === 0) return views;
  const next = { ...views, [tab]: [...views[tab]] };
  const entry = { name: name.trim(), query };
  const index = next[tab].findIndex((view) => view.name === entry.name);
  if (index === -1) next[tab].push(entry);
  else next[tab][index] = entry;
  return next;
}

export function deleteSavedView(
  views: SavedViews,
  tab: SavedViewTab,
  name: string,
): SavedViews {
  return {
    ...views,
    [tab]: views[tab].filter((view) => view.name !== name),
  };
}
