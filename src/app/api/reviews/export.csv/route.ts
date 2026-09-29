// GET /api/reviews/export.csv: the Review cycles list as CSV, with the same
// filters and the same reach as GET /api/reviews (it reads through it, page
// by page, so the export can never show a cycle the list would not). Never
// for an Agent or a Guest (cap.agent.export).

import { NextRequest } from "next/server";
import { jsonError } from "@/lib/api-helpers";
import { cycleViewerCtx } from "@/lib/performance/review-cycle.server";
import { cycleStatusOf, cycleTypeLabel } from "@/lib/performance/review-cycle";
import { toCsv } from "@/lib/csv";
import { GET as listCycles } from "../route";

type Row = {
  name: string; type: string; status: string; startDate: string; endDate: string; covers: string;
  createdBy: { name: string } | null; counts: { total: number; completed: number };
};

export async function GET(req: NextRequest) {
  const ctx = await cycleViewerCtx();
  if (!ctx) return jsonError("Unauthorized", 401);
  if (ctx.isGuest || ctx.isAgent) return jsonError("Forbidden", 403);
  const base = new URL(req.url);
  const rows: Row[] = [];
  for (let page = 1; page <= 100; page += 1) {
    const u = new URL(base.toString().replace("/export.csv", ""));
    u.searchParams.set("page", String(page));
    u.searchParams.set("limit", "100");
    const res = await listCycles(new NextRequest(u, { headers: req.headers }));
    if (!res.ok) return res;
    const body = (await res.json()) as { data: Row[]; pagination: { hasMore: boolean } };
    rows.push(...body.data);
    if (!body.pagination.hasMore) break;
  }
  const csv = toCsv(
    rows.map((c) => ({
      Cycle: c.name,
      Type: cycleTypeLabel(c.type),
      Status: cycleStatusOf(c.status).label,
      Starts: c.startDate.slice(0, 10),
      Closes: c.endDate.slice(0, 10),
      Covers: c.covers,
      "Started by": c.createdBy?.name ?? "",
      People: c.counts.total,
      Completed: c.counts.completed,
    })),
    ["Cycle", "Type", "Status", "Starts", "Closes", "Covers", "Started by", "People", "Completed"],
    { formulaSafe: true },
  );
  return new Response(csv, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="review-cycles-${new Date().toISOString().slice(0, 10)}.csv"`,
      "Cache-Control": "no-store",
    },
  });
}
