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
// Rename / Move / Duplicate from people who do hold them.

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
import type { ContainerRole } from "@/lib/work/container-menu";
import { NoteActionMenu, useNoteMenu } from "@/components/docs/note-actions-menu";
import { TableMoreTrigger } from "./table-more-menu";
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

// Reorder a folder to sit directly before/after `targetId` as a sibling.
async function reorderFolder(movedId: string, targetId: string, place: "before" | "after"): Promise<boolean> {
  const res = await fetch("/api/folders/reorder", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ movedId, targetId, place }),
    keepalive: true,
  });
  return res.ok;
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
// the Space the drop landed in (needed to re-anchor a doc back to the root).
async function moveTreeItem(p: DragPayload, dest: { folderId: string | null; spaceId: string }): Promise<boolean> {
  if (p.kind === "board") {
    const res = await fetch(`/api/boards/${p.id}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ folderId: dest.folderId }),
    });
    return res.ok;
  }
  if (p.kind === "folder") {
    // Guard the obvious self-drop; deeper cycles are capped server-side.
    if (p.id === dest.folderId) return false;
    const res = await fetch(`/api/folders/${p.id}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ parentFolderId: dest.folderId }),
    });
    return res.ok;
  }
  if (p.kind === "doc") {
    // Docs have no folderId column — they re-anchor via the polymorphic
    // entityType/entityId pair the children API already reads.
    const anchor = dest.folderId
      ? { entityType: "FOLDER", entityId: dest.folderId }
      : { entityType: "SPACE", entityId: dest.spaceId };
    const res = await fetch(`/api/docs/${p.id}`, {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(anchor),
    });
    return res.ok;
  }
  return false;
}

interface SpaceRow {
  id: string;
  slug: string;
  name: string;
  visibility: "PRIVATE" | "WORKSPACE" | "ORG";
  icon: string | null;
  color: string | null;
  /** From `GET /api/spaces` (SpaceSummary.role). Absent = the reader's menu. */
  role?: ContainerRole;
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
  /** The viewer's role on this List, from the children route. */
  role?: ContainerRole;
}

interface FolderChild {
  id: string;
  name: string;
  icon: string | null;
  color: string | null;
  position: number;
  /** A Folder's management gate is its Space's, so this IS the Space role. */
  role?: ContainerRole;
  visibility?: "PRIVATE" | "WORKSPACE" | "ORG";
  _count: { boards: number; childFolders: number };
  boards: BoardChild[];
  docs: DocChild[];
  childFolders: FolderChild[];
}

interface TableChild {
  id: string;
  name: string;
  description: string | null;
}

interface DocChild {
  id: string;
  title: string;
}

interface WhiteboardChild {
  id: string;
  name: string;
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

  const loadChildren = () => {
    setLoading(true);
    fetch(`/api/spaces/${space.id}/children`)
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        if (d) {
          const normalizeFolder = (f: FolderChild): FolderChild => ({
            ...f,
            docs: f.docs ?? [],
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
          if (isTreeDrag(e)) { e.preventDefault(); setRootDragOver(true); }
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
          if (!isTreeDrag(e)) return;
          e.preventDefault();
          setRootDragOver(false);
          const p = readTreeDrag(e);
          if (!p) return;
          const ok = await moveTreeItem(p, { folderId: null, spaceId: space.id });
          if (ok) { setExpanded(true); if (!expanded) loadChildren(); else refresh(); refreshSidebar(); }
        }}
        onContextMenu={(e) => { e.preventDefault(); moreRef.current?.openAtPoint(e.clientX, e.clientY); }}
        className={`relative flex h-9 items-center gap-2 px-3 rounded-lg ${
          rootDragOver ? "ring-2 ring-inset ring-brand bg-selected" : isActive ? "bg-side-pill" : "hover:bg-hover"
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
            <EntityTile size="sm" icon={space.icon} color={space.color} name={space.name} />
          </span>
          <span className="absolute inset-0 inline-flex items-center justify-center opacity-0 group-hover/space:opacity-100 transition-opacity text-ink-3">
            {expanded ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronRight className="h-3.5 w-3.5 rtl:rotate-180" />}
          </span>
        </button>
        <Link
          href={`/spaces/${space.slug}`}
          className={`flex items-center gap-1.5 text-sm flex-1 min-w-0 ${
            isActive ? "text-ink font-medium" : "text-ink"
          }`}
        >
          <span className="min-w-0 flex-1 truncate">{space.name}</span>
          {space.visibility === "ORG" ? (
            <Globe className="w-3 h-3 text-ink-3 shrink-0" aria-label="Everyone in the org" />
          ) : null}
        </Link>
        <span className={`absolute end-1 top-1/2 -translate-y-1/2 inline-flex items-center gap-0.5 rounded ps-1.5 opacity-0 group-hover/space:opacity-100 focus-within:opacity-100 [@media(hover:none)]:opacity-100 transition-opacity ${isActive ? "bg-side-pill" : "bg-side"}`}>
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
            role={space.role}
            onUpdated={() => { onReloadSpaces(); refresh(); }}
            onMoveUp={onMoveUp}
            onMoveDown={onMoveDown}
          />
        </span>
      </div>

      {expanded ? (
        <ul className="mt-0.5 mb-1 ps-[19px]">
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
                  spaceName={space.name}
                  onChanged={refresh}
                />
              ))}
              {data.boards.map((b) => (
                <BoardTreeRow
                  key={b.id}
                  board={b}
                  spaceId={space.id}
                  onChanged={refresh}
                />
              ))}
              {data.docs.map((d) => (
                <DocTreeRow key={d.id} doc={d} />
              ))}
              {data.whiteboards.map((w) => (
                <WhiteboardTreeRow key={w.id} whiteboard={w} onChanged={refresh} />
              ))}
              {data.tables.map((t) => (
                <TableTreeRow key={t.id} table={t} onChanged={refresh} />
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
  spaceName,
  onChanged,
}: {
  folder: FolderChild;
  spaceId: string;
  spaceName: string;
  onChanged: () => void;
}) {
  const { toast } = useOsToast();
  const [expanded, setExpanded] = useState(() => folderExpandStore.get(folder.id) ?? storedExpanded(folder.id));
  const pathname = usePathname();
  const isActive = pathname === `/folders/${folder.id}`;
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
  const hasChildren =
    folder.boards.length > 0 ||
    folder.docs.length > 0 ||
    folder.childFolders.length > 0 ||
    folder._count.childFolders > 0;

  return (
    <li className="group/folderrow relative">
      <div
        draggable
        onDragStart={(e) => { e.stopPropagation(); startTreeDrag(e, { kind: "folder", id: folder.id }); }}
        onDragOver={(e) => {
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
            const ok = await reorderFolder(p.id, folder.id, zone);
            if (ok) { onChanged(); refreshSidebar(); }
            return;
          }
          const ok = await moveTreeItem(p, { folderId: folder.id, spaceId });
          if (ok) { setExpanded(true); onChanged(); refreshSidebar(); }
        }}
        onContextMenu={(e) => { e.preventDefault(); moreRef.current?.openAtPoint(e.clientX, e.clientY); }}
        className={`relative flex h-9 items-center gap-2 ps-1 pe-1.5 rounded-lg cursor-pointer ${dropZone === "inside" ? "ring-2 ring-inset ring-brand bg-selected" : isActive ? "bg-side-pill" : "hover:bg-hover"}`}
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
          className="relative h-3.5 w-3.5 shrink-0 inline-flex items-center justify-center"
          aria-label={expanded ? "Collapse folder" : "Expand folder"}
          aria-expanded={expanded}
          disabled={!hasChildren}
        >
          {(() => {
            const FolderGlyph = expanded && hasChildren ? FolderOpen : FolderIcon;
            return (
              <FolderGlyph
                className={`h-3.5 w-3.5 text-ink-2 ${hasChildren ? "group-hover/folderrow:opacity-0 transition-opacity" : ""}`}
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
          <ContainerMenuTrigger
            ref={moreRef}
            compact
            container={{
              kind: "folder",
              id: folder.id,
              name: folder.name,
              icon: folder.icon,
              color: folder.color,
              visibility: folder.visibility,
              spaceId,
              spaceName,
            }}
            role={folder.role}
            onUpdated={() => { setExpanded(true); onChanged(); }}
          />
        </span>
      </div>
      {expanded &&
       (folder.boards.length > 0 ||
        folder.docs.length > 0 ||
        folder.childFolders.length > 0) ? (
        <ul className="mt-0.5 ps-[19px]">
          {folder.childFolders.map((cf) => (
            <FolderTreeRow
              key={cf.id}
              folder={cf}
              spaceId={spaceId}
              spaceName={spaceName}
              onChanged={onChanged}
            />
          ))}
          {folder.boards.map((b) => (
            <BoardTreeRow key={b.id} board={b} spaceId={spaceId} onChanged={onChanged} />
          ))}
          {folder.docs.map((d) => (
            <DocTreeRow key={d.id} doc={d} />
          ))}
        </ul>
      ) : null}
    </li>
  );
}

function BoardTreeRow({
  board,
  spaceId,
  onChanged,
}: {
  board: BoardChild;
  /** The Space the List lives in, so its menu can create siblings. */
  spaceId?: string;
  onChanged: () => void;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const moreRef = useRef<ContextMenuHandle>(null);
  // ClickUp highlights the currently-open List with the same grey pill the
  // Space row uses; child icons stay monochrome unless user-colored.
  const isActive = pathname === `/boards/${board.slug}`;
  // Sprint Lists swap the glyph (dates already live in the name convention);
  // the icon stays neutral like every sibling row, no hue-keying.
  const sprint = parseSprintMeta(board.settings);
  return (
    <li className="group/boardrow relative">
      <div
        draggable
        onDragStart={(e) => startTreeDrag(e, { kind: "board", id: board.id })}
        onContextMenu={(e) => { e.preventDefault(); moreRef.current?.openAtPoint(e.clientX, e.clientY); }}
        className={`relative flex h-9 items-center gap-2 ps-1 pe-1.5 rounded-lg cursor-pointer ${isActive ? "bg-side-pill" : "hover:bg-hover"}`}
      >
        <button
          type="button"
          onClick={() => router.push(`/boards/${board.slug}`)}
          className={`flex items-center gap-1.5 flex-1 min-w-0 text-start ${isActive ? "text-ink font-medium" : "text-ink"}`}
        >
          {sprint ? (
            <IterationCw className="h-3.5 w-3.5 shrink-0 text-ink-2" style={board.color ? { color: board.color } : undefined} />
          ) : (
            <ListChecks className="h-3.5 w-3.5 shrink-0 text-ink-2" style={board.color ? { color: board.color } : undefined} />
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
  onChanged,
}: {
  table: TableChild;
  onChanged: () => void;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const moreRef = useRef<ContextMenuHandle>(null);
  const isActive = pathname === `/tables/${table.id}`;
  return (
    <li className="group/tablerow relative">
      <div
        onContextMenu={(e) => { e.preventDefault(); moreRef.current?.openAtPoint(e.clientX, e.clientY); }}
        className={`relative flex h-9 items-center gap-2 ps-1 pe-1.5 rounded-lg ${isActive ? "bg-side-pill" : "hover:bg-hover"}`}
      >
        <button
          type="button"
          onClick={() => router.push(`/tables/${table.id}`)}
          className={`flex items-center gap-1.5 flex-1 min-w-0 text-start ${isActive ? "text-ink font-medium" : "text-ink"}`}
        >
          <TableIcon className="h-3.5 w-3.5 shrink-0 text-ink-2" />
          <span className="min-w-0 flex-1 truncate">{table.name}</span>
        </button>
        <span className={`absolute end-1 top-1/2 -translate-y-1/2 inline-flex items-center gap-0.5 rounded ps-1.5 opacity-0 group-hover/tablerow:opacity-100 focus-within:opacity-100 [@media(hover:none)]:opacity-100 transition-opacity ${isActive ? "bg-side-pill" : "bg-side"}`}>
          <SidebarQuickStar kind="table" id={table.id} />
          <TableMoreTrigger ref={moreRef} table={{ id: table.id, name: table.name }} onUpdated={onChanged} />
        </span>
      </div>
    </li>
  );
}

function DocTreeRow({ doc, onChanged }: { doc: DocChild; onChanged?: () => void }) {
  const router = useRouter();
  const pathname = usePathname();
  const noteMenu = useNoteMenu();
  const isActive = pathname === `/docs/${doc.id}`;
  return (
    <li className="group/docrow relative">
      <div
        draggable
        onDragStart={(e) => startTreeDrag(e, { kind: "doc", id: doc.id })}
        onContextMenu={(e) => noteMenu.open(e, { id: doc.id, title: doc.title })}
        className={`relative flex h-9 items-center gap-2 ps-1 pe-1.5 rounded-lg cursor-pointer ${isActive ? "bg-side-pill" : "hover:bg-hover"}`}
      >
        <button
          type="button"
          onClick={() => router.push(`/docs/${doc.id}`)}
          className={`flex items-center gap-1.5 flex-1 min-w-0 text-start ${isActive ? "text-ink font-medium" : "text-ink"}`}
        >
          <FileText className="h-3.5 w-3.5 shrink-0 text-ink-2" />
          <span className="min-w-0 flex-1 truncate">{doc.title || "Untitled"}</span>
        </button>
        <span className={`absolute end-1 top-1/2 -translate-y-1/2 inline-flex items-center gap-0.5 rounded ps-1.5 opacity-0 group-hover/docrow:opacity-100 focus-within:opacity-100 [@media(hover:none)]:opacity-100 transition-opacity ${isActive ? "bg-side-pill" : "bg-side"}`}>
          <SidebarQuickStar kind="doc" id={doc.id} />
          <button
            type="button"
            aria-label="Note actions"
            onClick={(e) => { e.stopPropagation(); noteMenu.open(e, { id: doc.id, title: doc.title }); }}
            className="w-5 h-5 grid place-items-center rounded text-ink-3 hover:bg-hover hover:text-ink"
          >
            <MoreHorizontal className="h-3.5 w-3.5" />
          </button>
        </span>
      </div>
      {noteMenu.menu ? (
        <NoteActionMenu
          target={noteMenu.menu.target}
          x={noteMenu.menu.x}
          y={noteMenu.menu.y}
          onClose={noteMenu.close}
          onChanged={() => { noteMenu.close(); onChanged?.(); refreshSidebar(); router.refresh(); }}
        />
      ) : null}
    </li>
  );
}

function WhiteboardTreeRow({ whiteboard, onChanged }: { whiteboard: WhiteboardChild; onChanged: () => void }) {
  const router = useRouter();
  const pathname = usePathname();
  const moreRef = useRef<ContextMenuHandle>(null);
  const isActive = pathname === `/canvas/${whiteboard.id}`;
  return (
    <li className="group/wbrow relative">
      <div
        onContextMenu={(e) => { e.preventDefault(); moreRef.current?.openAtPoint(e.clientX, e.clientY); }}
        className={`relative flex h-9 items-center gap-2 ps-1 pe-1.5 rounded-lg cursor-pointer ${isActive ? "bg-side-pill" : "hover:bg-hover"}`}
      >
        <button
          type="button"
          onClick={() => router.push(`/canvas/${whiteboard.id}`)}
          className={`flex items-center gap-1.5 flex-1 min-w-0 text-start ${isActive ? "text-ink font-medium" : "text-ink"}`}
        >
          <WhiteboardIcon className="h-3.5 w-3.5 shrink-0 text-ink-2" />
          <span className="min-w-0 flex-1 truncate">{whiteboard.name || "Untitled canvas"}</span>
        </button>
        <span className={`absolute end-1 top-1/2 -translate-y-1/2 inline-flex items-center gap-0.5 rounded ps-1.5 opacity-0 group-hover/wbrow:opacity-100 focus-within:opacity-100 [@media(hover:none)]:opacity-100 transition-opacity ${isActive ? "bg-side-pill" : "bg-side"}`}>
          <SidebarQuickStar kind="whiteboard" id={whiteboard.id} />
          <CanvasMoreTrigger ref={moreRef} canvas={{ id: whiteboard.id, name: whiteboard.name }} onUpdated={onChanged} />
        </span>
      </div>
    </li>
  );
}
