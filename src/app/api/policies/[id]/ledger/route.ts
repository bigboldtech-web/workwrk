import { NextRequest } from "next/server";
import { getSessionOrFail, getOrgId, jsonError, jsonSuccess } from "@/lib/api-helpers";
import { buildPolicyLedger } from "@/lib/policy-ledger";
import { filterLedgerRows, ledgerStats, paginate, parseLedgerSort, parseLedgerView, LEDGER_PAGE_SIZE } from "@/lib/policy-ledger-view";
import { personScope } from "@/lib/process-scope";

/**
 * GET /api/policies/[id]/ledger?view=&q=&department=&version=&sort=&dir=&page=&pageSize=
 * (spec-process section 2 `/policies/[id]/compliance`): the acknowledgement
 * ledger, scoped to the people the viewer may see (their chain, or everyone
 * for the org-wide roles), filtered, sorted and paginated server-side. The
 * summary is over the scoped, unfiltered rows so the StatRow and the table
 * agree on what "Pending" means.
 */
export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { error, session } = await getSessionOrFail();
  if (error) return error;
  const scope = await personScope(session);
  if (!scope.canView) return jsonError("Forbidden", 403);

  const { id } = await params;
  const ledger = await buildPolicyLedger(id, getOrgId(session), scope.orgWide ? null : scope.userIds);
  if (!ledger) return jsonError("Policy not found", 404);

  const sp = new URL(req.url).searchParams;
  const view = parseLedgerView(sp.get("view"));
  const versionRaw = sp.get("version");
  const query = {
    view,
    q: sp.get("q"),
    department: sp.get("department"),
    version: versionRaw && Number.isFinite(Number(versionRaw)) ? Number(versionRaw) : null,
    sort: parseLedgerSort(sp.get("sort")),
    dir: sp.get("dir") === "desc" ? ("desc" as const) : ("asc" as const),
  };
  const filtered = filterLedgerRows(ledger.rows, query);
  const page = paginate(filtered, Number(sp.get("page")) || 1, Number(sp.get("pageSize")) || LEDGER_PAGE_SIZE);
  const counts = {
    all: ledger.rows.length,
    acked: ledger.summary.acked,
    pending: ledger.summary.pending,
    overdue: ledger.summary.overdue,
    reack: ledger.summary.outOfDate,
  };

  return jsonSuccess({
    policy: ledger.policy,
    rows: page.items,
    pagination: { page: page.page, pageSize: page.pageSize, total: page.total, totalPages: page.totalPages, from: page.from, to: page.to },
    summary: ledger.summary,
    stats: ledgerStats(ledger.summary),
    counts,
    departments: ledger.departments,
    versions: ledger.versions,
    view,
  });
}
