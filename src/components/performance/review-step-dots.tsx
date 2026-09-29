// ReviewStepDots (spec-teams-performance section 3): the four steps a cycle
// walks, Self, Manager, Calibrate, Done, over Dots quad-steps, so no caller
// re-invents the words. `withLabels` puts the step words under the dots.

import { Dots } from "@/components/ui/dots";
import { CYCLE_STEPS } from "@/lib/performance/review-cycle";

export function ReviewStepDots({ passed, stalled = false, withLabels = false }: { passed: number; stalled?: boolean; withLabels?: boolean }) {
  const label = `${CYCLE_STEPS.slice(0, passed).map((s) => s.label).join(", ") || "No step"} done`;
  if (!withLabels) return <Dots variant="quad-steps" done={passed} total={4} failed={stalled} label={label} />;
  // Labelled: one column per step, the dot centred over its own word, so a
  // reader can tell which dot is which step (Dots' 4px cluster is for rows).
  return (
    <span className="inline-flex items-start gap-3" role="img" aria-label={label} title={label}>
      {CYCLE_STEPS.map((s, i) => {
        const isDone = i < passed;
        const isFailed = stalled && i === passed;
        return (
          <span key={s.key} className="flex flex-col items-center gap-1" aria-hidden>
            <span
              className="inline-block h-2 w-2 shrink-0 rounded-full"
              style={
                isFailed
                  ? { background: "var(--os-danger-solid)" }
                  : isDone
                    ? { background: "var(--os-brand)" }
                    : { boxShadow: "inset 0 0 0 1.5px var(--os-line-strong)" }
              }
            />
            <span className={`text-xs ${isDone ? "font-medium text-ink" : "text-ink-2"}`}>{s.label}</span>
          </span>
        );
      })}
    </span>
  );
}
