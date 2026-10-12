// sopsEachCanRead (src/lib/sop-access.ts, docs-found fixes batch 6): the SOP
// list's and page's rule (sopVisibilityWhere) for many readers at once, so the
// overdue SOP digest names a SOP only to a manager who can open it. Held equal
// to sopVisibilityWhere for every reader shape over one folder tree, in the
// same few reads whatever the number of readers.

import { beforeEach, describe, expect, it, vi } from "vitest";
import { legacyLevelRow } from "@/lib/access/test-fixtures";

type Sop = { id: string; organizationId: string; folderId: string | null; status: string; createdById: string | null };

const db = vi.hoisted(() => ({
  /** folder id -> parent id */
  folders: {} as Record<string, string | null>,
  grants: [] as Array<{ userId: string; folderId: string; role: string }>,
  sops: [] as Array<{ id: string; organizationId: string; folderId: string | null; status: string; createdById: string | null }>,
  assignments: [] as Array<{ sopId: string; userId: string }>,
  /** Who holds the sops/edit capability. */
  editors: new Set<string>(),
  permissionAsks: [] as string[],
  reads: [] as string[],
}));

/** The folder and every folder below it (the cascade down), as the CTE walks it. */
function below(id: string): string[] {
  const out = [id];
  for (const [f, parent] of Object.entries(db.folders)) if (parent === id) out.push(...below(f));
  return out;
}
function above(id: string): string[] {
  const out: string[] = [];
  let cur: string | null = id;
  while (cur && cur in db.folders && !out.includes(cur)) {
    out.push(cur);
    cur = db.folders[cur];
  }
  return out;
}

vi.mock("@/lib/prisma", () => ({
  prisma: {
    $queryRawUnsafe: async (sql: string, ids: string[]) => {
      if (sql.includes("WITH RECURSIVE accessible")) return [...new Set(ids.filter((id) => id in db.folders).flatMap(below))].map((id) => ({ id }));
      if (sql.includes("WITH RECURSIVE above")) {
        db.reads.push("above");
        return ids.flatMap((startId) => above(startId).map((id) => ({ startId, id })));
      }
      throw new Error("the mock can't read that SQL");
    },
    sOPFolderAccess: {
      findMany: async (a: { where: { userId: string | { in: string[] }; folderId?: { in: string[] } } }) => {
        if (typeof a.where.userId !== "string") db.reads.push("grants");
        const who = a.where.userId;
        return db.grants.filter((g) => (typeof who === "string" ? g.userId === who : who.in.includes(g.userId)) && (!a.where.folderId || a.where.folderId.in.includes(g.folderId)));
      },
    },
    sOP: {
      findMany: async (a: { where: { id: { in: string[] }; organizationId: string } }) => {
        db.reads.push("sops");
        return db.sops.filter((s) => a.where.id.in.includes(s.id) && s.organizationId === a.where.organizationId);
      },
    },
    sOPAssignment: {
      findMany: async (a: { where: { sopId: { in: string[] }; userId: { in: string[] } } }) => {
        db.reads.push("assignments");
        return db.assignments.filter((x) => a.where.sopId.in.includes(x.sopId) && a.where.userId.in.includes(x.userId));
      },
    },
  },
}));
vi.mock("@/lib/api-helpers", async () => {
  const { legacyIsAdminLevel } = await import("@/lib/access/legacy-levels");
  const { legacyLevelOfRow: levelOf } = await import("@/lib/access/test-fixtures");
  return {
    isOrgAdmin: (session: { user: Record<string, string> }) => legacyIsAdminLevel(levelOf(session.user)),
    hasPermission: async (session: { user: { id: string } }, module: string, action: string) => {
      db.permissionAsks.push(session.user.id);
      return module === "sops" && action === "edit" && db.editors.has(session.user.id);
    },
  };
});

import { sopVisibilityWhere, sopsEachCanRead } from "./sop-access";

const ORG = "acme";

/** sopVisibilityWhere's answer, read over one SOP as Postgres would. */
function visible(where: Record<string, unknown>, sop: Sop): boolean {
  return Object.entries(where).every(([k, v]) => {
    if (k === "OR") return (v as Array<Record<string, unknown>>).some((w) => visible(w, sop));
    if (k === "id") return sop.id === v;
    if (k === "folderId") return v === null ? sop.folderId === null : (v as { in: string[] }).in.includes(sop.folderId ?? "");
    if (k === "status") return (v as { in: string[] }).in.includes(sop.status);
    if (k === "createdById") return sop.createdById === v;
    if (k === "assignments") return db.assignments.some((a) => a.sopId === sop.id && a.userId === (v as { some: { userId: string } }).some.userId);
    throw new Error(`the mock can't read ${k}`);
  });
}

const reader = (id: string, level: string) => ({ id, ...legacyLevelRow(level) });
const READERS = [
  reader("admin", "COMPANY_ADMIN"),
  reader("owner", "SUPER_ADMIN"),
  reader("plain", "EMPLOYEE"),
  reader("hr-viewer", "MANAGER"),
  reader("onboard-editor", "MANAGER"),
  reader("ops-owner", "DIRECTOR"),
  reader("writer", "EMPLOYEE"),
  reader("assignee", "EMPLOYEE"),
  reader("edits-unfiled", "EMPLOYEE"),
  reader("author", "TEAM_LEAD"),
];

beforeEach(() => {
  db.folders = { hr: null, onboarding: "hr", week1: "onboarding", ops: null, secret: null };
  db.grants = [
    { userId: "hr-viewer", folderId: "hr", role: "VIEWER" },
    { userId: "onboard-editor", folderId: "onboarding", role: "EDITOR" },
    { userId: "onboard-editor", folderId: "secret", role: "VIEWER" },
    { userId: "ops-owner", folderId: "ops", role: "OWNER" },
  ];
  const sop = (id: string, folderId: string | null, status: string, createdById: string | null = "someone", organizationId = ORG): Sop => ({ id, organizationId, folderId, status, createdById });
  db.sops = [
    sop("unfiled-pub", null, "PUBLISHED", "author"),
    sop("unfiled-draft", null, "DRAFT", "author"),
    sop("unfiled-arch", null, "ARCHIVED"),
    sop("hr-pub", "hr", "PUBLISHED"),
    sop("week1-pub", "week1", "PUBLISHED"),
    sop("week1-draft", "week1", "DRAFT"),
    sop("ops-arch", "ops", "ARCHIVED"),
    sop("ops-draft", "ops", "DRAFT"),
    sop("secret-pub", "secret", "PUBLISHED"),
    sop("secret-draft", "secret", "DRAFT", "writer"),
    sop("secret-assigned", "secret", "PUBLISHED"),
    sop("gone-folder", "deleted-folder", "PUBLISHED"),
    sop("other-org", null, "PUBLISHED", "someone", "other"),
  ];
  db.assignments = [{ sopId: "secret-assigned", userId: "assignee" }];
  db.editors = new Set(["edits-unfiled"]);
  db.permissionAsks = [];
  db.reads = [];
});

describe("sopsEachCanRead", () => {
  it("answers for every reader exactly as sopVisibilityWhere answers each one alone", async () => {
    const asks = READERS.flatMap((reader) => db.sops.map((s) => ({ reader, sopId: s.id })));
    const got = await sopsEachCanRead(ORG, asks);
    for (const r of READERS) {
      const where = await sopVisibilityWhere({ user: { ...r, organizationId: ORG } });
      for (const s of db.sops) {
        const alone = s.organizationId === ORG && visible(where, s);
        expect(got.get(r.id)?.has(s.id), `${r.id} / ${s.id}`).toBe(alone);
      }
    }
    // The literal cases a digest leaks without the check.
    expect(got.get("plain")?.has("secret-pub")).toBe(false);
    expect(got.get("plain")?.has("unfiled-pub")).toBe(true);
    expect(got.get("hr-viewer")?.has("week1-pub")).toBe(true);
    expect(got.get("hr-viewer")?.has("week1-draft")).toBe(false);
    expect(got.get("onboard-editor")?.has("week1-draft")).toBe(true);
    expect(got.get("assignee")?.has("secret-assigned")).toBe(true);
    expect(got.get("admin")?.has("other-org")).toBe(false);
  });

  it("reads the same few things whatever the number of readers, and asks the capability only where an answer rests on it", async () => {
    const got = await sopsEachCanRead(ORG, [
      { reader: READERS[2], sopId: "secret-pub" },
      { reader: READERS[3], sopId: "week1-pub" },
      { reader: READERS[3], sopId: "week1-pub" },
      { reader: READERS[8], sopId: "unfiled-draft" },
      { reader: READERS[9], sopId: "unfiled-draft" },
    ]);
    expect([...got].map(([id, set]) => [id, [...set]])).toEqual([["plain", []], ["hr-viewer", ["week1-pub"]], ["edits-unfiled", ["unfiled-draft"]], ["author", ["unfiled-draft"]]]);
    expect(db.reads.sort()).toEqual(["above", "assignments", "grants", "sops"]);
    // Only the reader whose answer rests on it: the author reads their own draft without it.
    expect(db.permissionAsks).toEqual(["edits-unfiled"]);
  });

  it("reads nothing when nothing is asked, and only the SOPs when every reader is an Admin", async () => {
    expect((await sopsEachCanRead(ORG, [])).size).toBe(0);
    expect(db.reads).toEqual([]);
    const got = await sopsEachCanRead(ORG, [{ reader: READERS[0], sopId: "secret-draft" }]);
    expect([...(got.get("admin") ?? [])]).toEqual(["secret-draft"]);
    expect(db.reads).toEqual(["sops"]);
  });
});
