import * as React from "react";
import { Slot } from "@radix-ui/react-slot";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/lib/utils";

const buttonVariants = cva(
  "inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-lg text-sm font-medium transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#d4ff2e] focus-visible:ring-offset-2 focus-visible:ring-offset-[#0a0a0a] disabled:pointer-events-none disabled:opacity-50",
  {
    variants: {
      variant: {
        default:
          "bg-[#d4ff2e] text-[#0a0a0a] hover:-translate-y-[1px] shadow-[0_6px_18px_-6px_rgba(212,255,46,0.55)] hover:shadow-[0_10px_22px_-6px_rgba(212,255,46,0.7)]",
        destructive:
          "bg-[#ff3d8a] text-[#0a0a0a] hover:-translate-y-[1px] shadow-[0_6px_18px_-6px_rgba(255,61,138,0.55)]",
        outline:
          "border border-[rgba(255,255,255,0.08)] bg-transparent text-[#ededed] hover:bg-[#1a1a1a] hover:border-[rgba(255,255,255,0.14)]",
        secondary:
          "bg-[#1a1a1a] text-[#fafafa] border border-[rgba(255,255,255,0.08)] hover:bg-[#222222] hover:border-[rgba(255,255,255,0.14)]",
        ghost: "text-[#a0a0a0] hover:bg-[#1a1a1a] hover:text-[#fafafa]",
        link: "text-[#d4ff2e] underline-offset-4 hover:underline px-0",
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
