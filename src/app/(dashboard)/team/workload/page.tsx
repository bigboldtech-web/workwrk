// /team/workload — manager-scoped workspace Workload. The same
// WorkloadGrid the board-level WORKLOAD view renders, fed by a DIRECT
// Item query (no newest-500 Everything cap — an old scheduled task must
// never silently vanish from a capacity row):
//   - open items owned by anyone in the caller's recursive report tree
//   - PLUS unassigned open items, scoped to team-relevant boards only
//     (boards a team member belongs to or actively owns work on — not
//     every unassigned row in the org).
// Done/closed rows are excluded server-side with the shared cross-board
// done rule (isDoneStatus + name fallback — the same rule /api/me/items
// applies), resolved against each board's OWN status set.
//
// Gate (Phase 6): the `workload` APP_RULES row, anyone with reports (solid
// or dotted), the People team, Owner, Admin; a Member with nobody reporting
// to them gets the sanctioned LockedPage without Request access
// (src/lib/people/team-gate.ts). The rows are the viewer's reporting tree,
// solid plus dotted, so a dotted-line manager who passes the gate sees the
// people who got them in.
// Settings persist client-side in localStorage (no View row exists at
// workspace scope) — see team-workload-view.tsx.

import { GaugeCircle } from "lucide-react";
import { prisma } from "@/lib/prisma";
import { getTeamUserIds } from "@/lib/team";
import { nodeCtxFromLevel, nodeRoleMap } from "@/lib/access/node-access";
import { roleAtLeast } from "@/lib/access/node-rules";
import { getEffectiveReportTree } from "@/lib/reporting-line";
import { teamAppGate, WORKLOAD_LOCKED_SENTENCE } from "@/lib/people/team-gate";
import {
  getBoardStatuses,
  isDoneStatus,
  type BoardItemRow,
} from "@/lib/board-items-shared";
import { TeamWorkloadView } from "./team-workload-view";
import { LockedPage } from "@/components/access";

export const dynamic = "force-dynamic";

export default async function TeamWorkloadPage() {
  const gate = await teamAppGate("workload", "/team/workload");
  const locked = (
    <LockedPage name="Workload" sentence={WORKLOAD_LOCKED_SENTENCE} back={{ fallbackHref: "/people", label: "Directory" }} />
  );
  if (gate.status === "locked") return locked;
  const u = gate.user;

  // Solid tree (self included) plus direct dotted reports, the engine's own
  // tree (src/lib/access/viewer.ts), so the grid never disagrees with the
  // gate that let the viewer in.
  const solid = await getTeamUserIds(u.organizationId, u.id);
  const effective = await getEffectiveReportTree(u.id, { maxDepth: 6 });
  const teamIds = Array.from(new Set([...solid, ...effective]));
  // The People team or an Admin with nobody reporting to them passes the
  // row but has no rows to show yet (their org-wide view is spec T6): the
  // same sentence rather than an empty grid.
  if (teamIds.length <= 1) return locked;

  // Readable boards, from the one resolver over ONE world (never a gate call
  // per List), carrying each board's status set so the done check runs
  // against the board's OWN statuses, not the default trio.
  const boards = await prisma.board.findMany({
    where: { organizationId: u.organizationId, archivedAt: null },
    select: { id: true, statuses: true },
  });
  const listRoles = await nodeRoleMap(nodeCtxFromLevel(u.id, u.organizationId, u.accessLevel), "list", boards.map((b) => b.id));
  const readableBoards = boards.filter((b) => roleAtLeast(listRoles.get(b.id) ?? "none", "VIEW"));
  const readableIds = readableBoards.map((b) => b.id);
  const statusesByBoard = new Map(readableBoards.map((b) => [b.id, getBoardStatuses(b)] as const));

  // Team-relevant boards — where the Unassigned bucket draws from:
  // boards a team member belongs to, or boards holding live work a team
  // member owns. Unassigned rows elsewhere in the org are not this
  // team's to pick up.
  const [memberBoards, ownedBoards, people] = await Promise.all([
    prisma.boardMember.findMany({
      where: { userId: { in: teamIds }, boardId: { in: readableIds } },
      select: { boardId: true },
      distinct: ["boardId"],
    }),
    prisma.item.findMany({
      where: {
        organizationId: u.organizationId,
        archivedAt: null,
        ownerId: { in: teamIds },
        boardId: { in: readableIds },
      },
      select: { boardId: true },
      distinct: ["boardId"],
    }),
    prisma.user.findMany({
      where: { id: { in: teamIds } },
      select: { id: true, firstName: true, lastName: true, avatar: true },
    }),
  ]);
  const teamBoardIds = Array.from(new Set([
    ...memberBoards.map((m) => m.boardId),
    ...ownedBoards.map((o) => o.boardId),
  ]));

  // The direct Item window query — every live team-owned row plus the
  // scoped unassigned bucket. No cap: the grid's client-side window
  // (any week the manager navigates to) always sees the true set.
  const rows = readableIds.length === 0 ? [] : await prisma.item.findMany({
    where: {
      organizationId: u.organizationId,
      archivedAt: null,
      OR: [
        { ownerId: { in: teamIds }, boardId: { in: readableIds } },
        ...(teamBoardIds.length > 0 ? [{ ownerId: null, boardId: { in: teamBoardIds } }] : []),
      ],
    },
    orderBy: [{ dueAt: "asc" }, { position: "asc" }],
  });

  const personById = new Map(people.map((p) => [p.id, p] as const));
  const items: BoardItemRow[] = rows
    // Shared done rule, per-board status set: done/closed work never
    // inflates (or hides inside) a capacity row.
    .filter((r) => !isDoneStatus(statusesByBoard.get(r.boardId) ?? [], r.status))
    .map((r) => ({
      id: r.id,
      boardId: r.boardId,
      title: r.title,
      status: r.status,
      ownerId: r.ownerId,
      groupKey: r.groupKey,
      position: r.position,
      metadata: (r.metadata as Record<string, unknown>) ?? {},
      startAt: r.startAt,
      dueAt: r.dueAt,
      priority: r.priority,
      itemTypeId: r.itemTypeId,
      parentItemId: r.parentItemId,
      archivedAt: r.archivedAt,
      createdAt: r.createdAt,
      updatedAt: r.updatedAt,
      owner: r.ownerId ? personById.get(r.ownerId) ?? null : null,
      tags: [],
    }));

  return (
    <div className="flex flex-col h-full bg-white">
      {/* Header — board-page style: title + people count */}
      <div className="px-4 pt-1.5 pb-1 flex items-center gap-2">
        <h1 className="inline-flex items-center gap-1.5 text-base font-semibold text-zinc-900">
          <GaugeCircle className="w-4 h-4 text-zinc-500" />
          <span>Workload</span>
        </h1>
        <span className="text-sm text-zinc-500 tabular-nums">
          {people.length} people
        </span>
      </div>

      <div className="flex-1 overflow-y-auto px-4 pt-2 pb-4">
        <TeamWorkloadView items={items} people={people} />
      </div>
    </div>
  );
}
