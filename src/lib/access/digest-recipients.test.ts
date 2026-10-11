// Who a manager digest goes to, and which Lists each manager can open
// (src/lib/access/digest-recipients.ts, docs-found fixes batch 4). The
// effective line is manager-lines.ts's (scripted here); the read check is
// the node resolver's own rules, evaluated over one world for many people.

import { beforeEach, describe, expect, it, vi } from "vitest";
import { decideAll, emptyGrants, emptyRows, roleAtLeast, type NodeRows, type NodeViewer, type ViewerGrants } from "./node-rules";
import { legacyLevelRow } from "./test-fixtures";

const st = vi.hoisted(() => ({
  effective: new Map<string, string | null>(),
  users: [] as Array<Record<string, unknown>>,
  memberships: [] as Array<{ userId: string; organizationId: string; role: string }>,
  rows: null as unknown,
  grants: new Map<string, unknown>(),
  loads: 0,
}));

vi.mock("server-only", () => ({}));
vi.mock("./manager-lines", () => ({
  effectiveManagersOf: async (_org: string, ids: readonly string[]) => new Map(ids.filter((id) => st.effective.has(id)).map((id) => [id, st.effective.get(id) ?? null])),
}));
vi.mock("@/lib/prisma", () => ({
  prisma: {
    user: {
      findMany: async ({ where }: { where: { id: { in: string[] }; deletedAt?: null } }) =>
        st.users.filter((u) => where.id.in.includes(u.id as string) && (where.deletedAt === null ? !u.deletedAt : true)),
    },
    organizationMembership: {
      findMany: async ({ where }: { where: { organizationId: string; userId: { in: string[] } } }) =>
        st.memberships.filter((m) => m.organizationId === where.organizationId && where.userId.in.includes(m.userId)),
    },
  },
}));
vi.mock("./node-world", async () => ({
  ...(await vi.importActual<object>("./node-world")),
  loadRows: async () => { st.loads += 1; return st.rows; },
  loadAllGrants: async () => st.grants,
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
    const got = await listsEachCanRead(ORG, viewers, ["l-open", "l-private", "l-other-org"]);
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
    expect((await listsEachCanRead(ORG, [viewer("plain")], [])).get("plain")?.size).toBe(0);
    expect((await listsEachCanRead(ORG, [], ["l-open"])).size).toBe(0);
    expect(st.loads).toBe(0);
  });
});
