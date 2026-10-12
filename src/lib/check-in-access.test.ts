// The check-in read rule (src/lib/check-in-access.server.ts, docs-found fixes
// batch 5): the list's where and the one-person ladder (relationTo) must
// agree for every viewer shape, so a list never holds a row that reading
// that person alone would refuse, and never misses one it would allow.
// Batch 6: and each row only in the workspace it belongs to. Batch 7: by the
// row's own column alone, settled once: a row still naming no workspace is
// read only by its person, wherever they work, and no read asks anything
// about the person (no User filter, no membership sublink).

import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";
import { legacyLevelRow } from "@/lib/access/test-fixtures";

vi.mock("server-only", () => ({}));
vi.mock("@/lib/access/viewer", () => ({ viewerFromSession: async () => null }));
vi.mock("@/lib/team", () => ({ getTeamUserIds: async () => [] }));
vi.mock("@/lib/prisma", () => ({ prisma: {} }));
vi.mock("@/lib/access/acting-workspace", () => ({
  // Anchored here, a member here, or (out) nothing here.
  levelHeldIn: async (id: string, org: string) => (org === "acme" && id !== "out" ? "EMPLOYEE" : null),
}));

import { readsPeopleDataOf, type PeopleCtx } from "@/lib/people/person-access.server";
import { CHECK_IN_TEXT_MAX, checkInReach, mayReadCheckInsOf, parseCheckIn, readableCheckInsParts, readableCheckInsWhere } from "./check-in-access.server";

const ctx = (over: Partial<PeopleCtx>): PeopleCtx => ({
  userId: "me", organizationId: "acme", ...legacyLevelRow("EMPLOYEE"), orgRole: "MEMBER", isAgent: false, isAdmin: false, peopleTeam: false,
  orgWide: false, managerTier: false, chain: new Set(), writeChain: new Set(), viewer: {} as PeopleCtx["viewer"], ...over,
});

/** Where each subject works: their anchor, and their memberships. */
const PEOPLE: Record<string, { anchor: string; memberOf: string[] }> = {
  me: { anchor: "acme", memberOf: [] },
  peer: { anchor: "acme", memberOf: [] },
  rep: { anchor: "acme", memberOf: [] },
  deep: { anchor: "acme", memberOf: [] },
  dot: { anchor: "acme", memberOf: ["acme"] }, // a membership row in the anchored workspace too: still one workspace
  // Anchored here, with a membership in a client workspace: two workspaces.
  dana: { anchor: "acme", memberOf: ["globex"] },
  // Works here through a membership, anchored in a partner workspace.
  vic: { anchor: "partner", memberOf: ["acme"] },
  // Worked in Acme and Globex; Acme was deleted for good, which took her Acme
  // membership with it, so she now holds a level in Globex alone.
  lea: { anchor: "globex", memberOf: [] },
  // Worked here through a membership, anchored in a partner workspace, until
  // the identity provider ended it (SCIM, batch 7): his rows of Acme were set
  // to no workspace in that transaction (batch 8).
  ved: { anchor: "partner", memberOf: [] },
};
const SUBJECTS = Object.keys(PEOPLE);
/** A row each subject wrote in acme, in globex, and before check-ins named a workspace. */
const WRITTEN_IN = ["acme", "globex", null] as const;

function userMatches(id: string, where: Record<string, unknown>): boolean {
  const p = PEOPLE[id];
  return Object.entries(where).every(([k, v]) => {
    if (k === "OR") return (v as Array<Record<string, unknown>>).some((w) => userMatches(id, w));
    if (k === "organizationId") return p.anchor === v;
    if (k === "organizationMemberships") {
      const m = v as { some?: { organizationId: string }; every?: { organizationId: string } };
      if (m.some) return p.memberOf.includes(m.some.organizationId);
      if (m.every) return p.memberOf.every((o) => o === m.every!.organizationId);
    }
    throw new Error(`unexpected user.${k}`);
  });
}
/** A check-in where, answered as Postgres would, for one row. */
function listed(where: Record<string, unknown>, row: { userId: string; organizationId: string | null }): boolean {
  return Object.entries(where).every(([k, v]) => {
    if (k === "OR") return (v as Array<Record<string, unknown>>).some((w) => listed(w, row));
    if (k === "AND") return (v as Array<Record<string, unknown>>).every((w) => listed(w, row));
    if (k === "userId") return typeof v === "string" ? v === row.userId : (v as { in: string[] }).in.includes(row.userId);
    if (k === "organizationId") return row.organizationId === v;
    if (k === "user") return userMatches(row.userId, v as Record<string, unknown>);
    throw new Error(`unexpected ${k}`);
  });
}
/**
 * A row there can be: one naming no workspace, or one of a workspace where
 * its person holds a level now. POST writes only there (writeCheckIn,
 * batch 8: never the session's word alone), and every way a person stops
 * holding a level somewhere takes their rows of there with it in the same
 * transaction: SCIM's end of a membership nulls them, a hard delete
 * cascades them (check-in-access.server.ts THE LEAVING).
 */
function canExist(userId: string, organizationId: string | null): boolean {
  const p = PEOPLE[userId];
  return organizationId === null || p.anchor === organizationId || p.memberOf.includes(organizationId);
}
/** The rule, said plainly: the person's own row written here or naming no workspace; anyone else's only by the ladder, of someone with a level here, and only a row written here. */
function expected(c: PeopleCtx, row: { userId: string; organizationId: string | null }): boolean {
  if (row.userId === c.userId) return row.organizationId === "acme" || row.organizationId === null;
  const p = PEOPLE[row.userId];
  const holdsALevelHere = p.anchor === "acme" || p.memberOf.includes("acme");
  return readsPeopleDataOf(c, row.userId) && holdsALevelHere && row.organizationId === "acme";
}
/** Every key a where uses, at any depth. */
function keysOf(where: unknown): string[] {
  if (!where || typeof where !== "object") return [];
  if (Array.isArray(where)) return where.flatMap(keysOf);
  return Object.entries(where as Record<string, unknown>).flatMap(([k, v]) => [k, ...keysOf(v)]);
}

describe("readableCheckInsWhere", () => {
  const shapes: Array<[string, PeopleCtx]> = [
    ["a colleague", ctx({})],
    ["a Guest", ctx({ orgRole: "GUEST", isAdmin: false })],
    ["a manager", ctx({ managerTier: true, chain: new Set(["rep", "deep"]), writeChain: new Set(["rep", "deep"]) })],
    ["a dotted-line manager", ctx({ chain: new Set(["dot"]) })],
    ["a manager of people in two workspaces", ctx({ managerTier: true, chain: new Set(["dana", "vic"]), writeChain: new Set(["dana", "vic"]) })],
    ["an Admin", ctx({ orgRole: "ADMIN", isAdmin: true, orgWide: true })],
    ["the People team", ctx({ peopleTeam: true, orgWide: true })],
    ["an org-wide level", ctx({ ...legacyLevelRow("C_LEVEL"), orgWide: true })],
    ["an Agent", ctx({ isAgent: true })],
  ];
  for (const [name, c] of shapes) {
    it(`lists exactly what the ladder lets ${name} read, of this workspace only`, () => {
      const where = readableCheckInsWhere(c) as Record<string, unknown>;
      for (const userId of SUBJECTS) {
        for (const organizationId of WRITTEN_IN) {
          if (!canExist(userId, organizationId)) continue;
          const row = { userId, organizationId };
          expect(listed(where, row), `${name} / ${userId} / written in ${organizationId}`).toBe(expected(c, row));
        }
      }
    });
  }

  // Docs-found fixes batch 7 (the batch 6 review): the older rows' "every
  // membership is here" was a NOT IN over every other workspace's
  // memberships, and the "holds a level here" an OR with a membership
  // sublink, on every read. A read now asks only the check-in's own columns.
  it("asks nothing about the person on a read: no User filter and no membership, for every viewer", () => {
    for (const [name, c] of shapes) {
      const keys = keysOf(readableCheckInsWhere(c));
      expect(keys.filter((k) => !["OR", "AND", "userId", "organizationId", "in"].includes(k)), name).toEqual([]);
    }
  });

  // Docs-found fixes batch 8 (the batch 7 review's older low): GET
  // /api/check-ins read the OR with ORDER BY and LIMIT, which could only be a
  // BitmapOr and a sort of every check-in of the workspace for an Admin. It
  // now reads each part newest first, limited, by its own index.
  it("splits into parts that share no row and together are the where, an Admin's workspace part being the workspace's column alone", () => {
    for (const [name, c] of shapes) {
      const parts = readableCheckInsParts(c) as Array<Record<string, unknown>>;
      const where = readableCheckInsWhere(c) as Record<string, unknown>;
      for (const userId of [...SUBJECTS, "gia"]) {
        for (const organizationId of WRITTEN_IN) {
          const row = { userId, organizationId };
          const inParts = parts.filter((p) => listed(p, row)).length;
          expect(inParts, `${name} / ${userId} / ${organizationId}`).toBeLessThanOrEqual(1);
          expect(inParts === 1, `${name} / ${userId} / ${organizationId}`).toBe(listed(where, row));
        }
      }
    }
    for (const c of [ctx({ orgRole: "ADMIN", isAdmin: true, orgWide: true }), ctx({ peopleTeam: true, orgWide: true }), ctx({ ...legacyLevelRow("C_LEVEL"), orgWide: true })]) {
      expect(readableCheckInsParts(c)).toEqual([{ userId: "me", organizationId: null }, { organizationId: "acme" }]);
    }
    expect(readableCheckInsParts(ctx({}))).toEqual([{ userId: "me", OR: [{ organizationId: "acme" }, { organizationId: null }] }]);
    expect(readableCheckInsParts(ctx({ chain: new Set(["rep"]) }))[1]).toEqual({ userId: { in: ["rep"] }, organizationId: "acme" });
  });
});

// Docs-found fixes batch 6, the review's scenario: Dana is anchored in Acme
// with a membership in Globex. Her Acme check-ins (and her older ones, which
// name no workspace) reached every Globex Admin.
describe("a check-in stays in the workspace it was written in", () => {
  const where = (c: PeopleCtx) => readableCheckInsWhere(c) as Record<string, unknown>;
  const globexAdmin = ctx({ userId: "gia", organizationId: "globex", orgRole: "ADMIN", isAdmin: true, orgWide: true });
  const acmeAdmin = ctx({ userId: "ada", orgRole: "ADMIN", isAdmin: true, orgWide: true });

  it("never reaches another workspace's Admin, People team or org-wide level", () => {
    for (const c of [globexAdmin, { ...globexAdmin, isAdmin: false, orgRole: "MEMBER", peopleTeam: true }, { ...globexAdmin, isAdmin: false, orgRole: "MEMBER", ...legacyLevelRow("VP") }]) {
      expect(listed(where(c), { userId: "dana", organizationId: "acme" })).toBe(false);
      // Written before workspaces, by someone who works in two: no workspace reads it but her.
      expect(listed(where(c), { userId: "dana", organizationId: null })).toBe(false);
      expect(listed(where(c), { userId: "dana", organizationId: "globex" })).toBe(true);
    }
    expect(listed(where(acmeAdmin), { userId: "dana", organizationId: "acme" })).toBe(true);
    expect(listed(where(acmeAdmin), { userId: "dana", organizationId: null })).toBe(false);
    expect(listed(where(acmeAdmin), { userId: "dana", organizationId: "globex" })).toBe(false);
  });

  it("reads a row still naming no workspace only for its person, wherever they work", () => {
    // The backfill gave every row it could its workspace; one still null is its person's alone.
    expect(listed(where(acmeAdmin), { userId: "peer", organizationId: null })).toBe(false);
    expect(listed(where(acmeAdmin), { userId: "vic", organizationId: null })).toBe(false);
    expect(listed(where(ctx({ userId: "peer" })), { userId: "peer", organizationId: null })).toBe(true);
    const dana = ctx({ userId: "dana", organizationId: "globex" });
    expect(listed(where(dana), { userId: "dana", organizationId: null })).toBe(true);
    expect(listed(where(dana), { userId: "dana", organizationId: "globex" })).toBe(true);
    // Her own, written in Acme, is read in Acme, not in Globex.
    expect(listed(where(dana), { userId: "dana", organizationId: "acme" })).toBe(false);
  });

  // The batch 6 review's scenario: the older-row rule was asked on every
  // read, so a hard delete widened it. Lea wrote check-ins in Acme while she
  // also worked in Globex; Acme was deleted and its cascade took her Acme
  // membership, so she then held a level in Globex alone.
  it("never gives a deleted workspace's older rows to the workspace that remains", () => {
    const gia = ctx({ userId: "gia", organizationId: "globex", orgRole: "ADMIN", isAdmin: true, orgWide: true });
    for (const c of [gia, { ...gia, isAdmin: false, orgRole: "MEMBER", peopleTeam: true }, { ...gia, isAdmin: false, orgRole: "MEMBER", ...legacyLevelRow("VP") }]) {
      expect(listed(where(c), { userId: "lea", organizationId: null })).toBe(false);
      expect(listed(where(c), { userId: "lea", organizationId: "globex" })).toBe(true);
    }
    expect(listed(where(ctx({ userId: "lea", organizationId: "globex" })), { userId: "lea", organizationId: null })).toBe(true);
  });

  it("names what the viewer reads, for the digest's labels", () => {
    expect(checkInReach(acmeAdmin)).toBe("workspace");
    expect(checkInReach(ctx({ chain: new Set(["rep"]) }))).toBe("team");
    expect(checkInReach(ctx({}))).toBe("own");
    expect(checkInReach(ctx({ orgRole: "GUEST", peopleTeam: true }))).toBe("own");
  });
});

describe("mayReadCheckInsOf", () => {
  it("is the ladder, for someone who holds a level here", async () => {
    expect(await mayReadCheckInsOf(ctx({}), "me")).toBe(true);
    expect(await mayReadCheckInsOf(ctx({}), "peer")).toBe(false);
    expect(await mayReadCheckInsOf(ctx({ orgRole: "ADMIN", isAdmin: true }), "peer")).toBe(true);
    // An Admin here reads nothing of someone with no level here.
    expect(await mayReadCheckInsOf(ctx({ orgRole: "ADMIN", isAdmin: true }), "out")).toBe(false);
  });
});

describe("parseCheckIn", () => {
  it("takes a whole mood from 1 to 5 and bounded text, and nothing else from the body", () => {
    expect(parseCheckIn({ mood: 1, wentWell: "a", userId: "peer" })).toEqual({ ok: true, value: { mood: 1, wentWell: "a", challenges: null, tomorrow: null } });
    expect(parseCheckIn({ mood: 5, challenges: "x".repeat(CHECK_IN_TEXT_MAX) }).ok).toBe(true);
    for (const bad of [null, [], "3", { mood: "3" }, { mood: 3.5 }, { mood: 0 }, { mood: 6 }, { mood: 3, tomorrow: {} }, { mood: 3, wentWell: "x".repeat(CHECK_IN_TEXT_MAX + 1) }]) {
      expect(parseCheckIn(bad).ok, JSON.stringify(bad)).toBe(false);
    }
  });
});

// Docs-found fixes batch 7: the older rows are decided once, at deploy
// (prisma/sql/2026-10-12-check-in-backfill.sql), never on a read. Read as
// text: the deploy script runs on import, and no test runs SQL.
describe("the one-time backfill of the older check-ins", () => {
  const ROOT = process.cwd();
  /** The file without its comments, read in each test so the rest of this file runs whether or not it exists. */
  const sql = () => readFileSync(path.join(ROOT, "prisma/sql/2026-10-12-check-in-backfill.sql"), "utf8").replace(/--[^\n]*/g, "");

  it("gives a null row the workspace of a person who holds a level in that one alone, and nothing else", () => {
    const SQL = sql();
    // One UPDATE, of null rows only, to the person's anchor.
    expect(SQL.match(/\bUPDATE "/g)).toHaveLength(1);
    expect(SQL).toMatch(/UPDATE "CheckIn" c\s+SET "organizationId" = one\."organizationId"/);
    expect(SQL).toMatch(/JOIN "User" u ON u\."id" = ci\."userId"/);
    expect(SQL).toMatch(/WHERE ci\."organizationId" IS NULL/);
    // No membership in any workspace but the anchor (a membership row in the anchor itself is still one workspace).
    expect(SQL).toMatch(/NOT EXISTS \(\s*SELECT 1 FROM "OrganizationMembership" m\s+WHERE m\."userId" = u\."id" AND m\."organizationId" <> u\."organizationId"\s*\)/);
    // Never a row older than the workspace it would go to.
    expect(SQL).toMatch(/JOIN "Organization" o ON o\."id" = u\."organizationId"/);
    expect(SQL).toMatch(/AND ci\."createdAt" >= o\."createdAt"/);
  });

  it("runs once, by a marker written in the same block, so a later deploy never decides a row again", () => {
    const SQL = sql();
    expect(SQL.replace(/DO \$\$[\s\S]*?\$\$;/g, "").trim()).toBe("");
    expect(SQL.match(/DO \$\$/g)).toHaveLength(1);
    expect(SQL).toMatch(/col_description\('"CheckIn"'::regclass,[\s\S]*attname = 'organizationId'[\s\S]*NOT LIKE '%check-in-backfill-2026-10-12%' THEN\s+UPDATE/);
    expect(SQL).toMatch(/COMMENT ON COLUMN "CheckIn"\."organizationId" IS\s+'[^']*check-in-backfill-2026-10-12'/);
    expect(SQL.indexOf("UPDATE")).toBeLessThan(SQL.indexOf("COMMENT ON COLUMN"));
  });

  it("never waits on a row, and is listed last, after the file that adds the column", () => {
    const SQL = sql();
    expect(SQL).toMatch(/FOR UPDATE OF ci SKIP LOCKED\s+FOR KEY SHARE OF o SKIP LOCKED/);
    const manifest = readFileSync(path.join(ROOT, "scripts/deploy-migrations.mjs"), "utf8");
    const list = /const SQL_MANIFEST = \[([\s\S]*?)\];/.exec(manifest)?.[1] ?? "";
    const names = [...list.replace(/\/\/[^\n]*/g, "").matchAll(/"([^"]+\.sql)"/g)].map((m) => m[1]);
    // Batch 8 lists two files after it: the erasure's, and the narrowing, last.
    expect(names.slice(-4)).toEqual([
      "2026-10-12-check-in-workspace.sql",
      "2026-10-12-check-in-backfill.sql",
      "2026-10-12-check-in-erasure.sql",
      "2026-10-12-check-in-backfill-narrow.sql",
    ]);
  });

  // It may have run in production with the 8e3f75af deploy, and its marker
  // means it never runs again: any change to it would never reach a database
  // it already ran on. Batch 8 narrows it in a file of its own instead.
  it("is never changed after it shipped", () => {
    const text = readFileSync(path.join(ROOT, "prisma/sql/2026-10-12-check-in-backfill.sql"));
    expect(createHash("sha256").update(text).digest("hex")).toBe("fa71f6ce7d57b7e019e6d76846f71dbccebed984ae2020e7cbfa0d3157aa8d99");
  });
});

// Docs-found fixes batch 8 (the batch 7 review): the backfill read "no
// membership but the anchor" as "only ever worked in one workspace", which a
// person who reached their anchor through a membership, after a move with
// the old switcher (no membership kept for the workspace left), is not. Sam
// signed up in Acme, accepted Globex's invitation and switched: his only
// membership is Globex's, and his Acme check-ins went to Globex for good.
describe("the backfill, narrowed (2026-10-12-check-in-backfill-narrow.sql)", () => {
  const ROOT = process.cwd();
  const sql = () => readFileSync(path.join(ROOT, "prisma/sql/2026-10-12-check-in-backfill-narrow.sql"), "utf8").replace(/--[^\n]*/g, "");
  const flat = (x: string) => x.replace(/\s+/g, " ").trim();
  /** Who loses a workspace on a row: the two cases, as written in the file. */
  const PREDICATE =
    'WHERE ci."organizationId" IS NOT NULL AND ( (ci."createdAt" < (TIMESTAMPTZ \'2026-10-12 10:00:00+00\' AT TIME ZONE \'UTC\') AND EXISTS ( SELECT 1 FROM "OrganizationMembership" m WHERE m."userId" = ci."userId" AND m."organizationId" = ci."organizationId" AND NOT m."isPrimary" )) OR (u."organizationId" <> ci."organizationId" AND NOT EXISTS ( SELECT 1 FROM "OrganizationMembership" m WHERE m."userId" = ci."userId" AND m."organizationId" = ci."organizationId" )) )';

  it("only ever narrows: every write sets no workspace, never one", () => {
    const SQL = flat(sql());
    expect(SQL.match(/\bUPDATE "/g)).toHaveLength(1);
    expect(SQL.match(/SET "organizationId" = [^,;]*/g)).toEqual(['SET "organizationId" = NULL FROM ( SELECT ci."id" FROM "CheckIn" ci JOIN "User" u ON u."id" = ci."userId" ' + PREDICATE + " FOR UPDATE OF ci SKIP LOCKED ) one WHERE c.\"id\" = one.\"id\""]);
    expect(SQL).not.toMatch(/\bDELETE\b|\bINSERT\b/);
  });

  it("takes a backfilled row from a workspace its person reached through a membership, and any row of a workspace they hold no level in", () => {
    const SQL = flat(sql());
    // (1) Created before POST wrote the column, naming a workspace where its person holds a non-primary membership.
    // (2) Naming a workspace its person is neither anchored in nor a member of.
    expect(SQL.split(PREDICATE)).toHaveLength(3);
    // Read by the row's workspace, never by today's anchor alone, and never the Organization row (a null needs no key check).
    expect(SQL).not.toMatch(/JOIN "Organization"|FOR KEY SHARE/);
  });

  it("never waits on a row, and writes its marker only once no row is left, keeping the backfill's so that file never runs again", () => {
    const SQL = flat(sql());
    expect(SQL.replace(/DO \$\$[\s\S]*?\$\$;/g, "").trim()).toBe("");
    expect(SQL.match(/DO \$\$/g)).toHaveLength(1);
    expect(SQL).toMatch(/attname = 'organizationId' AND NOT attisdropped\)\), ''\) NOT LIKE '%check-in-backfill-narrow-2026-10-12%' THEN UPDATE "CheckIn" c/);
    expect(SQL).toContain("FOR UPDATE OF ci SKIP LOCKED");
    // The plain read after the UPDATE asks the same predicate; only then the comment.
    expect(SQL).toContain(`WHERE c."id" = one."id"; IF NOT EXISTS ( SELECT 1 FROM "CheckIn" ci JOIN "User" u ON u."id" = ci."userId" ${PREDICATE} ) THEN COMMENT ON COLUMN "CheckIn"."organizationId" IS`);
    const comment = /COMMENT ON COLUMN "CheckIn"\."organizationId" IS '((?:[^']|'')*)'/.exec(SQL)?.[1] ?? "";
    // The backfill's guard is NOT LIKE '%check-in-backfill-2026-10-12%': the new comment still matches it.
    expect(comment).toContain("check-in-backfill-2026-10-12");
    expect(comment).toContain("check-in-backfill-narrow-2026-10-12");
  });
});
