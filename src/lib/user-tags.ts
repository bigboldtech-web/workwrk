// Person tags — the read side of the shared Tag system for USER entities.
//
// Tags attach to people through TagAssignment (entityType "USER", entityId =
// User.id). Nothing but the profile picker used to read them; these helpers
// turn person-tags into a real segmentation primitive: the directory attaches
// each user's tags and filters by them, and (later) audiences resolve a tag to
// its current holders. Archived tags never surface.

import { prisma } from "@/lib/prisma";

export interface UserTagLite {
  id: string;
  name: string;
  color: string | null;
}

/**
 * Tags on each of the given users, org-scoped, archived tags excluded.
 * Returns a map userId → tags (name-sorted). One query for the whole page.
 */
export async function getUserTagsMap(
  orgId: string,
  userIds: string[],
): Promise<Map<string, UserTagLite[]>> {
  const map = new Map<string, UserTagLite[]>();
  if (userIds.length === 0) return map;
  const rows = await prisma.tagAssignment.findMany({
    where: {
      organizationId: orgId,
      entityType: "USER",
      entityId: { in: userIds },
      tag: { archived: false },
    },
    select: { entityId: true, tag: { select: { id: true, name: true, color: true } } },
  });
  for (const r of rows) {
    const list = map.get(r.entityId);
    if (list) list.push(r.tag);
    else map.set(r.entityId, [r.tag]);
  }
  for (const list of map.values()) list.sort((a, b) => a.name.localeCompare(b.name));
  return map;
}

/**
 * Every userId in the org that carries ANY of the given tags (entityType
 * USER). The membership is resolved live, so a person tagged after a survey
 * (or goal) was targeted is picked up on the next read — never a frozen list.
 */
export async function resolveUserIdsByTags(
  orgId: string,
  tagIds: string[],
): Promise<string[]> {
  if (tagIds.length === 0) return [];
  const rows = await prisma.tagAssignment.findMany({
    where: {
      organizationId: orgId,
      entityType: "USER",
      tagId: { in: tagIds },
      tag: { archived: false },
    },
    select: { entityId: true },
    distinct: ["entityId"],
  });
  return rows.map((r) => r.entityId);
}
