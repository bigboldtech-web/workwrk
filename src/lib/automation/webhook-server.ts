// The Webhook connection's reads and writes (spec-ai-automation
// /automation/connections). One IntegrationConnection row per workspace with
// provider WEBHOOK; everything lives in its metadataJson (webhook.ts), so
// there is no migration. Every write is audited, best effort.

import type { Prisma } from "@/generated/prisma";
import { prisma } from "@/lib/prisma";
import { logActivity } from "@/lib/activity";
import { deliverWebhook, generateSecret, publicWebhookMeta, readWebhookMeta, type Delivery, type WebhookMeta } from "./webhook";

export interface WebhookView {
  status: "CONNECTED" | "DISCONNECTED" | "EXPIRED" | "ERROR";
  errorMessage: string | null;
  url: string | null;
  secretHint: string | null;
  secretCreatedAt: string | null;
  lastDeliveryAt: string | null;
  lastDeliveryStatus: number | null;
  updatedAt: string | null;
}

export async function loadWebhook(orgId: string): Promise<{ meta: WebhookMeta; status: WebhookView["status"]; errorMessage: string | null; updatedAt: Date | null } | null> {
  const row = await prisma.integrationConnection.findUnique({
    where: { organizationId_provider: { organizationId: orgId, provider: "WEBHOOK" } },
    select: { status: true, metadataJson: true, errorMessage: true, updatedAt: true },
  });
  if (!row) return null;
  return { meta: readWebhookMeta(row.metadataJson), status: row.status as WebhookView["status"], errorMessage: row.errorMessage, updatedAt: row.updatedAt };
}

/** What the page may show: never the secret, only its last four characters. */
export function webhookView(row: Awaited<ReturnType<typeof loadWebhook>>): WebhookView {
  if (!row) {
    return { status: "DISCONNECTED", errorMessage: null, url: null, secretHint: null, secretCreatedAt: null, lastDeliveryAt: null, lastDeliveryStatus: null, updatedAt: null };
  }
  const pub = publicWebhookMeta(row.meta);
  return {
    status: row.status,
    errorMessage: row.errorMessage,
    url: pub.url,
    // A disconnected row keeps its address (so reconnecting is one click) but
    // never a secret.
    secretHint: row.status === "CONNECTED" ? pub.secretHint : null,
    secretCreatedAt: row.status === "CONNECTED" ? pub.secretCreatedAt : null,
    lastDeliveryAt: pub.lastDeliveryAt,
    lastDeliveryStatus: pub.lastDeliveryStatus,
    updatedAt: row.updatedAt ? row.updatedAt.toISOString() : null,
  };
}

async function writeMeta(orgId: string, userId: string, meta: WebhookMeta, status: "CONNECTED" | "DISCONNECTED" | "ERROR", errorMessage: string | null = null) {
  const metadataJson = meta as unknown as Prisma.InputJsonObject;
  await prisma.integrationConnection.upsert({
    where: { organizationId_provider: { organizationId: orgId, provider: "WEBHOOK" } },
    create: { organizationId: orgId, provider: "WEBHOOK", status, connectedByUserId: userId, metadataJson, errorMessage },
    update: { status, connectedByUserId: userId, metadataJson, errorMessage },
  });
}

async function audit(orgId: string, actorId: string, type: string, description: string) {
  try {
    await logActivity({
      type,
      actorId,
      organizationId: orgId,
      description,
      targetType: "integration",
      targetId: "WEBHOOK",
      metadata: { actorType: "person", provider: "WEBHOOK" },
    });
  } catch {
    /* best effort */
  }
}

/**
 * Connect, or point the connection at a new address. The first connect (or a
 * reconnect after Disconnect) mints a signing secret and returns it, once;
 * changing the address of a live connection keeps the secret it has.
 */
export async function saveWebhookUrl(orgId: string, userId: string, url: string): Promise<{ secret: string | null }> {
  const current = await loadWebhook(orgId);
  const keep = current && current.status === "CONNECTED" && current.meta.secret ? current.meta.secret : null;
  const secret = keep ?? generateSecret();
  await writeMeta(orgId, userId, {
    url,
    secret,
    secretCreatedAt: keep ? current!.meta.secretCreatedAt : new Date().toISOString(),
    lastDeliveryAt: current?.meta.lastDeliveryAt ?? null,
    lastDeliveryStatus: current?.meta.lastDeliveryStatus ?? null,
  }, "CONNECTED");
  await audit(orgId, userId, keep ? "webhook_updated" : "webhook_connected", keep ? "changed the automation webhook address" : "connected the automation webhook");
  return { secret: keep ? null : secret };
}

export async function rotateWebhookSecret(orgId: string, userId: string): Promise<{ secret: string } | null> {
  const current = await loadWebhook(orgId);
  if (!current || current.status !== "CONNECTED" || !current.meta.url) return null;
  const secret = generateSecret();
  await writeMeta(orgId, userId, { ...current.meta, secret, secretCreatedAt: new Date().toISOString() }, "CONNECTED");
  await audit(orgId, userId, "webhook_secret_rotated", "rotated the automation webhook signing secret");
  return { secret };
}

/**
 * Disconnect: the address is kept for an easy reconnect, the secret is
 * dropped. False when there is nothing connected (no row, or one already
 * disconnected), so the route can answer 404 as it documents.
 */
export async function disconnectWebhook(orgId: string, userId: string): Promise<boolean> {
  const current = await loadWebhook(orgId);
  if (!current || current.status !== "CONNECTED") return false;
  await writeMeta(orgId, userId, { ...current.meta, secret: null, secretCreatedAt: null }, "DISCONNECTED");
  await audit(orgId, userId, "webhook_disconnected", "disconnected the automation webhook");
  return true;
}

/**
 * Record how the last delivery went, so the card can say so. Best effort.
 * It MERGES only its two keys into the stored JSON in one statement, never a
 * read-then-write of the whole object, so a delivery that finishes while an
 * Admin rotates the secret or disconnects can never put the old secret back.
 */
export async function noteDelivery(orgId: string, delivery: Delivery): Promise<void> {
  try {
    const patch = JSON.stringify({ lastDeliveryAt: new Date().toISOString(), lastDeliveryStatus: delivery.httpStatus });
    await prisma.$executeRaw`
      UPDATE "IntegrationConnection"
      SET "metadataJson" = COALESCE("metadataJson", '{}'::jsonb) || ${patch}::jsonb
      WHERE "organizationId" = ${orgId} AND "provider"::text = 'WEBHOOK'`;
  } catch {
    /* best effort */
  }
}

/** Send one delivery through the live connection. Throws when there is none. */
export async function sendThroughWebhook(orgId: string, event: string, body: unknown, deliveryId?: string): Promise<Delivery> {
  const current = await loadWebhook(orgId);
  if (!current || current.status !== "CONNECTED" || !current.meta.url || !current.meta.secret) {
    throw new Error("The webhook is not connected. An Owner or Admin can connect it under Automation, Connections.");
  }
  const delivery = await deliverWebhook({ url: current.meta.url, secret: current.meta.secret, event, body, deliveryId });
  await noteDelivery(orgId, delivery);
  return delivery;
}
