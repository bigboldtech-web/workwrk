import { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import {
  getSessionOrFail,
  getOrgId,
  getUserId,
  jsonError,
  jsonSuccess,
} from "@/lib/api-helpers";
import { generateApiKey } from "@/lib/api-auth";
import { logAuditEvent } from "@/lib/activity";
import type { ApiKeyScope } from "@/generated/prisma";
import { settingsWriteGate } from "@/lib/access/settings-write";

/**
 * API key management.
 *
 * GET  /api/keys        — list (plaintext never returned)
 * POST /api/keys        — create; plaintext returned ONCE in the response
 * PATCH /api/keys       { id, rateLimitPerMinute?, rateLimitPerDay? }: the
 *                         two limits are the only thing that changes after
 *                         a key is made (its scopes never do)
 * DELETE /api/keys?id=  — revoke (soft delete via revokedAt)
 *
 * Owner page (API & webhooks; every Admin until the Owner and Admin split). Keys are scoped to the admin's own organization.
 */

const VALID_SCOPES: ApiKeyScope[] = ["READ", "WRITE", "ADMIN"];

export async function GET(_req: NextRequest) {
  const { error, session } = await getSessionOrFail();
  if (error) return error;
  const writeGate = await settingsWriteGate(session, "api");
  if (!writeGate.ok) return writeGate.response;
  const orgId = getOrgId(session);
  const keys = await prisma.apiKey.findMany({
    where: { organizationId: orgId },
    select: {
      id: true,
      name: true,
      prefix: true,
      scopes: true,
      rateLimitPerMinute: true,
      rateLimitPerDay: true,
      lastUsedAt: true,
      lastUsedIp: true,
      requestCount: true,
      revokedAt: true,
      createdAt: true,
      createdBy: { select: { firstName: true, lastName: true } },
    },
    orderBy: { createdAt: "desc" },
  });
  return jsonSuccess({ data: keys });
}

export async function POST(req: NextRequest) {
  const { error, session } = await getSessionOrFail();
  if (error) return error;
  const writeGate = await settingsWriteGate(session, "api");
  if (!writeGate.ok) return writeGate.response;

  const orgId = getOrgId(session);
  const userId = getUserId(session);
  const body = (await req.json().catch(() => ({}))) as {
    name?: string;
    scopes?: ApiKeyScope[];
    rateLimitPerMinute?: number;
    rateLimitPerDay?: number;
  };

  if (!body.name?.trim()) return jsonError("A key name is required (e.g. 'Production · Backend')");

  const scopes: ApiKeyScope[] =
    body.scopes && body.scopes.length > 0
      ? body.scopes.filter((s) => VALID_SCOPES.includes(s))
      : ["READ"];

  const { plaintext, prefix, hash } = generateApiKey();

  const row = await prisma.apiKey.create({
    data: {
      name: body.name.trim().slice(0, 80),
      prefix,
      hashedKey: hash,
      scopes,
      rateLimitPerMinute: Math.min(Math.max(body.rateLimitPerMinute ?? 120, 1), 10000),
      rateLimitPerDay: Math.min(Math.max(body.rateLimitPerDay ?? 50000, 1), 10_000_000),
      organizationId: orgId,
      createdById: userId,
    },
    select: {
      id: true,
      name: true,
      prefix: true,
      scopes: true,
      rateLimitPerMinute: true,
      rateLimitPerDay: true,
      createdAt: true,
    },
  });

  logAuditEvent({
    type: "api_key_created",
    actorId: userId,
    organizationId: orgId,
    description: `Minted API key "${row.name}" (prefix ${row.prefix}) with scopes [${row.scopes.join(", ")}]`,
    targetId: row.id,
    targetType: "api_key",
    metadata: { name: row.name, prefix: row.prefix, scopes: row.scopes },
    severity: row.scopes.includes("ADMIN") ? "critical" : "warning",
  });

  return jsonSuccess({
    ...row,
    // Plaintext is shown EXACTLY ONCE. Client should display and
    // instruct user to store it immediately.
    plaintext,
    message:
      "This is the only time we'll show the full key. Copy it now and store it in a secret manager.",
  });
}

export async function DELETE(req: NextRequest) {
  const { error, session } = await getSessionOrFail();
  if (error) return error;
  const writeGate = await settingsWriteGate(session, "api");
  if (!writeGate.ok) return writeGate.response;
  const url = new URL(req.url);
  const id = url.searchParams.get("id");
  if (!id) return jsonError("id required");

  const orgId = getOrgId(session);
  const key = await prisma.apiKey.findFirst({
    where: { id, organizationId: orgId },
    select: { id: true, name: true, prefix: true, scopes: true, revokedAt: true },
  });
  if (!key) return jsonError("Key not found", 404);
  if (key.revokedAt) return jsonError("Key already revoked");

  await prisma.apiKey.update({
    where: { id },
    data: { revokedAt: new Date() },
  });

  logAuditEvent({
    type: "api_key_revoked",
    actorId: getUserId(session),
    organizationId: orgId,
    description: `Revoked API key "${key.name}" (prefix ${key.prefix})`,
    targetId: id,
    targetType: "api_key",
    metadata: { name: key.name, prefix: key.prefix, scopes: key.scopes },
    severity: "critical",
  });

  return jsonSuccess({ revoked: true });
}

export async function PATCH(req: NextRequest) {
  const { error, session } = await getSessionOrFail();
  if (error) return error;
  const writeGate = await settingsWriteGate(session, "api");
  if (!writeGate.ok) return writeGate.response;
  const body = (await req.json().catch(() => null)) as { id?: unknown; rateLimitPerMinute?: unknown; rateLimitPerDay?: unknown } | null;
  const id = typeof body?.id === "string" ? body.id : "";
  if (!id) return jsonError("id required");
  const allowed = new Set(["id", "rateLimitPerMinute", "rateLimitPerDay"]);
  const extra = Object.keys(body ?? {}).filter((k) => !allowed.has(k));
  if (extra.length) return jsonError(`Unknown key: ${extra.join(", ")}`);
  const perMin = body?.rateLimitPerMinute;
  const perDay = body?.rateLimitPerDay;
  const data: { rateLimitPerMinute?: number; rateLimitPerDay?: number } = {};
  if (perMin !== undefined) {
    if (typeof perMin !== "number" || !Number.isInteger(perMin) || perMin < 1 || perMin > 10000) return jsonError("rateLimitPerMinute: 1 to 10000");
    data.rateLimitPerMinute = perMin;
  }
  if (perDay !== undefined) {
    if (typeof perDay !== "number" || !Number.isInteger(perDay) || perDay < 1 || perDay > 10_000_000) return jsonError("rateLimitPerDay: 1 to 10000000");
    data.rateLimitPerDay = perDay;
  }
  const orgId = getOrgId(session);
  const key = await prisma.apiKey.findFirst({ where: { id, organizationId: orgId }, select: { id: true, name: true, prefix: true, revokedAt: true, rateLimitPerMinute: true, rateLimitPerDay: true } });
  if (!key) return jsonError("Key not found", 404);
  if (key.revokedAt) return jsonError("A revoked key cannot change");
  const updated = await prisma.apiKey.update({ where: { id }, data, select: { id: true, rateLimitPerMinute: true, rateLimitPerDay: true } });
  logAuditEvent({
    type: "api_key_updated",
    actorId: getUserId(session),
    organizationId: orgId,
    description: `Changed the rate limits of API key "${key.name}" (prefix ${key.prefix})`,
    targetId: id,
    targetType: "api_key",
    oldValue: { rateLimitPerMinute: key.rateLimitPerMinute, rateLimitPerDay: key.rateLimitPerDay },
    newValue: { rateLimitPerMinute: updated.rateLimitPerMinute, rateLimitPerDay: updated.rateLimitPerDay },
  });
  return jsonSuccess({ data: updated });
}
