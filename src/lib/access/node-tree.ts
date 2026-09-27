// What one person sees of one Space, and who can reach one node, as pure
// functions of a loaded world.
//
// assembleSpaceTree builds exactly the shape GET /api/spaces/[id]/children
// answers: every Folder at its real depth, the Lists, docs, tables and
// canvases the viewer can open, and the PATH containers (decision A3) that
// lead to what they were given, named and nothing else. accessEntries builds
// the people half of the Manage access panel (decision A7).
//
// The tree's rules, in order:
//   * a node renders when its role is Can view or higher and its parent
//     renders, or when it is a path container;
//   * a path container shows only the branches that lead to a grant: never
//     a sibling, never a child that is readable only because everyone at the
//     org can open it, never a count of anything hidden;
//   * PRIVATE Folders and Lists the viewer cannot open are pruned;
//   * a Folder in Trash renders nothing, neither itself nor anything inside
//     it (access still reads through it, as every chain loader does);
//   * a canvas nests under its Folder only when that Folder is in the same
//     Space and renders; otherwise a readable canvas sits at the Space root;
//   * SPACE and FOLDER docs render under their container; a doc the viewer
//     was given whose natural parent does not render (an unreadable parent
//     page, or an unreadable List or task anchor) hangs under the nearest
//     rendering container of its top anchor;
//   * the legacy floor never creates a path and never moves a node: a node
//     readable only through it renders only under a parent that renders.
//
// Pure: imports ./access-panel, ./node-rules and ./grant-plan.

import {
  ACCESS_NODE_NOUN,
  MANAGE_BAR,
  PANEL_ROLE_RANK,
  type AccessDirectEntry,
  type AccessGeneral,
  type AccessGrantSource,
  type AccessInheritedEntry,
  type AccessNodeKind,
  type AccessPerson,
  type AccessVia,
  type PanelRole,
} from "./access-panel";
import {
  NodeEvaluator,
  anchorContainers,
  canvasFolderOf,
  docShape,
  folderParentOf,
  listFolderOf,
  memberToRole,
  notepadOwnerOf,
  objectGrantKey,
  placementContainers,
  refKey,
  roleAtLeast,
  spaceMemberToRole,
  toContainerRole,
  topAnchorDoc,
  type DocFact,
  type FolderFact,
  type NodeDecision,
  type NodeRef,
  type NodeRole,
  type NodeRows,
  type NodeVia,
  type NodeVisibility,
  type PrivateRule,
  type TreeRole,
  type ViewerGrants,
} from "./node-rules";
import { maxGrantFor } from "./grant-plan";

// ── the children API shape ───────────────────────────────────────────

export interface ListNode {
  id: string;
  slug: string;
  name: string;
  icon: string | null;
  color: string | null;
  visibility: NodeVisibility;
  ownerId: string | null;
  settings: unknown;
  role: TreeRole;
}

export interface DocNode { id: string; title: string; role: TreeRole }

export interface CanvasNode { id: string; name: string; role: "full" | "edit" | "view" }

export interface TableNode { id: string; name: string; description: string | null; canManage: boolean; role: "full" | "edit" }

export interface FolderNode {
  id: string;
  name: string;
  icon: string | null;
  color: string | null;
  position: number;
  /** null on a path row. */
  visibility: NodeVisibility | null;
  /** null on a path row. */
  ownerId: string | null;
  /** null on a path row. */
  role: TreeRole | null;
  path: boolean;
  /** Rendered children only. */
  _count: { boards: number; childFolders: number };
  boards: ListNode[];
  docs: DocNode[];
  whiteboards: CanvasNode[];
  childFolders: FolderNode[];
}

export interface SpaceTreeResult {
  spaceRole: TreeRole | null;
  access: "member" | "path";
  privateRule: PrivateRule;
  folders: FolderNode[];
  boards: ListNode[];
  tables: TableNode[];
  docs: DocNode[];
  whiteboards: CanvasNode[];
}

export interface SpaceTreeInput {
  rows: NodeRows;
  grants: ViewerGrants;
  spaceId: string;
}

const readable = (r: NodeRole) => roleAtLeast(r, "VIEW");

function canvasRole(r: NodeRole): CanvasNode["role"] {
  if (roleAtLeast(r, "FULL")) return "full";
  if (roleAtLeast(r, "EDIT")) return "edit";
  return "view";
}

const byName = <T extends { name: string }>(a: T, b: T) => a.name.localeCompare(b.name);
const byTitle = (a: DocNode, b: DocNode) => a.title.localeCompare(b.title);

export function assembleSpaceTree(input: SpaceTreeInput): SpaceTreeResult | null {
  const { rows, grants, spaceId } = input;
  const space = rows.spaces.get(spaceId);
  if (!space || space.organizationId !== rows.organizationId) return null;
  const ev = new NodeEvaluator(rows, grants);
  const dSpace = ev.decision({ kind: "space", id: spaceId });
  const spaceReadable = readable(dSpace.role);
  if (!spaceReadable && !dSpace.path) return null;

  const decisions = new Map<string, NodeDecision>();
  const dec = (ref: NodeRef): NodeDecision => {
    const key = refKey(ref);
    let d = decisions.get(key);
    if (!d) {
      d = ev.decision(ref);
      decisions.set(key, d);
    }
    return d;
  };

  // Folders of this Space, under their effective parent (a missing, foreign
  // or looping parent reads as the Space root, as the rules read it).
  const childFolders = new Map<string | null, FolderFact[]>();
  for (const f of rows.folders.values()) {
    if (f.spaceId !== spaceId || f.organizationId !== rows.organizationId) continue;
    const parent = folderParentOf(rows, f);
    const key = parent ? parent.id : null;
    const arr = childFolders.get(key) ?? [];
    arr.push(f);
    childFolders.set(key, arr);
  }
  for (const arr of childFolders.values()) arr.sort((a, b) => a.position - b.position || a.name.localeCompare(b.name));

  // Which Folders render (top down), and inside which path containers.
  const rendered = new Set<string>();
  const inPath = new Map<string | null, boolean>([[null, !spaceReadable]]);
  const walk = (parentKey: string | null) => {
    for (const f of childFolders.get(parentKey) ?? []) {
      // A Folder in Trash renders nothing: neither itself nor what is inside.
      if (f.archived) continue;
      const d = dec({ kind: "folder", id: f.id });
      if (!childRenders(d, inPath.get(parentKey) ?? false)) continue;
      rendered.add(f.id);
      inPath.set(f.id, d.path);
      walk(f.id);
    }
  };
  walk(null);

  /**
   * A child of a rendered container renders when it is readable, except that
   * inside a path container a child readable only because everyone at the
   * org can open it is a sibling the path must not show.
   */
  function childRenders(d: NodeDecision, parentIsPath: boolean): boolean {
    if (d.path) return true;
    if (!readable(d.role)) return false;
    if (parentIsPath && d.via.type === "everyone") return false;
    return true;
  }

  const containerKey = (folder: FolderFact | null) => (folder && rendered.has(folder.id) ? folder.id : folder ? undefined : null);

  // Lists.
  const listsAt = new Map<string | null, ListNode[]>();
  for (const l of rows.lists.values()) {
    if (l.spaceId !== spaceId || l.organizationId !== rows.organizationId) continue;
    const key = containerKey(listFolderOf(rows, l));
    if (key === undefined) continue;
    const d = dec({ kind: "list", id: l.id });
    if (!childRenders(d, inPath.get(key) ?? false) || d.path) continue;
    const role = toContainerRole(d.role);
    if (!role) continue;
    const arr = listsAt.get(key) ?? [];
    arr.push({ id: l.id, slug: l.slug, name: l.name, icon: l.icon, color: l.color, visibility: l.visibility, ownerId: l.ownerId, settings: l.settings ?? {}, role });
    listsAt.set(key, arr);
  }

  // Docs: SPACE and FOLDER docs at their container, the given docs whose
  // natural parent does not render under their top anchor's container.
  const docsAt = new Map<string | null, DocNode[]>();
  const placeDoc = (key: string | null, doc: DocFact, d: NodeDecision) => {
    const role = toContainerRole(d.role);
    if (!role) return;
    const arr = docsAt.get(key) ?? [];
    arr.push({ id: doc.id, title: doc.title, role });
    docsAt.set(key, arr);
  };
  for (const doc of rows.docs.values()) {
    if (doc.organizationId !== rows.organizationId) continue;
    const d = dec({ kind: "doc", id: doc.id });
    if (!readable(d.role)) continue;
    if (doc.entityType === "SPACE" && doc.entityId === spaceId) {
      if (childRenders(d, inPath.get(null) ?? false)) placeDoc(null, doc, d);
      continue;
    }
    if (doc.entityType === "FOLDER" && doc.entityId) {
      const f = rows.folders.get(doc.entityId);
      if (!f || f.spaceId !== spaceId) continue;
      if (rendered.has(f.id) && childRenders(d, inPath.get(f.id) ?? false)) placeDoc(f.id, doc, d);
      continue;
    }
    // A doc that would otherwise be unreachable from the tree. Only a strict
    // role moves a node: the floor keeps today's placement.
    if (!readable(d.strictRole) || naturalParentRenders(doc)) continue;
    const top = topAnchorDoc(rows, doc);
    if (!top) continue;
    const chain = anchorContainers(rows, top);
    if (chain.length === 0 || chain[chain.length - 1].id !== spaceId) continue;
    const at = chain.find((c) => (c.kind === "space" ? true : rendered.has(c.id)));
    if (!at) continue;
    placeDoc(at.kind === "space" ? null : at.id, doc, d);
  }

  function naturalParentRenders(doc: DocFact): boolean {
    const shape = docShape(doc);
    if (shape === "subpage") return readable(dec({ kind: "doc", id: doc.parentId as string }).role);
    if (shape !== "anchored") return false;
    if (doc.entityType === "BOARD") return readable(dec({ kind: "list", id: doc.entityId as string }).role);
    if (doc.entityType === "BOARD_ITEM") {
      const item = rows.items.get(doc.entityId as string);
      return !!item && readable(dec({ kind: "list", id: item.boardId }).role);
    }
    return false;
  }

  // Canvases: under a rendered same-Space Folder, else at the Space root.
  const canvasesAt = new Map<string | null, CanvasNode[]>();
  for (const c of rows.canvases.values()) {
    if (c.spaceId !== spaceId || c.organizationId !== rows.organizationId) continue;
    const d = dec({ kind: "canvas", id: c.id });
    const folder = canvasFolderOf(rows, c);
    const key = folder && rendered.has(folder.id) ? folder.id : null;
    if (!childRenders(d, inPath.get(key) ?? false)) continue;
    const arr = canvasesAt.get(key) ?? [];
    arr.push({ id: c.id, name: c.name, role: canvasRole(d.role) });
    canvasesAt.set(key, arr);
  }

  // Tables sit at the Space root.
  const tables: TableNode[] = [];
  for (const t of rows.tables.values()) {
    if (t.spaceId !== spaceId || t.organizationId !== rows.organizationId) continue;
    const d = dec({ kind: "table", id: t.id });
    if (!childRenders(d, inPath.get(null) ?? false)) continue;
    const full = roleAtLeast(d.role, "FULL");
    tables.push({ id: t.id, name: t.name, description: t.description ?? null, canManage: full, role: full ? "full" : "edit" });
  }
  tables.sort(byName);

  const build = (parentKey: string | null): FolderNode[] =>
    (childFolders.get(parentKey) ?? [])
      .filter((f) => rendered.has(f.id))
      .map((f) => {
        const d = dec({ kind: "folder", id: f.id });
        const kids = build(f.id);
        const boards = (listsAt.get(f.id) ?? []).sort(byName);
        return {
          id: f.id,
          name: f.name,
          icon: f.icon,
          color: f.color,
          position: f.position,
          visibility: d.path ? null : f.visibility,
          ownerId: d.path ? null : f.ownerId,
          role: d.path ? null : toContainerRole(d.role),
          path: d.path,
          _count: { boards: boards.length, childFolders: kids.length },
          boards,
          docs: (docsAt.get(f.id) ?? []).sort(byTitle),
          whiteboards: (canvasesAt.get(f.id) ?? []).sort(byName),
          childFolders: kids,
        };
      });

  return {
    spaceRole: spaceReadable ? toContainerRole(dSpace.role) : null,
    access: spaceReadable ? "member" : "path",
    privateRule: rows.privateRule,
    folders: build(null),
    boards: (listsAt.get(null) ?? []).sort(byName),
    tables,
    docs: (docsAt.get(null) ?? []).sort(byTitle),
    whiteboards: (canvasesAt.get(null) ?? []).sort(byName),
  };
}

// ── counts and the path view ─────────────────────────────────────────

export interface RenderedCounts { folders: number; lists: number; docs: number; tables: number; canvases: number }

/** What the viewer's tree renders, at every depth, and nothing it hides. */
export function renderedCounts(tree: SpaceTreeResult): RenderedCounts {
  const out: RenderedCounts = { folders: 0, lists: tree.boards.length, docs: tree.docs.length, tables: tree.tables.length, canvases: tree.whiteboards.length };
  const visit = (nodes: FolderNode[]) => {
    for (const n of nodes) {
      out.folders += 1;
      out.lists += n.boards.length;
      out.docs += n.docs.length;
      out.canvases += n.whiteboards.length;
      visit(n.childFolders);
    }
  };
  visit(tree.folders);
  return out;
}

export interface PathViewRow {
  kind: "folder" | "list" | "doc" | "table" | "canvas";
  id: string;
  name: string;
  href: string;
  icon: string | null;
  color: string | null;
  path: boolean;
}

function findFolder(nodes: FolderNode[], id: string): FolderNode | null {
  for (const n of nodes) {
    if (n.id === id) return n;
    const hit = findFolder(n.childFolders, id);
    if (hit) return hit;
  }
  return null;
}

/**
 * The rows a PathContainerView lists for a path Space or Folder: exactly the
 * tree's children of that container, with their Work addresses.
 */
export function pathViewRows(tree: SpaceTreeResult, ref: NodeRef, spaceSlug: string): PathViewRow[] {
  const enc = encodeURIComponent;
  const at = ref.kind === "folder" ? findFolder(tree.folders, ref.id) : null;
  if (ref.kind === "folder" && !at) return [];
  const folders = at ? at.childFolders : tree.folders;
  const boards = at ? at.boards : tree.boards;
  const docs = at ? at.docs : tree.docs;
  const canvases = at ? at.whiteboards : tree.whiteboards;
  const tables = at ? [] : tree.tables;
  return [
    ...folders.map((f) => ({ kind: "folder" as const, id: f.id, name: f.name, href: `/folders/${enc(f.id)}`, icon: f.icon, color: f.color, path: f.path })),
    ...boards.map((b) => ({ kind: "list" as const, id: b.id, name: b.name, href: `/boards/${enc(b.slug)}`, icon: b.icon, color: b.color, path: false })),
    ...docs.map((d) => ({ kind: "doc" as const, id: d.id, name: d.title, href: `/spaces/${enc(spaceSlug)}/docs/${enc(d.id)}`, icon: null, color: null, path: false })),
    ...tables.map((t) => ({ kind: "table" as const, id: t.id, name: t.name, href: `/spaces/${enc(spaceSlug)}/tables/${enc(t.id)}`, icon: null, color: null, path: false })),
    ...canvases.map((c) => ({ kind: "canvas" as const, id: c.id, name: c.name, href: `/spaces/${enc(spaceSlug)}/canvas/${enc(c.id)}`, icon: null, color: null, path: false })),
  ];
}

// ── who can reach one node (the panel's people) ─────────────────────

export interface PanelPersonInput { person: AccessPerson; grants: ViewerGrants }

export interface AccessEntriesInput {
  rows: NodeRows;
  ref: NodeRef;
  /** Everyone with a row on the node's chain, and its owners. Org admins without a row need not be here. */
  people: PanelPersonInput[];
  /** The person looking at the panel. */
  viewer: ViewerGrants;
  orgName: string;
  /** Where a via container opens; null when it has no page. */
  hrefOf: (ref: NodeRef) => string | null;
}

export interface AccessEntries {
  viewer: { role: NodeRole; canManage: boolean; maxGrant: PanelRole | null; isAgent: boolean };
  notepadOwnerId: string | null;
  direct: AccessDirectEntry[];
  inherited: AccessInheritedEntry[];
  inheritedMore: Array<{ via: AccessVia; more: number }>;
  hiddenInherited: Array<{ kind: AccessNodeKind; name: string }>;
  everyone: { role: PanelRole; via: AccessVia } | null;
  admins: { count: number } | null;
}

/** At most this many people per inherited group; the rest are counted. */
export const INHERITED_PER_VIA = 20;

const rankP = (r: NodeRole) => PANEL_ROLE_RANK[r];

/** The node's own name, for a via. */
export function nodeName(rows: NodeRows, ref: NodeRef): string {
  switch (ref.kind) {
    case "space":
      return rows.spaces.get(ref.id)?.name ?? ACCESS_NODE_NOUN.space;
    case "folder":
      return rows.folders.get(ref.id)?.name ?? ACCESS_NODE_NOUN.folder;
    case "list":
      return rows.lists.get(ref.id)?.name ?? ACCESS_NODE_NOUN.list;
    case "doc":
      return rows.docs.get(ref.id)?.title ?? ACCESS_NODE_NOUN.doc;
    case "table":
      return rows.tables.get(ref.id)?.name ?? ACCESS_NODE_NOUN.table;
    case "canvas":
      return rows.canvases.get(ref.id)?.name ?? ACCESS_NODE_NOUN.canvas;
    case "form":
      return rows.forms.get(ref.id)?.name ?? ACCESS_NODE_NOUN.form;
  }
}

/**
 * Every node a role can flow down from onto this one, nearest first: parent
 * pages, then the anchor (a List or task's List included), then its Folders,
 * then the Space.
 */
export function ancestorsOf(rows: NodeRows, ref: NodeRef): NodeRef[] {
  if (ref.kind !== "doc") return placementContainers(rows, ref);
  const out: NodeRef[] = [];
  const doc = rows.docs.get(ref.id);
  if (!doc) return out;
  const seen = new Set<string>([doc.id]);
  let cursor: DocFact | undefined = doc;
  while (cursor && docShape(cursor) === "subpage" && out.length < 16) {
    const parent: DocFact | undefined = rows.docs.get(cursor.parentId as string);
    if (!parent || seen.has(parent.id)) break;
    seen.add(parent.id);
    out.push({ kind: "doc", id: parent.id });
    cursor = parent;
  }
  const top = topAnchorDoc(rows, doc);
  if (top) {
    if (top.entityType === "BOARD") out.push({ kind: "list", id: top.entityId as string });
    if (top.entityType === "BOARD_ITEM") {
      const item = rows.items.get(top.entityId as string);
      if (item) out.push({ kind: "list", id: item.boardId });
    }
    out.push(...anchorContainers(rows, top));
  }
  return out;
}

/** The person who made the node, whose Full access is fixed, or the Folder or List owner. */
function ownerIdOf(rows: NodeRows, ref: NodeRef): string | null {
  switch (ref.kind) {
    case "space":
      return null; // Space.ownerId gives nothing: the Owner rows are its owners.
    case "folder":
      return rows.folders.get(ref.id)?.ownerId ?? null;
    case "list":
      return rows.lists.get(ref.id)?.ownerId ?? null;
    case "doc":
      return rows.docs.get(ref.id)?.createdById ?? null;
    case "table":
      return rows.tables.get(ref.id)?.createdById ?? null;
    case "canvas":
      return rows.canvases.get(ref.id)?.ownerId ?? null;
    case "form":
      return rows.forms.get(ref.id)?.createdById ?? null;
  }
}

interface DirectRow { role: PanelRole; source: AccessGrantSource; stored: string; cap: boolean }

/** The person's own row on THIS node, from whichever store the kind uses. */
export function directRowOf(rows: NodeRows, grants: ViewerGrants, ref: NodeRef): DirectRow | null {
  const u = grants.viewer.userId;
  switch (ref.kind) {
    case "space": {
      const r = grants.space.get(ref.id);
      return r ? { role: spaceMemberToRole(r), source: "SpaceMember", stored: r, cap: false } : null;
    }
    case "folder": {
      const r = grants.folder.get(ref.id);
      return r ? { role: memberToRole(r), source: "FolderMember", stored: r, cap: false } : null;
    }
    case "list": {
      const r = grants.list.get(ref.id);
      return r ? { role: memberToRole(r), source: "BoardMember", stored: r, cap: false } : null;
    }
    case "doc": {
      const entry = rows.docSharing.get(ref.id);
      const granted = entry?.roles?.[u];
      if (granted) return { role: granted, source: "DocSharing", stored: granted, cap: false };
      const legacy = entry?.members?.[u];
      if (legacy) return { role: legacy === "edit" ? "EDIT" : "COMMENT", source: "DocSharingLegacy", stored: legacy, cap: true };
      return null;
    }
    case "table":
    case "canvas":
    case "form": {
      const r = grants.object.get(objectGrantKey(ref.kind, ref.id));
      return r ? { role: memberToRole(r), source: "AccessGrant", stored: r, cap: false } : null;
    }
  }
}

export function accessEntries(input: AccessEntriesInput): AccessEntries {
  const { rows, ref, viewer } = input;
  const actorEv = new NodeEvaluator(rows, viewer);
  const actorRole = actorEv.effective(ref).role;
  const doc = ref.kind === "doc" ? rows.docs.get(ref.id) : undefined;
  const notepadOwnerId = doc ? notepadOwnerOf(rows, doc) ?? null : null;
  const isAgent = viewer.viewer.isAgent;
  const canManage = !notepadOwnerId && roleAtLeast(actorRole, MANAGE_BAR[ref.kind]);
  const maxGrant = canManage ? maxGrantFor(ref.kind, actorRole) : null;
  const actorPaths = actorEv.paths();

  const order = ancestorsOf(rows, ref);
  const orderIndex = new Map(order.map((r, i) => [refKey(r), i]));

  // How the actor may see a via container: named and linked, named only (a
  // path container: never its member list), or not at all.
  const viaFor = (target: NodeRef): AccessVia | "path" => {
    const role = actorEv.effective(target).role;
    if (roleAtLeast(role, "VIEW")) {
      return {
        type: "node",
        kind: target.kind,
        id: target.id,
        name: nodeName(rows, target),
        href: input.hrefOf(target),
        canManage: roleAtLeast(role, MANAGE_BAR[target.kind]),
      };
    }
    if (actorPaths.has(refKey(target))) return "path";
    return { type: "hidden" };
  };

  const toAccessVia = (via: NodeVia): AccessVia | "path" => {
    switch (via.type) {
      case "org_admin":
        return { type: "org_admin", orgName: input.orgName };
      case "owner":
        return { type: "owner" };
      case "everyone":
        return { type: "everyone", orgName: input.orgName, from: via.node ? { kind: via.node.kind, name: nodeName(rows, via.node) } : null };
      case "floor":
        return { type: "older_rule", from: null };
      case "own":
      case "lift":
      case "pierce":
      case "inherited":
        return viaFor(via.node);
      default:
        return { type: "hidden" };
    }
  };

  // Who could hold Full access on a Space, for the last Full holder rule.
  const activeFullRows =
    ref.kind === "space"
      ? input.people.filter((p) => p.person.active && (p.grants.space.get(ref.id) === "OWNER" || p.grants.space.get(ref.id) === "ADMIN")).length
      : 0;

  const ownerId = notepadOwnerId ?? ownerIdOf(rows, ref);
  const direct: AccessDirectEntry[] = [];
  const groups = new Map<string, { via: AccessVia; order: number; entries: AccessInheritedEntry[] }>();
  const hidden = new Map<string, { kind: AccessNodeKind; name: string; order: number }>();
  const seen = new Set<string>();

  for (const p of input.people) {
    const uid = p.person.id;
    if (seen.has(uid) || p.grants.viewer.userId !== uid) continue;
    seen.add(uid);
    const ev = new NodeEvaluator(rows, p.grants);
    const d = ev.decision(ref);

    if (ownerId && uid === ownerId && ev.ownerApplies(ref)) {
      direct.push({
        person: p.person, role: "FULL", owner: true, source: "Owner", editable: false, removable: false, lastFull: false, cap: false, alsoVia: null,
      });
      continue;
    }
    if (notepadOwnerId) continue;

    const row = directRowOf(rows, p.grants, ref);
    if (row) {
      const lastFull = ref.kind === "space" && p.person.active && (row.stored === "OWNER" || row.stored === "ADMIN") && activeFullRows <= 1;
      const editable = canManage && !!maxGrant && rankP(row.role) <= rankP(maxGrant);
      let alsoVia: AccessDirectEntry["alsoVia"] = null;
      if (rankP(d.role) > rankP(row.role) && d.role !== "none") {
        const v = toAccessVia(d.via);
        alsoVia = { role: d.role, via: v === "path" ? { type: "hidden" } : v };
      }
      direct.push({ person: p.person, role: row.role, owner: false, source: row.source, editable, removable: editable && !lastFull, lastFull, cap: row.cap, alsoVia });
      continue;
    }

    if (!roleAtLeast(d.role, "VIEW")) continue;
    // The admins line and the everyone line speak for these people.
    if (d.via.type === "org_admin" || d.via.type === "everyone") continue;

    let groupRef: NodeRef | null = null;
    let via: AccessVia;
    if (d.via.type === "floor") {
      groupRef = floorSourceOf(rows, p.grants, ref, order);
      via = { type: "older_rule", from: groupRef ? { kind: groupRef.kind, name: nodeName(rows, groupRef) } : null };
    } else if (d.via.type === "inherited" || d.via.type === "pierce" || d.via.type === "lift" || d.via.type === "own") {
      groupRef = d.via.node;
      const v = viaFor(groupRef);
      if (v === "path") {
        const key = refKey(groupRef);
        if (!hidden.has(key)) hidden.set(key, { kind: groupRef.kind, name: nodeName(rows, groupRef), order: orderIndex.get(key) ?? order.length });
        continue;
      }
      via = v;
    } else {
      via = { type: "hidden" };
    }
    const key = d.via.type === "floor" ? `older:${groupRef ? refKey(groupRef) : ""}` : via.type === "node" ? refKey({ kind: via.kind, id: via.id }) : "hidden";
    const g = groups.get(key) ?? {
      via,
      order: groupRef ? orderIndex.get(refKey(groupRef)) ?? order.length : order.length + 1,
      entries: [],
    };
    g.entries.push({ person: p.person, role: d.role as PanelRole, via });
    groups.set(key, g);
  }

  direct.sort((a, b) => Number(b.owner) - Number(a.owner) || rankP(b.role) - rankP(a.role) || a.person.name.localeCompare(b.person.name));

  const inherited: AccessInheritedEntry[] = [];
  const inheritedMore: Array<{ via: AccessVia; more: number }> = [];
  for (const g of [...groups.values()].sort((a, b) => a.order - b.order)) {
    g.entries.sort((a, b) => rankP(b.role) - rankP(a.role) || a.person.name.localeCompare(b.person.name));
    inherited.push(...g.entries.slice(0, INHERITED_PER_VIA));
    if (g.entries.length > INHERITED_PER_VIA) inheritedMore.push({ via: g.via, more: g.entries.length - INHERITED_PER_VIA });
  }

  // The everyone line: what a Member with no rows of their own holds here.
  let everyone: AccessEntries["everyone"] = null;
  if (!notepadOwnerId) {
    const anyone: ViewerGrants = {
      viewer: { userId: "\u0000everyone", orgAdmin: false, orgGuest: false, isAgent: false, denied: false },
      space: new Map(), folder: new Map(), list: new Map(), object: new Map(),
    };
    const d = new NodeEvaluator(rows, anyone).decision(ref);
    if (roleAtLeast(d.role, "VIEW") && (d.via.type === "everyone" || d.via.type === "floor")) {
      // Under the legacy rule today's org-wide reach is still everyone's; it
      // is named from the Space it comes through.
      const fromNode = d.via.type === "everyone" ? d.via.node : order.find((r) => r.kind === "space") ?? null;
      everyone = {
        role: d.role as PanelRole,
        via: { type: "everyone", orgName: input.orgName, from: fromNode ? { kind: fromNode.kind, name: nodeName(rows, fromNode) } : null },
      };
    }
  }

  return {
    viewer: { role: actorRole, canManage, maxGrant, isAgent },
    notepadOwnerId,
    direct,
    inherited,
    inheritedMore,
    hiddenInherited: [...hidden.values()].sort((a, b) => a.order - b.order).map(({ kind, name }) => ({ kind, name })),
    everyone,
    admins: notepadOwnerId ? null : { count: rows.orgAdmins.size },
  };
}

/**
 * Where today's reach came from, for an "older rule" group: the nearest
 * container on the chain where the person holds a row or which they own,
 * else the Space. Only a label: the floor itself is legacy-floor.ts.
 */
function floorSourceOf(rows: NodeRows, grants: ViewerGrants, ref: NodeRef, order: NodeRef[]): NodeRef | null {
  for (const r of order) {
    if (r.kind === "folder" && (grants.folder.has(r.id) || rows.folders.get(r.id)?.ownerId === grants.viewer.userId)) return r;
    if (r.kind === "space" && grants.space.has(r.id)) return r;
    if (r.kind === "list" && grants.list.has(r.id)) return r;
  }
  const space = order.find((r) => r.kind === "space");
  if (space) return space;
  return ref.kind === "space" ? ref : null;
}

/**
 * What a node inherits from, for the General access wording: the nearest
 * container (a Folder or List) and the nearest Restricted Folder above it.
 * The Space alone was named before, which told an admin that Space members
 * open a List whose Restricted Folder shuts them out.
 */
export function inheritanceOf(rows: NodeRows, ref: NodeRef): Pick<AccessGeneral, "inheritsFrom" | "restrictedAbove"> {
  const chain = ref.kind === "space" ? [] : placementContainers(rows, ref);
  const parent = ref.kind === "folder" || ref.kind === "list" ? chain[0] : undefined;
  const inheritsFrom = parent && (parent.kind === "space" || parent.kind === "folder")
    ? { kind: parent.kind, id: parent.id, name: nodeName(rows, parent) }
    : null;
  const lock = chain.find((c) => c.kind === "folder" && rows.folders.get(c.id)?.visibility === "PRIVATE");
  const restrictedAbove = lock ? { id: lock.id, name: nodeName(rows, lock) } : null;
  return { inheritsFrom, restrictedAbove };
}

/**
 * Would this person still open the doc once it is Restricted? R6 keeps a
 * Restricted doc to its listed people (a role, or a listing made before this
 * release), the person who made it and org admins. The doc's own entry only:
 * a sub-page's parent does not list anyone on it.
 */
export function keepsRestrictedDoc(rows: NodeRows, docId: string, userId: string): boolean {
  if (rows.orgAdmins.has(userId)) return true;
  const doc = rows.docs.get(docId);
  if (!doc) return false;
  if (doc.createdById === userId) return true;
  const entry = rows.docSharing.get(docId);
  return !!(entry?.roles?.[userId] || entry?.members?.[userId]);
}
