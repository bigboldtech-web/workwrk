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

import { useLayoutEffect, useRef, type ReactNode, type RefObject } from "react";
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
  const localRef = useRef<HTMLDivElement>(null);
  const ref = panelRef ?? localRef;

  // Positioning is DOM-measurement-driven, so it bypasses React state and
  // writes the panel node's style directly. The old version seeded coords
  // from a pre-mount pass that had to GUESS the panel height (480px): for
  // an anchor low on the screen the guess "didn't fit below" and flipped
  // the menu to the top of the viewport, and its rAF-scheduled correction
  // could fire before the panel mounted — never correcting. Users saw KRA
  // "…" menus open at the top of the page. Here the node always exists
  // when compute runs (layout effect, pre-paint), so the flip decision
  // always uses the real height.
  // Layout effect: the panel is in the DOM this commit and this runs BEFORE
  // the browser paints it, so it appears in its final position — the
  // render-time visibility:hidden below is never seen. ResizeObserver keeps
  // the position right as content grows (submenus, async rows). compute is
  // scoped inside the effect: it is only ever called from here (listeners,
  // RO), so it needs no memoization.
  useLayoutEffect(() => {
    if (!open) return;
    const compute = () => {
    const node = ref.current;
    if (!node) return;
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
    const vh = window.innerHeight;
    const panelH = node.offsetHeight;
    let maxHeight: number | null = null;
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

    node.style.left = `${left}px`;
    node.style.top = `${top}px`;
    if (maxHeight != null) {
      node.style.maxHeight = `${maxHeight}px`;
      node.style.overflowY = "auto";
    } else {
      node.style.maxHeight = "";
      node.style.overflowY = "";
    }
    node.style.visibility = "visible";
    };

    compute();
    const ro = typeof ResizeObserver !== "undefined" ? new ResizeObserver(() => compute()) : null;
    if (ro && ref.current) ro.observe(ref.current);
    window.addEventListener("resize", compute);
    window.addEventListener("scroll", compute, true);
    return () => {
      ro?.disconnect();
      window.removeEventListener("resize", compute);
      window.removeEventListener("scroll", compute, true);
    };
  }, [open, anchorRef, width, placement, point, ref]);

  if (!open || typeof document === "undefined") return null;

  return createPortal(
    <div
      ref={ref}
      style={{
        position: "fixed",
        left: 0,
        top: 0,
        width,
        // Hidden at mount; the pre-paint layout pass positions the node and
        // flips this to visible, so the user only ever sees the final spot.
        visibility: "hidden",
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
