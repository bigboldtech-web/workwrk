// Pictures of pages, for the session's person alone
// (docs/plans/ai-teammates-phase4.md Decisions 16 and 23). The model never
// sees one; the person sees them on cards, in show_page's answer and in the
// browser card's steps.
//
// NEVER IN THE DATABASE OR THE BACKUPS. A picture is a file in
// BROWSER_SHOTS_DIR (outside the app's folder, config.ts shotsDirFrom),
// sealed with SECRETS_ENCRYPTION_KEY (secrets-crypto.ts encryptBytes: "wks1",
// IV, tag, ciphertext), mode 0600, named by its row's id. The row
// (TeammateBrowserShot) holds its facts only: whose, how big, when it goes.
//
// KEPT 24 HOURS (SESSION_CAPS.shotHours), at most 20 a session
// (shotsPerSession), each at most 600 KB (shotMaxBytes). The sweep deletes
// expired rows and their files, then files no row names older than an hour
// (a row cascaded away with its session, a write that failed half way).
//
// THE DISK IS THE DATABASE'S TOO (review round 1 of Phase 4). No picture is
// written when the folder's disk would be left with less than the larger of
// 10 GB and a tenth of it free, nor past the deployment's budget, the bytes
// of every picture not yet expired at most BROWSER_SHOTS_MAX_BYTES (config.ts
// shotsMaxBytesFrom). Each refusal is logged by its code, and the call goes
// on without its picture (noPicture, noPictureNow).
//
// A FILE NEVER OUTLIVES ITS ROW'S DELETE UNSEEN (review round 1 of Phase 4).
// A row whose file could not be deleted, for any reason but the file being
// gone already, no folder included, is kept and made expired, so the next
// sweep tries again; the sweep deletes no row while there is no folder. The
// files are scanned in name order from where the last tick stopped, at most
// SCAN_MAX a tick, rows looked up a batch at a time while scanning, and any
// picture file older than shotHours plus an hour is deleted whatever the
// database says, so none outlives about 25 hours.
//
// READ ONLY BY ITS PERSON, in its workspace, before it expires: anyone
// else's, an Owner's included, reads as nothing.
//
// Server-only: the file system and prisma.

import { randomBytes } from "node:crypto";
import { promises as fs } from "node:fs";
import path from "node:path";
import { prisma } from "@/lib/prisma";
import { decryptBytes, encryptBytes } from "@/lib/secrets-crypto";
import { SESSION_CAPS } from "./classes";
import { GB, shotsDirFrom, shotsMaxBytesFrom } from "./config";

/** A picture's id, as its file is named: never anything a path could climb out of. */
const SHOT_ID = /^sh[0-9a-f]{32}$/;
const FILE = /^(sh[0-9a-f]{32})\.wks(\.tmp)?$/;

/** A file no row names is deleted once it is this old (a row may still be on its way). */
const ORPHAN_AGE_MS = 60 * 60 * 1000;
/** A picture file this old is deleted whatever the database says (see the header). */
export const SHOT_FILE_MAX_AGE_MS = (SESSION_CAPS.shotHours + 1) * 60 * 60 * 1000;
/** Expired rows one sweep looks at, at most. */
const SWEEP_MAX = 5000;
/** Files one sweep looks at, at most (see the header). */
export const SCAN_MAX = 20_000;
const BATCH = 500;

/** The free space a picture never takes the folder's disk below: the larger of these (see the header). */
export const SHOTS_FREE_FLOOR = { bytes: 10 * GB, share: 0.1 } as const;

/** Where the last sweep's scan of the folder stopped: the next one goes on after this name. */
let scanAfter = "";

/** Tests only: the next scan starts at the folder's first name. */
export function resetShotScanForTests(): void {
  scanAfter = "";
}

export function isShotId(id: unknown): id is string {
  return typeof id === "string" && SHOT_ID.test(id);
}

function fileOf(dir: string, id: string): string {
  return path.join(/*turbopackIgnore: true*/ dir, `${id}.wks`);
}

async function unlinkQuiet(file: string): Promise<boolean> {
  try {
    await fs.unlink(file);
    return true;
  } catch {
    return false;
  }
}

function codeOf(err: unknown): string {
  return err && typeof err === "object" && "code" in err ? String((err as { code: unknown }).code) : "error";
}

/** The file deleted, or already gone (true); false when it is still there or could not be told (see the header). */
async function unlinkGone(file: string): Promise<boolean> {
  try {
    await fs.unlink(file);
    return true;
  } catch (err) {
    return codeOf(err) === "ENOENT";
  }
}

function errorLine(err: unknown): string {
  return err instanceof Error ? (err.message.split("\n").pop() ?? err.message) : String(err);
}

/**
 * Why this picture may not be written now (see the header), or null: its
 * sealed file (`fileBytes`) would leave the folder's disk under
 * SHOTS_FREE_FLOOR, or its bytes as a row counts them (`bytes`) would take
 * the pictures not yet expired past the deployment's budget. A disk that
 * cannot be read refuses too.
 */
async function noRoomFor(dir: string, fileBytes: number, bytes: number, now: Date): Promise<"disk_low" | "disk_unknown" | "budget" | null> {
  try {
    const st = await fs.statfs(/*turbopackIgnore: true*/ dir);
    const block = Number(st.bsize);
    const free = Number(st.bavail) * block;
    const total = Number(st.blocks) * block;
    if (!Number.isFinite(free) || !Number.isFinite(total) || total <= 0) return "disk_unknown";
    if (free - fileBytes < Math.max(SHOTS_FREE_FLOOR.bytes, total * SHOTS_FREE_FLOOR.share)) return "disk_low";
  } catch {
    return "disk_unknown";
  }
  const kept = await prisma.teammateBrowserShot.aggregate({ where: { expiresAt: { gt: now } }, _sum: { bytes: true } });
  if (Number(kept._sum.bytes ?? 0) + bytes > shotsMaxBytesFrom()) return "budget";
  return null;
}

/**
 * Seal and keep one picture of a session's page, answering its id, or null
 * when it cannot be kept: no pictures folder or key, the session's 20 used,
 * too big, not a JPEG, no room on the disk or in the budget (see the
 * header), or a write that failed (logged by code only).
 */
export async function saveShot(a: {
  row: { id: string; organizationId: string; userId: string };
  kind: "page" | "element";
  jpeg: Uint8Array;
  width: number;
  height: number;
}): Promise<string | null> {
  const dir = shotsDirFrom();
  if (!dir || !process.env.SECRETS_ENCRYPTION_KEY) return null;
  const bytes = a.jpeg?.length ?? 0;
  if (bytes < 3 || bytes > SESSION_CAPS.shotMaxBytes) return null;
  if (a.jpeg[0] !== 0xff || a.jpeg[1] !== 0xd8) return null;
  const width = Math.max(1, Math.min(4000, Math.round(a.width)));
  const height = Math.max(1, Math.min(4000, Math.round(a.height)));
  try {
    const taken = await prisma.teammateBrowserShot.count({ where: { browserSessionId: a.row.id } });
    if (taken >= SESSION_CAPS.shotsPerSession) return null;
  } catch (err) {
    console.error(`[browser] picture not kept: ${errorLine(err)}`);
    return null;
  }
  const id = `sh${randomBytes(16).toString("hex")}`;
  const file = fileOf(dir, id);
  const tmp = `${file}.tmp`;
  const sealed = encryptBytes(a.jpeg);
  try {
    await fs.mkdir(/*turbopackIgnore: true*/ dir, { recursive: true, mode: 0o700 });
    const full = await noRoomFor(dir, sealed.length, bytes, new Date());
    if (full) {
      console.error(`[browser] picture not kept: ${full}`);
      return null;
    }
  } catch (err) {
    console.error(`[browser] picture not kept: ${codeOf(err)}`);
    return null;
  }
  try {
    await fs.writeFile(tmp, sealed, { mode: 0o600, flag: "wx" });
    await fs.rename(tmp, file);
  } catch (err) {
    await unlinkQuiet(tmp);
    console.error(`[browser] picture not written: ${codeOf(err)}`);
    return null;
  }
  try {
    const now = new Date();
    await prisma.teammateBrowserShot.create({
      data: {
        id,
        browserSessionId: a.row.id,
        organizationId: a.row.organizationId,
        userId: a.row.userId,
        kind: a.kind,
        width,
        height,
        bytes,
        createdAt: now,
        expiresAt: new Date(now.getTime() + SESSION_CAPS.shotHours * 60 * 60 * 1000),
      },
    });
  } catch (err) {
    await unlinkQuiet(file);
    console.error(`[browser] picture row not written: ${errorLine(err)}`);
    return null;
  }
  return id;
}

/** The picture, opened, for its own person in its own workspace before it expires; null for anyone or anything else. */
export async function readShot(id: string, viewer: { userId: string; organizationId: string }): Promise<Buffer | null> {
  if (!isShotId(id)) return null;
  const dir = shotsDirFrom();
  if (!dir) return null;
  const row = await prisma.teammateBrowserShot.findFirst({
    where: { id, userId: viewer.userId, organizationId: viewer.organizationId, expiresAt: { gt: new Date() } },
    select: { id: true },
  });
  if (!row) return null;
  try {
    return decryptBytes(await fs.readFile(fileOf(dir, id)));
  } catch {
    return null;
  }
}

/**
 * Delete these pictures' files and rows (an erasure, a sweep), answering how
 * many rows went. A row whose file could not be deleted for any reason but
 * its being gone already, no folder included, is kept and made expired (see
 * the header): it is no longer shown, and the next sweep tries again.
 */
async function deleteShots(ids: readonly string[], now = new Date()): Promise<number> {
  if (ids.length === 0) return 0;
  const dir = shotsDirFrom();
  const gone: string[] = [];
  const stuck: string[] = [];
  for (const id of ids) {
    // An id that is not a picture's names no file: its row goes.
    if (!isShotId(id)) gone.push(id);
    else if (dir && (await unlinkGone(fileOf(dir, id)))) gone.push(id);
    else stuck.push(id);
  }
  const deleted = gone.length > 0 ? (await prisma.teammateBrowserShot.deleteMany({ where: { id: { in: gone } } })).count : 0;
  if (stuck.length > 0) {
    await prisma.teammateBrowserShot.updateMany({ where: { id: { in: stuck }, expiresAt: { gt: now } }, data: { expiresAt: now } });
    console.error(`[browser] ${stuck.length} picture file(s) not deleted: ${dir ? "unlink" : "no_folder"}, kept for the next sweep`);
  }
  return deleted;
}

/** Every picture of these sessions, files and rows (the person's account erasure, erasure-sweep.ts). */
export async function deleteShotsOfSessions(sessionIds: readonly string[]): Promise<number> {
  if (sessionIds.length === 0) return 0;
  const rows = await prisma.teammateBrowserShot.findMany({ where: { browserSessionId: { in: [...sessionIds] } }, select: { id: true } });
  return deleteShots(rows.map((r) => r.id));
}

/**
 * The sweep's part (sessions.ts sweepBrowserSessions), until `deadline`
 * (its own slice of the sweep's budget): expired pictures, rows and files,
 * at most SWEEP_MAX, none while there is no folder; then the folder scanned
 * from where the last tick stopped, at most `scanMax` names (see the
 * header): a picture file past SHOT_FILE_MAX_AGE_MS deleted whatever the
 * database says, one older than an hour that no row names deleted, rows
 * looked up a batch at a time, and a half-written one older than an hour
 * deleted. `orphans` counts the files the scan deleted.
 */
export async function sweepShots(now: Date, o: { deadline?: number; scanMax?: number } = {}): Promise<{ expired: number; orphans: number }> {
  const deadline = o.deadline ?? Number.POSITIVE_INFINITY;
  const scanMax = Math.max(1, Math.floor(o.scanMax ?? SCAN_MAX));
  const dir = shotsDirFrom();
  let expired = 0;
  if (!dir) {
    // Never a row without its file deleted (see the header).
    const waiting = await prisma.teammateBrowserShot.count({ where: { expiresAt: { lte: now } } });
    if (waiting > 0) console.error(`[browser] ${waiting} expired picture(s) kept: no_folder`);
    return { expired, orphans: 0 };
  }
  // In id order from where this pass is, so rows kept for a retry never hide the rest.
  let after = "";
  for (let seen = 0; seen < SWEEP_MAX && Date.now() < deadline; ) {
    const rows = await prisma.teammateBrowserShot.findMany({ where: { expiresAt: { lte: now }, ...(after ? { id: { gt: after } } : {}) }, select: { id: true }, orderBy: { id: "asc" }, take: BATCH });
    if (rows.length === 0) break;
    expired += await deleteShots(
      rows.map((r) => r.id),
      now,
    );
    seen += rows.length;
    after = rows[rows.length - 1].id;
    if (rows.length < BATCH) break;
  }

  let orphans = 0;
  let names: string[];
  try {
    names = (await fs.readdir(/*turbopackIgnore: true*/ dir)).sort();
  } catch {
    return { expired, orphans };
  }
  // From after the last tick's stop, round to the start (see the header).
  const from = names.findIndex((n) => n > scanAfter);
  const order = from <= 0 ? names : [...names.slice(from), ...names.slice(0, from)];
  const pending: Array<{ id: string; name: string }> = [];
  const flush = async () => {
    if (pending.length === 0) return;
    const batch = pending.splice(0);
    const kept = new Set(
      (await prisma.teammateBrowserShot.findMany({ where: { id: { in: [...new Set(batch.map((b) => b.id))] } }, select: { id: true } })).map((r) => r.id),
    );
    for (const f of batch) {
      // A half-written file never has a row worth keeping it for.
      if (kept.has(f.id) && !f.name.endsWith(".tmp")) continue;
      if (await unlinkQuiet(path.join(/*turbopackIgnore: true*/ dir, f.name))) orphans += 1;
    }
  };
  let examined = 0;
  let last = scanAfter;
  for (const name of order) {
    if (examined >= scanMax || Date.now() >= deadline) break;
    examined += 1;
    last = name;
    const m = FILE.exec(name);
    if (!m) continue;
    const file = path.join(/*turbopackIgnore: true*/ dir, name);
    let age: number;
    try {
      age = now.getTime() - (await fs.stat(file)).mtimeMs;
    } catch {
      continue; // gone meanwhile
    }
    if (age >= SHOT_FILE_MAX_AGE_MS) {
      if (await unlinkQuiet(file)) orphans += 1;
    } else if (age >= ORPHAN_AGE_MS) {
      pending.push({ id: m[1], name });
      if (pending.length >= BATCH) await flush();
    }
  }
  await flush();
  // Every name looked at: the next tick starts at the first again.
  scanAfter = examined >= order.length ? "" : last;
  return { expired, orphans };
}
