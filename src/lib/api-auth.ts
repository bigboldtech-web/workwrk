import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "./auth";
import { prisma } from "./prisma";
import { createHash, randomBytes } from "crypto";
import type { ApiKeyScope } from "@/generated/prisma";

/**
 * API auth layer.
 *
 * Every public /api/v1/* endpoint authenticates by:
 *   1. Checking for `Authorization: Bearer <key>` header  → API key path
 *   2. Falling back to the NextAuth session cookie       → dashboard-user path
 *
 * Returns a uniform `AuthContext` so handlers don't care which path fired.
 */

export type AuthContext = {
  organizationId: string;
  userId?: string;           // null-ish for API-key access
  scopes: ApiKeyScope[];     // ["READ", "WRITE", "ADMIN"] etc.
  via: "api_key" | "session";
  apiKeyId?: string;
};

const KEY_PREFIX = "wk_live_";

/**
 * Generate a fresh API key. Returns both the plaintext (to show the
 * caller once) and the hash (to store).
 */
export function generateApiKey(): { plaintext: string; prefix: string; hash: string } {
  const random = randomBytes(24).toString("base64url");
  const plaintext = `${KEY_PREFIX}${random}`;
  const prefix = plaintext.slice(0, 12); // "wk_live_" + 4 chars
  const hash = hashKey(plaintext);
  return { plaintext, prefix, hash };
}

export function hashKey(key: string): string {
  return createHash("sha256").update(key).digest("hex");
}

/**
 * Generate a webhook secret. Similar shape to API key.
 */
export function generateWebhookSecret(): { plaintext: string; prefix: string; hash: string } {
  const random = randomBytes(32).toString("base64url");
  const plaintext = `whsec_${random}`;
  const prefix = plaintext.slice(0, 10);
  const hash = hashKey(plaintext);
  return { plaintext, prefix, hash };
}

/**
 * Authenticate a request. Call from every public API handler.
 *
 * `requiredScope`:
 *   • "READ"  — any valid key works (READ/WRITE/ADMIN all include READ)
 *   • "WRITE" — needs WRITE or ADMIN
 *   • "ADMIN" — needs ADMIN (or a dashboard admin session)
 *   • null    — authenticated but no scope check
 */
export async function authenticate(
  req: NextRequest,
  requiredScope: ApiKeyScope | null = "READ",
): Promise<{ ctx: AuthContext | null; error: NextResponse | null }> {
  const authHeader = req.headers.get("authorization");

  if (authHeader?.toLowerCase().startsWith("bearer ")) {
    const plaintext = authHeader.slice(7).trim();
    if (!plaintext.startsWith(KEY_PREFIX)) {
      return authFail("Invalid API key format");
    }
    const hash = hashKey(plaintext);
    const record = await prisma.apiKey.findUnique({
      where: { hashedKey: hash },
      select: {
        id: true,
        organizationId: true,
        scopes: true,
        revokedAt: true,
        rateLimitPerMinute: true,
        rateLimitPerDay: true,
      },
    });
    if (!record) return authFail("Invalid API key");
    if (record.revokedAt) return authFail("API key has been revoked");

    if (requiredScope && !scopesCover(record.scopes, requiredScope)) {
      return authFail(
        `This key needs "${requiredScope}" scope. It has: ${record.scopes.join(", ")}.`,
        403,
      );
    }

    // Rate limit check (DB-backed rolling counters).
    const now = new Date();
    const limitResult = await enforceRateLimit({
      apiKeyId: record.id,
      perMinute: record.rateLimitPerMinute,
      perDay: record.rateLimitPerDay,
      now,
    });
    if (!limitResult.ok) {
      return {
        ctx: null,
        error: NextResponse.json(
          { error: "Rate limit exceeded", window: limitResult.window, retryAfter: limitResult.retryAfter },
          {
            status: 429,
            headers: {
              "Retry-After": String(limitResult.retryAfter),
              "X-RateLimit-Window": limitResult.window,
            },
          },
        ),
      };
    }

    // Fire-and-forget usage update.
    prisma.apiKey
      .update({
        where: { id: record.id },
        data: {
          lastUsedAt: now,
          lastUsedIp:
            req.headers.get("x-forwarded-for")?.split(",")[0].trim() ||
            req.headers.get("x-real-ip") ||
            null,
          requestCount: { increment: 1 },
        },
      })
      .catch(() => {});

    return {
      error: null,
      ctx: {
        organizationId: record.organizationId,
        scopes: record.scopes,
        via: "api_key",
        apiKeyId: record.id,
      },
    };
  }

  // Session fallback — dashboard users testing the API from a browser.
  const session = await getServerSession(authOptions);
  if (!session?.user) {
    return authFail("Missing or invalid credentials. Send Authorization: Bearer <key>.");
  }
  const user = session.user as {
    id?: string;
    organizationId?: string;
    accessLevel?: string;
  };
  if (!user.organizationId) return authFail("Session missing organization");

  const isAdmin =
    user.accessLevel === "SUPER_ADMIN" || user.accessLevel === "COMPANY_ADMIN";
  const scopes: ApiKeyScope[] = isAdmin ? ["READ", "WRITE", "ADMIN"] : ["READ", "WRITE"];
  if (requiredScope && !scopesCover(scopes, requiredScope)) {
    return authFail(`Session user lacks "${requiredScope}" scope`, 403);
  }
  return {
    error: null,
    ctx: {
      organizationId: user.organizationId,
      userId: user.id,
      scopes,
      via: "session",
    },
  };
}

function scopesCover(have: ApiKeyScope[], need: ApiKeyScope): boolean {
  if (have.includes("ADMIN")) return true;
  if (need === "READ") return have.includes("READ") || have.includes("WRITE");
  if (need === "WRITE") return have.includes("WRITE");
  return have.includes(need);
}

function authFail(message: string, status = 401) {
  return {
    ctx: null,
    error: NextResponse.json({ error: message }, { status }),
  };
}

/**
 * Rolling-window rate limiter.
 * One bucket per (apiKey, windowKind, windowKey).
 * - minute buckets are keyed by YYYY-MM-DDTHH:MM (UTC).
 * - day buckets are keyed by YYYY-MM-DD (UTC).
 * Increments atomically via upsert. Buckets are ~1 KB each and TTL is
 * implicit via the periodic cleanup job (`/api/cron/ratelimit-cleanup`).
 */
export async function enforceRateLimit(params: {
  apiKeyId: string;
  perMinute: number;
  perDay: number;
  now: Date;
}): Promise<{ ok: true } | { ok: false; window: "MINUTE" | "DAY"; retryAfter: number }> {
  const { apiKeyId, perMinute, perDay, now } = params;

  const minuteKey = now.toISOString().slice(0, 16); // "2026-04-18T14:23"
  const dayKey = now.toISOString().slice(0, 10); // "2026-04-18"

  // Minute bucket first (tighter constraint).
  const minute = await prisma.apiKeyRateBucket.upsert({
    where: {
      apiKeyId_windowKind_windowKey: {
        apiKeyId,
        windowKind: "MINUTE",
        windowKey: minuteKey,
      },
    },
    create: { apiKeyId, windowKind: "MINUTE", windowKey: minuteKey, count: 1 },
    update: { count: { increment: 1 } },
    select: { count: true },
  });
  if (minute.count > perMinute) {
    const secs = 60 - now.getUTCSeconds();
    return { ok: false, window: "MINUTE", retryAfter: secs };
  }

  const day = await prisma.apiKeyRateBucket.upsert({
    where: {
      apiKeyId_windowKind_windowKey: {
        apiKeyId,
        windowKind: "DAY",
        windowKey: dayKey,
      },
    },
    create: { apiKeyId, windowKind: "DAY", windowKey: dayKey, count: 1 },
    update: { count: { increment: 1 } },
    select: { count: true },
  });
  if (day.count > perDay) {
    const secsUntilTomorrow =
      24 * 3600 -
      (now.getUTCHours() * 3600 +
        now.getUTCMinutes() * 60 +
        now.getUTCSeconds());
    return { ok: false, window: "DAY", retryAfter: secsUntilTomorrow };
  }

  return { ok: true };
}
