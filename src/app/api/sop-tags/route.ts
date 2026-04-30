import { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSessionOrFail, getOrgId, isOrgAdmin, jsonError, jsonSuccess, LOOKUP_CACHE_HEADERS } from "@/lib/api-helpers";

/**
 * /api/sop-tags
 *
 * GET    — distinct tags currently in use on SOPs in the caller's org,
 *          with usage counts. Drives the tag chip filter, the
 *          autocomplete in the create/edit dialog, and the Settings
 *          tag-manager UI.
 * PATCH  — rename a tag everywhere it appears. Body: { from, to }.
 *          Org admins only.
 * DELETE — remove a tag from every SOP that has it. Body or query:
 *          ?name=<tag>. Org admins only.
 *
 * Tag visibility is org-wide: tags are flexible cross-cutting
 * metadata, not access-controlled like folders.
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

export async function PATCH(req: NextRequest) {
  const { error, session } = await getSessionOrFail();
  if (error) return error;
  if (!isOrgAdmin(session)) return jsonError("Only org admins can rename tags", 403);
  const orgId = getOrgId(session);

  const body = await req.json();
  const from = typeof body?.from === "string" ? body.from.trim() : "";
  const to = typeof body?.to === "string" ? body.to.trim() : "";
  if (!from || !to) return jsonError("Both `from` and `to` are required");
  if (from === to) return jsonSuccess({ updated: 0 });
  if (to.length > 40) return jsonError("Tag too long (max 40 chars)");

  // array_remove + array_append, dedup. Done atomically per row.
  const updated = await prisma.$executeRawUnsafe(`
    UPDATE "SOP"
       SET tags = (
         SELECT ARRAY(
           SELECT DISTINCT t
             FROM UNNEST(array_append(array_remove(tags, $2), $3)) AS t
         )
       )
     WHERE "organizationId" = $1
       AND $2 = ANY(tags)
  `, orgId, from, to);

  return jsonSuccess({ updated });
}

export async function DELETE(req: NextRequest) {
  const { error, session } = await getSessionOrFail();
  if (error) return error;
  if (!isOrgAdmin(session)) return jsonError("Only org admins can delete tags", 403);
  const orgId = getOrgId(session);

  // Accept either ?name= or { name } in the body.
  let name = new URL(req.url).searchParams.get("name") || "";
  if (!name) {
    const body = await req.json().catch(() => ({}));
    name = typeof body?.name === "string" ? body.name : "";
  }
  name = name.trim();
  if (!name) return jsonError("`name` is required");

  const updated = await prisma.$executeRawUnsafe(`
    UPDATE "SOP"
       SET tags = array_remove(tags, $2)
     WHERE "organizationId" = $1
       AND $2 = ANY(tags)
  `, orgId, name);

  return jsonSuccess({ updated });
}
