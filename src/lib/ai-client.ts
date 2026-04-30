import Anthropic from "@anthropic-ai/sdk";
import { prisma } from "@/lib/prisma";
import { decryptSecret } from "@/lib/secrets-crypto";
import { hasFeature } from "@/lib/enterprise-features";

/**
 * One-stop Anthropic client factory. Used by every /api endpoint
 * that talks to Claude.
 *
 * Resolution order:
 *   1. If the org has BYOK enabled (Enterprise + features.byok=true)
 *      AND has saved an OrgSecret with provider="anthropic",
 *      decrypt and use that key.
 *   2. Otherwise fall back to the WorkwrK shared key from env
 *      (ANTHROPIC_API_KEY).
 *
 * Returns `{ client, source, model }` so callers can:
 *   · log which key was used (don't log the key itself!),
 *   · honour the org's preferred model when set.
 *
 * On every successful resolution we touch `lastUsedAt` so the
 * Settings UI can show "last used 5 minutes ago".
 */

interface Resolved {
  client: Anthropic;
  source: "byok" | "shared";
  preferredModel: string | null;
}

const SHARED_FALLBACK_MODEL = "claude-sonnet-4-20250514";

export async function getAnthropicForOrg(organizationId: string): Promise<Resolved> {
  const byok = await hasFeature(organizationId, "byok");

  if (byok.enabled) {
    const secret = await prisma.orgSecret.findUnique({
      where: { organizationId_provider: { organizationId, provider: "anthropic" } },
      select: { encryptedKey: true, preferredModel: true, id: true },
    });
    if (secret) {
      try {
        const apiKey = decryptSecret(secret.encryptedKey);
        // Touch lastUsedAt without blocking the request.
        prisma.orgSecret
          .update({ where: { id: secret.id }, data: { lastUsedAt: new Date() } })
          .catch(() => {});
        return {
          client: new Anthropic({ apiKey }),
          source: "byok",
          preferredModel: secret.preferredModel,
        };
      } catch (err) {
        console.error("[ai-client] BYOK key failed to decrypt — falling back to shared:", err);
        // Fall through to shared key.
      }
    }
  }

  return {
    client: new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY }),
    source: "shared",
    preferredModel: null,
  };
}

/** Convenience: pick the model to use for a given org + caller intent.
 *  Caller passes their default; we override with the org's preferred
 *  model when it's set. */
export function modelFor(resolved: Resolved, callerDefault: string = SHARED_FALLBACK_MODEL): string {
  return resolved.preferredModel || callerDefault;
}
