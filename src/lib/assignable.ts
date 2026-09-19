// "Who can I assign this task to?" — answered from the LIST, not from the
// HR directory.
//
// The bug this exists for: every assignee picker called
// `/api/users?scope=all`, and that endpoint pins any caller below
// ORG_WIDE_ALIGNMENT_LEVELS to "team" scope (self + their recursive report
// tree). A Space Admin with no direct reports therefore saw exactly one
// candidate: himself. "unable to assign task to user. I am Space Admin
// though it only show me while i try to assign people."
//
// /api/users is NOT the place to fix that. It returns the HR directory
// payload (managerId, joinDate, department, KRA counts) and its team scope
// is a deliberate privacy rule that Teams, the org chart and reviews all
// lean on. Widening it to serve a task picker would leak the org chart to
// everyone. So the picker gets its own, much smaller answer instead: the
// people who can already reach THIS list, with a name and an avatar.
//
// And an EMAIL only when the caller asked for one and can CONTRIBUTE to the
// list (`includeEmail`). Without that clause this was still a directory dump:
// on an ORG-visible list the candidate set is the whole active org, and the
// gate is READ, so any guest or "View only" member could page the endpoint and
// walk off with every address in the company. A name and an avatar are what a
// picker has to draw; an email is what tells two same-named people apart, and
// you only need that when you can actually hand one of them the work.
//
// The union mirrors read access rather than inventing a new one:
//   Board members + the board owner            (a direct grant on the list)
//   Space members + the space owner            (unless the list is PRIVATE,
//                                               which Space membership does
//                                               not pierce)
//   Folder members + folder owners, up the
//   whole parent chain                         (the granular folder grant)
//   Org admins                                 (they can reach every list)
// and when the list or its Space is ORG-visible, the whole active org,
// because everybody can already open it.

import { prisma } from "@/lib/prisma";
import { listOrgAdmins } from "@/lib/access/admins";
import { listBoardMembers } from "@/lib/board";
import { listSpaceMembers } from "@/lib/space";
import { listFolderMembers } from "@/lib/folder";

export interface AssignableUser {
  id: string;
  firstName: string | null;
  lastName: string | null;
  /** Present only when the caller asked for it AND may contribute here. */
  email?: string;
  avatar: string | null;
}

/** Deepest folder chain we will walk. Folders nest a handful deep in
 *  practice; the cap only stops a cycle from spinning forever. */
const MAX_FOLDER_DEPTH = 12;

/** Every folder from `folderId` up to the root, inclusive. */
async function folderChain(folderId: string): Promise<string[]> {
  const chain: string[] = [];
  let cursor: string | null = folderId;
  const seen = new Set<string>();
  for (let i = 0; i < MAX_FOLDER_DEPTH && cursor && !seen.has(cursor); i++) {
    seen.add(cursor);
    chain.push(cursor);
    const row: { parentFolderId: string | null } | null = await prisma.folder.findUnique({
      where: { id: cursor },
      select: { parentFolderId: true },
    });
    cursor = row?.parentFolderId ?? null;
  }
  return chain;
}

export interface AssignableQuery {
  /** Free-text match on first / last / email. */
  search?: string;
  /** Hard cap on rows returned. */
  limit?: number;
  /**
   * Include the email address on each row.
   *
   * OFF by default, and the route turns it on only for a caller who can
   * actually CONTRIBUTE to the list. `Item.ownerId` is a bare String with no
   * relation, so this roster is the one place a picker learns who exists, and
   * on an ORG-visible list that set is the whole active org. Handing every
   * viewer, guest included, a searchable name-to-email map is a directory
   * dump; handing it to somebody who can already assign work to those people
   * is the feature.
   */
  includeEmail?: boolean;
}

/**
 * Which of `ids` are NOT live users of this organization.
 *
 * `Item.ownerId` and `Item.assigneeIds` are plain String columns with no
 * foreign key, so nothing in the database refuses a typo, an id from another
 * org or a 5000-character string; they were all accepted and stored verbatim.
 * That became permanent rather than transient when owner-only patches started
 * MERGING into the assignee set instead of replacing it, so a junk id now
 * sticks to the row forever as a phantom assignee no picker can remove.
 *
 * Returns the unknown ids so the caller can name them in a 400. An empty
 * input answers empty without a query.
 */
export async function unknownUserIds(
  ids: readonly (string | null | undefined)[],
  organizationId: string,
): Promise<string[]> {
  const wanted = Array.from(
    new Set(ids.filter((x): x is string => typeof x === "string" && x.trim().length > 0)),
  );
  if (wanted.length === 0) return [];
  const found = await prisma.user.findMany({
    where: { id: { in: wanted }, organizationId, deletedAt: null },
    select: { id: true },
  });
  const live = new Set(found.map((u) => u.id));
  return wanted.filter((id) => !live.has(id));
}

/**
 * The assignable roster for one board. Returns [] when the board does not
 * exist; the CALLER is responsible for the read gate (the route runs
 * getBoardForReader first) so this helper never leaks a roster on its own.
 */
export async function listAssignableUsersForBoard(
  boardId: string,
  organizationId: string,
  query: AssignableQuery = {},
): Promise<AssignableUser[]> {
  const limit = Math.min(Math.max(query.limit ?? 100, 1), 200);
  const search = query.search?.trim() ?? "";

  const board = await prisma.board.findUnique({
    where: { id: boardId },
    select: {
      id: true,
      organizationId: true,
      spaceId: true,
      folderId: true,
      ownerId: true,
      visibility: true,
      space: { select: { id: true, ownerId: true, visibility: true } },
    },
  });
  if (!board || board.organizationId !== organizationId) return [];

  // Everyone can already open an ORG-visible list, so everyone is a
  // candidate. A PRIVATE list never inherits its Space's openness.
  const orgWide =
    board.visibility === "ORG" ||
    (board.visibility !== "PRIVATE" && board.space?.visibility === "ORG");

  let idFilter: string[] | null = null;
  if (!orgWide) {
    const ids = new Set<string>();
    if (board.ownerId) ids.add(board.ownerId);

    const folderIds = board.folderId ? await folderChain(board.folderId) : [];

    // The member tables are read through the existing board / space / folder
    // helpers, never directly: the access engine owns those rows.
    const [boardMembers, spaceMembers, folderMemberLists, folderOwners, admins] = await Promise.all([
      listBoardMembers(boardId),
      // A PRIVATE board is reachable only through a board-level grant, the
      // board owner, the Space OWNER or an org admin. Listing every Space
      // member as assignable there would offer people who cannot open it.
      board.visibility !== "PRIVATE" && board.spaceId
        ? listSpaceMembers(board.spaceId)
        : Promise.resolve([] as { userId: string }[]),
      Promise.all(folderIds.map((fid) => listFolderMembers(fid))),
      folderIds.length
        ? prisma.folder.findMany({
            where: { id: { in: folderIds } },
            select: { ownerId: true },
          })
        : Promise.resolve([] as { ownerId: string | null }[]),
      listOrgAdmins(organizationId, 500),
    ]);

    for (const m of boardMembers) ids.add(m.userId);
    for (const m of spaceMembers) ids.add(m.userId);
    for (const list of folderMemberLists) for (const m of list) ids.add(m.userId);
    for (const f of folderOwners) if (f.ownerId) ids.add(f.ownerId);
    // The Space owner reaches even a PRIVATE list inside their Space.
    if (board.space?.ownerId) ids.add(board.space.ownerId);
    for (const a of admins) ids.add(a.id);

    idFilter = Array.from(ids);
    if (idFilter.length === 0) return [];
  }

  return prisma.user.findMany({
    where: {
      organizationId,
      deletedAt: null,
      // "Active" here means "still employed", not literally status=ACTIVE:
      // somebody on probation or on leave is still a person you assign work
      // to. Only INACTIVE (offboarded) drops out.
      status: { not: "INACTIVE" },
      ...(idFilter ? { id: { in: idFilter } } : {}),
      ...(search
        ? {
            OR: [
              { firstName: { contains: search, mode: "insensitive" as const } },
              { lastName: { contains: search, mode: "insensitive" as const } },
              { email: { contains: search, mode: "insensitive" as const } },
            ],
          }
        : {}),
    },
    select: {
      id: true,
      firstName: true,
      lastName: true,
      avatar: true,
      email: query.includeEmail === true,
    },
    orderBy: [{ firstName: "asc" }, { lastName: "asc" }],
    take: limit,
  }) as Promise<AssignableUser[]>;
}
