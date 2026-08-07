"use client";

// MorePortal — small helper used by Space/Folder/Board/Table MoreTrigger
// components. Renders the popover panel via createPortal to document.body
// with `position: fixed` coordinates, so the panel escapes any ancestor
// with overflow-hidden (notably ClickSidebar's rounded-card clip).
//
// Without this, the popover renders inside the sidebar's clip box and
// gets sliced into a narrow icon column at the sidebar's right edge.
//
// Positioning rules:
//   - Default: panel left edge = anchor right edge + gap
//   - If panel would extend past viewport right, flip to anchor left side
//   - Vertical: align top with anchor top, push up if it would overflow

import { useEffect, useRef, useState, type ReactNode, type RefObject } from "react";
import { createPortal } from "react-dom";

/**
 * Imperative handle exposed by the "…" MoreTrigger components (Space / Folder /
 * Board / Table / item row). A tree row holds a ref to its trigger and calls
 * `openAtPoint` from its `onContextMenu` to open the same menu at the cursor.
 */
export type ContextMenuHandle = { openAtPoint: (x: number, y: number) => void };

interface Props {
  anchorRef: RefObject<HTMLElement | null>;
  width: number;
  open: boolean;
  panelRef?: RefObject<HTMLDivElement | null>;
  children: ReactNode;
  /** "right" puts the panel to the right of the anchor; "below" places it under. */
  placement?: "right" | "below";
  /**
   * When set, the panel is positioned at this viewport point (cursor) instead
   * of relative to the anchor — used for right-click context menus. Same flip/
   * clamp math keeps it on-screen. Null/omitted = anchor-relative (default).
   */
  point?: { x: number; y: number } | null;
}

export function MorePortal({
  anchorRef,
  width,
  open,
  panelRef,
  children,
  placement = "right",
  point = null,
}: Props) {
  const [coords, setCoords] = useState<{ left: number; top: number; maxHeight?: number } | null>(null);
  const localRef = useRef<HTMLDivElement>(null);
  const ref = panelRef ?? localRef;

  useEffect(() => {
    if (!open) return;
    const compute = () => {
      const gap = 6;
      const margin = 8; // viewport edge buffer
      // Cursor mode: treat the click point as a zero-size anchor, so the panel
      // drops just below-right of the pointer and flips near viewport edges.
      const rect = point
        ? ({ left: point.x, right: point.x, top: point.y, bottom: point.y } as DOMRect)
        : anchorRef.current?.getBoundingClientRect();
      if (!rect) return;
      let left = placement === "right" ? rect.right + gap : rect.left;
      let top = placement === "right" ? rect.top : rect.bottom + gap;

      // Flip horizontally if it would overflow the viewport.
      if (left + width + margin > window.innerWidth) {
        left = placement === "right"
          ? rect.left - width - gap
          : Math.max(margin, window.innerWidth - width - margin);
      }
      if (left < margin) left = margin;

      // Vertical fit — every action (Delete included) must stay on-screen.
      // First paint has no measurement yet, so assume a generous height;
      // the post-paint pass below re-runs with the panel's REAL height.
      const vh = window.innerHeight;
      const panelH = ref.current?.offsetHeight || 480;
      let maxHeight: number | undefined;
      if (top + panelH + margin > vh) {
        // Doesn't fit below/at the anchor — flip to open upward when the
        // panel fits above it (bottom-aligned for "right", above for "below").
        const flippedTop = placement === "below"
          ? rect.top - gap - panelH
          : rect.bottom - panelH;
        if (flippedTop >= margin) {
          top = flippedTop;
        } else {
          // Taller than either side allows: pin inside the viewport and let
          // the panel scroll internally so the last items stay reachable.
          top = Math.max(margin, vh - panelH - margin);
          if (panelH > vh - margin * 2) maxHeight = vh - margin * 2;
        }
      }

      setCoords({ left, top, maxHeight });
    };
    compute();
    // Re-run after paint with the real panel height, and again whenever the
    // panel's content grows (submenus, async rows).
    const raf = requestAnimationFrame(compute);
    let ro: ResizeObserver | null = null;
    const attach = requestAnimationFrame(() => {
      if (ref.current && typeof ResizeObserver !== "undefined") {
        ro = new ResizeObserver(() => compute());
        ro.observe(ref.current);
      }
    });
    window.addEventListener("resize", compute);
    window.addEventListener("scroll", compute, true);
    return () => {
      cancelAnimationFrame(raf);
      cancelAnimationFrame(attach);
      ro?.disconnect();
      window.removeEventListener("resize", compute);
      window.removeEventListener("scroll", compute, true);
    };
  }, [open, anchorRef, width, placement, point, ref]);

  if (!open || !coords || typeof document === "undefined") return null;

  return createPortal(
    <div
      ref={ref}
      style={{
        position: "fixed",
        left: coords.left,
        top: coords.top,
        width,
        ...(coords.maxHeight ? { maxHeight: coords.maxHeight, overflowY: "auto" as const } : {}),
      }}
      // workwrk-os: portals mount on document.body, OUTSIDE the app shell, so
      // without this class the os.css dark-mode utility repaints (scoped to
      // .workwrk-os) never reach portal panels — bg-white panels stay white
      // islands in dark mode (found on the doc Share modal).
      className="z-[80] os-portal-panel workwrk-os"
    >
      {children}
    </div>,
    document.body,
  );
}
