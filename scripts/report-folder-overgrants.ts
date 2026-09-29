/**
 * report-folder-overgrants.ts: the DRY-RUN report for the one access model
 * (2026-09-24, decision A8 and the reported bug "admin on a folder gives the
 * entire Space").
 *
 * THIS SCRIPT NEVER WRITES. The bug is fixed FORWARD: from this release a
 * grant on a Folder never climbs to its Space, and no existing row is
 * touched. What this report does is name the rows the bug may have left
 * behind, so the founder can decide about each one with the person who holds
 * it. Passing --write is refused so nobody mistakes it for a clean-up.
 *
 * WHAT IT REPORTS, per organization:
 *   A.  Space and Folder granted together (a HEURISTIC, never proof). Every
 *       FolderMember whose person also holds a SpaceMember row in that
 *       Folder's Space, with both roles, both dates and both inviters.
 *       Flagged SAME INVITER WITHIN WINDOW when one person invited both rows
 *       within --window-minutes of each other and the Space row is not OWNER:
 *       that is what "I gave them the Folder and it gave them the Space"
 *       looks like in the data, and also what a deliberate "the Space, and
 *       admin on this Folder" looks like. Only the person can tell.
 *   A2. Space rows possibly written by the canvas Share. Before this release
 *       the Share chip on a canvas opened the SPACE's share dialog, so
 *       sharing a canvas added a SpaceMember row. These are the Space rows
 *       (not OWNER) whose inviter created or last edited a canvas in that
 *       Space within the window of the row's date. They cannot be told apart
 *       from deliberate Space shares.
 *   B.  Folder grants inside an org-wide Space. Everyone at the org opens
 *       the whole of an org-wide Space, so a Folder grant there only ADDS
 *       edit or manage rights on the Folder. Removing the person's Space row
 *       changes nothing while the Space stays org-wide: restriction is
 *       impossible without changing the Space to Space members.
 *   C.  What applying the STRICT Private rule would change (scripts/
 *       apply-private-rule.ts), one sub-section per row of NODE_ACCESS_DELTAS
 *       (src/lib/access/node-rules.ts): C1 N1, C2 N2, C3 N3, C4 N4, C5 N6,
 *       C6 N7, each with the person, the node, the change and the row that
 *       gives today's reach. C7 is N5: sub-pages that would follow their
 *       parent page, and the people who could no longer open them. Like
 *       C1 to C6 it waits for the strict rule: under the legacy rule a page
 *       made before the workspace's cutoff keeps today's reach (A8), and a
 *       page made after it follows its parent from the start, which takes
 *       nothing away from anyone. Anything the named rows do not explain
 *       is listed under C8 (it should be empty).
 *   D.  Totals.
 *
 * The C sections are computed by the resolver's own pure rules
 * (node-rules.ts, legacy-floor.ts) over every row of the org, for every
 * active person who is not an org admin (org admins hold Full access on
 * every node in both modes), so the report and the product cannot disagree.
 *
 * Usage (local; the production form is in scripts/MIGRATIONS.md):
 *   DIRECT_URL= DATABASE_URL="$(grep DATABASE_URL= .env.local | cut -d'"' -f2)" \
 *     npx tsx scripts/report-folder-overgrants.ts --report <file.md>
 *   ... --org <organizationId>     one org only
 *   ... --window-minutes <n>       the SAME INVITER window (default 30)
 */

import fs from "node:fs";
import path from "node:path";
import type { PrismaClient } from "../src/generated/prisma";
import { databaseLabel, scriptPrisma } from "./lib/script-prisma";
import {
  NodeEvaluator,
  NODE_ACCESS_DELTAS,
  emptyGrants,
  emptyRows,
  folderAncestors,
  listFolderOf,
  canvasFolderOf,
  nodeCtxFromLevel,
  objectGrantKey,
  rankOf,
  readPrivateRule,
  sanitizeDocSharingEntry,
  type DocFact,
  type FolderFact,
  type MemberRole,
  type NodeDecision,
  type NodeRef,
  type NodeRole,
  type NodeRows,
  type NodeVisibility,
  type PrivateRule,
  type ViewerGrants,
} from "../src/lib/access/node-rules";
import { legacyEntryFor, legacyResolveDocRole } from "../src/lib/access/legacy-floor";
import { legacyAllows } from "../src/lib/access/parity";
import { panelRoleLabel } from "../src/lib/access/access-panel";
import { RULE_1_DENIED_STATUSES } from "../src/lib/access/resolve";

// ── the loaded org ───────────────────────────────────────────────────

export interface ReportPerson {
  id: string;
  name: string;
  email: string;
  accessLevel: string;
}

interface MemberRow {
  nodeId: string;
  userId: string;
  role: MemberRole;
  invitedBy: string | null;
  createdAt: Date;
}

interface CanvasActivity {
  id: string;
  name: string;
  spaceId: string | null;
  ownerId: string | null;
  createdAt: Date;
  lastEditedById: string | null;
  lastEditedAt: Date | null;
}

export interface OrgWorld {
  org: { id: string; name: string };
  privateRule: PrivateRule;
  rows: NodeRows;
  /** Every person of the org (departed included, for naming inviters). */
  everyone: Map<string, ReportPerson & { active: boolean }>;
  /** Active people, org admins included. */
  active: ReportPerson[];
  grants: Map<string, Omit<ViewerGrants, "viewer">>;
  spaceMembers: MemberRow[];
  folderMembers: MemberRow[];
  canvases: CanvasActivity[];
}

const personName = (u: { firstName: string | null; lastName: string | null; email: string }) =>
  `${u.firstName ?? ""} ${u.lastName ?? ""}`.trim() || u.email;

/** Every live row of one org, as the resolver's facts, plus everyone's own grant rows. */
export async function loadOrgWorld(prisma: PrismaClient, org: { id: string; name: string; settings: unknown }): Promise<OrgWorld> {
  const organizationId = org.id;
  const privateRule = readPrivateRule(org.settings);
  const rows = emptyRows(organizationId, "legacy");

  const [users, spaces, folders, lists, docs, canvases, tables, forms, sm, fm, bm] = await Promise.all([
    prisma.user.findMany({
      where: { organizationId },
      select: { id: true, firstName: true, lastName: true, email: true, accessLevel: true, status: true, deletedAt: true },
    }),
    prisma.space.findMany({
      where: { organizationId, archivedAt: null },
      select: { id: true, organizationId: true, name: true, slug: true, icon: true, color: true, visibility: true, ownerId: true, description: true, parentSpaceId: true, displayOrder: true },
    }),
    prisma.folder.findMany({
      where: { organizationId, archivedAt: null },
      select: { id: true, organizationId: true, spaceId: true, parentFolderId: true, name: true, icon: true, color: true, visibility: true, ownerId: true, position: true },
    }),
    prisma.board.findMany({
      where: { organizationId, archivedAt: null },
      select: { id: true, organizationId: true, spaceId: true, folderId: true, name: true, slug: true, icon: true, color: true, visibility: true, ownerId: true },
    }),
    prisma.doc.findMany({
      where: { organizationId, archivedAt: null },
      select: { id: true, organizationId: true, title: true, entityType: true, entityId: true, parentId: true, createdById: true },
    }),
    prisma.whiteboard.findMany({
      where: { organizationId, archivedAt: null },
      select: { id: true, organizationId: true, spaceId: true, folderId: true, ownerId: true, name: true, createdAt: true, lastEditedById: true, lastEditedAt: true },
    }),
    prisma.dataTable.findMany({
      where: { organizationId },
      select: { id: true, organizationId: true, spaceId: true, createdById: true, name: true },
    }),
    prisma.formDefinition.findMany({
      where: { organizationId },
      select: { id: true, organizationId: true, createdById: true, name: true, targetBoardId: true, targetTableId: true },
    }),
    prisma.spaceMember.findMany({
      where: { space: { organizationId } },
      select: { spaceId: true, userId: true, role: true, invitedBy: true, createdAt: true },
    }),
    prisma.folderMember.findMany({
      where: { folder: { organizationId } },
      select: { folderId: true, userId: true, role: true, invitedBy: true, createdAt: true },
    }),
    prisma.boardMember.findMany({
      where: { board: { organizationId } },
      select: { boardId: true, userId: true, role: true },
    }),
  ]);

  for (const s of spaces) rows.spaces.set(s.id, { ...s, visibility: s.visibility as NodeVisibility });
  for (const f of folders) rows.folders.set(f.id, { ...f, visibility: f.visibility as NodeVisibility, position: Number(f.position) });
  for (const l of lists) rows.lists.set(l.id, { ...l, visibility: l.visibility as NodeVisibility });
  for (const d of docs) rows.docs.set(d.id, d);
  for (const c of canvases) rows.canvases.set(c.id, { id: c.id, organizationId: c.organizationId, spaceId: c.spaceId, folderId: c.folderId, ownerId: c.ownerId, name: c.name });
  for (const t of tables) rows.tables.set(t.id, t);
  for (const f of forms) rows.forms.set(f.id, f);

  // Tasks a doc hangs on (BOARD_ITEM anchors) only: the rules need their List.
  const itemIds = docs.filter((d) => d.entityType === "BOARD_ITEM" && d.entityId).map((d) => d.entityId as string);
  if (itemIds.length) {
    const items = await prisma.item.findMany({ where: { id: { in: itemIds }, organizationId }, select: { id: true, organizationId: true, boardId: true } });
    for (const i of items) rows.items.set(i.id, i);
  }

  const settings = org.settings && typeof org.settings === "object" ? (org.settings as Record<string, unknown>) : {};
  const sharing = settings.docSharing && typeof settings.docSharing === "object" ? (settings.docSharing as Record<string, unknown>) : {};
  for (const [docId, raw] of Object.entries(sharing)) {
    const entry = sanitizeDocSharingEntry(raw);
    if (entry && rows.docs.has(docId)) rows.docSharing.set(docId, entry);
  }

  const everyone = new Map<string, ReportPerson & { active: boolean }>();
  const active: ReportPerson[] = [];
  for (const u of users) {
    const person = { id: u.id, name: personName(u), email: u.email, accessLevel: String(u.accessLevel) };
    const isActive = !u.deletedAt && !RULE_1_DENIED_STATUSES.has(String(u.status));
    everyone.set(u.id, { ...person, active: isActive });
    if (isActive) active.push(person);
    if (isActive && nodeCtxFromLevel(u.id, organizationId, person.accessLevel).orgAdmin) rows.orgAdmins.add(u.id);
  }

  const grants = new Map<string, Omit<ViewerGrants, "viewer">>();
  const of = (userId: string) => {
    let g = grants.get(userId);
    if (!g) {
      g = { space: new Map(), folder: new Map(), list: new Map(), object: new Map() };
      grants.set(userId, g);
    }
    return g;
  };
  for (const r of sm) of(r.userId).space.set(r.spaceId, r.role as MemberRole);
  for (const r of fm) of(r.userId).folder.set(r.folderId, r.role as MemberRole);
  for (const r of bm) of(r.userId).list.set(r.boardId, r.role as MemberRole);

  // AccessGrant rows, when the table exists (it arrives with this release).
  const ready = await prisma.$queryRaw<Array<{ ok: boolean }>>`SELECT to_regclass('"AccessGrant"') IS NOT NULL AS ok`;
  if (ready[0]?.ok) {
    const og = await prisma.$queryRaw<Array<{ objectType: string; objectId: string; subjectId: string; role: string }>>`
      SELECT "objectType", "objectId", "subjectId", "role"::text AS "role"
      FROM "AccessGrant" WHERE "organizationId" = ${organizationId} AND "subjectType" = 'USER'`;
    const KIND: Record<string, "table" | "canvas" | "form"> = { TABLE: "table", WHITEBOARD: "canvas", FORM: "form" };
    for (const r of og) {
      const kind = KIND[r.objectType];
      if (kind) of(r.subjectId).object.set(objectGrantKey(kind, r.objectId), r.role as MemberRole);
    }
  }

  return {
    org: { id: org.id, name: org.name },
    privateRule,
    rows,
    everyone,
    active,
    grants,
    spaceMembers: sm.map((r) => ({ nodeId: r.spaceId, userId: r.userId, role: r.role as MemberRole, invitedBy: r.invitedBy, createdAt: r.createdAt })),
    folderMembers: fm.map((r) => ({ nodeId: r.folderId, userId: r.userId, role: r.role as MemberRole, invitedBy: r.invitedBy, createdAt: r.createdAt })),
    canvases,
  };
}

function evaluatorFor(world: OrgWorld, person: ReportPerson): NodeEvaluator {
  const ctx = nodeCtxFromLevel(person.id, world.org.id, person.accessLevel);
  const viewer = { userId: person.id, orgAdmin: ctx.orgAdmin, orgGuest: ctx.orgGuest, isAgent: ctx.isAgent, denied: false };
  const own = world.grants.get(person.id);
  const grants: ViewerGrants = own ? { viewer, ...own } : emptyGrants(viewer);
  return new NodeEvaluator(world.rows, grants);
}

// ── C: what the strict Private rule changes ──────────────────────────

export type StrictDeltaId = "N1" | "N2" | "N3" | "N4" | "N5" | "N6" | "N7";

export interface RuleChange {
  delta: StrictDeltaId | "N5" | "unexplained";
  person: ReportPerson;
  node: NodeRef;
  nodeName: string;
  from: NodeRole;
  to: NodeRole;
  /** The row that gives today's reach, in words. */
  source: string;
}

const ROLE_WORDS = (r: NodeRole) => (r === "none" ? "no access" : panelRoleLabel(r));

function nameOf(world: OrgWorld, ref: NodeRef): string {
  const r = world.rows;
  switch (ref.kind) {
    case "space": return r.spaces.get(ref.id)?.name ?? ref.id;
    case "folder": return r.folders.get(ref.id)?.name ?? ref.id;
    case "list": return r.lists.get(ref.id)?.name ?? ref.id;
    case "doc": return r.docs.get(ref.id)?.title || "Untitled page";
    case "table": return r.tables.get(ref.id)?.name ?? ref.id;
    case "canvas": return r.canvases.get(ref.id)?.name ?? ref.id;
    case "form": return r.forms.get(ref.id)?.name ?? ref.id;
  }
}

const NOUN: Record<NodeRef["kind"], string> = { space: "Space", folder: "Folder", list: "List", doc: "Doc", table: "Table", canvas: "Canvas", form: "Form" };

function spaceSource(world: OrgWorld, g: Omit<ViewerGrants, "viewer">, spaceId: string | null): string {
  if (!spaceId) return "no Space";
  const s = world.rows.spaces.get(spaceId);
  const role = g.space.get(spaceId);
  if (role) return `SpaceMember ${role} on ${s?.name ?? spaceId}`;
  if (s?.visibility === "ORG") return `${s.name} is org-wide`;
  return `no row on ${s?.name ?? spaceId}`;
}

interface Explained { delta: RuleChange["delta"]; source: string }

/**
 * Which named row explains a node that reads under today's rule and not
 * under the strict one, by the same branches the parity grid in
 * node-rules.test.ts uses, generalised to real chains of any depth.
 */
class Explainer {
  constructor(private readonly world: OrgWorld, private readonly ev: NodeEvaluator, private readonly person: ReportPerson) {}

  private get g(): Omit<ViewerGrants, "viewer"> {
    return this.world.grants.get(this.person.id) ?? { space: new Map(), folder: new Map(), list: new Map(), object: new Map() };
  }

  private strictNone(ref: NodeRef): boolean {
    return rankOf(this.ev.decision(ref).strictRole) === 0;
  }

  /** A PRIVATE Folder on the chain above `folder` (or `folder` itself when asked) that gives the person nothing under the strict rule. */
  private privateCut(folder: FolderFact, includeSelf: boolean): FolderFact | null {
    const chain = includeSelf ? [folder, ...folderAncestors(this.world.rows, folder)] : folderAncestors(this.world.rows, folder);
    for (const f of chain) {
      if (f.visibility === "PRIVATE" && this.strictNone({ kind: "folder", id: f.id })) return f;
    }
    return null;
  }

  private nearestFolderGrant(folder: FolderFact, includeSelf: boolean): { folder: FolderFact; role: MemberRole } | null {
    const chain = includeSelf ? [folder, ...folderAncestors(this.world.rows, folder)] : folderAncestors(this.world.rows, folder);
    for (const f of chain) {
      const role = this.g.folder.get(f.id);
      if (role) return { folder: f, role };
    }
    return null;
  }

  folder(id: string): Explained {
    const f = this.world.rows.folders.get(id);
    if (!f) return { delta: "unexplained", source: "the Folder is gone" };
    const own = this.g.folder.get(f.id);
    const anc = this.nearestFolderGrant(f, false);
    if (!own && f.ownerId === this.person.id && f.visibility !== "PRIVATE") {
      return { delta: "N7", source: `owner of ${f.name}, with no reach through its parent` };
    }
    if (!own && f.visibility === "PRIVATE") {
      return { delta: "N1", source: anc ? `FolderMember ${anc.role} on ${anc.folder.name}` : spaceSource(this.world, this.g, f.spaceId) };
    }
    const cut = this.privateCut(f, false);
    if (cut) {
      return {
        delta: "N2",
        source: `${anc ? `FolderMember ${anc.role} on ${anc.folder.name}` : spaceSource(this.world, this.g, f.spaceId)}, below the Private Folder ${cut.name}`,
      };
    }
    return { delta: "unexplained", source: anc ? `FolderMember ${anc.role} on ${anc.folder.name}` : spaceSource(this.world, this.g, f.spaceId) };
  }

  list(id: string): Explained {
    const l = this.world.rows.lists.get(id);
    if (!l) return { delta: "unexplained", source: "the List is gone" };
    const folder = listFolderOf(this.world.rows, l);
    const union = folder ? this.nearestFolderGrant(folder, true) : null;
    const spaceRole = l.spaceId ? this.g.space.get(l.spaceId) : undefined;
    const space = l.spaceId ? this.world.rows.spaces.get(l.spaceId) : undefined;
    // getBoardForReader's branches (board.ts:620-679): a List inside a PRIVATE
    // Folder the person does not own is hidden before the List is looked at.
    const cascadeBlocks = !!folder && folder.visibility === "PRIVATE" && folder.ownerId !== this.person.id;
    let basis: "org" | "owner" | "pierce" | "space" | "union" | "none" = "none";
    if (!cascadeBlocks) {
      if (l.visibility === "ORG") basis = "org";
      else if (l.visibility === "PRIVATE") basis = l.ownerId === this.person.id ? "owner" : spaceRole === "OWNER" ? "pierce" : "none";
      else if (space?.visibility === "ORG" || spaceRole) basis = "space";
    }
    if (basis === "none" && union) basis = "union";
    const source =
      basis === "union" && union ? `FolderMember ${union.role} on ${union.folder.name}`
      : basis === "org" ? `${l.name} is org-wide`
      : basis === "pierce" ? `SpaceMember OWNER on ${space?.name ?? l.spaceId}`
      : basis === "owner" ? `owner of ${l.name}`
      : spaceSource(this.world, this.g, l.spaceId);
    if ((basis === "org" || basis === "pierce" || basis === "space") && folder && this.strictNone({ kind: "folder", id: folder.id })) {
      const cut = this.privateCut(folder, true);
      if (cut) return { delta: "N2", source: `${source}, below the Private Folder ${cut.name}` };
    }
    if (basis === "union" && l.visibility === "PRIVATE") return { delta: "N6", source: `${source}, and ${l.name} is Private` };
    if (basis === "union" && folder) {
      const cut = this.privateCut(folder, true);
      if (cut) return { delta: "N2", source: `${source}, below the Private Folder ${cut.name}` };
    }
    if (l.ownerId === this.person.id && l.visibility !== "PRIVATE") return { delta: "N7", source: `owner of ${l.name}, with no reach through its parent` };
    return { delta: "unexplained", source };
  }

  canvas(id: string): Explained {
    const c = this.world.rows.canvases.get(id);
    if (!c) return { delta: "unexplained", source: "the canvas is gone" };
    const folder = canvasFolderOf(this.world.rows, c);
    const source = spaceSource(this.world, this.g, c.spaceId);
    if (folder) {
      const cut = this.privateCut(folder, true);
      if (cut) return { delta: "N3", source: `${source}, and the canvas is in the Private Folder ${cut.name}${cut.id === folder.id ? "" : ` (above ${folder.name})`}` };
    }
    return { delta: "unexplained", source };
  }

  doc(id: string, depth = 0): Explained {
    const d = this.world.rows.docs.get(id);
    if (!d || depth > 8) return { delta: "unexplained", source: "the page chain is broken" };
    if (d.entityType && d.entityId) {
      switch (d.entityType) {
        case "FOLDER":
          return this.folder(d.entityId);
        case "BOARD":
        case "BOARD_ITEM": {
          const listId = d.entityType === "BOARD" ? d.entityId : this.world.rows.items.get(d.entityId)?.boardId;
          const l = listId ? this.world.rows.lists.get(listId) : undefined;
          if (!l) return { delta: "unexplained", source: "the List is gone" };
          const listExplained = this.list(l.id);
          if (listExplained.delta !== "unexplained") return listExplained;
          // Admitted today only through doc-access.ts's Folder fallback.
          if (l.visibility === "PRIVATE") return { delta: "N4", source: `a reader of the Folder around the Private List ${l.name}` };
          const folder = listFolderOf(this.world.rows, l);
          return folder ? this.folder(folder.id) : listExplained;
        }
        default:
          return { delta: "unexplained", source: `anchored ${d.entityType}` };
      }
    }
    // A sub-page follows its parent: the parent's change explains it.
    if (d.parentId) return this.doc(d.parentId, depth + 1);
    return { delta: "unexplained", source: "a page with no location" };
  }

  explain(ref: NodeRef): Explained {
    switch (ref.kind) {
      case "folder": return this.folder(ref.id);
      case "list": return this.list(ref.id);
      case "canvas": return this.canvas(ref.id);
      case "doc": return this.doc(ref.id);
      default: return { delta: "unexplained", source: "" };
    }
  }
}

/** Every (person, node) whose role applying the strict Private rule would lower, explained by one named row. */
export function strictRuleChanges(world: OrgWorld): RuleChange[] {
  const out: RuleChange[] = [];
  const refs: NodeRef[] = [
    ...[...world.rows.folders.keys()].map((id) => ({ kind: "folder" as const, id })),
    ...[...world.rows.lists.keys()].map((id) => ({ kind: "list" as const, id })),
    ...[...world.rows.docs.keys()].map((id) => ({ kind: "doc" as const, id })),
    ...[...world.rows.canvases.keys()].map((id) => ({ kind: "canvas" as const, id })),
  ];
  for (const person of world.active) {
    if (world.rows.orgAdmins.has(person.id)) continue;
    const ev = evaluatorFor(world, person);
    const explainer = new Explainer(world, ev, person);
    for (const ref of refs) {
      const d: NodeDecision = ev.decision(ref);
      // The legacy-mode role is max(strict, today's); strict lowers it only where today's answer is higher.
      if (rankOf(d.role) <= rankOf(d.strictRole)) continue;
      // A sub-page the strict rule lowers is N5 (it follows its parent page),
      // whatever lowers the parent, if anything does.
      const doc = ref.kind === "doc" ? world.rows.docs.get(ref.id) : undefined;
      if (doc && !(doc.entityType && doc.entityId) && doc.parentId) {
        out.push({ delta: "N5", person, node: ref, nodeName: nameOf(world, ref), from: d.role, to: d.strictRole, source: parentChainNote(world, doc) });
        continue;
      }
      const why = explainer.explain(ref);
      out.push({ delta: why.delta, person, node: ref, nodeName: nameOf(world, ref), from: d.role, to: d.strictRole, source: why.source });
    }
  }
  return out;
}

/** Today's answer for an anchorless page (doc-access.ts opened every one to the org) and its sharing entry. */
function todayReadsAnchorless(world: OrgWorld, person: ReportPerson, doc: DocFact): boolean {
  const reads = legacyAllows(
    {
      userId: person.id,
      organizationId: world.org.id,
      accessLevel: person.accessLevel,
      doc: { id: doc.id, organizationId: doc.organizationId, createdById: doc.createdById, anchor: { entityType: null, entityId: null } },
    },
    "docAccessible",
  );
  if (!reads) return false;
  return (
    legacyResolveDocRole(legacyEntryFor(world.rows.docSharing.get(doc.id), person.id), {
      userId: person.id,
      accessLevel: person.accessLevel,
      createdById: doc.createdById,
    }) !== null
  );
}

/** Why a sub-page's parent chain is narrower than the org, in words. */
function parentChainNote(world: OrgWorld, doc: DocFact): string {
  const notes: string[] = [];
  const seen = new Set<string>([doc.id]);
  let cursor = doc.parentId ? world.rows.docs.get(doc.parentId) : undefined;
  for (let hops = 0; cursor && hops <= 8 && !seen.has(cursor.id); hops += 1) {
    seen.add(cursor.id);
    if (world.rows.docSharing.get(cursor.id)?.restricted) notes.push(`restricted page "${cursor.title || "Untitled page"}"`);
    if (cursor.entityType && cursor.entityId) {
      const e = cursor.entityType;
      const where =
        e === "SPACE" ? `Space ${world.rows.spaces.get(cursor.entityId)?.name ?? cursor.entityId}`
        : e === "FOLDER" ? `Folder ${world.rows.folders.get(cursor.entityId)?.name ?? cursor.entityId}`
        : e === "BOARD" ? `List ${world.rows.lists.get(cursor.entityId)?.name ?? cursor.entityId}`
        : e === "BOARD_ITEM" ? "a task"
        : e === "NOTEPAD" ? "someone's private note"
        : e;
      notes.push(`anchored on ${where}`);
      break;
    }
    cursor = cursor.parentId ? world.rows.docs.get(cursor.parentId) : undefined;
  }
  if (!cursor && doc.parentId && !world.rows.docs.has(doc.parentId)) notes.push("its parent page is gone");
  return notes.length ? notes.join(", ") : "its parent pages";
}

/**
 * People who open a sub-page today and would not on deploy. The legacy
 * floor keeps every page made before the cutoff, so this is empty unless a
 * page falls outside it; the strict rule's sub-page changes are in
 * strictRuleChanges as N5.
 */
export function subpageLosses(world: OrgWorld): RuleChange[] {
  const out: RuleChange[] = [];
  const subpages = [...world.rows.docs.values()].filter((d) => !(d.entityType && d.entityId) && !!d.parentId);
  if (subpages.length === 0) return out;
  for (const person of world.active) {
    const ev = evaluatorFor(world, person);
    for (const doc of subpages) {
      if (!todayReadsAnchorless(world, person, doc)) continue;
      const d = ev.decision({ kind: "doc", id: doc.id });
      if (rankOf(d.role) > 0) continue;
      out.push({
        delta: "N5",
        person,
        node: { kind: "doc", id: doc.id },
        nodeName: doc.title || "Untitled page",
        from: "EDIT",
        to: "none",
        source: parentChainNote(world, doc),
      });
    }
  }
  return out;
}

// ── A, A2, B ─────────────────────────────────────────────────────────

export interface PairRow {
  space: { id: string; name: string; visibility: string };
  folder: { id: string; name: string };
  person: string;
  spaceRow: MemberRow;
  folderRow: MemberRow;
  flagged: boolean;
}

export function spaceAndFolderPairs(world: OrgWorld, windowMinutes: number): PairRow[] {
  const bySpaceUser = new Map(world.spaceMembers.map((r) => [`${r.nodeId}:${r.userId}`, r]));
  const out: PairRow[] = [];
  const windowMs = windowMinutes * 60_000;
  for (const fr of world.folderMembers) {
    const folder = world.rows.folders.get(fr.nodeId);
    if (!folder) continue;
    const sr = bySpaceUser.get(`${folder.spaceId}:${fr.userId}`);
    if (!sr) continue;
    const space = world.rows.spaces.get(folder.spaceId);
    const flagged =
      !!sr.invitedBy && sr.invitedBy === fr.invitedBy && Math.abs(sr.createdAt.getTime() - fr.createdAt.getTime()) <= windowMs && sr.role !== "OWNER";
    out.push({
      space: { id: folder.spaceId, name: space?.name ?? folder.spaceId, visibility: space?.visibility ?? "(archived)" },
      folder: { id: folder.id, name: folder.name },
      person: world.everyone.get(fr.userId)?.name ?? fr.userId,
      spaceRow: sr,
      folderRow: fr,
      flagged,
    });
  }
  return out;
}

export interface CanvasDoorRow {
  space: { id: string; name: string };
  person: string;
  row: MemberRow;
  canvas: CanvasActivity;
  how: "created" | "last edited";
}

export function canvasDoorCandidates(world: OrgWorld, windowMinutes: number): CanvasDoorRow[] {
  const windowMs = windowMinutes * 60_000;
  const out: CanvasDoorRow[] = [];
  for (const r of world.spaceMembers) {
    if (r.role === "OWNER" || !r.invitedBy) continue;
    const space = world.rows.spaces.get(r.nodeId);
    if (!space) continue;
    for (const c of world.canvases) {
      if (c.spaceId !== r.nodeId) continue;
      const created = c.ownerId === r.invitedBy && Math.abs(c.createdAt.getTime() - r.createdAt.getTime()) <= windowMs;
      const edited = !!c.lastEditedAt && c.lastEditedById === r.invitedBy && Math.abs(c.lastEditedAt.getTime() - r.createdAt.getTime()) <= windowMs;
      if (!created && !edited) continue;
      out.push({ space: { id: space.id, name: space.name }, person: world.everyone.get(r.userId)?.name ?? r.userId, row: r, canvas: c, how: created ? "created" : "last edited" });
      break;
    }
  }
  return out;
}

export interface OrgWideFolderRow {
  space: { id: string; name: string };
  folder: { id: string; name: string };
  person: string;
  row: MemberRow;
}

export function orgWideFolderGrants(world: OrgWorld): OrgWideFolderRow[] {
  const out: OrgWideFolderRow[] = [];
  for (const r of world.folderMembers) {
    const folder = world.rows.folders.get(r.nodeId);
    if (!folder) continue;
    const space = world.rows.spaces.get(folder.spaceId);
    if (space?.visibility !== "ORG") continue;
    out.push({ space: { id: space.id, name: space.name }, folder: { id: folder.id, name: folder.name }, person: world.everyone.get(r.userId)?.name ?? r.userId, row: r });
  }
  return out;
}

// ── the C sub-sections, shared with apply-private-rule.ts ────────────

export const C_SECTIONS: ReadonlyArray<{ id: string; delta: RuleChange["delta"] }> = [
  { id: "C1", delta: "N1" },
  { id: "C2", delta: "N2" },
  { id: "C3", delta: "N3" },
  { id: "C4", delta: "N4" },
  { id: "C5", delta: "N6" },
  { id: "C6", delta: "N7" },
  { id: "C7", delta: "N5" },
  { id: "C8", delta: "unexplained" },
];

export function countByDelta(changes: RuleChange[]): Map<RuleChange["delta"], { rows: number; people: number; nodes: number }> {
  const out = new Map<RuleChange["delta"], { rows: number; people: Set<string>; nodes: Set<string> }>();
  for (const c of changes) {
    let e = out.get(c.delta);
    if (!e) {
      e = { rows: 0, people: new Set(), nodes: new Set() };
      out.set(c.delta, e);
    }
    e.rows += 1;
    e.people.add(c.person.id);
    e.nodes.add(`${c.node.kind}:${c.node.id}`);
  }
  return new Map([...out].map(([k, v]) => [k, { rows: v.rows, people: v.people.size, nodes: v.nodes.size }]));
}

const fmt = (d: Date | null | undefined) => (d ? d.toISOString().replace("T", " ").slice(0, 16) : "");
const cell = (s: string) => s.replace(/\|/g, "\\|");
const PER_NODE_CAP = 50;

// ── the report ───────────────────────────────────────────────────────

async function main() {
  const args = process.argv.slice(2);
  if (args.includes("--write")) {
    console.error("report-folder-overgrants: this script is a dry run only and never writes. Remove a Space row from that Space's Manage access dialog after confirming with the person; see scripts/MIGRATIONS.md.");
    process.exit(2);
  }
  const argOf = (flag: string) => (args.includes(flag) ? args[args.indexOf(flag) + 1] : null);
  const reportPath = argOf("--report");
  const onlyOrg = argOf("--org");
  const windowMinutes = Number(argOf("--window-minutes") ?? 30);
  if (!Number.isFinite(windowMinutes) || windowMinutes < 0) {
    console.error("report-folder-overgrants: --window-minutes takes a number of minutes.");
    process.exit(2);
  }

  const prisma = scriptPrisma();
  const lines: string[] = [];
  const out = (s = "") => { lines.push(s); console.log(s); };
  const personOf = (world: OrgWorld, id: string | null) => (id ? world.everyone.get(id)?.name ?? `(missing user ${id})` : "(not recorded)");

  try {
    out("# Folder over-grants and the Private rule: DRY RUN");
    out();
    out(`Database: ${databaseLabel()}  `);
    out(`Generated: ${new Date().toISOString()}  `);
    out(`Same-inviter window: ${windowMinutes} minutes  `);
    out("Writes: none (this report never writes and never revokes)");
    out();

    const orgs = await prisma.organization.findMany({
      where: onlyOrg ? { id: onlyOrg } : {},
      select: { id: true, name: true, settings: true },
      orderBy: { name: "asc" },
    });
    if (onlyOrg && orgs.length === 0) {
      console.error(`report-folder-overgrants: no organization has the id ${onlyOrg}.`);
      process.exitCode = 1;
      return;
    }

    const totals = { orgs: 0, pairs: 0, flagged: 0, canvasDoor: 0, orgWide: 0, strict: new Map<string, number>(), subpages: 0, unexplained: 0 };

    for (const org of orgs) {
      const world = await loadOrgWorld(prisma, org);
      const pairs = spaceAndFolderPairs(world, windowMinutes);
      const door = canvasDoorCandidates(world, windowMinutes);
      const orgWide = orgWideFolderGrants(world);
      const strict = strictRuleChanges(world);
      const subs = subpageLosses(world);
      if (!pairs.length && !door.length && !orgWide.length && !strict.length && !subs.length) continue;
      totals.orgs += 1;

      out(`## ${org.name} (${org.id})`);
      out();
      out(`Private rule today: ${world.privateRule}${world.privateRule === "legacy" ? " (the default: Private items keep the reach they had before this release)" : ""}`);
      out();

      out(`### A. Space and Folder granted together (${pairs.length}; a heuristic, never proof)`);
      out();
      out("The person holds a Folder grant and a Space row in the same Space. SAME INVITER WITHIN WINDOW marks the pairs one person wrote close together with a Space row below Owner, which is what the reported bug leaves behind and also what a deliberate share of both looks like. Ask the person before changing anything.");
      out();
      if (pairs.length) {
        out("| Flag | Space (visibility) | Folder | Person | Space row | Folder row |");
        out("|---|---|---|---|---|---|");
        for (const p of pairs) {
          totals.pairs += 1;
          if (p.flagged) totals.flagged += 1;
          out(`| ${p.flagged ? "SAME INVITER WITHIN WINDOW" : ""} | ${cell(p.space.name)} (${p.space.visibility}) | ${cell(p.folder.name)} | ${cell(p.person)} | ${p.spaceRow.role}, ${fmt(p.spaceRow.createdAt)}, by ${cell(personOf(world, p.spaceRow.invitedBy))} | ${p.folderRow.role}, ${fmt(p.folderRow.createdAt)}, by ${cell(personOf(world, p.folderRow.invitedBy))} |`);
        }
        out();
      }

      out(`### A2. Space rows possibly written by the canvas Share (${door.length})`);
      out();
      out("Before this release the Share chip on a canvas opened the Space's share dialog, so sharing a canvas added a Space row. These Space rows (below Owner) were written by someone who created or last edited a canvas in that Space within the window. They cannot be told apart from deliberate Space shares.");
      out();
      if (door.length) {
        out("| Space | Person | Space row | Canvas | Inviter and canvas |");
        out("|---|---|---|---|---|");
        for (const r of door) {
          totals.canvasDoor += 1;
          const when = r.how === "created" ? r.canvas.createdAt : r.canvas.lastEditedAt;
          out(`| ${cell(r.space.name)} | ${cell(r.person)} | ${r.row.role}, ${fmt(r.row.createdAt)} | ${cell(r.canvas.name)} (${r.canvas.id}) | ${cell(personOf(world, r.row.invitedBy))} ${r.how} it ${fmt(when)} |`);
        }
        out();
      }

      out(`### B. Folder grants inside an org-wide Space (${orgWide.length})`);
      out();
      out("Everyone at the org opens the whole of an org-wide Space, so each grant below only adds edit or manage rights on its Folder. Removing the person's Space row changes nothing while the Space stays org-wide.");
      out();
      if (orgWide.length) {
        out("| Space | Folder | Person | Folder row | Note |");
        out("|---|---|---|---|---|");
        for (const r of orgWide) {
          totals.orgWide += 1;
          out(`| ${cell(r.space.name)} | ${cell(r.folder.name)} | ${cell(r.person)} | ${r.row.role}, ${fmt(r.row.createdAt)}, by ${cell(personOf(world, r.row.invitedBy))} | restriction impossible without changing the Space to Space members |`);
        }
        out();
      }

      out("### C. What applying the strict Private rule would change");
      out();
      out(`Nothing in C1 to C7 happens until an admin runs scripts/apply-private-rule.ts --rule strict for this workspace. Each row names the person, the node, the change and the row that gives today's reach.`);
      out();
      const all = [...strict, ...subs];
      for (const sec of C_SECTIONS) {
        const rowsOf = all.filter((c) => c.delta === sec.delta);
        const delta = NODE_ACCESS_DELTAS.find((d) => d.id === sec.delta);
        const title = sec.delta === "unexplained" ? "Not explained by a named row (should be empty)" : `${sec.delta}: ${delta?.text ?? ""}`;
        out(`#### ${sec.id}. ${title} (${rowsOf.length})`);
        out();
        if (sec.delta === "N5") out("Strict rule only: a sub-page follows its parent page (A6). Each row is a person who opens the sub-page today and would not.");
        if (delta?.legacySource) out(`Today: ${delta.legacySource}`);
        if (sec.delta === "N5" || delta?.legacySource) out();
        if (!rowsOf.length) continue;
        out("| Node | Person | Change | Today's reach comes from |");
        out("|---|---|---|---|");
        const byNode = new Map<string, RuleChange[]>();
        for (const c of rowsOf) {
          const k = `${c.node.kind}:${c.node.id}`;
          byNode.set(k, [...(byNode.get(k) ?? []), c]);
        }
        for (const group of byNode.values()) {
          for (const c of group.slice(0, PER_NODE_CAP)) {
            out(`| ${NOUN[c.node.kind]} ${cell(c.nodeName)} (${c.node.id}) | ${cell(c.person.name)} | ${ROLE_WORDS(c.from)} to ${ROLE_WORDS(c.to)} | ${cell(c.source)} |`);
          }
          if (group.length > PER_NODE_CAP) out(`| ${NOUN[group[0].node.kind]} ${cell(group[0].nodeName)} | and ${group.length - PER_NODE_CAP} more people | | |`);
        }
        out();
        if (sec.delta === "N5") totals.subpages += rowsOf.length;
        else if (sec.delta === "unexplained") totals.unexplained += rowsOf.length;
        else totals.strict.set(sec.id, (totals.strict.get(sec.id) ?? 0) + rowsOf.length);
      }
    }

    out("## D. Totals");
    out();
    out(`- Organizations with something to review: ${totals.orgs}`);
    out(`- A. Space and Folder granted together: ${totals.pairs} (SAME INVITER WITHIN WINDOW: ${totals.flagged})`);
    out(`- A2. Space rows possibly written by the canvas Share: ${totals.canvasDoor}`);
    out(`- B. Folder grants inside an org-wide Space: ${totals.orgWide}`);
    for (const sec of C_SECTIONS.slice(0, 6)) out(`- ${sec.id} (${sec.delta}, strict rule only): ${totals.strict.get(sec.id) ?? 0} person and node pairs`);
    out(`- C7 (N5, strict rule only): ${totals.subpages} person and sub-page pairs`);
    out(`- C8 (not explained): ${totals.unexplained}`);

    if (reportPath) {
      fs.mkdirSync(path.dirname(reportPath), { recursive: true });
      fs.writeFileSync(reportPath, lines.join("\n") + "\n");
      console.log(`\nReport saved to ${reportPath}`);
    }
  } finally {
    await prisma.$disconnect();
  }
}

// Run only as the entry script: apply-private-rule.ts imports the C sections.
if (/report-folder-overgrants\.ts$/.test(process.argv[1] ?? "")) {
  main().catch((e) => {
    console.error(e);
    process.exitCode = 1;
  });
}

