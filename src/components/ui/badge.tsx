import * as React from "react";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/lib/utils";

const badgeVariants = cva(
  "inline-flex items-center rounded-full border px-2.5 py-0.5 text-[10.5px] font-semibold transition-colors focus:outline-none tracking-[0.04em] leading-none",
  {
    variants: {
      variant: {
        default:
          "border-[rgba(212,255,46,0.3)] bg-[rgba(212,255,46,0.1)] text-[#d4ff2e]",
        secondary:
          "border-border bg-surface-2 text-muted",
        destructive:
          "border-[rgba(255,61,138,0.3)] bg-[rgba(255,61,138,0.1)] text-[#ff3d8a]",
        outline:
          "border-border bg-transparent text-muted",
        success:
          "border-[rgba(212,255,46,0.3)] bg-[rgba(212,255,46,0.1)] text-[#d4ff2e]",
        warning:
          "border-[rgba(255,153,51,0.3)] bg-[rgba(255,153,51,0.1)] text-[#ff9933]",
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
