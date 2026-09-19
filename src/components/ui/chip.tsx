import * as React from "react";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/lib/utils";

/**
 * Chip — the toolbar-pill primitive.
 *
 * A Chip is a compact, fixed-height bordered control used in dense
 * toolbars (task creation, board filters, drawer metadata rows). Every
 * Chip shares one height, radius, and hover treatment so a row of them
 * reads as an aligned button cluster — the ClickUp look — instead of
 * loose floating text.
 *
 * - `idle`   — neutral bordered pill (an unset / optional field)
 * - `active` — same shape, darker text + border once a value is set
 *
 * For status badges that carry their own semantic color, use
 * `<StatusChip color="#…">` which keeps the identical silhouette but
 * tints fill/border/text from a single color.
 */
const chipVariants = cva(
  "inline-flex items-center gap-1.5 rounded-lg border font-medium transition-colors select-none outline-none focus-visible:ring-2 focus-visible:ring-zinc-300/70 focus-visible:border-zinc-300 disabled:opacity-50 disabled:pointer-events-none",
  {
    variants: {
      state: {
        idle: "border-zinc-200 bg-white text-zinc-600 hover:bg-zinc-50 hover:border-zinc-300 hover:text-zinc-800",
        active: "border-zinc-300 bg-white text-zinc-900 hover:bg-zinc-50",
        danger: "border-red-300 bg-white text-red-500 hover:bg-red-50",
      },
      size: {
        default: "h-[30px] px-2.5 text-base",
        icon: "h-[30px] w-[30px] justify-center px-0 text-base",
      },
    },
    defaultVariants: { state: "idle", size: "default" },
  },
);

export interface ChipProps
  extends Omit<React.ButtonHTMLAttributes<HTMLButtonElement>, "type">,
    VariantProps<typeof chipVariants> {
  /** Ergonomic shortcut: `active` resolves to the active state unless
   *  an explicit `state` is passed (e.g. `danger`). */
  active?: boolean;
}

const Chip = React.forwardRef<HTMLButtonElement, ChipProps>(
  ({ className, state, size, active, ...props }, ref) => {
    const resolved = state ?? (active ? "active" : "idle");
    return (
      <button
        ref={ref}
        type="button"
        className={cn(chipVariants({ state: resolved, size }), className)}
        {...props}
      />
    );
  },
);
Chip.displayName = "Chip";

export interface StatusChipProps
  extends Omit<React.ButtonHTMLAttributes<HTMLButtonElement>, "type"> {
  /** Hex color driving fill (8%), border (20%) and text + dot (100%). */
  color: string;
  label: string;
}

/**
 * A Chip-shaped status badge: a 6px dot and the status word, tinted from one
 * colour.
 *
 * design-system 5.9: the pale fill is the DEFAULT and "the uppercase 13px
 * label is dropped", a status is a word somebody chose, and shouting it is
 * both harder to read and a lie about how important it is. The solid fill
 * survives only as the opt-in status column of a table, which is not this
 * component.
 */
const StatusChip = React.forwardRef<HTMLButtonElement, StatusChipProps>(
  ({ className, color, label, ...props }, ref) => (
    <button
      ref={ref}
      type="button"
      className={cn(
        "inline-flex items-center gap-1.5 h-[26px] px-2 rounded-md text-xs font-medium transition-colors hover:brightness-95 outline-none focus-visible:ring-2 focus-visible:ring-[var(--os-focus)]/60 disabled:opacity-50",
        className,
      )}
      style={{ backgroundColor: `${color}1F`, color, border: `1px solid ${color}33` }}
      {...props}
    >
      <span className="w-1.5 h-1.5 rounded-full shrink-0" style={{ backgroundColor: color }} />
      {label}
    </button>
  ),
);
StatusChip.displayName = "StatusChip";

export { Chip, StatusChip, chipVariants };
