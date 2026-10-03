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
// WHO IS ON IT. The people the one resolver (src/lib/access/node-access.ts)
// lets open this List, restricted to the people the VIEWER may see:
//   the List's own grants and its owner       (a direct grant on the list)
//   people whose access comes through a Folder
//   or Space the viewer can open              (never a container the viewer
//                                              only passes through: its
//                                              member list is exactly what a
//                                              path must not show)
//   org admins                                 (they can reach every list)
//   the current owners and assignees of the
//   List's tasks, and the viewer
// The Private cut is honoured: a Space member who cannot open a PRIVATE List
// is not offered on it. When the List is open to everyone at the org, the
// whole active org is the candidate set, because everybody can already open it.

import { prisma } from "@/lib/prisma";
import { NodeEvaluator, emptyGrants, roleAtLeast, type NodeCtx, type NodeRef, type ViewerGrants } from "@/lib/access/node-rules";
import { loadAllGrants, loadOrgAdmins, loadPeople, loadRows, loadViewerGrants, peopleNamedByRows } from "@/lib/access/node-world";

export interface AssignableUser {
  id: string;
  firstName: string | null;
  lastName: string | null;
  /** Present only when the caller asked for it AND may contribute here. */
  email?: string;
  avatar: string | null;
}

export interface AssignableQuery {
  /** Free-text match on first / last / email, word by word. */
  search?: string;
  /** Hard cap on rows returned. */
  limit?: number;
  /**
   * Only these people: which of them are on the roster. A roster of a List
   * open to a whole large workspace is answered a page at a time, so "is
   * this person on it" is asked by id, never read from the first page.
   */
  ids?: readonly string[];
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
 * The ids a viewer may see on this List's roster, or null when the List is
 * open to everyone at the org (every active person is a candidate).
 */
async function rosterIds(board: { id: string }, organizationId: string, viewer: NodeCtx | null): Promise<string[] | null> {
  const ref: NodeRef = { kind: "list", id: board.id };
  const rows = await loadRows(organizationId, { lists: [board.id] });
  // Everyone at the org can open it: today's whole-org roster.
  const anyone = emptyGrants({ userId: "\u0000everyone", orgAdmin: false, orgGuest: false, isAgent: false, denied: false });
  const open = new NodeEvaluator(rows, anyone).effective(ref);
  if (roleAtLeast(open.role, "VIEW") && open.via.type === "everyone") return null;

  const [all, admins, tasks] = await Promise.all([
    loadAllGrants(rows),
    loadOrgAdmins(organizationId),
    prisma.item.findMany({ where: { boardId: board.id, organizationId, archivedAt: null }, select: { ownerId: true, assigneeIds: true }, take: 5000 }),
  ]);
  rows.orgAdmins = admins;
  const viewerGrants: ViewerGrants | null = viewer ? await loadViewerGrants(viewer, rows) : null;
  const viewerEv = viewerGrants ? new NodeEvaluator(rows, viewerGrants) : null;
  const viewerOpens = (r: NodeRef) => !viewerEv || roleAtLeast(viewerEv.effective(r).role, "VIEW");

  const candidates = [...new Set([...all.keys(), ...peopleNamedByRows(rows), ...admins])];
  const people = await loadPeople(organizationId, candidates);
  const ids = new Set<string>();
  for (const [id, p] of people) {
    const g = all.get(id);
    const grants: ViewerGrants = { viewer: p.viewer, space: g?.space ?? new Map(), folder: g?.folder ?? new Map(), list: g?.list ?? new Map(), object: g?.object ?? new Map(), since: g?.since };
    const d = new NodeEvaluator(rows, grants).decision(ref);
    if (!roleAtLeast(d.role, "VIEW")) continue;
    const via = d.via;
    const visible =
      via.type === "own" || via.type === "owner" || via.type === "org_admin"
        ? true
        : via.type === "inherited" || via.type === "pierce" || via.type === "lift"
          ? viewerOpens(via.node)
          : via.type === "floor"
            ? viewerOpens(rows.lists.get(board.id)?.spaceId ? { kind: "space", id: rows.lists.get(board.id)?.spaceId as string } : ref)
            : false;
    if (visible) ids.add(id);
  }
  // The people already on the List's tasks, and the viewer.
  for (const t of tasks) {
    if (t.ownerId) ids.add(t.ownerId);
    for (const a of t.assigneeIds ?? []) ids.add(a);
  }
  if (viewer) ids.add(viewer.userId);
  return [...ids];
}

/**
 * The assignable roster for one board. Returns [] when the board does not
 * exist; the CALLER is responsible for the read gate (the route checks the
 * viewer's role on the List first) so this helper never leaks a roster on
 * its own. Pass the viewer so the roster names only the people they may see.
 */
export async function listAssignableUsersForBoard(
  boardId: string,
  organizationId: string,
  query: AssignableQuery = {},
  viewer: NodeCtx | null = null,
): Promise<AssignableUser[]> {
  const ids = query.ids ? [...new Set(query.ids.filter((x) => typeof x === "string" && x.length > 0 && x.length <= 64))].slice(0, 200) : null;
  if (ids && ids.length === 0) return [];
  const limit = ids ? ids.length : Math.min(Math.max(query.limit ?? 100, 1), 200);
  // Word by word, as /api/people/pick matches: "Zoe Young" lives in two
  // columns, and one `contains` over the whole text matched neither.
  const words = (query.search ?? "").split(/\s+/).filter(Boolean).slice(0, 6);

  const board = await prisma.board.findUnique({
    where: { id: boardId },
    select: { id: true, organizationId: true },
  });
  if (!board || board.organizationId !== organizationId) return [];

  const roster = await rosterIds(board, organizationId, viewer);
  const onRoster = roster ? new Set(roster) : null;
  const idFilter = ids ? (onRoster ? ids.filter((id) => onRoster.has(id)) : ids) : roster;
  if (idFilter && idFilter.length === 0) return [];

  return prisma.user.findMany({
    where: {
      organizationId,
      deletedAt: null,
      // "Active" here means "still employed", not literally status=ACTIVE:
      // somebody on probation or on leave is still a person you assign work
      // to. Only INACTIVE (offboarded) drops out.
      status: { not: "INACTIVE" },
      ...(idFilter ? { id: { in: idFilter } } : {}),
      ...(words.length > 0
        ? {
            AND: words.map((word) => ({
              OR: [
                { firstName: { contains: word, mode: "insensitive" as const } },
                { lastName: { contains: word, mode: "insensitive" as const } },
                { email: { contains: word, mode: "insensitive" as const } },
              ],
            })),
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
