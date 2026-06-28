"use client";

// SpaceTreeRow — expandable Space row for the HomeSidebar.
// Click the chevron → lazy-fetches /api/spaces/[id]/children, renders
// nested folders + boards inline. Each child is click-to-navigate.
//
// Hover clusters (share/more/create) stay only on the top-level Space
// row for v1 — nested folders/boards have hover-revealed "..." menus
// for management, opening the existing FolderMoreTrigger /
// BoardMoreTrigger / ShareBoardButton components.

import { useState, type DragEvent } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  ChevronDown, ChevronRight, Lock, Folder as FolderIcon, Loader2,
  Table as TableIcon, FileText, Pencil as WhiteboardIcon, Plus, List as ListIcon,
} from "lucide-react";
import { EntityTile } from "@/components/ui/entity-tile";
import { SpaceMoreTrigger } from "./space-more-menu";
import { SpaceCreateTrigger } from "./space-create-popover";
import { BoardMoreTrigger } from "./board-more-menu";
import { FolderMoreTrigger } from "./folder-more-menu";
import { TableMoreTrigger } from "./table-more-menu";
import { SidebarQuickStar } from "./sidebar-quick-star";

// ---------------------------------------------------------------------------
// Drag-and-drop: move sidebar items between folders / to the Space root.
// Only the entities a folder can physically hold are draggable today: lists
// (boards) re-parent via board.folderId; folders nest via folder.parentFolderId.
// Drop targets are folders (drop INTO) and the Space row (drop to root).
// ---------------------------------------------------------------------------
const DND_MIME = "application/x-wwrk-tree-item";
type DragKind = "board" | "folder";
interface DragPayload { kind: DragKind; id: string }

function startTreeDrag(e: DragEvent, payload: DragPayload) {
  e.dataTransfer.setData(DND_MIME, JSON.stringify(payload));
  e.dataTransfer.effectAllowed = "move";
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

// Persist a move. destFolderId === null means the Space root.
async function moveTreeItem(p: DragPayload, destFolderId: string | null): Promise<boolean> {
  if (p.kind === "board") {
    const res = await fetch(`/api/boards/${p.id}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ folderId: destFolderId }),
    });
    return res.ok;
  }
  if (p.kind === "folder") {
    // Guard the obvious self-drop; deeper cycles are capped server-side.
    if (p.id === destFolderId) return false;
    const res = await fetch(`/api/folders/${p.id}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ parentFolderId: destFolderId }),
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
}

interface BoardChild {
  id: string;
  slug: string;
  name: string;
  icon: string | null;
  color: string | null;
  visibility: "PRIVATE" | "WORKSPACE" | "ORG";
}

interface FolderChild {
  id: string;
  name: string;
  icon: string | null;
  color: string | null;
  position: number;
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
  onRequestShareSpace: () => void;
  onRequestNewBoard: () => void;
  onRequestNewFolder: () => void;
}

export function SpaceTreeRow({
  space,
  isActive,
  onReloadSpaces,
  onRequestShareSpace,
  onRequestNewBoard,
  onRequestNewFolder,
}: Props) {
  const [expanded, setExpanded] = useState(false);
  const [data, setData] = useState<ChildrenPayload | null>(null);
  const [loading, setLoading] = useState(false);
  const [rootDragOver, setRootDragOver] = useState(false);

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
          setData({
            folders: (d.folders ?? []).map(normalizeFolder),
            boards: d.boards ?? [],
            tables: d.tables ?? [],
            docs: d.docs ?? [],
            whiteboards: d.whiteboards ?? [],
          });
        }
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  };

  const toggle = () => {
    if (!expanded && data === null) loadChildren();
    setExpanded((v) => !v);
  };

  const refresh = () => {
    if (expanded) loadChildren();
    onReloadSpaces();
  };

  return (
    <li className="group/space relative">
      <div
        onDragOver={(e) => { if (isTreeDrag(e)) { e.preventDefault(); setRootDragOver(true); } }}
        onDragLeave={() => setRootDragOver(false)}
        onDrop={async (e) => {
          if (!isTreeDrag(e)) return;
          e.preventDefault();
          setRootDragOver(false);
          const p = readTreeDrag(e);
          if (!p) return;
          const ok = await moveTreeItem(p, null);
          if (ok) { setExpanded(true); if (!expanded) loadChildren(); else refresh(); }
        }}
        className={`relative flex h-7 items-center gap-2 px-2 rounded-md ${
          rootDragOver ? "ring-2 ring-inset ring-[#0073EA] bg-[#0073EA]/10" : isActive ? "bg-zinc-200/70" : "hover:bg-white/80"
        }`}
      >
        <button
          type="button"
          onClick={toggle}
          className="h-4 w-4 inline-flex items-center justify-center text-zinc-500 hover:text-zinc-800 shrink-0"
          aria-label={expanded ? "Collapse Space" : "Expand Space"}
          aria-expanded={expanded}
        >
          {expanded ? (
            <ChevronDown className="h-4 w-4" />
          ) : (
            <ChevronRight className="h-4 w-4" />
          )}
        </button>
        <Link
          href={`/spaces/${space.slug}`}
          className={`flex items-center gap-2 text-[12px] flex-1 min-w-0 ${
            isActive ? "text-zinc-900 font-medium" : "text-zinc-700"
          }`}
        >
          <EntityTile size="sm" icon={space.icon} color={space.color} name={space.name} />
          <span className="min-w-0 flex-1 truncate">{space.name}</span>
          {space.visibility === "PRIVATE" ? (
            <Lock className="w-3 h-3 text-zinc-400 shrink-0" />
          ) : null}
        </Link>
        <span className={`absolute right-1 top-1/2 -translate-y-1/2 inline-flex items-center gap-0.5 rounded pl-1.5 opacity-0 group-hover/space:opacity-100 transition-opacity ${isActive ? "bg-zinc-200/95" : "bg-white"}`}>
          <SidebarQuickStar kind="space" id={space.id} />
          <SpaceMoreTrigger
            space={space}
            onUpdated={onReloadSpaces}
            onRequestShare={onRequestShareSpace}
          />
          <SpaceCreateTrigger
            spaceId={space.id}
            onRequestBoard={onRequestNewBoard}
            onRequestFolder={onRequestNewFolder}
            onCreated={refresh}
          />
        </span>
      </div>

      {expanded ? (
        <ul className="ml-[18px] mt-0.5 mb-1 border-l border-zinc-200/70 pl-2">
          {loading && data === null ? (
            <li className="px-2 py-1 inline-flex items-center gap-1.5 text-[11.5px] text-zinc-400">
              <Loader2 className="h-3 w-3 animate-spin" />
              Loading…
            </li>
          ) : data === null ? (
            <li className="px-2 py-1 text-[11.5px] text-zinc-400">Couldn&rsquo;t load</li>
          ) : data.folders.length === 0 && data.boards.length === 0 && data.tables.length === 0 && data.docs.length === 0 && data.whiteboards.length === 0 ? (
            <li className="px-2 py-1 text-[11.5px] text-zinc-400">Empty</li>
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
                  onChanged={refresh}
                />
              ))}
              {data.docs.map((d) => (
                <DocTreeRow key={d.id} doc={d} />
              ))}
              {data.whiteboards.map((w) => (
                <WhiteboardTreeRow key={w.id} whiteboard={w} />
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
  const [expanded, setExpanded] = useState(false);
  const [dragOver, setDragOver] = useState(false);
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
        onDragOver={(e) => { if (isTreeDrag(e)) { e.preventDefault(); e.stopPropagation(); setDragOver(true); } }}
        onDragLeave={() => setDragOver(false)}
        onDrop={async (e) => {
          if (!isTreeDrag(e)) return;
          e.preventDefault(); e.stopPropagation();
          setDragOver(false);
          const p = readTreeDrag(e);
          if (!p) return;
          const ok = await moveTreeItem(p, folder.id);
          if (ok) { setExpanded(true); onChanged(); }
        }}
        className={`relative flex h-7 items-center gap-2 pr-1.5 rounded-md cursor-grab active:cursor-grabbing ${dragOver ? "ring-2 ring-inset ring-[#0073EA] bg-[#0073EA]/10" : "hover:bg-white/80"}`}
      >
        <button
          type="button"
          onClick={() => setExpanded((v) => !v)}
          className="h-4 w-4 inline-flex items-center justify-center text-zinc-400 hover:text-zinc-700 shrink-0"
          aria-label={expanded ? "Collapse folder" : "Expand folder"}
          disabled={!hasChildren}
        >
          {hasChildren ? (
            expanded ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronRight className="h-3.5 w-3.5" />
          ) : null}
        </button>
        <EntityTile size="sm" icon={folder.icon} color={folder.color} name={folder.name} fallbackIcon={FolderIcon} />
        <span className="min-w-0 flex-1 truncate text-[12px] text-zinc-700">{folder.name}</span>
        <span className="absolute right-1 top-1/2 -translate-y-1/2 inline-flex items-center gap-0.5 rounded bg-white pl-1.5 opacity-0 group-hover/folderrow:opacity-100 transition-opacity">
          <SidebarQuickStar kind="folder" id={folder.id} />
          <FolderMoreTrigger
            folder={{ id: folder.id, name: folder.name, icon: folder.icon, color: folder.color }}
            onUpdated={onChanged}
          />
          <FolderAddTrigger
            folderId={folder.id}
            spaceId={spaceId}
            onCreated={() => { setExpanded(true); onChanged(); }}
          />
        </span>
      </div>
      {expanded &&
       (folder.boards.length > 0 ||
        folder.docs.length > 0 ||
        folder.childFolders.length > 0) ? (
        <ul className="ml-[18px] mt-0.5 border-l border-zinc-200/70 pl-2">
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
            <BoardTreeRow key={b.id} board={b} onChanged={onChanged} />
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
  onChanged,
}: {
  board: BoardChild;
  onChanged: () => void;
}) {
  const router = useRouter();
  return (
    <li className="group/boardrow relative">
      <div
        draggable
        onDragStart={(e) => startTreeDrag(e, { kind: "board", id: board.id })}
        className="relative flex h-7 items-center gap-2 pl-2 pr-1.5 rounded-md hover:bg-white/80 cursor-grab active:cursor-grabbing"
      >
        <button
          type="button"
          onClick={() => router.push(`/boards/${board.slug}`)}
          className="flex items-center gap-2 text-[12px] text-zinc-700 flex-1 min-w-0 text-left"
        >
          <EntityTile size="sm" icon={board.icon} color={board.color} name={board.name} fallbackIcon={ListIcon} />
          <span className="min-w-0 flex-1 truncate">{board.name}</span>
          {board.visibility === "PRIVATE" ? (
            <Lock className="w-3 h-3 text-zinc-400 shrink-0" />
          ) : null}
        </button>
        <span className="absolute right-1 top-1/2 -translate-y-1/2 inline-flex items-center gap-0.5 rounded bg-white pl-1.5 opacity-0 group-hover/boardrow:opacity-100 transition-opacity">
          <SidebarQuickStar kind="board" id={board.id} />
          <BoardMoreTrigger
            board={{ id: board.id, name: board.name, slug: board.slug, icon: board.icon, color: board.color }}
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
  return (
    <li className="group/tablerow relative">
      <div className="relative flex h-7 items-center gap-2 pl-2 pr-1.5 rounded-md hover:bg-white/80">
        <button
          type="button"
          onClick={() => router.push(`/tables/${table.id}`)}
          className="flex items-center gap-2 text-[12px] text-zinc-700 flex-1 min-w-0 text-left"
        >
          <EntityTile size="sm" color="#0EA5E9" fallbackIcon={TableIcon} name={table.name} />
          <span className="min-w-0 flex-1 truncate">{table.name}</span>
        </button>
        <span className="absolute right-1 top-1/2 -translate-y-1/2 inline-flex items-center gap-0.5 rounded bg-white pl-1.5 opacity-0 group-hover/tablerow:opacity-100 transition-opacity">
          <SidebarQuickStar kind="table" id={table.id} />
          <TableMoreTrigger table={{ id: table.id, name: table.name }} onUpdated={onChanged} />
        </span>
      </div>
    </li>
  );
}

function DocTreeRow({ doc }: { doc: DocChild }) {
  const router = useRouter();
  return (
    <li className="group/docrow relative">
      <div className="relative flex h-7 items-center gap-2 pl-2 pr-1.5 rounded-md hover:bg-white/80">
        <button
          type="button"
          onClick={() => router.push(`/docs/${doc.id}`)}
          className="flex items-center gap-2 text-[12px] text-zinc-700 flex-1 min-w-0 text-left"
        >
          <EntityTile size="sm" color="#3B82F6" fallbackIcon={FileText} name={doc.title} />
          <span className="min-w-0 flex-1 truncate">{doc.title || "Untitled"}</span>
        </button>
        <span className="absolute right-1 top-1/2 -translate-y-1/2 inline-flex items-center gap-0.5 rounded bg-white pl-1.5 opacity-0 group-hover/docrow:opacity-100 transition-opacity">
          <SidebarQuickStar kind="doc" id={doc.id} />
        </span>
      </div>
    </li>
  );
}

function WhiteboardTreeRow({ whiteboard }: { whiteboard: WhiteboardChild }) {
  const router = useRouter();
  return (
    <li className="group/wbrow relative">
      <div className="relative flex h-7 items-center gap-2 pl-2 pr-1.5 rounded-md hover:bg-white/80">
        <button
          type="button"
          onClick={() => router.push(`/whiteboards/${whiteboard.id}`)}
          className="flex items-center gap-2 text-[12px] text-zinc-700 flex-1 min-w-0 text-left"
        >
          <EntityTile size="sm" color="#F59E0B" fallbackIcon={WhiteboardIcon} name={whiteboard.name} />
          <span className="min-w-0 flex-1 truncate">{whiteboard.name || "Untitled whiteboard"}</span>
        </button>
        <span className="absolute right-1 top-1/2 -translate-y-1/2 inline-flex items-center gap-0.5 rounded bg-white pl-1.5 opacity-0 group-hover/wbrow:opacity-100 transition-opacity">
          <SidebarQuickStar kind="whiteboard" id={whiteboard.id} />
        </span>
      </div>
    </li>
  );
}

function FolderAddTrigger({
  folderId,
  spaceId,
  onCreated,
}: {
  folderId: string;
  spaceId: string;
  onCreated: () => void;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [creating, setCreating] = useState<string | null>(null);

  const createDoc = async () => {
    if (creating) return;
    setCreating("doc");
    try {
      const res = await fetch("/api/docs", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          title: "Untitled",
          entityType: "FOLDER",
          entityId: folderId,
        }),
      });
      if (res.ok) {
        const data = await res.json();
        const id = data?.doc?.id ?? data?.id;
        onCreated();
        setOpen(false);
        if (id) router.push(`/docs/${id}`);
      }
    } finally {
      setCreating(null);
    }
  };

  const createSubFolder = async () => {
    if (creating) return;
    setCreating("folder");
    try {
      const res = await fetch("/api/folders", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          spaceId,
          parentFolderId: folderId,
          name: "New Folder",
        }),
      });
      if (res.ok) {
        onCreated();
        setOpen(false);
      }
    } finally {
      setCreating(null);
    }
  };

  return (
    <span className="relative">
      <button
        type="button"
        onClick={(e) => {
          e.preventDefault();
          e.stopPropagation();
          setOpen((v) => !v);
        }}
        aria-label="Create inside folder"
        title="Create"
        className="p-0.5 rounded text-zinc-400 hover:text-zinc-700 hover:bg-zinc-100 inline-flex items-center justify-center"
      >
        <Plus className="h-3 w-3" />
      </button>
      {open ? (
        <>
          <div className="fixed inset-0 z-30" onClick={() => setOpen(false)} aria-hidden />
          <ul className="absolute right-0 top-full mt-1 z-40 w-44 bg-white border border-zinc-200 rounded-md shadow-lg py-1">
            <li>
              <button
                type="button"
                onClick={createDoc}
                disabled={Boolean(creating)}
                className="w-full text-left px-3 py-1.5 text-[12px] hover:bg-zinc-50 inline-flex items-center gap-2 disabled:opacity-50"
              >
                <FileText className="w-3.5 h-3.5 text-blue-500" />
                Doc
              </button>
            </li>
            <li>
              <button
                type="button"
                onClick={createSubFolder}
                disabled={Boolean(creating)}
                className="w-full text-left px-3 py-1.5 text-[12px] hover:bg-zinc-50 inline-flex items-center gap-2 disabled:opacity-50"
              >
                <FolderIcon className="w-3.5 h-3.5 text-amber-500" />
                Folder
              </button>
            </li>
            <li>
              <button
                type="button"
                disabled
                title="Use the Space + menu for now"
                className="w-full text-left px-3 py-1.5 text-[12px] text-zinc-400 inline-flex items-center gap-2 cursor-not-allowed"
              >
                <Plus className="w-3.5 h-3.5" />
                List (use Space +)
              </button>
            </li>
          </ul>
        </>
      ) : null}
    </span>
  );
}
