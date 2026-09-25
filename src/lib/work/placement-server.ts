// placeObject: where an object sits in Work for this viewer, or why it does
// not open. The server half of src/lib/work/placement.ts.
//
// ONE RESOLVER. Every object is gated by the SAME function its own API gates
// it with, and those functions all ask the one node-access resolver
// (src/lib/access/node-access.ts):
//   doc     docAccess, exactly GET /api/docs/[id] (its anchor, its parent
//           page, its listing, the restricted switch)
//   table   readableTable with the session, exactly GET /api/tables/[id]
//   canvas  the org-scoped, not-archived row plus whiteboardReadable,
//           exactly GET /api/whiteboards/[id]
//   form    the org-scoped row plus Can view on it (a Guest opens a form
//           they made or were given, never another id)
//   sop     nothing on the server, like /sops/[id]: SOPs sit outside this
//           access model and the editor's own API is the gate
// Seeing the Space is never the permission: an object in a Space the viewer
// can open is still refused when its own gate refuses it.
//
// WHAT THE CRUMB NAMES comes from the same resolver's walk (nodePathWorld):
// a Space or Folder is named when the viewer can open it or passes through it
// on the way to what they were given (a path container, decision A3, whose
// page is its path view); a List only when they can open it, and a task only
// under a List they can open; a sub-page's parent pages only while they stay
// readable, nearest first. So the crumb, the reveal and the Work tree (built
// by the same rules in node-tree.ts) never disagree.
//
// NOTHING FOREIGN IS NAMED. Every lookup is scoped to the viewer's org (the
// resolver's loaders are too), and a fact that does not come back (a Space,
// Folder, List or task outside the org, or gone) makes the object loose: it
// opens at the door with nothing from that chain in its crumb.
//
// The access engine (src/lib/access resolve, facts, ids, gate and the rest)
// stays inert: node-access is the live resolver beside it.
//
// Server-only: prisma and the session.

import type { Session } from "next-auth";
import { prisma } from "@/lib/prisma";
import { docAccess } from "@/lib/doc-access";
import { readableTable, tableCtx } from "@/lib/table-gate";
import { whiteboardReadable } from "@/lib/whiteboard-gate";
import { loadSuiteViewer, type SuiteViewer } from "@/lib/suites/auth";
import { nodeCtxFromLevel, nodePathWorld, nodeRole, type NodeCtx, type NodePathStep } from "@/lib/access/node-access";
import { roleAtLeast, topAnchorDoc, type NodeRef } from "@/lib/access/node-rules";
import type { ObjectKind } from "@/lib/nav/object-href";
import {
  assembleDocPlacement,
  assembleSpaceItemPlacement,
  staticDoorPlacement,
  treeFolderIds,
  type DocFacts,
  type FolderStep,
  type SpaceFact,
  type SpaceItemFacts,
  type TreeAccess,
  type WorkGate,
} from "./placement";

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
    case "form":
      return placeForm(id, session);
    case "sop":
      return { state: "ok", placement: staticDoorPlacement(kind, id) };
  }
}

/** The node-access context of the viewer the suite routes gate with (their DB row's level). */
function ctxOf(viewer: SuiteViewer): NodeCtx {
  return nodeCtxFromLevel(viewer.userId, viewer.orgId, viewer.accessLevel);
}

const SPACE_SELECT = { id: true, slug: true, name: true, icon: true, color: true, archivedAt: true } as const;

/**
 * The Space on the walk, when the viewer can open it or passes through it
 * (and it is in the org and not archived): "full" or "path". Null otherwise,
 * and the object opens at the door.
 */
async function spaceFactFrom(steps: readonly NodePathStep[], orgId: string): Promise<SpaceFact | null> {
  const step = steps.find((s) => s.kind === "space");
  if (!step || !(step.readable || step.path)) return null;
  const s = await prisma.space.findFirst({ where: { id: step.id, organizationId: orgId }, select: SPACE_SELECT });
  if (!s || s.archivedAt) return null;
  return { id: s.id, slug: s.slug, name: s.name, icon: s.icon, color: s.color, access: step.readable ? "full" : "path" };
}

/**
 * The Folders on the walk, root first, with the tree's flag: a Folder renders
 * when the viewer can open it or passes through it, and it is not archived
 * (the Work tree never shows a Folder in Trash, nor anything inside one).
 */
async function folderStepsFrom(steps: readonly NodePathStep[], orgId: string): Promise<{ steps: FolderStep[]; names: Map<string, string> }> {
  const folders = steps.filter((s) => s.kind === "folder");
  const names = new Map(folders.map((f) => [f.id, f.name]));
  if (folders.length === 0) return { steps: [], names };
  const rows = await prisma.folder.findMany({
    where: { id: { in: folders.map((f) => f.id) }, organizationId: orgId },
    select: { id: true, archivedAt: true },
  });
  const live = new Set(rows.filter((r) => !r.archivedAt).map((r) => r.id));
  return { steps: folders.map((f) => ({ id: f.id, visible: live.has(f.id) && (f.readable || f.path) })), names };
}

function treeAccessOf(space: SpaceFact | null): TreeAccess {
  return space ? space.access : "none";
}

/**
 * The folders GET /api/work/locate may open for a Folder or List deep link:
 * the same walk and the same tree rule (treeFolderIds) the Work addresses use,
 * so no reveal anywhere opens, or names to the browser, a folder the viewer's
 * tree would not render. A path Folder (the viewer only passes through it) is
 * revealed like any other: the tree renders it at its real depth. Root first.
 */
export async function revealFolderIds(ctx: NodeCtx, target: { kind: "folder" | "list"; id: string }): Promise<string[]> {
  const { steps, self } = await nodePathWorld(ctx, target);
  const all = target.kind === "folder"
    ? [...steps, { kind: "folder" as const, id: target.id, name: "", slug: null, icon: null, color: null, readable: roleAtLeast(self.role, "VIEW"), path: self.path }]
    : steps;
  const space = await spaceFactFrom(all, ctx.organizationId);
  if (!space) return [];
  const folders = await folderStepsFrom(all, ctx.organizationId);
  return treeFolderIds(folders.steps, treeAccessOf(space));
}

// ── Docs ─────────────────────────────────────────────────────────────

const DOC_SELECT = { id: true, title: true, entityType: true, entityId: true, parentId: true } as const;

async function placeDoc(id: string, session: Session): Promise<WorkGate> {
  const viewer = await loadSuiteViewer(session);
  if ("error" in viewer) return SIGNED_OUT;
  const ctx = ctxOf(viewer);
  const orgId = viewer.orgId;

  // GET /api/docs/[id]'s gate: the one resolver's role on this doc.
  const doc = await prisma.doc.findFirst({ where: { id, organizationId: orgId }, select: DOC_SELECT });
  if (!doc || !(await docAccess(ctx, doc.id))) return MISSING;

  // The whole walk to the top anchor, in one world: parent pages (a sub-page
  // follows its parent, A6), the anchor's List and task, its Folders, its
  // Space, each with what the viewer may do with it.
  const { steps, rows } = await nodePathWorld(ctx, { kind: "doc", id: doc.id });
  const fact = rows.docs.get(doc.id);
  const top = fact ? topAnchorDoc(rows, fact) : null;

  // Parent pages the crumb names: nearest first, while they stay readable
  // and live. A parent the viewer cannot open stops the names there, and the
  // doc still takes its place from its top anchor, as the tree places it.
  const pageSteps = steps.filter((s) => s.kind === "doc");
  const pageRows = pageSteps.length
    ? await prisma.doc.findMany({ where: { id: { in: pageSteps.map((p) => p.id) }, organizationId: orgId }, select: { id: true, title: true, archivedAt: true } })
    : [];
  const pageById = new Map(pageRows.map((p) => [p.id, p]));
  const parents: DocFacts["parents"] = [];
  for (const p of [...pageSteps].reverse()) {
    const row = pageById.get(p.id);
    if (!p.readable || !row || row.archivedAt) break;
    parents.push({ id: p.id, title: row.title });
  }
  const anchorDocId = top && top.id !== doc.id && parents.some((p) => p.id === top.id) ? top.id : null;

  // Nothing above an unanchored chain (a root doc, a note, a suite anchor)
  // has a place in the Work tree: the doc opens at the door.
  const space = top ? await spaceFactFrom(steps, orgId) : null;
  const { steps: folderPath, names } = space ? await folderStepsFrom(steps, orgId) : { steps: [], names: new Map<string, string>() };

  // The anchor's own Folder, or its List's Folder: the last Folder on the walk.
  const leaf = folderPath[folderPath.length - 1];
  const folder = leaf && leaf.visible ? { id: leaf.id, name: names.get(leaf.id) ?? "" } : null;

  // The List of a List doc or a task doc: named only when the viewer can open
  // it; the task only under that List, and only while it is live.
  let list: DocFacts["list"] = null;
  let task: DocFacts["task"] = null;
  const listStep = steps.find((s) => s.kind === "list");
  if (space && listStep?.readable && listStep.slug) {
    const board = await prisma.board.findFirst({ where: { id: listStep.id, organizationId: orgId }, select: { id: true, archivedAt: true } });
    if (board && !board.archivedAt) {
      list = { id: listStep.id, slug: listStep.slug, name: listStep.name };
      if (top?.entityType === "BOARD_ITEM" && top.entityId) {
        const it = await prisma.item.findFirst({
          where: { id: top.entityId, organizationId: orgId, boardId: listStep.id },
          select: { id: true, title: true, archivedAt: true },
        });
        if (it && !it.archivedAt) task = { id: it.id, title: it.title };
      }
    }
  }

  return {
    state: "ok",
    placement: assembleDocPlacement({
      id: doc.id,
      title: doc.title,
      space,
      folderPath,
      folderPathComplete: true,
      folder,
      list,
      task,
      parents,
      anchorDocId,
    }),
  };
}

// ── Tables, canvases and forms ───────────────────────────────────────

async function placeTable(id: string, session: Session): Promise<WorkGate> {
  const u = session.user as { id?: string; organizationId?: string } | undefined;
  if (!u?.id || !u.organizationId) return SIGNED_OUT;
  const table = await readableTable(id, u.organizationId, u.id, session);
  if (!table) return MISSING;
  // A table given to the viewer in a Space they cannot open sits under that
  // Space as a path, the way the tree lists it; tables have no Folder.
  const space = table.spaceId
    ? await spaceFactFrom((await nodePathWorld(tableCtx(u.organizationId, u.id, session), { kind: "table", id: table.id })).steps, u.organizationId)
    : null;
  return { state: "ok", placement: assembleSpaceItemPlacement("table", { id: table.id, title: table.name, space }) };
}

async function placeCanvas(id: string, session: Session): Promise<WorkGate> {
  const viewer = await loadSuiteViewer(session);
  if ("error" in viewer) return SIGNED_OUT;
  const wb = await prisma.whiteboard.findFirst({
    where: { id, organizationId: viewer.orgId, archivedAt: null },
    select: { id: true, name: true, spaceId: true, folderId: true },
  });
  const ctx = ctxOf(viewer);
  if (!wb || !(await whiteboardReadable(ctx, wb))) return MISSING;
  const { steps } = await nodePathWorld(ctx, { kind: "canvas", id: wb.id } satisfies NodeRef);
  const space = wb.spaceId ? await spaceFactFrom(steps, viewer.orgId) : null;
  // The canvas's Folder, when the resolver reads it as the canvas's parent
  // (in the canvas's OWN Space: a folderId left over from a Space move names
  // a Folder elsewhere, and the walk never reaches it, so the canvas sits at
  // the Space level, where the tree lists it too).
  let folder: SpaceItemFacts["folder"] = null;
  if (space && wb.folderId) {
    const { steps: path, names } = await folderStepsFrom(steps, viewer.orgId);
    const leaf = path[path.length - 1];
    if (leaf && leaf.id === wb.folderId) folder = { id: leaf.id, name: names.get(leaf.id) ?? "", path, complete: true };
  }
  return { state: "ok", placement: assembleSpaceItemPlacement("canvas", { id: wb.id, title: wb.name, space, folder }) };
}

/**
 * A form opens at the door (forms have no Space), and only for a viewer who
 * holds Can view on it: the row is read, org-scoped, before anything is
 * placed, so an id the viewer cannot open is the in-shell 404.
 */
async function placeForm(id: string, session: Session): Promise<WorkGate> {
  const viewer = await loadSuiteViewer(session);
  if ("error" in viewer) return SIGNED_OUT;
  const form = await prisma.formDefinition.findFirst({ where: { id, organizationId: viewer.orgId }, select: { id: true, name: true } });
  if (!form) return MISSING;
  const d = await nodeRole(ctxOf(viewer), { kind: "form", id: form.id });
  if (!roleAtLeast(d.role, "VIEW")) return MISSING;
  return { state: "ok", placement: { ...staticDoorPlacement("form", form.id), title: form.name } };
}
