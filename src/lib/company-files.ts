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
// freed is what the company's own id is written into:
//   S3       everything under orgs/<id>/ (every upload route writes there)
//   on disk  file-<id>-* (uploads), logo-<id>-* (its logos, old ones too)
//            and avatar-<userId>-* for each person whose account goes with it
// A disk upload from before names carried the id (file-<random>) cannot be
// traced to any company and is left in place: keeping a file too long is
// better than deleting someone else's. Read the people before the delete
// (they go with it); free the files only after it commits, so a delete that
// rolls back loses nothing. Best effort, never throws.

import path from "path";
import { readdir, unlink } from "fs/promises";
import { prisma } from "@/lib/prisma";
import { deleteObjectsWithPrefix, isS3Configured } from "@/lib/s3";

export interface StoredFiles {
  /** The accounts whose home is this company (their photos go with them). */
  userIds: string[];
}

/** Read while the company's rows still exist. */
export async function companyStoredFiles(organizationId: string): Promise<StoredFiles> {
  const users = await prisma.user.findMany({ where: { organizationId }, select: { id: true } });
  return { userIds: users.map((u) => u.id) };
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
    const dir = path.join(process.cwd(), "public", "uploads");
    const names = await readdir(dir).catch(() => [] as string[]);
    for (const name of ownedDiskNames(names, organizationId, stored.userIds)) {
      const ok = await unlink(path.join(dir, name)).then(() => true, () => false);
      if (ok) local += 1;
    }
    if (isS3Configured()) s3 += await deleteObjectsWithPrefix(`orgs/${organizationId}/`).catch(() => 0);
  } catch (err) {
    console.error(`[company-files] freeing ${organizationId}:`, err instanceof Error ? err.message : String(err));
  }
  return { local, s3 };
}
