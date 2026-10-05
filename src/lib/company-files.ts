// The files a company stored, and freeing them once the company is deleted
// for good (the hard-delete cron, /api/cron/org-hard-delete, and
// scripts/purge-deleted-workspace-orphans.ts). Server-only.
//
// WHY. Deleting the Organization row cascades the FileEntry rows that name a
// company's uploads, and the cron deletes its Trash rows (whose file
// snapshots name trashed uploads), but neither removes the file itself: an
// uploaded document stayed on disk or in S3 for good, the most sensitive
// workspace data there is, against the privacy policy's "then permanently
// delete". Read the references BEFORE the delete (they go with it), free the
// files only AFTER it commits (a delete that rolls back must not lose them).
//
// WHAT IS FREED:
//   S3        everything under the company's own prefix, orgs/<id>/ (every
//             upload route writes there), plus any key a FileEntry named
//             outside that prefix
//   on disk   each /api/uploads/<name> file a FileEntry or a Trash snapshot
//             named
// A file another FileEntry still names (any company's) is kept: nothing that
// still points at a file loses it. Best effort, never throws.

import path from "path";
import { unlink } from "fs/promises";
import { prisma } from "@/lib/prisma";
import { BLOB_TRASH_TYPES } from "@/lib/trash";
import { deleteObject, deleteObjectsWithPrefix, isS3Configured } from "@/lib/s3";

export interface StoredFiles {
  /** File names under public/uploads (from /api/uploads/<name> URLs). */
  localNames: string[];
  /** S3 keys named directly (FileEntry.s3Key, or the path of an https URL). */
  s3Keys: string[];
}

function addUrl(url: unknown, into: { local: Set<string>; keys: Set<string> }): void {
  if (typeof url !== "string" || !url) return;
  if (url.startsWith("/api/uploads/")) {
    const name = url.split("/").pop();
    // A plain file name only: never a path that climbs out of uploads.
    if (name && /^[A-Za-z0-9._-]+$/.test(name) && !name.startsWith(".")) into.local.add(name);
    return;
  }
  if (/^https?:\/\//.test(url)) {
    try {
      const key = new URL(url).pathname.replace(/^\/+/, "");
      if (key) into.keys.add(key);
    } catch {
      // not a URL
    }
  }
}

/** What a company stored, read while its rows still exist. */
export async function companyStoredFiles(organizationId: string): Promise<StoredFiles> {
  const found = { local: new Set<string>(), keys: new Set<string>() };
  const files = await prisma.fileEntry.findMany({ where: { organizationId }, select: { url: true, s3Key: true } });
  for (const f of files) {
    if (f.s3Key) found.keys.add(f.s3Key);
    addUrl(f.url, found);
  }
  const trashed = await prisma.trashItem.findMany({
    where: { organizationId, entityType: { in: [...BLOB_TRASH_TYPES] } },
    select: { entityType: true, snapshot: true },
  });
  for (const t of trashed) {
    const snap = t.snapshot as { row?: { url?: unknown; s3Key?: unknown }; children?: { files?: { url?: unknown; s3Key?: unknown }[] } } | null;
    if (t.entityType === "file") {
      addUrl(snap?.row?.url, found);
      if (typeof snap?.row?.s3Key === "string" && snap.row.s3Key) found.keys.add(snap.row.s3Key);
    } else {
      for (const f of snap?.children?.files ?? []) {
        addUrl(f?.url, found);
        if (typeof f?.s3Key === "string" && f.s3Key) found.keys.add(f.s3Key);
      }
    }
  }
  return { localNames: [...found.local], s3Keys: [...found.keys] };
}

/** Free a deleted company's files. Call only after its delete committed. */
export async function freeCompanyFiles(organizationId: string, stored: StoredFiles): Promise<{ local: number; s3: number }> {
  let local = 0;
  let s3 = 0;
  try {
    // Kept: anything a FileEntry still names (another company's).
    const stillNamed = new Set<string>();
    const urls = stored.localNames.map((n) => `/api/uploads/${n}`);
    for (let i = 0; i < urls.length; i += 500) {
      const rows = await prisma.fileEntry.findMany({ where: { url: { in: urls.slice(i, i + 500) } }, select: { url: true } });
      for (const r of rows) stillNamed.add(r.url);
    }
    for (let i = 0; i < stored.s3Keys.length; i += 500) {
      const rows = await prisma.fileEntry.findMany({ where: { s3Key: { in: stored.s3Keys.slice(i, i + 500) } }, select: { s3Key: true } });
      for (const r of rows) if (r.s3Key) stillNamed.add(r.s3Key);
    }

    for (const name of stored.localNames) {
      if (stillNamed.has(`/api/uploads/${name}`)) continue;
      const ok = await unlink(path.join(process.cwd(), "public", "uploads", name)).then(() => true, () => false);
      if (ok) local += 1;
    }

    if (isS3Configured()) {
      const prefix = `orgs/${organizationId}/`;
      s3 += await deleteObjectsWithPrefix(prefix).catch(() => 0);
      for (const key of stored.s3Keys) {
        if (key.startsWith(prefix) || stillNamed.has(key)) continue;
        const ok = await deleteObject(key).then(() => true, () => false);
        if (ok) s3 += 1;
      }
    }
  } catch (err) {
    console.error(`[company-files] freeing ${organizationId}:`, err instanceof Error ? err.message : String(err));
  }
  return { local, s3 };
}
