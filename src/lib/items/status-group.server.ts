// The group a status value has in the workspace's Lists, for translating a
// value one List does not have (item-move.ts resolveListStatus). "SHIPPED"
// picked from List B's statuses in My Work's bulk menu is done there, so it
// lands in List A's done status, not its first open one (pen test
// 2026-11-28, V-39, the step 4b review). The group most Lists give the value
// wins; null when no List declares it.

import { prisma } from "@/lib/prisma";
import { getBoardStatuses, type StatusOption } from "@/lib/board-items-shared";

export async function statusGroupInWorkspace(organizationId: string, value: string): Promise<StatusOption["group"] | null> {
  const boards = await prisma.board.findMany({ where: { organizationId, archivedAt: null }, select: { statuses: true } });
  const tally = new Map<StatusOption["group"], number>();
  for (const b of boards) {
    const hit = getBoardStatuses(b).find((s) => s.value === value);
    if (hit) tally.set(hit.group, (tally.get(hit.group) ?? 0) + 1);
  }
  let best: StatusOption["group"] | null = null;
  let most = 0;
  for (const [group, n] of tally) if (n > most) { best = group; most = n; }
  return best;
}
