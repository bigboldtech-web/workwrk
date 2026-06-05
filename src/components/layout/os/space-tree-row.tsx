"use client";

// SpaceTreeRow — expandable Space row for the HomeSidebar.
// Click the chevron → lazy-fetches /api/spaces/[id]/children, renders
// nested folders + boards inline. Each child is click-to-navigate.
//
// Hover clusters (share/more/create) stay only on the top-level Space
// row for v1 — nested folders/boards have hover-revealed "..." menus
// for management, opening the existing FolderMoreTrigger /
// BoardMoreTrigger / ShareBoardButton components.

import { createElement, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  ChevronDown, ChevronRight, Lock, Folder as FolderIcon, Loader2,
  Table as TableIcon,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { getSpaceIcon } from "./space-icon-catalog";
import { SpaceMoreTrigger } from "./space-more-menu";
import { SpaceCreateTrigger } from "./space-create-popover";
import { BoardMoreTrigger } from "./board-more-menu";
import { FolderMoreTrigger } from "./folder-more-menu";
import { ShareBoardButton } from "./share-board-button";
import { TableMoreTrigger } from "./table-more-menu";

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
}

interface TableChild {
  id: string;
  name: string;
  description: string | null;
}

interface ChildrenPayload {
  folders: FolderChild[];
  boards: BoardChild[];
  tables: TableChild[];
}

const DEFAULT_COLOR = "#71717A";

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

  const loadChildren = () => {
    setLoading(true);
    fetch(`/api/spaces/${space.id}/children`)
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        if (d) setData({
          folders: d.folders ?? [],
          boards: d.boards ?? [],
          tables: d.tables ?? [],
        });
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
        className={`flex items-center gap-1 pl-1 pr-1.5 py-1 rounded-md ${
          isActive ? "bg-zinc-100" : "hover:bg-zinc-50"
        }`}
      >
        <button
          type="button"
          onClick={toggle}
          className="h-4 w-4 inline-flex items-center justify-center text-zinc-400 hover:text-zinc-700 shrink-0"
          aria-label={expanded ? "Collapse Space" : "Expand Space"}
          aria-expanded={expanded}
        >
          {expanded ? (
            <ChevronDown className="h-3 w-3" />
          ) : (
            <ChevronRight className="h-3 w-3" />
          )}
        </button>
        <Link
          href={`/spaces/${space.slug}`}
          className={`flex items-center gap-2 text-[13px] flex-1 min-w-0 ${
            isActive ? "text-zinc-900 font-medium" : "text-zinc-700"
          }`}
        >
          <SpaceTile space={space} />
          <span className="truncate flex-1">{space.name}</span>
          {space.visibility === "PRIVATE" ? (
            <Lock className="w-3 h-3 text-zinc-400 shrink-0" />
          ) : null}
        </Link>
        <span className="opacity-0 group-hover/space:opacity-100 transition-opacity shrink-0 inline-flex items-center gap-0.5">
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
        <ul className="ml-5 mt-0.5 mb-1 border-l border-zinc-100 pl-1.5">
          {loading && data === null ? (
            <li className="px-2 py-1 inline-flex items-center gap-1.5 text-[11.5px] text-zinc-400">
              <Loader2 className="h-3 w-3 animate-spin" />
              Loading…
            </li>
          ) : data === null ? (
            <li className="px-2 py-1 text-[11.5px] text-zinc-400">Couldn&rsquo;t load</li>
          ) : data.folders.length === 0 && data.boards.length === 0 && data.tables.length === 0 ? (
            <li className="px-2 py-1 text-[11.5px] text-zinc-400">Empty</li>
          ) : (
            <>
              {data.folders.map((f) => (
                <FolderTreeRow
                  key={f.id}
                  folder={f}
                  spaceName={space.name}
                  onChanged={refresh}
                />
              ))}
              {data.boards.map((b) => (
                <BoardTreeRow
                  key={b.id}
                  board={b}
                  spaceName={space.name}
                  onChanged={refresh}
                />
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

function SpaceTile({ space }: { space: SpaceRow }) {
  const Icon = getSpaceIcon(space.icon);
  const bg = space.color ?? DEFAULT_COLOR;
  return (
    <span
      className="h-5 w-5 rounded flex items-center justify-center text-white text-[10px] font-semibold uppercase shrink-0"
      style={{ backgroundColor: bg }}
    >
      {Icon ? createElement(Icon, { className: "h-3 w-3" }) : (space.name[0] ?? "?")}
    </span>
  );
}

function FolderTreeRow({
  folder,
  spaceName,
  onChanged,
}: {
  folder: FolderChild;
  spaceName: string;
  onChanged: () => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const hasChildren = folder.boards.length > 0 || folder._count.childFolders > 0;

  return (
    <li className="group/folderrow relative">
      <div className="flex items-center gap-1 pl-1 pr-1.5 py-0.5 rounded-md hover:bg-zinc-50">
        <button
          type="button"
          onClick={() => setExpanded((v) => !v)}
          className="h-4 w-4 inline-flex items-center justify-center text-zinc-400 hover:text-zinc-700 shrink-0"
          aria-label={expanded ? "Collapse folder" : "Expand folder"}
          disabled={!hasChildren}
        >
          {hasChildren ? (
            expanded ? <ChevronDown className="h-3 w-3" /> : <ChevronRight className="h-3 w-3" />
          ) : null}
        </button>
        <ChildTile color={folder.color} icon={folder.icon} fallback={FolderIcon} name={folder.name} />
        <span className="text-[12.5px] text-zinc-700 truncate flex-1">{folder.name}</span>
        <span className="opacity-0 group-hover/folderrow:opacity-100 transition-opacity shrink-0">
          <FolderMoreTrigger
            folder={{ id: folder.id, name: folder.name, icon: folder.icon, color: folder.color }}
            onUpdated={onChanged}
          />
        </span>
      </div>
      {expanded && folder.boards.length > 0 ? (
        <ul className="ml-5 mt-0.5 border-l border-zinc-100 pl-1.5">
          {folder.boards.map((b) => (
            <BoardTreeRow key={b.id} board={b} spaceName={spaceName} onChanged={onChanged} />
          ))}
        </ul>
      ) : null}
    </li>
  );
}

function BoardTreeRow({
  board,
  spaceName,
  onChanged,
}: {
  board: BoardChild;
  spaceName: string;
  onChanged: () => void;
}) {
  const router = useRouter();
  return (
    <li className="group/boardrow relative">
      <div className="flex items-center gap-1 pl-5 pr-1.5 py-0.5 rounded-md hover:bg-zinc-50">
        <button
          type="button"
          onClick={() => router.push(`/boards/${board.slug}`)}
          className="flex items-center gap-2 text-[12.5px] text-zinc-700 flex-1 min-w-0 text-left"
        >
          <ChildTile color={board.color} icon={board.icon} fallback={null} name={board.name} />
          <span className="truncate">{board.name}</span>
          {board.visibility === "PRIVATE" ? (
            <Lock className="w-3 h-3 text-zinc-400 shrink-0" />
          ) : null}
        </button>
        <span className="opacity-0 group-hover/boardrow:opacity-100 transition-opacity shrink-0 inline-flex items-center gap-0.5">
          <ShareBoardButton
            boardId={board.id}
            boardName={board.name}
            visibility={board.visibility}
            parentSpaceName={spaceName}
          />
          <BoardMoreTrigger
            board={{ id: board.id, name: board.name, icon: board.icon, color: board.color }}
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
      <div className="flex items-center gap-1 pl-5 pr-1.5 py-0.5 rounded-md hover:bg-zinc-50">
        <button
          type="button"
          onClick={() => router.push(`/tables/${table.id}`)}
          className="flex items-center gap-2 text-[12.5px] text-zinc-700 flex-1 min-w-0 text-left"
        >
          <ChildTile color="#0EA5E9" icon={null} fallback={TableIcon} name={table.name} />
          <span className="truncate">{table.name}</span>
        </button>
        <span className="opacity-0 group-hover/tablerow:opacity-100 transition-opacity shrink-0">
          <TableMoreTrigger table={{ id: table.id, name: table.name }} onUpdated={onChanged} />
        </span>
      </div>
    </li>
  );
}

function ChildTile({
  color,
  icon,
  fallback,
  name,
}: {
  color: string | null;
  icon: string | null;
  fallback: LucideIcon | null;
  name: string;
}) {
  const Icon = getSpaceIcon(icon) ?? fallback;
  const bg = color ?? DEFAULT_COLOR;
  return (
    <span
      className="h-4 w-4 rounded flex items-center justify-center text-white text-[9px] font-semibold uppercase shrink-0"
      style={{ backgroundColor: bg }}
    >
      {Icon ? createElement(Icon, { className: "h-2.5 w-2.5" }) : (name[0] ?? "?")}
    </span>
  );
}
