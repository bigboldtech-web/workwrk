"use client";

// CanvasMoreTrigger: the "..." on a Canvas row in the sidebar Space tree.
// The menu body is the ONE CanvasRowMenu (src/components/canvas/
// canvas-row-menu.tsx, spec-docs-knowledge section 3), so a canvas has the
// same rows here, on /canvas and in its editor. This file keeps the trigger
// button, the right-click handle the tree row already wires, and the canvas's
// own Manage access dialog, which outlives the menu that opened it.
//
// THE ROLE comes down with the tree row (GET /api/spaces/[id]/children). A
// row from an older server carries none, and the menu keeps today's rows
// (edit and manage both on) while the server still refuses what it must.

import { forwardRef, useImperativeHandle, useRef, useState } from "react";
import { MoreHorizontal } from "lucide-react";
import { MorePortal, type ContextMenuHandle } from "./more-portal";
import { CanvasRowMenu, CanvasShareDialog } from "@/components/canvas/canvas-row-menu";
import type { ContainerRole } from "@/lib/work/container-menu";

interface CanvasRowLike {
  id: string;
  name: string;
  spaceId?: string | null;
  /** The canvas's Space slug, so the menu's Open rows build its Space-scoped Work address. */
  spaceSlug?: string | null;
}

interface Props {
  canvas: CanvasRowLike;
  /** The viewer's role on the canvas. Absent: Full access and Can edit are both assumed, as before. */
  role?: ContainerRole | null;
  onUpdated?: () => void;
}

export const CanvasMoreTrigger = forwardRef<ContextMenuHandle, Props>(function CanvasMoreTrigger(
  { canvas, role, onUpdated },
  ref,
) {
  const [open, setOpen] = useState(false);
  const [point, setPoint] = useState<{ x: number; y: number } | null>(null);
  const [share, setShare] = useState<{ readOnly: boolean } | null>(null);
  const [shareOpen, setShareOpen] = useState(false);
  const btnRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const canManage = role ? role === "full" : true;
  const canEdit = role ? role === "full" || role === "edit" : true;

  useImperativeHandle(ref, () => ({
    openAtPoint: (x, y) => { setPoint({ x, y }); setOpen(true); },
  }), []);

  return (
    <span className="relative inline-flex">
      <button
        ref={btnRef}
        type="button"
        onClick={(e) => { e.preventDefault(); e.stopPropagation(); setPoint(null); setOpen((v) => !v); }}
        className={`p-1 rounded transition-colors ${open ? "text-ink bg-active" : "text-ink-2 hover:bg-hover"}`}
        aria-label="Canvas actions"
        aria-haspopup="menu"
        aria-expanded={open}
        title="More"
      >
        <MoreHorizontal className="w-3.5 h-3.5" />
      </button>
      {open ? (
        <MorePortal anchorRef={btnRef} panelRef={panelRef} width={240} open={open} placement="below" point={point}>
          <CanvasRowMenu
            canvas={{ ...canvas, canManage, canEdit }}
            onClose={() => setOpen(false)}
            onChanged={() => onUpdated?.()}
            onShare={(readOnly) => { setShare({ readOnly }); setShareOpen(true); }}
          />
        </MorePortal>
      ) : null}
      {share ? (
        <CanvasShareDialog
          open={shareOpen}
          onOpenChange={setShareOpen}
          canvas={canvas}
          readOnly={share.readOnly}
          onChanged={() => onUpdated?.()}
        />
      ) : null}
    </span>
  );
});
