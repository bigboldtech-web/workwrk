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

// SPACE was added in Phase 4 (spec-talk section 2.3 Data): a person who holds
// Full access on one Space may post to that Space and to nothing else, which
// is what makes "People in {Space}" safe to offer without handing out the
// org-wide audiences. It resolves to the Space's members at READ time, exactly
// like a department, so somebody added to the Space next week is covered.
export const ANNOUNCEMENT_AUDIENCE_TYPES = ["ALL", "DEPARTMENTS", "OFFICES", "USERS", "TAGS", "SPACE"] as const;
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
  SPACE: "Space",
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
  else if (aud.type === "SPACE") {
    // Exactly one Space: "People in two Spaces" is two announcements, and a
    // list would make the label ("People in {Space}") a lie.
    if (aud.ids.length !== 1) return { ok: false, error: "Pick one Space" };
    count = await prisma.space.count({ where: { id: { in: aud.ids }, organizationId: orgId, archivedAt: null } });
  }
  if (count !== aud.ids.length) return { ok: false, error: `One or more ${NOUN[aud.type]}s are invalid` };
  return { ok: true };
}

/** The userIds who should receive/see an announcement with this audience. */
export async function resolveAnnouncementAudienceUserIds(
  orgId: string,
  aud: AnnouncementAudience,
): Promise<string[]> {
  if (aud.type === "TAGS") return resolveUserIdsByTags(orgId, aud.ids);
  if (aud.type === "SPACE") {
    const members = await prisma.spaceMember.findMany({
      where: { spaceId: { in: aud.ids }, space: { organizationId: orgId } },
      select: { userId: true },
    });
    const ids = [...new Set(members.map((m) => m.userId))];
    if (ids.length === 0) return [];
    // A member who has since left the organization is not an audience.
    const live = await prisma.user.findMany({
      where: { id: { in: ids }, organizationId: orgId, deletedAt: null },
      select: { id: true },
    });
    return live.map((u) => u.id);
  }
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

/** Feed-side membership. No query for the common cases. */
export function viewerInAnnouncementAudience(
  aud: AnnouncementAudience,
  viewer: { id: string; departmentId?: string | null; officeId?: string | null },
  viewerTagIds: string[],
  viewerSpaceIds: string[] = [],
): boolean {
  switch (aud.type) {
    case "ALL": return true;
    case "DEPARTMENTS": return !!viewer.departmentId && aud.ids.includes(viewer.departmentId);
    case "OFFICES": return !!viewer.officeId && aud.ids.includes(viewer.officeId);
    case "USERS": return aud.ids.includes(viewer.id);
    case "TAGS": return aud.ids.some((t) => viewerTagIds.includes(t));
    case "SPACE": return aud.ids.some((s) => viewerSpaceIds.includes(s));
  }
}

/**
 * The names behind an audience's ids, for the card's "Sales, Marketing" line.
 *
 * Resolved server-side and returned with the row so the client never fires one
 * lookup per card, and so a name the reader may not otherwise see (a Space
 * they are in) still prints. Order follows `aud.ids`. Ids that no longer
 * resolve are dropped rather than printed as an id.
 */
export async function resolveAnnouncementAudienceNames(
  orgId: string,
  aud: AnnouncementAudience,
): Promise<string[]> {
  if (aud.type === "ALL" || aud.ids.length === 0) return [];
  const byId = new Map<string, string>();
  try {
    if (aud.type === "DEPARTMENTS") {
      for (const r of await prisma.department.findMany({ where: { id: { in: aud.ids }, organizationId: orgId }, select: { id: true, name: true } })) byId.set(r.id, r.name);
    } else if (aud.type === "OFFICES") {
      for (const r of await prisma.office.findMany({ where: { id: { in: aud.ids }, organizationId: orgId }, select: { id: true, name: true } })) byId.set(r.id, r.name);
    } else if (aud.type === "TAGS") {
      for (const r of await prisma.tag.findMany({ where: { id: { in: aud.ids }, organizationId: orgId }, select: { id: true, name: true } })) byId.set(r.id, r.name);
    } else if (aud.type === "SPACE") {
      for (const r of await prisma.space.findMany({ where: { id: { in: aud.ids }, organizationId: orgId }, select: { id: true, name: true } })) byId.set(r.id, r.name);
    } else if (aud.type === "USERS") {
      for (const r of await prisma.user.findMany({ where: { id: { in: aud.ids }, organizationId: orgId }, select: { id: true, firstName: true, lastName: true, email: true } })) {
        byId.set(r.id, `${r.firstName ?? ""} ${r.lastName ?? ""}`.trim() || r.email);
      }
    }
  } catch {
    // A label is decoration: a lookup failure prints the audience kind
    // ("Selected departments") rather than failing the whole read.
    return [];
  }
  return aud.ids.map((id) => byId.get(id)).filter((n): n is string => Boolean(n));
}

/** The Space ids this viewer belongs to, for the SPACE audience check. */
export async function viewerSpaceIds(orgId: string, userId: string): Promise<string[]> {
  try {
    const rows = await prisma.spaceMember.findMany({
      where: { userId, space: { organizationId: orgId } },
      select: { spaceId: true },
    });
    return rows.map((r) => r.spaceId);
  } catch {
    return [];
  }
}
