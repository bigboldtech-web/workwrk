import { describe, expect, it } from "vitest";
import { actorLabelOf, familyWhere, rangeStart, targetTypeWord, typeInFamily } from "./audit-families";

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

// The MCP server (docs/plans/mcp-server.md 7, step 4 tests "audit-families:
// the families and the via label"). Fails on the code before step 4: the
// mcp.* types fell in no tab but All, and a change an app made as a person
// named only the person.
describe("the MCP server's rows", () => {
  it("files each change an app made under Data, and its connections under Security", () => {
    for (const t of ["mcp.tool.create_task", "mcp.tool.update_task", "mcp.tool.move_task", "mcp.tool.add_comment", "mcp.tool.create_doc", "mcp.tool.append_to_doc", "mcp.tool.create_reminder", "mcp.tool.give_kudos"]) {
      expect(typeInFamily(t, "data"), t).toBe(true);
      expect(typeInFamily(t, "security"), t).toBe(false);
    }
    for (const t of ["mcp.app.connected", "mcp.app.revoked", "mcp.app.reuse_detected"]) {
      expect(typeInFamily(t, "security"), t).toBe(true);
      expect(typeInFamily(t, "data"), t).toBe(false);
    }
    expect(familyWhere("data")?.OR).toContainEqual({ type: { startsWith: "mcp.tool." } });
    expect(familyWhere("security")?.OR).toContainEqual({ type: { startsWith: "mcp.app." } });
    // A guard: the switch's own row was already a Settings row (apps.).
    expect(typeInFamily("apps.mcp_changed", "settings")).toBe(true);
  });

  it("names the person and the app for a change an app made as them", () => {
    expect(actorLabelOf({ actorType: "mcp", actorLabel: "Claude (MCP)", actor: { firstName: "Max", lastName: "Member", email: "max@acme.test" } })).toBe("Max Member via Claude (MCP)");
    expect(actorLabelOf({ actorType: "mcp", actorLabel: "an app on this computer (MCP)", actor: { firstName: null, lastName: null, email: "max@acme.test" } })).toBe("max@acme.test via an app on this computer (MCP)");
    // Guards: the app alone once the person is gone, and a person's own row as before.
    expect(actorLabelOf({ actorType: "mcp", actorLabel: "Claude (MCP)", actor: null })).toBe("Claude (MCP)");
    expect(actorLabelOf({ actorType: "user", actorLabel: "ignored", actor: { firstName: "Ana", lastName: "Li" } })).toBe("Ana Li");
  });

  it("names a task and an app connection as targets", () => {
    expect(targetTypeWord("item")).toBe("Task");
    expect(targetTypeWord("oauth_grant")).toBe("AI app connection");
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

import { auditKeyWords, auditValueWords } from "./audit-families";

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
