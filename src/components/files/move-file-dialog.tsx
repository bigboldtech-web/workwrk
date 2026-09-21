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

interface SpaceRow { id: string; name: string }
interface SpaceFolderRow { id: string; name: string; parentId?: string | null }

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
  const [spaces, setSpaces] = useState<SpaceRow[] | null>(null);
  const [expandedSpace, setExpandedSpace] = useState<string | null>(null);
  const [spaceFolders, setSpaceFolders] = useState<Record<string, SpaceFolderRow[]>>({});
  const [loadingFolders, setLoadingFolders] = useState<string | null>(null);
  const [dest, setDest] = useState<Destination>({ kind: "drive", folderId: currentFolderId });
  const [moving, setMoving] = useState(false);

  useEffect(() => {
    let live = true;
    void (async () => {
      const [f, s] = await Promise.all([
        apiFetch<FolderTreeRow[] | { data: FolderTreeRow[] }>("/api/files/folders", { cache: "no-store" }),
        apiFetch<{ spaces: SpaceRow[] } | SpaceRow[]>("/api/spaces", { cache: "no-store" }),
      ]);
      if (!live) return;
      setFolders(f.ok ? (Array.isArray(f.data) ? f.data : f.data.data ?? []) : []);
      setSpaces(s.ok ? (Array.isArray(s.data) ? s.data : s.data.spaces ?? []) : []);
    })();
    return () => { live = false; };
  }, []);

  const expandSpace = useCallback(async (spaceId: string) => {
    setExpandedSpace((cur) => (cur === spaceId ? null : spaceId));
    if (spaceFolders[spaceId]) return;
    setLoadingFolders(spaceId);
    const r = await apiFetch<SpaceFolderRow[] | { folders?: SpaceFolderRow[]; data?: SpaceFolderRow[] }>(`/api/folders?spaceId=${encodeURIComponent(spaceId)}`, { cache: "no-store" });
    const rows = r.ok ? (Array.isArray(r.data) ? r.data : r.data.folders ?? r.data.data ?? []) : [];
    setSpaceFolders((prev) => ({ ...prev, [spaceId]: rows }));
    setLoadingFolders(null);
  }, [spaceFolders]);

  const destinationLabel = useMemo(() => {
    if (dest.kind === "drive") return dest.folderId ? folders?.find((f) => f.id === dest.folderId)?.name ?? "Folder" : "Files";
    const sp = spaces?.find((s) => s.id === dest.spaceId)?.name ?? "Space";
    const sf = dest.spaceFolderId ? spaceFolders[dest.spaceId]?.find((f) => f.id === dest.spaceFolderId)?.name : null;
    return sf ? `${sp} › ${sf}` : sp;
  }, [dest, folders, spaces, spaceFolders]);

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

  const unchanged = dest.kind === "drive" && dest.folderId === currentFolderId;
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
            folders === null ? <SkeletonLines lines={3} /> : (
              <FolderTree folders={folders} rootLabel="Files" selectedId={dest.kind === "drive" ? dest.folderId : "__none__"} onSelect={(id) => setDest({ kind: "drive", folderId: id })} />
            )
          ) : spaces === null ? <SkeletonLines lines={3} /> : spaces.length === 0 ? (
            <p className="px-2 py-3 text-base text-ink-2">No Spaces yet.</p>
          ) : (
            <ul className="flex flex-col gap-0.5" role="tree">
              {spaces.map((s) => {
                const on = dest.kind === "space" && dest.spaceId === s.id && !dest.spaceFolderId;
                const open = expandedSpace === s.id;
                return (
                  <li key={s.id}>
                    <div role="treeitem" aria-selected={on} aria-expanded={open} className={cn("os-chrome flex h-9 cursor-pointer items-center gap-2 rounded-md px-2 text-base", on ? "bg-active font-medium text-ink" : "text-ink hover:bg-hover")} onClick={() => setDest({ kind: "space", spaceId: s.id, spaceFolderId: null })}>
                      <button type="button" onClick={(e) => { e.stopPropagation(); void expandSpace(s.id); }} aria-label={`Show folders in ${s.name}`} className="inline-flex h-6 w-6 shrink-0 items-center justify-center rounded text-ink-2 hover:bg-active hover:text-ink">
                        <ChevronRight className={cn("h-4 w-4 transition-transform", open ? "rotate-90" : "rtl:rotate-180")} strokeWidth={1.5} aria-hidden />
                      </button>
                      <Layers className="h-5 w-5 shrink-0 text-ink-2" strokeWidth={1.5} aria-hidden />
                      <span className="min-w-0 flex-1 truncate">{s.name}</span>
                    </div>
                    {open ? (
                      loadingFolders === s.id ? <div className="ps-10 py-1"><SkeletonLines lines={2} /></div>
                      : (spaceFolders[s.id] ?? []).length === 0 ? <p className="py-1.5 ps-10 text-sm text-ink-2">No folders in this Space.</p>
                      : (spaceFolders[s.id] ?? []).map((f) => {
                        const onF = dest.kind === "space" && dest.spaceFolderId === f.id;
                        return (
                          <div key={f.id} role="treeitem" aria-selected={onF} className={cn("os-chrome flex h-9 cursor-pointer items-center gap-2 rounded-md pe-2 text-base", onF ? "bg-active font-medium text-ink" : "text-ink hover:bg-hover")} style={{ paddingInlineStart: 28 }} onClick={() => setDest({ kind: "space", spaceId: s.id, spaceFolderId: f.id })}>
                            <span className="h-6 w-6 shrink-0" aria-hidden />
                            <FolderOpen className="h-5 w-5 shrink-0 text-ink-2" strokeWidth={1.5} aria-hidden />
                            <span className="min-w-0 flex-1 truncate">{f.name}</span>
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
