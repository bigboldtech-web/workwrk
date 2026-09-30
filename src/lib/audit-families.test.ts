import { describe, expect, it } from "vitest";
import { actorLabelOf, familyWhere, rangeStart, typeInFamily } from "./audit-families";

describe("audit families", () => {
  it("files each type under its tab", () => {
    expect(typeInFamily("access.granted", "access")).toBe(true);
    expect(typeInFamily("login", "security")).toBe(true);
    expect(typeInFamily("mfa_enabled", "security")).toBe(true);
    expect(typeInFamily("data.exported", "data")).toBe(true);
    expect(typeInFamily("csv_exported", "data")).toBe(true);
    expect(typeInFamily("settings.updated.locale", "settings")).toBe(true);
    expect(typeInFamily("staff.plan.changed", "settings")).toBe(true);
    expect(typeInFamily("okr_created", "access")).toBe(false);
    expect(typeInFamily("anything", "all")).toBe(true);
  });
  it("does not let a bare word match a longer type", () => {
    expect(typeInFamily("login_failed_elsewhere", "security")).toBe(false);
    expect(typeInFamily("logout", "security")).toBe(true);
  });
  it("builds a server condition", () => {
    expect(familyWhere("all")).toBeNull();
    expect(familyWhere("data")?.OR).toContainEqual({ type: { startsWith: "data." } });
  });
  it("turns presets into a lower bound", () => {
    const now = new Date("2026-09-30T15:00:00Z");
    expect(rangeStart("7d", now)?.toISOString()).toBe("2026-09-23T15:00:00.000Z");
    expect(rangeStart("forever", now)).toBeNull();
  });
  it("names non-person actors", () => {
    expect(actorLabelOf({ actorType: "platform_staff", actorLabel: "WorkwrK Support", actor: null })).toBe("WorkwrK Support");
    expect(actorLabelOf({ actorType: "scim", actor: null })).toBe("Identity provider");
    expect(actorLabelOf({ actor: { firstName: "Ana", lastName: "Li" } })).toBe("Ana Li");
  });
});

import { humanizeAuditSentence } from "./audit-families";
describe("humanizeAuditSentence", () => {
  it("prints level words, never the enum", () => {
    expect(humanizeAuditSentence("Invited ana@acme.com as EMPLOYEE")).toBe("Invited ana@acme.com as Member");
    expect(humanizeAuditSentence("Changed COMPANY_ADMIN to SUPER_ADMIN")).toBe("Changed Admin to Owner");
    expect(humanizeAuditSentence("Joined the HR team")).toBe("Joined the HR team");
    expect(humanizeAuditSentence("hr@acme.com signed in")).toBe("hr@acme.com signed in");
  });
});

import { auditKeyWords, auditValueWords, targetTypeWord } from "./audit-families";

describe("audit words", () => {
  it("names target types in words", () => {
    expect(targetTypeWord("user")).toBe("Person");
    expect(targetTypeWord("scim_token")).toBe("SCIM token");
    expect(targetTypeWord("Organization")).toBe("Workspace");
    expect(targetTypeWord("SomethingNew")).toBe("Something new");
  });
  it("turns enums into words", () => {
    expect(auditValueWords("ACTIVE")).toBe("Active");
    expect(auditValueWords("COMPANY_ADMIN")).toBe("Admin");
    expect(auditValueWords("OWNER")).toBe("Owner");
    expect(auditValueWords(true)).toBe("On");
    expect(auditValueWords(undefined)).toBe("·");
    expect(auditKeyWords("inviteExpiryDays")).toBe("Invite expiry days");
    expect(auditKeyWords("level")).toBe("Tier");
  });
});
