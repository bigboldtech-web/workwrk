import { NextRequest } from "next/server";
import { createHmac, timingSafeEqual } from "crypto";
import { prisma } from "@/lib/prisma";

/**
 * POST /api/integrations/razorpay/webhook
 *
 * Razorpay webhook receiver. Supports two modes:
 *
 *   1. Payment events (payment.authorized, payment.captured, etc.)
 *      — logged into Integration.syncLogs as an audit trail.
 *   2. KPI-push events — any Razorpay event carrying a custom
 *      `kpi_mapping` in notes gets forwarded to our own KPI recording
 *      service. This lets Razorpay double as a KPI data source for
 *      GMV, payout counts, refund rates, etc.
 *
 * Setup: In the Razorpay dashboard, add a webhook pointing here. The
 * admin stores the webhook secret in Integration.config.secret
 * (type=CUSTOM_WEBHOOK or a dedicated row). This endpoint validates
 * the X-Razorpay-Signature header against every active Razorpay
 * integration on the platform and accepts the first match.
 */

type RazorpayConfig = {
  webhookSecret?: string;
  kpiMap?: Record<string, { kpiId: string; userId: string; valueField?: string }>;
};

type RazorpayEventPayload = Record<string, unknown>;

export async function POST(req: NextRequest) {
  const sig = req.headers.get("x-razorpay-signature");
  if (!sig) return Response.json({ error: "missing signature" }, { status: 400 });

  const raw = await req.text();

  // We iterate active Razorpay integrations until one validates the
  // signature. Each tenant stores their own secret in config.webhookSecret.
  const candidates = await prisma.integration.findMany({
    where: { status: "ACTIVE" },
    select: { id: true, organizationId: true, config: true, type: true, name: true },
  });

  let matched: { id: string; organizationId: string; config: RazorpayConfig } | null = null;
  for (const c of candidates) {
    if (c.name.toLowerCase() !== "razorpay") continue;
    const cfg = (c.config ?? {}) as RazorpayConfig;
    const secret = cfg.webhookSecret;
    if (!secret) continue;
    const expected = createHmac("sha256", secret).update(raw).digest("hex");
    if (expected.length !== sig.length) continue;
    if (timingSafeEqual(Buffer.from(expected), Buffer.from(sig))) {
      matched = { id: c.id, organizationId: c.organizationId, config: cfg };
      break;
    }
  }

  if (!matched) return Response.json({ error: "invalid signature" }, { status: 401 });

  let event: { event?: string; payload?: RazorpayEventPayload };
  try {
    event = JSON.parse(raw);
  } catch {
    return Response.json({ error: "invalid JSON" }, { status: 400 });
  }

  // Audit the delivery.
  await prisma.webhookLog
    .create({
      data: {
        integrationId: matched.id,
        direction: "incoming",
        event: event.event ?? "unknown",
        payload: event as unknown as object,
        status: "received",
      },
    })
    .catch(() => {});

  // Optionally forward a Razorpay event to our KPI recorder when the
  // tenant has set up a kpiMap entry. Common mapping shape:
  //   { "payment.captured": { kpiId, userId, valueField: "payment.entity.amount" } }
  const map = matched.config.kpiMap;
  if (map && event.event && map[event.event]) {
    const rule = map[event.event];
    const value = pickNumeric(event.payload, rule.valueField ?? "payment.entity.amount");
    if (typeof value === "number" && rule.kpiId && rule.userId) {
      // Best-effort; failure never breaks the webhook.
      await recordKpiReading({
        organizationId: matched.organizationId,
        kpiId: rule.kpiId,
        userId: rule.userId,
        actualValue: value,
      }).catch(() => {});
    }
  }

  return Response.json({ ok: true });
}

function pickNumeric(obj: unknown, path: string): number | null {
  const parts = path.split(".");
  let cur: unknown = obj;
  for (const p of parts) {
    if (cur && typeof cur === "object" && p in (cur as Record<string, unknown>)) {
      cur = (cur as Record<string, unknown>)[p];
    } else return null;
  }
  if (typeof cur === "number") return cur;
  if (typeof cur === "string" && !isNaN(Number(cur))) return Number(cur);
  return null;
}

async function recordKpiReading(params: {
  organizationId: string;
  kpiId: string;
  userId: string;
  actualValue: number;
}) {
  const kpi = await prisma.kPI.findFirst({
    where: { id: params.kpiId, organizationId: params.organizationId },
    select: { id: true, targetValue: true },
  });
  if (!kpi) return;

  const period = new Date().toISOString().slice(0, 7); // "2026-04"
  const target = kpi.targetValue ?? 0;
  const score = target > 0 ? Math.min(100, Math.round((params.actualValue / target) * 100)) : 0;

  await prisma.kPIRecord.create({
    data: {
      kpiId: params.kpiId,
      userId: params.userId,
      period,
      targetValue: target,
      actualValue: params.actualValue,
      score,
      notes: "Ingested via Razorpay webhook",
    },
  });
}
