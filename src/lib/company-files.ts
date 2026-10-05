// The files a company stored, and freeing them once it is deleted for good
// (the hard-delete cron, /api/cron/org-hard-delete). Server-only.
//
// WHY. Deleting the Organization row cascades the rows that name a
// company's uploads, but not the files: an uploaded document, a logo or a
// person's photo stayed on disk or in S3 for good, against the privacy
// policy's "then permanently delete".
//
// ONLY WHAT PROVABLY BELONGS TO IT. A FileEntry's url and key are whatever
// the client sent, so a reference proves nothing: freeing by reference would
// let anyone delete another company's file by registering a link to it and
// deleting their own workspace. So nothing is freed by reference. What is
// freed is what was stamped with the company's own id by code that knew the
// company the file was for:
//   S3       orgs/<id>/files/ (uploads, since they carry the workspace the
//            session acts in and the uploading tab belongs to, /api/upload)
//            and orgs/<id>/scribe/ (Scribe screenshots, always keyed by the
//            session's workspace)
//   on disk  file-<id>-* (uploads), logo-<id>-* (its logos, old ones too)
//            and avatar-<userId>-* for each person whose account goes with it
// Older uploads are left in place: orgs/<id>/notes/ in S3 and file-<random>
// on disk. Their key named the uploader's HOME workspace (or nothing), not
// the company the file was for, so a person working in one company while
// anchored to another stored that company's files under the other's prefix:
// sweeping it would delete a live company's files. Keeping a file too long is
// better than deleting someone else's. The cron reads the accounts that go in
// the delete's own transaction, after moving out everyone who also belongs
// to another workspace (whose photo stays with their account); free the
// files only after it commits, so a delete that rolls back loses nothing.
// Best effort, never throws.

import { deleteUpload, listUploads } from "@/lib/local-uploads";
import { deleteObjectsWithPrefix, isS3Configured } from "@/lib/s3";

export interface StoredFiles {
  /** The accounts deleted with the company (their photos go with them). */
  userIds: string[];
}

/** The S3 prefixes a company provably owns (see the header): never orgs/<id>/ as a whole. */
export function ownedS3Prefixes(organizationId: string): string[] {
  if (!organizationId || !/^[A-Za-z0-9_-]+$/.test(organizationId)) return [];
  return [`orgs/${organizationId}/files/`, `orgs/${organizationId}/scribe/`];
}

/** The disk names a company provably owns, out of a directory listing. */
export function ownedDiskNames(names: readonly string[], organizationId: string, userIds: readonly string[]): string[] {
  if (!organizationId) return [];
  const prefixes = [`file-${organizationId}-`, `logo-${organizationId}-`, ...userIds.filter(Boolean).map((u) => `avatar-${u}-`)];
  return names.filter((n) => /^[A-Za-z0-9._-]+$/.test(n) && !n.startsWith(".") && prefixes.some((p) => n.startsWith(p)));
}

/** Free a deleted company's files. Call only after its delete committed. */
export async function freeCompanyFiles(organizationId: string, stored: StoredFiles): Promise<{ local: number; s3: number }> {
  let local = 0;
  let s3 = 0;
  try {
    // Both places a local file can be (src/lib/local-uploads.ts).
    for (const name of ownedDiskNames(await listUploads(), organizationId, stored.userIds)) {
      if (await deleteUpload(name)) local += 1;
    }
    if (isS3Configured()) {
      for (const prefix of ownedS3Prefixes(organizationId)) {
        s3 += await deleteObjectsWithPrefix(prefix).catch((err) => {
          console.error(`[company-files] ${prefix}:`, err instanceof Error ? err.message : String(err));
          return 0;
        });
      }
    }
  } catch (err) {
    console.error(`[company-files] freeing ${organizationId}:`, err instanceof Error ? err.message : String(err));
  }
  return { local, s3 };
}
