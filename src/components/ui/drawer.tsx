"use client";

// Drawer, the one detail container (design-system 4.5).
//
//   "Task, table row, person, from a list/board: drawer over the list, right,
//   full height under the top bar, --os-surface, 1px inline-start line +
//   shadow-modal, own 48px header, SAME URL as /item/[id]. The list underneath
//   dims to 92% opacity (no scrim) and stays scrollable. Expand animates the
//   drawer into the full page in place (240ms) so the user sees continuity.
//   520, resizable 480 to 720, remembered."
//
// Three things here are deliberate and easy to get wrong:
//
//   NO SCRIM. The list stays readable, scrollable and clickable: clicking
//   another row swaps the task. A scrim would make the drawer a modal wearing
//   a drawer's shape, which is what the 1000x88vh thing it replaces was.
//
//   THE DIM IS A DATA ATTRIBUTE ON THE ROOT, not a wrapper. The host page is
//   rendered by a different slot of the App Router, so this component cannot
//   put a class on it; it sets `data-os-drawer` and os.css dims <main>.
//
//   EXPAND DOES NOT NAVIGATE. The URL is already the task's, so Expand only
//   changes this container's geometry: it widens to fill the content area and
//   centres a 760 column. Back still returns to the list, because no history
//   entry was pushed.
//
// Under 1024px the drawer is a full-width sheet: no resize handle, no dim, no
// Expand (it is already full width).

import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { useLayer } from "@/components/layout/os/shell-context";

export const DRAWER_MIN_W = 480;
export const DRAWER_MAX_W = 720;
export const DRAWER_DEFAULT_W = 520;

export function clampDrawerWidth(px: number): number {
  if (!Number.isFinite(px)) return DRAWER_DEFAULT_W;
  return Math.min(DRAWER_MAX_W, Math.max(DRAWER_MIN_W, Math.round(px)));
}

export interface DrawerProps {
  open: boolean;
  onClose: () => void;
  /** The 48px header: crumb left, icon cluster right. */
  header: ReactNode;
  children: ReactNode;
  /** Sticks to the bottom edge of the drawer (the comment composer). */
  footer?: ReactNode;
  width?: number;
  /** Debounced by the caller; fired on pointer-up, not on every frame. */
  onWidthChange?: (px: number) => void;
  expanded?: boolean;
  /** A dirty inline editor refuses Esc; the caller decides. */
  canClose?: () => boolean;
  ariaLabel?: string;
  /** Stable id for the shell's LayerStack, so Esc order is deterministic. */
  layerId?: string;
}

export function Drawer({
  open,
  onClose,
  header,
  children,
  footer,
  width = DRAWER_DEFAULT_W,
  onWidthChange,
  expanded = false,
  canClose,
  ariaLabel = "Task",
  layerId = "task-drawer",
}: DrawerProps) {
  const [dragWidth, setDragWidth] = useState<number | null>(null);
  // `dragging` is state because the render reads it (the width transition is
  // switched off mid-drag); the start point is a ref because only the pointer
  // handlers read it.
  const [dragging, setDragging] = useState(false);
  const dragRef = useRef<{ startX: number; startW: number } | null>(null);
  const panelRef = useRef<HTMLDivElement>(null);

  // Esc goes through the shell's LayerStack, so an open Picker closes first
  // and the drawer only closes when it is the top layer.
  useLayer(open, { id: layerId, kind: "drawer", close: onClose, canClose });

  // The dim on the host, and the flag os.css keys off.
  useEffect(() => {
    if (!open) return;
    const root = document.documentElement;
    root.dataset.osDrawer = expanded ? "expanded" : "open";
    return () => {
      delete root.dataset.osDrawer;
    };
  }, [open, expanded]);

  const stopDrag = useCallback(() => {
    const next = dragWidth;
    dragRef.current = null;
    setDragging(false);
    setDragWidth(null);
    if (next != null) onWidthChange?.(clampDrawerWidth(next));
  }, [dragWidth, onWidthChange]);

  useEffect(() => {
    if (!dragging) return;
    const onMove = (e: PointerEvent) => {
      const d = dragRef.current;
      if (!d) return;
      // The handle is on the drawer's inline-start edge, so dragging LEFT
      // makes it wider. Reversed under an RTL document, where "start" is the
      // right-hand edge.
      const rtl = document.documentElement.dir === "rtl";
      const delta = rtl ? e.clientX - d.startX : d.startX - e.clientX;
      setDragWidth(clampDrawerWidth(d.startW + delta));
    };
    const onUp = () => stopDrag();
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
    window.addEventListener("pointercancel", onUp);
    return () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      window.removeEventListener("pointercancel", onUp);
    };
  }, [stopDrag, dragging]);

  const startDrag = (e: React.PointerEvent) => {
    e.preventDefault();
    dragRef.current = { startX: e.clientX, startW: dragWidth ?? width };
    setDragging(true);
    setDragWidth(dragWidth ?? width);
  };

  // A keyboard alternative to the drag, so width is not a pointer-only setting.
  const nudge = (e: React.KeyboardEvent) => {
    const step = e.shiftKey ? 40 : 16;
    if (e.key !== "ArrowLeft" && e.key !== "ArrowRight") return;
    e.preventDefault();
    const rtl = document.documentElement.dir === "rtl";
    const grow = rtl ? e.key === "ArrowRight" : e.key === "ArrowLeft";
    const next = clampDrawerWidth((dragWidth ?? width) + (grow ? step : -step));
    setDragWidth(next);
    onWidthChange?.(next);
  };

  if (!open) return null;
  const live = clampDrawerWidth(dragWidth ?? width);

  return (
    <aside
      ref={panelRef}
      role="dialog"
      aria-label={ariaLabel}
      aria-modal="false"
      data-expanded={expanded ? "true" : undefined}
      className={[
        // `.os-chrome` rebinds the spacing and radius variables the Tailwind
        // utilities read, so under the product's 14px root the header's h-12
        // is 48px and the body's 36px rows are 36px, not 87.5% of each
        // (tokens.css, and the same reason OsPageHeader carries it).
        "os-chrome",
        "fixed bottom-0 end-0 top-[var(--os-top-h)] z-40 flex flex-col bg-raised",
        "border-s border-line shadow-[var(--os-shadow-modal)]",
        "max-lg:start-0 max-lg:border-s-0",
        expanded ? "start-[calc(var(--os-rail-w)+var(--os-side-w))] max-lg:start-0" : "",
        // The width travels as a custom property rather than an inline `width`
        // so the narrow sheet can actually be full width: an inline style beats
        // every class, and with `start-0 end-0` plus an inline 520 the "sheet"
        // was a 520 panel pinned to the left with the list showing beside it.
        expanded ? "" : "w-[var(--os-drawer-w)] max-lg:w-auto",
      ].join(" ")}
      style={{
        // Expanded fills the content area; the body centres its own 760 column.
        ["--os-drawer-w" as string]: `${live}px`,
        transitionProperty: dragging ? "none" : "width, inset-inline-start",
        transitionDuration: expanded ? "var(--os-dur-expand)" : "var(--os-dur-slow)",
        transitionTimingFunction: "var(--os-ease-out)",
      }}
    >
      {!expanded ? (
        <div
          role="separator"
          aria-orientation="vertical"
          aria-label="Resize drawer"
          aria-valuenow={live}
          aria-valuemin={DRAWER_MIN_W}
          aria-valuemax={DRAWER_MAX_W}
          tabIndex={0}
          onPointerDown={startDrag}
          onKeyDown={nudge}
          className="absolute bottom-0 start-0 top-0 z-10 w-1 cursor-col-resize bg-transparent outline-none transition-colors hover:bg-brand focus-visible:bg-brand max-lg:hidden"
        />
      ) : null}

      <div className="flex h-12 shrink-0 items-center gap-2 border-b border-line px-4">{header}</div>

      <div className="min-h-0 flex-1 overflow-y-auto">{children}</div>

      {footer ? <div className="shrink-0 border-t border-line bg-raised">{footer}</div> : null}
    </aside>
  );
}
