"use client";

// MoveTargetDialog — pick where to move a List/Board or a Space.
//   kind="board" → choose a Space (space-direct) or one of its Folders.
//   kind="space" → choose a new parent Space, or "Top level".
// A self-contained centered modal (no dropdowns inside, so no portal/anchor
// gymnastics). The server re-validates the destination and rejects cycles /
// permission gaps, so the UI can stay simple.

import { useCallback, useEffect, useRef, useState } from "react";
import { ChevronDown, ChevronRight, Folder as FolderIcon, Hash, Loader2, ArrowUpToLine, X } from "lucide-react";
import { useOsToast } from "./toast";

type Space = { id: string; name: string };
type FolderT = { id: string; name: string };

export function MoveTargetDialog({
  kind,
  entityId,
  entityName,
  onClose,
  onMoved,
}: {
  kind: "board" | "space";
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
  const busyRef = useRef(false);

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
  const moveSpace = (parentSpaceId: string | null) =>
    void doMove(`/api/spaces/${entityId}/move`, { parentSpaceId });

  const rowBtn = "flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-[13.5px] text-zinc-800 hover:bg-zinc-100 disabled:opacity-50";

  return (
    <div className="fixed inset-0 z-[130] flex items-center justify-center bg-black/40 p-4" onClick={onClose}>
      <div
        className="flex max-h-[70vh] w-full max-w-md flex-col overflow-hidden rounded-xl border border-zinc-200 bg-white shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between border-b border-zinc-100 px-4 py-3">
          <h2 className="truncate text-[15px] font-semibold text-zinc-900">Move “{entityName}”</h2>
          <button type="button" onClick={onClose} aria-label="Close" className="rounded p-1 text-zinc-400 hover:bg-zinc-100 hover:text-zinc-700">
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto p-2">
          {spaces === null ? (
            <div className="flex items-center gap-2 px-2 py-6 text-[13px] text-zinc-400">
              <Loader2 className="h-4 w-4 animate-spin" /> Loading…
            </div>
          ) : (
            <>
              {kind === "space" ? (
                <button type="button" className={rowBtn} disabled={busy} onClick={() => moveSpace(null)}>
                  <ArrowUpToLine className="h-4 w-4 shrink-0 text-zinc-400" />
                  <span className="font-medium">Top level</span>
                </button>
              ) : null}

              {spaces.filter((s) => !(kind === "space" && s.id === entityId)).map((s) => (
                <div key={s.id}>
                  <div className="flex items-center">
                    {kind === "board" ? (
                      <button
                        type="button"
                        aria-label={expanded === s.id ? "Collapse" : "Expand folders"}
                        className="shrink-0 rounded p-1 text-zinc-400 hover:bg-zinc-100 hover:text-zinc-700"
                        onClick={() => toggleExpand(s.id)}
                      >
                        {expanded === s.id ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronRight className="h-3.5 w-3.5" />}
                      </button>
                    ) : null}
                    <button
                      type="button"
                      className={rowBtn}
                      disabled={busy}
                      onClick={() => (kind === "board" ? moveBoard(s.id, null) : moveSpace(s.id))}
                    >
                      <Hash className="h-4 w-4 shrink-0 text-zinc-400" />
                      <span className="min-w-0 flex-1 truncate">{s.name}</span>
                    </button>
                  </div>

                  {kind === "board" && expanded === s.id ? (
                    <div className="ml-6 border-l border-zinc-100 pl-1">
                      {folders[s.id] === "loading" ? (
                        <div className="flex items-center gap-2 px-2 py-1.5 text-[12.5px] text-zinc-400">
                          <Loader2 className="h-3.5 w-3.5 animate-spin" /> Loading folders…
                        </div>
                      ) : (folders[s.id] as FolderT[]).length === 0 ? (
                        <div className="px-2 py-1.5 text-[12.5px] text-zinc-400">No folders</div>
                      ) : (
                        (folders[s.id] as FolderT[]).map((f) => (
                          <button key={f.id} type="button" className={rowBtn} disabled={busy} onClick={() => moveBoard(s.id, f.id)}>
                            <FolderIcon className="h-4 w-4 shrink-0 text-zinc-400" />
                            <span className="min-w-0 flex-1 truncate">{f.name}</span>
                          </button>
                        ))
                      )}
                    </div>
                  ) : null}
                </div>
              ))}

              {spaces.length === 0 ? (
                <div className="px-2 py-6 text-[13px] text-zinc-400">No Spaces available.</div>
              ) : null}
            </>
          )}
        </div>
      </div>
    </div>
  );
}
