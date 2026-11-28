import { readFileSync } from "node:fs";
import { beforeEach, describe, expect, it, vi } from "vitest";

// Pen test 2026-11-28 (five testers, report V-01 to V-07): one workspace read
// or wrote another's rows by id. The node gates decided a role from the row's
// own workspace and left the workspace check to callers, and six write routes
// stored another workspace's ids unchecked.

type UserRow = { organizationId: string; accessLevel: string };
type Seat = { role: string; status: string; removedAt: Date | null };
const users = new Map<string, UserRow>();
const memberships = new Map<string, Seat>();
const rowsByModel: Record<string, Array<{ id: string; organizationId: string }>> = {};
const seatedHere = new Map<string, Set<string>>();

const findManyFor = (model: string) => async ({ where }: { where: { id: { in: string[] }; organizationId: string } }) =>
  (rowsByModel[model] ?? []).filter((r) => where.id.in.includes(r.id) && r.organizationId === where.organizationId).map((r) => ({ id: r.id }));

vi.mock("@/lib/prisma", () => ({
  prisma: {
    user: { findUnique: async ({ where }: { where: { id: string } }) => users.get(where.id) ?? null },
    organizationMembership: {
      findUnique: async ({ where }: { where: { userId_organizationId: { userId: string; organizationId: string } } }) =>
        memberships.get(`${where.userId_organizationId.userId}:${where.userId_organizationId.organizationId}`) ?? null,
    },
    kRA: { findMany: findManyFor("kra") },
    role: { findMany: findManyFor("role") },
    scope: { findMany: findManyFor("scope") },
    kraCategory: { findMany: findManyFor("kraCategory") },
    idea: { findMany: findManyFor("idea") },
    planScenario: { findMany: findManyFor("planScenario") },
    glAccount: { findMany: findManyFor("glAccount") },
    costCenter: { findMany: findManyFor("costCenter") },
    accountingPeriod: { findMany: findManyFor("accountingPeriod") },
    planDriver: { findMany: findManyFor("planDriver") },
  },
}));
vi.mock("@/lib/access/seated-here", () => ({
  seatedHereAmong: async (org: string, ids: readonly string[]) => new Set(ids.filter((id) => seatedHere.get(org)?.has(id))),
}));

const { levelInCompany, allOwned, allPeopleHere, idOrNull } = await import("./company-wall");

beforeEach(() => {
  users.clear();
  memberships.clear();
  seatedHere.clear();
  for (const k of Object.keys(rowsByModel)) delete rowsByModel[k];
});

describe("the level a person holds in a row's workspace", () => {
  it("a stranger holds none: a free sign-up's admin is no one in another company", () => {
    users.set("outsider", { organizationId: "org-free", accessLevel: "COMPANY_ADMIN" });
    return expect(levelInCompany("outsider", "org-acme")).resolves.toBeNull();
  });

  it("someone anchored there holds their own level", () => {
    users.set("u", { organizationId: "org-acme", accessLevel: "EMPLOYEE" });
    return expect(levelInCompany("u", "org-acme")).resolves.toBe("EMPLOYEE");
  });

  it("someone there through a live membership holds the membership's level, not their anchor's", async () => {
    users.set("pat", { organizationId: "org-b", accessLevel: "COMPANY_ADMIN" });
    memberships.set("pat:org-acme", { role: "EMPLOYEE", status: "ACTIVE", removedAt: null });
    await expect(levelInCompany("pat", "org-acme")).resolves.toBe("EMPLOYEE");
  });

  it("an ended membership is no seat", async () => {
    users.set("pat", { organizationId: "org-b", accessLevel: "EMPLOYEE" });
    memberships.set("pat:org-acme", { role: "EMPLOYEE", status: "INACTIVE", removedAt: null });
    await expect(levelInCompany("pat", "org-acme")).resolves.toBeNull();
  });

  it("guard: no person or no workspace is no seat", async () => {
    await expect(levelInCompany("", "org-acme")).resolves.toBeNull();
    await expect(levelInCompany("u", "")).resolves.toBeNull();
    await expect(levelInCompany("ghost", "org-acme")).resolves.toBeNull();
  });
});

describe("ids a write stores", () => {
  it("another workspace's KRA is refused", async () => {
    rowsByModel.kra = [{ id: "kra-mine", organizationId: "org-acme" }, { id: "kra-theirs", organizationId: "org-mech" }];
    await expect(allOwned("kra", ["kra-mine"], "org-acme")).resolves.toBe(true);
    await expect(allOwned("kra", ["kra-theirs"], "org-acme")).resolves.toBe(false);
    await expect(allOwned("kra", ["kra-mine", "kra-theirs"], "org-acme")).resolves.toBe(false);
  });

  it("an id that exists nowhere is refused", () =>
    expect(allOwned("role", ["nope"], "org-acme")).resolves.toBe(false));

  it("nothing given (clearing a link) is allowed, and the same id twice counts once", async () => {
    rowsByModel.costCenter = [{ id: "cc", organizationId: "org-acme" }];
    await expect(allOwned("costCenter", [null, undefined, ""], "org-acme")).resolves.toBe(true);
    await expect(allOwned("costCenter", ["cc", "cc", null], "org-acme")).resolves.toBe(true);
  });

  it("a non-string value is never read as an id", () =>
    expect(allOwned("idea", [{ in: ["x"] }, 5], "org-acme")).resolves.toBe(true));

  it("a person from another company is refused; one seated here is allowed", async () => {
    seatedHere.set("org-acme", new Set(["kavitha"]));
    await expect(allPeopleHere(["kavitha"], "org-acme")).resolves.toBe(true);
    await expect(allPeopleHere(["max-from-mech"], "org-acme")).resolves.toBe(false);
    await expect(allPeopleHere([null], "org-acme")).resolves.toBe(true);
  });

  it("idOrNull: a string id, null to clear, anything else refused", () => {
    expect(idOrNull("abc")).toBe("abc");
    expect(idOrNull("")).toBeNull();
    expect(idOrNull(null)).toBeNull();
    expect(idOrNull({ in: ["x"] })).toBe("invalid");
    expect(idOrNull(5)).toBe("invalid");
  });
});

describe("every gate and route uses the wall", () => {
  const read = (p: string) => readFileSync(p, "utf8");

  it("the List, Space and Folder gates deny a row in a workspace the person holds no seat in, and decide with the level held there", () => {
    const board = read("src/lib/board.ts");
    expect(board).toMatch(/const level = await levelInCompany\(userId, board\.organizationId\);\s+if \(!level\) return \{ board: null, role: "none" \};/);
    expect(board).toMatch(/nodeCtxFromLevel\(userId, board\.organizationId, level\)/);
    expect(board).toMatch(/delegatedNodeRole\(userId, board\.organizationId, level,/);
    const space = read("src/lib/space.ts");
    expect(space).toMatch(/const level = await levelInCompany\(userId, row\.organizationId\);\s+if \(!level\) return \{ row: null, role: "none" as NodeRole, level: null \};/);
    expect(space).toMatch(/delegatedNodeRole\(userId, row\.organizationId, level,/);
    const folder = read("src/lib/folder.ts");
    expect(folder).toMatch(/const level = await levelInCompany\(userId, space\.organizationId\);\s+if \(!level\) return \{ mode: "none" \};/);
    expect(folder).toMatch(/const level = await levelInCompany\(userId, folder\.organizationId\);\s+if \(!level\) return false;/);
  });

  const writes: Array<[string, RegExp]> = [
    ["src/app/api/role-instances/route.ts", /allPeopleHere\(\[userId\], orgId\)[\s\S]*allOwned\("scope", \[scopeId\], orgId\)/],
    ["src/app/api/role-instances/[id]/route.ts", /allPeopleHere\(\[userId\], orgId\)[\s\S]*allOwned\("scope", \[scopeId\], orgId\)/],
    ["src/app/api/scopes/route.ts", /allOwned\("scope", \[parentId\]/],
    ["src/app/api/scopes/[id]/route.ts", /allOwned\("scope", \[parentId\]/],
    ["src/app/api/kpis/route.ts", /allOwned\("kra", \[kraId\]/],
    ["src/app/api/sops/route.ts", /allOwned\("kra", \[kraId\], orgId\)/],
    ["src/app/api/ownership-areas/route.ts", /allOwned\("role", \[ownerRoleId\]/],
    ["src/app/api/ownership-areas/[id]/route.ts", /allOwned\("role", \[ownerRoleId\]/],
    ["src/app/api/thresholds/route.ts", /allOwned\("role", \[roleId\]/],
    ["src/app/api/kra-categories/route.ts", /kraCategory\.findFirst\(\{ where: \{ id, organizationId: orgId \}/],
    ["src/app/api/ideas/[id]/vote/route.ts", /allOwned\("idea", \[ideaId\]/],
    ["src/app/api/ideas/[id]/comments/route.ts", /allOwned\("idea", \[ideaId\]/],
    ["src/app/api/plan-lines/route.ts", /allOwned\("planScenario"[\s\S]*allOwned\("glAccount"[\s\S]*allOwned\("costCenter"[\s\S]*allOwned\("accountingPeriod"/],
    ["src/app/api/journal-entries/route.ts", /allOwned\("costCenter", centers, orgId\)/],
  ];
  for (const [file, rule] of writes) {
    it(`${file} checks the ids it stores`, () => expect(read(file)).toMatch(rule));
  }

  it("the KRA category rename no longer hands back the raw database message", () => {
    expect(read("src/app/api/kra-categories/route.ts")).not.toMatch(/err\.message/);
  });

  it("the job title page and the KRA list read this workspace's rows only", () => {
    const role = read("src/app/api/roles/[id]/route.ts");
    for (const rel of ["kraTemplates", "kpis", "ownedAreas", "boundaries", "instances"]) {
      expect(role, rel).toMatch(new RegExp(`${rel}: \\{\\s+where: \\{ organizationId: orgId \\}`));
    }
    expect(role).toMatch(/sops: \{ where: \{ organizationId: orgId \}/);
    expect(role).toMatch(/thresholds: \{ where: \{ organizationId: orgId \}/);
    expect(read("src/app/api/kras/route.ts")).toMatch(/kpis: \{\s+where: \{ organizationId: orgId \}/);
  });
});

describe("the review's fixes (a person seated in two workspaces, and the lows)", () => {
  const read = (p: string) => readFileSync(p, "utf8");

  it("notetaker save acts in the session's workspace and never writes into another's List", () => {
    const route = read("src/app/api/notetaker/save/route.ts");
    expect(route).toMatch(/const acting = await actingWorkspace\(user, /);
    expect(route).toMatch(/const orgId = acting\.organizationId;/);
    expect(route).toMatch(/if \(!board \|\| board\.organizationId !== orgId\) return NextResponse\.json\(\{ error: "That list no longer exists" \}, \{ status: 404 \}\);/);
    expect(route).not.toMatch(/organizationId: user\.organizationId/);
  });

  it("Save as template takes a List or a Space of the workspace it saves into only", () => {
    const route = read("src/app/api/template-center/save-as/route.ts");
    expect(route).toMatch(/if \(!board \|\| board\.organizationId !== orgId\) return jsonError\("List not found", 404\);/);
    expect(route).toMatch(/if \(!space \|\| space\.organizationId !== orgId\) return jsonError\("Space not found", 404\);/);
  });

  it("the Space admin shortcut reads the level held in the Space's workspace, never the one passed", () => {
    const space = read("src/lib/space.ts");
    for (const fn of ["canEditSpace", "canContributeSpace"]) {
      const at = space.indexOf(`export async function ${fn}(`);
      const body = space.slice(at, space.indexOf("\n}\n", at));
      expect(body, fn).toMatch(/const \{ row, role, level \} = await spaceRoleOf\(/);
      expect(body, fn).toMatch(/if \(isOrgAdminAccessLevel\(level \?\? undefined\)\) return true;/);
      expect(body, fn).not.toMatch(/isOrgAdminAccessLevel\(accessLevel\)/);
    }
  });

  it("visibleSpaceIds keeps only Spaces of a workspace the viewer holds a seat in", () => {
    const space = read("src/lib/space.ts");
    const at = space.indexOf("export async function visibleSpaceIds(");
    const body = space.slice(at, space.indexOf("\n}\n", at));
    expect(body).toMatch(/levelInCompany\(userId, o\)/);
    expect(body).toMatch(/if \(!level\) continue;/);
    expect(body).not.toMatch(/isOrgAdminAccessLevel\(accessLevel\)/);
  });

  it("plan lines check the driver too, and never hand back a database error", () => {
    const route = read("src/app/api/plan-lines/route.ts");
    expect(route).toMatch(/allOwned\("planDriver", ids\("driverId"\), orgId\)/);
    expect(route).toMatch(/e\.message\.startsWith\("each line needs"\) \? e\.message : "Couldn't save the plan lines"/);
  });

  it("a KRA category delete takes a plain id only", () => {
    expect(read("src/app/api/kra-categories/route.ts")).toMatch(/const id = typeof body\?\.id === "string" \? body\.id : "";\s+if \(!id\) return jsonError\("Category ID is required"\);\s+await prisma\.kraCategory\.deleteMany/);
  });

  it("another workspace's plan driver is refused", async () => {
    rowsByModel.planDriver = [{ id: "drv", organizationId: "org-mech" }];
    await expect(allOwned("planDriver", ["drv"], "org-acme")).resolves.toBe(false);
  });
});
