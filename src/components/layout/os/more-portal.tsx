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

interface Props {
  anchorRef: RefObject<HTMLElement | null>;
  width: number;
  open: boolean;
  panelRef?: RefObject<HTMLDivElement | null>;
  children: ReactNode;
  /** "right" puts the panel to the right of the anchor; "below" places it under. */
  placement?: "right" | "below";
}

export function MorePortal({
  anchorRef,
  width,
  open,
  panelRef,
  children,
  placement = "right",
}: Props) {
  const [coords, setCoords] = useState<{ left: number; top: number } | null>(null);
  const localRef = useRef<HTMLDivElement>(null);
  const ref = panelRef ?? localRef;

  useEffect(() => {
    if (!open) return;
    const compute = () => {
      const anchor = anchorRef.current;
      if (!anchor) return;
      const rect = anchor.getBoundingClientRect();
      const gap = 6;
      const margin = 8; // viewport edge buffer
      let left = placement === "right" ? rect.right + gap : rect.left;
      let top = placement === "right" ? rect.top : rect.bottom + gap;

      // Flip horizontally if it would overflow the viewport.
      if (left + width + margin > window.innerWidth) {
        left = placement === "right"
          ? rect.left - width - gap
          : Math.max(margin, window.innerWidth - width - margin);
      }
      if (left < margin) left = margin;

      // Push up if it would overflow the bottom. Assume max 480px panel
      // height — generous; most More menus are well under this.
      const PANEL_MAX_H = 480;
      if (top + PANEL_MAX_H + margin > window.innerHeight) {
        top = Math.max(margin, window.innerHeight - PANEL_MAX_H - margin);
      }

      setCoords({ left, top });
    };
    compute();
    window.addEventListener("resize", compute);
    window.addEventListener("scroll", compute, true);
    return () => {
      window.removeEventListener("resize", compute);
      window.removeEventListener("scroll", compute, true);
    };
  }, [open, anchorRef, width, placement]);

  if (!open || !coords || typeof document === "undefined") return null;

  return createPortal(
    <div
      ref={ref}
      style={{ position: "fixed", left: coords.left, top: coords.top, width }}
      className="z-[80] os-portal-panel"
    >
      {children}
    </div>,
    document.body,
  );
}
