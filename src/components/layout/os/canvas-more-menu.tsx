"use client";

// CanvasMoreTrigger: the "..." on a Canvas row in the sidebar Space tree.
// The menu body is the ONE CanvasRowMenu (src/components/canvas/
// canvas-row-menu.tsx, spec-docs-knowledge section 3), so a canvas has the
// same rows here, on /canvas and in its editor. This file keeps only the
// trigger button and the right-click handle the tree row already wires.

import { forwardRef, useImperativeHandle, useRef, useState } from "react";
import { MoreHorizontal } from "lucide-react";
import { MorePortal, type ContextMenuHandle } from "./more-portal";
import { CanvasRowMenu } from "@/components/canvas/canvas-row-menu";

interface CanvasRowLike {
  id: string;
  name: string;
  spaceId?: string | null;
}

interface Props {
  canvas: CanvasRowLike;
  onUpdated?: () => void;
}

export const CanvasMoreTrigger = forwardRef<ContextMenuHandle, Props>(function CanvasMoreTrigger(
  { canvas, onUpdated },
  ref,
) {
  const [open, setOpen] = useState(false);
  const [point, setPoint] = useState<{ x: number; y: number } | null>(null);
  const btnRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);

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
          <CanvasRowMenu canvas={canvas} onClose={() => setOpen(false)} onChanged={() => onUpdated?.()} />
        </MorePortal>
      ) : null}
    </span>
  );
});
