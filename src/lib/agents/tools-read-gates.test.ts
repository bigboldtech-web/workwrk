// Ask AI reads exactly what the person could open, for SOPs and meetings.
//
// search_sops listed every SOP in the workspace (drafts and restricted
// folders included) and search_meetings returned every meeting (other
// people's one to ones, with agenda and attendees, deleted ones too). Both
// now apply the page's own rule, with the caller's level read fresh. The
// database is mocked: the test reads the query each tool sends.

import { beforeEach, describe, expect, it, vi } from "vitest";
import { legacyLevelOf, legacyLevelRow } from "@/lib/access/test-fixtures";

let level: string | null;
let meetingWhere: Record<string, unknown> | null;
let sopWhere: Record<string, unknown> | null;

vi.mock("@/lib/prisma", () => ({
  prisma: {
    user: { findFirst: async () => (level ? legacyLevelRow(level) : null) },
    meeting: { findMany: async (args: { where: Record<string, unknown> }) => { meetingWhere = args.where; return []; } },
    sOP: { findMany: async (args: { where: Record<string, unknown> }) => { sopWhere = args.where; return []; } },
  },
}));
vi.mock("@/lib/sop-access", () => ({
  sopVisibilityWhere: async (s: { user: { accessLevel?: string } }) => (legacyLevelOf(s) === "COMPANY_ADMIN" ? {} : { OR: [{ visibleTo: "u-1" }] }),
}));
vi.mock("@/lib/api-helpers", () => ({
  hasPermission: async () => true,
  isOrgAdmin: (s: { user: { accessLevel?: string } }) => ["COMPANY_ADMIN", "SUPER_ADMIN"].includes(legacyLevelOf(s)),
}));

const { TOOLS } = await import("./tools");
const ctx = { orgId: "org-1", userId: "u-1" };

beforeEach(() => {
  level = "EMPLOYEE";
  meetingWhere = null;
  sopWhere = null;
});

describe("search_meetings", () => {
  it("an employee reads only meetings they made or attend, and never a deleted one", async () => {
    await TOOLS.search_meetings.handler(ctx, {});
    expect(meetingWhere).toMatchObject({ organizationId: "org-1", deletedAt: null, OR: [{ createdById: "u-1" }, { attendees: { some: { userId: "u-1" } } }] });
  });

  it("an org admin reads every meeting, still never a deleted one", async () => {
    level = "COMPANY_ADMIN";
    await TOOLS.search_meetings.handler(ctx, {});
    expect(meetingWhere).toMatchObject({ organizationId: "org-1", deletedAt: null });
    expect(meetingWhere).not.toHaveProperty("OR");
  });

  it("a person no longer in the workspace reads nothing", async () => {
    level = null;
    expect(await TOOLS.search_meetings.handler(ctx, {})).toEqual({ count: 0, meetings: [] });
    expect(meetingWhere).toBeNull();
  });
});

describe("search_sops", () => {
  it("applies the SOP list's visibility rule beside every other filter", async () => {
    await TOOLS.search_sops.handler(ctx, { query: "onboarding" });
    expect(sopWhere).toMatchObject({ organizationId: "org-1", AND: [{ OR: [{ visibleTo: "u-1" }] }] });
    expect(sopWhere?.OR).toEqual([{ title: { contains: "onboarding", mode: "insensitive" } }, { description: { contains: "onboarding", mode: "insensitive" } }]);
  });

  it("a person no longer in the workspace reads nothing", async () => {
    level = null;
    expect(await TOOLS.search_sops.handler(ctx, {})).toEqual({ count: 0, sops: [] });
    expect(sopWhere).toBeNull();
  });
});
