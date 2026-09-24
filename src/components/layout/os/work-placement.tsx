"use client";

// WorkPlacementProvider: what an object's Work address renders, and the
// hooks the editors, the tree and the favourites read it through.
//
// The server gate (src/components/access/work-object-gate.tsx) says where the
// object sits for this viewer; decideWorkView (src/lib/work/placement.ts)
// picks the view:
//   - the editor, when the object is at the address requested;
//   - a correction, when it lives somewhere else (the door for a Space item,
//     another Space's slug, a Space it has left): RouteLoadingView and one
//     router.replace to its real address, keeping the query and the hash,
//     before any editor mounts, so nothing ever renders under a wrong crumb;
//   - the in-shell 404 in Work chrome, the error state, or nothing for a
//     signed-out visitor (the dashboard layout sends them to /login).
// Once an editor is on screen it is never unmounted by this provider: a
// router.refresh() after a Move re-places it at once (new crumb, new tree
// branch) and every other gate answer keeps the last placement on screen.
//
// THE CRUMB is declared here, once, from the server placement, so the bar
// reads Work > Space > (Folder) > {object} from the first frame and never
// flashes a fallback while the editor loads. Editors report their live
// title through useWorkTitle and declare no Breadcrumb of their own in Work.
//
// THE OPEN OBJECT is published to src/lib/nav/open-object.ts while the
// editor is shown, and cleared when this page goes. The published address is
// the one this layout was rendered for, never usePathname(), which is the
// task drawer's /item/<id> while the drawer is open over the page.

import {
  createContext, useContext, useEffect, useId, useLayoutEffect, useMemo, useRef, useState, useSyncExternalStore,
  type ReactNode, type RefObject,
} from "react";
import { usePathname, useRouter } from "next/navigation";
import { Breadcrumb } from "./top-bar/breadcrumb";
import { RouteLoadingView } from "./route-loading-view";
import { NotFoundView } from "@/components/access/not-found-view";
import { ErrorState } from "@/components/ui/error-state";
import { BackButton } from "@/components/ui/back-button";
import { WORK_HOME_HREF } from "@/lib/nav/route-hub";
import {
  canonicalHref, closedObjectHref, openedObject, sameAddress, type ObjectKind,
} from "@/lib/nav/object-href";
import {
  clearOpenObject, favoriteKey, publishOpenObject, readOpenObject, registerRenderedRow, rowPillState,
  subscribeOpenObject, type PublishedObject,
} from "@/lib/nav/open-object";
import {
  KIND_NOUN, correctionAllowed, decideWorkView, type LastCorrection, type WorkGate, type WorkPlacementData, type WorkView,
} from "@/lib/work/placement";

/** What an editor inside a Work address reads about where it is. */
export interface WorkPlacement {
  kind: ObjectKind;
  id: string;
  /** The address the object is mounted at: query-only navigations go here. */
  self: string;
  /** The Space the address is scoped under, for building siblings' addresses. */
  spaceSlug: string | null;
  /** The BackButton fallback: the nearest crumb left of the object with an href. */
  back: { href: string; label: string };
  /** Where a Trash of this object lands in Work. */
  closeHref: string;
}

const PlacementCtx = createContext<WorkPlacement | null>(null);
const TitleCtx = createContext<((title: string) => void) | null>(null);

// The last correction any provider made. Module state, because the provider
// that corrects is not the one that lands: the correction swaps the route,
// and a brand-new provider renders at the corrected address.
let lastCorrection: LastCorrection | null = null;

export function WorkPlacementProvider({
  kind, id, requested, gate, children,
}: {
  kind: ObjectKind;
  id: string;
  /** The address this route stands for, rebuilt from its own params. */
  requested: string;
  gate: WorkGate;
  children: ReactNode;
}) {
  const router = useRouter();
  const instance = useId();
  const objectKey = `${kind}:${id}`;
  // The placement this provider last rendered its editor with. Stored from
  // render (React's "information from previous renders" pattern), so the
  // decision below never reads a ref during render.
  const [shown, setShown] = useState<WorkPlacementData | null>(null);
  const [liveTitle, setLiveTitle] = useState<string | null>(null);

  const decided = decideWorkView(requested, gate, shown);
  // A second disagreement at the address a correction just landed on is a
  // placement bug, never the person's doing: render in place (and log it
  // below) rather than send the router round again.
  const blocked = decided.view === "replace" && !correctionAllowed(lastCorrection, objectKey, requested);
  const view: WorkView = blocked && decided.view === "replace" ? { view: "editor", placement: decided.placement } : decided;
  const placement = view.view === "editor" ? view.placement : null;
  if (placement && shown !== placement) setShown(placement);

  const replaceTo = view.view === "replace" ? view.address : null;
  useLayoutEffect(() => {
    if (!replaceTo) return;
    lastCorrection = { objectKey, to: replaceTo };
    router.replace(`${replaceTo}${window.location.search}${window.location.hash}`, { scroll: false });
  }, [replaceTo, objectKey, router]);

  useEffect(() => {
    if (!blocked) return;
    console.error(`[work-placement] ${objectKey} is placed at a different address than ${requested} again; rendering it in place.`);
  }, [blocked, objectKey, requested]);

  // A correction is spent once its object is on screen, or once the person
  // has moved on to another object before it landed.
  const onScreen = placement !== null;
  useEffect(() => {
    if (!onScreen || !lastCorrection) return;
    if (lastCorrection.objectKey !== objectKey || sameAddress(lastCorrection.to, requested)) lastCorrection = null;
  }, [onScreen, objectKey, requested]);

  // Publish the open object while its editor is shown.
  const pubKey = `${objectKey}@${instance}`;
  useLayoutEffect(() => {
    if (!placement) return;
    publishOpenObject({
      kind,
      id,
      self: requested,
      closeHref: placement.closeHref,
      pill: placement.pill,
      reveal: placement.reveal,
      key: pubKey,
    });
    return () => clearOpenObject(pubKey);
  }, [placement, kind, id, requested, pubKey]);

  const value = useMemo<WorkPlacement | null>(
    () => (placement
      ? { kind, id, self: requested, spaceSlug: placement.spaceSlug, back: placement.back, closeHref: placement.closeHref }
      : null),
    [placement, kind, id, requested],
  );

  if (view.view === "replace") return <RouteLoadingView />;
  if (view.view === "missing") return <NotFoundView />;
  if (view.view === "error") {
    return (
      <ErrorState what="this page" title="This page couldn't load" onRetry={() => router.refresh()}>
        <BackButton fallbackHref={WORK_HOME_HREF} label="Work" />
      </ErrorState>
    );
  }
  if (view.view === "nothing" || !placement) return null;

  return (
    <PlacementCtx.Provider value={value}>
      <TitleCtx.Provider value={setLiveTitle}>
        <Breadcrumb items={[...placement.trail, { label: liveTitle || placement.title || KIND_NOUN[kind] }]} />
        {children}
      </TitleCtx.Provider>
    </PlacementCtx.Provider>
  );
}

/** Where the object on this Work address sits, or null outside one (the Docs and Tables hubs). */
export function useWorkPlacement(): WorkPlacement | null {
  return useContext(PlacementCtx);
}

/**
 * An editor's live title, for the Work crumb. Pass null when the editor is
 * not the one this address shows (a peek pane, the canonical routes): a null
 * report changes nothing, so a second editor on the page can never blank the
 * primary one's crumb.
 */
export function useWorkTitle(title: string | null): void {
  const report = useContext(TitleCtx);
  useEffect(() => {
    if (!report || title === null) return;
    report(title);
  }, [report, title]);
}

/** The object open in the main area, and where it is mounted. */
export interface OpenObject {
  kind: ObjectKind;
  id: string;
  self: string;
  closeHref: string;
}

function fromPublished(p: PublishedObject): OpenObject {
  return { kind: p.kind, id: p.id, self: p.self, closeHref: p.closeHref };
}

/** A canonical page's own object, read from its path. Work addresses answer only through the store. */
export function canonicalOpenObject(pathname: string): OpenObject | null {
  const o = openedObject(pathname);
  if (!o || o.scope !== "canonical") return null;
  return { kind: o.kind, id: o.id, self: canonicalHref(o.kind, o.id), closeHref: closedObjectHref(o.kind) };
}

/**
 * The object open in the main area: the one a Work page published, or on a
 * canonical page (/docs/[id], /tables/[id]) the one its path names. Null on a
 * list, a 404 and every other page.
 */
export function useOpenObject(): OpenObject | null {
  const published = useSyncExternalStore(subscribeOpenObject, readOpenObject, () => null);
  const pathname = usePathname() || "/";
  return useMemo(() => (published ? fromPublished(published) : canonicalOpenObject(pathname)), [published, pathname]);
}

/** The same answer, read at the moment a handler runs (a click, a toast action, a timer). */
export function currentOpenObject(): OpenObject | null {
  const published = readOpenObject();
  if (published) return fromPublished(published);
  return typeof window === "undefined" ? null : canonicalOpenObject(window.location.pathname);
}

/**
 * A Work tree row's pill. Every row passes its own key ('doc:<id>',
 * 'folder:<id>', 'space:<id>'...); a row that is a candidate for the open
 * object registers as rendered while it is mounted, and exactly one
 * registered candidate is active (open-object.ts pickPill). The row the pill
 * lands on for a newly opened object scrolls into view once, so the lit row
 * is on screen in a long tree.
 */
export function useTreePill<T extends HTMLElement = HTMLElement>(key: string): { active: boolean; ref: RefObject<T | null> } {
  const state = useSyncExternalStore(subscribeOpenObject, () => rowPillState(key), () => "none" as const);
  const openKey = useSyncExternalStore(subscribeOpenObject, () => readOpenObject()?.key ?? null, () => null);
  const candidate = state !== "none";
  useEffect(() => (candidate ? registerRenderedRow(key) : undefined), [candidate, key]);
  const ref = useRef<T | null>(null);
  const scrolledFor = useRef<string | null>(null);
  const active = state === "active";
  useEffect(() => {
    if (!active || !openKey || scrolledFor.current === openKey) return;
    scrolledFor.current = openKey;
    ref.current?.scrollIntoView({ block: "nearest" });
  }, [active, openKey]);
  return { active, ref };
}

/** A FAVORITES row's pill: 'fav:<kind>:<id>', outranked by the object's own tree row. */
export function useFavoritePill<T extends HTMLElement = HTMLElement>(kind: ObjectKind, id: string) {
  return useTreePill<T>(favoriteKey(kind, id));
}

/**
 * A key for the branch the Work tree should open for the open object: it
 * changes only when that branch does (a new object, a new address, a Move
 * that re-placed it), so the tree reveals it once per placement. Null when
 * the open object has no Space in the viewer's tree. The branch itself is
 * read from the store (readOpenObject().reveal) when the key changes.
 */
export function useOpenRevealKey(): string | null {
  return useSyncExternalStore(
    subscribeOpenObject,
    () => {
      const p = readOpenObject();
      return p?.reveal ? `${p.kind}:${p.id}@${p.self}|${p.reveal.spaceId}|${p.reveal.folderIds.join(",")}` : null;
    },
    () => null,
  );
}
