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
import { Trash2, X, ExternalLink, MessageSquare, Link2, ChevronsLeft, ChevronsRight } from "lucide-react";
import Link from "next/link";
import { DEFAULT_STATUS_OPTIONS, type BoardItemRow, type StatusOption } from "@/lib/board-items-shared";
import type { FieldDef } from "@/lib/field-catalog";
import { BoardItemDetail, type DetailPatch, type ItemModuleGating } from "./board-item-detail";
import { ItemThread } from "./item-thread";
import { LinkedAttachments } from "./linked-attachments";
import { useConfirm } from "@/components/ui/dialog-provider";
import { useOsShell } from "@/components/layout/os/shell-context";

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
  // The drawer always mounts inside the OS shell — safe to read the shell
  // context here. Wires the detail body's "Ask Brain" row to the sidekick.
  const { openSidekick } = useOsShell();
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
        // Reload truth — merged, so a leaner GET shape can't strip fields.
        const fresh = await fetch(`/api/items/${item.id}`).then((r) => r.json()).catch(() => null);
        if (fresh?.item) setItem((prev) => (prev ? { ...prev, ...fresh.item } : fresh.item));
        return;
      }
      // MERGE the response over the current item — never blind-replace. A
      // response missing enriched fields (subtaskCount, comment/link counts)
      // must not be able to strip them off the drawer's cached item again.
      setItem((prev) => (prev ? { ...prev, ...data.item } : data.item));
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
            {/* Header — airy toolbar: close + context left, actions right. */}
            <div className="h-12 shrink-0 px-4 border-b border-zinc-100 flex items-center gap-2.5">
              <button
                type="button"
                onClick={onClose}
                className="inline-flex items-center justify-center w-7 h-7 rounded-md text-zinc-400 transition-colors hover:bg-zinc-100 hover:text-zinc-700"
                aria-label="Close"
              >
                <X className="w-4 h-4" />
              </button>
              <div className="h-4 w-px bg-zinc-200" aria-hidden />
              <span className="text-[13px] font-medium text-zinc-400">Task</span>
              <div className="ml-auto flex items-center gap-1">
                {item ? (
                  <Link
                    href={`/item/${item.id}`}
                    className="inline-flex items-center gap-1.5 h-7 px-2.5 rounded-md text-[13px] font-medium text-zinc-500 transition-colors hover:bg-zinc-100 hover:text-zinc-800"
                    title="Open full page"
                  >
                    <ExternalLink className="w-3.5 h-3.5" /> Full page
                  </Link>
                ) : null}
                {canEdit && item ? (
                  <button
                    type="button"
                    onClick={archive}
                    className="inline-flex items-center gap-1.5 h-7 px-2.5 rounded-md text-[13px] font-medium text-zinc-500 transition-colors hover:bg-red-50 hover:text-red-600"
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
              <div className="flex-1 flex min-h-0">
                {/* Main column */}
                <div className="flex-1 overflow-y-auto px-9 pt-7 pb-10 min-w-0">
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
                      hideActivity
                      hideRelations
                      onAskAi={() => openSidekick(`Help me with the task: ${item.title}`)}
                    />
                  </div>
                </div>
                {/* Right rail (ClickUp) — Activity + Related tabs pinned right. */}
                <DetailRail item={item} canEdit={canEdit} currentUserId={currentUserId} statuses={statusOptions} />
              </div>
            )}
          </div>
        </div>
      ) : null}
    </>
  );
}

// Right rail — ClickUp-style: a slim vertical icon strip pinned to the
// rail's left edge (collapse chevron + one icon per panel, each with a
// hover tooltip) driving the panel to its right. Activity → ItemThread,
// Related → LinkedAttachments (relations, notes, whiteboards, files, SOPs
// — all add/link affordances live inside it). Collapsing hides the panel
// and leaves just the 48px strip; clicking any panel icon re-expands.

type RailPanel = "activity" | "related";

const RAIL_PANEL_TITLES: Record<RailPanel, string> = {
  activity: "Activity",
  related: "Related items",
};

function DetailRail({
  item, canEdit, currentUserId, statuses,
}: {
  item: BoardItemRow;
  canEdit: boolean;
  currentUserId: string | null;
  statuses: StatusOption[];
}) {
  const [panel, setPanel] = useState<RailPanel>("activity");
  const [collapsed, setCollapsed] = useState(false);

  const openPanel = (key: RailPanel) => {
    setPanel(key);
    setCollapsed(false);
  };

  return (
    <aside
      className={`flex shrink-0 border-l border-zinc-200 min-h-0 transition-[width] duration-150 ${
        collapsed ? "w-12" : "w-[400px]"
      }`}
    >
      {/* Icon strip */}
      <div
        className={`w-12 shrink-0 flex flex-col items-center gap-1 pt-2.5 ${
          collapsed ? "" : "border-r border-zinc-100"
        }`}
      >
        <RailIconButton
          Icon={collapsed ? ChevronsLeft : ChevronsRight}
          label={collapsed ? "Expand" : "Collapse"}
          active={false}
          onClick={() => setCollapsed((v) => !v)}
        />
        <div className="w-6 h-px bg-zinc-200 my-1" aria-hidden />
        <RailIconButton
          Icon={MessageSquare}
          label="Activity"
          active={!collapsed && panel === "activity"}
          onClick={() => openPanel("activity")}
        />
        <RailIconButton
          Icon={Link2}
          label="Related items"
          active={!collapsed && panel === "related"}
          onClick={() => openPanel("related")}
        />
      </div>

      {/* Panel */}
      {!collapsed ? (
        <div className="flex-1 flex flex-col min-w-0 min-h-0">
          <div className="h-11 shrink-0 px-4 flex items-center border-b border-zinc-100">
            <span className="text-[14px] font-semibold text-zinc-800">
              {RAIL_PANEL_TITLES[panel]}
            </span>
          </div>
          <div className="flex-1 overflow-y-auto px-4 py-3">
            {panel === "activity" ? (
              <ItemThread itemId={item.id} canEdit={canEdit} currentUserId={currentUserId} statuses={statuses} />
            ) : (
              <LinkedAttachments sourceType="BOARD_ITEM" sourceId={item.id} spaceId={item.spaceId ?? null} canEdit={canEdit} />
            )}
          </div>
        </div>
      ) : null}
    </aside>
  );
}

// One square icon in the rail strip — muted at rest, soft zinc highlight
// when its panel is active, small dark hover tooltip floating to the left.
function RailIconButton({
  Icon, label, active, onClick,
}: {
  Icon: typeof MessageSquare;
  label: string;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={label}
      className={`relative group w-8 h-8 shrink-0 inline-flex items-center justify-center rounded-md transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--os-brand)] ${
        active ? "bg-zinc-100 text-zinc-900" : "text-zinc-400 hover:bg-zinc-50 hover:text-zinc-700"
      }`}
    >
      <Icon className="w-4 h-4" />
      <span className="pointer-events-none absolute right-full top-1/2 -translate-y-1/2 mr-2 whitespace-nowrap rounded-md bg-zinc-900 px-2 py-1 text-[12px] font-medium text-white opacity-0 group-hover:opacity-100 transition-opacity duration-100 z-10">
        {label}
      </span>
    </button>
  );
}
