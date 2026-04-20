import { S3Client, GetObjectCommand, PutObjectCommand, DeleteObjectCommand } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { randomBytes } from "crypto";

/**
 * S3-compatible storage client.
 *
 * Works against any S3-compatible endpoint: Linode Object Storage,
 * Cloudflare R2, Backblaze B2, or AWS itself. Configuration is driven
 * entirely by env vars so swapping providers is a deploy-time change.
 *
 * Required env:
 *   S3_ACCESS_KEY_ID
 *   S3_SECRET_ACCESS_KEY
 *   S3_BUCKET
 *   S3_REGION        (for Linode: the cluster prefix, e.g. "in-maa-1")
 *
 * Optional env:
 *   S3_ENDPOINT      (Linode/R2/B2 need this; AWS doesn't.
 *                     Example: "https://in-maa-1.linodeobjects.com")
 *   S3_FORCE_PATH_STYLE ("true" for providers that don't support
 *                        virtual-hosted-style addressing; Linode is
 *                        fine with the default, R2 is fine, but some
 *                        compat layers need it.)
 */

let cachedClient: S3Client | null = null;

export function isS3Configured(): boolean {
  return !!(
    process.env.S3_ACCESS_KEY_ID &&
    process.env.S3_SECRET_ACCESS_KEY &&
    process.env.S3_BUCKET &&
    process.env.S3_REGION
  );
}

export function getBucket(): string {
  const b = process.env.S3_BUCKET;
  if (!b) throw new Error("S3_BUCKET env var is required");
  return b;
}

export function getS3Client(): S3Client {
  if (cachedClient) return cachedClient;
  if (!isS3Configured()) {
    throw new Error("S3 is not configured (missing S3_ACCESS_KEY_ID / S3_SECRET_ACCESS_KEY / S3_BUCKET / S3_REGION)");
  }

  cachedClient = new S3Client({
    region: process.env.S3_REGION!,
    // The endpoint setting is what makes this a Linode / R2 / B2 client.
    // When unset, the SDK defaults to AWS S3 for the configured region.
    endpoint: process.env.S3_ENDPOINT || undefined,
    forcePathStyle: process.env.S3_FORCE_PATH_STYLE === "true",
    credentials: {
      accessKeyId: process.env.S3_ACCESS_KEY_ID!,
      secretAccessKey: process.env.S3_SECRET_ACCESS_KEY!,
    },
  });
  return cachedClient;
}

/** Build an object key for a Scribe screenshot. Scoped by orgId so
 *  an org's objects can be isolated with a bucket policy later if
 *  you ever move to per-org buckets. */
export function scribeScreenshotKey(organizationId: string): string {
  const id = randomBytes(12).toString("hex");
  const today = new Date().toISOString().slice(0, 10);
  return `orgs/${organizationId}/scribe/${today}/${id}.jpg`;
}

/** Short-lived URL for uploading. The extension POSTs the binary
 *  screenshot directly here — our server never sees the bytes, which
 *  keeps serverless function memory low and upload throughput high. */
export async function presignPutUrl(params: {
  key: string;
  contentType: string;
  expiresInSeconds?: number;
  cacheControl?: string;
}): Promise<string> {
  const command = new PutObjectCommand({
    Bucket: getBucket(),
    Key: params.key,
    ContentType: params.contentType,
    CacheControl: params.cacheControl ?? "public, max-age=31536000, immutable",
  });
  return getSignedUrl(getS3Client(), command, {
    expiresIn: params.expiresInSeconds ?? 300, // 5 min default
  });
}

/** Short-lived URL for viewing. Generated per render of an SOP so
 *  the browser can fetch the screenshot directly. Presigning is the
 *  right call here (vs. public-read bucket policy) because Scribe
 *  screenshots can contain internal systems, customer data, prices. */
export async function presignGetUrl(key: string, expiresInSeconds: number = 3600): Promise<string> {
  const command = new GetObjectCommand({
    Bucket: getBucket(),
    Key: key,
  });
  return getSignedUrl(getS3Client(), command, { expiresIn: expiresInSeconds });
}

export async function deleteObject(key: string): Promise<void> {
  const command = new DeleteObjectCommand({ Bucket: getBucket(), Key: key });
  await getS3Client().send(command);
}
