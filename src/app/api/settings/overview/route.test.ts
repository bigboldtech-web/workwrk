import { beforeEach, describe, expect, it, vi } from "vitest";

// The Overview's Access card names the People team with the SAME count that
// Structure, Members and Access show (roleCountsFor): the saved list when
// there is one, else everyone at HR, who hold People team powers today. It
// used to count only the saved list, so a workspace with one HR person and
// no list read "People team: 0 people named" on Overview and "People team 1"
// everywhere else. The database and the session are mocked so the handler
// runs as the pure function it is between those calls.

// vi.hoisted: the mock factories below run before this module's own
// top-level code, so the fake client is built inside the hoisted block.
const { prismaMock, orgRow } = vi.hoisted(() => {
  const orgRow: { settings: unknown } = { settings: null };
  const hrIds = ["hr1"];
  const model = () => ({
    count: vi.fn(async () => 0),
    findUnique: vi.fn(async () => null),
    findFirst: vi.fn(async () => null),
    findMany: vi.fn(async () => [] as unknown[]),
  });
  const prismaMock = {
    organization: { ...model(), findUnique: vi.fn(async () => ({ name: "Acme Corp", plan: "GROWTH", status: "ACTIVE", logo: null, settings: orgRow.settings })) },
    orgPreference: model(),
    user: {
      ...model(),
      findMany: vi.fn(async (args: { where?: { accessLevel?: unknown } }) =>
        args?.where?.accessLevel === "HR" ? hrIds.map((id) => ({ id })) : [],
      ),
    },
    invitation: model(),
    department: model(),
    role: model(),
    office: model(),
    itemType: model(),
    tag: model(),
    productInstallation: model(),
    apiKey: model(),
    webhookSubscription: model(),
    activityLog: model(),
  };
  return { prismaMock, orgRow };
});

vi.mock("next-auth", () => ({ getServerSession: vi.fn() }));
vi.mock("@/lib/auth", () => ({ authOptions: {} }));
vi.mock("@/lib/prisma", () => ({ prisma: prismaMock }));
vi.mock("@/lib/access/workspace-admin", () => ({
  sessionIsWorkspaceAdmin: () => true,
  sessionMayManageOwnerPage: async () => true,
}));

import { getServerSession } from "next-auth";
import { GET } from "./route";

async function accessCard(): Promise<[string, string]> {
  const res = await GET();
  const body = await res.json();
  return body.cards.access;
}

describe("GET /api/settings/overview People team count", () => {
  beforeEach(() => {
    vi.mocked(getServerSession).mockResolvedValue({ user: { id: "u1", organizationId: "org1", accessLevel: "COMPANY_ADMIN" } } as never);
  });

  it("counts everyone at HR level when no list is saved, like Structure and Members", async () => {
    orgRow.settings = {};
    const [peopleTeam] = await accessCard();
    expect(peopleTeam).toBe("People team: 1 person (everyone at HR level)");
  });

  it("counts the saved list when there is one", async () => {
    orgRow.settings = { access: { peopleTeamUserIds: ["a", "b"] } };
    const [peopleTeam] = await accessCard();
    expect(peopleTeam).toBe("People team: 2 people named");
  });
});
