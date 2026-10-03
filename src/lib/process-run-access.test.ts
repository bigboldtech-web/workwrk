import { beforeEach, describe, expect, it, vi } from "vitest";
import { legacyTestSession } from "@/lib/access/test-fixtures";

const team = vi.fn();
const dotted = vi.fn();
let manager = false;
vi.mock("@/lib/api-helpers", () => ({ isManager: () => manager }));
vi.mock("@/lib/team", () => ({ getTeamUserIds: (...a: unknown[]) => team(...a) }));
vi.mock("@/lib/prisma", () => ({ prisma: { userDottedLine: { findMany: (a: unknown) => dotted(a) } } }));

import { canManageRun, mayGiveRunTo, runTeamIds } from "./process-run-access";

describe("canManageRun: who reads and changes a run", () => {
  beforeEach(() => {
    team.mockReset();
    dotted.mockReset();
    dotted.mockResolvedValue([]);
    manager = false;
  });

  it("lets a lead below manager level manage a run of someone in their report tree", async () => {
    team.mockResolvedValue(["lead", "report"]);
    expect(await canManageRun(legacyTestSession("lead", "EMPLOYEE"), "org", "lead", "report")).toBe(true);
  });

  it("counts a direct dotted-line report, as the shell's has-reports does", async () => {
    team.mockResolvedValue(["lead"]);
    dotted.mockResolvedValue([{ userId: "matrix" }]);
    expect(await canManageRun(legacyTestSession("lead", "EMPLOYEE"), "org", "lead", "matrix")).toBe(true);
    expect(dotted.mock.calls[0][0]).toEqual({ where: { managerId: "lead", user: { organizationId: "org", deletedAt: null } }, select: { userId: true } });
  });

  it("still refuses a run of someone outside the caller's tree", async () => {
    team.mockResolvedValue(["me"]);
    expect(await canManageRun(legacyTestSession("me", "EMPLOYEE"), "org", "me", "other")).toBe(false);
    manager = true;
    expect(await canManageRun(legacyTestSession("me", "MANAGER"), "org", "me", "other")).toBe(false);
  });

  it("the assignee and the org-wide roles always may, without walking the tree", async () => {
    expect(await canManageRun(legacyTestSession("me", "EMPLOYEE"), "org", "me", "me")).toBe(true);
    expect(await canManageRun(legacyTestSession("me", "HR"), "org", "me", "other")).toBe(true);
    expect(team).not.toHaveBeenCalled();
  });

  it("a link-shared run with no assignee stays with managers", async () => {
    expect(await canManageRun(legacyTestSession("me", "EMPLOYEE"), "org", "me", null)).toBe(false);
    manager = true;
    expect(await canManageRun(legacyTestSession("me", "MANAGER"), "org", "me", null)).toBe(true);
  });
});

describe("mayGiveRunTo: who a run can be started for or handed to", () => {
  beforeEach(() => {
    team.mockReset();
    dotted.mockReset();
    dotted.mockResolvedValue([]);
  });

  it("anyone for the org-wide roles, yourself for everyone", async () => {
    expect(await mayGiveRunTo(legacyTestSession("hr", "HR"), "org", "hr", "anyone")).toBe(true);
    expect(await mayGiveRunTo(legacyTestSession("me", "EMPLOYEE"), "org", "me", "me")).toBe(true);
    expect(team).not.toHaveBeenCalled();
  });

  it("otherwise only someone in the caller's report tree", async () => {
    team.mockResolvedValue(["lead", "report"]);
    expect(await mayGiveRunTo(legacyTestSession("lead", "MANAGER"), "org", "lead", "report")).toBe(true);
    expect(await mayGiveRunTo(legacyTestSession("lead", "MANAGER"), "org", "lead", "peer")).toBe(false);
  });

  it("runTeamIds is the solid tree and the direct dotted reports, once each", async () => {
    team.mockResolvedValue(["lead", "a"]);
    dotted.mockResolvedValue([{ userId: "a" }, { userId: "b" }]);
    expect((await runTeamIds("org", "lead")).sort()).toEqual(["a", "b", "lead"]);
  });
});
