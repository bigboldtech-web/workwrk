// Batch 7, the one share dialog for SOP folders, tools, goals and teams: the
// pure pieces, every word a person reads and every rule a request answers by.

import { describe, expect, it } from "vitest";
import {
  MANAGE_BAR, OBJECT_SHARE_KINDS, ROLES_BY_KIND, isAccessNodeKind, isObjectShareKind, panelRoleBlurb, shareRoleLabel,
  type GrantChange,
} from "./access-panel";
import { accessActivityDescription, accessAuditSentence } from "./access-activity";
import { objectGrantRole, objectRequestGrants, requestNodeRef, requestObjectKind } from "./access-requests";
import { errorText, keptHigherText, removalNotice, sentenceNoun, strayFailureText, viaText } from "@/components/access/manage-access-model";
import { grantedNoticeText } from "./object-share/words";

const change = (over: Partial<GrantChange>): GrantChange => ({ userId: "u", role: null, previousRole: "EDIT", noChange: false, stillReaches: null, keepsInside: [], ...over });

describe("the four object kinds", () => {
  it("are kinds of their own, never nodes", () => {
    expect([...OBJECT_SHARE_KINDS]).toEqual(["sop_folder", "tool", "goal", "team"]);
    for (const k of OBJECT_SHARE_KINDS) {
      expect(isObjectShareKind(k)).toBe(true);
      expect(isAccessNodeKind(k)).toBe(false);
    }
    expect(isObjectShareKind("space")).toBe(false);
    expect(isObjectShareKind("sop")).toBe(false);
  });

  it("offer only the roles their stores can hold", () => {
    expect(ROLES_BY_KIND.sop_folder).toEqual(["FULL", "EDIT", "VIEW"]);
    expect(ROLES_BY_KIND.tool).toEqual(["FULL", "EDIT", "VIEW"]);
    expect(ROLES_BY_KIND.goal).toEqual(["EDIT"]);
    expect(ROLES_BY_KIND.team).toEqual(["FULL", "VIEW"]);
    // A goal is shared by whoever may edit it, as its Contributors row is.
    expect(MANAGE_BAR.goal).toBe("EDIT");
    expect(MANAGE_BAR.tool).toBe("FULL");
  });

  it("say each role in the object's own words", () => {
    expect(shareRoleLabel("goal", "EDIT")).toBe("Can check in");
    expect(shareRoleLabel("team", "FULL")).toBe("Lead");
    expect(shareRoleLabel("team", "VIEW")).toBe("Member");
    expect(shareRoleLabel("tool", "EDIT")).toBe("Can edit");
    expect(shareRoleLabel("sop_folder", "FULL")).toBe("Full access");
    expect(panelRoleBlurb("tool", "EDIT")).toBe("Change the tool and its saved login.");
    expect(panelRoleBlurb("goal", "EDIT")).toMatch(/^See the goal and check in on its targets\. Never rename, delete or share it\.$/);
  });
});

describe("a request on one of them", () => {
  it("is answered through the object's writer, never for a single SOP", () => {
    expect(requestObjectKind("tool")).toBe("tool");
    expect(requestObjectKind("goal")).toBe("goal");
    expect(requestObjectKind("sop_folder")).toBe("sop_folder");
    expect(requestObjectKind("team")).toBe("team");
    // Answering a request on one SOP by sharing its folder would open every SOP in it.
    expect(requestObjectKind("sop")).toBeNull();
    expect(requestObjectKind("contract")).toBeNull();
    expect(requestNodeRef("tool", "t1")).toBeNull();
  });

  it("gives what the store can hold", () => {
    expect(objectGrantRole("tool", "EDIT")).toBe("EDIT");
    expect(objectGrantRole("tool", "COMMENT")).toBe("VIEW");
    expect(objectGrantRole("sop_folder", "VIEW")).toBe("VIEW");
    expect(objectGrantRole("goal", "VIEW")).toBe("EDIT");
    expect(objectGrantRole("team", "EDIT")).toBe("VIEW");
  });

  it("offers the card's answers in the object's words", () => {
    expect(objectRequestGrants("tool", "EDIT")).toEqual([{ role: "EDIT", label: "Give edit" }, { role: "VIEW", label: "Give view" }]);
    expect(objectRequestGrants("tool", "COMMENT")).toEqual([{ role: "VIEW", label: "Give view" }]);
    expect(objectRequestGrants("goal", "EDIT")).toEqual([{ role: "EDIT", label: "Add as contributor" }]);
    expect(objectRequestGrants("team", "VIEW")).toEqual([{ role: "VIEW", label: "Add to the team" }]);
  });
});

describe("their access activity", () => {
  it("names the object with the right article and verb", () => {
    expect(accessActivityDescription("access.granted", "sop_folder")).toBe("Gave someone access to an SOP folder");
    expect(accessActivityDescription("access.granted", "tool")).toBe("Gave someone access to a Tool");
    expect(accessActivityDescription("access.granted", "team")).toBe("Added someone to a Team");
    expect(accessActivityDescription("access.revoked", "team")).toBe("Took someone off a Team");
    expect(accessActivityDescription("access.role_changed", "team")).toBe("Changed someone's role on a Team");
  });

  it("reads in the audit in each object's own words", () => {
    const base = { kind: null, nodeName: "HR", granteeName: "Eve", role: null as string | null, previousRole: null as string | null };
    expect(accessAuditSentence("access.granted", { ...base, objectKind: "sop_folder", role: "EDITOR" })).toBe("Gave Eve Can edit on the SOP folder HR");
    expect(accessAuditSentence("access.role_changed", { ...base, objectKind: "sop_folder", role: "OWNER", previousRole: "VIEWER" })).toBe("Changed Eve from Can view to Full access on the SOP folder HR");
    expect(accessAuditSentence("access.granted", { ...base, objectKind: "goal", nodeName: "Ship it", role: "EDIT" })).toBe("Gave Eve Can check in on the Goal Ship it");
    expect(accessAuditSentence("access.granted", { ...base, objectKind: "team", nodeName: "Design", role: "VIEW" })).toBe("Added Eve to the Team Design as Member");
    expect(accessAuditSentence("access.revoked", { ...base, objectKind: "team", nodeName: "Design", previousRole: "FULL" })).toBe("Took Eve (Lead) off the Team Design");
    expect(accessAuditSentence("access.revoked", { ...base, objectKind: "tool", nodeName: "Figma", previousRole: "EDIT" })).toBe("Removed Eve (Can edit) from the Tool Figma");
    // A node row reads exactly as before.
    expect(accessAuditSentence("access.granted", { ...base, kind: "list", nodeName: "Onboarding", role: "GUEST" })).toBe("Gave Eve Can view on the List Onboarding");
  });
});

describe("the dialog's sentences on them", () => {
  it("say who decides, in each object's terms", () => {
    expect(sentenceNoun("sop_folder")).toBe("SOP folder");
    expect(errorText("forbidden", "goal")).toBe("Only people who can edit this goal change who can see it.");
    expect(errorText("forbidden", "team")).toBe("Only Owners, Admins and the team's leads change who is on it.");
    expect(errorText("owner_fixed", "goal")).toBe("The goal's owner always keeps it. Change the owner from the goal's menu.");
    expect(errorText("above_own_role", "team")).toBe("Only Owners and Admins make someone a lead, or change or take off a lead.");
    expect(errorText("above_own_role", "tool")).toBe("You can give at most the access you hold.");
  });

  it("say what a person keeps by a rule that is not a place", () => {
    const via = { type: "rule" as const, text: "through the job title Onboarding lead" };
    expect(viaText(via)).toBe("through the job title Onboarding lead");
    expect(removalNotice(change({ stillReaches: { role: "EDIT", via } }), "Leo", "goal")).toBe("Removed. Leo still has Can check in through the job title Onboarding lead.");
    // Without the kind, the ladder's words, as every node has always read.
    expect(removalNotice(change({ stillReaches: { role: "EDIT", via } }), "Leo")).toBe("Removed. Leo still has Can edit through the job title Onboarding lead.");
    expect(removalNotice(change({ stillReaches: { role: "VIEW", via: { type: "owner" } } }), "Max", "tool")).toBe("Removed. Max still has Can view as the person who made it.");
  });

  it("word a kept role and a retry in the kind's words", () => {
    expect(keptHigherText(change({ noChange: true, role: "FULL" }), "Leo", "VIEW", "team")).toBe("Leo already has Lead, so it was kept.");
    expect(strayFailureText("Leo", "Not changed.", "VIEW", "team")).toBe("Leo: Not changed. Retry gives them Member.");
  });
});

describe("what a person is told", () => {
  it("joins a goal and a team, and shares a tool or an SOP folder", () => {
    expect(grantedNoticeText("goal", "Max", "Ship it", "EDIT", "shared")).toEqual({ title: "Max added you as a contributor on Ship it", message: "You can see the goal and check in on its targets." });
    expect(grantedNoticeText("team", "Mona", "Design", "VIEW", "shared")).toEqual({ title: "Mona added you to Design", message: "You are on this team." });
    expect(grantedNoticeText("team", "Mona", "Design", "FULL", "upgraded")).toEqual({ title: "Mona made you a lead of Design", message: "You are on this team as its Lead." });
    expect(grantedNoticeText("tool", "Max", "Figma", "EDIT", "shared")).toEqual({ title: "Max shared Figma with you", message: "Can edit on this Tool." });
    expect(grantedNoticeText("sop_folder", "Max", "HR", "FULL", "upgraded")).toEqual({ title: "Max gave you Full access on HR", message: "Full access on this SOP folder." });
  });

  it("says a lead changes members only when they can reach Members", () => {
    expect(panelRoleBlurb("team", "FULL")).toBe("On the team. A lead who can open Members adds and takes off its members.");
  });
});
