import { describe, expect, it } from "vitest";
import { RUN_TONE_COLOR, runStatusView } from "./run-status";

describe("runStatusView", () => {
  it("reads automation and agent statuses with one vocabulary", () => {
    expect(runStatusView("SUCCESS")).toEqual({ label: "Succeeded", tone: "success", live: false });
    expect(runStatusView("SUCCEEDED").label).toBe("Succeeded");
    expect(runStatusView("FAILED")).toEqual({ label: "Failed", tone: "danger", live: false });
    expect(runStatusView("PARTIAL")).toEqual({ label: "Partly done", tone: "warning", live: false });
    expect(runStatusView("SKIPPED").tone).toBe("neutral");
  });
  it("reads a pending agent run as running, with a live dot", () => {
    expect(runStatusView("PENDING")).toEqual({ label: "Running", tone: "info", live: true });
    expect(runStatusView("RUNNING").live).toBe(true);
  });
  it("never prints a raw code for an unknown status", () => {
    expect(runStatusView("TIMED_OUT")).toEqual({ label: "Timed out", tone: "neutral", live: false });
    expect(runStatusView(null).label).toBe("Unknown");
  });
  it("has a colour for every tone", () => {
    for (const tone of ["success", "danger", "warning", "neutral", "info"] as const) expect(RUN_TONE_COLOR[tone]).toMatch(/^#[0-9A-F]{6}$/i);
  });
});
