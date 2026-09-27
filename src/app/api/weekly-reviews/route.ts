// GET /api/weekly-reviews: the /team/reviews queue (spec-teams-performance
// /team/reviews Data). Replaces the server-side listReviewsForManager call,
// which read the recorded manager only, so a director saw their directs
// while /team/kpi-reviews showed the whole tree (PO-16).
//
//   ?view=waiting|acted|all  &scope=direct|chain  &status=  &week=
//   &person=  &q=  &sort=oldest|newest|person  &group=none|person|week
//   &page=  &ids=  &format=csv
//
// Gate: the `weekly-reviews` APP_RULES row's facts (anyone with reports,
// solid or dotted, the People team and Admin); anyone else 403. The
// population is clipped server side (weekly-queue.server.ts), so no
// parameter widens it. Names, never raw KRA or KPI ids (PO-9).
//
// CSV (Export and Export selected): the People team and Admin, never an
// Agent (cap.agent.export). A draft row's body is never exported.

import { NextResponse } from "next/server";
import { listWeeklyQueue, mayOpenQueue, weeklyQueueCtx } from "@/lib/people/weekly-queue.server";
import { parseWeeklyQuery } from "@/lib/people/weekly-queue";
import { toCsv } from "@/lib/csv";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const ctx = await weeklyQueueCtx();
  if (!ctx) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!mayOpenQueue(ctx)) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const url = new URL(req.url);
  const q = parseWeeklyQuery(url.searchParams);
  const csv = url.searchParams.get("format") === "csv";
  if (csv && (ctx.isAgent || (!ctx.peopleTeamOrAdmin && q.ids.length === 0))) {
    return NextResponse.json({ error: "Exporting weekly reviews needs the People team or an Admin" }, { status: 403 });
  }
  const res = await listWeeklyQueue(ctx, q, { all: csv });
  if (csv) {
    const body = toCsv(
      res.rows.map((r) => ({
        Person: `${r.subject.firstName} ${r.subject.lastName}`.trim(),
        Email: r.subject.email,
        Week: r.week,
        Status: r.statusLabel,
        "KRAs on track": r.kras.total ? `${r.kras.onTrack} of ${r.kras.total}` : "",
        Highlights: r.highlights,
        Submitted: r.submittedAt ?? "",
        Decided: r.reviewedAt ?? "",
      })),
      ["Person", "Email", "Week", "Status", "KRAs on track", "Highlights", "Submitted", "Decided"],
    );
    return new NextResponse(body, {
      headers: {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": `attachment; filename="weekly-reviews-${new Date().toISOString().slice(0, 10)}.csv"`,
        "Cache-Control": "no-store",
      },
    });
  }
  return NextResponse.json(
    { data: res.rows, pagination: { total: res.total, page: res.page, pageSize: res.pageSize }, scope: res.scope, groups: res.groups },
    { headers: { "Cache-Control": "no-store" } },
  );
}
