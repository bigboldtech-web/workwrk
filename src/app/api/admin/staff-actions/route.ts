import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSessionOrFail, jsonSuccess } from "@/lib/api-helpers";
import { requirePlatformAdminApi } from "@/lib/platform-admin";
import { staffNames } from "@/lib/admin/company-detail";
import { CSV_MAX_ROWS, toCsv } from "@/lib/admin/companies-list";
import { ACTION_LABEL, activityOrderBy, activityWhere, parseActivityParams, type ActivityParams } from "@/lib/admin/staff-activity";
import type { StaffActionKey } from "@/lib/staff-audit-helpers";

/**
 * GET /api/admin/staff-actions: Staff activity (spec-admin-backoffice 2.7).
 * Platform staff only. Read only: nothing here edits or deletes a row, and
 * no route ever does (StaffAction rows are kept for ever).
 *
 *   ?view=all|companies|staff|codes  &who=<staff email>  &company=<id>
 *   &action=<key>  &from=&to= (YYYY-MM-DD)  &sort=newest|oldest
 *   &cursor=<last row id>  &limit= (at most 100)
 *   &format=csv  the same rows as a download (at most 5,000)
 *
 * Paging is by cursor, so a row written while someone pages never shifts
 * the page under them. `actors` lists every email that has a row, for the
 * Who filter (a removed staff member's history stays findable).
 */

const SELECT = {
  id: true,
  createdAt: true,
  action: true,
  actorEmail: true,
  targetCompanyId: true,
  targetLabel: true,
  summary: true,
  before: true,
  after: true,
  reason: true,
  ip: true,
  hits: true,
  targetCompany: { select: { id: true, name: true } },
} as const;

async function page(p: ActivityParams, take: number) {
  return prisma.staffAction.findMany({
    where: activityWhere(p),
    orderBy: activityOrderBy(p.sort),
    take,
    ...(p.cursor ? { cursor: { id: p.cursor }, skip: 1 } : {}),
    select: SELECT,
  });
}

export async function GET(req: NextRequest) {
  const { error, session } = await getSessionOrFail();
  if (error) return error;
  const denied = await requirePlatformAdminApi(session);
  if (denied) return denied;

  const url = new URL(req.url);
  const p = parseActivityParams(url.searchParams);
  const csv = url.searchParams.get("format") === "csv";

  // A cursor for a row that no longer matches (it never is deleted, but a
  // filter change can drop it) starts from the top rather than failing.
  if (p.cursor) {
    const exists = await prisma.staffAction.findFirst({ where: { AND: [activityWhere(p), { id: p.cursor }] }, select: { id: true } });
    if (!exists) p.cursor = null;
  }

  if (csv) {
    const rows = await page({ ...p, cursor: null }, CSV_MAX_ROWS + 1);
    const cut = rows.slice(0, CSV_MAX_ROWS);
    const names = await staffNames(cut.map((r) => r.actorEmail));
    const body = toCsv([
      ["When (UTC)", "Who", "Email", "Action", "What", "Company", "Company ID", "Reason", "IP", "Hits", "Source"],
      ...cut.map((r) => [
        r.createdAt.toISOString(),
        names.get(r.actorEmail) ?? r.actorEmail,
        r.actorEmail,
        ACTION_LABEL[r.action as StaffActionKey] ?? r.action,
        r.summary,
        r.targetCompany?.name ?? "",
        r.targetCompany?.id ?? "",
        r.reason ?? "",
        r.ip ?? "",
        r.hits,
        "Console",
      ]),
    ]);
    return new NextResponse(body, {
      headers: {
        "content-type": "text/csv; charset=utf-8",
        "content-disposition": `attachment; filename="staff-activity-${new Date().toISOString().slice(0, 10)}${rows.length > CSV_MAX_ROWS ? "-first-5000" : ""}.csv"`,
        "cache-control": "no-store",
      },
    });
  }

  const [rows, total, actorRows, companyRow] = await Promise.all([
    page(p, p.limit + 1),
    prisma.staffAction.count({ where: activityWhere(p) }),
    prisma.staffAction.groupBy({ by: ["actorEmail"], _count: { _all: true }, orderBy: { actorEmail: "asc" }, take: 500 }),
    p.company ? prisma.organization.findUnique({ where: { id: p.company }, select: { id: true, name: true } }) : Promise.resolve(null),
  ]);
  const more = rows.length > p.limit;
  const list = rows.slice(0, p.limit);
  const names = await staffNames([...list.map((r) => r.actorEmail), ...actorRows.map((a) => a.actorEmail)]);

  return jsonSuccess({
    rows: list.map((r) => ({
      id: r.id,
      createdAt: r.createdAt,
      action: r.action,
      actionLabel: ACTION_LABEL[r.action as StaffActionKey] ?? r.action,
      who: names.get(r.actorEmail) ?? r.actorEmail,
      email: r.actorEmail,
      summary: r.summary,
      // A deleted company's rows keep their summary; the link goes (SetNull).
      company: r.targetCompany ? { id: r.targetCompany.id, name: r.targetCompany.name } : null,
      targetLabel: r.targetLabel,
      before: r.before,
      after: r.after,
      reason: r.reason,
      ip: r.ip,
      hits: r.hits,
    })),
    total,
    nextCursor: more ? list[list.length - 1]?.id ?? null : null,
    actors: actorRows.map((a) => ({ email: a.actorEmail, name: names.get(a.actorEmail) ?? null })),
    company: companyRow,
  });
}
