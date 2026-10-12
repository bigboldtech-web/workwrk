// GET and POST /api/check-ins. Docs-found fixes batch 5: GET listed the 50
// newest check-ins of ANY member of the workspace (mood, what went well,
// challenges, tomorrow) to anyone signed in, and ?userId= picked any person.
// Now it holds to the people-data ladder (src/lib/check-in-access.server.ts),
// with "in this workspace" read as the level a person holds here. The engine
// pieces are the real ones (person-access.server.ts relationTo,
// acting-workspace.ts levelHeldIn); the database is a small in-memory one
// that answers the where clauses the way Postgres would. Batch 6: a check-in
// names the workspace it was written in, and is read only there. Batch 7: by
// that column alone; a row still naming no workspace (the one-time backfill
// left it so) is read only by its person.

import { beforeEach, describe, expect, it, vi } from "vitest";
import { legacyLevelRow } from "@/lib/access/test-fixtures";

type Person = { id: string; organizationId: string; level: string; memberOf: string[] };
type Row = { id: string; userId: string; organizationId: string | null; mood: number; wentWell: string | null; challenges: string | null; tomorrow: string | null; createdAt: Date };

const st = vi.hoisted(() => ({
  people: {} as Record<string, { id: string; organizationId: string; level: string; memberOf: string[] }>,
  rows: [] as Array<{ id: string; userId: string; organizationId: string | null; mood: number; wentWell: string | null; challenges: string | null; tomorrow: string | null; createdAt: Date }>,
  created: [] as Array<Record<string, unknown>>,
  viewer: null as Record<string, unknown> | null,
  team: [] as string[],
  sessionUser: "me" as string | null,
  sessionOrg: "acme",
}));

/** A where clause of the check-in reads, answered as Postgres would. */
function matches(row: Row, where: Record<string, unknown>): boolean {
  return Object.entries(where).every(([k, v]) => {
    if (k === "OR") return (v as Array<Record<string, unknown>>).some((w) => matches(row, w));
    if (k === "AND") return (v as Array<Record<string, unknown>>).every((w) => matches(row, w));
    if (k === "userId") return typeof v === "string" ? row.userId === v : (v as { in: string[] }).in.includes(row.userId);
    if (k === "organizationId") return row.organizationId === v;
    if (k === "user") return userMatches(st.people[row.userId], v as Record<string, unknown>);
    if (k === "createdAt") return row.createdAt >= (v as { gte: Date }).gte;
    if (k === "mood") return row.mood <= (v as { lte: number }).lte;
    throw new Error(`the mock can't read ${k}`);
  });
}
function userMatches(p: Person | undefined, where: Record<string, unknown>): boolean {
  if (!p) return false;
  return Object.entries(where).every(([k, v]) => {
    if (k === "OR") return (v as Array<Record<string, unknown>>).some((w) => userMatches(p, w));
    if (k === "organizationId") return p.organizationId === v;
    if (k === "organizationMemberships") {
      const m = v as { some?: { organizationId: string }; every?: { organizationId: string } };
      if (m.some) return p.memberOf.includes(m.some.organizationId);
      if (m.every) return p.memberOf.every((o) => o === m.every!.organizationId);
    }
    throw new Error(`the mock can't read user.${k}`);
  });
}

vi.mock("server-only", () => ({}));
vi.mock("next-auth", () => ({ getServerSession: async () => (st.sessionUser ? { user: { id: st.sessionUser, organizationId: st.sessionOrg } } : null) }));
vi.mock("@/lib/auth", () => ({ authOptions: {} }));
vi.mock("@/lib/access/viewer", () => ({ viewerFromSession: async () => st.viewer }));
vi.mock("@/lib/team", () => ({ getTeamUserIds: async () => st.team }));
vi.mock("@/lib/prisma", () => ({
  prisma: {
    user: {
      findUnique: async (a: { where: { id: string } }) => {
        const p = st.people[a.where.id];
        return p ? { organizationId: p.organizationId, ...legacyLevelRow(p.level) } : null;
      },
    },
    organizationMembership: {
      findUnique: async (a: { where: { userId_organizationId: { userId: string; organizationId: string } } }) => {
        const p = st.people[a.where.userId_organizationId.userId];
        return p && p.memberOf.includes(a.where.userId_organizationId.organizationId) ? { role: p.level } : null;
      },
    },
    checkIn: {
      findMany: async (a: { where: Record<string, unknown>; take: number }) =>
        st.rows.filter((r) => matches(r, a.where)).slice(0, a.take).map((r) => ({ ...r, user: { firstName: r.userId, lastName: "", avatar: null } })),
      create: async (a: { data: Record<string, unknown> }) => {
        st.created.push(a.data);
        return { id: "new", ...a.data };
      },
    },
  },
}));

import { GET, POST } from "./route";

const ORG = "acme";
const get = async (query = "") => {
  const res = await GET(new Request(`https://app.test/api/check-ins${query}`) as never);
  return { status: res.status, body: await res.json() };
};
const post = async (body: unknown) => {
  const res = await POST(new Request("https://app.test/api/check-ins", { method: "POST", body: typeof body === "string" ? body : JSON.stringify(body) }) as never);
  return { status: res.status, body: await res.json() };
};
const whose = (body: Array<{ userId: string }>) => [...new Set(body.map((r) => r.userId))].sort();
/** The signed-in person as the engine reads them in acme (or the workspace named). */
const signIn = (userId: string, orgRole: string, over: Record<string, unknown> = {}, org = ORG) => {
  st.viewer = { userId, organizationId: org, orgRole, isAgent: false, adminScopes: [], reportTree: new Set<string>(), peopleTeam: false, ...over };
  st.sessionUser = userId;
  st.sessionOrg = org;
};

beforeEach(() => {
  st.people = {
    me: { id: "me", organizationId: ORG, level: "EMPLOYEE", memberOf: [] },
    peer: { id: "peer", organizationId: ORG, level: "EMPLOYEE", memberOf: [] },
    boss: { id: "boss", organizationId: ORG, level: "MANAGER", memberOf: [] },
    rep: { id: "rep", organizationId: ORG, level: "EMPLOYEE", memberOf: [] },
    admin: { id: "admin", organizationId: ORG, level: "COMPANY_ADMIN", memberOf: [] },
    // Works in acme through a membership: anchored in the partner workspace she switched to once.
    dana: { id: "dana", organizationId: "partner", level: "EMPLOYEE", memberOf: [ORG] },
    // Another company's person, with no level in acme.
    out: { id: "out", organizationId: "other", level: "EMPLOYEE", memberOf: [] },
  };
  // Each written in acme, the workspace the session acted in, by everyone
  // who holds a level there; another company's person wrote theirs in their
  // own (a session acts only where its person holds a level, so no row of
  // acme is anyone else's). Other rows are added where a test needs them.
  st.rows = Object.keys(st.people).map((userId, i) => ({ id: `c-${userId}`, userId, organizationId: userId === "out" ? "other" : ORG, mood: 1 + (i % 5), wentWell: null, challenges: `${userId}'s challenges`, tomorrow: null, createdAt: new Date(Date.UTC(2026, 9, 1 + i)) }));
  st.created = [];
  st.team = [];
  signIn("me", "MEMBER");
});

describe("GET /api/check-ins", () => {
  it("lists only a colleague's own check-ins, and never a peer's, by list or by ?userId=", async () => {
    expect(whose((await get()).body)).toEqual(["me"]);
    expect(await get("?userId=peer")).toEqual({ status: 404, body: { error: "Not found" } });
    const own = await get("?userId=me");
    expect(own.status).toBe(200);
    expect(whose(own.body)).toEqual(["me"]);
  });

  it("lets a manager read their report's, never anyone else's", async () => {
    signIn("boss", "MEMBER", { reportTree: new Set(["rep"]) });
    st.team = ["rep"];
    expect(whose((await get()).body)).toEqual(["boss", "rep"]);
    expect(whose((await get("?userId=rep")).body)).toEqual(["rep"]);
    expect((await get("?userId=peer")).status).toBe(404);
  });

  it("lets an Admin read everyone who holds a level here, a member anchored elsewhere included, and nobody else", async () => {
    signIn("admin", "ADMIN");
    expect(whose((await get()).body)).toEqual(["admin", "boss", "dana", "me", "peer", "rep"]);
    expect(whose((await get("?userId=dana")).body)).toEqual(["dana"]);
    // Another company's person: no level here, so not found, never their rows.
    expect((await get("?userId=out")).status).toBe(404);
  });

  it("gives an Agent and a Guest their own only, whatever lines still name them", async () => {
    signIn("boss", "MEMBER", { isAgent: true, reportTree: new Set(["rep"]) });
    st.people.boss.level = "AGENT";
    st.team = ["rep"];
    expect(whose((await get()).body)).toEqual(["boss"]);
    expect((await get("?userId=rep")).status).toBe(404);
    signIn("me", "GUEST");
    expect(whose((await get()).body)).toEqual(["me"]);
    expect((await get("?userId=peer")).status).toBe(404);
  });

  it("answers 401 signed out", async () => {
    st.viewer = null;
    expect((await get()).status).toBe(401);
  });
});

// Docs-found fixes batch 6, the review's scenario: Dana is anchored in Acme
// and works in the client workspace Globex too. A check-in named no
// workspace, so every Globex Admin read her Acme check-ins.
describe("GET /api/check-ins, one workspace's rows", () => {
  beforeEach(() => {
    st.people.dana = { id: "dana", organizationId: ORG, level: "EMPLOYEE", memberOf: ["globex"] };
    st.people.gia = { id: "gia", organizationId: "globex", level: "COMPANY_ADMIN", memberOf: [] };
    st.people.solo = { id: "solo", organizationId: ORG, level: "EMPLOYEE", memberOf: [] };
    // Worked in Acme and Globex; Acme's hard delete took her Acme membership, so she holds a level in Globex alone.
    st.people.lea = { id: "lea", organizationId: "globex", level: "EMPLOYEE", memberOf: [] };
    const row = (id: string, userId: string, organizationId: string | null) => ({ id, userId, organizationId, mood: 1, wentWell: null, challenges: `${id}`, tomorrow: null, createdAt: new Date(Date.UTC(2026, 9, 20)) });
    st.rows = [
      row("dana-acme", "dana", ORG),
      row("dana-old", "dana", null),
      row("dana-globex", "dana", "globex"),
      row("solo-old", "solo", null),
      row("gia-globex", "gia", "globex"),
      row("lea-old", "lea", null),
    ];
  });
  const ids = (body: Array<{ id: string }>) => body.map((r) => r.id).sort();

  it("gives another workspace's Admin none of a person's check-ins written elsewhere, by list or by ?userId=", async () => {
    signIn("gia", "ADMIN", {}, "globex");
    expect(ids((await get()).body)).toEqual(["dana-globex", "gia-globex"]);
    expect(ids((await get("?userId=dana")).body)).toEqual(["dana-globex"]);
  });

  // Docs-found fixes batch 7 (the batch 6 review): the older-row rule was
  // asked on every read, so Acme's hard delete gave Lea's older Acme rows to
  // Globex. A row the backfill left naming no workspace is its person's.
  it("reads a row still naming no workspace only for its person, wherever they work, whatever was deleted since", async () => {
    signIn("admin", "ADMIN");
    expect(ids((await get()).body)).toEqual(["dana-acme"]);
    expect(ids((await get("?userId=solo")).body)).toEqual([]);
    expect(ids((await get("?userId=dana")).body)).toEqual(["dana-acme"]);
    signIn("gia", "ADMIN", {}, "globex");
    expect(ids((await get()).body)).toEqual(["dana-globex", "gia-globex"]);
    expect(ids((await get("?userId=lea")).body)).toEqual([]);
    signIn("solo", "MEMBER");
    expect(ids((await get()).body)).toEqual(["solo-old"]);
    signIn("lea", "MEMBER", {}, "globex");
    expect(ids((await get()).body)).toEqual(["lea-old"]);
    signIn("dana", "MEMBER", {}, "globex");
    expect(ids((await get()).body)).toEqual(["dana-globex", "dana-old"]);
    signIn("dana", "MEMBER");
    expect(ids((await get("?userId=dana")).body)).toEqual(["dana-acme", "dana-old"]);
  });
});

describe("POST /api/check-ins", () => {
  it("writes the caller's own check-in, whoever the body names, in the workspace the session acts in", async () => {
    const res = await post({ mood: 4, wentWell: "Shipped it", userId: "peer", organizationId: "other" });
    expect(res.status).toBe(201);
    expect(st.created).toEqual([{ userId: "me", organizationId: ORG, mood: 4, wentWell: "Shipped it", challenges: null, tomorrow: null }]);
    signIn("dana", "MEMBER", {}, "globex");
    await post({ mood: 2 });
    expect(st.created[1]).toMatchObject({ userId: "dana", organizationId: "globex" });
  });

  it("refuses a mood that is not a whole number from 1 to 5, a text that is not text or too long, and writes nothing", async () => {
    for (const body of [{ mood: "3" }, { mood: 2.5 }, { mood: 0 }, { mood: 6 }, { mood: null }, {}, { mood: 3, challenges: 7 }, { mood: 3, tomorrow: "x".repeat(2001) }, [3], "not json"]) {
      const res = await post(body);
      expect(res.status, JSON.stringify(body)).toBe(400);
    }
    expect(st.created).toEqual([]);
    expect((await post({ mood: 3, tomorrow: "x".repeat(2000) })).status).toBe(201);
  });
});
