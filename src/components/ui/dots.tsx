// Dots (design-system 5.16): one home for every non-brand dot. The brand's
// YBRG dots live in src/components/brand only; everything here is a
// semantic or motion dot in a token colour.
//
//   pending   4 dots 3px in currentColor, bouncing: a button in flight. The
//             label stays, the icon is replaced, the width is preserved.
//   unread    6px --os-attention (--os-chrome-attention on the chrome).
//   presence  8px --os-presence with a 2px ring in the parent surface.
//   live      6px --os-brand, 1.6s opacity pulse (co-presence, recording).
//   status    6px in a *.solid colour, inside a pale chip beside a word.
//
// Server-safe: no hooks. The pending animation is `.os-pending` in os.css.

import { cn } from "@/lib/utils";

type Variant = "pending" | "unread" | "presence" | "live" | "status";

export function Dots({
  variant = "pending",
  chrome = false,
  color,
  away,
  offline,
  className,
  label,
}: {
  variant?: Variant;
  /** Read the chrome tokens (the navy rail and bar) instead of the canvas ones. */
  chrome?: boolean;
  /** `status` only: the *.solid token or a user hue. */
  color?: string;
  /** `presence` only. */
  away?: boolean;
  offline?: boolean;
  className?: string;
  /** Accessible name for the pending loader. */
  label?: string;
}) {
  if (variant === "pending") {
    return (
      <span className={cn("os-pending", className)} role="status" aria-label={label ?? "Working"}>
        <i /><i /><i /><i />
      </span>
    );
  }
  if (variant === "unread") {
    return (
      <span
        aria-hidden
        className={cn("inline-block h-1.5 w-1.5 shrink-0 rounded-full", className)}
        style={{ background: chrome ? "var(--os-chrome-attention)" : "var(--os-attention)" }}
      />
    );
  }
  if (variant === "presence") {
    const bg = offline ? "var(--os-line-strong)" : away ? "var(--os-warning-solid)" : chrome ? "var(--os-chrome-presence)" : "var(--os-presence)";
    return (
      <span
        aria-hidden
        className={cn("inline-block h-2 w-2 shrink-0 rounded-full", className)}
        style={{ background: bg, boxShadow: `0 0 0 2px ${chrome ? "var(--os-chrome-bg)" : "var(--os-surface)"}` }}
      />
    );
  }
  if (variant === "live") {
    return (
      <span
        aria-hidden
        className={cn("os-live-dot inline-block h-1.5 w-1.5 shrink-0 rounded-full", className)}
        style={{ background: "var(--os-brand)" }}
      />
    );
  }
  return (
    <span
      aria-hidden
      className={cn("inline-block h-1.5 w-1.5 shrink-0 rounded-full", className)}
      style={{ background: color ?? "var(--os-ink-3)" }}
    />
  );
}
