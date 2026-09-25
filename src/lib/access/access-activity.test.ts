import { describe, expect, it } from "vitest";
import {
  ACCESS_ACTIVITY_TYPES, ACTIVITY_TARGET_TYPE, accessActivityDescription, accessAuditSentence, auditRoleLabel, isAccessActivityType,
} from "./access-activity";
import { ACCESS_NODE_KINDS } from "./access-panel";
import { FALLBACK_TARGET, targetFor } from "../activity-targets";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

describe("access activity rows", () => {
  it("every description names only the noun: no person, no email, no id", () => {
    for (const type of ACCESS_ACTIVITY_TYPES) {
      for (const kind of ACCESS_NODE_KINDS) {
        const text = accessActivityDescription(type, kind);
        expect(text).not.toMatch(/@|\bcm[a-z0-9]{10,}\b|\{|\}/);
        expect(text).not.toMatch(/—|--/);
        expect(text.length).toBeGreaterThan(10);
      }
    }
    expect(accessActivityDescription("access.granted", "folder")).toBe("Gave someone access to a Folder");
    expect(accessActivityDescription("access.role_changed", "folder")).toBe("Changed someone's access to a Folder");
    expect(accessActivityDescription("access.revoked", "folder")).toBe("Removed someone's access to a Folder");
    expect(accessActivityDescription("access.visibility_changed", "folder")).toBe("Changed who can open a Folder");
  });

  it("ACCESS_ACTIVITY_TYPES lists every type grants.ts writes", () => {
    const src = readFileSync(fileURLToPath(new URL("./grants.ts", import.meta.url)), "utf8");
    const written = [...src.matchAll(/"(access\.[a-z_.]+)"/g)].map((m) => m[1]);
    expect(written.length).toBeGreaterThan(0);
    for (const t of written) expect(isAccessActivityType(t), t).toBe(true);
  });

  it("every ACTIVITY_TARGET_TYPE resolves to a real row of activity-targets", () => {
    for (const kind of ACCESS_NODE_KINDS) {
      const def = targetFor(ACTIVITY_TARGET_TYPE[kind]);
      expect(def, kind).not.toBe(FALLBACK_TARGET);
    }
  });
});

describe("the audit line (accessAuditSentence)", () => {
  const facts = { kind: "doc" as const, nodeName: "Launch plan", granteeName: "Access Two", role: "EDIT", previousRole: null };
  it("says who got or lost what, on which node", () => {
    expect(accessAuditSentence("access.granted", facts)).toBe("Gave Access Two Can edit on the Doc Launch plan");
    expect(accessAuditSentence("access.role_changed", { ...facts, kind: "folder", role: "ADMIN", previousRole: "MEMBER" })).toBe("Changed Access Two from Can edit to Full access on the Folder Launch plan");
    expect(accessAuditSentence("access.revoked", { ...facts, kind: "space", role: null, previousRole: "OWNER" })).toBe("Removed Access Two (Owner) from the Space Launch plan");
    expect(accessAuditSentence("access.visibility_changed", { ...facts, kind: "list", granteeName: null, role: "PRIVATE", previousRole: "WORKSPACE" })).toBe("Changed who can open the List Launch plan from inherited to Restricted");
    expect(accessAuditSentence("access.visibility_changed", { ...facts, kind: "space", granteeName: null, role: "ORG", previousRole: "PRIVATE" })).toBe("Changed who can open the Space Launch plan from invite only to everyone at the organization");
    expect(accessAuditSentence("access.invited", { ...facts, kind: "space", granteeName: "new@acme.test", role: "OWNER" })).toBe("Invited new@acme.test by email as Owner to the Space Launch plan");
  });
  it("names a node the auditor cannot open by its noun only", () => {
    expect(accessAuditSentence("access.granted", { ...facts, nodeName: null })).toBe("Gave Access Two Can edit on a Doc");
  });
  it("reads every stored role in the dialog's words", () => {
    expect(["OWNER", "ADMIN", "MEMBER", "GUEST", "FULL", "COMMENT", "VIEW", "edit", "view"].map((r) => auditRoleLabel(r, "folder"))).toEqual([
      "Full access", "Full access", "Can edit", "Can view", "Full access", "Can comment", "Can view", "Can edit", "Can comment",
    ]);
    expect(auditRoleLabel("OWNER", "space")).toBe("Owner");
    expect(auditRoleLabel("odd", "doc")).toBeNull();
  });
  it("describes an email invitation by its noun", () => {
    expect(accessActivityDescription("access.invited", "space")).toBe("Invited someone by email to a Space");
  });
});
