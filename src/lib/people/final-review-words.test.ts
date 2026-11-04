// The words the final review of docs/plans/workspace-status-2.md corrected
// (part B, product and copy), each held here as a person reads it:
//   M2  an SOP by name names the people it could not assign;
//   L6  a deadlock in a department write says "changing people", never
//       "roles or reporting lines";
//   L7  a return by invitation is the person's own, never "Restored" by
//       themselves, and a seat back with the account says nobody here acted;
//   L8  the alignment sentences say it once.

import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/prisma", () => ({ prisma: {} }));

import { ORG_ROLES_BUSY, OrgRolesBusy, PEOPLE_BUSY, TOOK_TOO_LONG, placementRetryAnswer, retryAnswer } from "@/lib/access/org-roles-busy";
import { groupWriteRetry } from "@/lib/scim-groups";
import { clearedLineSentence, type StaleLine } from "@/lib/access/manager-candidate";
import { ALIGNMENT_NOT_HERE, JOB_TITLE_SAVED_NOT_ASSIGNED, namesInWords, sopLeftOutWords, sopNotAssignedNamedWords } from "@/lib/people/person-fields";

const deadlock = () => Object.assign(new Error("deadlock detected"), { code: "40P01" });
const timeout = () => Object.assign(new Error("Transaction already closed"), { code: "P2028" });
const noDashes = (s: string) => expect(s, s).not.toMatch(/-{2}|—|–/);

describe("M2: an SOP by name names whom it could not assign", () => {
  it("names one, two, or two and how many others, in the order picked", () => {
    expect(namesInWords(["Pat Lee"])).toBe("Pat Lee");
    expect(namesInWords(["Pat Lee", "Max Chen"])).toBe("Pat Lee and Max Chen");
    expect(namesInWords(["Pat Lee", "Max Chen", "Ada Ng"])).toBe("Pat Lee, Max Chen and 1 other");
    expect(namesInWords(["Pat Lee", "Max Chen", "Ada Ng", "Kai Ito"])).toBe("Pat Lee, Max Chen and 2 others");
    expect(sopNotAssignedNamedWords(["Pat Lee"])).toBe(
      "Pat Lee works here from another workspace's account, and SOPs are not assigned to people who do. Nothing was assigned: take them off the list and assign again.",
    );
    expect(sopNotAssignedNamedWords(["Pat Lee", "Max Chen", "Ada Ng", "Kai Ito"])).toBe(
      "Pat Lee, Max Chen and 2 others work here from another workspace's account, and SOPs are not assigned to people who do. Nothing was assigned: take them off the list and assign again.",
    );
    noDashes(sopNotAssignedNamedWords(["Pat Lee", "Max Chen"]));
  });
});

describe("L8: the alignment sentences, once each", () => {
  it("an SOP by department says how many it left out and why in one sentence, and a job title's note says it was saved", () => {
    expect(sopLeftOutWords(1)).toBe("1 person who works here from another workspace's account was not assigned, since KRAs and SOPs are not assigned to people who do.");
    expect(sopLeftOutWords(3)).toBe("3 people who work here from another workspace's account were not assigned, since KRAs and SOPs are not assigned to people who do.");
    expect(JOB_TITLE_SAVED_NOT_ASSIGNED).toBe(`Job title saved. ${ALIGNMENT_NOT_HERE}`);
    for (const s of [sopLeftOutWords(2), JOB_TITLE_SAVED_NOT_ASSIGNED]) {
      noDashes(s);
      // Never the same sentence twice in one note.
      expect(s.split(/(?<=\.) /).length).toBe(new Set(s.split(/(?<=\.) /)).size);
    }
  });
});

describe("L6: a deadlock in a department write says what is going on", () => {
  it("placementRetryAnswer: a deadlock is someone changing people; a busy role lock and a timeout as before", () => {
    expect(placementRetryAnswer(deadlock())).toEqual({ status: 503, error: PEOPLE_BUSY, code: "roles_busy", retryAfterSeconds: 2 });
    expect(PEOPLE_BUSY).toBe("Someone else is changing people in this workspace right now. Try again in a moment.");
    expect(placementRetryAnswer(new OrgRolesBusy())?.error).toBe(ORG_ROLES_BUSY);
    expect(placementRetryAnswer(timeout())?.error).toBe(TOOK_TOO_LONG);
    expect(placementRetryAnswer(new Error("boom"))).toBeNull();
    // A line write's deadlock still says roles or reporting lines.
    expect(retryAnswer(deadlock())?.error).toBe(ORG_ROLES_BUSY);
  });

  it("a SCIM Group write that meets a deadlock answers the provider with it (before: roles or reporting lines)", async () => {
    expect(await groupWriteRetry(async () => { throw deadlock(); })).toBe(PEOPLE_BUSY);
    expect(await groupWriteRetry(async () => undefined)).toBeNull();
    await expect(groupWriteRetry(async () => { throw new Error("boom"); })).rejects.toThrow("boom");
  });
});

describe("L7 and part A's clears: who brought the seat back", () => {
  const dana: StaleLine = { managerId: "dana", name: "Dana Ray", why: "removed" };
  const ada: StaleLine = { managerId: "ada", name: "Ada Bot", why: "agent" };
  const away: StaleLine = { managerId: "zed", name: null, why: "elsewhere" };

  it("an Admin's restore or reactivation here reads as before", () => {
    expect(clearedLineSentence("Restored", "Pat Lee", dana, true)).toBe("Restored Pat Lee with no manager: Dana Ray is no longer in the workspace");
    expect(clearedLineSentence("Reactivated", "Pat Lee", ada, false)).toBe("Reactivated Pat Lee without their dotted line to Ada Bot: Ada Bot is on the Agent tier, and an Agent can't be anyone's manager");
  });

  it("a return by invitation is the person's own, never Restored by themselves", () => {
    // Before: "Restored Pat Lee with no manager: ...", with Pat as the actor.
    expect(clearedLineSentence("Rejoined", "Pat Lee", dana, true)).toBe("Pat Lee rejoined from an invitation with no manager: Dana Ray is no longer in the workspace");
    expect(clearedLineSentence("Rejoined", "Pat Lee", ada, false)).toBe("Pat Lee rejoined from an invitation without their dotted line to Ada Bot: Ada Bot is on the Agent tier, and an Agent can't be anyone's manager");
  });

  it("a seat back with the account says nobody in this workspace acted", () => {
    expect(clearedLineSentence("RestoredWithAccount", "Pat Lee", dana, true)).toBe("Pat Lee is back in this workspace after their account was restored, with no manager: Dana Ray is no longer in the workspace");
    expect(clearedLineSentence("ReactivatedWithAccount", "Pat Lee", away, false)).toBe("Pat Lee is back in this workspace after their account was reactivated, without a dotted line to someone who doesn't work in this workspace");
    for (const how of ["Restored", "Reactivated", "Rejoined", "RestoredWithAccount", "ReactivatedWithAccount"] as const) {
      for (const line of [dana, ada, away]) noDashes(clearedLineSentence(how, "Pat Lee", line, line === dana));
    }
  });
});
