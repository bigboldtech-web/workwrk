import { prisma } from "@/lib/prisma";

/**
 * Returns the set of user IDs in `rootUserId`'s team — self + all direct and
 * indirect reports — scoped to `organizationId`. Walks the manager tree in
 * a single user fetch; callers that need this per-request should prefer this
 * helper over open-coding the BFS.
 */
export async function getTeamUserIds(
  organizationId: string,
  rootUserId: string,
): Promise<string[]> {
  const allUsers = await prisma.user.findMany({
    where: { organizationId, deletedAt: null },
    select: { id: true, managerId: true },
  });

  const childrenMap = new Map<string, string[]>();
  for (const u of allUsers) {
    if (u.managerId) {
      const list = childrenMap.get(u.managerId);
      if (list) list.push(u.id);
      else childrenMap.set(u.managerId, [u.id]);
    }
  }

  const teamIds = new Set<string>([rootUserId]);
  const queue: string[] = [rootUserId];
  while (queue.length > 0) {
    const id = queue.shift()!;
    for (const c of childrenMap.get(id) || []) {
      if (!teamIds.has(c)) {
        teamIds.add(c);
        queue.push(c);
      }
    }
  }
  return Array.from(teamIds);
}
