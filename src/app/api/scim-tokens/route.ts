// SCIM bearer-token management. POST returns the raw token EXACTLY
// ONCE — it's hashed at rest and never shown again. UI displays the
// prefix for disambiguation, full token only on the create response.

import { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import {
  getSessionOrFail,
  getOrgId,
  getUserId,
  jsonError,
  jsonSuccess,
  isOrgAdmin,
} from "@/lib/api-helpers";
import { generateScimTokenRaw } from "@/lib/scim-auth";
import { logActivity } from "@/lib/activity";

export async function GET() {
  const { error, session } = await getSessionOrFail();
  if (error) return error;
  if (!isOrgAdmin(session)) return jsonError("Forbidden", 403);

  const tokens = await prisma.scimToken.findMany({
    where: { organizationId: getOrgId(session) },
    orderBy: { createdAt: "desc" },
    select: {
      id: true,
      name: true,
      tokenPrefix: true,
      createdById: true,
      lastUsedAt: true,
      expiresAt: true,
      revokedAt: true,
      createdAt: true,
    },
  });
  return jsonSuccess(tokens);
}

export async function POST(req: NextRequest) {
  const { error, session } = await getSessionOrFail();
  if (error) return error;
  if (!isOrgAdmin(session)) return jsonError("Forbidden", 403);

  const orgId = getOrgId(session);
  const userId = getUserId(session);
  const body = await req.json();

  const name = typeof body.name === "string" ? body.name.trim() : "";
  if (!name) return jsonError("name is required");
  if (name.length > 80) return jsonError("name too long");

  const expiresAt = body.expiresAt ? new Date(body.expiresAt) : null;
  if (expiresAt && Number.isNaN(expiresAt.getTime())) return jsonError("Invalid expiresAt");

  const { raw, hash, prefix } = generateScimTokenRaw();

  const created = await prisma.scimToken.create({
    data: {
      organizationId: orgId,
      name,
      tokenHash: hash,
      tokenPrefix: prefix,
      createdById: userId,
      expiresAt,
    },
    select: {
      id: true,
      name: true,
      tokenPrefix: true,
      lastUsedAt: true,
      expiresAt: true,
      revokedAt: true,
      createdAt: true,
    },
  });

  logActivity({
    type: "scim_token_created",
    actorId: userId,
    organizationId: orgId,
    description: `Minted SCIM token "${name}"`,
    targetId: created.id,
    targetType: "scim_token",
  });

  // The raw token appears here exactly once. Client must capture it.
  return jsonSuccess({ ...created, token: raw }, 201);
}
