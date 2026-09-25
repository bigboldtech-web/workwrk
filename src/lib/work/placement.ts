// Where an object sits in Work: its address, its crumb trail, its Back
// target, where a Trash of it lands, which sidebar rows may carry its pill
// and which tree branch opens to show it.
//
// The server half (placement-server.ts) fetches the facts with org-scoped
// queries and the existing access gates, and hands them to the assemblers
// here. Everything in this file is pure: it decides nothing about access,
// it only arranges facts the loader already proved readable, which is what
// lets the test cover every shape without a database.
//
// Imports: object-href and route-hub, plus type-only imports from the pure
// open-object store. Nothing through the "@/" alias, so the test is node-only.

import { addressHref, objectHref, sameAddress, type ObjectKind } from "../nav/object-href";
import { WORK_HOME_HREF } from "../nav/route-hub";
import type { PillCandidates, TreeReveal } from "../nav/open-object";

/** One crumb after the hub. Plain data: it crosses the server-client boundary. */
export interface PlacementCrumb {
  label: string;
  /** Absent when the viewer cannot open the page it names (a folder-only grantee's Space). */
  href?: string;
  /** The Space crumb's tile. */
  tile?: { icon: string | null; color: string | null; name: string };
}

export interface WorkPlacementData {
  /** The one Work address this object has for this viewer. */
  address: string;
  /** The Space the address is scoped under; null at the door. */
  spaceSlug: string | null;
  /** The object's name when the server knows it; the editor reports the live one. */
  title: string | null;
  /** Work > [trail] > {object}. Every entry is readable and org-verified. */
  trail: PlacementCrumb[];
  /** The BackButton fallback: the nearest crumb left of the object that has an href. */
  back: { href: string; label: string };
  /** Where a Trash of the open object lands in Work: the same crumb. */
  closeHref: string;
  pill: PillCandidates;
  reveal: TreeReveal | null;
}

export type WorkGate =
  | { state: "ok"; placement: WorkPlacementData }
  | { state: "missing" }
  | { state: "error" }
  | { state: "signedOut" };

export type WorkView =
  | { view: "editor"; placement: WorkPlacementData }
  | { view: "replace"; address: string; placement: WorkPlacementData }
  | { view: "missing" }
  | { view: "error" }
  | { view: "nothing" };

/**
 * What the provider renders.
 *
 * With nothing shown yet (the first render of this object at this address):
 * the editor when the gate places the object at the address requested, a
 * correction to the real address otherwise, and the in-shell 404, the error
 * state or nothing for the three other gate states.
 *
 * With an editor already on screen (the layout re-rendered on
 * router.refresh(), after a move, a rename or a sidebar change): the editor
 * stays mounted whatever the gate now says. An 'ok' re-places it at once, so
 * the crumb and the tree name its new Space; a 'missing', an 'error' or a
 * lost session keeps the last placement on screen, exactly as the canonical
 * client routes keep their page through a refresh. The address bar keeps the
 * address the object was opened at until the next navigation re-places it,
 * so no Move path can unmount an editor holding unsaved work.
 */
export function decideWorkView(requested: string, gate: WorkGate, shown: WorkPlacementData | null): WorkView {
  if (shown) return { view: "editor", placement: gate.state === "ok" ? gate.placement : shown };
  switch (gate.state) {
    case "ok":
      return sameAddress(requested, gate.placement.address)
        ? { view: "editor", placement: gate.placement }
        : { view: "replace", address: gate.placement.address, placement: gate.placement };
    case "missing":
      return { view: "missing" };
    case "error":
      return { view: "error" };
    case "signedOut":
      return { view: "nothing" };
  }
}

/** The last correction the provider made: which object, and to where. */
export interface LastCorrection {
  objectKey: string;
  to: string;
}

/**
 * One correction per navigation. When the address a correction landed on
 * disagrees with the gate AGAIN, something is wrong with the placement (a
 * bug, never the person), and a second router.replace could spin the router
 * forever. That second disagreement renders in place and is logged instead.
 */
export function correctionAllowed(last: LastCorrection | null, objectKey: string, requested: string): boolean {
  return !(last && last.objectKey === objectKey && sameAddress(last.to, requested));
}

/** The Back target: the nearest crumb left of the object that has an href, else Work's landing. */
export function backFromTrail(trail: readonly PlacementCrumb[]): { href: string; label: string } {
  for (let i = trail.length - 1; i >= 0; i -= 1) {
    const c = trail[i];
    if (c.href) return { href: c.href, label: c.label };
  }
  return { href: WORK_HOME_HREF, label: "Work" };
}

/** The deepest folder level the Work tree renders (GET /api/spaces/[id]/children loads three). */
export const TREE_FOLDER_DEPTH = 3;

/** One folder on the way from the Space down to the object, root first. */
export interface FolderStep {
  id: string;
  /** The Work tree's own prune rule for a full viewer: folderVisibleTo, and not archived. */
  visible: boolean;
  /** A FolderMember grant of the viewer's on this folder (folder-only grantees). */
  granted: boolean;
}

/** How much of the Space the viewer's Work tree shows (lib/folder folderAccessForSpace). */
export type TreeAccess = "full" | "scoped" | "none";

/**
 * The folder rows the viewer's Work tree renders on the way to an object,
 * root first: the ids a reveal may open and the ids a pill may fall back to.
 *
 *   full    the tree's own rule: a folder shows only when it and every
 *           ancestor pass the prune rule, and only to the depth the tree
 *           loads. The walk stops at the first folder that would not render.
 *   scoped  a folder-only grantee's tree lifts each granted folder to the
 *           top level and never prunes beneath it, so the walk starts at the
 *           NEAREST grant above the object and stops at the depth limit.
 *   none    nothing.
 *
 * `complete` is false when the loader's ancestor walk ran out of hops before
 * reaching a top-level folder; such a path is deeper than the tree renders.
 * No folder id the viewer's tree would not render is ever returned, so none
 * is expanded or sent to the browser.
 */
export function treeFolderIds(path: readonly FolderStep[], access: TreeAccess, complete = true): string[] {
  if (access === "none" || path.length === 0) return [];
  if (access === "full") {
    if (!complete) return [];
    const out: string[] = [];
    for (const step of path) {
      if (!step.visible || out.length >= TREE_FOLDER_DEPTH) break;
      out.push(step.id);
    }
    return out;
  }
  let start = -1;
  for (let i = path.length - 1; i >= 0; i -= 1) {
    if (path[i].granted) {
      start = i;
      break;
    }
  }
  return start < 0 ? [] : path.slice(start, start + TREE_FOLDER_DEPTH).map((s) => s.id);
}

/** A Space the viewer can see in the Work tree. */
export interface SpaceFact {
  id: string;
  slug: string;
  name: string;
  icon: string | null;
  color: string | null;
  /** "scoped": a folder-only grantee, whose Space is a bare container they cannot open. */
  access: "full" | "scoped";
}

function spaceCrumb(space: SpaceFact): PlacementCrumb {
  return {
    label: space.name,
    ...(space.access === "full" ? { href: `/spaces/${encodeURIComponent(space.slug)}` } : {}),
    tile: { icon: space.icon, color: space.color, name: space.name },
  };
}

/** Everything the loader proved about a doc, and nothing it could not. */
export interface DocFacts {
  id: string;
  title: string | null;
  /** The doc's Space (its own anchor's, or its anchored parent's), only when the viewer sees it in Work. */
  space: SpaceFact | null;
  /** Root-first folders to the doc's own Folder or its List's Folder, with the tree's flags. */
  folderPath: FolderStep[];
  /** False when the ancestor walk stopped before a top-level folder. */
  folderPathComplete: boolean;
  /** The doc's own Folder or its List's Folder, when readable: its crumb. */
  folder: { id: string; name: string } | null;
  /** The List of a List doc or a task doc, when readable. */
  list: { id: string; slug: string; name: string } | null;
  /** The task of a task doc, when readable. */
  task: { id: string; title: string | null } | null;
  /** Readable parent docs, NEAREST first, up to the first anchored or unreadable one. */
  parents: { id: string; title: string | null }[];
  /** The anchored ancestor a sub-page takes its place from, for the pill. */
  anchorDocId: string | null;
}

/** A doc's placement: Work > Space > (Folder) > (List > Task) > (parent docs) > doc. */
export function assembleDocPlacement(f: DocFacts): WorkPlacementData {
  const slug = f.space?.slug ?? null;
  const trail: PlacementCrumb[] = [];
  if (f.space) trail.push(spaceCrumb(f.space));
  if (f.folder) trail.push({ label: f.folder.name, href: `/folders/${encodeURIComponent(f.folder.id)}` });
  if (f.list) trail.push({ label: f.list.name, href: `/boards/${encodeURIComponent(f.list.slug)}` });
  if (f.task) trail.push({ label: f.task.title || "Untitled task", href: `/item/${encodeURIComponent(f.task.id)}` });
  for (const p of [...f.parents].reverse()) {
    trail.push({ label: p.title || "Untitled doc", href: objectHref("doc", p.id, "home", slug) });
  }

  const access: TreeAccess = f.space?.access ?? "none";
  const treeFolders = f.space ? treeFolderIds(f.folderPath, access, f.folderPathComplete) : [];
  const back = backFromTrail(trail);
  const ancestors = [
    ...(f.anchorDocId ? [`doc:${f.anchorDocId}`] : []),
    ...(f.list ? [`list:${f.list.id}`] : []),
    ...[...treeFolders].reverse().map((id) => `folder:${id}`),
    ...(f.space ? [`space:${f.space.id}`] : []),
  ];

  return {
    address: addressHref("doc", f.id, slug ? { scope: "space", slug } : { scope: "work" }),
    spaceSlug: slug,
    title: f.title,
    trail,
    back,
    closeHref: back.href,
    pill: { selfKey: `doc:${f.id}`, favKey: `fav:doc:${f.id}`, ancestors },
    reveal: f.space ? { spaceId: f.space.id, folderIds: treeFolders } : null,
  };
}

/** What the loader proved about a table or a canvas. */
export interface SpaceItemFacts {
  id: string;
  title: string | null;
  space: SpaceFact | null;
  /**
   * A canvas's Folder (Whiteboard.folderId), root-first with the tree's flags,
   * when it names a Folder in the canvas's own Space. Tables have no Folder.
   */
  folder?: {
    id: string;
    name: string;
    path: FolderStep[];
    /** False when the ancestor walk stopped before a top-level folder. */
    complete: boolean;
  } | null;
}

/**
 * Does the viewer's Work tree render this item under its Folder? Only when
 * every folder on the way renders (treeFolderIds' full rule: visible, not
 * archived, within the depth the tree loads) and the walk ends AT the item's
 * own Folder. GET /api/spaces/[id]/children nests a canvas by the same test
 * (its Folder is among the folders it renders), so the crumb and the tree
 * never disagree; any other canvas sits at the Space's top level in both.
 */
export function nestedFolderIds(folder: SpaceItemFacts["folder"]): string[] {
  if (!folder || folder.path.length === 0) return [];
  const ids = treeFolderIds(folder.path, "full", folder.complete);
  return ids.length === folder.path.length && ids[ids.length - 1] === folder.id ? ids : [];
}

/**
 * A table's or a canvas's placement: Work > Space > (Folder) > item. A table
 * has no Folder. A canvas made inside a Folder names it, and its reveal opens
 * the branch down to it, exactly when the Work tree renders it there
 * (nestedFolderIds); otherwise (no Folder, a stale one, one the viewer's
 * tree prunes) the crumb names the Space only, where the tree lists it.
 */
export function assembleSpaceItemPlacement(kind: "table" | "canvas", f: SpaceItemFacts): WorkPlacementData {
  const slug = f.space?.slug ?? null;
  const folderIds = f.space && f.space.access === "full" ? nestedFolderIds(f.folder) : [];
  const trail: PlacementCrumb[] = f.space ? [spaceCrumb(f.space)] : [];
  if (f.folder && folderIds.length > 0) {
    trail.push({ label: f.folder.name, href: `/folders/${encodeURIComponent(f.folder.id)}` });
  }
  const back = backFromTrail(trail);
  const ancestors = f.space ? [...[...folderIds].reverse().map((id) => `folder:${id}`), `space:${f.space.id}`] : [];
  return {
    address: addressHref(kind, f.id, slug ? { scope: "space", slug } : { scope: "work" }),
    spaceSlug: slug,
    title: f.title,
    trail,
    back,
    closeHref: back.href,
    pill: { selfKey: `${kind}:${f.id}`, favKey: `fav:${kind}:${f.id}`, ancestors },
    reveal: f.space ? { spaceId: f.space.id, folderIds } : null,
  };
}

/**
 * An SOP's or a form's placement: the door, with nothing named. Neither has a
 * Space, and neither route reads the object on the server (the canonical ones
 * do not either: their editors' own APIs are the gate), so the crumb is
 * Work > {title the editor reports}.
 */
export function staticDoorPlacement(kind: "sop" | "form", id: string): WorkPlacementData {
  const back = backFromTrail([]);
  return {
    address: addressHref(kind, id, { scope: "work" }),
    spaceSlug: null,
    title: null,
    trail: [],
    back,
    closeHref: back.href,
    pill: { selfKey: `${kind}:${id}`, favKey: `fav:${kind}:${id}`, ancestors: [] },
    reveal: null,
  };
}

/** The crumb label while the editor has not reported a title. */
export const KIND_NOUN: Readonly<Record<ObjectKind, string>> = {
  doc: "Untitled doc",
  table: "Untitled table",
  canvas: "Untitled canvas",
  sop: "SOP",
  form: "Form",
};
