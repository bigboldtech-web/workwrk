// Tag-filter helper for list endpoints.
//
// Every API that lists rows can call `tagFilterIds(...)` to convert
// a comma-separated `?tags=` query into a set of entity ids that
// match. Empty / missing tags returns `null`, signalling "no filter
// applied" so the caller doesn't have to add an `IN ()` clause that
// matches everything.
//
// Multiple tag ids are AND'd: an entity must carry every tag in
// the list to match. This mirrors how power-users expect "tag
// chips" to compose ("US" + "Engineering" → US engineers, not US
// OR Engineering).

import { prisma } from "@/lib/prisma";

const VALID_ENTITY_TYPES = new Set([
  "USER", "TASK", "KRA", "KPI", "OKR", "SOP",
  "EXPENSE", "TIME_OFF_REQUEST", "TIMESHEET", "REVIEW",
  "MEETING", "POLICY", "PROCESS_RUN", "ANNOUNCEMENT",
  "DEPARTMENT", "ROLE", "VENDOR", "PURCHASE_ORDER",
  "INVOICE", "CANDIDATE", "JOB",
]);

export type TagFilterEntity =
  | "USER" | "TASK" | "KRA" | "KPI" | "OKR" | "SOP"
  | "EXPENSE" | "TIME_OFF_REQUEST" | "TIMESHEET" | "REVIEW"
  | "MEETING" | "POLICY" | "PROCESS_RUN" | "ANNOUNCEMENT"
  | "DEPARTMENT" | "ROLE" | "VENDOR" | "PURCHASE_ORDER"
  | "INVOICE" | "CANDIDATE" | "JOB";

export type TagFilterParams = {
  organizationId: string;
  entityType: TagFilterEntity;
  // Comma-separated string from query params, OR an explicit array.
  tagsRaw: string | string[] | null | undefined;
};

/**
 * Returns the set of entity ids that carry ALL the given tags.
 * Returns `null` when no tags were specified (caller should skip
 * adding an `id IN ...` clause).
 *
 * Returns an empty array when tags were specified but no entities
 * match — caller should short-circuit and return [].
 */
export async function tagFilterIds(params: TagFilterParams): Promise<string[] | null> {
  const ids = parseTagIds(params.tagsRaw);
  if (ids.length === 0) return null;

  if (!VALID_ENTITY_TYPES.has(params.entityType)) {
    return null; // unknown entity — caller misuse, skip filter rather than throw
  }

  // Pull every assignment matching one of the requested tags. We
  // intentionally fetch all, then group + intersect in app code:
  // SQL groupBy on Postgres works but produces less readable code
  // for the AND-of-tags semantics.
  const rows = await prisma.tagAssignment.findMany({
    where: {
      organizationId: params.organizationId,
      entityType: params.entityType,
      tagId: { in: ids },
    },
    select: { entityId: true, tagId: true },
  });

  // Group by entityId → set of tagIds present.
  const byEntity = new Map<string, Set<string>>();
  for (const r of rows) {
    let s = byEntity.get(r.entityId);
    if (!s) {
      s = new Set();
      byEntity.set(r.entityId, s);
    }
    s.add(r.tagId);
  }

  // Keep only entities that match every requested tag.
  const required = ids.length;
  const result: string[] = [];
  for (const [entityId, tagSet] of byEntity.entries()) {
    if (tagSet.size === required) result.push(entityId);
  }
  return result;
}

function parseTagIds(raw: string | string[] | null | undefined): string[] {
  if (!raw) return [];
  if (Array.isArray(raw)) {
    return raw.map((s) => s.trim()).filter((s) => s.length > 0);
  }
  return raw.split(",").map((s) => s.trim()).filter((s) => s.length > 0);
}
