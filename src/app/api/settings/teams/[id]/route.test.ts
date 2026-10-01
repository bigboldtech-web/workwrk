import { beforeEach, describe, expect, it, vi } from "vitest";

// Renaming a team to an ARCHIVED team's name. Archived teams cannot be seen
// or restored anywhere, and POST /api/settings/teams lets the same name
// through (it revives the archived row), so PATCH used to refuse with a
// "name_taken" 409 nobody could explain. Now only a live team holds a name:
// the archived row gives its name up inside the same transaction, so the
// @@unique([organizationId, name]) index never throws. The fake client below
// enforces that index exactly (case-sensitive, like Postgres) so a fix that
// only skipped the clash check would still fail here with P2002.

type TeamRow = { id: string; organizationId: string; name: string; description: string | null; archivedAt: Date | null };

const { prismaMock, store, activity } = vi.hoisted(() => {
  const store: { teams: TeamRow[] } = { teams: [] };
  const activity: { metadata?: Record<string, unknown> }[] = [];
  const nameMatches = (row: TeamRow, f?: { equals: string; mode?: string }) =>
    !f || (f.mode === "insensitive" ? row.name.toLowerCase() === f.equals.toLowerCase() : row.name === f.equals);
  type Where = { id?: string | { not: string }; organizationId?: string; archivedAt?: null | { not: null }; name?: { equals: string; mode?: string } };
  const matches = (row: TeamRow, w: Where) =>
    (w.id === undefined || (typeof w.id === "string" ? row.id === w.id : row.id !== w.id.not)) &&
    (w.organizationId === undefined || row.organizationId === w.organizationId) &&
    (w.archivedAt === undefined || (w.archivedAt === null ? row.archivedAt === null : row.archivedAt !== null)) &&
    nameMatches(row, w.name);
  const assertUnique = (row: TeamRow) => {
    if (store.teams.some((t) => t !== row && t.organizationId === row.organizationId && t.name === row.name)) {
      throw Object.assign(new Error("Unique constraint failed"), { code: "P2002" });
    }
  };
  const team = {
    findFirst: vi.fn(async ({ where }: { where: Where }) => store.teams.find((t) => matches(t, where)) ?? null),
    findMany: vi.fn(async ({ where }: { where: Where }) => store.teams.filter((t) => matches(t, where))),
    update: vi.fn(async ({ where, data }: { where: { id: string }; data: Partial<TeamRow> }) => {
      const row = store.teams.find((t) => t.id === where.id);
      if (!row) throw Object.assign(new Error("Not found"), { code: "P2025" });
      const next = { ...row, ...data };
      assertUnique(next as TeamRow);
      Object.assign(row, data);
      return row;
    }),
    updateMany: vi.fn(async ({ where, data }: { where: Where; data: Partial<TeamRow> }) => {
      const rows = store.teams.filter((t) => matches(t, where));
      for (const row of rows) {
        assertUnique({ ...row, ...data } as TeamRow);
        Object.assign(row, data);
      }
      return { count: rows.length };
    }),
  };
  const prismaMock = {
    team,
    teamMember: { upsert: vi.fn(async () => ({})), deleteMany: vi.fn(async () => ({ count: 0 })) },
    user: { count: vi.fn(async () => 0) },
    $transaction: vi.fn(async (fn: (tx: unknown) => Promise<unknown>) => fn(prismaMock)),
  };
  return { prismaMock, store, activity };
});

vi.mock("next-auth", () => ({ getServerSession: vi.fn() }));
vi.mock("@/lib/auth", () => ({ authOptions: {} }));
vi.mock("@/lib/prisma", () => ({ prisma: prismaMock }));
vi.mock("@/lib/access/workspace-admin", () => ({ sessionIsWorkspaceAdmin: () => true }));
vi.mock("@/lib/access/settings-write", () => ({ settingsWriteGate: async () => ({ ok: true }) }));
vi.mock("@/lib/activity", () => ({ logActivity: vi.fn(async (row: { metadata?: Record<string, unknown> }) => void activity.push(row)) }));

import { getServerSession } from "next-auth";
import { PATCH } from "./route";

async function rename(id: string, name: string): Promise<Response> {
  const req = new Request(`http://x/api/settings/teams/${id}`, { method: "PATCH", body: JSON.stringify({ name }) });
  const res = await PATCH(req, { params: Promise.resolve({ id }) });
  if (!res) throw new Error("PATCH gave no response");
  return res;
}

const ARCHIVED_ID = "cmarchived000000000abc123";

describe("PATCH /api/settings/teams/:id rename over an archived name", () => {
  beforeEach(() => {
    vi.mocked(getServerSession).mockResolvedValue({ user: { id: "u1", organizationId: "org1", accessLevel: "COMPANY_ADMIN" } } as never);
    activity.length = 0;
    store.teams = [
      { id: "design", organizationId: "org1", name: "Walk Design", description: null, archivedAt: null },
      { id: ARCHIVED_ID, organizationId: "org1", name: "Walk Old", description: null, archivedAt: new Date("2026-09-30T00:00:00Z") },
      { id: "live", organizationId: "org1", name: "Walk Live", description: null, archivedAt: null },
      { id: "other-org", organizationId: "org2", name: "Elsewhere", description: null, archivedAt: null },
    ];
  });

  it("lets the rename through and frees the archived team's name", async () => {
    const res = await rename("design", "Walk Old");
    expect(res.status).toBe(200);
    expect(store.teams.find((t) => t.id === "design")?.name).toBe("Walk Old");
    const archived = store.teams.find((t) => t.id === ARCHIVED_ID)!;
    expect(archived.name).toBe("Walk Old (archived abc123)");
    expect(archived.archivedAt).not.toBeNull();
    expect(activity[0]?.metadata?.freedArchivedTeamIds).toEqual([ARCHIVED_ID]);
  });

  it("frees an archived name that differs only in case", async () => {
    const res = await rename("design", "walk old");
    expect(res.status).toBe(200);
    expect(store.teams.find((t) => t.id === "design")?.name).toBe("walk old");
    expect(store.teams.find((t) => t.id === ARCHIVED_ID)?.name).toBe("Walk Old (archived abc123)");
  });

  it("keeps the freed name inside the 80-character limit", async () => {
    const long = "L".repeat(80);
    store.teams.find((t) => t.id === ARCHIVED_ID)!.name = long;
    const res = await rename("design", long);
    expect(res.status).toBe(200);
    const freed = store.teams.find((t) => t.id === ARCHIVED_ID)!.name;
    expect(freed.length).toBeLessThanOrEqual(80);
    expect(freed.endsWith(" (archived abc123)")).toBe(true);
  });

  it("still refuses a LIVE team's name with 409 and changes nothing", async () => {
    const res = await rename("design", "walk live");
    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({ error: "name_taken", key: "name" });
    expect(store.teams.find((t) => t.id === "design")?.name).toBe("Walk Design");
    expect(store.teams.find((t) => t.id === ARCHIVED_ID)?.name).toBe("Walk Old");
  });

  it("answers 409 when another Admin revived the archived team mid-rename", async () => {
    // The clash read sees it archived, then it is revived before the write.
    prismaMock.team.findMany.mockImplementationOnce(async () => {
      const rows = store.teams.filter((t) => t.id === ARCHIVED_ID).map((t) => ({ ...t }));
      store.teams.find((t) => t.id === ARCHIVED_ID)!.archivedAt = null;
      return rows;
    });
    const res = await rename("design", "Walk Old");
    expect(res.status).toBe(409);
    expect(store.teams.find((t) => t.id === ARCHIVED_ID)?.name).toBe("Walk Old");
  });
});
