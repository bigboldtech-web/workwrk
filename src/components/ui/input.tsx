import * as React from "react";
import { cn } from "@/lib/utils";

export type InputProps = React.InputHTMLAttributes<HTMLInputElement>;

const Input = React.forwardRef<HTMLInputElement, InputProps>(
  ({ className, type, ...props }, ref) => {
    return (
      <input
        type={type}
        className={cn(
          "flex h-9 w-full rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-[13px] text-foreground placeholder:text-muted-2 focus-visible:outline-none focus-visible:border-violet-500 focus-visible:ring-[3px] focus-visible:ring-violet-500/15 disabled:cursor-not-allowed disabled:opacity-50 transition-all dark:border-border dark:bg-surface-2",
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
