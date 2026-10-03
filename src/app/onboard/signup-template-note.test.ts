// What the Tuesday template says it seeds, on every surface that says it:
// the /onboard success note (appliedPieces), the /tuesday close lede and the
// spine notice. Signup always makes a sample task on the Onboarding List
// (src/lib/templates/apply-tuesday.ts step 4), and the copy beside the CTAs
// is meant to name exactly what signup seeds, so each surface names it.

import { describe, expect, it } from "vitest";
import { appliedPieces } from "./signup-template-note";
import { spineNotice, tuesdayCtaLede } from "@/components/marketing/home/content";
import { flags } from "@/components/marketing/flags";

const full = {
  key: "space.tuesday-client-onboarding",
  name: "Tuesday: client onboarding",
  status: "applied" as const,
  spaceSlug: "operations",
  sopId: "sop1",
  kraId: "kra1",
  kpiId: "kpi1",
  goalId: "goal1",
  docId: "doc1",
  jobTitles: 2,
};

describe("appliedPieces", () => {
  it("names the sample task when the view does not say otherwise (the route sends no id today)", () => {
    expect(appliedPieces(full)).toBe(
      "the Operations Space with its Onboarding List, the Client onboarding SOP, the Onboarding lead and Finance job titles, a KRA and KPI, a company goal, a playbook doc and a sample task on the List",
    );
  });

  it("names the sample task when the view carries its id", () => {
    expect(appliedPieces({ ...full, sampleTaskId: "item1" })).toContain("and a sample task on the List");
  });

  it("leaves the sample task out only when the view says it was not made", () => {
    expect(appliedPieces({ ...full, sampleTaskId: null })).not.toContain("sample task");
  });

  it("still names the sample task when a plan cap left the governance pieces out", () => {
    expect(appliedPieces({ ...full, sopId: null, kraId: null, kpiId: null, goalId: null, jobTitles: 0 })).toBe(
      "the Operations Space with its Onboarding List, a playbook doc and a sample task on the List",
    );
  });
});

describe("the Tuesday copy beside the CTAs", () => {
  it("names the sample task wherever it names the seeded pieces", () => {
    if (!flags.tuesdayTemplateAtSignup) return;
    expect(tuesdayCtaLede()).toContain("a sample task");
    expect(spineNotice()).toContain("sample task");
  });
});
