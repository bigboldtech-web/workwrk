import { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSessionOrFail, getOrgId, jsonError, jsonSuccess } from "@/lib/api-helpers";
import { viewerFromSession } from "@/lib/access/viewer";
import { toCsv } from "@/lib/people/people-csv";

// GET /api/kudos/leaderboard?period=month|quarter|all&limit=&cursor=&format=csv
// The Kudos Leaderboard view (spec-teams-performance /kudos): per person,
// kudos received and given in the period, their top value and when they
// were last thanked, sorted by received (then most recently thanked, then
// most given). EVERYONE who took part is a row, givers who received nothing
// included, so the Given column never hides a generous colleague.
//
// Paged, never capped: `cursor` is the offset into that one ordering (the
// ranking is a snapshot of counts, so an offset is the honest key) and
// `nextCursor` is null on the last page; `people` is the total row count
// and `totalKudos` the kudos in the period. The default limit (10) is the
// older "Most recognized" card's; a page asks for up to 100.
//
// format=csv: every row, for the People team and Admin, never an Agent.
//
// The response keeps the older fields (leaderboard[].kudosCount,
// topValues, totalKudos, month) beside the new ones.
export async function GET(req: NextRequest) {
  const { error, session } = await getSessionOrFail();
  if (error) return error;
  const viewer = await viewerFromSession();
  if (viewer?.orgRole === "GUEST") return jsonError("Not found", 404);

  const orgId = getOrgId(session);
  const url = new URL(req.url);
  const period = url.searchParams.get("period") === "quarter" ? "quarter" : url.searchParams.get("period") === "all" ? "all" : "month";
  const limit = Math.min(Math.max(1, parseInt(url.searchParams.get("limit") || "10", 10) || 10), 100);
  const cursorRaw = url.searchParams.get("cursor");
  const offset = cursorRaw && /^\d+$/.test(cursorRaw) ? Number(cursorRaw) : 0;
  const csv = url.searchParams.get("format") === "csv";
  if (csv) {
    const isAdmin = viewer?.orgRole === "OWNER" || viewer?.orgRole === "ADMIN";
    if (viewer?.isAgent || !(isAdmin || viewer?.peopleTeam)) return jsonError("Only the People team or an Admin can export the leaderboard", 403);
  }

  const now = new Date();
  const start = period === "month"
    ? new Date(now.getFullYear(), now.getMonth(), 1)
    : period === "quarter"
      ? new Date(now.getFullYear(), Math.floor(now.getMonth() / 3) * 3, 1)
      : null;
  const where = { organizationId: orgId, ...(start ? { createdAt: { gte: start } } : {}) };

  const [received, given, valueRows, total] = await Promise.all([
    prisma.kudos.groupBy({ by: ["receiverId"], where, _count: { _all: true }, _max: { createdAt: true } }),
    prisma.kudos.groupBy({ by: ["giverId"], where, _count: { _all: true } }),
    prisma.kudos.groupBy({ by: ["receiverId", "companyValue"], where: { ...where, companyValue: { not: null } }, _count: { _all: true } }),
    prisma.kudos.count({ where }),
  ]);

  const givenBy = new Map(given.map((g) => [g.giverId, g._count._all] as const));
  const receivedBy = new Map(received.map((r) => [r.receiverId, { n: r._count._all, last: r._max.createdAt ?? null }] as const));
  const valuesBy = new Map<string, Array<{ value: string; count: number }>>();
  for (const v of valueRows) {
    if (!v.companyValue) continue;
    const list = valuesBy.get(v.receiverId) ?? [];
    list.push({ value: v.companyValue, count: v._count._all });
    valuesBy.set(v.receiverId, list);
  }
  const everyone = [...new Set([...receivedBy.keys(), ...givenBy.keys()])];
  const ranked = everyone
    .map((id) => ({ id, received: receivedBy.get(id)?.n ?? 0, last: receivedBy.get(id)?.last ?? null, given: givenBy.get(id) ?? 0 }))
    .sort((a, b) =>
      b.received - a.received
      || (b.last?.getTime() ?? 0) - (a.last?.getTime() ?? 0)
      || b.given - a.given
      || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  const pageRows = csv ? ranked : ranked.slice(offset, offset + limit);

  const users = pageRows.length
    ? await prisma.user.findMany({
        where: { id: { in: pageRows.map((r) => r.id) } },
        select: { id: true, firstName: true, lastName: true, email: true, avatar: true, role: { select: { title: true } }, department: { select: { name: true } } },
      })
    : [];
  const userById = new Map(users.map((u) => [u.id, u] as const));

  const leaderboard = pageRows.map((r) => {
    const user = userById.get(r.id);
    const values = (valuesBy.get(r.id) ?? []).sort((a, b) => b.count - a.count || a.value.localeCompare(b.value));
    return {
      userId: r.id,
      name: user ? `${user.firstName ?? ""} ${user.lastName ?? ""}`.trim() : "Unknown",
      firstName: user?.firstName ?? null,
      lastName: user?.lastName ?? null,
      avatar: user?.avatar || null,
      role: user?.role?.title || null,
      department: user?.department?.name || "",
      kudosCount: r.received,
      received: r.received,
      given: r.given,
      topValue: values[0]?.value ?? null,
      topValues: values.slice(0, 3).map((v) => v.value),
      lastReceived: r.last ? r.last.toISOString() : null,
    };
  });

  if (csv) {
    const body = toCsv(
      ["Rank", "Name", "Email", "Received", "Given", "Top value", "Last received"],
      leaderboard.map((r, i) => [i + 1, r.name, userById.get(r.userId)?.email ?? "", r.received, r.given, r.topValue ?? "", r.lastReceived ?? ""]),
    );
    return new Response(body, {
      headers: { "Content-Type": "text/csv; charset=utf-8", "Content-Disposition": `attachment; filename="kudos-leaderboard-${period}.csv"`, "Cache-Control": "no-store" },
    });
  }

  const valueCounts = new Map<string, number>();
  for (const v of valueRows) if (v.companyValue) valueCounts.set(v.companyValue, (valueCounts.get(v.companyValue) ?? 0) + v._count._all);
  const topValues = [...valueCounts.entries()].sort(([, a], [, b]) => b - a).slice(0, 5).map(([value, count]) => ({ value, count }));
  const end = offset + pageRows.length;

  return jsonSuccess({
    leaderboard,
    period,
    month: (start ?? new Date(now.getFullYear(), now.getMonth(), 1)).toISOString(),
    totalKudos: total,
    people: ranked.length,
    offset,
    nextCursor: end < ranked.length ? String(end) : null,
    topValues,
  });
}
