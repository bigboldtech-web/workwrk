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
// Gate mirrors the /team siblings: the central access resolver's
// manager+ module check first, then "do you actually have reports".
// Settings persist client-side in localStorage (no View row exists at
// workspace scope) — see team-workload-view.tsx.

import { redirect } from "next/navigation";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { GaugeCircle } from "lucide-react";
import { prisma } from "@/lib/prisma";
import { getTeamUserIds } from "@/lib/team";
import { getBoardForReader } from "@/lib/board";
import { resolveAccess, meets } from "@/lib/access";
import {
  getBoardStatuses,
  isDoneStatus,
  type BoardItemRow,
} from "@/lib/board-items-shared";
import { TeamWorkloadView } from "./team-workload-view";

export const dynamic = "force-dynamic";

export default async function TeamWorkloadPage() {
  const session = await getServerSession(authOptions);
  if (!session?.user) redirect("/login");
  const u = session.user as { id?: string; organizationId?: string; accessLevel?: string };
  if (!u.id || !u.organizationId) redirect("/login");

  // Central access resolver — same manager+ tier as /team/alignment.
  const decision = await resolveAccess(
    { userId: u.id, organizationId: u.organizationId, accessLevel: u.accessLevel ?? "EMPLOYEE" },
    { type: "module", name: "team/alignment" },
  );
  if (!meets(decision, "read")) redirect("/today");

  const teamIds = await getTeamUserIds(u.organizationId, u.id);
  if (teamIds.length <= 1) redirect("/team");

  // Readable boards (per-board visibility composed the same way the
  // Everything feed does it) — carrying each board's status set so the
  // done check runs against the board's OWN statuses, not the default trio.
  const boards = await prisma.board.findMany({
    where: { organizationId: u.organizationId, archivedAt: null },
    select: { id: true, statuses: true },
  });
  const accessLevel = u.accessLevel ?? "EMPLOYEE";
  const readable = await Promise.all(
    boards.map(async (b) => ((await getBoardForReader(b.id, u.id!, accessLevel)) ? b : null)),
  );
  const readableBoards = readable.filter((b): b is (typeof boards)[number] => b !== null);
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
        <h1 className="inline-flex items-center gap-1.5 text-[14px] font-semibold text-zinc-900">
          <GaugeCircle className="w-4 h-4 text-zinc-500" />
          <span>Workload</span>
        </h1>
        <span className="text-[12px] text-zinc-500 tabular-nums">
          {people.length} people
        </span>
      </div>

      <div className="flex-1 overflow-y-auto px-4 pt-2 pb-4">
        <TeamWorkloadView items={items} people={people} />
      </div>
    </div>
  );
}
