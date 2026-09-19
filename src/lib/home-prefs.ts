// home-prefs.ts — the Work hub's two preference readers, and the one-time
// mapping each one does from the keys the old pages wrote.
//
// Spec: docs/plans/ui-refresh/spec-work-home.md section 1 ("What `home.cards`
// means in this sidebar") and section 4 item 4 (the three one-time preference
// reads).
//
// THE POINT OF SEPARATING THEM. `home.cards` has been declared as a lockable
// org default since the Settings › Defaults page shipped, with the description
// "Freezes which cards show on Home", and grep finds no reader anywhere: the
// lock has been inert. settings-architecture section 4.2 assigns the key to
// "the Work sidebar and the Space overview", so the sidebar becomes its reader
// here. Home's six widgets deliberately do NOT read it: they live on
// `home.work.surface.home.viewOptions.widgets`, because one array that means
// both "which sidebar rows" and "which Home widgets" can only ever be set
// wrong by somebody who wanted one of them.
//
// Nothing here writes. Callers decide when to persist a mapped value; the
// mapping is pure so it can be tested and so it can be applied on every read
// without depending on the write having happened.

/** The optional rows and sections `home.cards` switches on in the Work sidebar. */
export type SidebarOptionalKey = "activity" | "goals" | "templates" | "trash" | "favorites" | "spaces";

export const SIDEBAR_OPTIONAL_KEYS: readonly SidebarOptionalKey[] = [
  "activity",
  "goals",
  "templates",
  "trash",
  "favorites",
  "spaces",
];

/**
 * Rows a person can never hide. Home, My work and Inbox: a person must always
 * be able to reach their own work and their own notifications, so these are not
 * in `SIDEBAR_OPTIONAL_KEYS` and a stored value naming one is ignored.
 */
export const SIDEBAR_FIXED_ROWS: readonly string[] = ["home", "my-work", "inbox"];

/**
 * The old CustomizePanel card keys, mapped once. Anything absent from this map
 * and from SIDEBAR_OPTIONAL_KEYS is ignored rather than guessed at.
 *
 *   inbox, myWrk            -> dropped: those rows are fixed and cannot be hidden
 *   assignedComments        -> dropped: the page is gone (it is an Inbox filter)
 *   draftsSent              -> dropped: a coming-soon row that never existed
 *   allSpaces               -> spaces
 *   allTasks                -> everything, which is a row inside the SPACES
 *                              section rather than a section of its own, so it
 *                              maps onto `spaces` (hiding the section hides it)
 */
const LEGACY_CARD_MAP: Readonly<Record<string, SidebarOptionalKey | null>> = {
  inbox: null,
  myWrk: null,
  mywrk: null,
  assignedComments: null,
  draftsSent: null,
  allSpaces: "spaces",
  allTasks: "spaces",
};

/**
 * `home.cards` as this sidebar reads it.
 *
 * A person who never opened the panel has no stored value and gets everything
 * on: absence is not a choice, and defaulting an unset preference to "hide
 * everything" would empty a sidebar nobody asked to empty.
 */
export function readSidebarCards(stored: unknown): SidebarOptionalKey[] {
  if (!Array.isArray(stored)) return [...SIDEBAR_OPTIONAL_KEYS];
  const out = new Set<SidebarOptionalKey>();
  for (const raw of stored) {
    if (typeof raw !== "string") continue;
    if (SIDEBAR_OPTIONAL_KEYS.includes(raw as SidebarOptionalKey)) {
      out.add(raw as SidebarOptionalKey);
      continue;
    }
    const mapped = raw in LEGACY_CARD_MAP ? LEGACY_CARD_MAP[raw] : null;
    if (mapped) out.add(mapped);
    // Anything else: a fixed row, or a key from a panel that no longer
    // exists. Ignored rather than guessed at.
  }
  // A stored array that maps to NOTHING reads as unset, and unset shows
  // everything. That is deliberate and it is the safe direction: every entry
  // being a fixed row or a dead key ("inbox", "draftsSent") is a value written
  // by a panel that no longer exists, not somebody asking for an empty
  // sidebar, and this key is lockable as an org default, so the failure it
  // could otherwise cause is an admin emptying every sidebar in the company by
  // saving a stale list. The CustomizePanel writes the keys it KEEPS, so the
  // only way to reach [] through the UI is to switch all six off, and the cost
  // of that one case coming back on is a row too many rather than a missing
  // door.
  if (out.size === 0) return [...SIDEBAR_OPTIONAL_KEYS];
  return [...SIDEBAR_OPTIONAL_KEYS].filter((k) => out.has(k));
}

/** True when a stored `home.cards` needs rewriting into the new vocabulary. */
export function sidebarCardsNeedMigration(stored: unknown): boolean {
  if (!Array.isArray(stored)) return false;
  return stored.some((raw) => typeof raw === "string" && !SIDEBAR_OPTIONAL_KEYS.includes(raw as SidebarOptionalKey));
}

// ── Home widgets ──────────────────────────────────────────────────

/** The six Home widgets, in the fixed order the spec renders them. */
export type HomeWidgetKey = "my-work" | "inbox" | "reminders" | "goals" | "weekly-review" | "recent-docs";

export const HOME_WIDGET_KEYS: readonly HomeWidgetKey[] = [
  "my-work",
  "inbox",
  "reminders",
  "goals",
  "weekly-review",
  "recent-docs",
];

export const HOME_WIDGET_LABEL: Readonly<Record<HomeWidgetKey, string>> = {
  "my-work": "My work",
  inbox: "Inbox",
  reminders: "Reminders",
  goals: "My goals",
  "weekly-review": "Weekly review",
  "recent-docs": "Recent docs",
};

/**
 * A Guest's `home` row in access section 5.2.1 grants exactly "My work over
 * shared objects, Inbox". A Guest is a person from outside the company who is
 * in the workspace for one List; the workspace does not keep them a personal
 * planner, a goal list or a weekly review.
 */
export const GUEST_HOME_WIDGETS: readonly HomeWidgetKey[] = ["my-work", "inbox"];

/**
 * `home.taskCardsHidden` was a HIDDEN list over the old eleven-card grid. Three
 * of those names describe something that still exists; the other eight named a
 * stub card that is gone. The map is by name, in that direction, so a hidden
 * stub can never hide a real widget that happens to sort next to it.
 */
const LEGACY_CARD_TO_WIDGET: Readonly<Record<string, HomeWidgetKey>> = {
  assigned: "my-work",
  "assigned-to-me": "my-work",
  "my-work": "my-work",
  goals: "goals",
  okrs: "goals",
  kras: "weekly-review",
  "kras-kpis": "weekly-review",
};

/**
 * Which widgets show. Reads the new key; when it is absent, inverts the old
 * hidden-list once so a person who hid the Goals card in the old grid does not
 * find it back on their first visit to the new page.
 */
export function readHomeWidgets(
  storedWidgets: unknown,
  legacyHidden?: unknown,
): HomeWidgetKey[] {
  if (Array.isArray(storedWidgets)) {
    const set = new Set(storedWidgets.filter((v): v is string => typeof v === "string"));
    return [...HOME_WIDGET_KEYS].filter((k) => set.has(k));
  }
  if (Array.isArray(legacyHidden)) {
    const hiddenWidgets = new Set<HomeWidgetKey>();
    for (const raw of legacyHidden) {
      if (typeof raw !== "string") continue;
      const mapped = LEGACY_CARD_TO_WIDGET[raw];
      if (mapped) hiddenWidgets.add(mapped);
    }
    return [...HOME_WIDGET_KEYS].filter((k) => !hiddenWidgets.has(k));
  }
  return [...HOME_WIDGET_KEYS];
}

/** The widget list a viewer actually gets, after their role narrows it. */
export function visibleHomeWidgets(chosen: readonly HomeWidgetKey[], isGuest: boolean): HomeWidgetKey[] {
  if (!isGuest) return [...chosen];
  return chosen.filter((k) => GUEST_HOME_WIDGETS.includes(k));
}

/** True when the new key is unset and there is a legacy value worth writing. */
export function homeWidgetsNeedMigration(storedWidgets: unknown, legacyHidden: unknown): boolean {
  return !Array.isArray(storedWidgets) && Array.isArray(legacyHidden) && legacyHidden.length > 0;
}

// ── The localStorage saved filters the old surface kept ───────────

/** The key `TaskListSurface` wrote its saved filters into, client-side only. */
export const LEGACY_SAVED_FILTERS_KEY = "workwrk:task-saved-filters";

export interface SavedWorkFilter {
  id: string;
  name: string;
  filters?: Record<string, unknown>;
  sort?: string | null;
  group?: string | null;
  view?: string | null;
  isDefault?: boolean;
}

/**
 * Read whatever the old localStorage key holds into the shape
 * `home.work.savedFilters[]` stores. Anything without an id and a name is
 * dropped rather than written as a nameless pill.
 */
export function parseLegacySavedFilters(raw: string | null | undefined): SavedWorkFilter[] {
  if (!raw) return [];
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return [];
  }
  if (!Array.isArray(parsed)) return [];
  const out: SavedWorkFilter[] = [];
  for (const row of parsed) {
    if (!row || typeof row !== "object") continue;
    const r = row as Record<string, unknown>;
    const id = typeof r.id === "string" ? r.id : null;
    const name = typeof r.name === "string" ? r.name.trim() : "";
    if (!id || !name) continue;
    out.push({
      id,
      name,
      filters: r.filters && typeof r.filters === "object" ? (r.filters as Record<string, unknown>) : undefined,
      sort: typeof r.sort === "string" ? r.sort : null,
      group: typeof r.group === "string" ? r.group : null,
      view: typeof r.view === "string" ? r.view : null,
      isDefault: r.isDefault === true,
    });
  }
  return out;
}

/** Saved filters as stored, tolerating a value written by an older shape. */
export function readSavedFilters(stored: unknown): SavedWorkFilter[] {
  if (!Array.isArray(stored)) return [];
  const out: SavedWorkFilter[] = [];
  for (const row of stored) {
    if (!row || typeof row !== "object") continue;
    const r = row as Record<string, unknown>;
    if (typeof r.id !== "string" || typeof r.name !== "string" || !r.name.trim()) continue;
    out.push({
      id: r.id,
      name: r.name,
      filters: r.filters && typeof r.filters === "object" ? (r.filters as Record<string, unknown>) : undefined,
      sort: typeof r.sort === "string" ? r.sort : null,
      group: typeof r.group === "string" ? r.group : null,
      view: typeof r.view === "string" ? r.view : null,
      isDefault: r.isDefault === true,
    });
  }
  return out;
}
