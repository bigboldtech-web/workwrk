import { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSessionOrFail, jsonError, jsonSuccess } from "@/lib/api-helpers";
import { requirePlatformAdminApi } from "@/lib/platform-admin";
import type { Plan, Prisma } from "@/generated/prisma";
import { logStaffAction, requestIp, staffActorFromSession, writeTenantRow } from "@/lib/staff-audit";
import { boundedInt, codeSearchWhere } from "@/lib/admin/search";

/**
 * /api/admin/appsumo: WorkwrK staff endpoints for AppSumo code
 * management. Platform staff only.
 *
 * GET    → list of codes with redemption status (paginated)
 * POST   → bulk import. Body: { codes: [{code, tier, plan, seats}] }
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
  const filter = url.searchParams.get("filter") ?? "all"; // all / unused / redeemed / refunded
  // Bounded and NaN-safe, the same rule as the companies list.
  const page = boundedInt(url.searchParams.get("page"), 1, 1, 100_000);
  const limit = boundedInt(url.searchParams.get("limit"), 100, 1, 500);
  // `code`: exact or prefix, case-insensitive, the same rule as Search's
  // CODES section, so a Search result always lands on a list that has it.
  const codeQuery = (url.searchParams.get("code") ?? "").trim().slice(0, 100);

  const where: Prisma.AppsumoCodeWhereInput = codeQuery ? codeSearchWhere(codeQuery) : {};
  if (filter === "unused") where.redeemedAt = null;
  if (filter === "redeemed") {
    where.redeemedAt = { not: null };
    where.refundedAt = null;
  }
  if (filter === "refunded") where.refundedAt = { not: null };

  const [codes, total, summary] = await Promise.all([
    prisma.appsumoCode.findMany({
      where,
      orderBy: { createdAt: "desc" },
      skip: (page - 1) * limit,
      take: limit,
    }),
    prisma.appsumoCode.count({ where }),
    prisma.appsumoCode.groupBy({
      by: ["tier"],
      _count: { _all: true },
    }),
  ]);

  return jsonSuccess({
    codes,
    total,
    page,
    limit,
    code: codeQuery || null,
    summary,
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
      summary: `Imported ${result.count} of ${cleaned.length} AppSumo codes${
        result.count < cleaned.length ? ` (${cleaned.length - result.count} already existed)` : ""
      }`,
      after: { inserted: result.count, attempted: cleaned.length, tiers },
    });
    return result.count;
  });

  return jsonSuccess({ inserted, attempted: cleaned.length });
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
    const actor = staffActorFromSession(session);
    const ip = requestIp(req);

    const outcome = await prisma.$transaction(async (tx) => {
      const row = await tx.appsumoCode.findUnique({
        where: { code },
        select: { code: true, tier: true, plan: true, seats: true, redeemedByOrg: true, redeemedAt: true, refundedAt: true },
      });
      if (!row) return { status: 404 as const };
      // Already refunded: nothing changes, so nothing is written or recorded.
      if (row.refundedAt) return { status: 200 as const, refundedAt: row.refundedAt, logged: null, company: null };

      // The company that redeemed it, when it still exists (redeemedByOrg is
      // a bare id with no relation; a deleted company leaves it dangling).
      const company = row.redeemedByOrg
        ? await tx.organization.findUnique({ where: { id: row.redeemedByOrg }, select: { id: true, name: true } })
        : null;

      const updated = await tx.appsumoCode.update({
        where: { code },
        data: { refundedAt: new Date(), notes },
        select: { refundedAt: true },
      });
      const logged = await logStaffAction({
        db: tx,
        action: "admin.code.refunded",
        actor,
        ip,
        targetCompanyId: company?.id ?? null,
        targetLabel: code,
        reason: notes,
        summary: `Marked AppSumo code ${code} (Tier ${row.tier}) refunded${
          company ? ` for ${company.name}; their plan was not changed` : row.redeemedByOrg ? "; the company that redeemed it no longer exists" : "; it was never redeemed"
        }`,
        before: { refundedAt: null, redeemedAt: row.redeemedAt, plan: row.plan, seats: row.seats },
        after: { refundedAt: updated.refundedAt, companyId: company?.id ?? null, companyName: company?.name ?? null },
      });
      return { status: 200 as const, refundedAt: updated.refundedAt, logged, company };
    });

    if (outcome.status === 404) return jsonError("Code not found", 404);
    void writeTenantRow(outcome.logged);
    return jsonSuccess({ ok: true, refundedAt: outcome.refundedAt, company: outcome.company ?? null });
  }

  return jsonError("Specify `refunded: true` to mark a code refunded");
}
