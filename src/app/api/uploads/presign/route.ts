import { NextRequest } from "next/server";
import { getSessionOrFail, getOrgId, jsonError, jsonSuccess } from "@/lib/api-helpers";
import { isS3Configured, presignPutUrl, scribeScreenshotKey } from "@/lib/s3";

/**
 * Issues a short-lived presigned PUT URL so the Scribe Chrome extension
 * can upload screenshots directly to S3-compatible storage without
 * proxying bytes through this server.
 *
 * Request body:
 *   { kind: "scribe_screenshot", contentType: string }
 *
 * Response:
 *   { uploadUrl, key }   — PUT the raw bytes to `uploadUrl`; send `key`
 *                          back in the /api/sops/record payload.
 *
 * Security:
 *   · Caller must be an authenticated WorkwrK user (cookie or API key).
 *   · The key is server-generated and scoped to the caller's org, so
 *     the client can't overwrite someone else's objects.
 *   · Only image/jpeg / image/png are accepted — keeps the bucket
 *     from becoming a generic file store.
 *   · URL expires in 5 min, way longer than any legitimate upload
 *     but short enough that leaking a URL doesn't matter for long.
 */
const ALLOWED_CONTENT_TYPES = new Set(["image/jpeg", "image/png"]);
const MAX_UPLOADS_PER_MIN = 120;

// Very lightweight in-memory rate limit. Every serverless instance
// has its own counter — fine for a bot shield, not a DoS defense.
// Real abuse should be blocked upstream.
const rateBucket = new Map<string, { count: number; resetAt: number }>();

function checkRateLimit(userId: string): boolean {
  const now = Date.now();
  const bucket = rateBucket.get(userId);
  if (!bucket || bucket.resetAt < now) {
    rateBucket.set(userId, { count: 1, resetAt: now + 60_000 });
    return true;
  }
  if (bucket.count >= MAX_UPLOADS_PER_MIN) return false;
  bucket.count++;
  return true;
}

export async function POST(req: NextRequest) {
  const { error, session } = await getSessionOrFail();
  if (error) return error;

  if (!isS3Configured()) {
    return jsonError(
      "Upload storage is not configured on this deployment (missing S3_* env vars).",
      501,
    );
  }

  const userId = (session.user as any).id as string;
  const orgId = getOrgId(session);

  if (!checkRateLimit(userId)) {
    return jsonError("Too many uploads. Wait a minute and try again.", 429);
  }

  const body = await req.json().catch(() => ({}));
  const kind = body?.kind;
  const contentType = body?.contentType;

  if (kind !== "scribe_screenshot") return jsonError("Unsupported upload kind");
  if (typeof contentType !== "string" || !ALLOWED_CONTENT_TYPES.has(contentType)) {
    return jsonError("Only image/jpeg and image/png uploads are accepted");
  }

  const key = scribeScreenshotKey(orgId);
  const uploadUrl = await presignPutUrl({ key, contentType });

  return jsonSuccess({ uploadUrl, key });
}
