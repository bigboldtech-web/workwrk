// The three window events the Work surfaces agree on.
//
// Spec: docs/plans/ui-refresh/spec-spaces-lists.md section 3 (`useContainerEvents`
// at `src/lib/work/container-events.ts`) and the Realtime line of every route
// in section 2 ("refetches on `workwrk:tree-changed` and on window focus; no
// poll").
//
// WHY A MODULE AND NOT A STRING IN EIGHT FILES. The tree, the Space page, the
// Folder page, Favorites and every container menu all need to hear "something
// in the tree moved". Today each one invents its own: `refreshSidebar()` walks
// a registry of callbacks, the Space list re-`router.refresh()`es, the
// favorites section listens for `workwrk:favs-changed`, and a rename in the
// sidebar leaves the page title stale until a reload. One name per fact, typed
// once, is the difference between a rename showing everywhere and showing in
// whichever surface happened to subscribe.
//
// NOTHING HERE THROWS. Dispatch is a no-op on the server and inside a
// render-blocked environment; a listener that throws is the listener's problem
// and never breaks the dispatcher's caller.

export const CONTAINER_EVENTS = {
  /** A Space, Folder or List was created, renamed, moved, archived or deleted. */
  tree: "workwrk:tree-changed",
  /** A grant, a visibility or a Restricted switch changed. */
  access: "workwrk:access-changed",
  /** One task changed in place (the drawer, the bulk bar, an inline edit). */
  item: "workwrk:item-changed",
} as const;

export type ContainerEventName = (typeof CONTAINER_EVENTS)[keyof typeof CONTAINER_EVENTS];

export interface TreeChangedDetail {
  /** What changed, so a listener can decide whether it cares. */
  kind?: "space" | "folder" | "list" | "doc" | "canvas" | "table";
  id?: string;
  action?: "created" | "renamed" | "moved" | "archived" | "deleted" | "restored";
}

export interface AccessChangedDetail {
  kind?: "space" | "folder" | "list";
  id?: string;
}

export interface ItemChangedDetail {
  id: string;
  boardId?: string | null;
}

type DetailFor<N extends ContainerEventName> =
  N extends typeof CONTAINER_EVENTS.tree ? TreeChangedDetail
  : N extends typeof CONTAINER_EVENTS.access ? AccessChangedDetail
  : ItemChangedDetail;

/** Fire one of the three. Safe on the server and in a test without a DOM. */
export function dispatchContainerEvent<N extends ContainerEventName>(
  name: N,
  detail?: DetailFor<N>,
): void {
  if (typeof window === "undefined") return;
  try {
    window.dispatchEvent(new CustomEvent(name, { detail }));
  } catch {
    // A browser that refuses CustomEvent is not a reason to fail the write
    // that just succeeded.
  }
}

/** Convenience wrappers so call sites never retype the string. */
export function treeChanged(detail?: TreeChangedDetail): void {
  dispatchContainerEvent(CONTAINER_EVENTS.tree, detail);
}
export function accessChanged(detail?: AccessChangedDetail): void {
  dispatchContainerEvent(CONTAINER_EVENTS.access, detail);
}
export function itemChanged(detail: ItemChangedDetail): void {
  dispatchContainerEvent(CONTAINER_EVENTS.item, detail);
}

/**
 * Subscribe to one or more of the three, plus window focus when asked.
 * Returns the unsubscriber; never throws if the environment has no window.
 */
export function subscribeContainerEvents(
  names: readonly ContainerEventName[],
  handler: () => void,
  opts: { onFocus?: boolean } = {},
): () => void {
  if (typeof window === "undefined") return () => {};
  const listener = () => {
    try {
      handler();
    } catch {
      // One bad subscriber must not stop the others on the same event.
    }
  };
  for (const n of names) window.addEventListener(n, listener);
  if (opts.onFocus) window.addEventListener("focus", listener);
  return () => {
    for (const n of names) window.removeEventListener(n, listener);
    if (opts.onFocus) window.removeEventListener("focus", listener);
  };
}
