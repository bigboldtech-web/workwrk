// The facts loader for the STEP 1 delegates.
//
// facts.ts loads AccessFacts, the shape the engine's decide() answers over.
// This file loads LegacyInputs, the shape parity.ts's branch-for-branch
// transcription of today's helpers answers over. Both read the same tables;
// they differ in what the answer is allowed to be.
//
// Why two loaders exist, and why this one is not a step backwards:
//
//   The absolute rule for the pivot is that behaviour does not change. The
//   engine deliberately answers eight of these questions differently (the
//   audit 1.6 rows and the decisions the spec makes on purpose, all named in
//   parity.ts EXPECTED_MISMATCHES), so a delegate that routed straight to
//   can() would ship step 3's behaviour on step 1's day. Instead every legacy
//   helper now loads through here and decides through parity.ts, which means
//   the decision logic has left space.ts / board.ts / folder.ts / access.ts
//   and lives in ONE module with the engine, its answers are exercised by the
//   real request path rather than only read, and the flip in step 4 is a
//   one-line swap of legacyAnswer() for can() per helper, under the parity
//   job's protection.
//
// LOAD-AVOIDANCE RULES. Each one exists so a delegate issues no more queries
// than the helper it replaces, and each is safe because the branch it relies
// on returns before the skipped row is read. delegates.test.ts proves every
// rule by running the same world with the row present and absent:
//
//   A. Org admins stop after the primary row. Every legacy consumer of these
//      structs tests the admin ladder unconditionally and first
//      (space.ts:200/211/226, board.ts:617/677/721, folder.ts:176,
//      access.ts:137/170/209/242/275).
//   B. The folder ancestor walk and the folder's Space are skipped when the
//      viewer holds the folder's own row or owns it: folder.ts:185 and
//      access.ts:172-174 both return there.
//   C. A doc's anchor chain is skipped when resolveDoc returns before reading
//      it (admin, NOTEPAD, or the viewer created it): access.ts:239-253.
//
// Rules B and C are CONSUMER-SPECIFIC, and the structs these loaders build are
// shared between consumers that do not agree about them:
//
//   * Rule B is valid for resolveFolder and folderReadable, which both return
//     at the folder's own row. legacyGetBoardForReader does NOT: its WORKSPACE
//     branch (board.ts:661-664) consults the Space unconditionally, and
//     loadItemInputs reaches it through the board's folder chain. So the skip
//     is OPT-IN (`stopAtOwnGrant`), and the board and item paths never opt in.
//   * Rule C is valid for resolveDoc, which returns at the creator and admin
//     branches. legacyDocAccessible (doc-access.ts:41-88) has neither branch,
//     so it needs the anchor in both cases. The skip is likewise OPT-IN
//     (`consumer: "resolveDoc"`), and the default loads the anchor.
//
// Both options default to the SAFE, load-everything behaviour: a caller has to
// name the branch that makes the skip sound.
//
// Server only: this is the one file in the step-1 path that imports prisma.

import { prisma } from "@/lib/prisma";
import { legacyIsAdminLevel } from "./legacy-levels";
import type {
  LegacyBoard,
  LegacyFolder,
  LegacyInputs,
  LegacyItem,
  LegacySpace,
  SpaceRoleValue,
  VisibilityValue,
} from "./parity";

export interface LegacyViewer {
  userId: string;
  accessLevel: string | null | undefined;
  /**
   * Left undefined by the container gates in space.ts, board.ts and folder.ts,
   * which do NOT filter by organization today (their callers do). The struct's
   * organizationId is then filled from the loaded row, so the transcription's
   * org comparisons are always equal and the delegate can never introduce a
   * scope check that would 404 ids those helpers serve today.
   *
   * src/lib/access.ts passes its ViewerContext.organizationId, because its
   * resolvers DO compare (access.ts:134, :167, :206, :239, :272).
   */
  organizationId?: string | null;
}

const MEMBER_OF = (userId: string) => ({ where: { userId }, select: { role: true as const } });

function roleOf(members: Array<{ role: string }>): SpaceRoleValue | null {
  return (members[0]?.role as SpaceRoleValue | undefined) ?? null;
}

function base(viewer: LegacyViewer, rowOrgId?: string | null): LegacyInputs {
  return {
    userId: viewer.userId,
    organizationId: viewer.organizationId ?? rowOrgId ?? "",
    accessLevel: viewer.accessLevel ?? null,
  };
}

/** No rows at all. Used by the delegates whose legacy body returns before it
 *  queries anything (canEditSpace and canContributeSpace for an org admin). */
export function emptyLegacyInputs(viewer: LegacyViewer): LegacyInputs {
  return base(viewer);
}

// ── Space ─────────────────────────────────────────────────────────

const SPACE_INCLUDE = (userId: string) => ({ members: MEMBER_OF(userId) });

type SpaceRow = Awaited<ReturnType<typeof loadSpaceRow>>;

async function loadSpaceRow(spaceId: string, userId: string) {
  return prisma.space.findUnique({
    where: { id: spaceId },
    include: SPACE_INCLUDE(userId),
  });
}

function spaceFacts(row: NonNullable<SpaceRow>): LegacySpace {
  return {
    id: row.id,
    organizationId: row.organizationId,
    visibility: row.visibility as VisibilityValue,
    ownerId: row.ownerId,
    memberRole: roleOf(row.members),
    archived: row.archivedAt !== null,
    name: row.name,
  };
}

/**
 * One query, the same `include` space.ts:195-198 and access.ts:130-133 both
 * use, so the row handed back is byte-identical to what getSpaceForReader
 * returns today.
 */
export async function loadSpaceInputs(
  spaceId: string,
  viewer: LegacyViewer,
): Promise<{ inputs: LegacyInputs; space: SpaceRow }> {
  const row = await loadSpaceRow(spaceId, viewer.userId);
  const inputs = base(viewer, row?.organizationId);
  if (row) inputs.space = spaceFacts(row);
  return { inputs, space: row };
}

// ── Folder ────────────────────────────────────────────────────────

export interface FolderChain {
  folder: LegacyFolder | null;
  space: LegacySpace | null;
  organizationId: string | null;
}

/**
 * Folder row, then (rule B) the ancestor walk and the parent Space only when
 * the viewer holds neither the folder's own row nor its ownerId. The walk is
 * the same eight-hop findUnique loop as folder.ts:188-197 and access.ts:177-187
 * and stops at the first ancestor carrying a row, which is where both real
 * loops return.
 */
async function loadFolderChain(
  folderId: string,
  viewer: LegacyViewer,
  opts: { adminStop: boolean; stopAtOwnGrant: boolean },
): Promise<FolderChain> {
  const row = await prisma.folder.findUnique({
    where: { id: folderId },
    select: {
      id: true,
      organizationId: true,
      spaceId: true,
      parentFolderId: true,
      visibility: true,
      ownerId: true,
      archivedAt: true,
      name: true,
      members: MEMBER_OF(viewer.userId),
    },
  });
  if (!row) return { folder: null, space: null, organizationId: null };

  const folder: LegacyFolder = {
    id: row.id,
    organizationId: row.organizationId,
    spaceId: row.spaceId,
    parentFolderId: row.parentFolderId,
    visibility: row.visibility as VisibilityValue,
    ownerId: row.ownerId,
    memberRole: roleOf(row.members),
    archived: row.archivedAt !== null,
    name: row.name,
  };

  // Rule A: the admin branch precedes the walk in both consumers.
  if (opts.adminStop) return { folder, space: null, organizationId: row.organizationId };
  // Rule B, opt-in only: an own grant or ownership precedes the walk and the
  // Space in resolveFolder and folderReadable, but NOT in getBoardForReader.
  if (opts.stopAtOwnGrant && (folder.memberRole || folder.ownerId === viewer.userId)) {
    return { folder, space: null, organizationId: row.organizationId };
  }

  let cursor = row.parentFolderId;
  for (let hops = 0; cursor && hops < 8; hops++) {
    const parent: { parentFolderId: string | null; members: Array<{ role: string }> } | null =
      await prisma.folder.findUnique({
        where: { id: cursor },
        select: { parentFolderId: true, members: MEMBER_OF(viewer.userId) },
      });
    if (!parent) break;
    const role = roleOf(parent.members);
    if (role) {
      folder.ancestorMemberRole = role;
      return { folder, space: null, organizationId: row.organizationId };
    }
    cursor = parent.parentFolderId;
  }

  const spaceRow = await loadSpaceRow(row.spaceId, viewer.userId);
  return {
    folder,
    space: spaceRow ? spaceFacts(spaceRow) : null,
    organizationId: row.organizationId,
  };
}

export async function loadFolderInputs(
  folderId: string,
  viewer: LegacyViewer,
): Promise<{ inputs: LegacyInputs; found: boolean }> {
  const chain = await loadFolderChain(folderId, viewer, {
    adminStop: legacyIsAdminLevel(viewer.accessLevel),
    // folderReadable (folder.ts:185) and resolveFolder (access.ts:172-174)
    // both return on the folder's own row, so neither reads what is skipped.
    stopAtOwnGrant: true,
  });
  const inputs = base(viewer, chain.organizationId);
  if (chain.folder) inputs.folder = chain.folder;
  if (chain.space) inputs.space = chain.space;
  return { inputs, found: chain.folder !== null };
}

// ── Board ─────────────────────────────────────────────────────────

/** Exactly the select board.ts:611 used, so the row getBoardForReader hands
 *  back is the same shape and the same width as before the pivot. */
export interface LegacyBoardRow {
  id: string;
  spaceId: string | null;
  visibility: VisibilityValue;
  ownerId: string | null;
  organizationId: string;
  folderId: string | null;
}

/**
 * `folderDepth`:
 *   "none"    the consumer never reads the folder. canEditBoard (board.ts:677-704)
 *             and canContributeBoard (:721-746) go straight from the board row
 *             to the Space, so fetching the folder would be one query MORE
 *             than before the pivot.
 *   "shallow" the folder row only: board.ts:632-637's private-folder cascade
 *             reads visibility and ownerId and nothing else.
 *   "full"    the whole folder chain, because access.ts:218-220 hands the
 *             decision to resolveFolder.
 *
 * The board query folds the viewer's BoardMember row into the same round trip
 * that board.ts issues separately (board.ts:610 then :623), so the deep paths
 * cost one query fewer than before. Two shallow paths cost one MORE, because
 * they returned on a field of the board row itself: canEditBoard for the
 * board's owner (board.ts:683) and folderReadable for an org admin
 * (folder.ts:176) now load a parent row they did not need. Answers are
 * identical; only the round trip count moves, and never above the old maximum.
 */
export async function loadBoardInputs(
  boardId: string,
  viewer: LegacyViewer,
  opts: { folderDepth: "none" | "shallow" | "full" },
): Promise<{ inputs: LegacyInputs; board: LegacyBoardRow | null }> {
  const row = await prisma.board.findUnique({
    where: { id: boardId },
    select: {
      id: true,
      spaceId: true,
      visibility: true,
      ownerId: true,
      organizationId: true,
      folderId: true,
      archivedAt: true,
      name: true,
      members: MEMBER_OF(viewer.userId),
    },
  });
  if (!row) return { inputs: base(viewer), board: null };

  const { members, archivedAt, name, ...rest } = row;
  const boardRow: LegacyBoardRow = { ...rest, visibility: rest.visibility as VisibilityValue };
  const inputs = base(viewer, row.organizationId);
  const board: LegacyBoard = {
    id: row.id,
    organizationId: row.organizationId,
    spaceId: row.spaceId,
    folderId: row.folderId,
    visibility: row.visibility as VisibilityValue,
    ownerId: row.ownerId,
    memberRole: roleOf(members),
    archived: archivedAt !== null,
    name,
  };
  inputs.board = board;

  // Rule A.
  if (legacyIsAdminLevel(viewer.accessLevel)) return { inputs, board: boardRow };

  await attachBoardParents(inputs, board, viewer, opts.folderDepth);
  return { inputs, board: boardRow };
}

async function attachBoardParents(
  inputs: LegacyInputs,
  board: LegacyBoard,
  viewer: LegacyViewer,
  folderDepth: "none" | "shallow" | "full",
): Promise<void> {
  if (board.folderId && folderDepth === "full") {
    const chain = await loadFolderChain(board.folderId, viewer, {
      adminStop: false,
      // legacyGetBoardForReader's WORKSPACE branch reads the Space even when
      // the viewer holds the folder's own row, so the Space must be loaded.
      stopAtOwnGrant: false,
    });
    if (chain.folder) inputs.folder = chain.folder;
    if (chain.space) inputs.space = chain.space;
    return;
  }

  const [folderRow, spaceRow] = await Promise.all([
    board.folderId && folderDepth === "shallow"
      ? prisma.folder.findUnique({
          where: { id: board.folderId },
          select: {
            id: true,
            organizationId: true,
            spaceId: true,
            parentFolderId: true,
            visibility: true,
            ownerId: true,
            archivedAt: true,
            members: MEMBER_OF(viewer.userId),
          },
        })
      : Promise.resolve(null),
    board.spaceId ? loadSpaceRow(board.spaceId, viewer.userId) : Promise.resolve(null),
  ]);

  if (folderRow) {
    inputs.folder = {
      id: folderRow.id,
      organizationId: folderRow.organizationId,
      spaceId: folderRow.spaceId,
      parentFolderId: folderRow.parentFolderId,
      visibility: folderRow.visibility as VisibilityValue,
      ownerId: folderRow.ownerId,
      memberRole: roleOf(folderRow.members),
      archived: folderRow.archivedAt !== null,
      // ancestorMemberRole is deliberately absent: the shallow consumers
      // (board.ts:632-637) never read it. Do not feed a shallow struct to
      // folderReadable or resolveFolder, which do.
    };
  }
  if (spaceRow) inputs.space = spaceFacts(spaceRow);
}

// ── Item ──────────────────────────────────────────────────────────

export async function loadItemInputs(
  itemId: string,
  viewer: LegacyViewer,
): Promise<{ inputs: LegacyInputs; found: boolean }> {
  const row = await prisma.item.findUnique({
    where: { id: itemId },
    select: { id: true, organizationId: true, boardId: true, ownerId: true, assigneeIds: true },
  });
  if (!row) return { inputs: base(viewer), found: false };

  const inputs = base(viewer, row.organizationId);
  const item: LegacyItem = {
    id: row.id,
    organizationId: row.organizationId,
    boardId: row.boardId,
    ownerId: row.ownerId,
    assigneeIds: row.assigneeIds,
  };
  inputs.item = item;

  // access.ts:272 compares the org, :275 short-circuits for admins, and both
  // precede the board lookup at :277 (rule A, plus the org guard the resolver
  // applies itself).
  if (inputs.organizationId !== row.organizationId) return { inputs, found: true };
  if (legacyIsAdminLevel(viewer.accessLevel)) return { inputs, found: true };

  const board = await loadBoardInputs(row.boardId, viewer, { folderDepth: "full" });
  inputs.board = board.inputs.board;
  inputs.folder = board.inputs.folder;
  inputs.space = board.inputs.space;
  return { inputs, found: true };
}

// ── Doc ───────────────────────────────────────────────────────────

export async function loadDocInputs(
  docId: string,
  viewer: LegacyViewer,
  /**
   * Which transcription will read this struct. Rule C's skip is sound only for
   * "resolveDoc", which returns at its creator and admin branches
   * (access.ts:242 and :253). legacyDocAccessible has neither, so the default
   * loads the anchor chain.
   */
  opts: { consumer: "resolveDoc" | "docAccessible" } = { consumer: "docAccessible" },
): Promise<{ inputs: LegacyInputs; found: boolean }> {
  const row = await prisma.doc.findUnique({
    where: { id: docId },
    select: { id: true, organizationId: true, entityType: true, entityId: true, createdById: true },
  });
  if (!row) return { inputs: base(viewer), found: false };

  const inputs = base(viewer, row.organizationId);
  inputs.doc = {
    id: row.id,
    organizationId: row.organizationId,
    createdById: row.createdById,
    anchor: { entityType: row.entityType, entityId: row.entityId },
  };

  // Rule C. The org mismatch, the NOTEPAD anchor and a missing entityId are
  // terminal for BOTH consumers (doc-access.ts:46 and :74-82, access.ts:239
  // and :248), so those skips are unconditional. The creator and org-admin
  // branches exist only in resolveDoc, so they are opt-in.
  const orgMismatch = inputs.organizationId !== row.organizationId;
  const notepad = row.entityType === "NOTEPAD";
  if (orgMismatch || notepad || !row.entityId) return { inputs, found: true };
  if (opts.consumer === "resolveDoc") {
    const creator = row.createdById === viewer.userId;
    if (legacyIsAdminLevel(viewer.accessLevel) || creator) return { inputs, found: true };
  }

  const anchorId = row.entityId;
  if (row.entityType === "SPACE") {
    const space = await loadSpaceInputs(anchorId, viewer);
    inputs.space = space.inputs.space;
  } else if (row.entityType === "FOLDER") {
    const folder = await loadFolderInputs(anchorId, viewer);
    inputs.folder = folder.inputs.folder;
    inputs.space = folder.inputs.space;
  } else if (row.entityType === "BOARD") {
    const board = await loadBoardInputs(anchorId, viewer, { folderDepth: "full" });
    inputs.board = board.inputs.board;
    inputs.folder = board.inputs.folder;
    inputs.space = board.inputs.space;
  } else if (
    row.entityType === "BOARD_ITEM" ||
    row.entityType === "TASK" ||
    row.entityType === "BOARD_ROW"
  ) {
    const item = await loadItemInputs(anchorId, viewer);
    inputs.item = item.inputs.item;
    inputs.board = item.inputs.board;
    inputs.folder = item.inputs.folder;
    inputs.space = item.inputs.space;
  }
  return { inputs, found: true };
}
