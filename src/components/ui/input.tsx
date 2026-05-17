import * as React from "react";
import { cn } from "@/lib/utils";

/**
 * Input primitive — Phase G15 refresh.
 *
 * - Height bumped h-9 → h-10 default so the touch target meets the
 *   AA hit-area recommendation (40×40) on touch devices without
 *   making the form feel chunky.
 * - Focus ring uses the Phase B accent token (not raw violet-500),
 *   so theme tweaks propagate.
 * - Transition: explicit transition-fast (150ms) for predictable
 *   feedback latency.
 * - Hover border lift on enabled inputs gives the field a small
 *   "you can type here" affordance.
 *
 * Backwards-compatible: callers passing className overrides keep
 * working since cn() merges later classes wins.
 */
export type InputProps = React.InputHTMLAttributes<HTMLInputElement>;

const Input = React.forwardRef<HTMLInputElement, InputProps>(
  ({ className, type, ...props }, ref) => {
    return (
      <input
        type={type}
        className={cn(
          "flex h-10 w-full rounded-lg border border-border bg-white px-3 py-2 text-[13.5px] text-foreground placeholder:text-muted-2",
          "transition-fast hover:border-muted-2/60",
          "focus-visible:outline-none focus-visible:border-[color:var(--accent)] focus-visible:ring-[3px] focus-visible:ring-[color:var(--accent)]/15",
          "disabled:cursor-not-allowed disabled:opacity-50 disabled:hover:border-border",
          "dark:bg-surface-2",
          className,
        )}
        ref={ref}
        {...props}
      />
    );
  },
);
Input.displayName = "Input";

export { Input };
