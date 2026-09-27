"use client";

// RunStatusChip (spec-ai-automation section 3): the design system's pale
// StatusChip with the one run vocabulary (src/lib/automation/run-status.ts),
// for automation runs and agent runs alike. Running carries a live dot.

import { StatusChip } from "@/components/ui/chip";
import { Dots } from "@/components/ui/dots";
import { RUN_TONE_COLOR, runStatusView } from "@/lib/automation/run-status";

export function RunStatusChip({ status }: { status: string | null | undefined }) {
  const v = runStatusView(status);
  return (
    <span className="inline-flex items-center gap-1.5">
      <StatusChip disabled color={RUN_TONE_COLOR[v.tone]} label={v.label} />
      {v.live ? <Dots variant="live" label="Running now" /> : null}
    </span>
  );
}

/** The 8px dot a compact run row leads with (Recent runs in the agent drawer). */
export function RunStatusDot({ status }: { status: string | null | undefined }) {
  const v = runStatusView(status);
  return (
    <span
      className="inline-block size-2 shrink-0 rounded-full"
      style={{ backgroundColor: RUN_TONE_COLOR[v.tone] }}
      role="img"
      aria-label={v.label}
      title={v.label}
    />
  );
}
