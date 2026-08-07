import * as React from "react";
import { Slot } from "@radix-ui/react-slot";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/lib/utils";

// Monday-clean button system. Primary is flat brand blue #0073EA,
// destructive is flat red #E2445C — no gradients, no glow shadows
// (shadow-sm ceiling). Outline + ghost stay neutral so they don't
// compete with the primary CTA on a page. Sizes share a consistent
// 8px radius — only the lg pill keeps a rounded-full silhouette for
// hero CTAs.

const buttonVariants = cva(
  "inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-lg text-sm font-medium transition-all duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#0073EA]/40 focus-visible:ring-offset-1 focus-visible:ring-offset-background disabled:pointer-events-none disabled:opacity-50 active:translate-y-px",
  {
    variants: {
      variant: {
        default:
          "text-white bg-[#0073EA] hover:bg-[#0060B9] shadow-sm",
        destructive:
          "text-white bg-[#E2445C] hover:bg-[#CF3D53] shadow-sm",
        outline:
          "border border-slate-200 bg-white text-slate-700 hover:bg-slate-50 hover:border-slate-300 hover:text-slate-900 dark:bg-transparent dark:text-foreground dark:border-border dark:hover:bg-surface-2",
        secondary:
          "bg-slate-100 text-slate-900 hover:bg-slate-200 dark:bg-surface-2 dark:text-foreground dark:hover:bg-surface-3",
        ghost:
          "text-slate-600 hover:bg-slate-100 hover:text-slate-900 dark:text-muted dark:hover:bg-surface-2 dark:hover:text-foreground",
        link:
          "text-[#0073EA] hover:text-[#005BB8] underline-offset-4 hover:underline px-0",
      },
      size: {
        default: "h-9 px-4 py-2 text-[13px]",
        sm: "h-8 rounded-md px-3 text-xs",
        lg: "h-11 rounded-full px-6 text-[14px] font-semibold",
        icon: "h-9 w-9 rounded-lg",
      },
    },
    defaultVariants: {
      variant: "default",
      size: "default",
    },
  },
);

export interface ButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof buttonVariants> {
  asChild?: boolean;
}

const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant, size, asChild = false, ...props }, ref) => {
    const Comp = asChild ? Slot : "button";
    return (
      <Comp
        className={cn(buttonVariants({ variant, size, className }))}
        ref={ref}
        {...props}
      />
    );
  },
);
Button.displayName = "Button";

export { Button, buttonVariants };
