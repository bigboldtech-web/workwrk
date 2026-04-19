import * as React from "react";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/lib/utils";

const badgeVariants = cva(
  "inline-flex items-center rounded-full border px-2.5 py-0.5 text-[10.5px] font-semibold transition-colors focus:outline-none tracking-[0.04em]",
  {
    variants: {
      variant: {
        default:
          "border-[rgba(212,255,46,0.3)] bg-[rgba(212,255,46,0.1)] text-[#d4ff2e]",
        secondary:
          "border-[rgba(255,255,255,0.08)] bg-[#1a1a1a] text-[#a0a0a0]",
        destructive:
          "border-[rgba(255,61,138,0.3)] bg-[rgba(255,61,138,0.1)] text-[#ff3d8a]",
        outline:
          "border-[rgba(255,255,255,0.12)] bg-transparent text-[#a0a0a0]",
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
