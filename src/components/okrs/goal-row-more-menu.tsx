"use client";

// GoalRowMoreMenu — the "…" overflow + right-click menu for a goal, on the
// OKRs list card and the goal detail header. Same primitives as the board's
// ItemRowMoreMenu (MenuList / MenuItem via a MorePortal, ContextMenuHandle for
// right-click, useConfirm for the destructive step), so it never invents a new
// menu surface. Delete is the only action here — the fuller goal right-click
// rollout is a separate planned effort — and it only renders for viewers the
// API will let delete (canDelete, mirroring DELETE /api/okrs/[id]).

import { forwardRef, useEffect, useImperativeHandle, useRef, useState } from "react";
import { MoreHorizontal, Trash2 } from "lucide-react";
import { MenuList, MenuItem } from "@/components/ui/menu";
import { MorePortal, type ContextMenuHandle } from "@/components/layout/os/more-portal";
import { useOsToast } from "@/components/layout/os/toast";
import { useConfirm } from "@/components/ui/dialog-provider";
import { cn } from "@/lib/utils";

export const GoalRowMoreMenu = forwardRef<ContextMenuHandle, {
  goal: { id: string; title: string };
  /** Owner / tree-manager / org admin — else the trigger renders nothing. */
  canDelete: boolean;
  /** Local removal after the delete succeeds (list: drop the row; detail: route away). */
  onDeleted?: () => void;
  /** Class for the outer <span> wrapper (positioning). */
  wrapperClassName?: string;
  /** Class for the trigger <button>. */
  triggerClassName?: string;
}>(function GoalRowMoreMenu({ goal, canDelete, onDeleted, wrapperClassName, triggerClassName }, ref) {
  const [open, setOpen] = useState(false);
  // Cursor coords when opened via right-click; null = anchored to the "…" button.
  const [point, setPoint] = useState<{ x: number; y: number } | null>(null);
  const [busy, setBusy] = useState(false);
  const btnRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const { toast } = useOsToast();
  const confirm = useConfirm();

  useImperativeHandle(ref, () => ({
    openAtPoint: (x, y) => { if (canDelete) { setPoint({ x, y }); setOpen(true); } },
  }), [canDelete]);

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

  if (!canDelete) return null;

  const close = () => setOpen(false);

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
          <MenuItem icon={Trash2} label="Delete goal" destructive onClick={del} busy={busy} />
        </MenuList>
      </MorePortal>
    </span>
  );
});
