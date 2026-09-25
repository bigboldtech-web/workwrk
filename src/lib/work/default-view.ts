// Which view a List opens on, in one place (decisions 8 and 9).
//
// THE RULE. Board is every List's default view, unless a person pinned
// another one:
//   (a) a view somebody PINNED wins: isDefault AND (it carries the mark
//       config.pinned = { byId, at } OR it is not the auto List view and not
//       the List's first plain Board). The second half keeps an earlier explicit choice:
//       before pinning existed, "Set as default" wrote isDefault alone, and a
//       person who made their Calendar the default meant it;
//   (b) else the List's plain Board view (KANBAN, no variant);
//   (c) else the legacy isDefault view (the auto List view nobody chose);
//   (d) else the first view.
//
// "The auto List view" is TABLE with no config.grid and no config.variant:
// what createBoard and ensureCoreListViews seed ({ groupBy: "status" }). It
// carried isDefault on almost every List because TABLE was the old system
// default, not because anybody picked it, so those Lists now open on Board
// with no data migration and no write on page view.
//
// An unmarked isDefault PLAIN BOARD is what coreViewCreateData wrote for every
// List created with defaultViewType KANBAN (review #32). When it is the List's
// FIRST plain Board it is the Board fallback, not somebody's pin: it must show
// no Pin glyph and no Unpin row that would do nothing. A SECOND plain Board
// carrying isDefault is a different story: "+ View > Board" and Duplicate
// both make one, and before pinning existed "Set as default" wrote isDefault
// alone, so that flag is a person's choice and counts as a pin. "First" is
// judged among the Boards everyone can see, so every viewer reads it alike.
//
// WHO SEES WHAT. The resolver runs over the views the caller already filtered
// for the viewer, so a viewer who cannot see a private default gets Board, and
// listViewsForViewer() puts the resolved default FIRST, so for every viewer
// the first tab of the strip is the view the bare URL opens.
//
// NAMES. The code says PINNED DEFAULT (readPinnedDefault, withPinnedDefault)
// because view-visibility.ts already uses "pinned" for personal pins
// (home.work.pinnedViews); the JSON key is config.pinned, as decided.
//
// Pure: imports only ./view-visibility (itself import-free), so vitest loads
// it in node and scripts/ can import it by a relative path.

import { orderViews, visibleViews } from "./view-visibility";

export interface DefaultViewCandidate {
  id: string;
  name: string;
  type: string;
  isDefault: boolean;
  isShared: boolean;
  ownerId: string | null;
  displayOrder: number;
  config: unknown;
}

/** Who pinned a view as the List's default, and when. Stored at View.config.pinned. */
export interface PinnedDefaultMark {
  byId: string;
  at: string;
}

export type DefaultViewReason = "pinned" | "chosen" | "board" | "legacy" | "first";

export interface ResolvedDefaultView<T> {
  view: T;
  reason: DefaultViewReason;
  /** A person's choice: a marked pin, or an earlier explicit default ("chosen"). */
  pinned: boolean;
  /** The marker, when the view carries one. */
  pinnedById: string | null;
}

/** The refusals the pin route answers and the menu repeats, one wording each. */
export const PIN_DENIED =
  "Pinning a view for the whole List needs Can edit access on it, or owning the view. Ask a List or Space admin.";
export const PIN_PRIVATE_DENIED =
  "A private view can't be the List's default, because the rest of the List can't see it. Pin a shared view instead.";
export const PINNED_PRIVATE_DENIED =
  "This view is the List's default. Unpin it first, then make it private.";
export const UNPIN_STALE =
  "This view isn't the List's default any more, so nothing was unpinned. Refresh to see which view is pinned now.";

function asObject(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

/** The mark, only when config.pinned is a well-formed { byId, at }; anything else reads as no pin. */
export function readPinnedDefault(config: unknown): PinnedDefaultMark | null {
  const mark = asObject(asObject(config)?.pinned);
  if (!mark) return null;
  const { byId, at } = mark;
  if (typeof byId !== "string" || byId.length === 0 || byId.length > 64) return null;
  if (typeof at !== "string" || !Number.isFinite(Date.parse(at))) return null;
  return { byId, at };
}

/** TABLE with no grid and no variant: the grouped List every task List is seeded with. */
export function isAutoListView(v: { type: string; config: unknown }): boolean {
  const c = asObject(v.config);
  return v.type === "TABLE" && !c?.grid && !c?.variant;
}

/** KANBAN with no variant: the Board. */
export function isPlainBoardView(v: { type: string; config: unknown }): boolean {
  return v.type === "KANBAN" && !asObject(v.config)?.variant;
}

/** Shared, or an ownerless legacy row (which view-visibility.ts reads as shared). */
export function visibleToEveryone(v: { isShared: boolean; ownerId: string | null }): boolean {
  return v.isShared || v.ownerId === null;
}

type RankedView = Pick<DefaultViewCandidate, "id" | "isShared" | "ownerId" | "displayOrder">;
type PinCandidate = RankedView & Pick<DefaultViewCandidate, "isDefault" | "type" | "config">;

/**
 * Is `v` somebody's pin (rule a), as opposed to a default nobody chose?
 * `views` is the List's views (`v` among them): an unmarked isDefault plain
 * Board is a choice only when another everyone-visible plain Board comes
 * before it, so the lone core Board stays the fallback.
 */
export function countsAsPinnedDefault(v: PinCandidate, views: readonly PinCandidate[]): boolean {
  if (!v.isDefault) return false;
  if (readPinnedDefault(v.config) !== null) return true;
  if (isAutoListView(v)) return false;
  if (!isPlainBoardView(v)) return true;
  return views.some((o) => o.id !== v.id && isPlainBoardView(o) && visibleToEveryone(o) && tieBreak(o, v) < 0);
}

/** Everyone-visible first, then displayOrder, then id: every viewer breaks a tie the same way. */
function tieBreak(a: RankedView, b: RankedView): number {
  const ea = visibleToEveryone(a);
  const eb = visibleToEveryone(b);
  if (ea !== eb) return ea ? -1 : 1;
  if (a.displayOrder !== b.displayOrder) return a.displayOrder - b.displayOrder;
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
}

/**
 * The List's default view among `views`, which the caller has ALREADY
 * filtered for the viewer. Null for a List with no views.
 */
export function resolveDefaultView<T extends DefaultViewCandidate>(views: readonly T[]): ResolvedDefaultView<T> | null {
  if (views.length === 0) return null;

  // (a) Pins: a marked pin before an unmarked choice, the newest mark first
  // (two marks only survive a race or a legacy row), then the tie-break.
  const pins = views.filter((v) => countsAsPinnedDefault(v, views));
  if (pins.length > 0) {
    const ranked = [...pins].sort((a, b) => {
      const ma = readPinnedDefault(a.config);
      const mb = readPinnedDefault(b.config);
      if (!!ma !== !!mb) return ma ? -1 : 1;
      if (ma && mb) {
        const byAt = Date.parse(mb.at) - Date.parse(ma.at);
        if (byAt !== 0) return byAt;
      }
      return tieBreak(a, b);
    });
    const view = ranked[0];
    const mark = readPinnedDefault(view.config);
    return {
      view,
      reason: mark ? "pinned" : "chosen",
      pinned: true,
      pinnedById: mark ? mark.byId : null,
    };
  }

  // (b) The plain Board.
  const boards = views.filter(isPlainBoardView);
  if (boards.length > 0) {
    return { view: [...boards].sort(tieBreak)[0], reason: "board", pinned: false, pinnedById: null };
  }

  // (c) The legacy default: an isDefault view that is not a pin, which after
  // (a) and (b) can only be the auto List view.
  const legacy = views.filter((v) => v.isDefault);
  if (legacy.length > 0) {
    return { view: [...legacy].sort(tieBreak)[0], reason: "legacy", pinned: false, pinnedById: null };
  }

  // (d) The first view, in the order the caller handed them over.
  return { view: views[0], reason: "first", pinned: false, pinnedById: null };
}

/**
 * THE one call every List surface makes (the List page, the Personal list,
 * the views API): the views this viewer may see, the resolved default first,
 * and whether that default is somebody's pin. For every viewer
 * `views[0] === defaultView`, so the strip's first tab and the page's default
 * view can never disagree.
 */
export function listViewsForViewer<T extends DefaultViewCandidate>(
  views: readonly T[],
  viewerId: string | null,
): {
  views: T[];
  defaultView: T | null;
  reason: DefaultViewReason | null;
  pinned: boolean;
  pinnedById: string | null;
} {
  const visible = [...visibleViews(views, viewerId)].sort((a, b) => {
    if (a.displayOrder !== b.displayOrder) return a.displayOrder - b.displayOrder;
    const byName = a.name.localeCompare(b.name);
    if (byName !== 0) return byName;
    return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
  });
  const resolved = resolveDefaultView(visible);
  return {
    views: orderViews(visible, [], resolved?.view.id ?? null),
    defaultView: resolved?.view ?? null,
    reason: resolved?.reason ?? null,
    pinned: resolved?.pinned ?? false,
    pinnedById: resolved?.pinnedById ?? null,
  };
}

/** A fresh copy of `config` carrying `mark`; a non-object config counts as {}. */
export function withPinnedDefault(config: unknown, mark: PinnedDefaultMark): Record<string, unknown> {
  return { ...(asObject(config) ?? {}), pinned: { byId: mark.byId, at: mark.at } };
}

/**
 * A fresh copy of `config` with no pinned key at all. On a configPatch this
 * matters: a patch { pinned: null } would otherwise delete the stored mark
 * through the shallow merge and silently unpin, and { pinned: {...} } would
 * forge one. With the key gone, the merge keeps what is stored.
 */
export function withoutPinnedDefault(config: unknown): Record<string, unknown> {
  const out = { ...(asObject(config) ?? {}) };
  delete out.pinned;
  return out;
}

/**
 * The config to store for a write that is not a pin or an unpin: the
 * incoming config with ITS mark ignored, plus the STORED mark. Every renderer
 * PATCHes the config it mounted with, so without this a tab opened before a
 * pin would drop it and a tab opened before an unpin would bring it back.
 */
export function carryPinnedDefault(incoming: unknown, stored: unknown): Record<string, unknown> {
  const out = withoutPinnedDefault(incoming);
  const mark = readPinnedDefault(stored);
  if (mark) out.pinned = mark;
  return out;
}

/**
 * A tab drag that keeps the default first (review #24): the default never
 * moves, a drop ON the default lands the dragged tab right after it (second)
 * and reports `hitDefault` so the strip can say why, and every other drop is
 * a plain splice. Unknown ids return the input unchanged.
 */
export function moveTabKeepingDefaultFirst(
  ids: readonly string[],
  dragId: string,
  targetId: string,
  defaultId: string | null,
): { ids: string[]; hitDefault: boolean } {
  const from = ids.indexOf(dragId);
  const to = ids.indexOf(targetId);
  const unchanged = { ids: [...ids], hitDefault: false };
  if (from < 0 || to < 0 || from === to) return unchanged;
  if (defaultId !== null && dragId === defaultId) return unchanged;

  if (defaultId !== null && targetId === defaultId) {
    const rest = ids.filter((id) => id !== dragId);
    rest.splice(rest.indexOf(defaultId) + 1, 0, dragId);
    return { ids: rest, hitDefault: true };
  }

  const next = [...ids];
  next.splice(from, 1);
  next.splice(to, 0, dragId);
  // A splice across the default's slot would shift it by one; put it back
  // where it was, so "the default never moves" holds wherever it sits.
  if (defaultId !== null) {
    const was = ids.indexOf(defaultId);
    const now = next.indexOf(defaultId);
    if (was >= 0 && now !== was) {
      next.splice(now, 1);
      next.splice(was, 0, defaultId);
    }
  }
  return { ids: next, hitDefault: false };
}

/**
 * Which pin row a view tab's menu shows. `canPin` is the route's gate for
 * THIS view, canSaveView (the contribute ladder, or owning the view), the
 * same gate "Set as default" had before pinning existed (decision 9).
 * `pinned` is true only on the pinned default, so `isDefault` alone (the
 * unpinned Board fallback) offers Pin, which makes the choice explicit.
 */
export function pinMenuRow(input: {
  isDefault: boolean;
  pinned: boolean;
  canPin: boolean;
  pinnable: boolean;
  tabCount: number;
}): "none" | "pin" | "pin-disabled" | "unpin" {
  if (input.tabCount <= 1 || !input.canPin) return "none";
  if (input.pinned) return "unpin";
  if (!input.pinnable) return "pin-disabled";
  return "pin";
}
