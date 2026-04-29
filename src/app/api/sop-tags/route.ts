import { prisma } from "@/lib/prisma";
import { getSessionOrFail, getOrgId, jsonSuccess, LOOKUP_CACHE_HEADERS } from "@/lib/api-helpers";

/**
 * GET /api/sop-tags — distinct tags currently in use on SOPs in the
 * caller's org, with counts. Drives the tag chip filter and the
 * autocomplete in the SOP creation/edit dialogs.
 *
 * Tag visibility is org-wide intentionally: tags are flexible
 * cross-cutting metadata, not access-controlled like folders.
 */
export async function GET() {
  const { error, session } = await getSessionOrFail();
  if (error) return error;
  const orgId = getOrgId(session);

  // Postgres array unnest + count is the cheap path. One round trip.
  const rows = await prisma.$queryRawUnsafe<{ tag: string; count: bigint }[]>(`
    SELECT tag, COUNT(*)::bigint AS count
    FROM (
      SELECT UNNEST(tags) AS tag
      FROM "SOP"
      WHERE "organizationId" = $1::text AND status <> 'ARCHIVED'
    ) t
    GROUP BY tag
    ORDER BY count DESC, tag ASC
  `, orgId);

  const tags = rows.map((r) => ({ name: r.tag, count: Number(r.count) }));
  return jsonSuccess(tags, 200, LOOKUP_CACHE_HEADERS);
}
