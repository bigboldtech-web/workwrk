// The loaders behind node-access: one world per request, never a load per row.
//
// A world is NodeRows (the shared facts of the nodes a question touches:
// every Folder on their chains, their Spaces, the anchors and parent pages of
// their docs, the Lists behind their tasks, the destinations of their forms,
// the sharing entries of their docs and the workspace's Private rule) plus the
// viewer's own rows on those nodes (ViewerGrants), or, for the Manage access
// panel and the fan-out filters, every person's rows.
//
// THE SHAPE OF A LOAD. Each round below issues its queries in parallel, and a
// round only runs when the one before it found something to follow:
//   1. the seed rows (docs with their whole parent chain in one recursive
//      CTE, canvases, tables, forms, tasks);
//   2. the Lists they name (seeds, doc and task anchors, form destinations);
//   3. every Folder on every chain, in one recursive CTE;
//   4. the Spaces, the doc sharing entries (jsonb_each over the needed keys
//      only) and the Private rule;
//   5. the viewer's rows on all of it (SpaceMember, FolderMember,
//      BoardMember, AccessGrant).
// An org admin stops after the rows: rule R1 needs nothing else.
//
// loadSpaceWorld is the Space-tree variant: every Folder and List of the
// Space, its SPACE and FOLDER docs (never its anchorless docs), the viewer's
// own listed docs walked up to their top anchor, the canvases and tables.
//
// Server-only: prisma. Lives under src/lib/access/, the one directory the G7
// lint lets read the member tables.

import { prisma } from "@/lib/prisma";
import { readDocLocks } from "../doc-lock";
import {
  emptyGrants,
  emptyRows,
  isListRung,
  objectGrantKey,
  topAnchorDoc,
  type CanvasFact,
  type DocFact,
  type FolderFact,
  type FormFact,
  type ItemFact,
  type ListFact,
  type MemberRole,
  type NodeCtx,
  type NodeRef,
  type NodeRows,
  type NodeViewer,
  type NodeVisibility,
  type PrivateRule,
  type SpaceFact,
  type TableFact,
  type ViewerGrants,
} from "./node-rules";
import { docSharingEntries, legacyCutoffOf, listedDocIds, objectGrants, readAccessModel, viewerObjectGrants, KIND_BY_OBJECT_TYPE } from "./access-grant-store";
import { legacyIsAdminLevel } from "./legacy-levels";
import { orgRoleOf } from "./org-role";
import { RULE_1_DENIED_STATUSES } from "./resolve";

export interface WorldSeeds {
  spaces?: Iterable<string>;
  folders?: Iterable<string>;
  lists?: Iterable<string>;
  docs?: Iterable<string>;
  items?: Iterable<string>;
  tables?: Iterable<string>;
  canvases?: Iterable<string>;
  forms?: Iterable<string>;
}

export function seedsOf(refs: NodeRef[]): WorldSeeds {
  const s: Record<string, string[]> = { spaces: [], folders: [], lists: [], docs: [], tables: [], canvases: [], forms: [] };
  const key: Record<NodeRef["kind"], string> = { space: "spaces", folder: "folders", list: "lists", doc: "docs", table: "tables", canvas: "canvases", form: "forms" };
  for (const r of refs) s[key[r.kind]].push(r.id);
  return s;
}

const uniq = (xs: Iterable<string | null | undefined>) => [...new Set([...xs].filter((x): x is string => !!x))];

// ── row mappers ──────────────────────────────────────────────────────

const SPACE_SELECT = {
  id: true, organizationId: true, name: true, slug: true, icon: true, color: true, visibility: true, ownerId: true,
  description: true, parentSpaceId: true, displayOrder: true,
} as const;

function spaceFact(r: { id: string; organizationId: string; name: string; slug: string; icon: string | null; color: string | null; visibility: string; ownerId: string | null; description: string | null; parentSpaceId: string | null; displayOrder: number }): SpaceFact {
  return { ...r, visibility: r.visibility as NodeVisibility };
}

const LIST_SELECT = {
  id: true, organizationId: true, spaceId: true, folderId: true, name: true, slug: true, icon: true, color: true, visibility: true, ownerId: true, settings: true,
} as const;

function listFact(r: { id: string; organizationId: string; spaceId: string | null; folderId: string | null; name: string; slug: string; icon: string | null; color: string | null; visibility: string; ownerId: string | null; settings: unknown }): ListFact {
  return { ...r, visibility: r.visibility as NodeVisibility };
}

const FOLDER_SELECT = {
  id: true, organizationId: true, spaceId: true, parentFolderId: true, name: true, icon: true, color: true, visibility: true, ownerId: true, position: true,
  archivedAt: true,
} as const;

function folderFact(r: { id: string; organizationId: string; spaceId: string; parentFolderId: string | null; name: string; icon: string | null; color: string | null; visibility: string; ownerId: string | null; position: number; archivedAt?: Date | null }): FolderFact {
  const { archivedAt, ...rest } = r;
  return { ...rest, visibility: r.visibility as NodeVisibility, position: Number(r.position), ...(archivedAt ? { archived: true } : {}) };
}

const DOC_SELECT = { id: true, organizationId: true, title: true, entityType: true, entityId: true, parentId: true, createdById: true, createdAt: true } as const;

// ── the recursive chains ─────────────────────────────────────────────

/** Docs and every parent page above them (depth under 9), org-scoped, in one query. */
async function docChains(organizationId: string, ids: string[]): Promise<DocFact[]> {
  if (ids.length === 0) return [];
  return prisma.$queryRaw<DocFact[]>`
    WITH RECURSIVE chain AS (
      SELECT d."id", d."organizationId", d."title", d."entityType", d."entityId", d."parentId", d."createdById", d."createdAt", 0 AS depth
      FROM "Doc" d WHERE d."id" = ANY(${ids}::text[]) AND d."organizationId" = ${organizationId}
      UNION
      SELECT p."id", p."organizationId", p."title", p."entityType", p."entityId", p."parentId", p."createdById", p."createdAt", c.depth + 1
      FROM "Doc" p JOIN chain c ON p."id" = c."parentId"
      WHERE c.depth < 9 AND p."organizationId" = ${organizationId}
    )
    SELECT DISTINCT ON ("id") "id", "organizationId", "title", "entityType", "entityId", "parentId", "createdById", "createdAt" FROM chain`;
}

/** Folders and every ancestor Folder (depth under 9), org-scoped, in one query. */
async function folderChains(organizationId: string, ids: string[]): Promise<FolderFact[]> {
  if (ids.length === 0) return [];
  const rows = await prisma.$queryRaw<Array<Omit<FolderFact, "visibility" | "archived"> & { visibility: string; archivedAt: Date | null }>>`
    WITH RECURSIVE chain AS (
      SELECT f."id", f."organizationId", f."spaceId", f."parentFolderId", f."name", f."icon", f."color", f."visibility"::text AS visibility, f."ownerId", f."position", f."archivedAt", 0 AS depth
      FROM "Folder" f WHERE f."id" = ANY(${ids}::text[]) AND f."organizationId" = ${organizationId}
      UNION
      SELECT p."id", p."organizationId", p."spaceId", p."parentFolderId", p."name", p."icon", p."color", p."visibility"::text, p."ownerId", p."position", p."archivedAt", c.depth + 1
      FROM "Folder" p JOIN chain c ON p."id" = c."parentFolderId"
      WHERE c.depth < 9 AND p."organizationId" = ${organizationId}
    )
    SELECT DISTINCT ON ("id") "id", "organizationId", "spaceId", "parentFolderId", "name", "icon", "color", "visibility", "ownerId", "position", "archivedAt" FROM chain`;
  return rows.map(folderFact);
}

// ── the rows ─────────────────────────────────────────────────────────

export interface LoadRowsOpts {
  /** Skip the Private rule read when the caller already holds it. */
  privateRule?: PrivateRule;
  /**
   * For an org admin: the rows only (R1), docs still with their parent pages
   * (R6a). Never for a path or a placement: those name the containers above
   * the node, which only the full chain holds.
   */
  rowsOnly?: boolean;
}

/** The shared facts of every node these seeds touch, and of every node on their chains. */
export async function loadRows(organizationId: string, seeds: WorldSeeds, opts: LoadRowsOpts = {}): Promise<NodeRows> {
  const rows = emptyRows(organizationId);
  const want = {
    spaces: new Set(uniq(seeds.spaces ?? [])),
    folders: new Set(uniq(seeds.folders ?? [])),
    lists: new Set(uniq(seeds.lists ?? [])),
    items: new Set(uniq(seeds.items ?? [])),
    tables: new Set(uniq(seeds.tables ?? [])),
  };
  const docIds = uniq(seeds.docs ?? []);
  const canvasIds = uniq(seeds.canvases ?? []);
  const formIds = uniq(seeds.forms ?? []);

  // Round 1: seeds.
  const [docs, canvases, forms, model, cutoff] = await Promise.all([
    docChains(organizationId, docIds),
    canvasIds.length
      ? prisma.whiteboard.findMany({ where: { id: { in: canvasIds }, organizationId }, select: { id: true, organizationId: true, spaceId: true, folderId: true, ownerId: true, name: true } })
      : Promise.resolve([]),
    formIds.length
      ? prisma.formDefinition.findMany({ where: { id: { in: formIds }, organizationId }, select: { id: true, organizationId: true, createdById: true, name: true, targetBoardId: true, targetTableId: true } })
      : Promise.resolve([]),
    opts.privateRule ? Promise.resolve(null) : readAccessModel(organizationId).catch(() => null),
    legacyCutoffOf(organizationId),
  ]);
  rows.privateRule = opts.privateRule ?? model?.privateRule ?? "legacy";
  rows.legacyBefore = cutoff;
  for (const d of docs) rows.docs.set(d.id, d);
  for (const c of canvases) rows.canvases.set(c.id, c as CanvasFact);
  for (const f of forms) rows.forms.set(f.id, f as FormFact);

  if (!opts.rowsOnly) {
    for (const d of docs) {
      if (!d.entityType || !d.entityId) continue;
      if (d.entityType === "SPACE") want.spaces.add(d.entityId);
      else if (d.entityType === "FOLDER") want.folders.add(d.entityId);
      else if (d.entityType === "BOARD") want.lists.add(d.entityId);
      else if (d.entityType === "BOARD_ITEM") want.items.add(d.entityId);
    }
    for (const c of canvases) {
      if (c.spaceId) want.spaces.add(c.spaceId);
      if (c.folderId) want.folders.add(c.folderId);
    }
    for (const f of forms) {
      if (f.targetBoardId) want.lists.add(f.targetBoardId);
      if (f.targetTableId) want.tables.add(f.targetTableId);
    }
  }

  // Round 2: tasks and tables, and the page locks of the docs (read by the
  // create rule alone: a locked page takes sub-pages from Full holders only).
  const lockIds = [...rows.docs.keys()];
  const [items, tables, locks] = await Promise.all([
    want.items.size
      ? prisma.item.findMany({ where: { id: { in: [...want.items] }, organizationId }, select: { id: true, organizationId: true, boardId: true } })
      : Promise.resolve([]),
    want.tables.size
      ? prisma.dataTable.findMany({ where: { id: { in: [...want.tables] }, organizationId }, select: { id: true, organizationId: true, spaceId: true, createdById: true, name: true, description: true } })
      : Promise.resolve([]),
    lockIds.length ? readDocLocks(lockIds) : Promise.resolve(new Map<string, unknown>()),
  ]);
  for (const id of locks.keys()) {
    const d = rows.docs.get(id);
    if (d) rows.docs.set(id, { ...d, locked: true });
  }
  for (const i of items) rows.items.set(i.id, i as ItemFact);
  for (const t of tables) rows.tables.set(t.id, t as TableFact);
  if (!opts.rowsOnly) {
    for (const i of items) want.lists.add(i.boardId);
    for (const t of tables) if (t.spaceId) want.spaces.add(t.spaceId);
  }

  // Round 3: Lists.
  const lists = want.lists.size
    ? await prisma.board.findMany({ where: { id: { in: [...want.lists] }, organizationId }, select: LIST_SELECT })
    : [];
  for (const l of lists) {
    rows.lists.set(l.id, listFact(l));
    if (!opts.rowsOnly) {
      if (l.spaceId) want.spaces.add(l.spaceId);
      if (l.folderId) want.folders.add(l.folderId);
    }
  }

  // Round 4: every Folder chain, then the Spaces, the sharing entries.
  const folders = opts.rowsOnly
    ? want.folders.size
      ? (await prisma.folder.findMany({ where: { id: { in: [...want.folders] }, organizationId }, select: FOLDER_SELECT })).map(folderFact)
      : []
    : await folderChains(organizationId, [...want.folders]);
  for (const f of folders) {
    rows.folders.set(f.id, f);
    if (!opts.rowsOnly) want.spaces.add(f.spaceId);
  }
  const [spaces, sharing] = await Promise.all([
    want.spaces.size ? prisma.space.findMany({ where: { id: { in: [...want.spaces] }, organizationId }, select: SPACE_SELECT }) : Promise.resolve([]),
    docSharingEntries(organizationId, [...rows.docs.keys()]),
  ]);
  for (const s of spaces) rows.spaces.set(s.id, spaceFact(s));
  rows.docSharing = sharing;
  return rows;
}

// ── the viewer's rows ────────────────────────────────────────────────

function viewerOf(ctx: NodeCtx): NodeViewer {
  return { userId: ctx.userId, orgAdmin: ctx.orgAdmin, orgGuest: ctx.orgGuest, isAgent: ctx.isAgent, denied: ctx.denied };
}

/** The viewer's own SpaceMember, FolderMember, BoardMember and AccessGrant rows on every node of the world. */
export async function loadViewerGrants(ctx: NodeCtx, rows: NodeRows): Promise<ViewerGrants> {
  const g = emptyGrants(viewerOf(ctx));
  if (ctx.orgAdmin || ctx.denied) return g;
  const spaceIds = [...rows.spaces.keys()];
  const folderIds = [...rows.folders.keys()];
  const listIds = [...rows.lists.keys()];
  const u = ctx.userId;
  const [sm, fm, bm, tg, cg, og] = await Promise.all([
    spaceIds.length ? prisma.spaceMember.findMany({ where: { userId: u, spaceId: { in: spaceIds } }, select: { spaceId: true, role: true, createdAt: true } }) : Promise.resolve([]),
    folderIds.length ? prisma.folderMember.findMany({ where: { userId: u, folderId: { in: folderIds } }, select: { folderId: true, role: true, createdAt: true } }) : Promise.resolve([]),
    listIds.length ? prisma.boardMember.findMany({ where: { userId: u, boardId: { in: listIds } }, select: { boardId: true, role: true, rung: true, createdAt: true } }) : Promise.resolve([]),
    objectGrants("table", [...rows.tables.keys()], { userId: u }),
    objectGrants("canvas", [...rows.canvases.keys()], { userId: u }),
    objectGrants("form", [...rows.forms.keys()], { userId: u }),
  ]);
  const since = new Map<string, number>();
  for (const r of sm) {
    g.space.set(r.spaceId, r.role as MemberRole);
    since.set(`space:${r.spaceId}`, r.createdAt.getTime());
  }
  for (const r of fm) {
    g.folder.set(r.folderId, r.role as MemberRole);
    since.set(`folder:${r.folderId}`, r.createdAt.getTime());
  }
  for (const r of bm) {
    g.list.set(r.boardId, r.role as MemberRole);
    if (r.role === "GUEST" && isListRung(r.rung)) (g.listRung ??= new Map()).set(r.boardId, r.rung);
    since.set(`list:${r.boardId}`, r.createdAt.getTime());
  }
  for (const r of [...tg, ...cg, ...og]) g.object.set(objectGrantKey(KIND_BY_OBJECT_TYPE[r.objectType], r.objectId), r.role);
  g.since = since;
  return g;
}

/**
 * A chain or batch world for one viewer. `chain` loads the containers above
 * the nodes even for an org admin (a crumb, a placement, a reveal): R1
 * decides without them, but a path cannot be named without them.
 */
export async function loadWorld(ctx: NodeCtx, refs: NodeRef[], opts: { chain?: boolean } = {}): Promise<{ rows: NodeRows; grants: ViewerGrants }> {
  const rows = await loadRows(ctx.organizationId, seedsOf(refs), { rowsOnly: ctx.orgAdmin && !opts.chain });
  const grants = await loadViewerGrants(ctx, rows);
  return { rows, grants };
}

// ── everyone's rows (the panel, the roster, the fan-out filters) ─────

export interface PersonFacts {
  id: string;
  name: string;
  email: string;
  avatar: string | null;
  /** Can still sign in: deletedAt null and not INACTIVE. */
  active: boolean;
  viewer: NodeViewer;
}

/** The people behind these ids, with the viewer flags the rules read. Other orgs' people are dropped. */
export async function loadPeople(organizationId: string, ids: string[]): Promise<Map<string, PersonFacts>> {
  const out = new Map<string, PersonFacts>();
  const want = uniq(ids);
  if (want.length === 0) return out;
  const users = await prisma.user.findMany({
    where: { id: { in: want }, organizationId },
    select: { id: true, firstName: true, lastName: true, email: true, avatar: true, accessLevel: true, status: true, deletedAt: true },
  });
  for (const u of users) {
    const level = u.accessLevel ?? "EMPLOYEE";
    const denied = u.deletedAt != null || RULE_1_DENIED_STATUSES.has(String(u.status));
    out.set(u.id, {
      id: u.id,
      name: `${u.firstName ?? ""} ${u.lastName ?? ""}`.trim() || u.email,
      email: u.email,
      avatar: u.avatar ?? null,
      active: !denied,
      viewer: {
        userId: u.id,
        orgAdmin: legacyIsAdminLevel(level),
        orgGuest: orgRoleOf({ accessLevel: level }) === "GUEST",
        isAgent: level === "AGENT",
        denied,
      },
    });
  }
  return out;
}

/** Every person's rows on every node of the world, keyed by person. */
export async function loadAllGrants(rows: NodeRows): Promise<Map<string, Omit<ViewerGrants, "viewer">>> {
  const spaceIds = [...rows.spaces.keys()];
  const folderIds = [...rows.folders.keys()];
  const listIds = [...rows.lists.keys()];
  const [sm, fm, bm, tg, cg, og] = await Promise.all([
    spaceIds.length ? prisma.spaceMember.findMany({ where: { spaceId: { in: spaceIds } }, select: { spaceId: true, userId: true, role: true, createdAt: true } }) : Promise.resolve([]),
    folderIds.length ? prisma.folderMember.findMany({ where: { folderId: { in: folderIds } }, select: { folderId: true, userId: true, role: true, createdAt: true } }) : Promise.resolve([]),
    listIds.length ? prisma.boardMember.findMany({ where: { boardId: { in: listIds } }, select: { boardId: true, userId: true, role: true, rung: true, createdAt: true } }) : Promise.resolve([]),
    objectGrants("table", [...rows.tables.keys()]),
    objectGrants("canvas", [...rows.canvases.keys()]),
    objectGrants("form", [...rows.forms.keys()]),
  ]);
  const out = new Map<string, Omit<ViewerGrants, "viewer">>();
  const of = (u: string) => {
    let g = out.get(u);
    if (!g) {
      g = { space: new Map(), folder: new Map(), list: new Map(), object: new Map(), since: new Map() };
      out.set(u, g);
    }
    return g;
  };
  for (const r of sm) {
    const g = of(r.userId);
    g.space.set(r.spaceId, r.role as MemberRole);
    g.since?.set(`space:${r.spaceId}`, r.createdAt.getTime());
  }
  for (const r of fm) {
    const g = of(r.userId);
    g.folder.set(r.folderId, r.role as MemberRole);
    g.since?.set(`folder:${r.folderId}`, r.createdAt.getTime());
  }
  for (const r of bm) {
    const g = of(r.userId);
    g.list.set(r.boardId, r.role as MemberRole);
    if (r.role === "GUEST" && isListRung(r.rung)) (g.listRung ??= new Map()).set(r.boardId, r.rung);
    g.since?.set(`list:${r.boardId}`, r.createdAt.getTime());
  }
  for (const r of [...tg, ...cg, ...og]) of(r.subjectId).object.set(objectGrantKey(KIND_BY_OBJECT_TYPE[r.objectType], r.objectId), r.role);
  return out;
}

/**
 * One person's rows from loadAllGrants as their ViewerGrants. Every field is
 * carried, the List rung included: a copy that names the fields one by one
 * drops any it does not name, and a Can comment row then reads as Can view.
 */
export function grantsWithViewer(viewer: NodeViewer, g: Omit<ViewerGrants, "viewer"> | undefined): ViewerGrants {
  return g ? { ...g, viewer } : emptyGrants(viewer);
}

/** Everyone listed on the world's docs, and every owner or creator of its nodes. */
export function peopleNamedByRows(rows: NodeRows): string[] {
  const ids = new Set<string>();
  for (const e of rows.docSharing.values()) {
    for (const u of Object.keys(e.members ?? {})) ids.add(u);
    for (const u of Object.keys(e.roles ?? {})) ids.add(u);
  }
  for (const f of rows.folders.values()) if (f.ownerId) ids.add(f.ownerId);
  for (const l of rows.lists.values()) if (l.ownerId) ids.add(l.ownerId);
  for (const d of rows.docs.values()) {
    if (d.createdById) ids.add(d.createdById);
    if (d.entityType === "NOTEPAD" && d.entityId) ids.add(d.entityId);
  }
  for (const t of rows.tables.values()) if (t.createdById) ids.add(t.createdById);
  for (const c of rows.canvases.values()) if (c.ownerId) ids.add(c.ownerId);
  for (const f of rows.forms.values()) if (f.createdById) ids.add(f.createdById);
  return [...ids];
}

/** The org's Owners and Admins (the admins line and R1 for the people evaluated). */
export async function loadOrgAdmins(organizationId: string): Promise<Set<string>> {
  const rows = await prisma.user.findMany({
    where: { organizationId, deletedAt: null, accessLevel: { in: ["SUPER_ADMIN", "COMPANY_ADMIN"] } },
    select: { id: true },
  });
  return new Set(rows.map((r) => r.id));
}

// ── the Space world ──────────────────────────────────────────────────

export interface SpaceWorldOpts {
  /** SPACE and FOLDER docs, and the viewer's own listed docs (the tree needs them; counts do not). */
  docs?: boolean;
}

/**
 * Everything the tree of these Spaces renders from, for one viewer, in a
 * fixed number of rounds however many Folders and Lists they hold.
 */
export async function loadSpaceWorld(ctx: NodeCtx, spaceIds: string[], opts: SpaceWorldOpts = { docs: true }): Promise<{ rows: NodeRows; grants: ViewerGrants }> {
  const org = ctx.organizationId;
  const ids = uniq(spaceIds);
  const rows = emptyRows(org);
  if (ids.length === 0) return { rows, grants: emptyGrants(viewerOf(ctx)) };

  const [spaces, folders, lists, canvases, tables, model, listed, cutoff] = await Promise.all([
    prisma.space.findMany({ where: { id: { in: ids }, organizationId: org }, select: SPACE_SELECT }),
    // Every Folder, the ones in Trash included and flagged: a role flows down
    // through a trashed Folder exactly as the chain loaders read it, and the
    // tree hides it and everything inside it (never lifting its children to
    // the Space root).
    prisma.folder.findMany({ where: { spaceId: { in: ids }, organizationId: org }, select: FOLDER_SELECT }),
    prisma.board.findMany({ where: { spaceId: { in: ids }, organizationId: org, archivedAt: null }, select: LIST_SELECT }),
    prisma.whiteboard.findMany({ where: { spaceId: { in: ids }, organizationId: org, archivedAt: null }, select: { id: true, organizationId: true, spaceId: true, folderId: true, ownerId: true, name: true } }),
    prisma.dataTable.findMany({ where: { spaceId: { in: ids }, organizationId: org }, select: { id: true, organizationId: true, spaceId: true, createdById: true, name: true, description: true } }),
    readAccessModel(org).catch(() => null),
    opts.docs && !ctx.orgAdmin && !ctx.denied ? listedDocIds(org, ctx.userId).catch(() => [] as string[]) : Promise.resolve([] as string[]),
    legacyCutoffOf(org),
  ]);
  rows.privateRule = model?.privateRule ?? "legacy";
  rows.legacyBefore = cutoff;
  for (const s of spaces) rows.spaces.set(s.id, spaceFact(s));
  for (const f of folders) rows.folders.set(f.id, folderFact(f));
  for (const l of lists) rows.lists.set(l.id, listFact(l));
  for (const c of canvases) rows.canvases.set(c.id, c as CanvasFact);
  for (const t of tables) rows.tables.set(t.id, t as TableFact);

  if (opts.docs) {
    const folderIds = [...rows.folders.keys()];
    const [spaceDocs, folderDocs, listedChain] = await Promise.all([
      prisma.doc.findMany({ where: { organizationId: org, entityType: "SPACE", entityId: { in: ids }, archivedAt: null }, select: DOC_SELECT }),
      folderIds.length
        ? prisma.doc.findMany({ where: { organizationId: org, entityType: "FOLDER", entityId: { in: folderIds }, archivedAt: null }, select: DOC_SELECT })
        : Promise.resolve([]),
      listed.length ? docChains(org, listed) : Promise.resolve([]),
    ]);
    for (const d of [...spaceDocs, ...folderDocs]) rows.docs.set(d.id, d);
    // The viewer's listed docs, kept when their top anchor falls in these
    // Spaces: the tree places them, the rest are another Space's business.
    const chainRows = emptyRows(org);
    for (const d of listedChain) chainRows.docs.set(d.id, d);
    const needItems = new Set<string>();
    for (const d of listedChain) if (d.entityType === "BOARD_ITEM" && d.entityId) needItems.add(d.entityId);
    const items = needItems.size
      ? await prisma.item.findMany({ where: { id: { in: [...needItems] }, organizationId: org }, select: { id: true, organizationId: true, boardId: true } })
      : [];
    for (const i of items) rows.items.set(i.id, i as ItemFact);
    const inSpace = (top: DocFact): boolean => {
      const id = top.entityId as string;
      switch (top.entityType) {
        case "SPACE":
          return rows.spaces.has(id);
        case "FOLDER":
          return rows.folders.has(id);
        case "BOARD":
          return rows.lists.has(id);
        case "BOARD_ITEM": {
          const item = rows.items.get(id);
          return !!item && rows.lists.has(item.boardId);
        }
        default:
          return false;
      }
    };
    for (const id of listed) {
      const d = chainRows.docs.get(id);
      if (!d) continue;
      const top = topAnchorDoc(chainRows, d);
      if (!top || !inSpace(top)) continue;
      // The doc and its whole chain up to the top anchor.
      let cursor: DocFact | undefined = d;
      for (let hops = 0; cursor && hops < 10; hops += 1) {
        rows.docs.set(cursor.id, cursor);
        if (cursor.id === top.id || !cursor.parentId) break;
        cursor = chainRows.docs.get(cursor.parentId);
      }
    }
    rows.docSharing = await docSharingEntries(org, [...rows.docs.keys()]);
  }

  const grants = await loadViewerGrants(ctx, rows);
  return { rows, grants };
}

/**
 * Path discovery (R10) for the Space list: only the viewer's own grant rows
 * (FolderMember, BoardMember, AccessGrant, listed docs, owned PRIVATE Folders
 * and Lists) and the chains above them, never a scan of a whole Space.
 */
export async function loadPathEvidence(ctx: NodeCtx): Promise<{ rows: NodeRows; grants: ViewerGrants; candidates: NodeRef[] }> {
  const org = ctx.organizationId;
  const u = ctx.userId;
  const [fm, bm, objects, listed, ownedFolders, ownedLists] = await Promise.all([
    prisma.folderMember.findMany({ where: { userId: u, folder: { organizationId: org, archivedAt: null } }, select: { folderId: true } }),
    prisma.boardMember.findMany({ where: { userId: u, board: { organizationId: org, archivedAt: null } }, select: { boardId: true } }),
    viewerObjectGrants(org, u).catch(() => []),
    listedDocIds(org, u).catch(() => [] as string[]),
    prisma.folder.findMany({ where: { organizationId: org, ownerId: u, visibility: "PRIVATE", archivedAt: null }, select: { id: true } }),
    prisma.board.findMany({ where: { organizationId: org, ownerId: u, visibility: "PRIVATE", archivedAt: null }, select: { id: true } }),
  ]);
  const candidates: NodeRef[] = [
    ...fm.map((r) => ({ kind: "folder" as const, id: r.folderId })),
    ...ownedFolders.map((r) => ({ kind: "folder" as const, id: r.id })),
    ...bm.map((r) => ({ kind: "list" as const, id: r.boardId })),
    ...ownedLists.map((r) => ({ kind: "list" as const, id: r.id })),
    ...listed.map((id) => ({ kind: "doc" as const, id })),
    ...objects.filter((o) => o.objectType !== "FORM").map((o) => ({ kind: KIND_BY_OBJECT_TYPE[o.objectType], id: o.objectId })),
  ];
  const rows = await loadRows(org, seedsOf(candidates));
  const grants = await loadViewerGrants(ctx, rows);
  return { rows, grants, candidates };
}
