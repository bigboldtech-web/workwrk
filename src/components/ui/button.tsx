import * as React from "react";
import { Slot } from "@radix-ui/react-slot";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/lib/utils";

const buttonVariants = cva(
  "inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-lg text-sm font-medium transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[color:var(--accent)] focus-visible:ring-offset-2 focus-visible:ring-offset-background disabled:pointer-events-none disabled:opacity-50",
  {
    variants: {
      variant: {
        default:
          "bg-[color:var(--accent)] text-[color:var(--accent-contrast)] hover:-translate-y-[1px] hover:bg-[color:var(--color-accent-light)] shadow-[var(--accent-glow)]",
        destructive:
          "bg-[#ff3d8a] text-[#0a0a0a] hover:-translate-y-[1px] shadow-[0_6px_18px_-6px_rgba(255,61,138,0.55)]",
        outline:
          "border border-border bg-transparent text-foreground hover:bg-surface-2 hover:border-[color:var(--b-line-2)]",
        secondary:
          "bg-surface-2 text-foreground border border-border hover:bg-surface-3 hover:border-[color:var(--b-line-2)]",
        ghost: "text-muted hover:bg-surface-2 hover:text-foreground",
        link: "text-[color:var(--accent-strong)] underline-offset-4 hover:underline px-0",
      },
      size: {
        default: "h-9 px-4 py-2 text-[13px]",
        sm: "h-8 rounded-md px-3 text-xs",
        lg: "h-11 rounded-full px-6 text-[14px]",
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
