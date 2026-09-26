// The placement writes: where node-rules' placement rule (P1 to P7) is asked
// for a route and where a move is written.
//
// Every route that makes a node inside a container, moves one, reorders one
// under a new parent or restores one into a container goes through here, so
// the rule is asked once, in one world, and the write is one transaction:
//
//   checkCreate       P1, answered as ok, a 403 with its sentence, or a 404
//                     when the viewer can neither open the container nor pass
//                     through it (nothing about it is confirmed)
//   checkMove         P2 and P4, the same answers
//   resolvePlacement  P3, the Space a request lands in, derived from its
//                     parent Folder and checked against the org and Trash
//   moveFolder        a Folder with its WHOLE subtree: sub-folders, Lists,
//                     canvases and files take the new Space in the same
//                     transaction, under row locks, or nothing is written
//   moveList, moveCanvas, moveTable
//   lockParentFolder  the create half of P3: a create reads its parent's
//                     Space under a share lock, so a move of that parent can
//                     never split it from its new child
//   moveDestinations  P5, exactly the places checkMove accepts, for the Move
//                     dialog and the row menus
//
// Docs are anchored, not placed by a column: PUT /api/docs/[id] builds its
// destination place and asks checkMove with it.
//
// Server-only: prisma.

import { prisma } from "../prisma";
import type { Prisma } from "@/generated/prisma";
import {
  NodeEvaluator,
  createDecision,
  createRefusal,
  currentPlace,
  derivePlacement,
  docAnchorPlace,
  docNestLoops,
  emptyGrants,
  folderDeleteAllowed,
  folderMoveAllowed,
  FOLDER_SUBTREE_MOVE_REFUSAL,
  emptyRows,
  fileEditDecision,
  fileMoveVerdict,
  filePlace,
  moveRefusal,
  moveVerdict,
  placeHolds,
  placeKindOf,
  refKey,
  roleAtLeast,
  subtreeAnchorPlan,
  type DocHome,
  type NodeCtx,
  type NodeRef,
  type NodeRows,
  type Place,
  type PlaceKind,
  type Placement,
  type PlacementFolderFact,
  type ViewerGrants,
} from "./node-rules";
import { loadWorld } from "./node-world";
import { listVisibleSpaces, viewerPathContainers } from "./node-access";

type Tx = Prisma.TransactionClient;
/** Anything that runs a raw query: the client, a transaction, or a narrower pick of either. */
type RawDb = Pick<Tx, "$queryRaw">;

export type PlaceRefusal = { ok: false; status: 400 | 403 | 404 | 409; error: string };

const fail = (status: PlaceRefusal["status"], error: string): PlaceRefusal => ({ ok: false, status, error });

/** Folders nest at most six deep (the sidebar renders no deeper). */
export const MAX_FOLDER_DEPTH = 6;

function viewerOf(ctx: NodeCtx) {
  return { userId: ctx.userId, orgAdmin: ctx.orgAdmin, orgGuest: ctx.orgGuest, isAgent: ctx.isAgent, denied: ctx.denied };
}

/** Is this Space or Folder on the viewer's way to something they were given (R10)? Lists and pages are never paths. */
async function isPath(ctx: NodeCtx, place: NodeRef): Promise<boolean> {
  if (place.kind !== "space" && place.kind !== "folder") return false;
  if (ctx.orgAdmin || ctx.denied) return false;
  return (await viewerPathContainers(ctx)).has(refKey(place));
}

/** Can the viewer at least see this container (a role, or a path through it)? */
async function seesPlace(ctx: NodeCtx, ev: NodeEvaluator, place: NodeRef): Promise<boolean> {
  return roleAtLeast(ev.effective(place).role, "VIEW") || (await isPath(ctx, place));
}

// ── P1 ───────────────────────────────────────────────────────────────

/**
 * P1 for a route: may the viewer create `what` in `place`? A refusal is a
 * 403 with createRefusal's sentence, or a 404 when the viewer can neither
 * open the container nor pass through it.
 */
export async function checkCreate(ctx: NodeCtx, place: Place, what: PlaceKind): Promise<{ ok: true } | PlaceRefusal> {
  if (ctx.denied) return fail(404, "Not found");
  if (!placeHolds(place, what)) return fail(400, createRefusal(what, place));
  if (!place) {
    return createDecision(emptyRows(ctx.organizationId), emptyGrants(viewerOf(ctx)), null, what) ? { ok: true } : fail(403, createRefusal(what, null));
  }
  const { rows, grants } = await loadWorld(ctx, [place], { chain: true });
  if (createDecision(rows, grants, place, what)) return { ok: true };
  if (!(await seesPlace(ctx, new NodeEvaluator(rows, grants), place))) return fail(404, "Not found");
  return fail(403, createRefusal(what, place));
}

// ── P2, P4 ───────────────────────────────────────────────────────────

/**
 * P2 and P4 for a route: may the viewer move `ref` to `dest` (null: the org
 * root)? `same` is a reorder under the parent it already has. A refusal is a
 * 403 with moveRefusal's sentence; a destination the viewer can neither open
 * nor pass through answers 404, so a guessed id confirms nothing.
 */
export async function checkMove(ctx: NodeCtx, ref: NodeRef, dest: Place): Promise<{ ok: true; same: boolean } | PlaceRefusal> {
  const what = placeKindOf(ref);
  if (ctx.denied || !what) return fail(404, "Not found");
  const { rows, grants } = await loadWorld(ctx, dest ? [ref, dest] : [ref], { chain: true });
  const verdict = moveVerdict(rows, grants, ref, dest);
  if (verdict.ok) return verdict;
  if (verdict.failure === "destination" && dest && !(await seesPlace(ctx, new NodeEvaluator(rows, grants), dest))) {
    return fail(404, "That place no longer exists.");
  }
  return fail(403, moveRefusal(what, verdict.failure));
}

// ── P3 ───────────────────────────────────────────────────────────────

interface FolderChainFact extends PlacementFolderFact {
  /** How many Folders sit above it (0 at a Space root). */
  depth: number;
}

/** A Folder in this org, whether it or any Folder above it is in Trash, and its depth. Null when no row matches. */
export async function folderPlacementFact(organizationId: string, folderId: string, db: RawDb = prisma): Promise<FolderChainFact | null> {
  const chain = await db.$queryRaw<Array<{ id: string; organizationId: string; spaceId: string; archivedAt: Date | null; depth: number }>>`
    WITH RECURSIVE up AS (
      SELECT f."id", f."organizationId", f."spaceId", f."parentFolderId", f."archivedAt", 0 AS depth
      FROM "Folder" f WHERE f."id" = ${folderId}
      UNION ALL
      SELECT p."id", p."organizationId", p."spaceId", p."parentFolderId", p."archivedAt", u.depth + 1
      FROM "Folder" p JOIN up u ON p."id" = u."parentFolderId"
      WHERE u.depth < 16
    )
    SELECT "id", "organizationId", "spaceId", "archivedAt", depth FROM up ORDER BY depth`;
  const self = chain[0];
  if (!self || self.organizationId !== organizationId) return null;
  return {
    id: self.id,
    organizationId: self.organizationId,
    spaceId: self.spaceId,
    inTrash: chain.some((r) => r.archivedAt !== null),
    depth: Math.max(0, chain.length - 1),
  };
}

/**
 * P3 for a route: where a request lands. A named Folder settles the Space (a
 * Space that disagrees is a 400, a Folder in another org a 404, one in Trash
 * a 400); with no Folder the named Space's root; with neither the org root
 * when `root` allows it.
 */
export async function resolvePlacement(
  organizationId: string,
  req: { spaceId?: string | null; folderId?: string | null },
  opts: { root?: boolean } = {},
): Promise<Placement & { depth?: number }> {
  const folderId = req.folderId || null;
  const folder = folderId ? await folderPlacementFact(organizationId, folderId) : undefined;
  const spaceId = folder ? folder.spaceId : req.spaceId || null;
  const space = spaceId
    ? await prisma.space.findFirst({ where: { id: spaceId, organizationId }, select: { id: true, organizationId: true, archivedAt: true } })
    : null;
  const placed = derivePlacement(
    organizationId,
    req,
    { folder, space: space ? { id: space.id, organizationId: space.organizationId, archived: space.archivedAt !== null } : null },
    opts,
  );
  return placed.ok && folder ? { ...placed, depth: folder.depth } : placed;
}

/**
 * P3 then P1 for a create that names a Space and maybe a Folder: where it
 * lands and whether the viewer may make `what` there. In that order, so a
 * probe learns nothing: a named Folder or Space the viewer can neither open
 * nor pass through is a 404 before anything else is said about it; then a
 * Space that disagrees with the Folder, or a Folder in Trash, is a 400; then
 * Can edit (P1) is the 403. With neither a Folder nor a Space, the org root
 * when `root` allows it.
 *
 * A place the rule lets the viewer create in is never a 404, even when they
 * cannot open it: P7's Space OWNER or ADMIN from before the cutoff makes
 * Lists and Folders in a Private Folder of their Space that does not name
 * them, exactly as the move helper lets them move one there. The 404 came
 * first once, which left that branch of P7 dead in every create route.
 */
export async function resolveCreate(
  ctx: NodeCtx,
  req: { spaceId?: string | null; folderId?: string | null },
  what: PlaceKind,
  opts: { root?: boolean } = {},
): Promise<{ ok: true; spaceId: string | null; folderId: string | null; place: Place } | PlaceRefusal> {
  if (ctx.denied) return fail(404, "Not found");
  const named: NodeRef | null = req.folderId ? { kind: "folder", id: req.folderId } : req.spaceId ? { kind: "space", id: req.spaceId } : null;
  if (named) {
    const { rows, grants } = await loadWorld(ctx, [named], { chain: true });
    if (!createDecision(rows, grants, named, what) && !(await seesPlace(ctx, new NodeEvaluator(rows, grants), named))) {
      return fail(404, "Not found");
    }
  }
  const placed = await resolvePlacement(ctx.organizationId, req, opts);
  if (!placed.ok) return fail(placed.status, placed.message);
  const place: Place = placed.folderId ? { kind: "folder", id: placed.folderId } : placed.spaceId ? { kind: "space", id: placed.spaceId } : null;
  const gate = await checkCreate(ctx, place, what);
  if (!gate.ok) return gate;
  return { ok: true, spaceId: placed.spaceId, folderId: placed.folderId, place };
}

/**
 * The create half of P3, inside the create's transaction: the parent Folder
 * read under a share lock, so a concurrent move of it waits for this create
 * (and this create for that move), and the Space the new row takes is the
 * Space the parent has at that moment. Null when the parent is not in this
 * org or is in Trash.
 */
export async function lockParentFolder(tx: Tx, organizationId: string, folderId: string): Promise<{ spaceId: string } | null> {
  const rows = await tx.$queryRaw<Array<{ spaceId: string; archivedAt: Date | null }>>`
    SELECT "spaceId", "archivedAt" FROM "Folder" WHERE "id" = ${folderId} AND "organizationId" = ${organizationId} FOR SHARE`;
  const row = rows[0];
  if (!row || row.archivedAt) return null;
  const chain = await folderPlacementFact(organizationId, folderId, tx);
  if (!chain || chain.inTrash) return null;
  return { spaceId: row.spaceId };
}

/** Thrown inside a placement transaction; answered as its status, with nothing written. */
export class PlacementConflict extends Error {
  constructor(message: string, readonly status: 400 | 403 | 409 = 409) {
    super(message);
  }
}

/** Every Folder beneath `rootId` (in Trash or not: all of it travels), with its depth below it. */
export async function folderBranch(db: RawDb, organizationId: string, rootId: string): Promise<Array<{ id: string; depth: number }>> {
  const rows = await db.$queryRaw<Array<{ id: string; depth: number }>>`
    WITH RECURSIVE down AS (
      SELECT f."id", 1 AS depth FROM "Folder" f WHERE f."parentFolderId" = ${rootId} AND f."organizationId" = ${organizationId}
      UNION ALL
      SELECT c."id", d.depth + 1 FROM "Folder" c JOIN down d ON c."parentFolderId" = d."id"
      WHERE c."organizationId" = ${organizationId} AND d.depth < 16
    )
    SELECT "id", MIN(depth)::int AS depth FROM down WHERE "id" <> ${rootId} GROUP BY "id"`;
  return rows.map((r) => ({ id: r.id, depth: Number(r.depth) }));
}

/** How many times lockFolderBranch reads the branch again before it gives up (a branch that keeps growing under it). */
export const BRANCH_LOCK_ROUNDS = 8;

/**
 * The move half of P3: lock a Folder and every Folder beneath it FOR UPDATE,
 * reading the branch again after each lock until no Folder appears that is
 * not locked yet, and answer the ids of the whole branch as it stands under
 * the locks (the Folder first).
 *
 * Why a second read. A create takes a share lock on its parent
 * (lockParentFolder), so a sub-folder being made under a Folder of the
 * branch holds that lock while this move waits for it; the create commits
 * while the move waits, and a branch read BEFORE the wait never names the new
 * sub-folder. Rewriting only the ids read first left that sub-folder in the
 * Space its parent just left (a live race split 14 Folders that way). Once
 * every Folder of the branch is locked FOR UPDATE, no create can add a child
 * under any of them until this move commits, and then it reads the parent's
 * new Space under its own lock and is refused if it named the old one. So a
 * read after the last lock that finds nothing new is the whole branch.
 */
export async function lockFolderBranch(db: RawDb, organizationId: string, rootId: string): Promise<string[]> {
  const locked = new Set<string>();
  let ids = [rootId, ...(await folderBranch(db, organizationId, rootId)).map((b) => b.id)];
  for (let round = 0; round < BRANCH_LOCK_ROUNDS; round += 1) {
    const fresh = ids.filter((id) => !locked.has(id)).sort();
    if (fresh.length === 0) return ids;
    await db.$queryRaw`SELECT "id" FROM "Folder" WHERE "id" = ANY(${fresh}::text[]) FOR UPDATE`;
    for (const id of fresh) locked.add(id);
    ids = [rootId, ...(await folderBranch(db, organizationId, rootId)).map((b) => b.id)];
  }
  throw new PlacementConflict("This folder's contents kept changing while it moved. Try again.");
}

/** Whiteboard.folderId ships in its own SQL file: a database without it still moves Folders, and the probe never runs inside a transaction. */
let canvasFolderColumn: boolean | null = null;
export async function canvasesHaveFolders(): Promise<boolean> {
  if (canvasFolderColumn !== null) return canvasFolderColumn;
  try {
    await prisma.whiteboard.findFirst({ where: { folderId: "__probe__" }, select: { id: true } });
    canvasFolderColumn = true;
  } catch {
    canvasFolderColumn = false;
  }
  return canvasFolderColumn;
}

async function lastPosition(tx: Tx, spaceId: string, parentFolderId: string | null, exceptId: string): Promise<number> {
  const last = await tx.folder.findFirst({
    where: { spaceId, parentFolderId, id: { not: exceptId } },
    orderBy: { position: "desc" },
    select: { position: true },
  });
  return (last?.position ?? 0) + 1024;
}

// ── moves ────────────────────────────────────────────────────────────

export interface MovedFolder { id: string; name: string; spaceId: string; parentFolderId: string | null; position: number }

/**
 * Move a Folder under another Folder or to a Space's root (P2, P3, P4).
 *
 * `parentFolderId` is the new parent, or null for the root of `spaceId` (the
 * Folder's own Space when absent). With a parent the Space is the parent's,
 * and a `spaceId` that disagrees is refused. The parent it already has is a
 * reorder (P4). When the Space changes, the Folder's whole subtree goes with
 * it in the same transaction: every sub-folder at any depth, every List in
 * any of them, every canvas and every file placed in any of them. Docs
 * follow their Folder and List anchors, so they need no write.
 */
export async function moveFolder(
  ctx: NodeCtx,
  folderId: string,
  req: { spaceId?: string | null; parentFolderId: string | null; position?: number },
): Promise<{ ok: true; folder: MovedFolder; moved: boolean; movedFolders: number } | PlaceRefusal> {
  const org = ctx.organizationId;
  const folder = await prisma.folder.findFirst({
    where: { id: folderId, organizationId: org },
    select: { id: true, name: true, spaceId: true, parentFolderId: true, position: true },
  });
  if (!folder) return fail(404, "Not found");
  const placed = await resolvePlacement(org, {
    spaceId: req.parentFolderId ? req.spaceId : req.spaceId ?? folder.spaceId,
    folderId: req.parentFolderId,
  });
  if (!placed.ok) return fail(placed.status, placed.message);
  const destSpaceId = placed.spaceId as string;
  const destFolderId = placed.folderId;
  if (destFolderId === folder.id) return fail(400, "A folder can't move inside itself.");
  const branch = await folderBranch(prisma, org, folder.id);
  if (destFolderId && branch.some((b) => b.id === destFolderId)) return fail(400, "A folder can't move inside itself.");
  const height = branch.reduce((m, b) => Math.max(m, b.depth), 0);
  if (destFolderId && (placed.depth ?? 0) + 1 + height >= MAX_FOLDER_DEPTH) {
    return fail(400, `Folders can only nest ${MAX_FOLDER_DEPTH} levels deep.`);
  }

  const spaceChanges = destSpaceId !== folder.spaceId;
  const parentChanges = destFolderId !== folder.parentFolderId || spaceChanges;
  // A request that names exactly where the Folder already sits, with no new
  // position, writes nothing, so it asks nothing of the rule: a rename that
  // carries the Folder's own Space is no move (P3 refuses only a Space that
  // disagrees with the parent).
  if (!parentChanges && req.position === undefined) {
    return { ok: true, folder: { id: folder.id, name: folder.name, spaceId: folder.spaceId, parentFolderId: folder.parentFolderId, position: folder.position }, moved: false, movedFolders: 0 };
  }
  const dest: NodeRef = destFolderId ? { kind: "folder", id: destFolderId } : { kind: "space", id: destSpaceId };
  const check = await checkMove(ctx, { kind: "folder", id: folder.id }, dest);
  if (!check.ok) return check;
  // P2: a Folder that changes parent carries everything beneath it, so the
  // mover needs Full access on all of it (folderMoveAllowed). Asked here so a
  // refusal costs no transaction, and again under the locks below, where the
  // branch can no longer change.
  if (parentChanges) {
    const whole = await checkFolderSubtreeMove(ctx, folder.id, [folder.id, ...branch.map((b) => b.id)]);
    if (!whole.ok) return whole;
  }
  const canvases = spaceChanges || parentChanges ? await canvasesHaveFolders() : false;
  try {
    const result = await prisma.$transaction(async (tx) => {
      if (destFolderId) {
        const parent = await lockParentFolder(tx, org, destFolderId);
        if (!parent || parent.spaceId !== destSpaceId) throw new PlacementConflict("That folder just moved or went to Trash. Pick the place again.");
      }
      // P3: the whole branch as it stands under the locks, read again after
      // each lock (lockFolderBranch), so a sub-folder made while this move
      // waited moves with its parent instead of staying behind.
      const ids = await lockFolderBranch(tx, org, folder.id);
      if (destFolderId && ids.includes(destFolderId)) throw new PlacementConflict("A folder can't move inside itself.", 400);
      if (parentChanges) {
        const whole = await checkFolderSubtreeMove(ctx, folder.id, ids, canvases);
        if (!whole.ok) throw new PlacementConflict(whole.error, 403);
      }
      const position = req.position ?? (parentChanges ? await lastPosition(tx, destSpaceId, destFolderId, folder.id) : undefined);
      const row = await tx.folder.update({
        where: { id: folder.id },
        data: { spaceId: destSpaceId, parentFolderId: destFolderId, ...(position !== undefined ? { position } : {}) },
        select: { id: true, name: true, spaceId: true, parentFolderId: true, position: true },
      });
      if (spaceChanges) {
        const below = ids.slice(1);
        if (below.length) await tx.folder.updateMany({ where: { id: { in: below } }, data: { spaceId: destSpaceId } });
        await tx.board.updateMany({ where: { folderId: { in: ids } }, data: { spaceId: destSpaceId } });
        if (canvases) await tx.whiteboard.updateMany({ where: { folderId: { in: ids } }, data: { spaceId: destSpaceId } });
        await tx.fileEntry.updateMany({ where: { spaceFolderId: { in: ids } }, data: { spaceId: destSpaceId } });
      }
      return { row, count: spaceChanges ? ids.length - 1 : 0 };
    }, { timeout: 30_000, maxWait: 10_000 });
    return { ok: true, folder: result.row, moved: parentChanges, movedFolders: result.count };
  } catch (err) {
    if (err instanceof PlacementConflict) return fail(err.status, err.message);
    if (isLockConflict(err)) return fail(409, "Someone moved these folders at the same moment. Try again.");
    throw err;
  }
}

/**
 * A transaction Postgres ended to break a deadlock (40P01) or a serialization
 * failure (40001), which two moves crossing each other's branches can meet.
 * Nothing was written; the person tries again.
 */
function isLockConflict(err: unknown): boolean {
  const text = err instanceof Error ? err.message : String(err);
  const code = (err as { code?: string; meta?: { code?: string } } | null)?.meta?.code ?? (err as { code?: string } | null)?.code;
  return code === "P2034" || code === "40P01" || code === "40001" || /deadlock detected|could not serialize/i.test(text);
}

/**
 * P2 for a Folder that changes parent: node-rules folderMoveAllowed over one
 * world holding everything it carries (`folderIds`: the Folder and its whole
 * branch, with the Lists and canvases in any of them). The sentence names no
 * node the viewer cannot open.
 */
export async function checkFolderSubtreeMove(
  ctx: NodeCtx,
  folderId: string,
  folderIds: readonly string[],
  canvasColumn?: boolean,
): Promise<{ ok: true } | PlaceRefusal> {
  if (ctx.denied) return fail(404, "Not found");
  const org = ctx.organizationId;
  const ids = [...new Set([folderId, ...folderIds])];
  const withCanvases = canvasColumn ?? (await canvasesHaveFolders());
  const [lists, canvases] = await Promise.all([
    prisma.board.findMany({ where: { organizationId: org, folderId: { in: ids } }, select: { id: true } }),
    withCanvases
      ? prisma.whiteboard.findMany({ where: { organizationId: org, folderId: { in: ids } }, select: { id: true } })
      : Promise.resolve([] as Array<{ id: string }>),
  ]);
  const refs: NodeRef[] = [
    ...ids.map((id) => ({ kind: "folder" as const, id })),
    ...lists.map((l) => ({ kind: "list" as const, id: l.id })),
    ...canvases.map((c) => ({ kind: "canvas" as const, id: c.id })),
  ];
  const { rows, grants } = await loadWorld(ctx, refs, { chain: true });
  const inside = { folders: ids.filter((id) => id !== folderId), lists: lists.map((l) => l.id), canvases: canvases.map((c) => c.id) };
  if (folderMoveAllowed(rows, grants, folderId, inside)) return { ok: true };
  return fail(403, FOLDER_SUBTREE_MOVE_REFUSAL);
}

/**
 * Move a List into a Folder, or to a Space's root (P2, P3). `folderId` null
 * is the root of `spaceId` (the List's own Space when absent); with a Folder
 * the Space is the Folder's. A List of one person's own (the personal List)
 * never moves into a Space.
 */
export async function moveList(
  ctx: NodeCtx,
  listId: string,
  req: { spaceId?: string | null; folderId: string | null },
): Promise<{ ok: true; list: { id: string; spaceId: string | null; folderId: string | null }; moved: boolean } | PlaceRefusal> {
  const org = ctx.organizationId;
  const list = await prisma.board.findFirst({ where: { id: listId, organizationId: org }, select: { id: true, spaceId: true, folderId: true, productSlug: true } });
  if (!list) return fail(404, "Not found");
  if (list.productSlug === "personal-list") return fail(400, "Your personal List stays yours: it can't be moved into a Space.");
  const placed = await resolvePlacement(org, { spaceId: req.folderId ? req.spaceId : req.spaceId ?? list.spaceId, folderId: req.folderId });
  if (!placed.ok) return fail(placed.status, placed.message);
  const destSpaceId = placed.spaceId as string;
  const destFolderId = placed.folderId;
  const dest: NodeRef = destFolderId ? { kind: "folder", id: destFolderId } : { kind: "space", id: destSpaceId };
  const check = await checkMove(ctx, { kind: "list", id: list.id }, dest);
  if (!check.ok) return check;
  if (destSpaceId === list.spaceId && destFolderId === list.folderId) {
    return { ok: true, list: { id: list.id, spaceId: list.spaceId, folderId: list.folderId }, moved: false };
  }
  try {
    const row = await prisma.$transaction(async (tx) => {
      if (destFolderId) {
        const parent = await lockParentFolder(tx, org, destFolderId);
        if (!parent || parent.spaceId !== destSpaceId) throw new PlacementConflict("That folder just moved or went to Trash. Pick the place again.");
      }
      return tx.board.update({ where: { id: list.id }, data: { spaceId: destSpaceId, folderId: destFolderId }, select: { id: true, spaceId: true, folderId: true } });
    });
    return { ok: true, list: row, moved: true };
  } catch (err) {
    if (err instanceof PlacementConflict) return fail(err.status, err.message);
    throw err;
  }
}

/**
 * Move a canvas into a Folder, to a Space's root, or out of every Space
 * (`spaceId` null and no Folder: the org's, which opens it to every Member).
 * With a Folder the Space is the Folder's, and moving to a Space's root
 * clears the Folder it had (P3: never a Folder of one Space under another).
 */
export async function moveCanvas(
  ctx: NodeCtx,
  canvasId: string,
  req: { spaceId: string | null; folderId?: string | null },
): Promise<{ ok: true; spaceId: string | null; folderId: string | null; moved: boolean } | PlaceRefusal> {
  const org = ctx.organizationId;
  const folders = await canvasesHaveFolders();
  const canvas = folders
    ? await prisma.whiteboard.findFirst({ where: { id: canvasId, organizationId: org, archivedAt: null }, select: { id: true, spaceId: true, folderId: true } })
    : await prisma.whiteboard
        .findFirst({ where: { id: canvasId, organizationId: org, archivedAt: null }, select: { id: true, spaceId: true } })
        .then((c) => (c ? { ...c, folderId: null as string | null } : null));
  if (!canvas) return fail(404, "Not found");
  if (req.folderId && !folders) return fail(400, "Canvases can't be placed in folders yet.");
  const placed = await resolvePlacement(org, { spaceId: req.spaceId, folderId: req.folderId ?? null }, { root: true });
  if (!placed.ok) return fail(placed.status, placed.message);
  const dest: Place = placed.folderId ? { kind: "folder", id: placed.folderId } : placed.spaceId ? { kind: "space", id: placed.spaceId } : null;
  const check = await checkMove(ctx, { kind: "canvas", id: canvas.id }, dest);
  if (!check.ok) return check;
  if (placed.spaceId === canvas.spaceId && placed.folderId === canvas.folderId) {
    return { ok: true, spaceId: canvas.spaceId, folderId: canvas.folderId, moved: false };
  }
  try {
    await prisma.$transaction(async (tx) => {
      if (placed.folderId) {
        const parent = await lockParentFolder(tx, org, placed.folderId);
        if (!parent || parent.spaceId !== placed.spaceId) throw new PlacementConflict("That folder just moved or went to Trash. Pick the place again.");
      }
      await tx.whiteboard.update({
        where: { id: canvas.id },
        data: { spaceId: placed.spaceId, ...(folders ? { folderId: placed.folderId } : {}) },
      });
    });
    return { ok: true, spaceId: placed.spaceId, folderId: placed.folderId, moved: true };
  } catch (err) {
    if (err instanceof PlacementConflict) return fail(err.status, err.message);
    throw err;
  }
}

/** Move a table to a Space's root, or out of every Space (null). Tables never sit in a Folder. */
export async function moveTable(ctx: NodeCtx, tableId: string, spaceId: string | null): Promise<{ ok: true; spaceId: string | null; moved: boolean } | PlaceRefusal> {
  const org = ctx.organizationId;
  const table = await prisma.dataTable.findFirst({ where: { id: tableId, organizationId: org }, select: { id: true, spaceId: true } });
  if (!table) return fail(404, "Not found");
  const placed = await resolvePlacement(org, { spaceId }, { root: true });
  if (!placed.ok) return fail(placed.status, placed.message);
  const dest: Place = placed.spaceId ? { kind: "space", id: placed.spaceId } : null;
  const check = await checkMove(ctx, { kind: "table", id: table.id }, dest);
  if (!check.ok) return check;
  if (placed.spaceId === table.spaceId) return { ok: true, spaceId: table.spaceId, moved: false };
  await prisma.dataTable.update({ where: { id: table.id }, data: { spaceId: placed.spaceId } });
  return { ok: true, spaceId: placed.spaceId, moved: true };
}

// ── docs ─────────────────────────────────────────────────────────────

/**
 * Where a page chain lives (node-rules DocHome): the first anchor on it, the
 * org's root, or closed when R6 reads it as reaching nobody (a missing or
 * foreign parent, a loop, deeper than eight pages above the start).
 */
export async function docHomeOf(
  organizationId: string,
  start: { entityType: string | null; entityId: string | null; parentId: string | null },
): Promise<DocHome> {
  if (start.entityType && start.entityId) return { kind: "anchor", entityType: start.entityType, entityId: start.entityId };
  const seen = new Set<string>();
  let cursor = start.parentId;
  for (let hops = 0; cursor; hops += 1) {
    if (hops >= 8 || seen.has(cursor)) return { kind: "closed" };
    seen.add(cursor);
    const row: { entityType: string | null; entityId: string | null; parentId: string | null } | null = await prisma.doc.findFirst({
      where: { id: cursor, organizationId },
      select: { entityType: true, entityId: true, parentId: true },
    });
    if (!row) return { kind: "closed" };
    if (row.entityType && row.entityId) return { kind: "anchor", entityType: row.entityType, entityId: row.entityId };
    cursor = row.parentId;
  }
  return { kind: "root" };
}

/** Every page beneath a doc, at any depth (archived ones too: all of the tree travels), with its own anchor. */
export async function docDescendants(db: RawDb, organizationId: string, docId: string): Promise<Array<{ id: string; entityType: string | null; entityId: string | null }>> {
  return db.$queryRaw<Array<{ id: string; entityType: string | null; entityId: string | null }>>`
    WITH RECURSIVE down AS (
      SELECT d."id", d."entityType", d."entityId", 1 AS depth FROM "Doc" d WHERE d."parentId" = ${docId} AND d."organizationId" = ${organizationId}
      UNION ALL
      SELECT c."id", c."entityType", c."entityId", w.depth + 1 FROM "Doc" c JOIN down w ON c."parentId" = w."id"
      WHERE c."organizationId" = ${organizationId} AND w.depth < 32
    )
    SELECT DISTINCT "id", "entityType", "entityId" FROM down WHERE "id" <> ${docId}`;
}

/**
 * The advisory lock every doc re-parent in one org takes, as the pair
 * (DOC_TREE_LOCK, hashtext(organizationId)): a transaction lock, released at
 * commit or rollback.
 */
export const DOC_TREE_LOCK = 482901;

/** The page chain above `startId` (it first), as ids, bounded: a chain that loops repeats an id. */
async function docChainIds(db: RawDb, organizationId: string, startId: string): Promise<string[]> {
  const rows = await db.$queryRaw<Array<{ id: string }>>`
    WITH RECURSIVE up AS (
      SELECT d."id", d."parentId", 0 AS depth FROM "Doc" d WHERE d."id" = ${startId} AND d."organizationId" = ${organizationId}
      UNION ALL
      SELECT p."id", p."parentId", u.depth + 1 FROM "Doc" p JOIN up u ON p."id" = u."parentId"
      WHERE u.depth < 64 AND p."organizationId" = ${organizationId}
    )
    SELECT "id" FROM up ORDER BY depth`;
  return rows.map((r) => r.id);
}

/**
 * The write of a doc tree move (P3): the doc's own placement fields and, in
 * the same transaction, the anchor of every page beneath it that carries a
 * place of its own (node-rules subtreeAnchorPlan), so the page tree moves
 * whole. A tree whose new home is no place while a page beneath it has one is
 * refused (409), and nothing is written.
 *
 * A new parent page never makes a loop (node-rules docNestLoops). The
 * route asks it before, but two moves that each passed that read (A under B,
 * B under A) both committed and left a cycle no one could reach (round three,
 * break 2). So every re-parent in the org waits for the one before it on one
 * advisory lock, and the chain above the new parent is read again under it:
 * the doc on that chain, or a chain that already loops, is a 400 with
 * nothing written.
 */
export async function writeDocTreeMove(
  organizationId: string,
  docId: string,
  data: { parentId?: string | null; position?: number; isFolder?: boolean; entityType?: string | null; entityId?: string | null },
  after: { entityType: string | null; entityId: string | null; parentId: string | null } | null,
): Promise<{ ok: true; doc: { id: string; parentId: string | null; position: number; isFolder: boolean; entityType: string | null; entityId: string | null }; rewritten: number } | PlaceRefusal> {
  const homeAfter = after ? await docHomeOf(organizationId, after) : null;
  try {
    const result = await prisma.$transaction(async (tx) => {
      if (data.parentId) {
        await tx.$queryRaw`SELECT pg_advisory_xact_lock(${DOC_TREE_LOCK}::int, hashtext(${organizationId}))::text AS locked`;
        if (docNestLoops(docId, await docChainIds(tx, organizationId, data.parentId))) {
          throw new PlacementConflict("A page can't go inside itself or one of its own sub-pages.", 400);
        }
      }
      let rewrite: string[] = [];
      if (homeAfter) {
        const plan = subtreeAnchorPlan(homeAfter, await docDescendants(tx, organizationId, docId));
        if (!plan.ok) {
          throw new PlacementConflict("Pages inside this doc live in a place of their own, so it can't leave every place. Move it into a Space, a folder or a List instead.");
        }
        rewrite = plan.rewrite;
      }
      const doc = await tx.doc.update({
        where: { id: docId },
        data,
        select: { id: true, parentId: true, position: true, isFolder: true, entityType: true, entityId: true },
      });
      if (rewrite.length && homeAfter?.kind === "anchor") {
        await tx.doc.updateMany({ where: { id: { in: rewrite }, organizationId }, data: { entityType: homeAfter.entityType, entityId: homeAfter.entityId } });
      }
      return { doc, rewritten: rewrite.length };
    });
    return { ok: true, ...result };
  } catch (err) {
    if (err instanceof PlacementConflict) return fail(err.status, err.message);
    throw err;
  }
}

/**
 * The place a doc anchor names, for a route (node-rules docAnchorPlace): a
 * Space, a Folder, a List, or the List of a task (read here). Null for no
 * anchor and for the anchor types that are the org's. Undefined for a task
 * that is not in this org.
 */
export async function docAnchorPlaceOf(organizationId: string, anchor: { entityType: string | null; entityId: string | null }): Promise<Place | undefined> {
  if (!anchor.entityType || !anchor.entityId) return null;
  if (anchor.entityType === "BOARD_ITEM") {
    const item = await prisma.item.findFirst({ where: { id: anchor.entityId, organizationId }, select: { boardId: true } });
    return item ? { kind: "list", id: item.boardId } : undefined;
  }
  const rows = emptyRows(organizationId);
  return docAnchorPlace(rows, anchor.entityType, anchor.entityId);
}

/** Is this Space in the org and not archived? */
async function spaceLive(organizationId: string, spaceId: string): Promise<boolean> {
  return !!(await prisma.space.findFirst({ where: { id: spaceId, organizationId, archivedAt: null }, select: { id: true } }));
}

/** Is this Folder in the org, out of Trash with every Folder above it, and in a Space that is not archived? */
async function folderLive(organizationId: string, folderId: string): Promise<boolean> {
  const f = await folderPlacementFact(organizationId, folderId);
  return !!f && !f.inTrash && (await spaceLive(organizationId, f.spaceId));
}

/** Is this List in the org, not archived, and is every container it sits in live? A List in no Space (a personal List) has none. */
async function listLive(organizationId: string, boardId: string): Promise<boolean> {
  const b = await prisma.board.findFirst({ where: { id: boardId, organizationId, archivedAt: null }, select: { spaceId: true, folderId: true } });
  if (!b) return false;
  if (b.folderId && !(await folderLive(organizationId, b.folderId))) return false;
  if (b.spaceId && !(await spaceLive(organizationId, b.spaceId))) return false;
  return true;
}

/**
 * Is the place a doc is made, copied, moved or restored into still live
 * (node-rules P1: nothing is added to a place in Trash or archived)? Its
 * parent page and every page above it up to the first anchored one must be
 * there and out of Trash, and the anchor that settles its place (its own, or
 * that first anchored page's) must be live all the way up: a Space not
 * archived; a Folder out of Trash, with every Folder above it, in a Space not
 * archived; a List not archived, in a live Folder and Space; a task not
 * archived, on a live List. A chain that loops, runs too deep or names a
 * parent that is gone reads as no place (R6 reads it as closed). The org's
 * anchors (a note, any other type) stay open. A doc anchored in a Folder of
 * an archived Space once went through while every other create there was
 * refused (round three, break 5).
 */
export async function docPlaceLive(
  organizationId: string,
  doc: { entityType: string | null; entityId: string | null; parentId: string | null },
): Promise<boolean> {
  let anchor = { entityType: doc.entityType, entityId: doc.entityId };
  if (doc.parentId) {
    const chain = await prisma.$queryRaw<Array<{ parentId: string | null; entityType: string | null; entityId: string | null; archivedAt: Date | null }>>`
      WITH RECURSIVE up AS (
        SELECT d."id", d."parentId", d."entityType", d."entityId", d."archivedAt", 0 AS depth
        FROM "Doc" d WHERE d."id" = ${doc.parentId} AND d."organizationId" = ${organizationId}
        UNION ALL
        SELECT p."id", p."parentId", p."entityType", p."entityId", p."archivedAt", u.depth + 1
        FROM "Doc" p JOIN up u ON p."id" = u."parentId"
        WHERE u.depth < 16 AND p."organizationId" = ${organizationId} AND (u."entityType" IS NULL OR u."entityId" IS NULL)
      )
      SELECT "parentId", "entityType", "entityId", "archivedAt" FROM up ORDER BY depth`;
    if (chain.length === 0 || chain.some((p) => p.archivedAt !== null)) return false;
    const top = chain[chain.length - 1];
    const topAnchored = !!(top.entityType && top.entityId);
    if (!topAnchored && top.parentId) return false;
    if (!(anchor.entityType && anchor.entityId) && topAnchored) anchor = { entityType: top.entityType, entityId: top.entityId };
  }
  const id = anchor.entityId;
  if (!anchor.entityType || !id) return true;
  switch (anchor.entityType) {
    case "SPACE":
      return spaceLive(organizationId, id);
    case "FOLDER":
      return folderLive(organizationId, id);
    case "BOARD":
      return listLive(organizationId, id);
    case "BOARD_ITEM": {
      const item = await prisma.item.findFirst({ where: { id, organizationId, archivedAt: null }, select: { boardId: true } });
      return !!item && (await listLive(organizationId, item.boardId));
    }
    default:
      return true;
  }
}

// ── a form's destination ─────────────────────────────────────────────

/**
 * A form writes every response INTO its destination (a task on a List, a row
 * in a table), so choosing one is content created there on the chooser's
 * behalf: the placement rule (node-rules P1) asks Can edit on it, the role
 * making a task or a row there needs. A List or a table in another org, or
 * one the viewer cannot even open, reads as gone (a guessed id confirms
 * nothing); one they can open but not edit is a 403 with its sentence.
 */
export async function checkFormDestination(
  ctx: NodeCtx,
  dest: { boardId?: string | null; tableId?: string | null },
): Promise<{ ok: true } | PlaceRefusal> {
  if (ctx.denied) return fail(404, "Not found");
  const org = ctx.organizationId;
  const [board, table] = await Promise.all([
    dest.boardId ? prisma.board.findFirst({ where: { id: dest.boardId, organizationId: org, archivedAt: null }, select: { id: true } }) : Promise.resolve(null),
    dest.tableId ? prisma.dataTable.findFirst({ where: { id: dest.tableId, organizationId: org }, select: { id: true } }) : Promise.resolve(null),
  ]);
  if (dest.boardId && !board) return fail(400, "That List no longer exists");
  if (dest.tableId && !table) return fail(400, "That table no longer exists");
  const refs: NodeRef[] = [
    ...(board ? [{ kind: "list" as const, id: board.id }] : []),
    ...(table ? [{ kind: "table" as const, id: table.id }] : []),
  ];
  if (refs.length === 0) return { ok: true };
  const { rows, grants } = await loadWorld(ctx, refs);
  const ev = new NodeEvaluator(rows, grants);
  for (const r of refs) {
    const role = ev.effective(r).role;
    const noun = r.kind === "list" ? "List" : "table";
    if (!roleAtLeast(role, "VIEW")) return fail(400, `That ${noun} no longer exists`);
    if (!roleAtLeast(role, "EDIT")) return fail(403, `You need Can edit on that ${noun} to send responses to it.`);
  }
  return { ok: true };
}

// ── a file's place in the Space tree ─────────────────────────────────

/**
 * May the viewer move this file to `dest` (a Space's root, one of its
 * Folders, or null: out of every Space)? node-rules fileMoveVerdict over one
 * world, answered as the other moves are.
 */
export async function checkFileMove(
  ctx: NodeCtx,
  file: { spaceId: string | null; spaceFolderId: string | null; uploadedById: string | null },
  dest: Place,
): Promise<{ ok: true; same: boolean } | PlaceRefusal> {
  if (ctx.denied) return fail(404, "Not found");
  const refs: NodeRef[] = [];
  if (file.spaceFolderId) refs.push({ kind: "folder", id: file.spaceFolderId });
  else if (file.spaceId) refs.push({ kind: "space", id: file.spaceId });
  if (dest) refs.push(dest);
  const { rows, grants } = refs.length ? await loadWorld(ctx, refs, { chain: true }) : { rows: emptyRows(ctx.organizationId), grants: emptyGrants(viewerOf(ctx)) };
  const verdict = fileMoveVerdict(rows, grants, file, dest);
  if (verdict.ok) return verdict;
  if (verdict.failure === "destination" && dest && !(await seesPlace(ctx, new NodeEvaluator(rows, grants), dest))) {
    return fail(404, "That place no longer exists.");
  }
  return fail(403, moveRefusal("file", verdict.failure));
}

/**
 * P3 then P2 for a file's place in the Space tree (PATCH /api/files/[id]).
 * Where the request lands is derived from its destination, never taken from
 * the request (resolvePlacement): a Space folder settles the Space, and a
 * spaceId that disagrees with it (null included) is a 400, as is a folder in
 * Trash or in an archived Space; a Space alone is its root (archived: a 400);
 * neither is the org's. A named place the viewer can neither open nor pass
 * through is a 404 before anything else is said about it, so a guessed id
 * confirms nothing. Then fileMoveVerdict (checkFileMove). The write reads the
 * folder's Space again under the share lock (lockFolderPlacement), inside the
 * update's own transaction.
 */
export async function resolveFileMove(
  ctx: NodeCtx,
  file: { spaceId: string | null; spaceFolderId: string | null; uploadedById: string | null },
  req: { spaceFolderId: string | null; spaceId?: string | null },
): Promise<{ ok: true; spaceId: string | null; spaceFolderId: string | null; same: boolean } | PlaceRefusal> {
  if (ctx.denied) return fail(404, "Not found");
  const named: NodeRef | null = req.spaceFolderId ? { kind: "folder", id: req.spaceFolderId } : req.spaceId ? { kind: "space", id: req.spaceId } : null;
  if (named) {
    const { rows, grants } = await loadWorld(ctx, [named], { chain: true });
    if (!(await seesPlace(ctx, new NodeEvaluator(rows, grants), named))) return fail(404, "That place no longer exists.");
  }
  if (req.spaceFolderId && req.spaceId === null) return fail(400, "A file in a Space folder is in that folder's Space.");
  const placed = await resolvePlacement(ctx.organizationId, { spaceId: req.spaceId, folderId: req.spaceFolderId }, { root: true });
  if (!placed.ok) return fail(placed.status, placed.message);
  const check = await checkFileMove(ctx, file, filePlace({ spaceId: placed.spaceId, spaceFolderId: placed.folderId }));
  if (!check.ok) return check;
  return { ok: true, spaceId: placed.spaceId, spaceFolderId: placed.folderId, same: check.same };
}

/**
 * The write half of P3 for a node a move puts in a Space folder (a file):
 * inside the write's transaction, the folder's Space read again under the
 * share lock every create takes (lockParentFolder). A move of that folder
 * then either waits for this write and carries it with the branch, or has
 * already committed, and this write is refused with nothing written. Without
 * it a file moved in while its folder changed Space kept the old Space under
 * a folder in the new one (round three, break 1).
 */
export async function lockFolderPlacement(tx: Tx, organizationId: string, placed: { spaceId: string | null; folderId: string | null }): Promise<void> {
  if (!placed.folderId) return;
  const parent = await lockParentFolder(tx, organizationId, placed.folderId);
  if (!parent || parent.spaceId !== placed.spaceId) throw new PlacementConflict("That folder just moved or went to Trash. Pick the place again.");
}

/**
 * May the viewer rename, re-describe, re-file (a drive folder) or Trash this
 * file? node-rules fileEditDecision over one world: Can edit where it sits in
 * the Space tree, or an org admin; a file of the org's, its uploader or any
 * Member. A Can view grantee never removes another person's file.
 */
export async function checkFileEdit(
  ctx: NodeCtx,
  file: { spaceId: string | null; spaceFolderId: string | null; uploadedById: string | null },
): Promise<{ ok: true } | PlaceRefusal> {
  if (ctx.denied) return fail(404, "Not found");
  const place = file.spaceFolderId ? { kind: "folder" as const, id: file.spaceFolderId } : file.spaceId ? { kind: "space" as const, id: file.spaceId } : null;
  const { rows, grants } = place ? await loadWorld(ctx, [place], { chain: true }) : { rows: emptyRows(ctx.organizationId), grants: emptyGrants(viewerOf(ctx)) };
  if (fileEditDecision(rows, grants, file)) return { ok: true };
  const where = file.spaceFolderId ? "folder" : "Space";
  return fail(403, place ? `You need Can edit on this ${where} to change or remove its files.` : "Only members of the workspace can change this file.");
}

// ── deletes that take a subtree ──────────────────────────────────────

/**
 * May the viewer delete (Trash or archive) this Folder with everything
 * beneath it? node-rules folderDeleteAllowed over one world holding the whole
 * subtree: Full access on the Folder and on every sub-folder, List and canvas
 * inside it (in Trash or not, since all of it goes), unless they manage the
 * Folder's Space. A narrow grant never takes away what other people were
 * given inside it. The sentence names no node the viewer cannot open.
 */
export async function checkFolderDelete(ctx: NodeCtx, folderId: string): Promise<{ ok: true } | PlaceRefusal> {
  if (ctx.denied) return fail(404, "Not found");
  const org = ctx.organizationId;
  const branch = await folderBranch(prisma, org, folderId);
  const folderIds = [folderId, ...branch.map((b) => b.id)];
  const [lists, canvases] = await Promise.all([
    prisma.board.findMany({ where: { organizationId: org, folderId: { in: folderIds } }, select: { id: true } }),
    (await canvasesHaveFolders())
      ? prisma.whiteboard.findMany({ where: { organizationId: org, folderId: { in: folderIds } }, select: { id: true } })
      : Promise.resolve([] as Array<{ id: string }>),
  ]);
  const refs: NodeRef[] = [
    ...folderIds.map((id) => ({ kind: "folder" as const, id })),
    ...lists.map((l) => ({ kind: "list" as const, id: l.id })),
    ...canvases.map((c) => ({ kind: "canvas" as const, id: c.id })),
  ];
  const { rows, grants } = await loadWorld(ctx, refs, { chain: true });
  const inside = { folders: branch.map((b) => b.id), lists: lists.map((l) => l.id), canvases: canvases.map((c) => c.id) };
  if (folderDeleteAllowed(rows, grants, folderId, inside)) return { ok: true };
  return fail(403, "You need Full access to everything in this folder to delete it.");
}

// ── P5 ───────────────────────────────────────────────────────────────

export interface DestinationFolder {
  id: string;
  name: string;
  /** Its parent among the listed Folders (null: directly under the Space). */
  parentFolderId: string | null;
  icon: string | null;
  color: string | null;
  /** A place the move would land (P2 accepts it). */
  pickable: boolean;
  /** Where the node is now. */
  current: boolean;
}

export interface DestinationSpace {
  id: string;
  name: string;
  slug: string;
  icon: string | null;
  color: string | null;
  /** Its root is a place the move would land. */
  pickable: boolean;
  current: boolean;
  /** The pickable Folders and every Folder on the way to one, parents before children. */
  folders: DestinationFolder[];
}

export interface MoveDestinations {
  /** Out of every Space (the org's): only for the kinds that may live there. */
  root: { pickable: boolean; current: boolean } | null;
  spaces: DestinationSpace[];
  /** Why nothing is pickable, when the node itself cannot move anywhere (a Folder carrying what the viewer does not hold Full access on). */
  refusal?: string;
}

/**
 * P5: the places a move of `ref` would land, for this viewer, from the one
 * rule (moveVerdict per place, in one world). Folders reached through a
 * grant inside a Space the viewer only passes through are included, with
 * that Space as a header that is not itself a destination. Nothing the
 * viewer can neither open nor pass through is named, not even a Private
 * Folder P7 would let a write land in. A Folder is never a destination for
 * itself or for anything beneath it, nor where the nesting limit would be
 * passed. Null when the viewer cannot open the node.
 */
export async function moveDestinations(ctx: NodeCtx, ref: NodeRef): Promise<MoveDestinations | null> {
  const what = placeKindOf(ref);
  if (!what || ctx.denied) return null;
  const org = ctx.organizationId;
  const spaces = await listVisibleSpaces(ctx, { paths: true });
  const inFolders = placeHolds({ kind: "folder", id: "" }, what);
  const folderRows = inFolders && spaces.length
    ? await prisma.folder.findMany({
        where: { organizationId: org, spaceId: { in: spaces.map((s) => s.id) }, archivedAt: null },
        orderBy: [{ position: "asc" }, { name: "asc" }],
        select: { id: true, name: true, parentFolderId: true, spaceId: true, icon: true, color: true },
      })
    : [];
  const refs: NodeRef[] = [ref, ...spaces.map((s) => ({ kind: "space" as const, id: s.id })), ...folderRows.map((f) => ({ kind: "folder" as const, id: f.id }))];
  const { rows, grants } = await loadWorld(ctx, refs, { chain: true });
  const ev = new NodeEvaluator(rows, grants);
  if (!roleAtLeast(ev.effective(ref).role, "VIEW")) return null;

  const here = currentPlace(rows, ref);
  const isHere = (p: Place) => here !== undefined && (p === null ? here === null : here !== null && here.kind === p.kind && here.id === p.id);

  // A Folder never goes into itself, anything beneath it, or past the depth
  // limit; and it goes nowhere when it carries what the viewer does not hold
  // Full access on (P2, folderMoveAllowed), exactly as the move refuses.
  const excluded = new Set<string>();
  let height = 0;
  let refusal: string | undefined;
  if (ref.kind === "folder") {
    const branch = await folderBranch(prisma, org, ref.id);
    excluded.add(ref.id);
    for (const b of branch) excluded.add(b.id);
    height = branch.reduce((m, b) => Math.max(m, b.depth), 0);
    const whole = await checkFolderSubtreeMove(ctx, ref.id, [ref.id, ...branch.map((b) => b.id)]);
    if (!whole.ok) refusal = whole.error;
  }
  const lands = (p: Place) => {
    if (refusal) return false;
    const v = moveVerdict(rows, grants, ref, p);
    return v.ok && !v.same;
  };
  const byId = new Map(folderRows.map((f) => [f.id, f]));
  const depthOf = (id: string): number => {
    let d = 0;
    let cursor = byId.get(id)?.parentFolderId ?? null;
    const seen = new Set<string>([id]);
    while (cursor && !seen.has(cursor) && d < 16) {
      seen.add(cursor);
      d += 1;
      cursor = byId.get(cursor)?.parentFolderId ?? null;
    }
    return d;
  };

  const paths = ctx.orgAdmin ? new Set<string>() : await viewerPathContainers(ctx);
  const sees = (r: NodeRef) => roleAtLeast(ev.effective(r).role, "VIEW") || paths.has(refKey(r));

  const out: DestinationSpace[] = [];
  for (const s of spaces) {
    const spaceRef: NodeRef = { kind: "space", id: s.id };
    const inSpace = folderRows.filter((f) => f.spaceId === s.id);
    const pick = new Set<string>();
    for (const f of inSpace) {
      const fr: NodeRef = { kind: "folder", id: f.id };
      if (excluded.has(f.id)) continue;
      if (ref.kind === "folder" && depthOf(f.id) + 1 + height >= MAX_FOLDER_DEPTH) continue;
      if (!roleAtLeast(ev.effective(fr).role, "VIEW")) continue;
      if (lands(fr)) pick.add(f.id);
    }
    // Keep the pickable Folders, the current one, and the Folders on the way to them.
    const keep = new Set<string>();
    const keepUp = (id: string) => {
      let cursor: string | null = id;
      const seen = new Set<string>();
      while (cursor && !seen.has(cursor)) {
        seen.add(cursor);
        if (!sees({ kind: "folder", id: cursor })) break;
        keep.add(cursor);
        cursor = byId.get(cursor)?.parentFolderId ?? null;
      }
    };
    for (const id of pick) keepUp(id);
    if (here?.kind === "folder" && byId.get(here.id)?.spaceId === s.id) keepUp(here.id);
    const rootPick = placeHolds(spaceRef, what) && lands(spaceRef);
    const current = isHere(spaceRef);
    if (!rootPick && keep.size === 0 && !current) continue;
    if (!sees(spaceRef)) continue;
    const ordered: DestinationFolder[] = [];
    const visit = (parent: string | null) => {
      for (const f of inSpace) {
        if (!keep.has(f.id)) continue;
        const p = f.parentFolderId && keep.has(f.parentFolderId) ? f.parentFolderId : null;
        if (p !== parent) continue;
        ordered.push({ id: f.id, name: f.name, parentFolderId: p, icon: f.icon, color: f.color, pickable: pick.has(f.id), current: isHere({ kind: "folder", id: f.id }) });
        visit(f.id);
      }
    };
    visit(null);
    out.push({ id: s.id, name: s.name, slug: s.slug, icon: s.icon, color: s.color, pickable: rootPick, current, folders: ordered });
  }
  const root = placeHolds(null, what) ? { pickable: lands(null), current: isHere(null) } : null;
  return refusal ? { root, spaces: out, refusal } : { root, spaces: out };
}

/**
 * P5 for a create (node-rules P1): the places this viewer may make `what` in,
 * for the create pickers (Create list, a sprint, a template's landing place).
 * The same shape as moveDestinations: every Space the viewer can open or pass
 * through that holds a pickable place, its root pickable when P1 accepts it,
 * and the Folders P1 accepts with every Folder on the way to one. A Folder
 * reached through a grant inside a Space the viewer only passes through is
 * listed under that Space, which is then a header and not itself a place. So
 * a Can view holder is offered nothing, and a Can edit grantee of one Folder
 * is offered that Folder. Nothing the viewer can neither open nor pass
 * through is named.
 */
export async function createDestinations(ctx: NodeCtx, what: PlaceKind): Promise<MoveDestinations> {
  return placeDestinations(ctx, what, (rows, grants, place) => createDecision(rows, grants, place, what));
}

/**
 * P5 for a file (node-rules fileMoveVerdict): the places a move of this file
 * would land, for the file Move dialog, in the same shape. The file's own
 * place is marked current and is never a destination. The caller has checked
 * that the viewer can read the file.
 */
export async function fileMoveDestinations(
  ctx: NodeCtx,
  file: { spaceId: string | null; spaceFolderId: string | null; uploadedById: string | null },
): Promise<MoveDestinations> {
  const here = filePlace(file);
  return placeDestinations(
    ctx,
    "file",
    (rows, grants, place) => {
      const v = fileMoveVerdict(rows, grants, file, place);
      return v.ok && !v.same;
    },
    { here, extraRefs: here ? [here] : [] },
  );
}

/**
 * The walk both pickers share: every Space the viewer can open or pass
 * through, each Folder in it the viewer can open, and `accepts` asked of each
 * place (and of the org root when `what` may live there) in one world.
 */
async function placeDestinations(
  ctx: NodeCtx,
  what: PlaceKind,
  accepts: (rows: NodeRows, grants: ViewerGrants, place: Place) => boolean,
  opts: { here?: Place; extraRefs?: NodeRef[] } = {},
): Promise<MoveDestinations> {
  if (ctx.denied) return { root: null, spaces: [] };
  const org = ctx.organizationId;
  const spaces = await listVisibleSpaces(ctx, { paths: true });
  const inFolders = placeHolds({ kind: "folder", id: "" }, what);
  const folderRows = inFolders && spaces.length
    ? await prisma.folder.findMany({
        where: { organizationId: org, spaceId: { in: spaces.map((s) => s.id) }, archivedAt: null },
        orderBy: [{ position: "asc" }, { name: "asc" }],
        select: { id: true, name: true, parentFolderId: true, spaceId: true, icon: true, color: true },
      })
    : [];
  const refs: NodeRef[] = [
    ...(opts.extraRefs ?? []),
    ...spaces.map((s) => ({ kind: "space" as const, id: s.id })),
    ...folderRows.map((f) => ({ kind: "folder" as const, id: f.id })),
  ];
  const { rows, grants } = refs.length
    ? await loadWorld(ctx, refs, { chain: true })
    : { rows: emptyRows(org), grants: emptyGrants(viewerOf(ctx)) };
  const ev = new NodeEvaluator(rows, grants);
  const paths = ctx.orgAdmin ? new Set<string>() : await viewerPathContainers(ctx);
  const sees = (r: NodeRef) => roleAtLeast(ev.effective(r).role, "VIEW") || paths.has(refKey(r));
  const byId = new Map(folderRows.map((f) => [f.id, f]));
  const here = opts.here;
  const isHere = (p: Place) => here !== undefined && (p === null ? here === null : here !== null && here.kind === p.kind && here.id === p.id);

  const out: DestinationSpace[] = [];
  for (const s of spaces) {
    const spaceRef: NodeRef = { kind: "space", id: s.id };
    if (!sees(spaceRef)) continue;
    const inSpace = folderRows.filter((f) => f.spaceId === s.id);
    const pick = new Set<string>();
    for (const f of inSpace) {
      const fr: NodeRef = { kind: "folder", id: f.id };
      if (!roleAtLeast(ev.effective(fr).role, "VIEW")) continue;
      if (accepts(rows, grants, fr)) pick.add(f.id);
    }
    const keep = new Set<string>();
    const keepUp = (id: string) => {
      let cursor: string | null = id;
      const seen = new Set<string>();
      while (cursor && !seen.has(cursor)) {
        seen.add(cursor);
        if (!sees({ kind: "folder", id: cursor })) break;
        keep.add(cursor);
        cursor = byId.get(cursor)?.parentFolderId ?? null;
      }
    };
    for (const id of pick) keepUp(id);
    if (here?.kind === "folder" && byId.get(here.id)?.spaceId === s.id) keepUp(here.id);
    const rootPick = placeHolds(spaceRef, what) && accepts(rows, grants, spaceRef);
    const current = isHere(spaceRef);
    if (!rootPick && keep.size === 0 && !current) continue;
    const ordered: DestinationFolder[] = [];
    const visit = (parent: string | null) => {
      for (const f of inSpace) {
        if (!keep.has(f.id)) continue;
        const p = f.parentFolderId && keep.has(f.parentFolderId) ? f.parentFolderId : null;
        if (p !== parent) continue;
        ordered.push({ id: f.id, name: f.name, parentFolderId: p, icon: f.icon, color: f.color, pickable: pick.has(f.id), current: isHere({ kind: "folder", id: f.id }) });
        visit(f.id);
      }
    };
    visit(null);
    out.push({ id: s.id, name: s.name, slug: s.slug, icon: s.icon, color: s.color, pickable: rootPick, current, folders: ordered });
  }
  const root = placeHolds(null, what) ? { pickable: accepts(rows, grants, null), current: isHere(null) } : null;
  return { root, spaces: out };
}
