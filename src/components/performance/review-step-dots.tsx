// ReviewStepDots (spec-teams-performance section 3): the four steps a cycle
// walks, Self, Manager, Calibrate, Done, over Dots quad-steps, so no caller
// re-invents the words. `withLabels` puts the step words under the dots.

import { Dots } from "@/components/ui/dots";
import { CYCLE_STEPS } from "@/lib/performance/review-cycle";

export function ReviewStepDots({ passed, stalled = false, withLabels = false }: { passed: number; stalled?: boolean; withLabels?: boolean }) {
  const label = `${CYCLE_STEPS.slice(0, passed).map((s) => s.label).join(", ") || "No step"} done`;
  if (!withLabels) return <Dots variant="quad-steps" done={passed} total={4} failed={stalled} label={label} />;
  return (
    <span className="inline-flex flex-col gap-1">
      <Dots variant="quad-steps" done={passed} total={4} failed={stalled} label={label} />
      <span className="flex gap-3 text-xs text-ink-2" aria-hidden>
        {CYCLE_STEPS.map((s, i) => (
          <span key={s.key} className={i < passed ? "font-medium text-ink" : undefined}>{s.label}</span>
        ))}
      </span>
    </span>
  );
}
