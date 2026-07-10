"use client";

// BoardItemDrawer — right-slide-in detail panel for any Board Item
// (TABLE row or KANBAN card). Phase 3d MVP:
//   - Title (large, inline-editable)
//   - Status pill picker (same palette as table/kanban)
//   - Description (textarea, auto-saves to metadata.description on blur)
//   - Owner display (picker comes in Phase 3e once a /api/users endpoint exists)
//   - Created / updated dates
//   - Comments thread — placeholder (ItemUpdate wiring lands in Phase 3e)
//
// Visual spec from 2026-06-02 Monday-clean memory: whitespace > color,
// no decorative borders, single accent for active controls, type-driven
// hierarchy. Drawer slides from the right at 480px, full-height.

import { useCallback, useEffect, useState } from "react";
import { Trash2, X, ExternalLink } from "lucide-react";
import Link from "next/link";
import { DEFAULT_STATUS_OPTIONS, type BoardItemRow, type StatusOption } from "@/lib/board-items-shared";
import type { FieldDef } from "@/lib/field-catalog";
import { BoardItemDetail, type DetailPatch, type ItemModuleGating } from "./board-item-detail";
import { useConfirm } from "@/components/ui/dialog-provider";

interface BoardItemDrawerProps {
  itemId: string | null;
  canEdit: boolean;
  /** Current user id — passed through to ItemThread so it can gate
   *  "delete my own comment". */
  currentUserId: string | null;
  /** Custom fields defined on the parent Board. Renders editor rows
   *  in the field grid; empty array means no custom fields. */
  fields?: FieldDef[];
  /** Per-List statuses (backbone #1) — the parent board's own set.
   *  Defaults to the canonical trio for callers without board context. */
  statuses?: StatusOption[];
  onClose: () => void;
  onItemChanged?: (item: BoardItemRow) => void;
  onItemArchived?: (itemId: string) => void;
  /** Navigate the drawer to another item (used by the subtask list). */
  onOpenItem?: (itemId: string) => void;
  /** Space-module gating — threaded to BoardItemDetail to hide
   *  Priority / Tags / custom fields / TimeTracker when off. */
  moduleGating?: ItemModuleGating;
}

export function BoardItemDrawer({
  itemId,
  canEdit,
  currentUserId,
  fields,
  statuses,
  onClose,
  onItemChanged,
  onItemArchived,
  onOpenItem,
  moduleGating,
}: BoardItemDrawerProps) {
  const confirm = useConfirm();
  const customFields: FieldDef[] = fields ?? [];
  const statusOptions: StatusOption[] = statuses ?? [...DEFAULT_STATUS_OPTIONS];
  const [item, setItem] = useState<BoardItemRow | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Load when itemId changes.
  useEffect(() => {
    if (!itemId) {
      setItem(null);
      return;
    }
    setLoading(true);
    setError(null);
    let active = true;
    (async () => {
      try {
        const res = await fetch(`/api/items/${itemId}`, { cache: "no-store" });
        if (!res.ok) {
          if (active) setError("Could not load item");
          return;
        }
        const data = await res.json();
        if (active) setItem(data.item);
      } catch (e) {
        if (active) setError(e instanceof Error ? e.message : "Failed to load");
      } finally {
        if (active) setLoading(false);
      }
    })();
    return () => { active = false; };
  }, [itemId]);

  // ESC to close (when no inline edit is focused).
  useEffect(() => {
    if (!itemId) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        const target = e.target as HTMLElement | null;
        if (target?.tagName !== "INPUT" && target?.tagName !== "TEXTAREA") onClose();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [itemId, onClose]);

  const patch = useCallback(async (
    body: DetailPatch,
    optimistic?: Partial<BoardItemRow>,
  ) => {
    if (!item) return;
    // Optimistic
    setItem((prev) => (prev ? { ...prev, ...body, ...optimistic } : prev));
    try {
      const res = await fetch(`/api/items/${item.id}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(data?.error ?? "Failed to save");
        // Reload truth.
        const fresh = await fetch(`/api/items/${item.id}`).then((r) => r.json()).catch(() => null);
        if (fresh?.item) setItem(fresh.item);
        return;
      }
      setItem(data.item);
      onItemChanged?.(data.item);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to save");
    }
  }, [item, onItemChanged]);

  const archive = useCallback(async () => {
    if (!item) return;
    if (!(await confirm({ title: "Archive row", description: "Archive this row? You can restore from Trash.", destructive: true, confirmLabel: "Archive" }))) return;
    try {
      const res = await fetch(`/api/items/${item.id}`, { method: "DELETE" });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        setError(data?.error ?? "Failed to archive");
        return;
      }
      onItemArchived?.(item.id);
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to archive");
    }
  }, [item, onClose, onItemArchived, confirm]);

  const open = !!itemId;

  return (
    <>
      {/* Overlay — click to close */}
      {open ? (
        <div
          className="fixed inset-0 z-40 bg-black/30 backdrop-blur-[2px]"
          onClick={onClose}
          aria-hidden
        />
      ) : null}

      {/* Modal — big centered popup (ClickUp task view) */}
      {open ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-6" onClick={onClose}>
          <div
            className="relative w-[1000px] max-w-[95vw] h-[88vh] bg-white rounded-2xl border border-zinc-200 shadow-2xl flex flex-col overflow-hidden animate-in fade-in zoom-in-95 duration-150"
            onClick={(e) => e.stopPropagation()}
            role="dialog"
            aria-modal="true"
          >
            {/* Header */}
            <div className="px-5 py-3 border-b border-zinc-200 flex items-center gap-2">
              <button
                type="button"
                onClick={onClose}
                className="inline-flex items-center justify-center w-7 h-7 rounded text-zinc-500 hover:bg-zinc-50 hover:text-zinc-900"
                aria-label="Close"
              >
                <X className="w-4 h-4" />
              </button>
              <span className="text-xs text-zinc-500">Item</span>
              <div className="ml-auto flex items-center gap-1">
                {item ? (
                  <Link
                    href={`/item/${item.id}`}
                    className="inline-flex items-center gap-1.5 text-xs text-zinc-500 hover:text-zinc-900 px-2 py-1 rounded hover:bg-zinc-100"
                    title="Open full page"
                  >
                    <ExternalLink className="w-3.5 h-3.5" /> Full page
                  </Link>
                ) : null}
                {canEdit && item ? (
                  <button
                    type="button"
                    onClick={archive}
                    className="inline-flex items-center gap-1.5 text-xs text-zinc-500 hover:text-red-500 px-2 py-1 rounded hover:bg-red-500/10"
                  >
                    <Trash2 className="w-3.5 h-3.5" /> Archive
                  </button>
                ) : null}
              </div>
            </div>

            {error ? (
              <div className="px-5 py-2 text-xs text-red-500 bg-red-500/10 flex items-center justify-between">
                {error}
                <button onClick={() => setError(null)} className="text-zinc-500 hover:text-zinc-900">
                  <X className="w-3 h-3" />
                </button>
              </div>
            ) : null}

            {loading || !item ? (
              <div className="flex-1 px-5 py-6 text-sm text-zinc-500">Loading…</div>
            ) : (
              <div className="flex-1 overflow-y-auto px-8 py-6">
                <div className="max-w-[760px] mx-auto">
                  <BoardItemDetail
                    item={item}
                    canEdit={canEdit}
                    currentUserId={currentUserId}
                    customFields={customFields}
                    statusOptions={statusOptions}
                    onPatch={patch}
                    layout="drawer"
                    onOpenItem={onOpenItem}
                    moduleGating={moduleGating}
                  />
                </div>
              </div>
            )}
          </div>
        </div>
      ) : null}
    </>
  );
}
