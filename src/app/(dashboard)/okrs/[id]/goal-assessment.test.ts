import { describe, expect, it } from "vitest";
import { pickAssessment, type AssessmentEntry } from "./goal-assessment";
import type { GoalVerdict } from "@/lib/goal-verdict";

// The goal page's Summary must follow router.refresh(): after a check-in the
// ring repaints from the server, so the words beside it may only be the ones
// fetched for that same server render, and the chip must read the fresh
// server verdict while the refetch runs.

type A = { verdict: GoalVerdict; headline: string };
const entry = (key: string, verdictAtFetch: GoalVerdict, verdict: GoalVerdict = verdictAtFetch): AssessmentEntry<A> => ({
  key, verdictAtFetch, data: { verdict, headline: `for ${key}` },
});

describe("pickAssessment", () => {
  it("shows nothing but the server verdict before the first fetch lands", () => {
    expect(pickAssessment<A>(null, "0#0", "not_measured")).toEqual({ current: null, verdict: "not_measured" });
  });

  it("shows the fetched assessment for the render it was fetched for", () => {
    const e = entry("0#0", "on_track");
    expect(pickAssessment(e, "0#0", "on_track")).toEqual({ current: e.data, verdict: "on_track" });
  });

  it("drops the old words once a check-in re-rendered the page", () => {
    // The reported bug: "0% done" stayed beside a 50% ring.
    const e = entry("0#0", "on_track");
    expect(pickAssessment(e, "1#0", "on_track").current).toBeNull();
  });

  it("switches the chip to the new server verdict at once", () => {
    const e = entry("0#0", "not_measured");
    expect(pickAssessment(e, "1#0", "on_track").verdict).toBe("on_track");
    // Even if the render key has not moved yet, a verdict that moved past
    // the one the entry was fetched beside wins over the stale entry.
    expect(pickAssessment(e, "0#0", "on_track")).toEqual({ current: null, verdict: "on_track" });
  });

  it("a Retry is its own key, so an old failure or entry never shows for it", () => {
    const e = entry("2#0", "at_risk");
    expect(pickAssessment(e, "2#1", "at_risk").current).toBeNull();
  });
});
