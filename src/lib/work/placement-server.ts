// placeObject: where an object sits in Work for this viewer, or why it does
// not open. The server half of src/lib/work/placement.ts.
//
// ACCESS IS UNCHANGED. Every object is gated by the SAME function its own
// API gates it with, reading the SAME viewer:
//   doc     docAccessible + the per-doc role (resolveDocRole over the org's
//           settings.docSharing), exactly GET /api/docs/[id], with the
//           session read back from the DB row (loadSuiteViewer, which is
//           resolveSuiteContext without its HTTP responses)
//   table   readableTable with the session, exactly GET /api/tables/[id]
//   canvas  the org-scoped, not-archived row plus whiteboardSpaceVisible,
//           exactly GET /api/whiteboards/[id]
//   sop     nothing on the server, like /sops/[id]: the editor's own API is
//   form    the gate (the form's Guest rule runs in WorkObjectGate first)
// Seeing the Space is never the permission: an object in a Space the viewer
// can open is still refused when its own gate refuses it.
//
// NOTHING FOREIGN IS NAMED. Every lookup is scoped to the viewer's org, and
// a fact that does not come back (a Space, Folder, List or task outside the
// org, or gone) makes the object loose: it opens at the door with nothing
// from that chain in its crumb. Every crumb that IS named was either proved
// readable here or is the container the object's own gate read it through.
//
// The access engine (src/lib/access) stays inert: this file reads the legacy
// level once per object and hands it to the existing helpers, like every
// sibling route on the G7 allow-list.
//
// Server-only: prisma and the session.

import type { Session } from "next-auth";
import { prisma } from "@/lib/prisma";
import { docAccessible } from "@/lib/doc-access";
import { getDocSharingMap, resolveDocRole, type DocSharingEntry } from "@/lib/doc-sharing";
import { folderAccessForSpace, folderReadable, folderVisibleTo, type FolderAccessMode } from "@/lib/folder";
import { readableTable } from "@/lib/table-gate";
import { whiteboardSpaceVisible } from "@/lib/whiteboard-gate";
import { loadSuiteViewer } from "@/lib/suites/auth";
import type { ObjectKind } from "@/lib/nav/object-href";
import {
  assembleDocPlacement,
  assembleSpaceItemPlacement,
  staticDoorPlacement,
  treeFolderIds,
  type FolderStep,
  type SpaceFact,
  type SpaceItemFacts,
  type WorkGate,
} from "./placement";

/** How far up a doc's parents or a folder's ancestors the loader walks. */
const MAX_HOPS = 8;

const MISSING: WorkGate = { state: "missing" };
const SIGNED_OUT: WorkGate = { state: "signedOut" };

export async function placeObject(kind: ObjectKind, id: string, session: Session): Promise<WorkGate> {
  switch (kind) {
    case "doc":
      return placeDoc(id, session);
    case "table":
      return placeTable(id, session);
    case "canvas":
      return placeCanvas(id, session);
    case "sop":
    case "form":
      return { state: "ok", placement: staticDoorPlacement(kind, id) };
  }
}

const SPACE_SELECT = { id: true, slug: true, name: true, icon: true, color: true, archivedAt: true } as const;

/**
 * A Space fact for an object whose own gate already passed: the Space when it
 * is in the org, not archived, and in the viewer's Work tree; null otherwise.
 * `foreign` is true only when the id names no Space in this org at all.
 */
async function spaceFact(
  spaceId: string,
  orgId: string,
  access: () => Promise<FolderAccessMode>,
): Promise<{ space: SpaceFact | null; access: FolderAccessMode; foreign: boolean }> {
  const s = await prisma.space.findFirst({ where: { id: spaceId, organizationId: orgId }, select: SPACE_SELECT });
  if (!s) return { space: null, access: { mode: "none" }, foreign: true };
  if (s.archivedAt) return { space: null, access: { mode: "none" }, foreign: false };
  const mode = await access();
  if (mode.mode === "none") return { space: null, access: mode, foreign: false };
  return {
    space: { id: s.id, slug: s.slug, name: s.name, icon: s.icon, color: s.color, access: mode.mode },
    access: mode,
    foreign: false,
  };
}

// ── Docs ─────────────────────────────────────────────────────────────

const DOC_SELECT = { id: true, title: true, entityType: true, entityId: true, parentId: true, createdById: true } as const;

type Anchor = { entityType: string; entityId: string };

/** What a doc's anchor resolves to, every fact org-scoped. */
interface AnchorFacts {
  spaceId: string | null;
  leafFolderId: string | null;
  list: { id: string; slug: string; name: string } | null;
  task: { id: string; title: string | null } | null;
}

const NO_ANCHOR: AnchorFacts = { spaceId: null, leafFolderId: null, list: null, task: null };

async function anchorFacts(anchor: Anchor | null, orgId: string): Promise<AnchorFacts> {
  if (!anchor) return NO_ANCHOR;
  switch (anchor.entityType) {
    case "SPACE":
      return { ...NO_ANCHOR, spaceId: anchor.entityId };
    case "FOLDER": {
      const f = await prisma.folder.findFirst({ where: { id: anchor.entityId, organizationId: orgId }, select: { id: true, spaceId: true } });
      return f ? { ...NO_ANCHOR, spaceId: f.spaceId, leafFolderId: f.id } : NO_ANCHOR;
    }
    case "BOARD":
    case "BOARD_ITEM": {
      let boardId = anchor.entityId;
      let task: AnchorFacts["task"] = null;
      if (anchor.entityType === "BOARD_ITEM") {
        const it = await prisma.item.findFirst({
          where: { id: anchor.entityId, organizationId: orgId },
          select: { id: true, title: true, boardId: true, archivedAt: true },
        });
        if (!it) return NO_ANCHOR;
        boardId = it.boardId;
        task = it.archivedAt ? null : { id: it.id, title: it.title };
      }
      const b = await prisma.board.findFirst({
        where: { id: boardId, organizationId: orgId },
        select: { id: true, slug: true, name: true, spaceId: true, folderId: true, archivedAt: true },
      });
      // A List outside the org names nothing at all, the task included.
      if (!b) return NO_ANCHOR;
      return {
        spaceId: b.spaceId,
        leafFolderId: b.folderId,
        list: b.archivedAt ? null : { id: b.id, slug: b.slug, name: b.name },
        task,
      };
    }
    default:
      // NOTEPAD, standalone and suite anchors have no place in the Work tree.
      return NO_ANCHOR;
  }
}

type FolderRow = {
  id: string;
  name: string;
  spaceId: string;
  parentFolderId: string | null;
  visibility: string;
  ownerId: string | null;
  archivedAt: Date | null;
};

/** The folder and its ancestors, root first, all in one org and one Space. */
async function folderChain(leafId: string, orgId: string, spaceId: string | null): Promise<{ rows: FolderRow[]; complete: boolean }> {
  const rows: FolderRow[] = [];
  const seen = new Set<string>();
  let cur: string | null = leafId;
  for (let hops = 0; cur && hops < MAX_HOPS; hops += 1) {
    if (seen.has(cur)) return { rows: rows.reverse(), complete: false };
    seen.add(cur);
    const f: FolderRow | null = await prisma.folder.findFirst({
      where: { id: cur, organizationId: orgId },
      select: { id: true, name: true, spaceId: true, parentFolderId: true, visibility: true, ownerId: true, archivedAt: true },
    });
    if (!f || (spaceId && f.spaceId !== spaceId)) return { rows: rows.reverse(), complete: false };
    rows.push(f);
    cur = f.parentFolderId;
  }
  return { rows: rows.reverse(), complete: cur === null };
}

/** The tree's flags for each folder on a chain, root first. */
function folderSteps(
  rows: FolderRow[],
  access: FolderAccessMode,
  userId: string,
  level: string | null | undefined,
): FolderStep[] {
  return rows.map((f) => ({
    id: f.id,
    visible: !f.archivedAt && folderVisibleTo(f, userId, level),
    granted: access.mode === "scoped" && access.folderIds.has(f.id),
  }));
}

/**
 * The folders GET /api/work/locate may open for a Folder or List deep link:
 * the same org-scoped walk and the same tree rule (treeFolderIds) the Work
 * addresses use, so no reveal anywhere opens, or names to the browser, a
 * folder the viewer's tree would not render. Root first.
 */
export async function revealFolderIds(
  leafFolderId: string,
  orgId: string,
  spaceId: string,
  userId: string,
  level: string | null | undefined,
): Promise<string[]> {
  const [chain, access] = await Promise.all([
    folderChain(leafFolderId, orgId, spaceId),
    folderAccessForSpace(spaceId, userId, level),
  ]);
  return treeFolderIds(folderSteps(chain.rows, access, userId, level), access.mode, chain.complete);
}

async function placeDoc(id: string, session: Session): Promise<WorkGate> {
  const viewer = await loadSuiteViewer(session);
  if ("error" in viewer) return SIGNED_OUT;
  const { userId, orgId } = viewer;
  const level = viewer.accessLevel;

  // GET /api/docs/[id]'s two gates, with the org's sharing map read once for
  // the doc and every parent the crumb may name.
  const org = await prisma.organization.findUnique({ where: { id: orgId }, select: { settings: true } });
  const sharing: Record<string, DocSharingEntry> = getDocSharingMap(org?.settings);
  const readable = async (d: { id: string; entityType: string | null; entityId: string | null; createdById: string | null }) =>
    (await docAccessible(d, userId, level)) &&
    resolveDocRole(sharing[d.id], { userId, accessLevel: level, createdById: d.createdById }) !== null;

  const doc = await prisma.doc.findFirst({ where: { id, organizationId: orgId }, select: DOC_SELECT });
  if (!doc || !(await readable(doc))) return MISSING;

  // Readable parents, nearest first, up to the first anchored one: a sub-page
  // carries no anchor of its own and takes its place from that parent.
  let anchor: Anchor | null = doc.entityType && doc.entityId ? { entityType: doc.entityType, entityId: doc.entityId } : null;
  let anchorDocId: string | null = null;
  const parents: { id: string; title: string | null }[] = [];
  const seen = new Set<string>([doc.id]);
  let cur = doc.parentId;
  for (let hops = 0; cur && hops < MAX_HOPS && !seen.has(cur); hops += 1) {
    seen.add(cur);
    const p = await prisma.doc.findFirst({ where: { id: cur, organizationId: orgId, archivedAt: null }, select: DOC_SELECT });
    if (!p || !(await readable(p))) break;
    parents.push({ id: p.id, title: p.title });
    if (p.entityType && p.entityId) {
      if (!anchor) {
        anchor = { entityType: p.entityType, entityId: p.entityId };
        anchorDocId = p.id;
      }
      break;
    }
    cur = p.parentId;
  }

  let facts = await anchorFacts(anchor, orgId);
  let space: SpaceFact | null = null;
  let access: FolderAccessMode = { mode: "none" };
  if (facts.spaceId) {
    const sf = await spaceFact(facts.spaceId, orgId, () => folderAccessForSpace(facts.spaceId as string, userId, level));
    // A Space outside the org: the whole anchor chain is foreign, name none of it.
    if (sf.foreign) facts = NO_ANCHOR;
    space = sf.space;
    access = sf.access;
  }

  let folderPath: FolderStep[] = [];
  let folderPathComplete = true;
  let folder: { id: string; name: string } | null = null;
  if (facts.leafFolderId) {
    const chain = await folderChain(facts.leafFolderId, orgId, facts.spaceId);
    folderPathComplete = chain.complete;
    if (space) folderPath = folderSteps(chain.rows, access, userId, level);
    const leaf = chain.rows[chain.rows.length - 1];
    if (leaf && leaf.id === facts.leafFolderId && !leaf.archivedAt) {
      // A folder anchor was read by the doc's own gate; a List's folder is
      // named only when the viewer can read it too.
      const named = anchor?.entityType === "FOLDER" || (await folderReadable(leaf.id, userId, level));
      if (named) folder = { id: leaf.id, name: leaf.name };
    }
  }

  return {
    state: "ok",
    placement: assembleDocPlacement({
      id: doc.id,
      title: doc.title,
      space,
      folderPath,
      folderPathComplete,
      folder,
      list: facts.list,
      task: facts.task,
      parents,
      anchorDocId,
    }),
  };
}

// ── Tables and canvases ──────────────────────────────────────────────

// Both gates (readableTable, whiteboardSpaceVisible) admit an object in a
// Space only through getSpaceForReader, which is the full-read rule, so the
// Space they sit in is always a "full" one in the viewer's tree.
const FULL_ACCESS = async (): Promise<FolderAccessMode> => ({ mode: "full" });

async function placeTable(id: string, session: Session): Promise<WorkGate> {
  const u = session.user as { id?: string; organizationId?: string } | undefined;
  if (!u?.id || !u.organizationId) return SIGNED_OUT;
  const table = await readableTable(id, u.organizationId, u.id, session);
  if (!table) return MISSING;
  const space = table.spaceId ? (await spaceFact(table.spaceId, u.organizationId, FULL_ACCESS)).space : null;
  return { state: "ok", placement: assembleSpaceItemPlacement("table", { id: table.id, title: table.name, space }) };
}

async function placeCanvas(id: string, session: Session): Promise<WorkGate> {
  const viewer = await loadSuiteViewer(session);
  if ("error" in viewer) return SIGNED_OUT;
  const wb = await prisma.whiteboard.findFirst({
    where: { id, organizationId: viewer.orgId, archivedAt: null },
    select: { id: true, name: true, spaceId: true, folderId: true },
  });
  if (!wb || !(await whiteboardSpaceVisible(wb.spaceId, viewer.userId, viewer.accessLevel))) return MISSING;
  const space = wb.spaceId ? (await spaceFact(wb.spaceId, viewer.orgId, FULL_ACCESS)).space : null;
  // The canvas's Folder, walked inside the canvas's OWN Space only: a folderId
  // left over from a Space move names a Folder elsewhere, and folderChain
  // stops at the first row outside that Space, so such a Folder is never
  // named here (nestedFolderIds then leaves the canvas at the Space level).
  let folder: SpaceItemFacts["folder"] = null;
  if (space && wb.folderId) {
    const chain = await folderChain(wb.folderId, viewer.orgId, space.id);
    const leaf = chain.rows[chain.rows.length - 1];
    if (leaf && leaf.id === wb.folderId) {
      folder = {
        id: leaf.id,
        name: leaf.name,
        path: folderSteps(chain.rows, { mode: "full" }, viewer.userId, viewer.accessLevel),
        complete: chain.complete,
      };
    }
  }
  return { state: "ok", placement: assembleSpaceItemPlacement("canvas", { id: wb.id, title: wb.name, space, folder }) };
}
