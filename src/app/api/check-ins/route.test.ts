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
// left it so) is read only by its person. Batch 8: POST writes only while
// the person holds a level in the session's workspace, under the locks a
// membership's end waits for; GET reads each part newest first, limited.

import { beforeEach, describe, expect, it, vi } from "vitest";
import { legacyLevelRow } from "@/lib/access/test-fixtures";

type Person = { id: string; organizationId: string; level: string; memberOf: string[]; deletedAt?: Date | null };
type Row = { id: string; userId: string; organizationId: string | null; mood: number; wentWell: string | null; challenges: string | null; tomorrow: string | null; createdAt: Date };

const st = vi.hoisted(() => ({
  people: {} as Record<string, { id: string; organizationId: string; level: string; memberOf: string[]; deletedAt?: Date | null }>,
  rows: [] as Array<{ id: string; userId: string; organizationId: string | null; mood: number; wentWell: string | null; challenges: string | null; tomorrow: string | null; createdAt: Date }>,
  created: [] as Array<Record<string, unknown>>,
  viewer: null as Record<string, unknown> | null,
  team: [] as string[],
  sessionUser: "me" as string | null,
  sessionOrg: "acme",
  /** Every check-in read: its where, order and limit (batch 8). */
  reads: [] as Array<{ where: Record<string, unknown>; orderBy: unknown; take: number }>,
  /** The write's statements in its transaction, in order (batch 8). */
  tx: [] as string[],
  /** Workspaces that exist, for the write's lock on the Organization row. */
  orgs: new Set<string>(),
  /** The lock that stays busy past its bound, if any. */
  busy: null as null | "Organization" | "OrganizationMembership",
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
      findMany: async (a: { where: Record<string, unknown>; take: number; orderBy: unknown }) => {
        st.reads.push({ where: a.where, orderBy: a.orderBy, take: a.take });
        // ORDER BY "createdAt" DESC LIMIT take, as Postgres answers it.
        return st.rows
          .filter((r) => matches(r, a.where))
          .sort((x, y) => y.createdAt.getTime() - x.createdAt.getTime())
          .slice(0, a.take)
          .map((r) => ({ ...r, user: { firstName: r.userId, lastName: "", avatar: null } }));
      },
      // A write outside a transaction (before batch 8), kept so the old code's answers can be compared.
      create: async (a: { data: Record<string, unknown> }) => {
        st.created.push(a.data);
        return { id: "new", ...a.data };
      },
    },
    // The write's one transaction (writeCheckIn): its locks, the person, the row.
    $transaction: async (fn: (tx: unknown) => unknown) => {
      const lockTimeout = () => Object.assign(new Error("canceling statement due to lock timeout"), { code: "55P03" });
      const tx = {
        $executeRaw: async (strings: TemplateStringsArray, ...values: unknown[]) => {
          st.tx.push(`${strings.join("?").replace(/\s+/g, " ").trim()} [${values.join(",")}]`);
          return 1;
        },
        $queryRaw: async (strings: TemplateStringsArray, ...values: unknown[]) => {
          const sql = strings.join("?").replace(/\s+/g, " ").trim();
          st.tx.push(`${sql} [${values.join(",")}]`);
          if (sql.includes('FROM "Organization"')) {
            if (st.busy === "Organization") throw lockTimeout();
            return st.orgs.has(values[0] as string) ? [{ id: values[0] }] : [];
          }
          if (sql.includes('FROM "OrganizationMembership"')) {
            if (st.busy === "OrganizationMembership") throw lockTimeout();
            const p = st.people[values[0] as string];
            return p && p.memberOf.includes(values[1] as string) ? [{ id: `m-${p.id}` }] : [];
          }
          throw new Error(`the mock can't answer ${sql}`);
        },
        user: {
          findUnique: async (a: { where: { id: string } }) => {
            st.tx.push(`user ${a.where.id}`);
            const p = st.people[a.where.id];
            return p ? { organizationId: p.organizationId, deletedAt: p.deletedAt ?? null } : null;
          },
        },
        checkIn: {
          create: async (a: { data: Record<string, unknown> }) => {
            st.tx.push("create");
            st.created.push(a.data);
            return { id: "new", ...a.data };
          },
        },
      };
      return fn(tx);
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
  st.reads = [];
  st.tx = [];
  st.orgs = new Set([ORG, "partner", "other", "globex"]);
  st.busy = null;
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
    // Dana's session in the partner workspace she is anchored in writes it there.
    signIn("dana", "MEMBER", {}, "partner");
    await post({ mood: 2 });
    expect(st.created[1]).toMatchObject({ userId: "dana", organizationId: "partner" });
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

// Docs-found fixes batch 8 (the batch 7 review): POST trusted the session's
// workspace, which a token keeps for up to 5 minutes after its person's
// membership ended (auth.ts REVALIDATE_MS), so someone the identity provider
// had just removed could still write a check-in there, readable by its
// Admins for good. Now the write holds a level there, decided under locks.
describe("POST /api/check-ins, only where the person still works", () => {
  it("refuses a session whose person no longer holds a level in its workspace, or whose account was removed, and writes nothing", async () => {
    // Dana worked in acme through a membership; the identity provider ended it, her token still says acme.
    st.people.dana.memberOf = [];
    signIn("dana", "MEMBER");
    expect(await post({ mood: 2, challenges: "Not sleeping" })).toEqual({ status: 403, body: { error: "You don't work in this workspace any more, so this check-in wasn't saved." } });
    // A removed (or erased) account.
    st.people.peer.deletedAt = new Date(Date.UTC(2026, 9, 12));
    signIn("peer", "MEMBER");
    expect((await post({ mood: 2 })).status).toBe(403);
    // A workspace deleted for good since.
    st.orgs.delete(ORG);
    signIn("me", "MEMBER");
    expect((await post({ mood: 2 })).status).toBe(403);
    expect(st.created).toEqual([]);
  });

  it("decides under the workspace's lock, then the membership's, in one transaction, every wait bounded, before it writes", async () => {
    signIn("dana", "MEMBER");
    expect((await post({ mood: 4 })).status).toBe(201);
    expect(st.tx).toEqual([
      "SELECT set_config('lock_timeout', ?, true) [3000ms]",
      'SELECT "id" FROM "Organization" WHERE "id" = ? FOR KEY SHARE [acme]',
      'SELECT "id" FROM "OrganizationMembership" WHERE "userId" = ? AND "organizationId" = ? FOR KEY SHARE [dana,acme]',
      "user dana",
      "create",
    ]);
    expect(st.created).toEqual([{ userId: "dana", organizationId: ORG, mood: 4, wentWell: null, challenges: null, tomorrow: null }]);
  });

  it("answers 503 when a lock stays busy, and writes nothing", async () => {
    for (const busy of ["Organization", "OrganizationMembership"] as const) {
      st.busy = busy;
      expect(await post({ mood: 3 })).toEqual({ status: 503, body: { error: "This workspace is busy for a moment, so your check-in wasn't saved. Try again." } });
    }
    expect(st.created).toEqual([]);
  });
});

// Docs-found fixes batch 8 (the batch 7 review's older low): an Admin's read
// was one OR with ORDER BY and LIMIT, which could only be planned as a sort
// of every check-in of the workspace.
describe("GET /api/check-ins, newest first in the database", () => {
  it("reads each part newest first and limited, an Admin's workspace part by its own column, and answers the newest 50 of them all", async () => {
    signIn("admin", "ADMIN");
    const at = (minute: number) => new Date(Date.UTC(2026, 9, 12, 9, minute));
    st.rows = [
      ...Array.from({ length: 60 }, (_, i) => ({ id: `w${String(i).padStart(2, "0")}`, userId: "peer", organizationId: ORG, mood: 3, wentWell: null, challenges: null, tomorrow: null, createdAt: at(i) })),
      // The Admin's own rows naming no workspace, between the workspace's.
      { id: "own-old", userId: "admin", organizationId: null, mood: 3, wentWell: null, challenges: null, tomorrow: null, createdAt: at(5) },
      { id: "own-new", userId: "admin", organizationId: null, mood: 3, wentWell: null, challenges: null, tomorrow: null, createdAt: at(30) },
    ];
    const { status, body } = await get();
    expect(status).toBe(200);
    expect(st.reads).toEqual([
      { where: { userId: "admin", organizationId: null }, orderBy: { createdAt: "desc" }, take: 50 },
      { where: { organizationId: ORG }, orderBy: { createdAt: "desc" }, take: 50 },
    ]);
    const ids = (body as Array<{ id: string }>).map((r) => r.id);
    expect(ids).toHaveLength(50);
    // Newest first across both parts: w59 down to w11, with own-new in its place; own-old (minute 5) is past the 50th.
    const expected = [...Array.from({ length: 60 }, (_, i) => ({ id: `w${String(i).padStart(2, "0")}`, m: i })), { id: "own-new", m: 30 }, { id: "own-old", m: 5 }]
      .sort((a, b) => b.m - a.m || (a.id < b.id ? 1 : -1))
      .slice(0, 50)
      .map((r) => r.id);
    expect(ids).toEqual(expected);
    expect(ids).toContain("own-new");
    expect(ids).not.toContain("own-old");
  });
});
