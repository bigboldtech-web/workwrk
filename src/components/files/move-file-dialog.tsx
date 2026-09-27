"use client";

// MoveFileDialog (spec-docs-knowledge section 2, /files "Move to…"): a 560
// dialog on ui/dialog with the drive folder tree (FolderTree) and the Spaces
// (a Space root, or one of its folders). Moving PATCHes /api/files/[id]
// with `{ folderId }` (drive) or `{ spaceFolderId } / { spaceId }` (Space)
// and broadcasts `workwrk:files-changed`.
//
// Before this the dialog offered Spaces only: a file could be moved INTO a
// Space but never between two drive folders, so the only way to change a
// file's drive folder was to re-upload it.

import { useCallback, useEffect, useMemo, useState } from "react";
import { ChevronRight, FolderOpen, HardDrive, Layers } from "lucide-react";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Dots } from "@/components/ui/dots";
import { SkeletonLines } from "@/components/ui/skeleton";
import { useOsToast } from "@/components/layout/os/toast";
import { apiFetch } from "@/lib/api-fetch";
import { FolderTree, type FolderTreeRow } from "./folder-tree";
import { cn } from "@/lib/utils";

/** GET /api/move/destinations?kind=file: the places the file move rule accepts, in the move shape. */
interface DestFolder { id: string; name: string; parentFolderId: string | null; pickable: boolean; current: boolean }
interface SpaceRow { id: string; name: string; pickable: boolean; current: boolean; folders: DestFolder[] }
interface FileDestinations { root: { pickable: boolean; current: boolean } | null; spaces?: SpaceRow[] }

/** The one sentence the Files tab shows when the file may not leave its Space (node-rules fileMoveVerdict). */
const CANT_LEAVE_SPACE = "Only the person who uploaded this file, or an admin, with Full access where it is now can take it out of its Space.";

/** How deep each listed Folder sits under its Space, for the indent. */
function folderDepth(folders: DestFolder[], id: string): number {
  const byId = new Map(folders.map((f) => [f.id, f]));
  let d = 0;
  let cursor = byId.get(id)?.parentFolderId ?? null;
  while (cursor && byId.has(cursor) && d < 8) {
    d += 1;
    cursor = byId.get(cursor)?.parentFolderId ?? null;
  }
  return d;
}

type Destination =
  | { kind: "drive"; folderId: string | null }
  | { kind: "space"; spaceId: string; spaceFolderId: string | null };

export function MoveFileDialog({ fileId, fileName, currentFolderId = null, onClose, onMoved }: {
  fileId: string;
  fileName: string;
  /** The file's drive folder today, preselected. */
  currentFolderId?: string | null;
  onClose: () => void;
  onMoved?: () => void;
}) {
  const { toast } = useOsToast();
  const [tab, setTab] = useState<"drive" | "spaces">("drive");
  const [folders, setFolders] = useState<FolderTreeRow[] | null>(null);
  // WHAT IT OFFERS IS WHAT THE MOVE ACCEPTS (the placement rule, node-rules
  // P5): the Spaces and Folders come from GET /api/move/destinations, which
  // asks the file move rule per place (Full access where the file is now, Can
  // edit where it goes; out of every Space, its uploader or an admin). It
  // used to list every Space the person could read and each Space's Folders
  // with no role at all, and the move refused the picks.
  const [spaces, setSpaces] = useState<SpaceRow[] | null>(null);
  const [root, setRoot] = useState<FileDestinations["root"]>(null);
  const [expandedSpace, setExpandedSpace] = useState<string | null>(null);
  const [dest, setDest] = useState<Destination>({ kind: "drive", folderId: currentFolderId });
  const [moving, setMoving] = useState(false);

  useEffect(() => {
    let live = true;
    void (async () => {
      const [f, d] = await Promise.all([
        apiFetch<FolderTreeRow[] | { data: FolderTreeRow[] }>("/api/files/folders", { cache: "no-store" }),
        apiFetch<FileDestinations>(`/api/move/destinations?kind=file&id=${encodeURIComponent(fileId)}`, { cache: "no-store" }),
      ]);
      if (!live) return;
      setFolders(f.ok ? (Array.isArray(f.data) ? f.data : f.data.data ?? []) : []);
      setSpaces(d.ok ? (d.data.spaces ?? []).map((s) => ({ ...s, folders: Array.isArray(s.folders) ? s.folders : [] })) : []);
      setRoot(d.ok ? d.data.root : null);
    })();
    return () => { live = false; };
  }, [fileId]);

  const expandSpace = useCallback((spaceId: string) => {
    setExpandedSpace((cur) => (cur === spaceId ? null : spaceId));
  }, []);

  // The Files tab (a drive folder) is the org root: open when the file is
  // already there, or when the rule lets it leave its Space.
  const driveOpen = root?.current === true || root?.pickable === true;

  const destinationLabel = useMemo(() => {
    if (dest.kind === "drive") return dest.folderId ? folders?.find((f) => f.id === dest.folderId)?.name ?? "Folder" : "Files";
    const sp = spaces?.find((s) => s.id === dest.spaceId);
    const sf = dest.spaceFolderId ? sp?.folders.find((f) => f.id === dest.spaceFolderId)?.name : null;
    return sf ? `${sp?.name ?? "Space"} › ${sf}` : sp?.name ?? "Space";
  }, [dest, folders, spaces]);

  async function move() {
    setMoving(true);
    const body = dest.kind === "drive"
      ? { folderId: dest.folderId, spaceId: null, spaceFolderId: null }
      : dest.spaceFolderId ? { spaceFolderId: dest.spaceFolderId, folderId: null } : { spaceId: dest.spaceId, spaceFolderId: null, folderId: null };
    const r = await apiFetch(`/api/files/${fileId}`, { method: "PATCH", json: body });
    setMoving(false);
    if (!r.ok) { toast(r.error || "Couldn't move the file", { tone: "danger" }); return; }
    toast(`Moved to ${destinationLabel}`);
    window.dispatchEvent(new CustomEvent("workwrk:files-changed"));
    onMoved?.();
    onClose();
  }

  const unchanged = (dest.kind === "drive" && (dest.folderId === currentFolderId || !driveOpen))
    || (dest.kind === "space" && !(dest.spaceFolderId
      ? spaces?.find((s) => s.id === dest.spaceId)?.folders.find((f) => f.id === dest.spaceFolderId)?.pickable
      : spaces?.find((s) => s.id === dest.spaceId)?.pickable));
  const tabCls = (on: boolean) => cn("os-chrome inline-flex h-8 items-center rounded-md px-3 text-base", on ? "bg-active font-medium text-ink" : "text-ink-2 hover:bg-hover hover:text-ink");

  return (
    <Dialog open onOpenChange={(v) => { if (!v) onClose(); }}>
      <DialogContent className="max-w-[560px] gap-0 p-0">
        <DialogHeader className="px-6 pb-3 pt-6">
          <DialogTitle className="truncate text-lg font-semibold">Move “{fileName}”</DialogTitle>
          <DialogDescription>Choose a folder in Files, or a Space.</DialogDescription>
        </DialogHeader>
        <div className="flex items-center gap-1 px-6 pb-2" role="tablist">
          <button type="button" role="tab" aria-selected={tab === "drive"} onClick={() => setTab("drive")} className={tabCls(tab === "drive")}>Files</button>
          <button type="button" role="tab" aria-selected={tab === "spaces"} onClick={() => setTab("spaces")} className={tabCls(tab === "spaces")}>Spaces</button>
        </div>
        <div className="max-h-[50vh] overflow-y-auto border-y border-line px-4 py-2">
          {tab === "drive" ? (
            folders === null || spaces === null ? <SkeletonLines lines={3} /> : !driveOpen ? (
              <p className="px-2 py-3 text-base text-ink-2">{CANT_LEAVE_SPACE}</p>
            ) : (
              <FolderTree folders={folders} rootLabel="Files" selectedId={dest.kind === "drive" ? dest.folderId : "__none__"} onSelect={(id) => setDest({ kind: "drive", folderId: id })} />
            )
          ) : spaces === null ? <SkeletonLines lines={3} /> : spaces.length === 0 ? (
            <p className="px-2 py-3 text-base text-ink-2">There is no Space you can move this file into. Moving it needs Full access where it is now and Can edit where it goes.</p>
          ) : (
            <ul className="flex flex-col gap-0.5" role="tree">
              {spaces.map((s) => {
                const on = dest.kind === "space" && dest.spaceId === s.id && !dest.spaceFolderId;
                const open = expandedSpace === s.id;
                return (
                  <li key={s.id}>
                    <div
                      role="treeitem"
                      aria-selected={on}
                      aria-expanded={open}
                      aria-disabled={!s.pickable}
                      className={cn("os-chrome flex h-9 items-center gap-2 rounded-md px-2 text-base", !s.pickable ? "text-ink-3" : on ? "cursor-pointer bg-active font-medium text-ink" : "cursor-pointer text-ink hover:bg-hover")}
                      onClick={() => { if (s.pickable) setDest({ kind: "space", spaceId: s.id, spaceFolderId: null }); else expandSpace(s.id); }}
                    >
                      <button type="button" onClick={(e) => { e.stopPropagation(); expandSpace(s.id); }} aria-label={`Show folders in ${s.name}`} className="inline-flex h-6 w-6 shrink-0 items-center justify-center rounded text-ink-2 hover:bg-active hover:text-ink">
                        <ChevronRight className={cn("h-4 w-4 transition-transform", open ? "rotate-90" : "rtl:rotate-180")} strokeWidth={1.5} aria-hidden />
                      </button>
                      <Layers className="h-5 w-5 shrink-0 text-ink-2" strokeWidth={1.5} aria-hidden />
                      <span className="min-w-0 flex-1 truncate">{s.name}</span>
                      {s.current ? <span className="shrink-0 text-xs text-ink-3">Here now</span> : null}
                    </div>
                    {open ? (
                      s.folders.length === 0 ? <p className="py-1.5 ps-10 text-sm text-ink-2">No folders you can move it into.</p>
                      : s.folders.map((f) => {
                        const onF = dest.kind === "space" && dest.spaceFolderId === f.id;
                        return (
                          <div
                            key={f.id}
                            role="treeitem"
                            aria-selected={onF}
                            aria-disabled={!f.pickable}
                            className={cn("os-chrome flex h-9 items-center gap-2 rounded-md pe-2 text-base", !f.pickable ? "text-ink-3" : onF ? "cursor-pointer bg-active font-medium text-ink" : "cursor-pointer text-ink hover:bg-hover")}
                            style={{ paddingInlineStart: 28 + folderDepth(s.folders, f.id) * 12 }}
                            onClick={() => { if (f.pickable) setDest({ kind: "space", spaceId: s.id, spaceFolderId: f.id }); }}
                          >
                            <span className="h-6 w-6 shrink-0" aria-hidden />
                            <FolderOpen className="h-5 w-5 shrink-0 text-ink-2" strokeWidth={1.5} aria-hidden />
                            <span className="min-w-0 flex-1 truncate">{f.name}</span>
                            {f.current ? <span className="shrink-0 text-xs text-ink-3">Here now</span> : null}
                          </div>
                        );
                      })
                    ) : null}
                  </li>
                );
              })}
            </ul>
          )}
        </div>
        <div className="flex items-center gap-2 px-6 py-3">
          <span className="min-w-0 flex-1 truncate text-sm text-ink-2"><HardDrive className="me-1 inline h-3.5 w-3.5 align-[-2px]" strokeWidth={1.5} aria-hidden />Move to {destinationLabel}</span>
          <button type="button" onClick={onClose} className="h-9 rounded-md px-3 text-base font-medium text-ink-2 hover:bg-hover">Cancel</button>
          <button type="button" onClick={() => void move()} disabled={moving || unchanged} className="inline-flex h-9 items-center gap-2 rounded-md bg-brand px-4 text-base font-medium text-white hover:bg-brand-hover disabled:cursor-not-allowed disabled:bg-active disabled:text-ink-4">
            {moving ? <Dots variant="pending" /> : null}Move
          </button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
