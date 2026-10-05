// A stamp in an upload's stored name that proves who uploaded it, and for
// which company. Server-only.
//
// WHY. A Files row's url and key are whatever the client sent (POST
// /api/files), so a row naming a key proves nothing about the file: anyone who
// can read a file could register a copy of its key, trash the copy, and have
// the permanent delete free the original. So /api/upload writes a stamp into
// every name it gives out, an HMAC of the company, the uploader and the
// upload's own id, and Trash frees a file only when the stamp says the trashed
// row's own uploader uploaded it for that company (src/lib/trash.ts). A copy
// registered by anyone else, an older upload with no stamp, and every file
// written some other way are never freed by Trash.
//
// The names: S3 orgs/<company>/files/<day>/<id>-<stamp>.<ext>, on disk
// file-<company>-<id>-<stamp>.<ext>, where <id> is 24 hex characters and
// <stamp> 16. The key is derived from NEXTAUTH_SECRET; with none, nothing is
// stamped and Trash frees nothing.

import { createHmac, timingSafeEqual } from "crypto";

const LABEL = "workwrk upload stamp v1";

function stampKey(): Buffer | null {
  const secret = process.env.NEXTAUTH_SECRET;
  if (!secret) return null;
  return createHmac("sha256", secret).update(LABEL).digest();
}

/** The stamp for one upload, or null when the server has no secret. */
export function uploadStamp(organizationId: string, userId: string, id: string): string | null {
  const key = stampKey();
  if (!key || !organizationId || !userId || !/^[a-f0-9]{24}$/.test(id)) return null;
  return createHmac("sha256", key).update(`${organizationId}\n${userId}\n${id}`).digest("hex").slice(0, 16);
}

/** The upload id and stamp in a stored name or key, or null when it has none. */
export function stampOf(stored: string): { id: string; stamp: string } | null {
  const last = stored.split("/").pop() ?? "";
  const base = last.replace(/\.[A-Za-z0-9]+$/, "");
  const m = /(?:^|-)([a-f0-9]{24})-([a-f0-9]{16})$/.exec(base);
  return m ? { id: m[1], stamp: m[2] } : null;
}

/** Whether this person uploaded the stored file for this company. */
export function uploadedBy(organizationId: string, userId: string, stored: string): boolean {
  const parts = stampOf(stored);
  if (!parts) return false;
  const want = uploadStamp(organizationId, userId, parts.id);
  if (!want) return false;
  const a = Buffer.from(want);
  const b = Buffer.from(parts.stamp);
  return a.length === b.length && timingSafeEqual(a, b);
}
