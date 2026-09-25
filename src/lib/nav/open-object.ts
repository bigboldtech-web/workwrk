// The object open in the main area, and which sidebar row carries its pill.
//
// A module store in the style of dirty-guard.ts: plain state, a listener set
// and pure readers, with the React hooks over it living next to the provider
// that writes it (components/layout/os/work-placement.tsx).
//
// WHY A STORE AND NOT THE URL. The hub, the sidebar and the crumb stay
// URL-derived. What the URL cannot say is which ROW should light for the
// object on screen, for two reasons:
//   1. the task drawer. Its URL is /item/<task> while the doc underneath stays
//      mounted, so a pathname comparison blanked the doc's pill the moment a
//      task opened over it;
//   2. rows that are not rendered. A List doc, a task doc, a sub-page, a doc
//      in a fourth-level folder, anything in a hidden or search-filtered Space
//      and a folder-only grantee's items have no row of their own on screen.
//      Lighting "the URL's row" lit nothing for all of them.
// So the mounted Work page publishes the server's reading of the URL that
// mounted it (the candidates below), rows that are candidates register while
// they are rendered, and `pickPill` chooses exactly one of them, or none.
// Nothing is persisted and nothing outlives the page that published it.
//
// Pure: no React, no DOM, no "@/" imports, so the test runs in node.

import type { ObjectKind } from "./object-href";

/**
 * The rows that may carry the pill for the open object, best first:
 * its own tree row, then its FAVORITES row, then its ancestors nearest first
 * (the List of a List or task doc, the anchored doc of a sub-page, then the
 * Folders, then the Space). Keys are built with `treeKey` and `favoriteKey`.
 */
export interface PillCandidates {
  selfKey: string;
  favKey: string;
  ancestors: readonly string[];
}

/** The branch the Work tree opens so the object's row (or its List) is on screen. */
export interface TreeReveal {
  spaceId: string;
  folderIds: readonly string[];
}

export interface PublishedObject {
  kind: ObjectKind;
  id: string;
  /** The address the object is mounted at. A link to it goes here. */
  self: string;
  /** Where a Trash of the open object lands. */
  closeHref: string;
  pill: PillCandidates | null;
  reveal: TreeReveal | null;
  /** Unique per publication, so a stale unmount never clears a newer one. */
  key: string;
}

export type TreeRowKind = "doc" | "table" | "canvas" | "list" | "folder" | "space";

/** 'doc:<id>', 'list:<id>', 'space:<id>' and so on. */
export function treeKey(kind: TreeRowKind, id: string): string {
  return `${kind}:${id}`;
}

/** 'fav:<kind>:<id>', for a FAVORITES row of a doc, table, canvas or form. */
export function favoriteKey(kind: ObjectKind, id: string): string {
  return `fav:${kind}:${id}`;
}

let current: PublishedObject | null = null;
const rendered = new Map<string, number>();
const listeners = new Set<() => void>();

function emit(): void {
  for (const cb of [...listeners]) cb();
}

export function publishOpenObject(obj: PublishedObject): void {
  current = obj;
  emit();
}

/** Clears only the publication with this key: an older page's late unmount is a no-op. */
export function clearOpenObject(key: string): void {
  if (!current || current.key !== key) return;
  current = null;
  emit();
}

export function readOpenObject(): PublishedObject | null {
  return current;
}

export function subscribeOpenObject(cb: () => void): () => void {
  listeners.add(cb);
  return () => {
    listeners.delete(cb);
  };
}

/**
 * A row that is a candidate registers while it is mounted. Mounts are
 * counted, because the same key can be rendered twice (a hover-preview
 * sidebar beside the pinned one) and one of them unmounting must not unlight
 * the other.
 */
export function registerRenderedRow(key: string): () => void {
  rendered.set(key, (rendered.get(key) ?? 0) + 1);
  emit();
  let done = false;
  return () => {
    if (done) return;
    done = true;
    const n = (rendered.get(key) ?? 0) - 1;
    if (n > 0) rendered.set(key, n);
    else rendered.delete(key);
    emit();
  };
}

export function isRowRendered(key: string): boolean {
  return (rendered.get(key) ?? 0) > 0;
}

/** Every candidate key, best first. */
export function pillCandidateKeys(pill: PillCandidates | null | undefined): string[] {
  if (!pill) return [];
  return [pill.selfKey, pill.favKey, ...pill.ancestors];
}

/**
 * The one row that carries the pill: the object's own tree row if it is
 * rendered; else its favourite if that is rendered; else its nearest rendered
 * ancestor; else nothing. Any rendered candidate beats nothing.
 */
export function pickPill(
  pill: PillCandidates | null | undefined,
  isRendered: (key: string) => boolean,
): string | null {
  for (const key of pillCandidateKeys(pill)) {
    if (isRendered(key)) return key;
  }
  return null;
}

/**
 * One row's pill state against the store, as a primitive so a
 * useSyncExternalStore subscriber re-renders only when its own answer
 * changes: "none" (not a candidate), "candidate" (register, but another row
 * carries the pill) or "active".
 */
export function rowPillState(key: string): "none" | "candidate" | "active" {
  if (!current?.pill || !pillCandidateKeys(current.pill).includes(key)) return "none";
  return pickPill(current.pill, isRowRendered) === key ? "active" : "candidate";
}

/** Test seam: forget everything. */
export function resetOpenObjectStore(): void {
  current = null;
  rendered.clear();
  emit();
}
