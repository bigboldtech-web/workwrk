import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSessionOrFail, jsonError, jsonSuccess } from "@/lib/api-helpers";
import { requirePlatformAdminApi } from "@/lib/platform-admin";
import type { Plan, Prisma } from "@/generated/prisma";
import { logStaffAction, requestIp, staffActorFromSession, writeTenantRow } from "@/lib/staff-audit";
import { codeStatus } from "@/lib/admin/search";
import { CODE_VIEWS, codeFilterWhere, codeGives, codeOrderBy, codeViewWhere, parseCodeListParams } from "@/lib/admin/codes-list";
import { CSV_MAX_ROWS, seatsAreUnlimited, toCsv } from "@/lib/admin/companies-list";
import { planLabel } from "@/lib/staff-audit-helpers";
import { confirmMatches } from "@/lib/admin/company-patch-rules";
import { importWords } from "@/lib/admin/staff-activity";

/**
 * /api/admin/appsumo: WorkwrK staff endpoints for AppSumo code
 * management. Platform staff only.
 *
 * GET    → the codes (paginated), with the four view counts under the same
 *          filters and the redeeming company's name joined in.
 *          ?view=all|unused|redeemed|refunded (`filter` is the old name)
 *          &code= (exact or prefix) &tier=1,2 &plan=GROWTH
 *          &imported_from=&imported_to=&redeemed_from=&redeemed_to=
 *          &redeemed_by=<company id> &sort=newest|oldest|code
 *          &page=&limit= (at most 500) &format=csv (at most 5,000)
 * POST   → bulk import. Body: { codes: [{code, tier, plan, seats}], repeatedInPaste? }
 * PATCH  → flip a code to refunded. Body: { code, refunded: true, notes? }
 *
 * Both writes record a StaffAction row in the same transaction. A refund
 * never downgrades the company automatically (decided): the row names the
 * company so the console can link to its page.
 */

const VALID_PLANS = new Set(["STARTER", "GROWTH", "SCALE", "ENTERPRISE"] as const);

export async function GET(req: NextRequest) {
  const { error, session } = await getSessionOrFail();
  if (error) return error;
  const denied = await requirePlatformAdminApi(session);
  if (denied) return denied;

  const url = new URL(req.url);
  const p = parseCodeListParams(url.searchParams);
  const csv = url.searchParams.get("format") === "csv";
  const filters = codeFilterWhere(p);
  const where: Prisma.AppsumoCodeWhereInput = { AND: [filters, codeViewWhere(p.view)] };

  const select = {
    id: true, code: true, tier: true, plan: true, seats: true, redeemedByOrg: true,
    redeemedAt: true, refundedAt: true, createdAt: true,
  } as const;

  const [codes, total, ...viewCounts] = await Promise.all([
    prisma.appsumoCode.findMany({
      where,
      orderBy: codeOrderBy(p.sort),
      skip: csv ? 0 : (p.page - 1) * p.limit,
      take: csv ? CSV_MAX_ROWS + 1 : p.limit,
      select,
    }),
    prisma.appsumoCode.count({ where }),
    ...CODE_VIEWS.map((v) => prisma.appsumoCode.count({ where: { AND: [filters, codeViewWhere(v)] } })),
  ]);

  // redeemedByOrg is a bare id with no relation: join the names by hand. A
  // company deleted since reads as no company ("None"), never a dangling id.
  const page = csv ? codes.slice(0, CSV_MAX_ROWS) : codes;
  const orgIds = [...new Set(page.map((c) => c.redeemedByOrg).filter((v): v is string => Boolean(v)))];
  const [orgs, byCompany] = await Promise.all([
    orgIds.length ? prisma.organization.findMany({ where: { id: { in: orgIds } }, select: { id: true, name: true } }) : [],
    p.redeemedBy ? prisma.organization.findUnique({ where: { id: p.redeemedBy }, select: { id: true, name: true } }) : null,
  ]);
  const orgName = new Map(orgs.map((o) => [o.id, o.name]));
  const rows = page.map((c) => {
    const companyName = c.redeemedByOrg ? orgName.get(c.redeemedByOrg) ?? null : null;
    return {
      ...c,
      status: codeStatus(c),
      gives: codeGives(c),
      company: companyName && c.redeemedByOrg ? { id: c.redeemedByOrg, name: companyName } : null,
    };
  });

  if (csv) {
    const body = toCsv([
      ["Code", "Tier", "Plan", "Seats", "What it gives", "Status", "Redeemed by", "Company ID", "Redeemed", "Refunded", "Imported"],
      ...rows.map((r) => [
        r.code,
        r.tier,
        planLabel(r.plan),
        seatsAreUnlimited(r.seats) ? "Unlimited" : r.seats,
        r.gives,
        r.status === "refunded" ? "Refunded" : r.status === "redeemed" ? "Redeemed" : "Unused",
        r.company?.name ?? "",
        r.company?.id ?? "",
        r.redeemedAt ? r.redeemedAt.toISOString().slice(0, 10) : "",
        r.refundedAt ? r.refundedAt.toISOString().slice(0, 10) : "",
        r.createdAt.toISOString().slice(0, 10),
      ]),
    ]);
    return new NextResponse(body, {
      headers: {
        "content-type": "text/csv; charset=utf-8",
        "content-disposition": `attachment; filename="appsumo-codes-${new Date().toISOString().slice(0, 10)}${codes.length > CSV_MAX_ROWS ? "-first-5000" : ""}.csv"`,
        "cache-control": "no-store",
      },
    });
  }

  return jsonSuccess({
    codes: rows,
    total,
    page: p.page,
    limit: p.limit,
    code: p.code || null,
    counts: Object.fromEntries(CODE_VIEWS.map((v, i) => [v, viewCounts[i]])),
    redeemedBy: byCompany,
  });
}

export async function POST(req: NextRequest) {
  const { error, session } = await getSessionOrFail();
  if (error) return error;
  const denied = await requirePlatformAdminApi(session);
  if (denied) return denied;

  const body = await req.json().catch(() => null);
  if (!body || typeof body !== "object") return jsonError("Send a JSON body");
  const items = Array.isArray(body?.codes) ? body.codes : [];
  if (items.length === 0) return jsonError("Send at least one code");
  if (items.length > 5000) return jsonError("Bulk import capped at 5000 codes per call");

  // Validate every row before writing anything.
  const cleaned: { code: string; tier: number; plan: Plan; seats: number }[] = [];
  for (const item of items) {
    const code = typeof item?.code === "string" ? item.code.trim() : "";
    const tier = Number(item?.tier);
    const plan = String(item?.plan ?? "").toUpperCase();
    const seats = Number(item?.seats);
    if (!code) return jsonError("Empty code in batch");
    if (![1, 2, 3, 4, 5].includes(tier)) return jsonError(`Invalid tier "${tier}" for code ${code}`);
    if (!VALID_PLANS.has(plan as Plan)) return jsonError(`Invalid plan "${plan}" for code ${code}`);
    if (!Number.isFinite(seats) || seats < 1) return jsonError(`Invalid seats "${seats}" for code ${code}`);
    cleaned.push({ code, tier, plan: plan as Plan, seats });
  }

  // Lines the browser dropped because the same code was already higher up
  // in the paste (parseImport). They never reach here, so without the count
  // the Staff activity row gave a different total from the toast for the
  // same import. Bookkeeping only: nothing is written for them.
  const repeatedRaw = Number(body?.repeatedInPaste);
  const repeatedInPaste = Number.isInteger(repeatedRaw) && repeatedRaw > 0 ? Math.min(repeatedRaw, 100_000) : 0;

  // Skip duplicates rather than 409-ing the whole batch: re-imports
  // are common when AppSumo re-sends the CSV.
  const actor = staffActorFromSession(session);
  const ip = requestIp(req);
  const tiers: Record<string, number> = {};
  for (const row of cleaned) tiers[`tier${row.tier}`] = (tiers[`tier${row.tier}`] ?? 0) + 1;

  const inserted = await prisma.$transaction(async (tx) => {
    const result = await tx.appsumoCode.createMany({
      data: cleaned,
      skipDuplicates: true,
    });
    await logStaffAction({
      db: tx,
      action: "admin.codes.imported",
      actor,
      ip,
      summary: importWords(result.count, cleaned.length, repeatedInPaste).summary,
      after: { inserted: result.count, attempted: cleaned.length, repeatedInPaste, tiers },
    });
    return result.count;
  });

  return jsonSuccess({ inserted, attempted: cleaned.length, repeatedInPaste });
}

export async function PATCH(req: NextRequest) {
  const { error, session } = await getSessionOrFail();
  if (error) return error;
  const denied = await requirePlatformAdminApi(session);
  if (denied) return denied;

  const body = await req.json().catch(() => null);
  if (!body || typeof body !== "object") return jsonError("Send a JSON body");
  const code = typeof body?.code === "string" ? body.code.trim() : "";
  if (!code) return jsonError("`code` is required");

  if (body?.refunded === true) {
    const notes = typeof body?.notes === "string" && body.notes.trim() ? body.notes.trim() : null;
    // Checked on the server as well as in the browser: a refund cannot be
    // undone from the console, so a replayed call must name the code.
    const confirm = typeof body?.confirm === "string" ? body.confirm : "";
    const actor = staffActorFromSession(session);
    const ip = requestIp(req);

    const outcome = await prisma.$transaction(async (tx) => {
      const row = await tx.appsumoCode.findUnique({
        where: { code },
        select: { code: true, tier: true, plan: true, seats: true, redeemedByOrg: true, redeemedAt: true, refundedAt: true },
      });
      if (!row) return { status: 404 as const };
      if (!confirmMatches(confirm, row.code)) return { status: 400 as const };
      // Already refunded: nothing changes, so nothing is written or recorded.
      if (row.refundedAt) return { status: 200 as const, refundedAt: row.refundedAt, logged: null, company: null };
      // Only a redeemed code can be refunded (spec 2.6: the action exists
      // only on a redeemed row). A refund cannot be undone and a refunded
      // code can never be redeemed, so a replayed or scripted call on an
      // unused code would take away a code a customer paid for.
      if (!row.redeemedAt) return { status: 409 as const };

      // The company that redeemed it, when it still exists (redeemedByOrg is
      // a bare id with no relation; a deleted company leaves it dangling).
      const company = row.redeemedByOrg
        ? await tx.organization.findUnique({ where: { id: row.redeemedByOrg }, select: { id: true, name: true } })
        : null;

      // A conditional claim, not a plain update: two refunds of one code at
      // once (a double click, two tabs, two staff members) both passed the
      // refundedAt check above, both wrote, and both logged, and the second
      // overwrote the refund time the first row recorded. Postgres re-checks
      // this WHERE on the row the first writer locked, so exactly one call
      // flips it; the other finds count 0 and answers like any repeat.
      const now = new Date();
      const claimed = await tx.appsumoCode.updateMany({
        where: { code, refundedAt: null, redeemedAt: { not: null } },
        data: { refundedAt: now, notes },
      });
      if (claimed.count === 0) {
        const again = await tx.appsumoCode.findUnique({ where: { code }, select: { refundedAt: true } });
        if (!again) return { status: 404 as const };
        if (!again.refundedAt) return { status: 409 as const };
        return { status: 200 as const, refundedAt: again.refundedAt, logged: null, company: null };
      }
      // Both sides carry the same facts and only refundedAt differs, so See
      // details shows the one change. The tier, plan and seats are the
      // CODE's (what it gave), never the company's plan, which a refund
      // leaves alone.
      const facts = {
        redeemedAt: row.redeemedAt,
        codeTier: row.tier,
        codePlan: row.plan,
        codeSeats: row.seats,
        companyId: company?.id ?? null,
        companyName: company?.name ?? null,
      };
      const logged = await logStaffAction({
        db: tx,
        action: "admin.code.refunded",
        actor,
        ip,
        targetCompanyId: company?.id ?? null,
        targetLabel: code,
        reason: notes,
        summary: `Marked AppSumo code ${code} (Tier ${row.tier}) refunded${
          company ? ` for ${company.name}; their plan was not changed` : "; the company that redeemed it no longer exists"
        }`,
        before: { refundedAt: null, ...facts },
        after: { refundedAt: now, ...facts },
      });
      return { status: 200 as const, refundedAt: now, logged, company };
    });

    if (outcome.status === 404) return jsonError("Code not found", 404);
    if (outcome.status === 400) return jsonError("Type the code to confirm the refund", 400);
    if (outcome.status === 409) return jsonError("This code was never redeemed, so there is nothing to refund", 409);
    void writeTenantRow(outcome.logged);
    return jsonSuccess({ ok: true, refundedAt: outcome.refundedAt, company: outcome.company ?? null });
  }

  return jsonError("Specify `refunded: true` to mark a code refunded");
}
