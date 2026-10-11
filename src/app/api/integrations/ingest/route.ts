import { NextRequest } from "next/server";
import { createHmac, timingSafeEqual } from "crypto";
import { prisma } from "@/lib/prisma";
import { dispatchEvent } from "@/services/webhookDispatcher";
import { createPersonalTask } from "@/lib/work/personal-task";
import { kudosAftermath } from "@/lib/kudos-give";
import { recordIntegrationKpi } from "@/lib/kpi-integration.server";
import { API_DATE_RULE, parseApiDate, parseSlaHours } from "@/lib/api-input";

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
  // The same rule as POST /api/v1/kpi-records (src/lib/kpi-integration.ts):
  // a month key, one reading per KPI, person and month, and the person in
  // this workspace. This action used to write a reading for any user id it
  // was sent, and answered 500 on a second reading for the same month.
  const answer = await recordIntegrationKpi(orgId, { ...data, notes: undefined, evidence: undefined }, { notes: "Via /api/integrations/ingest" });
  if ("record" in answer) {
    const { id, score, actualValue } = answer.record;
    return Response.json({ ok: true, record: { id, score, actualValue } }, { status: answer.status });
  }
  if (answer.status === 409) return Response.json({ error: answer.error, code: answer.code, id: answer.id }, { status: 409 });
  return Response.json({ error: answer.error }, { status: answer.status });
}

async function handleTaskCreate(orgId: string, data: Record<string, unknown>) {
  const { title, assigneeId } = data as {
    title: string;
    assigneeId: string;
    description?: string;
  };
  if (!title || !assigneeId) {
    return Response.json({ error: "title + assigneeId required" }, { status: 400 });
  }
  // As POST /api/v1/tasks reads them (src/lib/api-input.ts): a bad date used
  // to fail inside the create and answer "Ingest failed".
  const due = parseApiDate(data.date);
  if (!due.ok) return Response.json({ error: `date ${API_DATE_RULE}` }, { status: 400 });
  const sla = parseSlaHours(data.slaHours);
  if (!sla.ok) return Response.json({ error: "slaHours must be a number of hours" }, { status: 400 });
  const assignee = await prisma.user.findFirst({
    where: { id: assigneeId, organizationId: orgId },
    select: { id: true },
  });
  if (!assignee) return Response.json({ error: "Assignee not in org" }, { status: 404 });

  // Phase 2 W4. This wrote the legacy `Task` table, whose UI is deleted in this
  // release, so an ingested task was content with no surface. It lands on the
  // assignee's Personal list now. The response keys are unchanged, so an
  // integration reading `task.id` / `task.date` / `task.slaHours` still works;
  // `task.id` is now an Item id, which is the id that opens at /item/<id>.
  const created = await createPersonalTask({
    organizationId: orgId,
    assigneeId,
    title: title.slice(0, 200),
    description: (data.description as string | undefined)?.slice(0, 2000) ?? null,
    dueAt: due.value ?? new Date(),
    legacy: {
      source: "AI",
      sourceRef: "ingest",
      slaHours: sla.value,
    },
    actorId: null,
  });
  const task = { id: created.id, title: created.title, date: created.dueAt, slaHours: sla.value };
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
  if (giverId === receiverId) return Response.json({ error: "Cannot give kudos to yourself" }, { status: 400 });
  // Both people must be in this workspace and not removed from it: an id
  // from another workspace never lands on this one's kudos wall.
  const [giver, receiver] = await Promise.all([
    prisma.user.findFirst({ where: { id: giverId, organizationId: orgId, deletedAt: null }, select: { id: true, firstName: true, lastName: true } }),
    prisma.user.findFirst({ where: { id: receiverId, organizationId: orgId, deletedAt: null }, select: { id: true, firstName: true, lastName: true, email: true } }),
  ]);
  if (!giver || !receiver) return Response.json({ error: "User not found" }, { status: 404 });
  const created = await prisma.kudos.create({
    data: {
      giverId,
      receiverId,
      organizationId: orgId,
      message: message.slice(0, 500),
      companyValue: companyValue?.slice(0, 40) ?? null,
    },
    select: { id: true, message: true, companyValue: true, giverId: true, receiverId: true, createdAt: true },
  });
  // Everything a kudos does (told, emailed, logged, scored, Slack, "kudos.created").
  void kudosAftermath({ organizationId: orgId, kudos: created, giver, receiver }).catch(() => {});
  const kudos = { id: created.id, message: created.message, createdAt: created.createdAt };
  return Response.json({ ok: true, kudos }, { status: 201 });
}
