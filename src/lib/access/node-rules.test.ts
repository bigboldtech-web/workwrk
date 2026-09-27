// The one access model's rules (node-rules.ts), in two halves.
//
// THE PARITY GRID. Every world the grid enumerates is described once by its
// parameters, and from those parameters the test builds BOTH the NodeRows
// the new rules decide over and, independently, the LegacyInputs struct
// parity.ts's transcription of today's helpers reads. Wherever today's
// helpers admit a person (getBoardForReader or the folder-grantee union for a
// List, folderReadable for a Folder, docAccessible plus resolveDocRole for a
// doc), the new answer must still read, except in the worlds a named
// NODE_ACCESS_DELTAS row explains, and each failing world must be explained
// by exactly one row. Under the legacy Private rule nothing may fail (the
// floor keeps every existing row's reach, sub-pages included); under the
// strict rule N1 to N7.
//
// THE CASES. One block per rule of the design, each asserting the answers the
// design names.

import { describe, expect, it } from "vitest";
import {
  NODE_ACCESS_DELTAS,
  applyDocLock,
  decide,
  docHomeConfines,
  docLeavesEveryPlace,
  docMoveNeedsFull,
  moveDecision,
  decideAll,
  emptyGrants,
  emptyRows,
  higherRole,
  memberToRole,
  nodeCtxFromLevel,
  NodeEvaluator,
  objectGrantKey,
  pathContainers,
  readDocSharingEntry,
  readPrivateRule,
  roleAtLeast,
  spaceMemberToRole,
  toContainerRole,
  toDocRole,
  toLegacyPermission,
  type DocSharingFact,
  type MemberRole,
  type NodeKind,
  type NodeRole,
  type NodeRows,
  type NodeViewer,
  type NodeVisibility,
  type PrivateRule,
  type ViewerGrants,
} from "./node-rules";
import { legacyAllows, type LegacyInputs, type SpaceRoleValue } from "./parity";
import { legacyResolveDocRole } from "./legacy-floor";

const ORG = "org-1";
const ME = "u-me";
const OTHER = "u-other";

function viewer(over: Partial<NodeViewer> = {}): NodeViewer {
  return { userId: ME, orgAdmin: false, orgGuest: false, isAgent: false, denied: false, ...over };
}

// ── a small world builder ─────────────────────────────────────────────

class World {
  rows: NodeRows;
  g: ViewerGrants;
  constructor(rule: PrivateRule = "strict", v: NodeViewer = viewer()) {
    this.rows = emptyRows(ORG, rule);
    this.g = emptyGrants(v);
  }
  space(id: string, visibility: NodeVisibility = "WORKSPACE") {
    this.rows.spaces.set(id, { id, organizationId: ORG, name: `Space ${id}`, slug: id, icon: null, color: null, visibility, ownerId: OTHER });
    return this;
  }
  folder(id: string, spaceId: string, o: { parent?: string | null; visibility?: NodeVisibility; ownerId?: string | null } = {}) {
    this.rows.folders.set(id, {
      id, organizationId: ORG, spaceId, parentFolderId: o.parent ?? null, name: `Folder ${id}`, icon: null, color: null,
      visibility: o.visibility ?? "WORKSPACE", ownerId: o.ownerId ?? OTHER, position: 0,
    });
    return this;
  }
  list(id: string, spaceId: string | null, folderId: string | null, o: { visibility?: NodeVisibility; ownerId?: string | null } = {}) {
    this.rows.lists.set(id, {
      id, organizationId: ORG, spaceId, folderId, name: `List ${id}`, slug: id, icon: null, color: null,
      visibility: o.visibility ?? "WORKSPACE", ownerId: o.ownerId ?? OTHER,
    });
    return this;
  }
  doc(id: string, o: { entityType?: string | null; entityId?: string | null; parentId?: string | null; createdById?: string | null } = {}) {
    this.rows.docs.set(id, {
      id, organizationId: ORG, title: `Doc ${id}`, entityType: o.entityType ?? null, entityId: o.entityId ?? null,
      parentId: o.parentId ?? null, createdById: o.createdById ?? OTHER,
    });
    return this;
  }
  item(id: string, boardId: string) {
    this.rows.items.set(id, { id, organizationId: ORG, boardId });
    return this;
  }
  table(id: string, spaceId: string | null, createdById: string | null = OTHER) {
    this.rows.tables.set(id, { id, organizationId: ORG, spaceId, createdById, name: `Table ${id}` });
    return this;
  }
  canvas(id: string, spaceId: string | null, folderId: string | null = null, ownerId: string | null = OTHER) {
    this.rows.canvases.set(id, { id, organizationId: ORG, spaceId, folderId, ownerId, name: `Canvas ${id}` });
    return this;
  }
  form(id: string, o: { createdById?: string | null; targetBoardId?: string | null; targetTableId?: string | null } = {}) {
    this.rows.forms.set(id, {
      id, organizationId: ORG, createdById: o.createdById ?? OTHER, name: `Form ${id}`,
      targetBoardId: o.targetBoardId ?? null, targetTableId: o.targetTableId ?? null,
    });
    return this;
  }
  sharing(docId: string, entry: DocSharingFact) {
    this.rows.docSharing.set(docId, entry);
    return this;
  }
  onSpace(id: string, role: MemberRole) {
    this.g.space.set(id, role);
    return this;
  }
  onFolder(id: string, role: MemberRole) {
    this.g.folder.set(id, role);
    return this;
  }
  onList(id: string, role: MemberRole) {
    this.g.list.set(id, role);
    return this;
  }
  onObject(kind: "table" | "canvas" | "form", id: string, role: MemberRole) {
    this.g.object.set(objectGrantKey(kind, id), role);
    return this;
  }
  as(v: Partial<NodeViewer>) {
    this.g = { ...this.g, viewer: viewer(v) };
    return this;
  }
  rule(r: PrivateRule) {
    this.rows.privateRule = r;
    return this;
  }
  role(kind: NodeKind, id: string): NodeRole {
    return decide(this.rows, this.g, { kind, id }).role;
  }
  d(kind: NodeKind, id: string) {
    return decide(this.rows, this.g, { kind, id });
  }
}

const readable = (r: NodeRole) => roleAtLeast(r, "VIEW");

// ── THE PARITY GRID ───────────────────────────────────────────────────

type Vis = "WORKSPACE" | "PRIVATE" | "ORG";

interface GridWorld {
  admin: boolean;
  sVis: "WORKSPACE" | "ORG";
  sRole: SpaceRoleValue | null;
  /** The parent folder P of F, or null. */
  p: { vis: Vis; role: SpaceRoleValue | null } | null;
  f: { vis: Vis; role: SpaceRoleValue | null; owner: boolean };
  l: { vis: Vis; role: SpaceRoleValue | null; owner: boolean; inFolder: boolean };
}

function* gridWorlds(opts: { lean?: boolean } = {}): Generator<GridWorld> {
  const sRoles: Array<SpaceRoleValue | null> = opts.lean ? [null, "OWNER", "MEMBER", "GUEST"] : [null, "OWNER", "ADMIN", "MEMBER", "GUEST"];
  const parents: Array<GridWorld["p"]> = opts.lean
    ? [null, { vis: "PRIVATE", role: null }, { vis: "PRIVATE", role: "ADMIN" }, { vis: "WORKSPACE", role: "ADMIN" }]
    : [null, ...(["WORKSPACE", "PRIVATE"] as Vis[]).flatMap((vis) => ([null, "ADMIN", "GUEST"] as Array<SpaceRoleValue | null>).map((role) => ({ vis, role })))];
  const fRoles: Array<SpaceRoleValue | null> = [null, "ADMIN", "GUEST"];
  const lVis: Vis[] = opts.lean ? ["WORKSPACE", "PRIVATE"] : ["WORKSPACE", "PRIVATE", "ORG"];
  const lRoles: Array<SpaceRoleValue | null> = [null, "GUEST"];
  for (const admin of [false, true])
    for (const sVis of ["WORKSPACE", "ORG"] as const)
      for (const sRole of sRoles)
        for (const p of parents)
          for (const fVis of ["WORKSPACE", "PRIVATE"] as Vis[])
            for (const fRole of fRoles)
              for (const fOwner of [false, true])
                for (const lv of lVis)
                  for (const lRole of lRoles)
                    for (const lOwner of opts.lean ? [false] : [false, true])
                      for (const inFolder of opts.lean ? [true] : [true, false])
                        yield {
                          admin, sVis, sRole, p,
                          f: { vis: fVis, role: fRole, owner: fOwner },
                          l: { vis: lv, role: lRole, owner: lOwner, inFolder },
                        };
}

/** The NodeRows and ViewerGrants a grid world describes. */
function buildNew(w: GridWorld, rule: PrivateRule): World {
  const x = new World(rule, viewer({ orgAdmin: w.admin }));
  x.space("S", w.sVis);
  if (w.sRole) x.onSpace("S", w.sRole);
  if (w.p) {
    x.folder("P", "S", { visibility: w.p.vis });
    if (w.p.role) x.onFolder("P", w.p.role);
  }
  x.folder("F", "S", { parent: w.p ? "P" : null, visibility: w.f.vis, ownerId: w.f.owner ? ME : OTHER });
  if (w.f.role) x.onFolder("F", w.f.role);
  x.list("L", "S", w.l.inFolder ? "F" : null, { visibility: w.l.vis, ownerId: w.l.owner ? ME : OTHER });
  if (w.l.role) x.onList("L", w.l.role);
  return x;
}

// Today's struct, built from the parameters directly (never from NodeRows),
// so the comparison is between two independent descriptions of one world.
function legacySpace(w: GridWorld) {
  return { id: "S", organizationId: ORG, visibility: w.sVis, ownerId: OTHER, memberRole: w.sRole };
}
function legacyFolderF(w: GridWorld) {
  return {
    id: "F", organizationId: ORG, spaceId: "S", parentFolderId: w.p ? "P" : null, visibility: w.f.vis,
    ownerId: w.f.owner ? ME : OTHER, memberRole: w.f.role, ancestorMemberRole: w.p?.role ?? null,
  };
}
function legacyBoardL(w: GridWorld) {
  return {
    id: "L", organizationId: ORG, spaceId: "S", folderId: w.l.inFolder ? "F" : null, visibility: w.l.vis,
    ownerId: w.l.owner ? ME : OTHER, memberRole: w.l.role,
  };
}
function legacyBase(w: GridWorld): LegacyInputs {
  return { userId: ME, organizationId: ORG, accessLevel: w.admin ? "COMPANY_ADMIN" : "EMPLOYEE", space: legacySpace(w) };
}
function legacyFolderReads(w: GridWorld): boolean {
  return legacyAllows({ ...legacyBase(w), folder: legacyFolderF(w) }, "folderReadable");
}
function legacyBoardReads(w: GridWorld): boolean {
  const i: LegacyInputs = { ...legacyBase(w), board: legacyBoardL(w) };
  if (w.l.inFolder) i.folder = legacyFolderF(w);
  return legacyAllows(i, "getBoardForReader");
}
/** board.ts:700-716: a FolderMember row on the List's Folder or an ancestor. */
function legacyUnion(w: GridWorld): boolean {
  return w.l.inFolder && (!!w.f.role || !!w.p?.role);
}

type FolderBranch = "admin" | "member" | "owner" | "ancestor" | "space" | "none";
function folderBranch(w: GridWorld): FolderBranch {
  if (w.admin) return "admin";
  if (w.f.role) return "member";
  if (w.f.owner) return "owner";
  if (w.p?.role) return "ancestor";
  if (w.f.vis === "PRIVATE") return "none";
  return w.sVis === "ORG" || w.sRole ? "space" : "none";
}
/** A PRIVATE Folder above F that gives the viewer nothing under the strict rule. */
function privateCutAboveF(w: GridWorld): boolean {
  return !!w.p && w.p.vis === "PRIVATE" && !w.p.role && !w.admin;
}

type ListBranch = "admin" | "member" | "org" | "owner" | "pierce" | "space" | "union" | "none";
function listBranch(w: GridWorld): ListBranch {
  if (w.admin) return "admin";
  if (w.l.role) return "member";
  const cascadeBlocks = w.l.inFolder && w.f.vis === "PRIVATE" && !w.f.owner;
  if (!cascadeBlocks) {
    if (w.l.vis === "ORG") return "org";
    if (w.l.vis === "PRIVATE") {
      if (w.l.owner) return "owner";
      if (w.sRole === "OWNER") return "pierce";
    } else if (w.sVis === "ORG" || w.sRole) return "space";
  }
  return legacyUnion(w) ? "union" : "none";
}

/** The ONE named row that explains a readable-today world the strict rules refuse, or "unexplained". */
function explainFolder(w: GridWorld): string {
  const b = folderBranch(w);
  if (b === "owner" && w.f.vis !== "PRIVATE") return "N7";
  if (b === "ancestor" && w.f.vis === "PRIVATE") return "N1";
  if (b === "space" && privateCutAboveF(w)) return "N2";
  return "unexplained";
}
function explainList(w: GridWorld): string {
  const b = listBranch(w);
  // F holds no strict role of its own under a cut Parent: no row, and ownership needs reach unless F is PRIVATE.
  const fStrictNone = !w.f.role && !(w.f.owner && w.f.vis === "PRIVATE");
  if ((b === "org" || b === "pierce" || b === "space") && w.l.inFolder && privateCutAboveF(w) && fStrictNone) return "N2";
  if (b === "union" && w.l.vis === "PRIVATE") return "N6";
  if (b === "union" && w.l.vis !== "PRIVATE" && w.f.vis === "PRIVATE" && !w.f.role) return "N2";
  if (b === "union" && w.l.vis !== "PRIVATE" && privateCutAboveF(w) && !w.f.role) return "N2";
  return "unexplained";
}

// The grids walk tens of thousands of worlds; a loaded machine must not
// trip the default 5 second timeout.
const GRID_TIMEOUT = 30_000;

describe("the parity grid: Folders and Lists", () => {
  for (const rule of ["legacy", "strict"] as const) {
    it(`keeps every world today's helpers admit readable under the ${rule} rule, save the named rows`, () => {
      const allowed = rule === "legacy" ? new Set<string>() : new Set(["N1", "N2", "N6", "N7"]);
      const failures: string[] = [];
      let checked = 0;
      for (const w of gridWorlds()) {
        const x = buildNew(w, rule);
        const ev = new NodeEvaluator(x.rows, x.g);
        if (legacyFolderReads(w)) {
          checked += 1;
          if (!readable(ev.decision({ kind: "folder", id: "F" }).role)) {
            const why = explainFolder(w);
            if (!allowed.has(why)) failures.push(`folder ${why} ${JSON.stringify(w)}`);
          }
        }
        if (legacyBoardReads(w) || legacyUnion(w)) {
          checked += 1;
          if (!readable(ev.decision({ kind: "list", id: "L" }).role)) {
            const why = explainList(w);
            if (!allowed.has(why)) failures.push(`list ${why} ${JSON.stringify(w)}`);
          }
        }
      }
      expect(checked).toBeGreaterThan(10000);
      expect(failures.slice(0, 5)).toEqual([]);
    }, GRID_TIMEOUT);
  }

  it("under the strict rule every named row actually occurs in the grid", () => {
    const seen = new Set<string>();
    for (const w of gridWorlds()) {
      const x = buildNew(w, "strict");
      if (legacyFolderReads(w) && !readable(x.role("folder", "F"))) seen.add(explainFolder(w));
      if ((legacyBoardReads(w) || legacyUnion(w)) && !readable(x.role("list", "L"))) seen.add(explainList(w));
    }
    expect([...seen].sort()).toEqual(["N1", "N2", "N6", "N7"]);
  }, GRID_TIMEOUT);
});

// Doc worlds: the lean container grid times every anchor and sharing shape.
type Anchor = "SPACE" | "FOLDER" | "BOARD" | "BOARD_ITEM" | "ROOT" | "SUBPAGE";
interface SharingCase { entry: DocSharingFact | null; creator: boolean }
const SHARING: SharingCase[] = (
  [
    null,
    { restricted: true },
    { restricted: true, members: { [ME]: "view" } },
    { members: { [ME]: "view" } },
    { members: { [ME]: "edit" } },
  ] as Array<DocSharingFact | null>
).flatMap((entry) => [false, true].map((creator) => ({ entry, creator })));

function addDoc(x: World, anchor: Anchor, s: SharingCase) {
  const createdById = s.creator ? ME : OTHER;
  switch (anchor) {
    case "SPACE":
      x.doc("D", { entityType: "SPACE", entityId: "S", createdById });
      break;
    case "FOLDER":
      x.doc("D", { entityType: "FOLDER", entityId: "F", createdById });
      break;
    case "BOARD":
      x.doc("D", { entityType: "BOARD", entityId: "L", createdById });
      break;
    case "BOARD_ITEM":
      x.item("I", "L").doc("D", { entityType: "BOARD_ITEM", entityId: "I", createdById });
      break;
    case "ROOT":
      x.doc("D", { createdById });
      break;
    case "SUBPAGE":
      x.doc("PARENT", { entityType: "FOLDER", entityId: "F" }).doc("D", { parentId: "PARENT", createdById });
      break;
  }
  if (s.entry) x.sharing("D", s.entry);
}

function legacyDocReads(w: GridWorld, anchor: Anchor, s: SharingCase): boolean {
  const i: LegacyInputs = legacyBase(w);
  const createdById = s.creator ? ME : OTHER;
  const docAnchor =
    anchor === "SPACE" ? { entityType: "SPACE", entityId: "S" }
    : anchor === "FOLDER" ? { entityType: "FOLDER", entityId: "F" }
    : anchor === "BOARD" ? { entityType: "BOARD", entityId: "L" }
    : anchor === "BOARD_ITEM" ? { entityType: "BOARD_ITEM", entityId: "I" }
    : { entityType: null, entityId: null };
  i.doc = { id: "D", organizationId: ORG, createdById, anchor: docAnchor };
  if (anchor === "FOLDER") i.folder = legacyFolderF(w);
  if (anchor === "BOARD" || anchor === "BOARD_ITEM") {
    i.board = legacyBoardL(w);
    if (w.l.inFolder) i.folder = legacyFolderF(w);
  }
  if (anchor === "BOARD_ITEM") i.item = { id: "I", organizationId: ORG, boardId: "L", ownerId: null, assigneeIds: [] };
  if (!legacyAllows(i, "docAccessible")) return false;
  return legacyResolveDocRole(s.entry ?? undefined, { userId: ME, accessLevel: i.accessLevel, createdById }) !== null;
}

function explainDoc(w: GridWorld, anchor: Anchor): string {
  if (anchor === "SUBPAGE") return "N5";
  if (anchor === "FOLDER") return explainFolder(w);
  if (anchor === "BOARD" || anchor === "BOARD_ITEM") {
    if (legacyBoardReads(w)) return explainList(w);
    // Admitted only by boardReadableWithFolder's folder fallback.
    if (w.l.vis === "PRIVATE") return "N4";
    return explainFolder(w);
  }
  return "unexplained";
}

describe("the parity grid: docs", () => {
  const anchors: Anchor[] = ["SPACE", "FOLDER", "BOARD", "BOARD_ITEM", "ROOT", "SUBPAGE"];
  for (const rule of ["legacy", "strict"] as const) {
    it(`keeps every doc today's gates admit readable under the ${rule} rule, save the named rows`, () => {
      const allowed = rule === "legacy" ? new Set<string>() : new Set(["N1", "N2", "N4", "N5", "N6", "N7"]);
      const failures: string[] = [];
      let checked = 0;
      for (const w of gridWorlds({ lean: true })) {
        for (const anchor of anchors) {
          for (const s of SHARING) {
            if (!legacyDocReads(w, anchor, s)) continue;
            checked += 1;
            const x = buildNew(w, rule);
            addDoc(x, anchor, s);
            if (!readable(x.role("doc", "D"))) {
              const why = explainDoc(w, anchor);
              if (!allowed.has(why)) failures.push(`${anchor} ${why} ${JSON.stringify(s)} ${JSON.stringify(w)}`);
            }
          }
        }
      }
      expect(checked).toBeGreaterThan(5000);
      expect(failures.slice(0, 5)).toEqual([]);
    }, GRID_TIMEOUT);
  }
});

// ── the rules, case by case ───────────────────────────────────────────

/** The AX test shape: Space S with Folder A (holding A1 and a PRIVATE sub-folder), Folder B, Lists in each. */
function axWorld(rule: PrivateRule = "strict") {
  return new World(rule)
    .space("S")
    .folder("A", "S")
    .folder("A1", "S", { parent: "A" })
    .folder("AP", "S", { parent: "A", visibility: "PRIVATE" })
    .folder("B", "S")
    .list("LA", "S", "A")
    .list("LAP", "S", "A", { visibility: "PRIVATE" })
    .list("LA1", "S", "A1")
    .list("LIN", "S", "AP")
    .list("LB", "S", "B")
    .list("LROOT", "S", null);
}

describe("roles never climb", () => {
  it("a FolderMember ADMIN on A is Full on A, A1 and their Lists and nothing on the Space or on B", () => {
    for (const rule of ["legacy", "strict"] as const) {
      const x = axWorld(rule).onFolder("A", "ADMIN");
      expect(x.role("folder", "A")).toBe("FULL");
      expect(x.role("folder", "A1")).toBe("FULL");
      expect(x.role("list", "LA")).toBe("FULL");
      expect(x.role("list", "LA1")).toBe("FULL");
      expect(x.role("space", "S")).toBe("none");
      expect(x.role("folder", "B")).toBe("none");
      expect(x.role("list", "LB")).toBe("none");
      expect(x.role("list", "LROOT")).toBe("none");
    }
  });

  it("names the Space as a path container, with no role", () => {
    const x = axWorld().onFolder("A", "ADMIN");
    const s = x.d("space", "S");
    expect(s.role).toBe("none");
    expect(s.path).toBe(true);
    expect(x.d("folder", "B").path).toBe(false);
  });

  it("a List grant makes its Folder a path, never a role", () => {
    const x = axWorld().onList("LA1", "MEMBER");
    expect(x.role("list", "LA1")).toBe("EDIT");
    expect(x.d("folder", "A1")).toMatchObject({ role: "none", path: true });
    expect(x.d("folder", "A")).toMatchObject({ role: "none", path: true });
    expect(x.d("space", "S")).toMatchObject({ role: "none", path: true });
    expect(x.role("list", "LA")).toBe("none");
  });
});

describe("inheritance down", () => {
  it("a Space MEMBER holds Can edit through nested Folders", () => {
    const x = new World().space("S").onSpace("S", "MEMBER")
      .folder("F1", "S").folder("F2", "S", { parent: "F1" }).folder("F3", "S", { parent: "F2" }).list("L", "S", "F3");
    expect(x.role("folder", "F3")).toBe("EDIT");
    expect(x.role("list", "L")).toBe("EDIT");
    expect(x.d("list", "L").via).toEqual({ type: "inherited", node: { kind: "space", id: "S" }, source: "SpaceMember" });
  });

  it("names the nearest ancestor holding the grant", () => {
    const x = new World().space("S").onSpace("S", "MEMBER").folder("F1", "S").onFolder("F1", "MEMBER").folder("F2", "S", { parent: "F1" });
    expect(x.d("folder", "F2").via).toEqual({ type: "inherited", node: { kind: "folder", id: "F1" }, source: "FolderMember" });
  });
});

describe("the PRIVATE cut", () => {
  it("in strict mode an ancestor grant stops at a PRIVATE sub-folder", () => {
    const x = axWorld().onFolder("A", "ADMIN");
    expect(x.role("folder", "AP")).toBe("none");
    expect(x.role("list", "LIN")).toBe("none");
  });

  it("a direct FolderMember on the PRIVATE folder reads it", () => {
    expect(axWorld().onFolder("AP", "GUEST").role("folder", "AP")).toBe("VIEW");
  });

  it("a Space MEMBER does not read a PRIVATE folder", () => {
    expect(axWorld().onSpace("S", "MEMBER").role("folder", "AP")).toBe("none");
  });

  it("a List under a WORKSPACE child of a PRIVATE folder is none", () => {
    const x = axWorld().onSpace("S", "MEMBER").folder("APC", "S", { parent: "AP" }).list("LAPC", "S", "APC");
    expect(x.role("list", "LAPC")).toBe("none");
    expect(x.role("folder", "APC")).toBe("none");
  });

  it("the legacy floor keeps each of those reads as today", () => {
    const a = axWorld("legacy").onFolder("A", "ADMIN");
    expect(a.role("folder", "AP")).toBe("VIEW");
    expect(a.d("folder", "AP").via).toEqual({ type: "floor", node: { kind: "folder", id: "AP" } });
    expect(a.role("list", "LIN")).toBe("VIEW");
    expect(a.role("list", "LAP")).toBe("VIEW");
    const b = axWorld("legacy").onSpace("S", "MEMBER").folder("APC", "S", { parent: "AP" }).list("LAPC", "S", "APC");
    expect(b.role("list", "LAPC")).toBe("EDIT");
    expect(b.role("folder", "APC")).toBe("VIEW");
  });

  it("the floor never creates a path", () => {
    const x = new World("legacy").space("S").folder("Q", "S").folder("P", "S", { parent: "Q", visibility: "PRIVATE" })
      .folder("QQ", "S", { parent: "P" }).onFolder("Q", "ADMIN");
    // Q is Full (own), P reads through the floor only: no path anywhere.
    expect(x.role("folder", "P")).toBe("VIEW");
    expect(x.d("folder", "P").strictRole).toBe("none");
    expect(pathContainers(x.rows, x.g).size).toBe(1); // the Space above Q
    expect(pathContainers(x.rows, x.g).has("space:S")).toBe(true);
  });
});

describe("lift, grants never cut, PRIVATE Lists", () => {
  it("lift: a Space ADMIN named GUEST on a PRIVATE folder holds Full access on it", () => {
    const x = axWorld().onSpace("S", "ADMIN").onFolder("AP", "GUEST");
    expect(x.role("folder", "AP")).toBe("FULL");
    expect(x.d("folder", "AP").via).toEqual({ type: "lift", node: { kind: "folder", id: "AP" } });
  });

  it("a Space ADMIN not named on the PRIVATE folder holds nothing on it", () => {
    expect(axWorld().onSpace("S", "ADMIN").role("folder", "AP")).toBe("none");
  });

  it("grants never cut: a BoardMember on a List inside a PRIVATE folder reads it", () => {
    const x = axWorld().onList("LIN", "GUEST");
    expect(x.role("list", "LIN")).toBe("VIEW");
    expect(x.d("folder", "AP").path).toBe(true);
  });

  it("the owner of a List inside someone else's PRIVATE folder keeps it", () => {
    const x = axWorld().list("MINE", "S", "AP", { ownerId: ME });
    expect(x.role("list", "MINE")).toBe("none"); // WORKSPACE List, no reach: N7
    const y = axWorld().list("MINE", "S", "AP", { ownerId: ME, visibility: "PRIVATE" });
    expect(y.role("list", "MINE")).toBe("FULL");
  });

  it("PRIVATE List: a Space MEMBER none, a BoardMember GUEST Can view, the owner Full", () => {
    expect(axWorld().onSpace("S", "MEMBER").role("list", "LAP")).toBe("none");
    expect(axWorld().onList("LAP", "GUEST").role("list", "LAP")).toBe("VIEW");
    expect(axWorld().list("LAP", "S", "A", { visibility: "PRIVATE", ownerId: ME }).role("list", "LAP")).toBe("FULL");
  });

  it("PRIVATE List: the Space OWNER pierces it only where the folder is not cut", () => {
    expect(axWorld().onSpace("S", "OWNER").role("list", "LAP")).toBe("FULL");
    expect(axWorld().onSpace("S", "OWNER").d("list", "LAP").via).toEqual({ type: "pierce", node: { kind: "space", id: "S" } });
    const x = axWorld().onSpace("S", "OWNER").list("LPP", "S", "AP", { visibility: "PRIVATE" });
    expect(x.role("list", "LPP")).toBe("none");
  });

  it("ORG List: Can view at the root and in open folders, none under an unnamed PRIVATE folder in strict mode", () => {
    const x = axWorld().list("O1", "S", null, { visibility: "ORG" }).list("O2", "S", "A", { visibility: "ORG" }).list("O3", "S", "AP", { visibility: "ORG" });
    expect(x.role("list", "O1")).toBe("VIEW");
    expect(x.role("list", "O2")).toBe("VIEW");
    expect(x.role("list", "O3")).toBe("none");
    expect(x.d("list", "O1").via).toEqual({ type: "everyone", node: { kind: "list", id: "O1" } });
  });
});

describe("highest of, the Owner rung, revocation", () => {
  it("Space GUEST plus Folder ADMIN is Full; Space ADMIN plus Folder GUEST is Full", () => {
    expect(axWorld().onSpace("S", "GUEST").onFolder("A", "ADMIN").role("folder", "A")).toBe("FULL");
    expect(axWorld().onSpace("S", "ADMIN").onFolder("A", "GUEST").role("folder", "A")).toBe("FULL");
  });

  it("the OWNER rung ranks above Full and every Full gate accepts it", () => {
    const x = axWorld().onSpace("S", "OWNER");
    expect(x.role("space", "S")).toBe("OWNER");
    expect(roleAtLeast("OWNER", "FULL")).toBe(true);
    expect(higherRole("OWNER", "FULL")).toBe("OWNER");
    // Below the Space the rung is Full access.
    expect(x.role("folder", "A")).toBe("FULL");
  });

  it("the owner of a WORKSPACE Folder or List with no Space role is none in strict mode", () => {
    const x = axWorld().folder("MINE", "S", { ownerId: ME }).list("MYL", "S", null, { ownerId: ME });
    expect(x.role("folder", "MINE")).toBe("none");
    expect(x.role("list", "MYL")).toBe("none");
  });

  it("the owner of a PRIVATE one keeps Full access", () => {
    const x = axWorld().folder("MINE", "S", { ownerId: ME, visibility: "PRIVATE" });
    expect(x.role("folder", "MINE")).toBe("FULL");
    expect(x.d("folder", "MINE").via).toEqual({ type: "owner", node: { kind: "folder", id: "MINE" } });
  });

  it("in legacy mode the folder owner keeps Can view through the floor", () => {
    expect(axWorld("legacy").folder("MINE", "S", { ownerId: ME }).role("folder", "MINE")).toBe("VIEW");
  });
});

describe("docs", () => {
  const docs = () =>
    new World().space("S").folder("F", "S").list("L", "S", "F").list("LP", "S", "F", { visibility: "PRIVATE" }).item("I", "L");

  it("a Space GUEST on a SPACE doc edits it", () => {
    expect(docs().onSpace("S", "GUEST").doc("D", { entityType: "SPACE", entityId: "S" }).role("doc", "D")).toBe("EDIT");
  });

  it("restricted and unlisted is none; restricted and listed view (legacy) is Can comment", () => {
    const x = docs().onSpace("S", "MEMBER").doc("D", { entityType: "SPACE", entityId: "S" });
    expect(x.sharing("D", { restricted: true }).role("doc", "D")).toBe("none");
    expect(x.sharing("D", { restricted: true, members: { [ME]: "view" } }).role("doc", "D")).toBe("COMMENT");
  });

  it("the creator of a restricted doc holds Full with anchor reach and nothing without", () => {
    const x = docs().onSpace("S", "GUEST").doc("D", { entityType: "SPACE", entityId: "S", createdById: ME }).sharing("D", { restricted: true });
    expect(x.role("doc", "D")).toBe("FULL");
    const y = docs().doc("D", { entityType: "SPACE", entityId: "S", createdById: ME }).sharing("D", { restricted: true });
    expect(y.role("doc", "D")).toBe("none");
  });

  it("a legacy cap keeps a Space MEMBER's listed view on an unrestricted doc at Can comment, not Can edit", () => {
    const x = docs().onSpace("S", "MEMBER").doc("D", { entityType: "SPACE", entityId: "S" }).sharing("D", { members: { [ME]: "view" } });
    expect(x.role("doc", "D")).toBe("COMMENT");
    expect(x.d("doc", "D").via).toEqual({ type: "own", node: { kind: "doc", id: "D" }, source: "DocSharingLegacy" });
  });

  it("a roles grant of Can view on a Space MEMBER stays Can edit (a grant maxes with inherited roles)", () => {
    const x = docs().onSpace("S", "MEMBER").doc("D", { entityType: "SPACE", entityId: "S" })
      .sharing("D", { members: { [ME]: "view" }, roles: { [ME]: "VIEW" } });
    expect(x.role("doc", "D")).toBe("EDIT");
  });

  it("a roles grant of Can view is read only where nothing else reaches", () => {
    const x = docs().doc("D", { entityType: "SPACE", entityId: "S" }).sharing("D", { restricted: true, members: { [ME]: "view" }, roles: { [ME]: "VIEW" } });
    expect(x.role("doc", "D")).toBe("VIEW");
    expect(x.rule("legacy").role("doc", "D")).toBe("VIEW");
  });

  it("a Space ADMIN on an unlisted doc holds Full", () => {
    expect(docs().onSpace("S", "ADMIN").doc("D", { entityType: "FOLDER", entityId: "F" }).role("doc", "D")).toBe("FULL");
  });

  it("a listing pierces reach", () => {
    const x = docs().doc("D", { entityType: "FOLDER", entityId: "F" }).sharing("D", { roles: { [ME]: "COMMENT" }, members: { [ME]: "view" } });
    expect(x.role("doc", "D")).toBe("COMMENT");
    expect(x.d("folder", "F").path).toBe(true);
    expect(x.d("space", "S").path).toBe(true);
  });

  it("a legacy listing pierces too", () => {
    expect(docs().doc("D", { entityType: "FOLDER", entityId: "F" }).sharing("D", { members: { [ME]: "edit" } }).role("doc", "D")).toBe("EDIT");
  });

  it("a note is its owner's alone, org admins included", () => {
    const x = docs().doc("N", { entityType: "NOTEPAD", entityId: ME });
    expect(x.role("doc", "N")).toBe("FULL");
    const other = docs().as({ userId: "u-admin", orgAdmin: true }).doc("N", { entityType: "NOTEPAD", entityId: ME });
    expect(other.role("doc", "N")).toBe("none");
    const listed = docs().doc("N", { entityType: "NOTEPAD", entityId: OTHER }).sharing("N", { roles: { [ME]: "EDIT" } });
    expect(listed.role("doc", "N")).toBe("none");
  });

  it("a doc on a PRIVATE List follows the List (N4), and the floor keeps it in legacy mode", () => {
    const x = docs().onFolder("F", "GUEST").doc("D", { entityType: "BOARD", entityId: "LP" });
    expect(x.role("doc", "D")).toBe("none");
    expect(x.rule("legacy").role("doc", "D")).toBe("EDIT");
  });

  it("a doc on a task follows the task's List; a gone task is none", () => {
    const x = docs().onSpace("S", "GUEST").doc("D", { entityType: "BOARD_ITEM", entityId: "I" }).doc("G", { entityType: "BOARD_ITEM", entityId: "gone" });
    expect(x.role("doc", "D")).toBe("EDIT");
    expect(x.role("doc", "G")).toBe("none");
  });

  it("an anchor type the model does not know stays open, as today", () => {
    expect(docs().doc("D", { entityType: "LEAD", entityId: "x" }).role("doc", "D")).toBe("EDIT");
  });

  it("a root doc is the whole org's", () => {
    expect(docs().doc("D").role("doc", "D")).toBe("EDIT");
    expect(docs().doc("D", { createdById: ME }).role("doc", "D")).toBe("FULL");
  });

  it("the page lock reads Can comment below Full and never widens", () => {
    expect(applyDocLock("EDIT", true)).toBe("COMMENT");
    expect(applyDocLock("COMMENT", true)).toBe("COMMENT");
    expect(applyDocLock("VIEW", true)).toBe("VIEW");
    expect(applyDocLock("FULL", true)).toBe("FULL");
    expect(applyDocLock("EDIT", false)).toBe("EDIT");
  });
});

describe("A6: sub-pages follow their parent", () => {
  const tree = (rule: PrivateRule = "strict") =>
    new World(rule).space("S").folder("F", "S")
      .doc("TOP", { entityType: "FOLDER", entityId: "F" })
      .doc("C1", { parentId: "TOP" })
      .doc("C2", { parentId: "C1" })
      .doc("C3", { parentId: "C2" });

  it("a restricted parent and an unlisted viewer is none", () => {
    const x = tree().onSpace("S", "MEMBER").sharing("TOP", { restricted: true });
    expect(x.role("doc", "C1")).toBe("none");
    expect(x.role("doc", "C3")).toBe("none");
  });

  it("a readable parent gives exactly its role over three levels", () => {
    const view = tree().onSpace("S", "GUEST").sharing("TOP", { roles: { [ME]: "VIEW" }, restricted: true });
    expect(view.role("doc", "TOP")).toBe("VIEW");
    expect(view.role("doc", "C3")).toBe("VIEW");
    const full = tree().onSpace("S", "ADMIN");
    expect(full.role("doc", "C3")).toBe("FULL");
    expect(full.d("doc", "C3").via).toEqual({ type: "inherited", node: { kind: "space", id: "S" }, source: "SpaceMember" });
  });

  it("an own listing adds and an own restricted cuts", () => {
    const adds = tree().onSpace("S", "GUEST").sharing("TOP", { restricted: true, roles: { [ME]: "VIEW" } }).sharing("C2", { roles: { [ME]: "EDIT" } });
    expect(adds.role("doc", "C2")).toBe("EDIT");
    expect(adds.role("doc", "C3")).toBe("EDIT");
    const cuts = tree().onSpace("S", "MEMBER").sharing("C2", { restricted: true });
    expect(cuts.role("doc", "C1")).toBe("EDIT");
    expect(cuts.role("doc", "C2")).toBe("none");
    expect(cuts.role("doc", "C3")).toBe("none");
  });

  it("an anchored doc with a parent follows its anchor", () => {
    const x = tree().onSpace("S", "GUEST").folder("F2", "S", { visibility: "PRIVATE" })
      .doc("ANCH", { entityType: "FOLDER", entityId: "F2", parentId: "TOP" });
    expect(x.role("doc", "TOP")).toBe("EDIT");
    expect(x.role("doc", "ANCH")).toBe("none");
  });

  it("a missing or cyclic parent is none", () => {
    const x = tree().onSpace("S", "MEMBER").doc("ORPHAN", { parentId: "gone" }).doc("LOOP1", { parentId: "LOOP2" }).doc("LOOP2", { parentId: "LOOP1" });
    expect(x.role("doc", "ORPHAN")).toBe("none");
    expect(x.role("doc", "LOOP1")).toBe("none");
    expect(x.role("doc", "LOOP2")).toBe("none");
  });

  it("a NOTEPAD ancestor makes a sub-page its owner's alone", () => {
    const x = tree().onSpace("S", "MEMBER").doc("NOTE", { entityType: "NOTEPAD", entityId: OTHER }).doc("UNDER", { parentId: "NOTE" });
    expect(x.role("doc", "UNDER")).toBe("none");
    const mine = tree().doc("NOTE", { entityType: "NOTEPAD", entityId: ME }).doc("UNDER", { parentId: "NOTE" });
    expect(mine.role("doc", "UNDER")).toBe("FULL");
  });

  it("the sub-page of a floor-read parent reads through the parent in legacy mode, never in strict mode", () => {
    const x = new World("legacy").space("S").folder("A", "S").folder("AP", "S", { parent: "A", visibility: "PRIVATE" })
      .onFolder("A", "ADMIN").doc("DP", { entityType: "FOLDER", entityId: "AP" }).doc("DPS", { parentId: "DP" });
    expect(x.role("doc", "DP")).toBe("EDIT");
    expect(x.role("doc", "DPS")).toBe("EDIT");
    x.rule("strict");
    expect(x.role("doc", "DP")).toBe("none");
    expect(x.role("doc", "DPS")).toBe("none");
  });
});

describe("tables", () => {
  const t = () => new World().space("S").table("T", "S").table("U", null);
  it("a Space reader edits, a Space ADMIN manages", () => {
    expect(t().onSpace("S", "GUEST").role("table", "T")).toBe("EDIT");
    expect(t().onSpace("S", "ADMIN").role("table", "T")).toBe("FULL");
  });
  it("an unscoped table: a member edits, a Guest does not, a Guest creator manages", () => {
    expect(t().role("table", "U")).toBe("EDIT");
    expect(t().as({ orgGuest: true }).role("table", "U")).toBe("none");
    expect(t().as({ orgGuest: true }).table("U", null, ME).role("table", "U")).toBe("FULL");
  });
  it("a TABLE grant gives Can edit to a non-reader, and a creator without Space reach holds nothing", () => {
    expect(t().onObject("table", "T", "MEMBER").role("table", "T")).toBe("EDIT");
    expect(t().table("T", "S", ME).role("table", "T")).toBe("none");
  });
});

describe("canvases", () => {
  const c = (rule: PrivateRule = "strict") =>
    new World(rule).space("S").folder("F", "S").folder("PF", "S", { visibility: "PRIVATE" })
      .canvas("W", "S", "F").canvas("WP", "S", "PF").canvas("STALE", "S", "not-here").canvas("FREE", null);
  it("follows its Folder in strict mode", () => {
    expect(c().onFolder("F", "GUEST").role("canvas", "W")).toBe("VIEW");
    expect(c().onFolder("F", "ADMIN").role("canvas", "W")).toBe("FULL");
  });
  it("is none for Space members inside a PRIVATE folder, and the floor keeps it in legacy mode (N3)", () => {
    expect(c().onSpace("S", "MEMBER").role("canvas", "WP")).toBe("none");
    expect(c("legacy").onSpace("S", "MEMBER").role("canvas", "WP")).toBe("EDIT");
  });
  it("a stale folderId uses the Space; an unscoped canvas is Can edit", () => {
    expect(c().onSpace("S", "GUEST").role("canvas", "STALE")).toBe("VIEW");
    expect(c().role("canvas", "FREE")).toBe("EDIT");
  });
  it("the owner holds Full access only with reach, and a grant pierces", () => {
    expect(c().canvas("W", "S", "F", ME).role("canvas", "W")).toBe("none");
    expect(c().onSpace("S", "GUEST").canvas("W", "S", "F", ME).role("canvas", "W")).toBe("FULL");
    expect(c().onObject("canvas", "WP", "GUEST").role("canvas", "WP")).toBe("VIEW");
  });
});

describe("forms", () => {
  const f = () => new World().space("S").list("L", "S", null).form("FM", { targetBoardId: "L" }).form("FREE");
  it("a Member opens a form read-only when its List is out of reach (round five: the form follows its destination), a Guest does not, a Guest creator manages, a Guest with a FORM grant views", () => {
    expect(f().role("form", "FM")).toBe("VIEW");
    expect(f().onList("L", "MEMBER").role("form", "FM")).toBe("EDIT");
    expect(f().role("form", "FREE")).toBe("EDIT");
    expect(f().as({ orgGuest: true }).role("form", "FM")).toBe("none");
    expect(f().as({ orgGuest: true }).form("FM", { createdById: ME }).role("form", "FM")).toBe("FULL");
    expect(f().as({ orgGuest: true }).onObject("form", "FM", "GUEST").role("form", "FM")).toBe("VIEW");
  });
  it("responses need destination reach, and a form grant never bypasses it", () => {
    const member = f();
    expect(new NodeEvaluator(member.rows, member.g).formResponsesAllowed("FM")).toBe(false);
    const grantee = f().onObject("form", "FM", "ADMIN");
    expect(grantee.role("form", "FM")).toBe("FULL");
    expect(new NodeEvaluator(grantee.rows, grantee.g).formResponsesAllowed("FM")).toBe(false);
    const reader = f().onSpace("S", "GUEST");
    expect(new NodeEvaluator(reader.rows, reader.g).formResponsesAllowed("FM")).toBe(true);
    const creator = f().form("FM", { createdById: ME, targetBoardId: "L" });
    expect(new NodeEvaluator(creator.rows, creator.g).formResponsesAllowed("FM")).toBe(true);
    const free = f();
    expect(new NodeEvaluator(free.rows, free.g).formResponsesAllowed("FREE")).toBe(true);
  });
  it("a table grant counts as reach for a form feeding that table (W8)", () => {
    const x = new World().space("S").table("T", "S").form("FT", { targetTableId: "T" }).onObject("table", "T", "MEMBER");
    expect(new NodeEvaluator(x.rows, x.g).formResponsesAllowed("FT")).toBe(true);
  });
});

describe("the denied viewer, the admin and the context", () => {
  it("a denied viewer holds nothing anywhere", () => {
    const x = axWorld().onSpace("S", "OWNER").as({ denied: true, orgAdmin: true });
    for (const [k, id] of [["space", "S"], ["folder", "A"], ["list", "LA"]] as const) expect(x.role(k, id)).toBe("none");
    expect(pathContainers(x.rows, x.g).size).toBe(0);
  });

  it("an org admin holds Full access on every node that exists, and nothing on one that does not", () => {
    const x = axWorld().as({ orgAdmin: true });
    expect(x.role("folder", "AP")).toBe("FULL");
    expect(x.role("list", "LAP")).toBe("FULL");
    expect(x.role("folder", "missing")).toBe("none");
  });

  it("nodeCtxFromLevel(undefined) is a Member and never a Guest", () => {
    expect(nodeCtxFromLevel("u", "o", undefined)).toMatchObject({ orgAdmin: false, orgGuest: false, isAgent: false });
    expect(nodeCtxFromLevel("u", "o", null).orgGuest).toBe(false);
    expect(nodeCtxFromLevel("u", "o", "COMPANY_ADMIN").orgAdmin).toBe(true);
    expect(nodeCtxFromLevel("u", "o", "AGENT")).toMatchObject({ isAgent: true, orgGuest: false });
    expect(nodeCtxFromLevel("u", "o", "SOMETHING_ELSE").orgGuest).toBe(true);
  });

  it("decideAll answers every node of the world over one evaluator", () => {
    const x = axWorld().onFolder("A", "ADMIN");
    const all = decideAll(x.rows, x.g);
    expect(all.get("folder:A")?.role).toBe("FULL");
    expect(all.get("space:S")?.path).toBe(true);
    expect(all.size).toBe(x.rows.spaces.size + x.rows.folders.size + x.rows.lists.size);
  });
});

describe("the mapping helpers", () => {
  it("maps member rows onto the ladder", () => {
    expect(spaceMemberToRole("OWNER")).toBe("OWNER");
    expect(spaceMemberToRole("ADMIN")).toBe("FULL");
    expect(memberToRole("OWNER")).toBe("FULL");
    expect(memberToRole("MEMBER")).toBe("EDIT");
    expect(memberToRole("GUEST")).toBe("VIEW");
  });
  it("toContainerRole, toLegacyPermission and toDocRole", () => {
    expect(["OWNER", "FULL", "EDIT", "COMMENT", "VIEW", "none"].map((r) => toContainerRole(r as NodeRole))).toEqual(["full", "full", "edit", "comment", "view", null]);
    expect(["OWNER", "FULL", "EDIT", "COMMENT", "VIEW", "none"].map((r) => toLegacyPermission(r as NodeRole))).toEqual(["admin", "admin", "edit", "read", "read", "none"]);
    expect(["FULL", "EDIT", "COMMENT", "VIEW", "none"].map((r) => toDocRole(r as NodeRole))).toEqual(["edit", "edit", "view", "view", null]);
  });
  it("reads a docSharing entry and the Private rule defensively", () => {
    const settings = { docSharing: { d1: { restricted: true, members: { a: "view", b: "bogus" }, roles: { a: "COMMENT", c: "OWNER" } } }, accessModel: { privateRule: "strict" } };
    expect(readDocSharingEntry(settings, "d1")).toEqual({ restricted: true, members: { a: "view" }, roles: { a: "COMMENT" } });
    expect(readDocSharingEntry(settings, "nope")).toBeUndefined();
    expect(readDocSharingEntry(null, "d1")).toBeUndefined();
    expect(readDocSharingEntry({ docSharing: [] }, "d1")).toBeUndefined();
    expect(readPrivateRule(settings)).toBe("strict");
    expect(readPrivateRule({})).toBe("legacy");
    expect(readPrivateRule({ accessModel: { privateRule: "odd" } })).toBe("legacy");
  });
});

describe("NODE_ACCESS_DELTAS", () => {
  it("names every row once, with the modes the design gives", () => {
    const ids = NODE_ACCESS_DELTAS.map((d) => d.id);
    expect(new Set(ids).size).toBe(ids.length);
    const strict = NODE_ACCESS_DELTAS.filter((d) => d.mode === "strict").map((d) => d.id).sort();
    expect(strict).toEqual(["N1", "N2", "N3", "N4", "N5", "N6", "N7"]);
    // Nothing narrows on deploy: every narrowing waits for the strict rule (A8).
    expect(NODE_ACCESS_DELTAS.filter((d) => d.kind === "narrowing" && d.mode === "always")).toEqual([]);
  });
  it("uses no em dash and no double hyphen in any sentence", () => {
    for (const d of NODE_ACCESS_DELTAS) {
      expect(d.text).not.toMatch(/—|--/);
      expect(d.legacySource).not.toMatch(/—|--/);
    }
  });
});

// ── findings from the review of the node access branch ───────────────

describe("moves (moveDecision)", () => {
  const CUTOFF = Date.UTC(2026, 8, 25);
  const canvasWorld = () => {
    const w = new World("legacy").space("S", "PRIVATE").folder("F", "S").canvas("C", "S", "F");
    w.rows.legacyBefore = CUTOFF;
    w.g.since = new Map();
    return w;
  };
  it("a Can edit grant on a canvas's Folder never takes it out of every Space", () => {
    const w = canvasWorld().onFolder("F", "MEMBER");
    w.g.since?.set("folder:F", CUTOFF + 1);
    expect(w.role("canvas", "C")).toBe("EDIT");
    expect(moveDecision(w.rows, w.g, { kind: "canvas", id: "C" }, null)).toBe(false);
  });
  it("Full access on the Folder alone does not either: leaving the Space needs Full access on the Space it leaves (P2)", () => {
    const w = canvasWorld().onFolder("F", "ADMIN");
    w.g.since?.set("folder:F", CUTOFF + 1);
    expect(moveDecision(w.rows, w.g, { kind: "canvas", id: "C" }, null)).toBe(false);
    // The Space manager takes it out whether they own it or not (P7, round
    // six); at the org root its owner or an org admin brings it back.
    const owner = new World("legacy").space("S", "PRIVATE").folder("F", "S").canvas("C", "S", "F", ME).onSpace("S", "ADMIN");
    owner.rows.legacyBefore = CUTOFF;
    expect(moveDecision(owner.rows, owner.g, { kind: "canvas", id: "C" }, null)).toBe(true);
    const manager = canvasWorld().onSpace("S", "ADMIN");
    expect(moveDecision(manager.rows, manager.g, { kind: "canvas", id: "C" }, null)).toBe(true);
  });
  it("a Space contributor from before the cutoff no longer does: a move needs Full access on the canvas and where it is (P2, delta M6)", () => {
    const w = canvasWorld().onSpace("S", "MEMBER");
    w.g.since?.set("space:S", CUTOFF - 1);
    expect(moveDecision(w.rows, w.g, { kind: "canvas", id: "C" }, null)).toBe(false);
  });
  it("a canvas already outside every Space: a move to where it is is a reorder (P4), Full access on the canvas, and the route writes nothing for it", () => {
    const w = new World("legacy").canvas("C", null);
    expect(moveDecision(w.rows, w.g, { kind: "canvas", id: "C" }, null)).toBe(false);
    const owner = new World("legacy").canvas("C", null, null, ME);
    expect(moveDecision(owner.rows, owner.g, { kind: "canvas", id: "C" }, null)).toBe(true);
  });
  it("an Agent who is a Space admin moves a List like anyone else (A8)", () => {
    const w = new World("legacy").space("S").space("T").list("L", "S", null).onSpace("S", "ADMIN").onSpace("T", "ADMIN").as({ isAgent: true });
    expect(moveDecision(w.rows, w.g, { kind: "list", id: "L" }, { kind: "space", id: "T" })).toBe(true);
  });
  it("a Space admin from before the cutoff still moves a List into a Private Folder that does not name them (A8), a new one does not", () => {
    const build = (at: number) => {
      const w = new World("legacy").space("S").folder("PF", "S", { visibility: "PRIVATE" }).list("L", "S", null).onSpace("S", "ADMIN");
      w.rows.legacyBefore = CUTOFF;
      w.g.since = new Map([["space:S", at]]);
      return w;
    };
    const old = build(CUTOFF - 1);
    expect(moveDecision(old.rows, old.g, { kind: "list", id: "L" }, { kind: "folder", id: "PF" })).toBe(true);
    const fresh = build(CUTOFF + 1);
    expect(moveDecision(fresh.rows, fresh.g, { kind: "list", id: "L" }, { kind: "folder", id: "PF" })).toBe(false);
  });
  it("a denied viewer moves nothing", () => {
    const w = new World("legacy").canvas("C", null).as({ denied: true });
    expect(moveDecision(w.rows, w.g, { kind: "canvas", id: "C" }, null)).toBe(false);
  });
});

describe("a doc leaving every place (docLeavesEveryPlace)", () => {
  const at = (entityType: string | null, entityId: string | null, parentId: string | null) => ({ entityType, entityId, parentId });
  it("is an anchored doc or a sub-page ending with neither an anchor nor a parent", () => {
    expect(docLeavesEveryPlace(at("FOLDER", "F", null), at(null, null, null))).toBe(true);
    expect(docLeavesEveryPlace(at(null, null, "P"), at(null, null, null))).toBe(true);
  });
  it("is not a move between places, or a root doc staying a root doc", () => {
    expect(docLeavesEveryPlace(at("FOLDER", "F", null), at("SPACE", "S", null))).toBe(false);
    expect(docLeavesEveryPlace(at("FOLDER", "F", null), at(null, null, "P"))).toBe(false);
    expect(docLeavesEveryPlace(at(null, null, null), at(null, null, null))).toBe(false);
  });
});

describe("a doc move that can open it to the org (docMoveNeedsFull)", () => {
  const at = (entityType: string | null, entityId: string | null, parentId: string | null) => ({ entityType, entityId, parentId });
  const confinedBoth = { before: true, after: true };
  it("dropping its own anchor needs Full, even nested under a page in the same Folder", () => {
    expect(docMoveNeedsFull(at("FOLDER", "F", null), at(null, null, "P"), confinedBoth)).toBe(true);
    expect(docMoveNeedsFull(at("FOLDER", "F", null), at(null, null, "P"), { before: true, after: false })).toBe(true);
    expect(docMoveNeedsFull(at("SPACE", "S", null), at(null, null, null), { before: true, after: false })).toBe(true);
  });
  it("a sub-page nesting under a page the whole org opens needs Full", () => {
    expect(docMoveNeedsFull(at(null, null, "P1"), at(null, null, "ROOT"), { before: true, after: false })).toBe(true);
  });
  it("moves between places, reorders and nesting inside a confined tree stay a Can edit move", () => {
    expect(docMoveNeedsFull(at("FOLDER", "F", null), at("SPACE", "S", null), confinedBoth)).toBe(false);
    expect(docMoveNeedsFull(at("FOLDER", "F", null), at("FOLDER", "F", "P"), confinedBoth)).toBe(false);
    expect(docMoveNeedsFull(at(null, null, "P1"), at(null, null, "P2"), confinedBoth)).toBe(false);
    expect(docMoveNeedsFull(at(null, null, "P1"), at(null, null, "P2"), { before: false, after: false })).toBe(false);
    expect(docMoveNeedsFull(at(null, null, null), at(null, null, "P"), { before: false, after: false })).toBe(false);
  });
});

describe("where a page chain lives (docHomeConfines)", () => {
  it("a Space, Folder, List, task or note anchor confines; an unknown anchor type is open", () => {
    for (const t of ["SPACE", "FOLDER", "BOARD", "BOARD_ITEM", "NOTEPAD"]) {
      expect(docHomeConfines({ kind: "anchor", entityType: t, entityId: "x" }, false)).toBe(true);
    }
    expect(docHomeConfines({ kind: "anchor", entityType: "PROJECT", entityId: "x" }, false)).toBe(false);
  });
  it("a root chain is the org's unless a restricted page is on it; a broken chain reaches nobody", () => {
    expect(docHomeConfines({ kind: "root" }, false)).toBe(false);
    expect(docHomeConfines({ kind: "root" }, true)).toBe(true);
    expect(docHomeConfines({ kind: "closed" }, false)).toBe(true);
  });
});

describe("new grants and the legacy rule (A2 for new rows, A8 for existing ones)", () => {
  const CUTOFF = Date.UTC(2026, 8, 25);
  const tree = (at: number) => {
    const w = new World("legacy").space("S").folder("F", "S").folder("FP", "S", { parent: "F", visibility: "PRIVATE" })
      .list("LP", "S", "F", { visibility: "PRIVATE" }).list("LO", "S", "F").onFolder("F", "MEMBER");
    w.rows.legacyBefore = CUTOFF;
    w.g.since = new Map([["folder:F", at]]);
    return w;
  };
  it("a Folder grant made by this release reaches the open List inside and no Private item", () => {
    const w = tree(CUTOFF + 1);
    expect(w.role("list", "LO")).toBe("EDIT");
    expect(w.role("list", "LP")).toBe("none");
    expect(w.role("folder", "FP")).toBe("none");
  });
  it("a Folder grant from before it keeps today's reach into them", () => {
    const w = tree(CUTOFF - 1);
    expect(w.role("list", "LP")).toBe("VIEW");
    expect(w.role("folder", "FP")).toBe("VIEW");
  });
  it("a sub-page made before the cutoff keeps its org-wide reach under an unreachable parent; one made after follows the parent", () => {
    const w = new World("legacy").space("S", "PRIVATE").doc("P", { entityType: "SPACE", entityId: "S" });
    w.rows.legacyBefore = CUTOFF;
    w.rows.docs.set("OLD", { id: "OLD", organizationId: ORG, title: "old", entityType: null, entityId: null, parentId: "P", createdById: OTHER, createdAt: new Date(CUTOFF - 1) });
    w.rows.docs.set("NEW", { id: "NEW", organizationId: ORG, title: "new", entityType: null, entityId: null, parentId: "P", createdById: OTHER, createdAt: new Date(CUTOFF + 1) });
    expect(w.role("doc", "P")).toBe("none");
    expect(w.role("doc", "OLD")).toBe("EDIT");
    expect(w.role("doc", "NEW")).toBe("none");
    // N5: the strict rule takes the older reach away.
    w.rule("strict");
    expect(w.role("doc", "OLD")).toBe("none");
  });
});
