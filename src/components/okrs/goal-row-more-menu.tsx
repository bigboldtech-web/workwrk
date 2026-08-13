"use client";

// GoalRowMoreMenu — the "…" overflow + right-click menu for a goal, on the
// OKRs list card and the goal detail header. Same primitives as the board's
// ItemRowMoreMenu (MenuList / MenuItem via a MorePortal, ContextMenuHandle for
// right-click, useConfirm for the destructive step), so it never invents a new
// menu surface.
//
//   Open          → /okrs/[id] (hidden on the detail page via showOpen)
//   Edit goal     → the shared create/edit modal, pre-filled   (canEdit)
//   Assign owner  → same modal, landed in the Owner picker     (canEdit)
//   Copy link     → the goal's URL onto the clipboard
//   Delete goal   → destructive, last                          (canDelete)
//
// canEdit mirrors PATCH /api/okrs (owner / tree-manager / org-wide levels);
// canDelete mirrors DELETE /api/okrs/[id] (canDeleteGoal) — an action only
// renders when the API will honor it. Open and Copy link need no gate: the
// viewer can already see the goal.

import { forwardRef, useEffect, useImperativeHandle, useRef, useState } from "react";
import { ExternalLink, Link2, MoreHorizontal, Pencil, Trash2, UserRound } from "lucide-react";
import { MenuList, MenuItem, MenuSeparator } from "@/components/ui/menu";
import { MorePortal, type ContextMenuHandle } from "@/components/layout/os/more-portal";
import { useOsToast } from "@/components/layout/os/toast";
import { useConfirm } from "@/components/ui/dialog-provider";
import { cn } from "@/lib/utils";

export const GoalRowMoreMenu = forwardRef<ContextMenuHandle, {
  goal: { id: string; title: string };
  /** Owner / tree-manager / org admin — else Delete doesn't render. */
  canDelete: boolean;
  /** PATCH gate (owner / tree-manager / org-wide) — else Edit + Assign owner don't render. */
  canEdit?: boolean;
  /** Open the shared goal modal in edit mode; `focusOwner` lands in the Owner picker. */
  onEdit?: (opts?: { focusOwner?: boolean }) => void;
  /** "Open" row — pass false on the detail page (you're already there). */
  showOpen?: boolean;
  /** Local removal after the delete succeeds (list: drop the row; detail: route away). */
  onDeleted?: () => void;
  /** Class for the outer <span> wrapper (positioning). */
  wrapperClassName?: string;
  /** Class for the trigger <button>. */
  triggerClassName?: string;
}>(function GoalRowMoreMenu(
  { goal, canDelete, canEdit = false, onEdit, showOpen = true, onDeleted, wrapperClassName, triggerClassName },
  ref,
) {
  const [open, setOpen] = useState(false);
  // Cursor coords when opened via right-click; null = anchored to the "…" button.
  const [point, setPoint] = useState<{ x: number; y: number } | null>(null);
  const [busy, setBusy] = useState(false);
  const btnRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const { toast } = useOsToast();
  const confirm = useConfirm();

  useImperativeHandle(ref, () => ({
    openAtPoint: (x, y) => { setPoint({ x, y }); setOpen(true); },
  }), []);

  useEffect(() => {
    if (!open) return;
    const onClick = (e: MouseEvent) => {
      const t = e.target as Node;
      if (panelRef.current?.contains(t) || btnRef.current?.contains(t)) return;
      setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") setOpen(false); };
    window.addEventListener("mousedown", onClick);
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("mousedown", onClick);
      window.removeEventListener("keydown", onKey);
    };
  }, [open]);

  const close = () => setOpen(false);

  const copyLink = async () => {
    close();
    try {
      await navigator.clipboard.writeText(`${window.location.origin}/okrs/${goal.id}`);
      toast("Link copied");
    } catch {
      toast("Couldn't copy link");
    }
  };

  const del = async () => {
    close();
    const ok = await confirm({
      title: "Delete goal",
      description: `Delete "${goal.title}"? Its key results and check-ins are removed, and any sub-goals move up to the top level. This can't be undone.`,
      destructive: true,
      confirmLabel: "Delete",
    });
    if (!ok) return;
    setBusy(true);
    try {
      const res = await fetch(`/api/okrs/${goal.id}`, { method: "DELETE" });
      if (res.ok) {
        toast("Goal deleted");
        onDeleted?.();
      } else {
        const d = await res.json().catch(() => ({}));
        toast(d?.error ?? "Couldn't delete goal");
      }
    } catch {
      toast("Couldn't delete goal");
    } finally {
      setBusy(false);
    }
  };

  const showEdit = canEdit && Boolean(onEdit);

  return (
    <span className={cn("relative inline-flex", wrapperClassName)} data-open={open ? "true" : "false"}>
      <button
        ref={btnRef}
        type="button"
        onClick={(e) => { e.preventDefault(); e.stopPropagation(); setPoint(null); setOpen((v) => !v); }}
        className={triggerClassName ?? "inline-flex items-center justify-center w-7 h-7 rounded-md text-zinc-500 hover:text-zinc-900 hover:bg-zinc-100 transition-colors"}
        title="More actions"
        aria-label="More actions"
        aria-haspopup="menu"
        aria-expanded={open}
      >
        <MoreHorizontal className="w-4 h-4" />
      </button>
      <MorePortal anchorRef={btnRef} panelRef={panelRef} width={200} open={open} placement="below" point={point}>
        <MenuList className="min-w-[200px]" onClick={(e) => e.stopPropagation()}>
          {showOpen && (
            <MenuItem icon={ExternalLink} label="Open" href={`/okrs/${goal.id}`} onClick={close} />
          )}
          {showEdit && (
            <MenuItem icon={Pencil} label="Edit goal" onClick={() => { close(); onEdit?.(); }} />
          )}
          {showEdit && (
            <MenuItem icon={UserRound} label="Assign owner" onClick={() => { close(); onEdit?.({ focusOwner: true }); }} />
          )}
          <MenuItem icon={Link2} label="Copy link" onClick={() => void copyLink()} />
          {canDelete && (
            <>
              <MenuSeparator />
              <MenuItem icon={Trash2} label="Delete goal" destructive onClick={del} busy={busy} />
            </>
          )}
        </MenuList>
      </MorePortal>
    </span>
  );
});
