"use client";

// MoveTargetDialog: pick where to move a List, a Folder or a Space.
//   kind="board"  -> choose a Space (space-direct) or one of its Folders.
//   kind="folder" -> choose a Space (root) or one of its Folders, minus the
//                    folder itself and everything beneath it.
//   kind="space"  -> choose a new parent Space, or "Top level".
// The server re-validates the destination and rejects cycles, depth and
// permission gaps, so the UI can stay simple.
//
// WHY IT PORTALS TO document.body. Every sidebar tree row wraps its "…" in a
// `-translate-y-1/2` span, and a transform makes that span the containing block
// for any `position: fixed` descendant. Rendered in place, this dialog laid
// itself out inside a 22x16 hover pill: the person clicked Move and nothing
// appeared. A portal to the body is the fix, and it is what every Radix dialog
// in the app already does.
//
// WHY A FOLDER IS NOT MOVED WITH THE SPACE FLAVOUR. It used to be: the trigger
// mounted `kind={kind === "list" ? "board" : "space"}`, so a Folder took the
// Space branch and POSTed `/api/spaces/<folderId>/move`, which looks the id up
// in `prisma.space` and 404s every time. The Folder flavour posts to
// `/api/folders/[id]/move`, the route written for it.

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { ChevronDown, ChevronRight, Folder as FolderIcon, Hash, ArrowUpToLine, X } from "lucide-react";
import { useOsToast } from "./toast";
import { SkeletonLines } from "@/components/ui/skeleton";

type Space = { id: string; name: string };
type FolderT = { id: string; name: string; parentFolderId?: string | null };

export type MoveKind = "board" | "folder" | "space";

/** The folder itself plus every folder beneath it, never a valid destination. */
function subtreeOf(folders: FolderT[], rootId: string): Set<string> {
  const out = new Set<string>([rootId]);
  let grew = true;
  while (grew) {
    grew = false;
    for (const f of folders) {
      if (f.parentFolderId && out.has(f.parentFolderId) && !out.has(f.id)) {
        out.add(f.id);
        grew = true;
      }
    }
  }
  return out;
}

export function MoveTargetDialog({
  kind,
  entityId,
  entityName,
  onClose,
  onMoved,
}: {
  kind: MoveKind;
  entityId: string;
  entityName: string;
  onClose: () => void;
  onMoved?: () => void;
}) {
  const { toast } = useOsToast();
  const [spaces, setSpaces] = useState<Space[] | null>(null);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [folders, setFolders] = useState<Record<string, FolderT[] | "loading">>({});
  const [busy, setBusy] = useState(false);
  const [mounted, setMounted] = useState(false);
  const busyRef = useRef(false);

  useEffect(() => setMounted(true), []);

  useEffect(() => {
    fetch("/api/spaces", { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => setSpaces(Array.isArray(d?.spaces) ? d.spaces : []))
      .catch(() => setSpaces([]));
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const loadFolders = useCallback(async (spaceId: string) => {
    setFolders((prev) => (prev[spaceId] ? prev : { ...prev, [spaceId]: "loading" }));
    try {
      const r = await fetch(`/api/folders?spaceId=${spaceId}`, { cache: "no-store" });
      const d = r.ok ? await r.json() : null;
      setFolders((prev) => ({ ...prev, [spaceId]: Array.isArray(d?.folders) ? d.folders : [] }));
    } catch {
      setFolders((prev) => ({ ...prev, [spaceId]: [] }));
    }
  }, []);

  const showsFolders = kind === "board" || kind === "folder";

  const toggleExpand = (spaceId: string) => {
    setExpanded((cur) => {
      const next = cur === spaceId ? null : spaceId;
      if (next && !folders[spaceId]) void loadFolders(spaceId);
      return next;
    });
  };

  const doMove = useCallback(async (url: string, body: Record<string, unknown>) => {
    if (busyRef.current) return;
    busyRef.current = true;
    setBusy(true);
    try {
      const res = await fetch(url, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      });
      const d = await res.json().catch(() => ({}));
      if (!res.ok) { toast(d?.error ?? "Couldn't move it"); return; }
      toast(`Moved “${entityName}”`);
      onMoved?.();
      onClose();
    } finally {
      busyRef.current = false;
      setBusy(false);
    }
  }, [entityName, onMoved, onClose, toast]);

  const moveBoard = (spaceId: string, folderId: string | null) =>
    void doMove(`/api/boards/${entityId}/move`, { spaceId, folderId });
  const moveFolder = (spaceId: string, parentFolderId: string | null) =>
    void doMove(`/api/folders/${entityId}/move`, { spaceId, parentFolderId });
  const moveSpace = (parentSpaceId: string | null) =>
    void doMove(`/api/spaces/${entityId}/move`, { parentSpaceId });

  const pickSpace = (spaceId: string) => {
    if (kind === "board") return moveBoard(spaceId, null);
    if (kind === "folder") return moveFolder(spaceId, null);
    return moveSpace(spaceId);
  };
  const pickFolder = (spaceId: string, folderId: string) =>
    kind === "board" ? moveBoard(spaceId, folderId) : moveFolder(spaceId, folderId);

  // A Space is never a destination for itself; a Folder is never a destination
  // for itself or for anything on its own branch.
  const excludedFolders = useMemo(() => {
    if (kind !== "folder") return new Set<string>();
    const all = Object.values(folders).flatMap((f) => (f === "loading" ? [] : f));
    return subtreeOf(all, entityId);
  }, [folders, kind, entityId]);

  const rowBtn =
    "flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-start text-base text-ink hover:bg-hover disabled:opacity-50";

  const body = (
    <div className="fixed inset-0 z-[130] flex items-center justify-center bg-black/40 p-4" onClick={onClose}>
      <div
        role="dialog"
        aria-modal="true"
        aria-label={`Move ${entityName}`}
        className="flex max-h-[70vh] w-full max-w-md flex-col overflow-hidden rounded-xl border border-line bg-raised"
        style={{ boxShadow: "var(--os-shadow-pop)" }}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between border-b border-line-soft px-4 py-3">
          <h2 className="truncate text-base font-semibold text-ink">Move “{entityName}”</h2>
          <button type="button" onClick={onClose} aria-label="Close" className="rounded p-1 text-ink-3 hover:bg-hover hover:text-ink">
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto p-2">
          {spaces === null ? (
            <SkeletonLines lines={4} className="px-2" />
          ) : (
            <>
              {kind === "space" ? (
                <button type="button" className={rowBtn} disabled={busy} onClick={() => moveSpace(null)}>
                  <ArrowUpToLine className="h-4 w-4 shrink-0 text-ink-3" />
                  <span className="font-medium">Top level</span>
                </button>
              ) : null}

              {spaces.filter((s) => !(kind === "space" && s.id === entityId)).map((s) => (
                <div key={s.id}>
                  <div className="flex items-center">
                    {showsFolders ? (
                      <button
                        type="button"
                        aria-label={expanded === s.id ? "Collapse" : "Expand folders"}
                        className="shrink-0 rounded p-1 text-ink-3 hover:bg-hover hover:text-ink"
                        onClick={() => toggleExpand(s.id)}
                      >
                        {expanded === s.id ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronRight className="h-3.5 w-3.5 rtl:rotate-180" />}
                      </button>
                    ) : null}
                    <button
                      type="button"
                      className={rowBtn}
                      disabled={busy}
                      onClick={() => pickSpace(s.id)}
                    >
                      <Hash className="h-4 w-4 shrink-0 text-ink-3" />
                      <span className="min-w-0 flex-1 truncate">{s.name}</span>
                    </button>
                  </div>

                  {showsFolders && expanded === s.id ? (
                    <div className="ms-6 border-s border-line-soft ps-1">
                      {folders[s.id] === "loading" ? (
                        <SkeletonLines lines={2} className="px-2" />
                      ) : (() => {
                        const list = (folders[s.id] as FolderT[]).filter((f) => !excludedFolders.has(f.id));
                        if (list.length === 0) {
                          return <div className="px-2 py-1.5 text-xs text-ink-3">No folders</div>;
                        }
                        return list.map((f) => (
                          <button key={f.id} type="button" className={rowBtn} disabled={busy} onClick={() => pickFolder(s.id, f.id)}>
                            <FolderIcon className="h-4 w-4 shrink-0 text-ink-3" />
                            <span className="min-w-0 flex-1 truncate">{f.name}</span>
                          </button>
                        ));
                      })()}
                    </div>
                  ) : null}
                </div>
              ))}

              {spaces.length === 0 ? (
                <div className="px-2 py-6 text-sm text-ink-3">No Spaces available.</div>
              ) : null}
            </>
          )}
        </div>
      </div>
    </div>
  );

  if (!mounted) return null;
  return createPortal(body, document.body);
}
