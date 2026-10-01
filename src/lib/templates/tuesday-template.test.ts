// The Tuesday payload's KRA weight. A brand new workspace gets one KRA on
// the Onboarding lead job title, and every KRA surface warns while a job
// title's weights do not total 100, so the seeded weights must total 100.
// The site's fixture keeps its own 30 ("30% of the role" on the approved site).

import { describe, expect, it } from "vitest";
import fixture from "../../components/marketing/data/tuesday.json";
import { TUESDAY_KRA_WEIGHT, tuesdayPayload } from "./tuesday-template";

describe("the Tuesday payload's KRA weight", () => {
  it("seeds the job title's KRA weights to a total of 100, so a new workspace opens on no weight warning", () => {
    const { kra, jobTitles } = tuesdayPayload().bundle;
    expect(jobTitles.map((j) => j.title)).toContain(kra.jobTitle);
    // The bundle holds exactly one KRA, so its weight is the job title's total.
    expect(kra.weight).toBe(100);
    expect(TUESDAY_KRA_WEIGHT).toBe(100);
  });

  it("leaves the marketing fixture's weight as the approved site shows it", () => {
    expect(fixture.kra.weight).toBe(30);
  });
});
