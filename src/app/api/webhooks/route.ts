import { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import {
  getSessionOrFail,
  getOrgId,
  getUserId,
  hasRole,
  jsonError,
  jsonSuccess,
} from "@/lib/api-helpers";
import { generateWebhookSecret } from "@/lib/api-auth";

/**
 * Webhook subscription management (admin-only).
 *
 * GET    /api/webhooks   — list subscriptions + recent delivery summary
 * POST   /api/webhooks   — create; plaintext secret shown ONCE
 * DELETE /api/webhooks?id=  — delete (also deletes delivery history)
 */

const VALID_EVENTS = [
  "*",
  "kudos.created",
  "kpi.recorded",
  "review.created",
  "review.completed",
  "task.created",
  "task.escalated",
  "task.completed",
  "sop.published",
  "sop.updated",
  "okr.created",
  "okr.updated",
];

export async function GET(_req: NextRequest) {
  const { error, session } = await getSessionOrFail();
  if (error) return error;
  if (!hasRole(session, ["SUPER_ADMIN", "COMPANY_ADMIN"])) {
    return jsonError("Only admins can manage webhooks", 403);
  }
  const orgId = getOrgId(session);
  const subs = await prisma.webhookSubscription.findMany({
    where: { organizationId: orgId },
    orderBy: { createdAt: "desc" },
    select: {
      id: true,
      url: true,
      events: true,
      status: true,
      secretPrefix: true,
      failureCount: true,
      lastSuccessAt: true,
      lastFailureAt: true,
      createdAt: true,
      _count: { select: { deliveries: true } },
    },
  });
  return jsonSuccess({ data: subs, validEvents: VALID_EVENTS });
}

export async function POST(req: NextRequest) {
  const { error, session } = await getSessionOrFail();
  if (error) return error;
  if (!hasRole(session, ["SUPER_ADMIN", "COMPANY_ADMIN"])) {
    return jsonError("Only admins can manage webhooks", 403);
  }
  const orgId = getOrgId(session);
  const userId = getUserId(session);
  const body = (await req.json().catch(() => ({}))) as {
    url?: string;
    events?: string[];
  };

  if (!body.url || !/^https?:\/\//i.test(body.url)) {
    return jsonError("A valid https URL is required");
  }
  const events =
    body.events && body.events.length > 0
      ? body.events.filter((e) => VALID_EVENTS.includes(e))
      : ["*"];
  if (events.length === 0) return jsonError("Pick at least one valid event");

  const { plaintext, prefix, hash } = generateWebhookSecret();
  const row = await prisma.webhookSubscription.create({
    data: {
      url: body.url.trim(),
      events,
      secretHash: hash,
      secretPrefix: prefix,
      organizationId: orgId,
      createdById: userId,
    },
    select: {
      id: true,
      url: true,
      events: true,
      status: true,
      secretPrefix: true,
      createdAt: true,
    },
  });

  return jsonSuccess({
    ...row,
    secret: plaintext,
    message:
      "This is the only time we'll show the webhook signing secret. Store it now — you'll use it to verify the X-Workwrk-Signature header on every delivery.",
  });
}

export async function DELETE(req: NextRequest) {
  const { error, session } = await getSessionOrFail();
  if (error) return error;
  if (!hasRole(session, ["SUPER_ADMIN", "COMPANY_ADMIN"])) {
    return jsonError("Only admins can manage webhooks", 403);
  }
  const url = new URL(req.url);
  const id = url.searchParams.get("id");
  if (!id) return jsonError("id required");

  const orgId = getOrgId(session);
  const sub = await prisma.webhookSubscription.findFirst({
    where: { id, organizationId: orgId },
    select: { id: true },
  });
  if (!sub) return jsonError("Subscription not found", 404);

  await prisma.webhookSubscription.delete({ where: { id } });
  return jsonSuccess({ deleted: true });
}
