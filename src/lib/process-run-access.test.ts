import { beforeEach, describe, expect, it, vi } from "vitest";
import { legacyTestSession } from "@/lib/access/test-fixtures";

const team = vi.fn();
let manager = false;
vi.mock("@/lib/api-helpers", () => ({ isManager: () => manager }));
vi.mock("@/lib/team", () => ({ getTeamUserIds: (...a: unknown[]) => team(...a) }));

import { canManageRun } from "./process-run-access";

describe("canManageRun: who reads and changes a run", () => {
  beforeEach(() => {
    team.mockReset();
    manager = false;
  });

  it("lets a lead below manager level manage a run of someone in their report tree", async () => {
    team.mockResolvedValue(["lead", "report"]);
    expect(await canManageRun(legacyTestSession("lead", "EMPLOYEE"), "org", "lead", "report")).toBe(true);
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
