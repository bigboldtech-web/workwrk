import { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSessionOrFail, jsonSuccess } from "@/lib/api-helpers";
import { requirePlatformAdminApi } from "@/lib/platform-admin";
import {
  codeSearchWhere,
  codeSecondary,
  codeStatus,
  companySearchWhere,
  normalizeSearchQuery,
  parseSearchLimit,
  parseSearchTypes,
  staffSearchWhere,
} from "@/lib/admin/search";

/**
 * GET /api/admin/search?q=&types=companies,staff,codes&limit=8
 * (spec-admin-backoffice section 2.8): Search (Cmd+K) in the Staff console.
 * Platform staff only.
 *
 * Three things and nothing else: companies by name, slug or sign-in domain
 * (the same match as GET /api/admin/companies?search=), staff by name or
 * email, and AppSumo codes by exact or prefix match. No task, document,
 * message or file is searchable here, and no parameter can ask for one.
 * Each section returns at most `limit` rows plus its full count, so the
 * overlay can say "See all {n}".
 */
export async function GET(req: NextRequest) {
  const { error, session } = await getSessionOrFail();
  if (error) return error;
  const denied = await requirePlatformAdminApi(session);
  if (denied) return denied;

  const url = new URL(req.url);
  const q = normalizeSearchQuery(url.searchParams.get("q"));
  const types = new Set(parseSearchTypes(url.searchParams.get("types")));
  const limit = parseSearchLimit(url.searchParams.get("limit"));

  const empty = { q, companies: [], staff: [], codes: [], counts: { companies: 0, staff: 0, codes: 0 } };
  if (!q) return jsonSuccess(empty);

  const companyWhere = companySearchWhere(q);
  const staffWhere = staffSearchWhere(q);
  const codeWhere = codeSearchWhere(q);

  const [companies, companyCount, staff, staffCount, codes, codeCount] = await Promise.all([
    types.has("companies")
      ? prisma.organization.findMany({
          where: companyWhere,
          select: { id: true, name: true, slug: true, plan: true, status: true },
          orderBy: { name: "asc" },
          take: limit,
        })
      : Promise.resolve([]),
    types.has("companies") ? prisma.organization.count({ where: companyWhere }) : Promise.resolve(0),
    types.has("staff")
      ? prisma.platformAdmin.findMany({
          where: staffWhere,
          select: { email: true, name: true },
          orderBy: { email: "asc" },
          take: limit,
        })
      : Promise.resolve([]),
    types.has("staff") ? prisma.platformAdmin.count({ where: staffWhere }) : Promise.resolve(0),
    types.has("codes")
      ? prisma.appsumoCode.findMany({
          where: codeWhere,
          select: { code: true, redeemedAt: true, refundedAt: true, redeemedByOrg: true },
          orderBy: { code: "asc" },
          take: limit,
        })
      : Promise.resolve([]),
    types.has("codes") ? prisma.appsumoCode.count({ where: codeWhere }) : Promise.resolve(0),
  ]);

  // redeemedByOrg is a bare id with no relation: join the names by hand. A
  // company that no longer exists resolves to null, never to its raw id.
  const orgIds = [...new Set(codes.map((c) => c.redeemedByOrg).filter((v): v is string => Boolean(v)))];
  const orgs = orgIds.length
    ? await prisma.organization.findMany({ where: { id: { in: orgIds } }, select: { id: true, name: true } })
    : [];
  const orgName = new Map(orgs.map((o) => [o.id, o.name]));

  return jsonSuccess({
    q,
    companies,
    staff,
    codes: codes.map((c) => {
      const status = codeStatus(c);
      const companyName = c.redeemedByOrg ? orgName.get(c.redeemedByOrg) ?? null : null;
      return {
        code: c.code,
        status,
        companyId: companyName ? c.redeemedByOrg : null,
        companyName,
        label: codeSecondary(status, companyName),
      };
    }),
    counts: { companies: companyCount, staff: staffCount, codes: codeCount },
  });
}
