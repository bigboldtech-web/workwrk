import { NextRequest } from "next/server";
import { createHmac, timingSafeEqual } from "crypto";
import { prisma } from "@/lib/prisma";
import { dispatchEvent } from "@/services/webhookDispatcher";
import { triggerRecalculation } from "@/services/performanceScoreService";

/**
 * Generic webhook ingest — /api/integrations/ingest
 *
 * Any vendor we don't have a native connector for can POST here with a
 * pre-shared secret. Purpose: let integrators push KPI readings,
 * create tasks, or log kudos without waiting for us to build a
 * bespoke connector.
 *
 * Authentication: `X-Workwrk-Signature: sha256=<hex>` header computed
 * as HMAC-SHA256(body, secret). Secret is stored per-tenant on an
 * `Integration` row with `type=CUSTOM_WEBHOOK` and
 * `config.ingestSecret`. Caller must also send
 * `X-Workwrk-Organization: <orgId>` to identify the tenant (we don't
 * want to iterate every integration on every POST).
 *
 * Body schema:
 *   {
 *     "action": "kpi.record" | "task.create" | "kudos.give",
 *     "data": { ... }
 *   }
 */

type IngestConfig = {
  ingestSecret?: string;
  enabled?: boolean;
};

export async function POST(req: NextRequest) {
  const orgId = req.headers.get("x-workwrk-organization");
  const sig = req.headers.get("x-workwrk-signature");
  if (!orgId || !sig) {
    return Response.json(
      { error: "Missing X-Workwrk-Organization or X-Workwrk-Signature" },
      { status: 400 },
    );
  }

  const raw = await req.text();

  const integration = await prisma.integration.findFirst({
    where: {
      organizationId: orgId,
      type: "CUSTOM_WEBHOOK",
      status: "ACTIVE",
    },
    select: { id: true, config: true },
  });
  if (!integration) {
    return Response.json({ error: "No active CUSTOM_WEBHOOK integration for this org" }, { status: 404 });
  }

  const cfg = (integration.config ?? {}) as IngestConfig;
  if (cfg.enabled === false) {
    return Response.json({ error: "Integration paused" }, { status: 403 });
  }
  const secret = cfg.ingestSecret;
  if (!secret) {
    return Response.json({ error: "No ingest secret set" }, { status: 503 });
  }

  // Validate signature.
  const expectedHex = createHmac("sha256", secret).update(raw).digest("hex");
  const expected = `sha256=${expectedHex}`;
  if (expected.length !== sig.length) {
    return Response.json({ error: "Invalid signature" }, { status: 401 });
  }
  if (!timingSafeEqual(Buffer.from(expected), Buffer.from(sig))) {
    return Response.json({ error: "Invalid signature" }, { status: 401 });
  }

  type Body = {
    action?: "kpi.record" | "task.create" | "kudos.give";
    data?: Record<string, unknown>;
  };
  let body: Body;
  try {
    body = JSON.parse(raw);
  } catch {
    return Response.json({ error: "Invalid JSON" }, { status: 400 });
  }

  if (!body.action || !body.data) {
    return Response.json({ error: "action + data are required" }, { status: 400 });
  }

  try {
    switch (body.action) {
      case "kpi.record":
        return await handleKpiRecord(orgId, body.data);
      case "task.create":
        return await handleTaskCreate(orgId, body.data);
      case "kudos.give":
        return await handleKudosGive(orgId, body.data);
      default:
        return Response.json({ error: `Unknown action: ${body.action}` }, { status: 400 });
    }
  } catch (err) {
    console.error("[ingest] failed:", err);
    return Response.json({ error: "Ingest failed" }, { status: 500 });
  }
}

async function handleKpiRecord(orgId: string, data: Record<string, unknown>) {
  const { kpiId, userId, period, actualValue, targetValue } = data as {
    kpiId: string;
    userId: string;
    period: string;
    actualValue: number;
    targetValue?: number;
  };
  if (!kpiId || !userId || !period || actualValue == null) {
    return Response.json({ error: "kpiId, userId, period, actualValue required" }, { status: 400 });
  }
  const kpi = await prisma.kPI.findFirst({
    where: { id: kpiId, organizationId: orgId },
    select: { id: true, targetValue: true },
  });
  if (!kpi) return Response.json({ error: "KPI not found" }, { status: 404 });

  const target = targetValue ?? kpi.targetValue ?? 0;
  const score =
    target > 0 ? Math.min(100, Math.round((actualValue / target) * 100)) : 0;

  const record = await prisma.kPIRecord.create({
    data: {
      kpiId,
      userId,
      period,
      targetValue: target,
      actualValue,
      score,
      notes: "Via /api/integrations/ingest",
    },
    select: { id: true, score: true, actualValue: true },
  });

  triggerRecalculation(userId, orgId);
  dispatchEvent({ organizationId: orgId, event: "kpi.recorded", payload: record }).catch(() => {});
  return Response.json({ ok: true, record }, { status: 201 });
}

async function handleTaskCreate(orgId: string, data: Record<string, unknown>) {
  const { title, assigneeId, date, slaHours } = data as {
    title: string;
    assigneeId: string;
    date?: string;
    slaHours?: number;
    description?: string;
  };
  if (!title || !assigneeId) {
    return Response.json({ error: "title + assigneeId required" }, { status: 400 });
  }
  const assignee = await prisma.user.findFirst({
    where: { id: assigneeId, organizationId: orgId },
    select: { id: true },
  });
  if (!assignee) return Response.json({ error: "Assignee not in org" }, { status: 404 });

  const task = await prisma.task.create({
    data: {
      title: title.slice(0, 200),
      description: (data.description as string | undefined)?.slice(0, 2000) ?? null,
      date: date ? new Date(date) : new Date(),
      assigneeId,
      slaHours: slaHours && slaHours > 0 ? slaHours : null,
      source: "AI",
      sourceRef: "ingest",
      organizationId: orgId,
    },
    select: { id: true, title: true, date: true, slaHours: true },
  });
  dispatchEvent({ organizationId: orgId, event: "task.created", payload: task }).catch(() => {});
  return Response.json({ ok: true, task }, { status: 201 });
}

async function handleKudosGive(orgId: string, data: Record<string, unknown>) {
  const { giverId, receiverId, message, companyValue } = data as {
    giverId: string;
    receiverId: string;
    message: string;
    companyValue?: string;
  };
  if (!giverId || !receiverId || !message) {
    return Response.json({ error: "giverId, receiverId, message required" }, { status: 400 });
  }
  const kudos = await prisma.kudos.create({
    data: {
      giverId,
      receiverId,
      organizationId: orgId,
      message: message.slice(0, 500),
      companyValue: companyValue?.slice(0, 40) ?? null,
    },
    select: { id: true, message: true, createdAt: true },
  });
  triggerRecalculation(receiverId, orgId);
  dispatchEvent({ organizationId: orgId, event: "kudos.created", payload: kudos }).catch(() => {});
  return Response.json({ ok: true, kudos }, { status: 201 });
}
