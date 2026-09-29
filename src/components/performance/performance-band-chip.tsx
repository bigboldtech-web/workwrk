// PerformanceBandChip (spec-teams-performance section 3): the reserved
// "performance band" variant of StatusChip (design-system 5.9): a neutral
// chip with the band word at 500 and a 4px ink-3 bar; only the top band may
// read success. The bands are the org's (Settings > Scoring and reviews).

import { bandOf, type Band } from "@/lib/performance/review-cycle";
import { cn } from "@/lib/utils";

export function PerformanceBandChip({ score, bands, className }: { score: number | null | undefined; bands: readonly Band[]; className?: string }) {
  const band = bandOf(score, bands);
  if (!band) return <span className="text-ink-3">None</span>;
  const top = [...bands].sort((a, b) => b.min - a.min)[0];
  const isTop = top && top.label === band.label && top.min === band.min;
  return (
    <span
      className={cn(
        "inline-flex h-[26px] items-center gap-1.5 whitespace-nowrap rounded-md border px-2 text-xs font-medium",
        isTop ? "border-[var(--os-success-border,var(--os-line))] bg-[var(--os-success-bg,var(--os-surface-1))] text-success-text" : "border-line bg-subtle text-ink",
        className,
      )}
      title={`${band.label}: ${band.min} to ${band.max}`}
    >
      <span className={cn("h-1 w-3 rounded-full", isTop ? "bg-[var(--os-success-solid)]" : "bg-[var(--os-ink-3)]")} aria-hidden />
      {band.label}
    </span>
  );
}
