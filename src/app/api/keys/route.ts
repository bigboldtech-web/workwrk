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
import { generateApiKey } from "@/lib/api-auth";
import { logAuditEvent } from "@/lib/activity";
import type { ApiKeyScope } from "@/generated/prisma";

/**
 * API key management.
 *
 * GET  /api/keys        — list (plaintext never returned)
 * POST /api/keys        — create; plaintext returned ONCE in the response
 * DELETE /api/keys?id=  — revoke (soft delete via revokedAt)
 *
 * Admin-only. Keys are scoped to the admin's own organization.
 */

const VALID_SCOPES: ApiKeyScope[] = ["READ", "WRITE", "ADMIN"];

export async function GET(_req: NextRequest) {
  const { error, session } = await getSessionOrFail();
  if (error) return error;
  if (!hasRole(session, ["SUPER_ADMIN", "COMPANY_ADMIN"])) {
    return jsonError("Only admins can manage API keys", 403);
  }
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
  if (!hasRole(session, ["SUPER_ADMIN", "COMPANY_ADMIN"])) {
    return jsonError("Only admins can manage API keys", 403);
  }

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
  if (!hasRole(session, ["SUPER_ADMIN", "COMPANY_ADMIN"])) {
    return jsonError("Only admins can manage API keys", 403);
  }
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
