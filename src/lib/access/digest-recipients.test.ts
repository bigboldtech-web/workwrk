// Who a manager digest goes to, and which Lists each manager can open
// (src/lib/access/digest-recipients.ts, docs-found fixes batch 4). The
// effective line is manager-lines.ts's (scripted here); the read check is
// the node resolver's own rules, evaluated over one world for many people.

import { beforeEach, describe, expect, it, vi } from "vitest";
import { NodeEvaluator, decideAll, emptyGrants, emptyRows, roleAtLeast, type NodeRows, type NodeViewer, type ViewerGrants } from "./node-rules";
import { legacyLevelRow } from "./test-fixtures";

const st = vi.hoisted(() => ({
  effective: new Map<string, string | null>(),
  users: [] as Array<Record<string, unknown>>,
  memberships: [] as Array<{ userId: string; organizationId: string; role: string }>,
  rows: null as unknown,
  grants: new Map<string, unknown>(),
  loads: 0,
  /** The Lists each world was loaded for, and whose rows each grant read asked for. */
  seeded: [] as string[][],
  grantReads: [] as Array<string[] | "everyone">,
}));

vi.mock("server-only", () => ({}));
vi.mock("./manager-lines", () => ({
  effectiveManagersOf: async (_org: string, ids: readonly string[]) => new Map(ids.filter((id) => st.effective.has(id)).map((id) => [id, st.effective.get(id) ?? null])),
}));
vi.mock("@/lib/prisma", () => ({
  prisma: {
    user: {
      // The member read (docs-found fixes batch 5) also asks for people
      // anchored elsewhere, live, with a membership here.
      findMany: async ({ where }: { where: { id: { in: string[] }; deletedAt?: null; organizationId?: { not: string }; status?: { not: string }; organizationMemberships?: { some: { organizationId: string } } } }) =>
        st.users.filter((u) =>
          where.id.in.includes(u.id as string) &&
          (where.deletedAt === null ? !u.deletedAt : true) &&
          (where.organizationId ? u.organizationId !== where.organizationId.not : true) &&
          (where.status ? u.status !== where.status.not : true) &&
          (where.organizationMemberships ? st.memberships.some((m) => m.userId === u.id && m.organizationId === where.organizationMemberships!.some.organizationId) : true)),
    },
    organizationMembership: {
      findMany: async ({ where }: { where: { organizationId: string; userId: { in: string[] } } }) =>
        st.memberships.filter((m) => m.organizationId === where.organizationId && where.userId.in.includes(m.userId)),
    },
  },
}));
vi.mock("./node-world", async () => ({
  ...(await vi.importActual<object>("./node-world")),
  loadRows: async (_org: string, seeds: { lists: string[] }) => { st.loads += 1; st.seeded.push([...seeds.lists].sort()); return st.rows; },
  loadAllGrants: async (_rows: unknown, opts?: { userIds?: string[] }) => { st.grantReads.push(opts?.userIds ? [...opts.userIds].sort() : "everyone"); return st.grants; },
}));

import { digestManagersOf, listsEachCanRead } from "./digest-recipients";

const ORG = "o1";
const user = (id: string, level: string, over: Record<string, unknown> = {}) => ({
  id, email: `${id}@example.test`, firstName: id.toUpperCase(), status: "ACTIVE", organizationId: ORG, deletedAt: null, ...legacyLevelRow(level), ...over,
});

beforeEach(() => {
  st.effective = new Map();
  st.users = [];
  st.memberships = [];
  st.grants = new Map();
  st.loads = 0;
  st.seeded = [];
  st.grantReads = [];
});

describe("digestManagersOf", () => {
  it("names each person's effective manager, live and in this workspace, and never an Agent", async () => {
    st.effective = new Map<string, string | null>([
      ["p-mgr", "m"], ["p-none", null], ["p-agent", "agent"], ["p-off", "off"], ["p-gone", "gone"], ["p-self", "p-self"], ["p-admin", "boss"],
    ]);
    st.users = [
      user("m", "MANAGER"),
      user("agent", "AGENT"),
      user("off", "MANAGER", { status: "INACTIVE" }),
      user("gone", "MANAGER", { deletedAt: new Date() }),
      user("p-self", "MANAGER"),
      user("boss", "COMPANY_ADMIN"),
    ];
    const got = await digestManagersOf(ORG, [...st.effective.keys()]);
    expect([...got].map(([p, m]) => [p, m.id])).toEqual([["p-mgr", "m"], ["p-admin", "boss"]]);
    expect(got.get("p-mgr")).toMatchObject({ email: "m@example.test", firstName: "M", viewer: { userId: "m", orgAdmin: false, isAgent: false, denied: false } });
    expect(got.get("p-admin")?.viewer.orgAdmin).toBe(true);
  });

  it("reads a manager anchored in another workspace at the role their membership holds here", async () => {
    st.effective = new Map([["p1", "away-mgr"], ["p2", "away-agent"], ["p3", "away-none"]]);
    st.users = [user("away-mgr", "COMPANY_ADMIN", { organizationId: "agency" }), user("away-agent", "MANAGER", { organizationId: "agency" }), user("away-none", "MANAGER", { organizationId: "agency" })];
    st.memberships = [{ userId: "away-mgr", organizationId: ORG, role: "MANAGER" }, { userId: "away-agent", organizationId: ORG, role: "AGENT" }];
    const got = await digestManagersOf(ORG, ["p1", "p2", "p3"]);
    // An Admin of the agency is a Manager here; an Agent here manages nobody here; no level here, no digest.
    expect([...got.keys()]).toEqual(["p1"]);
    expect(got.get("p1")?.viewer.orgAdmin).toBe(false);
  });
});

// Docs-found fixes batch 5: effectiveManagersOf answers only for people
// anchored here, and the anchor is the last workspace a person switched to,
// so someone who works here through a membership had no digest manager here,
// and their late work here reached nobody.
describe("digestManagersOf, for someone who works here through a membership", () => {
  it("names their stored manager here, walked at the tier held here: never themselves, never someone with no level here, never an Agent", async () => {
    st.effective = new Map(); // nobody anchored here among them
    const away = { organizationId: "partner" };
    st.users = [
      user("dana", "EMPLOYEE", { ...away, managerId: "sam" }), // switched to the partner workspace once
      user("sam", "MANAGER", { managerId: null }),
      user("pia", "EMPLOYEE", { ...away, managerId: "agt" }),
      user("agt", "AGENT", { managerId: "sam" }), // an Agent here from before rule 6
      user("ida", "EMPLOYEE", { ...away, managerId: "agt2" }),
      user("agt2", "MANAGER", { ...away, managerId: "sam" }), // anchored elsewhere, an Agent HERE by membership
      user("sel", "EMPLOYEE", { ...away, managerId: "sel" }), // a stored self-line
      user("fay", "EMPLOYEE", { ...away, managerId: "far" }),
      user("far", "MANAGER", { ...away, managerId: null }), // no level here
      user("gil", "EMPLOYEE", { ...away, managerId: "sam", status: "INACTIVE" }), // deactivated
      user("nom", "EMPLOYEE", { ...away, managerId: "sam" }), // no membership here
    ];
    st.memberships = ["dana", "pia", "ida", "sel", "fay", "gil"].map((userId) => ({ userId, organizationId: ORG, role: "EMPLOYEE" }));
    st.memberships.push({ userId: "agt2", organizationId: ORG, role: "AGENT" });
    const got = await digestManagersOf(ORG, ["dana", "pia", "ida", "sel", "fay", "gil", "nom"]);
    expect([...got].map(([p, m]) => [p, m.id]).sort()).toEqual([["dana", "sam"], ["ida", "sam"], ["pia", "sam"]]);
    expect(got.get("dana")?.viewer).toMatchObject({ userId: "sam", isAgent: false, denied: false });
  });

  it("asks nothing more when everyone is anchored here", async () => {
    st.effective = new Map([["p1", "m"]]);
    st.users = [user("m", "MANAGER")];
    const got = await digestManagersOf(ORG, ["p1"]);
    expect([...got.keys()]).toEqual(["p1"]);
  });
});

describe("listsEachCanRead", () => {
  const viewer = (userId: string, over: Partial<NodeViewer> = {}): NodeViewer => ({ userId, orgAdmin: false, orgGuest: false, isAgent: false, denied: false, ...over });
  function world(): NodeRows {
    const rows = emptyRows(ORG);
    // A Space open to everyone at the org, an ordinary List in it, and a Private one.
    rows.spaces.set("s", { id: "s", organizationId: ORG, name: "Ops", slug: "ops", icon: null, color: null, visibility: "ORG", ownerId: "owner" });
    rows.lists.set("l-open", { id: "l-open", organizationId: ORG, spaceId: "s", folderId: null, name: "Open", slug: "open", icon: null, color: null, visibility: "WORKSPACE", ownerId: "owner" });
    rows.lists.set("l-private", { id: "l-private", organizationId: ORG, spaceId: "s", folderId: null, name: "HR", slug: "hr", icon: null, color: null, visibility: "PRIVATE", ownerId: "owner" });
    return rows;
  }
  const memberOf = (list: string): Omit<ViewerGrants, "viewer"> => ({ space: new Map(), folder: new Map(), list: new Map([[list, "MEMBER" as const]]), object: new Map(), since: new Map() });

  it("answers for every viewer from one world, exactly as the resolver answers each one alone", async () => {
    st.rows = world();
    st.grants = new Map([["member", memberOf("l-private")]]);
    const viewers = [viewer("plain"), viewer("member"), viewer("admin", { orgAdmin: true }), viewer("off", { denied: true }), viewer("guest", { orgGuest: true })];
    // Every viewer asked about every List, so each answer can be held to the resolver's.
    const got = await listsEachCanRead(ORG, viewers.flatMap((viewer) => ["l-open", "l-private", "l-other-org"].map((listId) => ({ viewer, listId }))));
    expect(st.loads).toBe(1);
    // The literal cases: a Private List opens for its member and an admin, never for anyone else.
    expect(got.get("member")?.has("l-private")).toBe(true);
    expect(got.get("admin")?.has("l-private")).toBe(true);
    expect(got.get("plain")?.has("l-private")).toBe(false);
    expect(got.get("plain")?.has("l-open")).toBe(true);
    expect(got.get("off")?.size).toBe(0);
    for (const v of viewers) expect(got.get(v.userId)?.has("l-other-org")).toBe(false);
    // And every answer is the one the resolver gives that viewer on their own (nodeRoleMap's decideAll).
    for (const v of viewers) {
      const g = st.grants.get(v.userId) as Omit<ViewerGrants, "viewer"> | undefined;
      const alone = decideAll(st.rows as NodeRows, g ? { ...g, viewer: v } : emptyGrants(v), [{ kind: "list", id: "l-open" }, { kind: "list", id: "l-private" }]);
      for (const id of ["l-open", "l-private"]) {
        expect(got.get(v.userId)?.has(id)).toBe(roleAtLeast(alone.get(`list:${id}`)!.role, "VIEW"));
      }
    }
  });

  it("loads nothing when there is no List or no viewer", async () => {
    st.rows = world();
    expect((await listsEachCanRead(ORG, [{ viewer: viewer("plain"), listId: "" }])).get("plain")?.size ?? 0).toBe(0);
    expect((await listsEachCanRead(ORG, [])).size).toBe(0);
    expect(st.loads).toBe(0);
  });
});

// Docs-found fixes batch 5: it evaluated every manager against every List of
// a page and read every person's rows on every Space of it, then kept only
// the pairs it was asked about, all without a pause.
describe("listsEachCanRead, bounded by what it is asked", () => {
  const viewer = (userId: string, over: Partial<NodeViewer> = {}): NodeViewer => ({ userId, orgAdmin: false, orgGuest: false, isAgent: false, denied: false, ...over });
  function world(): NodeRows {
    const rows = emptyRows(ORG);
    rows.spaces.set("s", { id: "s", organizationId: ORG, name: "Ops", slug: "ops", icon: null, color: null, visibility: "ORG", ownerId: "owner" });
    for (const id of ["l1", "l2", "l3"]) rows.lists.set(id, { id, organizationId: ORG, spaceId: "s", folderId: null, name: id, slug: id, icon: null, color: null, visibility: "WORKSPACE", ownerId: "owner" });
    return rows;
  }

  it("evaluates each manager on their own Lists only, reads only their rows, and answers only what was asked", async () => {
    st.rows = world();
    const evaluated: string[] = [];
    const real = NodeEvaluator.prototype.effective;
    NodeEvaluator.prototype.effective = function (this: NodeEvaluator, ref) {
      if (ref.kind === "list") evaluated.push(`${this.grants.viewer.userId}|${ref.id}`);
      return real.call(this, ref);
    };
    try {
      const got = await listsEachCanRead(ORG, [
        { viewer: viewer("m1"), listId: "l1" },
        { viewer: viewer("m1"), listId: "l1" },
        { viewer: viewer("m2"), listId: "l2" },
        { viewer: viewer("m3"), listId: "l3" },
        { viewer: viewer("off", { denied: true }), listId: "l1" },
      ]);
      expect(evaluated.sort()).toEqual(["m1|l1", "m2|l2", "m3|l3"]);
      expect([...got].map(([v, lists]) => [v, [...lists]])).toEqual([["m1", ["l1"]], ["m2", ["l2"]], ["m3", ["l3"]], ["off", []]]);
      // One world for the Lists asked, and one read of the asked managers' own rows (never a denied one's, never everyone's).
      expect(st.seeded).toEqual([["l1", "l2", "l3"]]);
      expect(st.grantReads).toEqual([["m1", "m2", "m3"]]);
    } finally {
      NodeEvaluator.prototype.effective = real;
    }
  });

  it("gives the event loop a turn between managers", async () => {
    st.rows = world();
    let turned = false;
    setImmediate(() => { turned = true; });
    let turnedBeforeDone = false;
    await listsEachCanRead(ORG, [{ viewer: viewer("m1"), listId: "l1" }, { viewer: viewer("m2"), listId: "l2" }]).then(() => { turnedBeforeDone = turned; });
    expect(turnedBeforeDone).toBe(true);
  });
});
