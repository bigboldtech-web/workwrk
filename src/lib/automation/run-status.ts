// One run status, wherever a run is read (spec-ai-automation section 3,
// RunStatusChip): an automation run (SUCCESS, FAILED, PARTIAL, SKIPPED,
// RUNNING) and an agent run (SUCCEEDED, FAILED, PENDING) read with the same
// words and the same pale chip tones. Pure, so the Logs page, the Agents page
// and the tests agree.
//
//   Succeeded  success
//   Failed     danger
//   Partly done warning
//   Skipped    neutral
//   Running    info, with a live dot

export type RunTone = "success" | "danger" | "warning" | "neutral" | "info";

/** The StatusChip colours for each tone (the same values the other run lists use). */
export const RUN_TONE_COLOR: Record<RunTone, string> = {
  success: "#1F8F4E",
  danger: "#B42318",
  warning: "#B45309",
  neutral: "#6B7280",
  info: "#0073EA",
};

export interface RunStatusView {
  label: string;
  tone: RunTone;
  /** Still going: the chip carries a live dot. */
  live: boolean;
}

export function runStatusView(status: string | null | undefined): RunStatusView {
  const s = (status ?? "").toUpperCase();
  if (s === "SUCCESS" || s === "SUCCEEDED" || s === "COMPLETED") return { label: "Succeeded", tone: "success", live: false };
  if (s === "FAILED" || s === "ERROR") return { label: "Failed", tone: "danger", live: false };
  if (s === "PARTIAL") return { label: "Partly done", tone: "warning", live: false };
  if (s === "SKIPPED") return { label: "Skipped", tone: "neutral", live: false };
  if (s === "RUNNING" || s === "PENDING") return { label: "Running", tone: "info", live: true };
  if (!s) return { label: "Unknown", tone: "neutral", live: false };
  return { label: s.charAt(0) + s.slice(1).toLowerCase().replace(/_/g, " "), tone: "neutral", live: false };
}
