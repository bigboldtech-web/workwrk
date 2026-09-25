// Which saved views a person sees, and in which order.
//
// Spec: docs/plans/ui-refresh/spec-spaces-lists.md section 2 (`/boards/[slug]`
// views row) and the audit's High #5, "private views are cosmetic".
//
// WHAT WAS BROKEN. `view-create-popover.tsx` has written `isShared: !isPrivate`
// since it shipped and `View.ownerId` has been set on every create, so the data
// to honour "Private view" has always been there. The read never used it:
// `GET /api/boards/[id]/views` selected every row for the board, and the List
// page bypassed the route entirely by including `views` in its own Prisma
// query. So a private view was private in the dialog and public on the page.
//
// The rule, in one place so the route and the page cannot disagree:
//   a view is visible when it is shared, OR the viewer owns it, OR it has no
//   owner at all (rows seeded before ownerId existed; hiding those would make
//   Lists lose their tabs, which is a data loss a filter must never cause).
//
// ORDER. The List's RESOLVED default first (src/lib/work/default-view.ts
// decides it: a pinned view, else the plain Board), then personal pins
// (`home.work.pinnedViews[]`) in pin order, then `displayOrder`, then name.
// The raw `isDefault` flag is not a rank any more: it sat on the auto List
// view of almost every List, so ranking it put List first while the page
// opened Board. Personal pinning is per person, so two people reading the
// same List see the same default first and their own pins after it.
//
// Pure module: no imports, so vitest loads it in node and the route and the
// client both call the same function.

export interface ViewLike {
  id: string;
  name: string;
  isShared: boolean;
  isDefault: boolean;
  ownerId: string | null;
  displayOrder: number;
}

/**
 * Can this viewer see this view?
 *
 * `ownerId === null` is the legacy row: a view created before ownership was
 * recorded. It reads as shared, because the alternative is a List whose tabs
 * disappear for everyone.
 */
export function viewVisibleTo(view: ViewLike, viewerId: string | null): boolean {
  if (view.isShared) return true;
  if (view.ownerId === null) return true;
  return Boolean(viewerId) && view.ownerId === viewerId;
}

/** The subset of `views` this viewer may see, order untouched. */
export function visibleViews<T extends ViewLike>(views: readonly T[], viewerId: string | null): T[] {
  return views.filter((v) => viewVisibleTo(v, viewerId));
}

/**
 * The resolved default first, then personal pins, then displayOrder, then
 * name. Stable: equal rows keep the order they arrived in. `defaultId` is the
 * id default-view.ts resolved for this viewer; an id not in the set is
 * ignored.
 */
export function orderViews<T extends ViewLike>(
  views: readonly T[],
  pinnedIds: readonly string[] = [],
  defaultId: string | null = null,
): T[] {
  const pinRank = new Map<string, number>();
  pinnedIds.forEach((id, i) => pinRank.set(id, i));
  return [...views]
    .map((v, i) => ({ v, i }))
    .sort((a, b) => {
      const da = a.v.id === defaultId;
      const db = b.v.id === defaultId;
      if (da !== db) return da ? -1 : 1;
      const pa = pinRank.has(a.v.id) ? pinRank.get(a.v.id)! : Number.MAX_SAFE_INTEGER;
      const pb = pinRank.has(b.v.id) ? pinRank.get(b.v.id)! : Number.MAX_SAFE_INTEGER;
      if (pa !== pb) return pa - pb;
      if (a.v.displayOrder !== b.v.displayOrder) return a.v.displayOrder - b.v.displayOrder;
      const byName = a.v.name.localeCompare(b.v.name);
      if (byName !== 0) return byName;
      return a.i - b.i;
    })
    .map((x) => x.v);
}

/**
 * Visible, then ordered. A List surface calls listViewsForViewer() in
 * default-view.ts, which resolves the default over the visible set and hands
 * it here as `defaultId`.
 */
export function viewsForViewer<T extends ViewLike>(
  views: readonly T[],
  viewerId: string | null,
  pinnedIds: readonly string[] = [],
  defaultId: string | null = null,
): T[] {
  return orderViews(visibleViews(views, viewerId), pinnedIds, defaultId);
}

/**
 * May this viewer flip a view between Private and Shared, rename it, retype it
 * or delete it? Full access on the List, or the view's own owner.
 */
export function canManageView(
  view: ViewLike,
  viewerId: string | null,
  hasFullAccess: boolean,
): boolean {
  if (hasFullAccess) return true;
  return Boolean(viewerId) && view.ownerId === viewerId;
}

/**
 * May this viewer SAVE a view: rename it, re-order it, switch its type, store
 * a filter/group/sort config on it, or flip it between Private and Shared?
 *
 * Saving a view is CONTENT work on a List, not management OF the List, so the
 * gate is the contribute ladder (any non-guest Space or Board member) plus the
 * view's own owner. It used to be the Space MANAGE ladder (OWNER / ADMIN), so
 * a Space member who may create and edit every task on a List could not save
 * a view on it: the control rendered and the PATCH answered 403.
 *
 * Deleting a view is NOT this gate. A shared view is other people's saved
 * work, so removal stays on `canManageView`.
 */
export function canSaveView(
  view: Pick<ViewLike, "ownerId">,
  viewerId: string | null,
  canContribute: boolean,
): boolean {
  if (canContribute) return true;
  return Boolean(viewerId) && view.ownerId === viewerId;
}

/**
 * The last remaining view is never deletable: a List with no view has no body
 * to render. The UI hides the row; the route refuses it with a 400.
 */
export function canDeleteView(
  view: ViewLike,
  allViews: readonly ViewLike[],
  viewerId: string | null,
  hasFullAccess: boolean,
): boolean {
  if (allViews.length <= 1) return false;
  return canManageView(view, viewerId, hasFullAccess);
}

/** Toggle one id in a personal pin list, preserving order. */
export function togglePinned(pinned: readonly string[], viewId: string): string[] {
  return pinned.includes(viewId) ? pinned.filter((id) => id !== viewId) : [...pinned, viewId];
}
