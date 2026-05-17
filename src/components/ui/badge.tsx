import * as React from "react";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/lib/utils";

/**
 * Badge primitive — Phase G refresh.
 *
 * The state variants (success / warning / danger / info) now resolve
 * via the locked signal tokens introduced in Phase B (--signal-*-fg /
 * -bg / -border). Light + dark themes both inherit the correct tones
 * without per-variant overrides.
 *
 * The non-state variants (default / secondary / outline) keep their
 * existing treatments so the ~150 components passing variant="default"
 * don't shift color overnight.
 */
const badgeVariants = cva(
  "inline-flex items-center rounded-full border px-2.5 py-0.5 text-[10.5px] font-semibold transition-fast focus:outline-none tracking-[0.04em] leading-none",
  {
    variants: {
      variant: {
        // Default = primary accent (violet). Used for "active",
        // "selected", "in-progress" semantics.
        default:
          "border-violet-200 bg-violet-50 text-violet-700 dark:border-violet-500/30 dark:bg-violet-500/10 dark:text-violet-300",
        secondary:
          "border-slate-200 bg-slate-50 text-slate-600 dark:border-border dark:bg-surface-2 dark:text-muted",
        outline:
          "border-slate-200 bg-transparent text-slate-600 dark:border-border dark:text-muted",
        // Signal variants — pinned to the locked palette.
        success:
          "border-[color:var(--signal-success-border)] bg-[color:var(--signal-success-bg)] text-[color:var(--signal-success-fg)]",
        warning:
          "border-[color:var(--signal-warning-border)] bg-[color:var(--signal-warning-bg)] text-[color:var(--signal-warning-fg)]",
        destructive:
          "border-[color:var(--signal-danger-border)] bg-[color:var(--signal-danger-bg)] text-[color:var(--signal-danger-fg)]",
        info:
          "border-[color:var(--signal-info-border)] bg-[color:var(--signal-info-bg)] text-[color:var(--signal-info-fg)]",
      },
    },
    defaultVariants: {
      variant: "default",
    },
  },
);

export type BadgeProps = React.HTMLAttributes<HTMLDivElement> &
  VariantProps<typeof badgeVariants>;

function Badge({ className, variant, ...props }: BadgeProps) {
  return <div className={cn(badgeVariants({ variant }), className)} {...props} />;
}

export { Badge, badgeVariants };
