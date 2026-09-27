"use client";

// SpaceTreeRow — expandable Space row for the HomeSidebar.
// Click the chevron → lazy-fetches /api/spaces/[id]/children, renders
// nested folders + boards inline. Each child is click-to-navigate.
//
// ONE "…" PER ROW (spec-spaces-lists section 1, Row anatomy): "Hover on any
// row reveals ONE 28px ghost '…' at the right. Right-click opens the same menu.
// There are no other hover icons: star and '+' live inside the menu.
// The star and the "+" leave the three container rows; Doc, Canvas and Table
// rows keep theirs, because their menus belong to other units.
//
// The three icons that used to sit there were a star (Favorite), a "…" and a
// "+", which is three targets inside 28 pixels of a 36px row, and the star and
// the "+" were both duplicates of rows already inside the menu. Every
// destination they had is in `ContainerMenu`: Favorite is its first row, and
// New > List / Sprint / Folder / Doc / Canvas / Table is the "+".
//
// GLYPH VOCABULARY (spec section 1, fixed by access 6.1 and not varied here):
// a LOCK means Restricted, a GLOBE means Everyone at {org}, and there is no
// third use. A Space carries a globe when it is ORG-visible and NOTHING
// otherwise, because "a lock never appears on a Space the viewer can open: a
// Space is never Restricted". This file used to put a lock on a PRIVATE Space
// (the third meaning the spec forbids) and no globe on an ORG one.
//
// THE ROLE EVERY "…" NEEDS comes down with the row, from
// `GET /api/spaces` and `GET /api/spaces/[id]/children`. Without it the menu
// falls back to the reader's rows, which is the safe direction but hides
// Rename / Move / Duplicate from people who do hold them. Each row's role is
// the server's answer for THAT node (a Folder grant is the Folder's, never its
// Space's), passed to the row's own menu: docs, canvases and tables included.
//
// PATH ROWS (decision A3). Someone given one node deep inside a Space sees
// its Space and its parent Folders as bare names on the way to it: the Space
// row carries access "path" (GET /api/spaces?paths=1) and a Folder row
// `path: true`. Such a row has no create door, a menu that is exactly Copy
// link, no drag in or out, and a chevron only for the branches it renders.
//
// A DOC, TABLE OR CANVAS OPENS IN PLACE (founder, 2026-09-24). Their rows are
// Links to the item's Space-scoped Work address, /spaces/{slug}/docs/{id} and
// its two siblings (src/lib/nav/object-href.ts), so the Work sidebar stays on
// the left, the item opens in the main area, and the rail never switches to
// the Docs or Tables hub. They used to push /docs/{id} and /tables/{id}. As
// Links, Cmd-click, middle-click and "Copy link address" give the Work
// address too. The Space's slug is threaded down from SpaceTreeRow to every
// row and every create door beneath it for exactly this.
//
// THE PILL follows what is actually rendered, for the object actually open
// (useTreePill, src/lib/nav/open-object.ts): the item's own row, else its
// favourite, else its nearest rendered ancestor (its List, its Folders, its
// Space). The three leaf rows light by the pill alone; Space, Folder and List
// rows also keep their own exact URL match.

import { useState, useEffect, useRef, type DragEvent } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { refreshSidebar, onSidebarRefresh } from "./sidebar-refresh";
import {
  ChevronDown, ChevronRight, Lock, Globe, Folder as FolderIcon, FolderOpen,
  Table as TableIcon, FileText, Pencil as WhiteboardIcon, ListChecks,
  MoreHorizontal, IterationCw,
} from "lucide-react";
import { parseSprintMeta } from "@/lib/sprint";
import { EntityTile } from "@/components/ui/entity-tile";
import { ContainerMenuTrigger } from "./container-menu";
import { CreateInsideTrigger } from "./space-create-popover";
import type { ContainerRole } from "@/lib/work/container-menu";
import { DocRowMenuHost, useDocRowMenu } from "@/components/docs/doc-row-menu";
import { TableRowMenuHost, useTableRowMenu } from "@/components/tables/table-row-menu";
import { type ContextMenuHandle } from "./more-portal";
import { CanvasMoreTrigger } from "./canvas-more-menu";
import { useOsToast } from "./toast";
import { uploadDroppedFiles, dragHasFiles } from "@/lib/upload-dropped-files";
import { SkeletonLines } from "@/components/ui/skeleton";
import {
  hydrateSidebarState, isExpanded as storedExpanded, setExpanded as storeExpanded,
  subscribeSidebarState,
} from "@/lib/work/sidebar-expand";
// Doc, Canvas and Table rows keep their own unit's menu and their own star:
// spec-spaces-lists section 1 exempts them ("except View, Doc / Canvas / Table
// rows, which use their own units' menus"). Only the three container rows this
// unit owns collapse to one "…".
import { SidebarQuickStar } from "./sidebar-quick-star";
import { useTreePill } from "./work-placement";
import { objectHref } from "@/lib/nav/object-href";
import { treeKey } from "@/lib/nav/open-object";

// Expand state for the sidebar tree, keyed by id.
//
// The in-memory maps are the fast path: a row must decide "am I open?" during
// render, not after a fetch. `src/lib/work/sidebar-expand.ts` puts a stored
// preference (`sidebar.expanded[]`) behind them, so a reload, a second tab and
// tomorrow morning all open the same rows, which is what the maps alone could
// never do (spec-spaces-lists section 1, Tree data).
const spaceExpandStore = new Map<string, boolean>();
const folderExpandStore = new Map<string, boolean>();
// Cache a Space's loaded children too, so a remount restores the tree instantly
// instead of flashing "Loading…" and refetching. Refreshed live via onSidebarRefresh.
const spaceChildrenStore = new Map<string, ChildrenPayload>();

// ---------------------------------------------------------------------------
// Drag-and-drop: move sidebar items between folders / to the Space root.
// Only the entities a folder can physically hold are draggable today: lists
// (boards) re-parent via board.folderId; folders nest via folder.parentFolderId.
// Drop targets are folders (drop INTO) and the Space row (drop to root).
// ---------------------------------------------------------------------------
const DND_MIME = "application/x-wwrk-tree-item";
type DragKind = "board" | "folder" | "doc";
interface DragPayload { kind: DragKind; id: string }

function startTreeDrag(e: DragEvent, payload: DragPayload) {
  e.dataTransfer.setData(DND_MIME, JSON.stringify(payload));
  // A per-kind marker type: getData() is blocked during dragover, but `types`
  // is readable — so this lets a drop target know it's a folder (vs a board/doc)
  // mid-hover and offer before/after reorder zones accordingly.
  e.dataTransfer.setData(`${DND_MIME}-${payload.kind}`, "1");
  e.dataTransfer.effectAllowed = "move";
}

// Readable during dragover: is the thing being dragged a folder?
function isFolderDrag(e: DragEvent): boolean {
  return e.dataTransfer.types.includes(`${DND_MIME}-folder`);
}

/** What a tree write answered: ok, or the one sentence the server refused it with (the placement rule, P6). */
type TreeWrite = { ok: true } | { ok: false; error: string };

async function treeWrite(url: string, method: "POST" | "PUT", body: Record<string, unknown>, opts: { keepalive?: boolean } = {}): Promise<TreeWrite> {
  try {
    const res = await fetch(url, {
      method,
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
      ...(opts.keepalive ? { keepalive: true } : {}),
    });
    if (res.ok) return { ok: true };
    const d = (await res.json().catch(() => null)) as { error?: unknown; message?: unknown } | null;
    const error = typeof d?.error === "string" && d.error.includes(" ") ? d.error : typeof d?.message === "string" ? d.message : "Couldn't move it there.";
    return { ok: false, error };
  } catch {
    return { ok: false, error: "Couldn't move it there." };
  }
}

// Reorder a folder to sit directly before/after `targetId` as a sibling. Under
// a new parent that is a move, and the server holds it to the move rule.
async function reorderFolder(movedId: string, targetId: string, place: "before" | "after"): Promise<TreeWrite> {
  return treeWrite("/api/folders/reorder", "POST", { movedId, targetId, place }, { keepalive: true });
}

function readTreeDrag(e: DragEvent): DragPayload | null {
  const raw = e.dataTransfer.getData(DND_MIME);
  if (!raw) return null;
  try { return JSON.parse(raw) as DragPayload; } catch { return null; }
}

// True while a draggable tree item hovers — `types` is readable during dragover
// even though getData() is not.
function isTreeDrag(e: DragEvent): boolean {
  return e.dataTransfer.types.includes(DND_MIME);
}

// ---------------------------------------------------------------------------
// Space reorder: dragging a top-level Space row up/down to change its position
// in the sidebar. Kept on a SEPARATE MIME from the tree-item move above so a
// Space drag never triggers the "drop item into Space root" zone and vice versa.
// ---------------------------------------------------------------------------
const SPACE_MIME = "application/x-wwrk-space-reorder";

function startSpaceDrag(e: DragEvent, spaceId: string) {
  e.dataTransfer.setData(SPACE_MIME, spaceId);
  e.dataTransfer.effectAllowed = "move";
}

function readSpaceDrag(e: DragEvent): string | null {
  return e.dataTransfer.getData(SPACE_MIME) || null;
}

function isSpaceDrag(e: DragEvent): boolean {
  return e.dataTransfer.types.includes(SPACE_MIME);
}

// Persist a move. dest.folderId === null means the Space root; dest.spaceId is
// the Space the drop landed in. Every drop goes to a move endpoint, which
// holds it to the placement rule (node-rules P2 and P3): Full access on the
// item and where it is now, Can edit where it goes, and the Space taken from
// the Folder it lands in. The drop used to PATCH a Folder id alone, so a List
// or a Folder dropped on another Space's Folder kept its old Space.
async function moveTreeItem(p: DragPayload, dest: { folderId: string | null; spaceId: string }): Promise<TreeWrite> {
  if (p.kind === "board") {
    return treeWrite(`/api/boards/${p.id}/move`, "POST", dest.folderId ? { folderId: dest.folderId } : { spaceId: dest.spaceId, folderId: null });
  }
  if (p.kind === "folder") {
    // Guard the obvious self-drop; deeper cycles are refused server-side.
    if (p.id === dest.folderId) return { ok: false, error: "A folder can't move inside itself." };
    return treeWrite(`/api/folders/${p.id}/move`, "POST", dest.folderId ? { parentFolderId: dest.folderId } : { spaceId: dest.spaceId, parentFolderId: null });
  }
  if (p.kind === "doc") {
    // Docs have no folderId column: they re-anchor via the polymorphic
    // entityType/entityId pair the children API already reads, and leave any
    // parent page (a page lives where its parent lives, P3).
    const anchor = dest.folderId
      ? { entityType: "FOLDER", entityId: dest.folderId }
      : { entityType: "SPACE", entityId: dest.spaceId };
    return treeWrite(`/api/docs/${p.id}`, "PUT", { ...anchor, parentId: null });
  }
  return { ok: false, error: "Couldn't move it there." };
}

interface SpaceRow {
  id: string;
  slug: string;
  name: string;
  visibility: "PRIVATE" | "WORKSPACE" | "ORG";
  icon: string | null;
  color: string | null;
  /** From `GET /api/spaces` (SpaceSummary.role). Absent or null = the reader's menu. */
  role?: ContainerRole | null;
  /**
   * "path" (GET /api/spaces?paths=1): the viewer only passes through this
   * Space on the way to something shared inside it (decision A3). The row is
   * a bare name: no create door, and a menu that is exactly Copy link.
   * Absent from an older server, which reads as a member row.
   */
  access?: "member" | "path";
}

interface BoardChild {
  id: string;
  slug: string;
  name: string;
  icon: string | null;
  color: string | null;
  visibility: "PRIVATE" | "WORKSPACE" | "ORG";
  /** Board.settings — sprint Lists carry settings.sprint (parseSprintMeta). */
  settings?: unknown;
  /** The viewer's role on this List, from the children route. Null = the reader's menu. */
  role?: ContainerRole | null;
}

interface FolderChild {
  id: string;
  name: string;
  icon: string | null;
  color: string | null;
  position: number;
  /**
   * The viewer's role on THIS Folder, decided by the server (a Folder grant
   * is the Folder's own, never its Space's). Null or absent = the reader's menu.
   */
  role?: ContainerRole | null;
  /** A path container: named only on the way to something shared inside it (decision A3). */
  path?: boolean;
  visibility?: "PRIVATE" | "WORKSPACE" | "ORG" | null;
  _count: { boards: number; childFolders: number };
  boards: BoardChild[];
  docs: DocChild[];
  /** Canvases made inside this Folder (absent from an older server). */
  whiteboards: WhiteboardChild[];
  childFolders: FolderChild[];
}

interface TableChild {
  id: string;
  name: string;
  description: string | null;
  /** Full access on the table (absent from an older server: treated as yes,
   *  and the server still refuses anyone else). */
  canManage?: boolean;
  /** The viewer's role on the table, from the children route. */
  role?: ContainerRole | null;
}

interface DocChild {
  id: string;
  title: string;
  /** The viewer's role on the doc, from the children route. Absent: its menu asks. */
  role?: ContainerRole | null;
}

interface WhiteboardChild {
  id: string;
  name: string;
  /** The viewer's role on the canvas, from the children route. */
  role?: ContainerRole | null;
}

interface ChildrenPayload {
  folders: FolderChild[];
  boards: BoardChild[];
  tables: TableChild[];
  docs: DocChild[];
  whiteboards: WhiteboardChild[];
}

interface Props {
  space: SpaceRow;
  isActive: boolean;
  onReloadSpaces: () => void;
  // Drag-reorder a Space above/below this one. Omitted (e.g. while searching)
  // disables reordering. `place` is relative to THIS row's midpoint.
  onReorderSpace?: (draggedSpaceId: string, place: "before" | "after") => void;
  reorderable?: boolean;
  /** The menu twins of the drag (spec-shell 1.16); absent at the list's ends. */
  onMoveUp?: () => void;
  onMoveDown?: () => void;
}

export function SpaceTreeRow({
  space,
  isActive,
  onReloadSpaces,
  onReorderSpace,
  reorderable = false,
  onMoveUp,
  onMoveDown,
}: Props) {
  const { toast } = useOsToast();
  const router = useRouter();
  const [expanded, setExpanded] = useState(() => spaceExpandStore.get(space.id) ?? storedExpanded(space.id));
  const [data, setData] = useState<ChildrenPayload | null>(() => spaceChildrenStore.get(space.id) ?? null);
  const [loading, setLoading] = useState(false);
  const [rootDragOver, setRootDragOver] = useState(false);
  // Session memory for the rail's hover-preview remount, and the stored
  // preference for every other way a person comes back.
  useEffect(() => { spaceExpandStore.set(space.id, expanded); storeExpanded(space.id, expanded); }, [expanded, space.id]);
  // Hydrate once, then adopt whatever was stored for this row.
  useEffect(() => {
    let alive = true;
    // Two cases. On first mount the row has no session memory and simply
    // adopts whatever is stored. After that the session memory wins, EXCEPT
    // when something opened this row from outside: a deep link to a Folder or
    // a List asks the tree to reveal its branch (GET /api/work/locate), and a
    // reveal only ever OPENS, so it can never undo a collapse the person made.
    const adopt = () => {
      if (!alive) return;
      if (!spaceExpandStore.has(space.id)) { setExpanded(storedExpanded(space.id)); return; }
      if (storedExpanded(space.id) && !spaceExpandStore.get(space.id)) setExpanded(true);
    };
    const off = subscribeSidebarState(adopt);
    void hydrateSidebarState().then(adopt);
    return () => { alive = false; off(); };
  }, [space.id]);
  // Reorder drop indicator: which edge of this row the dragged Space would land on.
  const [spaceDropEdge, setSpaceDropEdge] = useState<"before" | "after" | null>(null);
  const moreRef = useRef<ContextMenuHandle>(null);
  // Lit on its own page, and as the nearest rendered ancestor of an open
  // item whose own row is not on screen (a collapsed Space, a deep folder).
  const { active: pillActive, ref: pillRef } = useTreePill<HTMLDivElement>(treeKey("space", space.id));
  const lit = isActive || pillActive;
  // A path Space names the way to what was shared inside it and nothing
  // more: no create door, a Copy link only menu, and nothing moved into its
  // root (that needs Full access on the Space, which a path never holds).
  const pathOnly = space.access === "path";

  const loadChildren = () => {
    setLoading(true);
    fetch(`/api/spaces/${space.id}/children`)
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        if (d) {
          const normalizeFolder = (f: FolderChild): FolderChild => ({
            ...f,
            docs: f.docs ?? [],
            whiteboards: f.whiteboards ?? [],
            childFolders: (f.childFolders ?? []).map(normalizeFolder),
          });
          const payload: ChildrenPayload = {
            folders: (d.folders ?? []).map(normalizeFolder),
            boards: d.boards ?? [],
            tables: d.tables ?? [],
            docs: d.docs ?? [],
            whiteboards: d.whiteboards ?? [],
          };
          spaceChildrenStore.set(space.id, payload);
          setData(payload);
        }
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  };

  const toggle = () => {
    if (!expanded && data === null) loadChildren();
    setExpanded((v) => !v);
  };

  // Whenever this row is open and has no children yet, fetch them. It used to
  // run on MOUNT only, which covered the restored-from-the-store case and
  // nothing else: a row opened from outside the component (a deep link asking
  // the tree to reveal its branch) flipped to expanded with `data === null`
  // and rendered "Couldn't load" over a fetch that was never made.
  useEffect(() => {
    if (expanded && data === null && !loading) loadChildren();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [expanded, data, loading]);

  const refresh = () => {
    if (expanded) loadChildren();
    onReloadSpaces();
    // Also re-fetch the current route so a create/rename/move made from the
    // sidebar shows up on the page being viewed (e.g. the Space Overview cards)
    // without a manual refresh.
    router.refresh();
  };

  // Re-fetch this Space's children whenever anything in the app signals a
  // sidebar change (create / rename / move / delete), so the tree stays live
  // without a page reload. A ref keeps the listener subscribed once.
  const liveRef = useRef({ expanded, loadChildren });
  useEffect(() => { liveRef.current = { expanded, loadChildren }; });
  useEffect(() => {
    const refetch = () => { if (liveRef.current.expanded) liveRef.current.loadChildren(); };
    const off = onSidebarRefresh(refetch);
    // Doc mutations fired from the Docs app side (docs-changed) must also
    // refresh nested folder docs here — one stale channel = ghost rows.
    window.addEventListener("workwrk:docs-changed", refetch);
    return () => { off(); window.removeEventListener("workwrk:docs-changed", refetch); };
  }, []);

  return (
    <li className="group/space relative">
      <div
        draggable={reorderable}
        onDragStart={(e) => {
          if (!reorderable) return;
          e.stopPropagation();
          startSpaceDrag(e, space.id);
        }}
        onDragOver={(e) => {
          // OS files dropped on a Space row attach at the Space root.
          if (dragHasFiles(e)) { e.preventDefault(); e.stopPropagation(); setRootDragOver(true); return; }
          if (isSpaceDrag(e)) {
            // Reorder: pick before/after based on cursor vs row midpoint.
            e.preventDefault();
            const rect = e.currentTarget.getBoundingClientRect();
            setSpaceDropEdge(e.clientY < rect.top + rect.height / 2 ? "before" : "after");
            return;
          }
          if (isTreeDrag(e) && !pathOnly) { e.preventDefault(); setRootDragOver(true); }
        }}
        onDragLeave={() => { setRootDragOver(false); setSpaceDropEdge(null); }}
        onDrop={async (e) => {
          if (dragHasFiles(e)) {
            e.preventDefault(); e.stopPropagation();
            setRootDragOver(false); setSpaceDropEdge(null);
            const r = await uploadDroppedFiles(e.dataTransfer.files, { spaceId: space.id });
            toast(r.ok === r.total ? `${r.ok} file${r.ok === 1 ? "" : "s"} added to ${space.name}` : `${r.ok}/${r.total} files added to ${space.name}`);
            return;
          }
          if (isSpaceDrag(e)) {
            e.preventDefault();
            const draggedId = readSpaceDrag(e);
            const edge = spaceDropEdge;
            setSpaceDropEdge(null);
            if (draggedId && draggedId !== space.id && edge) {
              onReorderSpace?.(draggedId, edge);
            }
            return;
          }
          if (!isTreeDrag(e) || pathOnly) return;
          e.preventDefault();
          setRootDragOver(false);
          const p = readTreeDrag(e);
          if (!p) return;
          const moved = await moveTreeItem(p, { folderId: null, spaceId: space.id });
          if (moved.ok) { setExpanded(true); if (!expanded) loadChildren(); else refresh(); refreshSidebar(); }
          else toast(moved.error);
        }}
        ref={pillRef}
        onContextMenu={(e) => { e.preventDefault(); moreRef.current?.openAtPoint(e.clientX, e.clientY); }}
        // The sidebar grid (sidebar-primitives.tsx ROW_BASE): 32px rows, 16px
        // glyphs, 8px gap, 14px labels, 16px per level (the child lists'
        // ps-4 plus each row's ps-3), so every level's labels line up.
        className={`relative flex h-8 items-center gap-2 px-3 rounded-lg text-base ${
          rootDragOver ? "ring-2 ring-inset ring-brand bg-selected" : lit ? "bg-side-pill" : "hover:bg-hover"
        } ${reorderable ? "cursor-pointer" : ""}`}
      >
        {spaceDropEdge ? (
          <span
            className={`pointer-events-none absolute start-1 end-1 h-0.5 rounded-full bg-brand ${
              spaceDropEdge === "before" ? "-top-px" : "-bottom-px"
            }`}
          />
        ) : null}
        <button
          type="button"
          onClick={toggle}
          className="relative shrink-0 inline-flex items-center justify-center"
          aria-label={expanded ? "Collapse Space" : "Expand Space"}
          aria-expanded={expanded}
        >
          <span className="group-hover/space:opacity-0 transition-opacity">
            <EntityTile size="xs" icon={space.icon} color={space.color} name={space.name} />
          </span>
          <span className="absolute inset-0 inline-flex items-center justify-center opacity-0 group-hover/space:opacity-100 transition-opacity text-ink-3">
            {expanded ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronRight className="h-3.5 w-3.5 rtl:rotate-180" />}
          </span>
        </button>
        <Link
          href={`/spaces/${space.slug}`}
          className={`flex items-center gap-1.5 flex-1 min-w-0 ${
            lit ? "text-ink font-medium" : "text-ink"
          }`}
        >
          <span className="min-w-0 flex-1 truncate">{space.name}</span>
          {space.visibility === "ORG" ? (
            <Globe className="w-3 h-3 text-ink-3 shrink-0" aria-label="Everyone in the org" />
          ) : null}
        </Link>
        <span className={`absolute end-1 top-1/2 -translate-y-1/2 inline-flex items-center gap-0.5 rounded ps-1.5 opacity-0 group-hover/space:opacity-100 focus-within:opacity-100 [@media(hover:none)]:opacity-100 transition-opacity ${lit ? "bg-side-pill" : "bg-side"}`}>
          {pathOnly ? null : (
            <CreateInsideTrigger kind="space" spaceId={space.id} spaceSlug={space.slug} role={space.role ?? undefined} onCreated={() => { setExpanded(true); refresh(); }} />
          )}
          <ContainerMenuTrigger
            ref={moreRef}
            compact
            container={{
              kind: "space",
              id: space.id,
              name: space.name,
              slug: space.slug,
              icon: space.icon,
              color: space.color,
              visibility: space.visibility,
              spaceId: space.id,
              spaceSlug: space.slug,
              spaceName: space.name,
            }}
            role={pathOnly ? null : space.role}
            pathOnly={pathOnly}
            onUpdated={() => { onReloadSpaces(); refresh(); }}
            onMoveUp={onMoveUp}
            onMoveDown={onMoveDown}
          />
        </span>
      </div>

      {expanded ? (
        <ul className="mt-0.5 mb-1 ps-4">
          {loading && data === null ? (
            <li><SkeletonLines lines={2} className="px-2 py-1" /></li>
          ) : data === null ? (
            <li className="px-2 py-1 text-xs text-ink-3">Couldn&rsquo;t load</li>
          ) : data.folders.length === 0 && data.boards.length === 0 && data.tables.length === 0 && data.docs.length === 0 && data.whiteboards.length === 0 ? (
            <li className="px-2 py-1 text-xs text-ink-3">Empty</li>
          ) : (
            <>
              {data.folders.map((f) => (
                <FolderTreeRow
                  key={f.id}
                  folder={f}
                  spaceId={space.id}
                  spaceSlug={space.slug}
                  spaceName={space.name}
                  onChanged={refresh}
                />
              ))}
              {data.boards.map((b) => (
                <BoardTreeRow
                  key={b.id}
                  board={b}
                  spaceId={space.id}
                  spaceSlug={space.slug}
                  onChanged={refresh}
                />
              ))}
              {data.docs.map((d) => (
                <DocTreeRow key={d.id} doc={d} spaceSlug={space.slug} />
              ))}
              {data.whiteboards.map((w) => (
                <WhiteboardTreeRow key={w.id} whiteboard={w} spaceSlug={space.slug} onChanged={refresh} />
              ))}
              {data.tables.map((t) => (
                <TableTreeRow key={t.id} table={t} spaceSlug={space.slug} onChanged={refresh} />
              ))}
            </>
          )}
        </ul>
      ) : null}
    </li>
  );
}

function FolderTreeRow({
  folder,
  spaceId,
  spaceSlug,
  spaceName,
  onChanged,
}: {
  folder: FolderChild;
  spaceId: string;
  /** The Space's slug, for the Work addresses of everything beneath. */
  spaceSlug: string;
  spaceName: string;
  onChanged: () => void;
}) {
  const { toast } = useOsToast();
  const [expanded, setExpanded] = useState(() => folderExpandStore.get(folder.id) ?? storedExpanded(folder.id));
  const pathname = usePathname();
  const { active: pillActive, ref: pillRef } = useTreePill<HTMLDivElement>(treeKey("folder", folder.id));
  const isActive = pathname === `/folders/${folder.id}` || pillActive;
  useEffect(() => { folderExpandStore.set(folder.id, expanded); storeExpanded(folder.id, expanded); }, [expanded, folder.id]);
  useEffect(() => {
    let alive = true;
    // Same two cases as the Space row: session memory wins, but an outside
    // reveal (a deep link's ancestor chain) still opens the branch.
    const adopt = () => {
      if (!alive) return;
      if (!folderExpandStore.has(folder.id)) { setExpanded(storedExpanded(folder.id)); return; }
      if (storedExpanded(folder.id) && !folderExpandStore.get(folder.id)) setExpanded(true);
    };
    const off = subscribeSidebarState(adopt);
    void hydrateSidebarState().then(adopt);
    return () => { alive = false; off(); };
  }, [folder.id]);
  // Which drop zone the cursor is in: "inside" nests, "before"/"after" reorder
  // this folder relative to the dragged one. null = not a drop target right now.
  const [dropZone, setDropZone] = useState<"before" | "inside" | "after" | null>(null);
  const moreRef = useRef<ContextMenuHandle>(null);
  // A path Folder (decision A3) is only the way to something shared inside
  // it: no role, no create door, a Copy link only menu, and nothing dragged
  // out of it or dropped into it (both need Full access on the Folder).
  const pathOnly = folder.path === true;
  // What is RENDERED decides the chevron: a count can include branches the
  // viewer cannot open, and a path must never hint at those.
  const hasChildren =
    folder.boards.length > 0 ||
    folder.docs.length > 0 ||
    folder.whiteboards.length > 0 ||
    folder.childFolders.length > 0;

  return (
    <li className="group/folderrow relative">
      <div
        draggable={!pathOnly}
        onDragStart={(e) => { if (pathOnly) return; e.stopPropagation(); startTreeDrag(e, { kind: "folder", id: folder.id }); }}
        onDragOver={(e) => {
          if (pathOnly) return;
          // OS files dropped on a folder row land INSIDE the folder.
          if (dragHasFiles(e)) { e.preventDefault(); e.stopPropagation(); setDropZone("inside"); return; }
          if (!isTreeDrag(e)) return;
          e.preventDefault(); e.stopPropagation();
          // Folder-over-folder gets three zones: top edge = drop ABOVE,
          // bottom edge = drop BELOW, middle = nest inside. Anything else
          // (board/doc) only ever nests, so it's always "inside".
          if (isFolderDrag(e)) {
            const rect = e.currentTarget.getBoundingClientRect();
            const y = e.clientY - rect.top;
            const edge = rect.height * 0.3;
            setDropZone(y < edge ? "before" : y > rect.height - edge ? "after" : "inside");
          } else {
            setDropZone("inside");
          }
        }}
        onDragLeave={() => setDropZone(null)}
        onDrop={async (e) => {
          if (pathOnly) return;
          if (dragHasFiles(e)) {
            e.preventDefault(); e.stopPropagation();
            setDropZone(null);
            const r = await uploadDroppedFiles(e.dataTransfer.files, { spaceFolderId: folder.id });
            toast(r.ok === r.total ? `${r.ok} file${r.ok === 1 ? "" : "s"} added to ${folder.name}` : `${r.ok}/${r.total} files added to ${folder.name}`);
            return;
          }
          if (!isTreeDrag(e)) return;
          e.preventDefault(); e.stopPropagation();
          const zone = dropZone;
          setDropZone(null);
          const p = readTreeDrag(e);
          if (!p) return;
          // Reorder above/below only applies folder-to-folder; everything else nests.
          if ((zone === "before" || zone === "after") && p.kind === "folder") {
            if (p.id === folder.id) return;
            const moved = await reorderFolder(p.id, folder.id, zone);
            if (moved.ok) { onChanged(); refreshSidebar(); }
            else toast(moved.error);
            return;
          }
          const moved = await moveTreeItem(p, { folderId: folder.id, spaceId });
          if (moved.ok) { setExpanded(true); onChanged(); refreshSidebar(); }
          else toast(moved.error);
        }}
        ref={pillRef}
        onContextMenu={(e) => { e.preventDefault(); moreRef.current?.openAtPoint(e.clientX, e.clientY); }}
        className={`relative flex h-8 items-center gap-2 ps-3 pe-1.5 rounded-lg text-base cursor-pointer ${dropZone === "inside" ? "ring-2 ring-inset ring-brand bg-selected" : isActive ? "bg-side-pill" : "hover:bg-hover"}`}
      >
        {dropZone === "before" || dropZone === "after" ? (
          <span
            className={`pointer-events-none absolute start-1 end-1 h-0.5 rounded-full bg-brand ${
              dropZone === "before" ? "-top-px" : "-bottom-px"
            }`}
          />
        ) : null}
        <button
          type="button"
          onClick={() => hasChildren && setExpanded((v) => !v)}
          className="relative h-4 w-4 shrink-0 inline-flex items-center justify-center"
          aria-label={expanded ? "Collapse folder" : "Expand folder"}
          aria-expanded={expanded}
          disabled={!hasChildren}
        >
          {(() => {
            const FolderGlyph = expanded && hasChildren ? FolderOpen : FolderIcon;
            return (
              <FolderGlyph
                className={`h-4 w-4 text-ink-2 ${hasChildren ? "group-hover/folderrow:opacity-0 transition-opacity" : ""}`}
                style={folder.color ? { color: folder.color } : undefined}
              />
            );
          })()}
          {hasChildren ? (
            <span className="absolute inset-0 inline-flex items-center justify-center opacity-0 group-hover/folderrow:opacity-100 transition-opacity text-ink-3">
              {expanded ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronRight className="h-3.5 w-3.5 rtl:rotate-180" />}
            </span>
          ) : null}
        </button>
        {/* Name navigates INTO the folder page (ClickUp parity — a folder
            opens its own view). The chevron button above still toggles the
            inline tree expansion. */}
        <Link
          href={`/folders/${folder.id}`}
          className={`flex min-w-0 flex-1 items-center gap-1.5 truncate text-start ${isActive ? "text-ink font-medium" : "text-ink"}`}
        >
          <span className="min-w-0 flex-1 truncate">{folder.name}</span>
          {folder.visibility === "PRIVATE" ? (
            <Lock className="w-3 h-3 text-ink-3 shrink-0" aria-label="Restricted" />
          ) : null}
        </Link>
        <span className={`absolute end-1 top-1/2 -translate-y-1/2 inline-flex items-center gap-0.5 rounded ps-1.5 opacity-0 group-hover/folderrow:opacity-100 focus-within:opacity-100 [@media(hover:none)]:opacity-100 transition-opacity ${isActive ? "bg-side-pill" : "bg-side"}`}>
          {pathOnly ? null : (
            <CreateInsideTrigger kind="folder" spaceId={spaceId} spaceSlug={spaceSlug} folderId={folder.id} role={folder.role ?? undefined} onCreated={() => { setExpanded(true); onChanged(); }} />
          )}
          <ContainerMenuTrigger
            ref={moreRef}
            compact
            container={{
              kind: "folder",
              id: folder.id,
              name: folder.name,
              icon: folder.icon,
              color: folder.color,
              visibility: folder.visibility ?? undefined,
              spaceId,
              spaceSlug,
              spaceName,
            }}
            role={pathOnly ? null : folder.role}
            pathOnly={pathOnly}
            onUpdated={() => { setExpanded(true); onChanged(); }}
          />
        </span>
      </div>
      {expanded &&
       (folder.boards.length > 0 ||
        folder.docs.length > 0 ||
        folder.whiteboards.length > 0 ||
        folder.childFolders.length > 0) ? (
        <ul className="mt-0.5 ps-4">
          {folder.childFolders.map((cf) => (
            <FolderTreeRow
              key={cf.id}
              folder={cf}
              spaceId={spaceId}
              spaceSlug={spaceSlug}
              spaceName={spaceName}
              onChanged={onChanged}
            />
          ))}
          {folder.boards.map((b) => (
            <BoardTreeRow key={b.id} board={b} spaceId={spaceId} spaceSlug={spaceSlug} onChanged={onChanged} />
          ))}
          {folder.docs.map((d) => (
            <DocTreeRow key={d.id} doc={d} spaceSlug={spaceSlug} />
          ))}
          {folder.whiteboards.map((w) => (
            <WhiteboardTreeRow key={w.id} whiteboard={w} spaceSlug={spaceSlug} onChanged={onChanged} />
          ))}
        </ul>
      ) : null}
    </li>
  );
}

function BoardTreeRow({
  board,
  spaceId,
  spaceSlug,
  onChanged,
}: {
  board: BoardChild;
  /** The Space the List lives in, so its menu can create siblings. */
  spaceId?: string;
  /** Its slug, so a doc created from the List's menu opens at its Work address. */
  spaceSlug?: string;
  onChanged: () => void;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const moreRef = useRef<ContextMenuHandle>(null);
  // ClickUp highlights the currently-open List with the same grey pill the
  // Space row uses; child icons stay monochrome unless user-colored. The pill
  // also lands here for a List doc or a task doc open in Work.
  const { active: pillActive, ref: pillRef } = useTreePill<HTMLDivElement>(treeKey("list", board.id));
  const isActive = pathname === `/boards/${board.slug}` || pillActive;
  // Sprint Lists swap the glyph (dates already live in the name convention);
  // the icon stays neutral like every sibling row, no hue-keying.
  const sprint = parseSprintMeta(board.settings);
  return (
    <li className="group/boardrow relative">
      <div
        draggable
        ref={pillRef}
        onDragStart={(e) => startTreeDrag(e, { kind: "board", id: board.id })}
        onContextMenu={(e) => { e.preventDefault(); moreRef.current?.openAtPoint(e.clientX, e.clientY); }}
        className={`relative flex h-8 items-center gap-2 ps-3 pe-1.5 rounded-lg text-base cursor-pointer ${isActive ? "bg-side-pill" : "hover:bg-hover"}`}
      >
        <button
          type="button"
          onClick={() => router.push(`/boards/${board.slug}`)}
          className={`flex items-center gap-2 flex-1 min-w-0 text-start ${isActive ? "text-ink font-medium" : "text-ink"}`}
        >
          {sprint ? (
            <IterationCw className="h-4 w-4 shrink-0 text-ink-2" style={board.color ? { color: board.color } : undefined} />
          ) : (
            <ListChecks className="h-4 w-4 shrink-0 text-ink-2" style={board.color ? { color: board.color } : undefined} />
          )}
          <span className="min-w-0 flex-1 truncate">{board.name}</span>
          {board.visibility === "PRIVATE" ? (
            <Lock className="w-3 h-3 text-ink-3 shrink-0" aria-label="Restricted" />
          ) : null}
        </button>
        <span className={`absolute end-1 top-1/2 -translate-y-1/2 inline-flex items-center gap-0.5 rounded ps-1.5 opacity-0 group-hover/boardrow:opacity-100 focus-within:opacity-100 [@media(hover:none)]:opacity-100 transition-opacity ${isActive ? "bg-side-pill" : "bg-side"}`}>
          <ContainerMenuTrigger
            ref={moreRef}
            compact
            container={{
              kind: "list",
              id: board.id,
              name: board.name,
              slug: board.slug,
              icon: board.icon,
              color: board.color,
              visibility: board.visibility,
              spaceId,
              spaceSlug,
            }}
            role={board.role}
            onUpdated={onChanged}
          />
        </span>
      </div>
    </li>
  );
}

function TableTreeRow({
  table,
  spaceSlug,
  onChanged,
}: {
  table: TableChild;
  spaceSlug: string;
  onChanged: () => void;
}) {
  // The ONE table menu (spec-tables-forms section 3 TableRowMenu, placement
  // tree), shared with the Tables sidebar, /tables and the sheet's "...".
  const menu = useTableRowMenu();
  const target = { id: table.id, name: table.name, canManage: table.canManage, role: table.role, spaceSlug };
  const { active: pillActive, ref: pillRef } = useTreePill<HTMLDivElement>(treeKey("table", table.id));
  const isActive = pillActive;
  return (
    <li className="group/tablerow relative">
      <div
        ref={pillRef}
        onContextMenu={(e) => menu.open(e, target)}
        className={`relative flex h-8 items-center gap-2 ps-3 pe-1.5 rounded-lg text-base ${isActive ? "bg-side-pill" : "hover:bg-hover"}`}
      >
        {/* Opens IN WORK, at the table's Space-scoped address. */}
        <Link
          href={objectHref("table", table.id, "home", spaceSlug)}
          className={`flex items-center gap-2 flex-1 min-w-0 text-start ${isActive ? "text-ink font-medium" : "text-ink"}`}
        >
          <TableIcon className="h-4 w-4 shrink-0 text-ink-2" />
          <span className="min-w-0 flex-1 truncate">{table.name}</span>
        </Link>
        <span className={`absolute end-1 top-1/2 -translate-y-1/2 inline-flex items-center gap-0.5 rounded ps-1.5 opacity-0 group-hover/tablerow:opacity-100 focus-within:opacity-100 [@media(hover:none)]:opacity-100 transition-opacity ${isActive ? "bg-side-pill" : "bg-side"}`}>
          <SidebarQuickStar kind="table" id={table.id} />
          <button
            type="button"
            onClick={(e) => menu.open(e, target)}
            className="rounded p-1 text-ink-2 hover:bg-hover hover:text-ink"
            aria-label={`Actions for ${table.name || "Untitled table"}`}
            aria-haspopup="menu"
            title="More"
          >
            <MoreHorizontal className="h-3.5 w-3.5" />
          </button>
        </span>
      </div>
      <TableRowMenuHost menu={menu} context="tree" onChanged={() => onChanged()} />
    </li>
  );
}

function DocTreeRow({ doc, spaceSlug, onChanged }: { doc: DocChild; spaceSlug: string; onChanged?: () => void }) {
  const router = useRouter();
  const noteMenu = useDocRowMenu();
  // The server's role for this row, so the menu needs no fetch; absent (an
  // older server) and the menu asks GET /api/docs/[id] on open.
  const target = { id: doc.id, title: doc.title, spaceSlug, role: doc.role ?? undefined };
  const { active: pillActive, ref: pillRef } = useTreePill<HTMLDivElement>(treeKey("doc", doc.id));
  const isActive = pillActive;
  return (
    <li className="group/docrow relative">
      <div
        ref={pillRef}
        draggable
        onDragStart={(e) => startTreeDrag(e, { kind: "doc", id: doc.id })}
        onContextMenu={(e) => noteMenu.open(e, target)}
        className={`relative flex h-8 items-center gap-2 ps-3 pe-1.5 rounded-lg text-base cursor-pointer ${isActive ? "bg-side-pill" : "hover:bg-hover"}`}
      >
        {/* Opens IN WORK, at the doc's Space-scoped address. */}
        <Link
          href={objectHref("doc", doc.id, "home", spaceSlug)}
          className={`flex items-center gap-2 flex-1 min-w-0 text-start ${isActive ? "text-ink font-medium" : "text-ink"}`}
        >
          <FileText className="h-4 w-4 shrink-0 text-ink-2" />
          <span className="min-w-0 flex-1 truncate">{doc.title || "Untitled"}</span>
        </Link>
        <span className={`absolute end-1 top-1/2 -translate-y-1/2 inline-flex items-center gap-0.5 rounded ps-1.5 opacity-0 group-hover/docrow:opacity-100 focus-within:opacity-100 [@media(hover:none)]:opacity-100 transition-opacity ${isActive ? "bg-side-pill" : "bg-side"}`}>
          <SidebarQuickStar kind="doc" id={doc.id} />
          <button
            type="button"
            aria-label="Doc actions"
            onClick={(e) => { e.stopPropagation(); noteMenu.open(e, target); }}
            className="w-5 h-5 grid place-items-center rounded text-ink-3 hover:bg-hover hover:text-ink"
          >
            <MoreHorizontal className="h-3.5 w-3.5" />
          </button>
        </span>
      </div>
      <DocRowMenuHost menu={noteMenu} context="tree" onChanged={() => { noteMenu.close(); onChanged?.(); refreshSidebar(); router.refresh(); }} />
    </li>
  );
}

function WhiteboardTreeRow({ whiteboard, spaceSlug, onChanged }: { whiteboard: WhiteboardChild; spaceSlug: string; onChanged: () => void }) {
  const moreRef = useRef<ContextMenuHandle>(null);
  const { active: pillActive, ref: pillRef } = useTreePill<HTMLDivElement>(treeKey("canvas", whiteboard.id));
  const isActive = pillActive;
  return (
    <li className="group/wbrow relative">
      <div
        ref={pillRef}
        onContextMenu={(e) => { e.preventDefault(); moreRef.current?.openAtPoint(e.clientX, e.clientY); }}
        className={`relative flex h-8 items-center gap-2 ps-3 pe-1.5 rounded-lg text-base cursor-pointer ${isActive ? "bg-side-pill" : "hover:bg-hover"}`}
      >
        {/* Opens IN WORK, at the canvas's Space-scoped address. */}
        <Link
          href={objectHref("canvas", whiteboard.id, "home", spaceSlug)}
          className={`flex items-center gap-2 flex-1 min-w-0 text-start ${isActive ? "text-ink font-medium" : "text-ink"}`}
        >
          <WhiteboardIcon className="h-4 w-4 shrink-0 text-ink-2" />
          <span className="min-w-0 flex-1 truncate">{whiteboard.name || "Untitled canvas"}</span>
        </Link>
        <span className={`absolute end-1 top-1/2 -translate-y-1/2 inline-flex items-center gap-0.5 rounded ps-1.5 opacity-0 group-hover/wbrow:opacity-100 focus-within:opacity-100 [@media(hover:none)]:opacity-100 transition-opacity ${isActive ? "bg-side-pill" : "bg-side"}`}>
          <SidebarQuickStar kind="whiteboard" id={whiteboard.id} />
          <CanvasMoreTrigger ref={moreRef} canvas={{ id: whiteboard.id, name: whiteboard.name, spaceSlug }} role={whiteboard.role} onUpdated={onChanged} />
        </span>
      </div>
    </li>
  );
}
