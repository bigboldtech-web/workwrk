// Fresh download URLs for S3-backed FileEntry rows.
//
// Stored `url` values for S3 uploads are presigned GETs that expire in
// an hour — every read path must re-presign from the stored s3Key.
// Local-disk uploads (s3Key null) keep their stored URL, which never
// expires. Presigning is local HMAC math (no network round-trip), so
// mapping a whole listing is cheap.

import { presignGetUrlStable } from "@/lib/s3";

export async function withFreshFileUrls<T extends { url: string; s3Key?: string | null }>(rows: T[]): Promise<T[]> {
  return Promise.all(rows.map(async (row) => {
    if (!row.s3Key) return row;
    try {
      return { ...row, url: await presignGetUrlStable(row.s3Key) };
    } catch {
      // A presign failure (e.g. S3 unconfigured after a data migration)
      // must not blank the listing — the stale URL is better than none.
      return row;
    }
  }));
}

export async function withFreshFileUrl<T extends { url: string; s3Key?: string | null }>(row: T): Promise<T> {
  const [out] = await withFreshFileUrls([row]);
  return out;
}
