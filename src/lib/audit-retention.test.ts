import { describe, expect, it } from "vitest";
import { auditPurgeMayDelete, auditPurgeWhere } from "./audit-retention";

describe("audit retention keep list", () => {
  it("keeps the rows features read back", () => {
    for (const t of ["weekly_review_decided", "okr_created", "user.invited", "access.invited", "access.matrix_retired", "terms.accepted", "staff.company.suspended", "audit.purged"]) {
      expect(auditPurgeMayDelete(t)).toBe(false);
    }
  });
  it("purges ordinary history", () => {
    for (const t of ["login", "org_role.changed", "membership.changed", "task.updated"]) expect(auditPurgeMayDelete(t)).toBe(true);
  });
  it("builds a filter that excludes the keep list", () => {
    const w = auditPurgeWhere("o1", new Date(0));
    expect(w.organizationId).toBe("o1");
    expect((w.type as { notIn: string[] }).notIn).toContain("okr_created");
    expect(Array.isArray(w.NOT)).toBe(true);
  });
});
