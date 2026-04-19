import * as React from "react";
import { cn } from "@/lib/utils";

export type TextareaProps = React.TextareaHTMLAttributes<HTMLTextAreaElement>;

const Textarea = React.forwardRef<HTMLTextAreaElement, TextareaProps>(
  ({ className, ...props }, ref) => {
    return (
      <textarea
        className={cn(
          "flex min-h-[88px] w-full rounded-lg px-3.5 py-2.5 text-[13.5px] resize-none transition-all",
          "border border-[rgba(255,255,255,0.08)] bg-[#1a1a1a] text-[#fafafa] placeholder:text-[#707070]",
          "hover:border-[rgba(255,255,255,0.14)]",
          "focus-visible:outline-none focus-visible:border-[#d4ff2e] focus-visible:ring-[3px] focus-visible:ring-[rgba(212,255,46,0.15)]",
          "disabled:cursor-not-allowed disabled:opacity-50",
          className,
        )}
        ref={ref}
        {...props}
      />
    );
  },
);
Textarea.displayName = "Textarea";

export { Textarea };
