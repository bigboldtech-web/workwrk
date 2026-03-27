import * as React from "react";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/lib/utils";

const badgeVariants = cva(
  "inline-flex items-center rounded-md border px-2.5 py-0.5 text-xs font-semibold transition-colors focus:outline-none",
  {
    variants: {
      variant: {
        default: "border-transparent bg-purple-600 text-white",
        secondary: "border-transparent bg-[#1A1A26] text-[#8888A0]",
        destructive: "border-transparent bg-red-500/20 text-red-400",
        outline: "border-[#2A2A3A] text-[#8888A0]",
        success: "border-transparent bg-green-500/20 text-green-400",
        warning: "border-transparent bg-orange-500/20 text-orange-400",
      },
    },
    defaultVariants: {
      variant: "default",
    },
  }
);

export interface BadgeProps
  extends React.HTMLAttributes<HTMLDivElement>,
    VariantProps<typeof badgeVariants> {}

function Badge({ className, variant, ...props }: BadgeProps) {
  return <div className={cn(badgeVariants({ variant }), className)} {...props} />;
}

export { Badge, badgeVariants };
