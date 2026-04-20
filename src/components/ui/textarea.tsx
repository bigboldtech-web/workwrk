import * as React from "react";
import { cn } from "@/lib/utils";

export type TextareaProps = React.TextareaHTMLAttributes<HTMLTextAreaElement>;

const Textarea = React.forwardRef<HTMLTextAreaElement, TextareaProps>(
  ({ className, ...props }, ref) => {
    return (
      <textarea
        className={cn(
          "flex min-h-[88px] w-full rounded-lg px-3.5 py-2.5 text-[13.5px] resize-none transition-all",
          "border border-border bg-surface-2 text-foreground placeholder:text-muted-2",
          "hover:border-[color:var(--b-line-2)]",
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
