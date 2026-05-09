import * as React from "react";
import { cn } from "@/lib/utils";

export type TextareaProps = React.TextareaHTMLAttributes<HTMLTextAreaElement>;

const Textarea = React.forwardRef<HTMLTextAreaElement, TextareaProps>(
  ({ className, ...props }, ref) => {
    return (
      <textarea
        className={cn(
          "flex min-h-[72px] w-full rounded-lg px-3 py-2 text-[13px] resize-none transition-all",
          "border border-slate-200 bg-white text-foreground placeholder:text-muted-2",
          "hover:border-slate-300",
          "focus-visible:outline-none focus-visible:border-violet-500 focus-visible:ring-[3px] focus-visible:ring-violet-500/15",
          "disabled:cursor-not-allowed disabled:opacity-50",
          "dark:border-border dark:bg-surface-2 dark:hover:border-[color:var(--b-line-2)]",
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
