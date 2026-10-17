// What the skill routes answer (src/lib/skills/views.ts,
// docs/plans/ai-teammates-phase5.md step 3): each step's facts by its kind,
// the start step's whole address, a picture only by shotSrc's rule and only
// while kept, and the day a skill whose person or teammate is gone will be
// deleted.

import { describe, expect, it } from "vitest";
import type { SkillStep } from "./types";
import { deletesOnOf, skillListView, skillView, stepFacts, stepView } from "./views";

/** No en dash, em dash or double hyphen in the person's words (the copy rule). */
const BANNED_DASHES = /\u2013|\u2014|--/;

const SITE = "expenses.proof.test";
const base = { title: "x", site: SITE, page: `${SITE}/new`, shotId: null };

describe("stepFacts", () => {
  it("says what each kind of step does, with its page, and the start step's whole address", () => {
    const cases: Array<[SkillStep, string]> = [
      [{ ...base, id: "s1", kind: "start", page: SITE, address: `http://${SITE}/new` }, "Starts at http://expenses.proof.test/new"],
      [{ ...base, id: "s2", kind: "link", name: "Reports" }, 'Goes to the link "Reports" on expenses.proof.test/new'],
      [{ ...base, id: "s3", kind: "link", name: "" }, "Goes to a link on expenses.proof.test/new"],
      [{ ...base, id: "s4", kind: "click", role: "button", name: "Add line", tag: "button", type: null, formHost: null, warnings: [] }, 'Clicks the button "Add line" on expenses.proof.test/new'],
      [{ ...base, id: "s5", kind: "click", role: "link", name: "", tag: "a", type: null, formHost: null, warnings: [] }, "Clicks the link on expenses.proof.test/new"],
      [{ ...base, id: "s6", kind: "type", name: "Amount", fieldKind: "text", pressEnter: false, value: { ask: true } }, 'Types in "Amount" on expenses.proof.test/new'],
      [{ ...base, id: "s7", kind: "type", name: "", fieldKind: "search", pressEnter: true, value: { ask: true } }, "Types in a field on expenses.proof.test/new, then presses Enter"],
      [{ ...base, id: "s8", kind: "choose", via: "list", name: "Category", value: { ask: true } }, 'Chooses in "Category" on expenses.proof.test/new'],
      [{ ...base, id: "s9", kind: "choose", via: "suggestion", name: "Approver", value: { ask: true } }, 'Chooses one of the suggestions in "Approver" on expenses.proof.test/new'],
      [{ ...base, id: "s10", kind: "choose", via: "item", name: "My expenses", value: { ask: true } }, 'Opens one item of "My expenses" on expenses.proof.test/new'],
      [{ ...base, id: "s11", kind: "yourself", reason: "sign_in" }, "You sign in yourself on expenses.proof.test/new"],
      [{ ...base, id: "s12", kind: "yourself", reason: "frame" }, "You do this part yourself on expenses.proof.test/new: it is in a box from another site"],
      [{ ...base, id: "s13", kind: "gap" }, "Something you did just before this may be missing: the page changed in a way the recording could not follow. Check this part of the job before you save it."],
    ];
    for (const [step, words] of cases) {
      expect(stepFacts(step), step.id).toBe(words);
      expect(BANNED_DASHES.test(stepFacts(step)), step.id).toBe(false);
    }
  });
});

describe("stepView", () => {
  it("gives a picture only by shotSrc's rule and only while kept, else says it is gone", () => {
    const kept = new Map([["shot-1", "2026-10-18T09:00:00.000Z"]]);
    const s: SkillStep = { ...base, id: "s2", kind: "type", shotId: "shot-1", name: "Amount", fieldKind: "text", pressEnter: false, value: { fixed: "42.50" } };
    expect(stepView(s, kept)).toMatchObject({ shot: { id: "shot-1", expiresAt: "2026-10-18T09:00:00.000Z" }, pictureGone: false, value: { fixed: "42.50" }, hasName: true, plainTitle: "Type in a field" });
    expect(stepView({ ...s, shotId: "shot-2" }, kept)).toMatchObject({ shot: null, pictureGone: true });
    // An id that is not one never reaches the page, whatever the map holds.
    expect(stepView({ ...s, shotId: "../../etc/passwd" }, new Map([["../../etc/passwd", "2026-10-18T09:00:00.000Z"]]))).toMatchObject({ shot: null });
    expect(stepView({ ...s, shotId: null }, kept)).toMatchObject({ shot: null, pictureGone: false });
    // Only a step that types or chooses has a value; the start step has its address; a step the person does has its reason.
    expect(stepView({ ...base, id: "s1", kind: "start", address: `http://${SITE}/new` }, kept)).toMatchObject({ value: null, address: `http://${SITE}/new`, hasName: false, plainTitle: null });
    expect(stepView({ ...base, id: "s5", kind: "yourself", reason: "payment" }, kept)).toMatchObject({ reason: "payment", value: null });
  });
});

describe("the list's and the editor's views", () => {
  const row = {
    id: "sk1",
    organizationId: "org1",
    agentId: "a-shop",
    name: "Submit an expense",
    description: "",
    status: "draft",
    version: 2,
    steps: [
      { id: "s1", kind: "start", title: "Start on expenses.proof.test", site: SITE, page: SITE, shotId: null, address: `http://${SITE}/` },
      { id: "s2", kind: "nonsense", title: "x", site: SITE, page: SITE, shotId: null },
    ],
    stepCount: 2,
    sites: [SITE, 7],
    startUrl: `http://${SITE}/`,
    recordingEndReason: "done",
    orphanedAt: null,
    lastRunAt: null,
    runCount: 0,
    createdAt: new Date("2026-10-17T08:00:00.000Z"),
  };

  it("reads a row defensively: a step that is not one dropped, a site that is not a string dropped", () => {
    const v = skillView(row, { notAllowed: ["pay.proof.test"], routines: 1, kept: new Map() });
    expect(v.steps.map((s) => s.id)).toEqual(["s1"]);
    expect(v).toMatchObject({ sites: [SITE], notAllowed: ["pay.proof.test"], routines: 1, recordingEndReason: "done", deletesOn: null, startUrl: `http://${SITE}/` });
    expect(skillListView({ ...row, status: "weird", recordingEndReason: "because" }, { notAllowed: [], routines: 0 })).toMatchObject({ status: "draft", recordingEndReason: null });
  });

  it("gives the day it will be deleted: orphanedAt plus 30 days", () => {
    expect(deletesOnOf(new Date("2026-10-01T09:00:00.000Z"))).toBe("2026-10-31T09:00:00.000Z");
    expect(deletesOnOf(null)).toBeNull();
    expect(skillListView({ ...row, orphanedAt: new Date("2026-10-01T09:00:00.000Z") }, { notAllowed: [], routines: 0 }).deletesOn).toBe("2026-10-31T09:00:00.000Z");
  });
});
