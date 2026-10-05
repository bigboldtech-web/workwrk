// Where the files the app keeps on its own disk live: workspace logos,
// avatars, and uploads made while object storage is unset or failing.
//
// OUTSIDE public/, on purpose. Next serves public/ by itself, by file
// extension, from what is there when the server starts, and it looks a file
// up by the DECODED path while every header rule and rewrite matches the
// path as sent. So /uploads%2F<name>.svg reached public/uploads/<name>.svg
// with none of the uploads route's protections (its sandbox, its downloads),
// and an uploaded SVG or HTML file opened as a page of the app. Under
// storage/uploads nothing serves them but the uploads route
// (src/app/api/uploads/[filename]/route.ts).
//
// Files written before the move are in public/uploads: the route reads both
// places, every delete covers both, and moveLegacyUploads (once per server
// start, src/instrumentation.ts) moves them across, never overwriting.
import { copyFile, constants, link, mkdir, readdir, readFile, stat, unlink } from "fs/promises";
import path from "path";

export const UPLOADS_DIR = path.join(process.cwd(), "storage", "uploads");
export const LEGACY_UPLOADS_DIR = path.join(process.cwd(), "public", "uploads");
const BOTH = [UPLOADS_DIR, LEGACY_UPLOADS_DIR];

/** A stored file's name: one path segment, no hidden file. */
export function isUploadName(name: string): boolean {
  return /^[A-Za-z0-9._-]+$/.test(name) && !name.startsWith(".");
}

/** The directory new files are written to, created when missing. */
export async function uploadsDirForWrite(): Promise<string> {
  await mkdir(UPLOADS_DIR, { recursive: true });
  return UPLOADS_DIR;
}

/** A stored file's bytes: storage/uploads, or public/uploads for one not moved yet. */
export async function readUpload(name: string): Promise<Buffer | null> {
  if (!isUploadName(name)) return null;
  for (const dir of BOTH) {
    try {
      return await readFile(path.join(dir, name));
    } catch {
      // Not in this one.
    }
  }
  return null;
}

/** Delete a stored file wherever it is. True when a copy was removed. */
export async function deleteUpload(name: string): Promise<boolean> {
  if (!isUploadName(name)) return false;
  let removed = false;
  for (const dir of BOTH) {
    if (await unlink(path.join(dir, name)).then(() => true, () => false)) removed = true;
  }
  return removed;
}

/** Every stored file's name, from both places, once each. */
export async function listUploads(): Promise<string[]> {
  const names = new Set<string>();
  for (const dir of BOTH) {
    for (const n of await readdir(dir).catch(() => [] as string[])) if (isUploadName(n)) names.add(n);
  }
  return [...names];
}

/**
 * Move every file in public/uploads to storage/uploads. Never overwrites: the
 * new name is created only where none exists (a hard link, or an exclusive
 * copy across disks), and the old name is removed only once the new one holds
 * the same bytes. A file it cannot move is left where it is and counted.
 */
export async function moveLegacyUploads(): Promise<{ moved: number; left: number }> {
  const names = await readdir(LEGACY_UPLOADS_DIR).catch(() => [] as string[]);
  if (names.length === 0) return { moved: 0, left: 0 };
  await mkdir(UPLOADS_DIR, { recursive: true });
  let moved = 0;
  let left = 0;
  for (const name of names) {
    const from = path.join(LEGACY_UPLOADS_DIR, name);
    const to = path.join(UPLOADS_DIR, name);
    try {
      if (!isUploadName(name) || !(await stat(from)).isFile()) {
        left += 1;
        continue;
      }
      await link(from, to).catch(async (err: NodeJS.ErrnoException) => {
        if (err.code === "EEXIST") return;
        if (err.code !== "EXDEV") throw err;
        await copyFile(from, to, constants.COPYFILE_EXCL);
      });
      // Already there (an earlier move, or a link made but not finished):
      // the old copy goes only when the two hold the same bytes.
      const [a, b] = await Promise.all([readFile(from), readFile(to)]);
      if (!a.equals(b)) {
        left += 1;
        continue;
      }
      await unlink(from);
      moved += 1;
    } catch {
      left += 1;
    }
  }
  return { moved, left };
}
