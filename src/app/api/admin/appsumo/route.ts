import { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSessionOrFail, hasRole, jsonError, jsonSuccess } from "@/lib/api-helpers";
import type { Plan } from "@/generated/prisma";

/**
 * /api/admin/appsumo — WorkwrK staff endpoints for AppSumo code
 * management. SUPER_ADMIN only.
 *
 * GET    → list of codes with redemption status (paginated)
 * POST   → bulk import. Body: { codes: [{code, tier, plan, seats}] }
 * PATCH  → flip a code to refunded. Body: { code, refunded: true }
 */

const VALID_PLANS = new Set(["STARTER", "GROWTH", "SCALE", "ENTERPRISE"] as const);

export async function GET(req: NextRequest) {
  const { error, session } = await getSessionOrFail();
  if (error) return error;
  if (!hasRole(session, ["SUPER_ADMIN"])) return jsonError("Forbidden", 403);

  const url = new URL(req.url);
  const filter = url.searchParams.get("filter") ?? "all"; // all / unused / redeemed / refunded
  const page = parseInt(url.searchParams.get("page") || "1", 10);
  const limit = Math.min(parseInt(url.searchParams.get("limit") || "100", 10), 500);

  const where: any = {};
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
    summary,
  });
}

export async function POST(req: NextRequest) {
  const { error, session } = await getSessionOrFail();
  if (error) return error;
  if (!hasRole(session, ["SUPER_ADMIN"])) return jsonError("Forbidden", 403);

  const body = await req.json();
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
    if (!VALID_PLANS.has(plan as any)) return jsonError(`Invalid plan "${plan}" for code ${code}`);
    if (!Number.isFinite(seats) || seats < 1) return jsonError(`Invalid seats "${seats}" for code ${code}`);
    cleaned.push({ code, tier, plan: plan as Plan, seats });
  }

  // Skip duplicates rather than 409-ing the whole batch — re-imports
  // are common when AppSumo re-sends the CSV.
  const result = await prisma.appsumoCode.createMany({
    data: cleaned,
    skipDuplicates: true,
  });

  return jsonSuccess({ inserted: result.count, attempted: cleaned.length });
}

export async function PATCH(req: NextRequest) {
  const { error, session } = await getSessionOrFail();
  if (error) return error;
  if (!hasRole(session, ["SUPER_ADMIN"])) return jsonError("Forbidden", 403);

  const body = await req.json();
  const code = typeof body?.code === "string" ? body.code.trim() : "";
  if (!code) return jsonError("`code` is required");

  if (body?.refunded === true) {
    const updated = await prisma.appsumoCode.update({
      where: { code },
      data: { refundedAt: new Date(), notes: body?.notes ?? null },
    }).catch(() => null);
    if (!updated) return jsonError("Code not found", 404);
    return jsonSuccess({ ok: true, refundedAt: updated.refundedAt });
  }

  return jsonError("Specify `refunded: true` to mark a code refunded");
}
