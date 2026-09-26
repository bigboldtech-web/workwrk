"use client";

// MoveTargetDialog: pick where to move a List, a Folder or a Space.
//   kind="board"  -> a Space's root or one of its Folders.
//   kind="folder" -> a Space's root or one of its Folders (never itself or
//                    anything beneath it).
//   kind="space"  -> a new parent Space, or "Top level".
//
// WHAT IT OFFERS IS WHAT THE MOVE ACCEPTS (the placement rule, node-rules P5).
// For a List or a Folder the places come from GET /api/move/destinations,
// which asks the one move rule per place (Full access on the node and where it
// is now, Can edit where it goes). So a Folder grantee sees their Folder under
// the Space they only pass through, and no Space is listed where the move
// would be refused. It used to list every Space in the org, and the Folders
// of a Space only through a read of that Space, so the one legitimate
// destination of a Folder grantee showed as "No folders".
//
// A REFUSAL KEEPS THE CHOICE (P6). The server still decides; when it refuses,
// its one sentence is shown under the place that was picked and the dialog
// stays open with that place marked, so the person can pick another.
//
// WHY IT PORTALS TO document.body. Every sidebar tree row wraps its "…" in a
// `-translate-y-1/2` span, and a transform makes that span the containing block
// for any `position: fixed` descendant. Rendered in place, this dialog laid
// itself out inside a 22x16 hover pill: the person clicked Move and nothing
// appeared. A portal to the body is the fix, and it is what every Radix dialog
// in the app already does.

import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { ChevronDown, ChevronRight, Folder as FolderIcon, Hash, ArrowUpToLine, X } from "lucide-react";
import { useOsToast } from "./toast";
import { SkeletonLines } from "@/components/ui/skeleton";

export type MoveKind = "board" | "folder" | "space";

type DestFolder = { id: string; name: string; parentFolderId: string | null; pickable: boolean; current: boolean };
type DestSpace = { id: string; name: string; pickable: boolean; current: boolean; folders: DestFolder[] };
type SpaceRow = { id: string; name: string; role?: string | null };

/** Depth of each listed Folder under its Space, for the indent. */
function depthsOf(folders: DestFolder[]): Map<string, number> {
  const byId = new Map(folders.map((f) => [f.id, f]));
  const out = new Map<string, number>();
  for (const f of folders) {
    let d = 0;
    let cursor = f.parentFolderId;
    const seen = new Set<string>([f.id]);
    while (cursor && byId.has(cursor) && !seen.has(cursor) && d < 16) {
      seen.add(cursor);
      d += 1;
      cursor = byId.get(cursor)?.parentFolderId ?? null;
    }
    out.set(f.id, d);
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
  const [spaces, setSpaces] = useState<DestSpace[] | null>(null);
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);
  const [mounted, setMounted] = useState(false);
  const [refusal, setRefusal] = useState<{ key: string; message: string } | null>(null);
  const busyRef = useRef(false);

  useEffect(() => setMounted(true), []);

  useEffect(() => {
    let alive = true;
    if (kind === "space") {
      // Nesting a Space needs Full access on the parent (spaces/[id]/move):
      // only the Spaces the viewer manages are places it can go.
      fetch("/api/spaces?paths=0&counts=0", { cache: "no-store" })
        .then((r) => (r.ok ? r.json() : null))
        .then((d) => {
          if (!alive) return;
          const rows: SpaceRow[] = Array.isArray(d?.spaces) ? d.spaces : [];
          setSpaces(rows.filter((s) => s.id !== entityId && s.role === "full").map((s) => ({ id: s.id, name: s.name, pickable: true, current: false, folders: [] })));
        })
        .catch(() => { if (alive) setSpaces([]); });
    } else {
      fetch(`/api/move/destinations?kind=${kind === "board" ? "list" : "folder"}&id=${encodeURIComponent(entityId)}`, { cache: "no-store" })
        .then((r) => (r.ok ? r.json() : null))
        .then((d) => { if (alive) setSpaces(Array.isArray(d?.spaces) ? d.spaces : []); })
        .catch(() => { if (alive) setSpaces([]); });
    }
    return () => { alive = false; };
  }, [kind, entityId]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const doMove = useCallback(async (key: string, url: string, body: Record<string, unknown>) => {
    if (busyRef.current) return;
    busyRef.current = true;
    setBusy(true);
    setRefusal(null);
    try {
      const res = await fetch(url, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      });
      const d = await res.json().catch(() => ({}));
      if (!res.ok) {
        // The one sentence the server names what is needed with; the
        // dialog stays open with the place still marked.
        const message = typeof d?.error === "string" && d.error ? d.error : "Couldn't move it there.";
        setRefusal({ key, message });
        toast(message);
        return;
      }
      toast(`Moved “${entityName}”`);
      onMoved?.();
      onClose();
    } finally {
      busyRef.current = false;
      setBusy(false);
    }
  }, [entityName, onMoved, onClose, toast]);

  const pickSpace = (spaceId: string) => {
    const key = `space:${spaceId}`;
    if (kind === "board") return void doMove(key, `/api/boards/${entityId}/move`, { spaceId, folderId: null });
    if (kind === "folder") return void doMove(key, `/api/folders/${entityId}/move`, { spaceId, parentFolderId: null });
    return void doMove(key, `/api/spaces/${entityId}/move`, { parentSpaceId: spaceId });
  };
  const pickFolder = (spaceId: string, folderId: string) => {
    const key = `folder:${folderId}`;
    if (kind === "board") return void doMove(key, `/api/boards/${entityId}/move`, { spaceId, folderId });
    return void doMove(key, `/api/folders/${entityId}/move`, { parentFolderId: folderId });
  };

  const toggle = (spaceId: string) =>
    setCollapsed((cur) => {
      const next = new Set(cur);
      if (next.has(spaceId)) next.delete(spaceId); else next.add(spaceId);
      return next;
    });

  const rowBtn =
    "flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-start text-base text-ink hover:bg-hover disabled:opacity-50";
  const rowLabel = "flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-start text-base text-ink-3";
  const marked = "bg-selected";

  const refusalLine = (key: string) =>
    refusal?.key === key ? <p role="alert" className="ms-8 me-2 mb-1 text-sm text-danger-text">{refusal.message}</p> : null;

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
                <>
                  <button type="button" className={`${rowBtn} ${refusal?.key === "top" ? marked : ""}`} disabled={busy} onClick={() => void doMove("top", `/api/spaces/${entityId}/move`, { parentSpaceId: null })}>
                    <ArrowUpToLine className="h-4 w-4 shrink-0 text-ink-3" />
                    <span className="font-medium">Top level</span>
                  </button>
                  {refusalLine("top")}
                </>
              ) : null}

              {spaces.map((s) => {
                const open = !collapsed.has(s.id);
                const depths = depthsOf(s.folders);
                const spaceKey = `space:${s.id}`;
                return (
                  <div key={s.id}>
                    <div className="flex items-center">
                      {s.folders.length > 0 ? (
                        <button
                          type="button"
                          aria-label={open ? "Collapse" : "Expand folders"}
                          aria-expanded={open}
                          className="shrink-0 rounded p-1 text-ink-3 hover:bg-hover hover:text-ink"
                          onClick={() => toggle(s.id)}
                        >
                          {open ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronRight className="h-3.5 w-3.5 rtl:rotate-180" />}
                        </button>
                      ) : <span className="w-[22px] shrink-0" aria-hidden />}
                      {s.pickable ? (
                        <button type="button" className={`${rowBtn} ${refusal?.key === spaceKey ? marked : ""}`} disabled={busy} onClick={() => pickSpace(s.id)}>
                          <Hash className="h-4 w-4 shrink-0 text-ink-3" />
                          <span className="min-w-0 flex-1 truncate">{s.name}</span>
                        </button>
                      ) : (
                        <div className={rowLabel}>
                          <Hash className="h-4 w-4 shrink-0" />
                          <span className="min-w-0 flex-1 truncate">{s.name}</span>
                          {s.current ? <span className="shrink-0 text-xs">Here now</span> : null}
                        </div>
                      )}
                    </div>
                    {refusalLine(spaceKey)}

                    {open && s.folders.length > 0 ? (
                      <div className="ms-6 border-s border-line-soft ps-1">
                        {s.folders.map((f) => {
                          const indent = { paddingInlineStart: `${(depths.get(f.id) ?? 0) * 12}px` };
                          const folderKey = `folder:${f.id}`;
                          return (
                            <div key={f.id} style={indent}>
                              {f.pickable ? (
                                <button type="button" className={`${rowBtn} ${refusal?.key === folderKey ? marked : ""}`} disabled={busy} onClick={() => pickFolder(s.id, f.id)}>
                                  <FolderIcon className="h-4 w-4 shrink-0 text-ink-3" />
                                  <span className="min-w-0 flex-1 truncate">{f.name}</span>
                                </button>
                              ) : (
                                <div className={rowLabel}>
                                  <FolderIcon className="h-4 w-4 shrink-0" />
                                  <span className="min-w-0 flex-1 truncate">{f.name}</span>
                                  {f.current ? <span className="shrink-0 text-xs">Here now</span> : null}
                                </div>
                              )}
                              {refusalLine(folderKey)}
                            </div>
                          );
                        })}
                      </div>
                    ) : null}
                  </div>
                );
              })}

              {spaces.length === 0 && kind !== "space" ? (
                <div className="px-2 py-6 text-sm text-ink-3">There is nowhere you can move this. Moving needs Full access where it is now and Can edit where it goes.</div>
              ) : null}
              {spaces.length === 0 && kind === "space" ? (
                <div className="px-2 py-6 text-sm text-ink-3">No other Space you manage.</div>
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
