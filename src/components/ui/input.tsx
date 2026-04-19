import * as React from "react";
import { cn } from "@/lib/utils";

export type InputProps = React.InputHTMLAttributes<HTMLInputElement>;

const Input = React.forwardRef<HTMLInputElement, InputProps>(
  ({ className, type, ...props }, ref) => {
    return (
      <input
        type={type}
        className={cn(
          "flex h-10 w-full rounded-lg border border-[rgba(255,255,255,0.08)] bg-[#1a1a1a] px-3.5 py-2 text-sm text-[#fafafa] placeholder:text-[#707070] focus-visible:outline-none focus-visible:border-[#d4ff2e] focus-visible:ring-[3px] focus-visible:ring-[rgba(212,255,46,0.15)] disabled:cursor-not-allowed disabled:opacity-50 transition-all",
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
