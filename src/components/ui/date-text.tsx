"use client";

// <DateText value style />: one date in the viewer's own format (Locale &
// work week, then My settings > Preferences), through the one renderer
// (src/lib/format/date.ts formatDate). For a table cell or a helper line that
// is not itself a component with the useFormat hook in reach. The title
// carries the full date and time, so a short "7 Oct" is never ambiguous.
import type { DateStyle } from "@/lib/format/date";
import { useFormat } from "@/lib/format/use-date-prefs";

export function DateText({ value, style = "date", fallback = "" }: { value: Date | string | number | null | undefined; style?: DateStyle | "relative"; fallback?: string }) {
  const fmt = useFormat();
  if (value === null || value === undefined || value === "") return <>{fallback}</>;
  return <span title={fmt.title(value)}>{style === "relative" ? fmt.relative(value) : fmt.date(value, style)}</span>;
}
