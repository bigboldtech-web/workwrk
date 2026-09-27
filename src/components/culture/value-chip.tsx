// ValueChip (spec-teams-performance section 3): a company value on a kudos,
// as a NEUTRAL label chip carrying the word and no glyph. No hue map, ever:
// a value an org adds tomorrow looks exactly like one it had last year
// (design-system 5.9, label chips are neutral). A span, never a button: it
// labels, it does nothing when clicked.

import { cn } from "@/lib/utils";

export function ValueChip({ value, size = "md", className }: { value: string; size?: "sm" | "md"; className?: string }) {
  return (
    <span
      className={cn(
        "inline-flex max-w-[220px] items-center truncate rounded-md border border-line bg-raised font-medium text-ink-2",
        size === "sm" ? "h-5 px-1.5 text-xs" : "h-6 px-2 text-sm",
        className,
      )}
      title={value}
    >
      {value}
    </span>
  );
}
