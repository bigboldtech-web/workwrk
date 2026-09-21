"use client";

// InfoPanel (design-system 4.5 "Person / channel / Space info: right panel,
// never modal", 360): the one right-hand info panel. The policy page's
// Audience panel and the acknowledgement ledger's Evidence panel mount it
// (spec-process section 1 "Back / close": the ✕ and Esc close it and focus
// returns to the button that opened it; opening another row's contents
// swaps them in place without closing).
//
//   fixed under the top bar at the inline-end edge, 360 wide, --os-surface,
//   border-inline-start 1px --os-line, its own 48px header (title 15/500,
//   ✕ 32px ghost), scrolling body. Esc goes through the shell's LayerStack
//   so a Picker or dialog above it closes first.

import { useEffect, useRef, type ReactNode } from "react";
import { X } from "lucide-react";
import { useLayer } from "@/components/layout/os/shell-context";
import { cn } from "@/lib/utils";

export function InfoPanel({ open, onClose, title, children, footer, ariaLabel, className, returnFocusTo }: {
  open: boolean;
  onClose: () => void;
  title: ReactNode;
  children: ReactNode;
  footer?: ReactNode;
  ariaLabel?: string;
  className?: string;
  /** The button that opened the panel, so closing returns focus to it. */
  returnFocusTo?: React.RefObject<HTMLElement | null>;
}) {
  useLayer(open, { kind: "panel", close: onClose });
  const wasOpen = useRef(open);
  useEffect(() => {
    if (wasOpen.current && !open) returnFocusTo?.current?.focus();
    wasOpen.current = open;
  }, [open, returnFocusTo]);
  if (!open) return null;
  return (
    <aside
      role="complementary"
      aria-label={ariaLabel ?? (typeof title === "string" ? title : undefined)}
      className={cn(
        "os-chrome fixed bottom-0 end-0 top-[var(--os-top-h)] z-40 flex w-[360px] flex-col border-s border-line bg-raised text-ink shadow-[var(--os-shadow-modal)]",
        "max-sm:w-full max-sm:border-s-0",
        className,
      )}
    >
      <header className="flex h-12 shrink-0 items-center gap-2 border-b border-line px-4">
        <h2 className="min-w-0 flex-1 truncate text-row font-medium text-ink">{title}</h2>
        <button type="button" onClick={onClose} aria-label="Close" className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-md text-ink-2 hover:bg-hover hover:text-ink">
          <X className="h-4 w-4" strokeWidth={1.5} aria-hidden />
        </button>
      </header>
      <div className="min-h-0 flex-1 overflow-y-auto">{children}</div>
      {footer ? <footer className="shrink-0 border-t border-line px-4 py-3">{footer}</footer> : null}
    </aside>
  );
}

/** A 36px label / value row inside the panel body. */
export function InfoRow({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex min-h-9 items-start gap-3 border-b border-line-soft px-4 py-2 last:border-b-0">
      <span className="w-[120px] shrink-0 pt-0.5 text-sm font-medium text-ink-2">{label}</span>
      <span className="min-w-0 flex-1 break-words text-base text-ink">{children}</span>
    </div>
  );
}
