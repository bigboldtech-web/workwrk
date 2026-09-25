// Which Space tab opens first, and the Space.settings keys that decide it.
//
// A Space's tabs are fixed (Overview, Bird's eye, List, Board, Team, Calendar,
// Gantt), so a pinned Space view is a KEY, not a View row: it is stored at
// Space.settings.defaultView. That is a different thing from
// settings.workflow.defaultViewKey, which is the Space wizard's choice of the
// first view a NEW List gets, and the two are never read for each other.
//
// Every place that has to agree on the answer reads it here: the page picks
// the view it renders, the strip orders and links its tabs, the tab menu picks
// its one row and the pin route refuses a hidden view. One rule, so the first
// tab and the view /spaces/<slug> opens can never disagree.
//
// Pure: the only import is hasModule, which is pure too, so the page, the
// client strip, the route and a unit test all run the same code.

import { hasModule } from "@/lib/space-modules";
import { mergeJsonObject } from "@/lib/list-comfort";

export const SPACE_VIEW_KEYS = ["overview", "birdseye", "list", "board", "team", "calendar", "gantt"] as const;

export type SpaceViewKey = (typeof SPACE_VIEW_KEYS)[number];

export const SPACE_VIEW_LABELS: Readonly<Record<SpaceViewKey, string>> = {
  overview: "Overview",
  birdseye: "Bird's eye",
  list: "List",
  board: "Board",
  team: "Team",
  calendar: "Calendar",
  gantt: "Gantt",
};

export function isSpaceViewKey(v: unknown): v is SpaceViewKey {
  return typeof v === "string" && (SPACE_VIEW_KEYS as readonly string[]).includes(v);
}

function asObject(v: unknown): Record<string, unknown> {
  return v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : {};
}

/** The pinned Space tab, or null when none is stored (or what is stored is not a tab). */
export function readSpaceDefaultView(settings: unknown): SpaceViewKey | null {
  const v = asObject(settings).defaultView;
  return isSpaceViewKey(v) ? v : null;
}

/**
 * The tabs this Space does not show. Only Calendar can be switched off, by
 * the CALENDAR_VIEW module; a Space with no modules list shows every tab.
 */
export function hiddenSpaceViews(settings: unknown): SpaceViewKey[] {
  return hasModule(settings, "CALENDAR_VIEW") ? [] : ["calendar"];
}

/** What /spaces/<slug> opens with no view param: the pin when it is shown, else Overview. */
export function defaultSpaceView(pinned: SpaceViewKey | null, hidden: readonly SpaceViewKey[]): SpaceViewKey {
  return pinned && isSpaceViewKey(pinned) && !hidden.includes(pinned) ? pinned : "overview";
}

/**
 * The view a request opens.
 *
 * A valid ?view= wins, so every existing link keeps working and Overview
 * stays reachable as ?view=overview once something else is pinned. A hidden
 * view opens Overview, as it always has. No view, or a word that is not a
 * tab, opens the default.
 */
export function resolveSpaceView({
  requested,
  pinned,
  hidden,
}: {
  requested: unknown;
  pinned: SpaceViewKey | null;
  hidden: readonly SpaceViewKey[];
}): SpaceViewKey {
  if (isSpaceViewKey(requested)) return hidden.includes(requested) ? "overview" : requested;
  return defaultSpaceView(pinned, hidden);
}

/** The strip's order: the canonical order minus hidden tabs, with a shown pin moved first. */
export function orderSpaceTabs(hidden: readonly SpaceViewKey[], pinned: SpaceViewKey | null): SpaceViewKey[] {
  const visible = SPACE_VIEW_KEYS.filter((k) => !hidden.includes(k));
  if (!pinned || !visible.includes(pinned)) return visible;
  return [pinned, ...visible.filter((k) => k !== pinned)];
}

/**
 * A tab's link. The default tab is the bare Space URL; every other tab names
 * itself, which is what keeps Overview reachable when another view is pinned.
 */
export function spaceTabHref(slug: string, key: SpaceViewKey, defaultKey: SpaceViewKey): string {
  const base = `/spaces/${encodeURIComponent(slug)}`;
  return key === defaultKey ? base : `${base}?view=${key}`;
}

export type SpaceTabMenuRow = "none" | "pin" | "unpin" | "unpin-hidden";

/**
 * The one row a tab's right-click menu offers.
 *
 * A pin on a tab that is switched off (Calendar with its module off) has no
 * tab to right-click, so Overview, which is what opens in its place, carries
 * the way to clear it. Without that row the stale pin would come back the
 * day the module did.
 */
export function spaceTabMenuRow({
  key,
  pinned,
  hidden,
  canPin,
}: {
  key: SpaceViewKey;
  pinned: SpaceViewKey | null;
  hidden: readonly SpaceViewKey[];
  canPin: boolean;
}): SpaceTabMenuRow {
  if (!canPin) return "none";
  const pinShown = pinned !== null && !hidden.includes(pinned);
  if (pinned === key && pinShown) return "unpin";
  if (key === "overview" && pinned !== null && !pinShown) return "unpin-hidden";
  return "pin";
}

/**
 * A shallow merge of `patch` over what is STORED on Space.settings: a key set
 * to null is deleted, an undefined one is skipped, every other stored key is
 * kept. The one Space.settings writer (mutateSpaceSettings in src/lib/space.ts)
 * applies every patch through this on the row it locked, so a module toggle, a
 * bookmark and a pin can never erase each other's keys.
 */
export function mergeSpaceSettings(stored: unknown, patch: Record<string, unknown>): Record<string, unknown> {
  // The same rule every settings and config writer uses (Phase 5b's
  // mergeJsonObject); kept under this name so the Space writer reads as one.
  return mergeJsonObject(stored, patch);
}

/**
 * The Space.settings patch for a module toggle: settings.workflow.modules
 * replaced, every other workflow key kept, and the pin cleared when the new
 * modules hide the pinned tab. Switching Calendar off therefore unpins it, so
 * it cannot quietly become the first tab again months later when someone
 * switches the module back on.
 */
export function spaceModulesPatch(settings: unknown, modules: string[]): Record<string, unknown> {
  const stored = asObject(settings);
  const workflow = { ...asObject(stored.workflow), modules: [...modules] };
  const patch: Record<string, unknown> = { workflow };
  const pinned = readSpaceDefaultView(stored);
  if (pinned && hiddenSpaceViews({ ...stored, workflow }).includes(pinned)) patch.defaultView = null;
  return patch;
}
