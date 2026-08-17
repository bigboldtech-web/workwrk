// Announcement audience — announcements used to broadcast to everyone
// (targetAudience was stored but never read). This turns it into real
// targeting: an announcement aims at everyone, or at a set of departments /
// offices / people / person-tags, resolved to recipients at read time so a
// person added to a department or tag afterwards is covered on the next read.
//
// Stored on Announcement.targetAudience (Json) as { type, ids }. Anything
// legacy or malformed normalizes to ALL — this never throws on old rows.

import { prisma } from "@/lib/prisma";
import { resolveUserIdsByTags } from "@/lib/user-tags";

export const ANNOUNCEMENT_AUDIENCE_TYPES = ["ALL", "DEPARTMENTS", "OFFICES", "USERS", "TAGS"] as const;
export type AnnouncementAudienceType = (typeof ANNOUNCEMENT_AUDIENCE_TYPES)[number];
export interface AnnouncementAudience {
  type: AnnouncementAudienceType;
  ids: string[];
}

const TYPES = new Set<string>(ANNOUNCEMENT_AUDIENCE_TYPES);

const NOUN: Record<Exclude<AnnouncementAudienceType, "ALL">, string> = {
  DEPARTMENTS: "department",
  OFFICES: "office",
  USERS: "person",
  TAGS: "tag",
};

/** Normalize whatever is stored/submitted into a safe { type, ids }. Legacy
 *  values (null, old shapes) become ALL. Never throws. */
export function parseAnnouncementAudience(raw: unknown): AnnouncementAudience {
  if (raw && typeof raw === "object" && !Array.isArray(raw)) {
    const o = raw as { type?: unknown; ids?: unknown };
    const type = typeof o.type === "string" && TYPES.has(o.type) ? (o.type as AnnouncementAudienceType) : "ALL";
    if (type === "ALL") return { type: "ALL", ids: [] };
    const ids = Array.isArray(o.ids) ? o.ids.filter((x): x is string => typeof x === "string") : [];
    return { type, ids };
  }
  return { type: "ALL", ids: [] };
}

/** Every non-ALL id must belong to orgId and exist (offices/depts/users/tags). */
export async function validateAnnouncementAudience(
  orgId: string,
  aud: AnnouncementAudience,
): Promise<{ ok: true } | { ok: false; error: string }> {
  if (aud.type === "ALL") return { ok: true };
  if (aud.ids.length === 0) return { ok: false, error: `Pick at least one ${NOUN[aud.type]}` };
  let count = 0;
  if (aud.type === "DEPARTMENTS") count = await prisma.department.count({ where: { id: { in: aud.ids }, organizationId: orgId } });
  else if (aud.type === "OFFICES") count = await prisma.office.count({ where: { id: { in: aud.ids }, organizationId: orgId } });
  else if (aud.type === "USERS") count = await prisma.user.count({ where: { id: { in: aud.ids }, organizationId: orgId, deletedAt: null } });
  else if (aud.type === "TAGS") count = await prisma.tag.count({ where: { id: { in: aud.ids }, organizationId: orgId, archived: false } });
  if (count !== aud.ids.length) return { ok: false, error: `One or more ${NOUN[aud.type]}s are invalid` };
  return { ok: true };
}

/** The userIds who should receive/see an announcement with this audience. */
export async function resolveAnnouncementAudienceUserIds(
  orgId: string,
  aud: AnnouncementAudience,
): Promise<string[]> {
  if (aud.type === "TAGS") return resolveUserIdsByTags(orgId, aud.ids);
  const where: { organizationId: string; deletedAt: null; departmentId?: { in: string[] }; officeId?: { in: string[] }; id?: { in: string[] } } = {
    organizationId: orgId,
    deletedAt: null,
  };
  if (aud.type === "DEPARTMENTS") where.departmentId = { in: aud.ids };
  else if (aud.type === "OFFICES") where.officeId = { in: aud.ids };
  else if (aud.type === "USERS") where.id = { in: aud.ids };
  // ALL → no extra filter (whole org).
  const rows = await prisma.user.findMany({ where, select: { id: true } });
  return rows.map((r) => r.id);
}

/** Feed-side membership — no query for the common cases. */
export function viewerInAnnouncementAudience(
  aud: AnnouncementAudience,
  viewer: { id: string; departmentId?: string | null; officeId?: string | null },
  viewerTagIds: string[],
): boolean {
  switch (aud.type) {
    case "ALL": return true;
    case "DEPARTMENTS": return !!viewer.departmentId && aud.ids.includes(viewer.departmentId);
    case "OFFICES": return !!viewer.officeId && aud.ids.includes(viewer.officeId);
    case "USERS": return aud.ids.includes(viewer.id);
    case "TAGS": return aud.ids.some((t) => viewerTagIds.includes(t));
  }
}
