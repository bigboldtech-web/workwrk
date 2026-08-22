-- Library expiring-links fix (Comms Hub fleet finding, 2026-08-22).
-- FileEntry stored only a presigned S3 URL, which dies after an hour.
-- The S3 object key is now stored so read paths re-presign fresh URLs.
-- Local-disk uploads keep s3Key NULL and their stored URL never expires.
-- Idempotent.

ALTER TABLE "FileEntry" ADD COLUMN IF NOT EXISTS "s3Key" TEXT;

-- Backfill: pre-existing S3 rows stored only a presigned URL. The object
-- key is the URL path (path-style or vhost-style), so it is mechanically
-- recoverable. Local-disk rows (/api/uploads/... or /uploads/...) stay null.
UPDATE "FileEntry"
SET "s3Key" = NULLIF(regexp_replace(split_part(substring("url" from '^https?://[^/]+/(.*)$'), '?', 1), '^workwrk/', ''), '')
WHERE "s3Key" IS NULL
  AND "url" ~ '^https?://'
  AND "url" LIKE '%X-Amz-%';
