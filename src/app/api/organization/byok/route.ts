import { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import Anthropic from "@anthropic-ai/sdk";
import { getSessionOrFail, getOrgId, getUserId, isOrgAdmin, jsonError, jsonSuccess } from "@/lib/api-helpers";
import { hasFeature } from "@/lib/enterprise-features";
import { Prisma } from "@/generated/prisma";
import { encryptSecret, keyHint } from "@/lib/secrets-crypto";

/**
 * /api/organization/byok — Anthropic key management for the org.
 *
 * GET    → returns the current key hint + lastUsedAt + preferredModel,
 *          or `null` if no key is set. Key plaintext never returned.
 * PUT    → save / replace the key. Body: { apiKey, preferredModel? }.
 *          Tests it against Anthropic before saving so you know it
 *          works.
 * DELETE → revoke the key. Falls back to the WorkwrK shared key on
 *          the next AI call.
 *
 * All mutations require:
 *   · org admin role
 *   · features.byok enabled (Enterprise add-on)
 */

async function gate(orgId: string) {
  const f = await hasFeature(orgId, "byok");
  if (f.enabled) return null;
  return jsonError(
    f.reason === "not_enterprise"
      ? "BYOK requires the Enterprise plan. Contact WorkwrK to upgrade."
      : "BYOK isn't enabled for your org. Ask WorkwrK to turn it on.",
    403,
  );
}

export async function GET() {
  const { error, session } = await getSessionOrFail();
  if (error) return error;
  const orgId = getOrgId(session);
  const f = await hasFeature(orgId, "byok");
  if (!f.enabled) {
    return jsonSuccess({ enabled: false, reason: f.reason, key: null });
  }
  const row = await prisma.orgSecret.findUnique({
    where: { organizationId_provider: { organizationId: orgId, provider: "anthropic" } },
    select: {
      keyHint: true, lastUsedAt: true, preferredModel: true, createdAt: true, updatedAt: true,
    },
  });
  return jsonSuccess({ enabled: true, key: row });
}

export async function PUT(req: NextRequest) {
  const { error, session } = await getSessionOrFail();
  if (error) return error;
  if (!isOrgAdmin(session)) return jsonError("Only org admins can manage AI keys", 403);
  const orgId = getOrgId(session);
  const denied = await gate(orgId);
  if (denied) return denied;

  const body = await req.json();
  const apiKey = typeof body?.apiKey === "string" ? body.apiKey.trim() : "";
  if (!apiKey) return jsonError("apiKey is required");
  if (!apiKey.startsWith("sk-ant-")) {
    return jsonError("That doesn't look like an Anthropic key (must start with sk-ant-)");
  }
  const preferredModel = typeof body?.preferredModel === "string" ? body.preferredModel : null;

  // Test the key before saving so the customer doesn't store a dud.
  try {
    const test = new Anthropic({ apiKey });
    await test.messages.create({
      model: preferredModel || "claude-haiku-4-5-20251001",
      max_tokens: 8,
      messages: [{ role: "user", content: "ping" }],
    });
  } catch (err: any) {
    return jsonError(
      `Anthropic rejected the key: ${err?.message || "unknown error"}`,
      400,
    );
  }

  const encrypted = encryptSecret(apiKey);
  const hint = keyHint(apiKey);
  const userId = getUserId(session);

  // Cipher blob is structured JSON; cast through Prisma's input type.
  const blob = encrypted as unknown as Prisma.InputJsonValue;

  await prisma.orgSecret.upsert({
    where: { organizationId_provider: { organizationId: orgId, provider: "anthropic" } },
    update: {
      encryptedKey: blob,
      keyHint: hint,
      preferredModel: preferredModel || null,
      lastUsedAt: new Date(),
    },
    create: {
      organizationId: orgId,
      provider: "anthropic",
      encryptedKey: blob,
      keyHint: hint,
      preferredModel: preferredModel || null,
      createdById: userId,
      lastUsedAt: new Date(),
    },
  });

  return jsonSuccess({ ok: true, keyHint: hint });
}

export async function DELETE() {
  const { error, session } = await getSessionOrFail();
  if (error) return error;
  if (!isOrgAdmin(session)) return jsonError("Only org admins can revoke AI keys", 403);
  const orgId = getOrgId(session);
  const denied = await gate(orgId);
  if (denied) return denied;

  await prisma.orgSecret.deleteMany({
    where: { organizationId: orgId, provider: "anthropic" },
  });
  return jsonSuccess({ ok: true });
}
