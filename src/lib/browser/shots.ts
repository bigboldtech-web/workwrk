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
import { shotsDirFrom } from "./config";

/** A picture's id, as its file is named: never anything a path could climb out of. */
const SHOT_ID = /^sh[0-9a-f]{32}$/;
const FILE = /^(sh[0-9a-f]{32})\.wks(\.tmp)?$/;

/** A file no row names is deleted once it is this old (a row may still be on its way). */
const ORPHAN_AGE_MS = 60 * 60 * 1000;
/** Rows, and files, one sweep deletes at most. */
const SWEEP_MAX = 5000;
const BATCH = 500;

export function isShotId(id: unknown): id is string {
  return typeof id === "string" && SHOT_ID.test(id);
}

function fileOf(dir: string, id: string): string {
  return path.join(dir, `${id}.wks`);
}

async function unlinkQuiet(file: string): Promise<boolean> {
  try {
    await fs.unlink(file);
    return true;
  } catch {
    return false;
  }
}

function errorLine(err: unknown): string {
  return err instanceof Error ? (err.message.split("\n").pop() ?? err.message) : String(err);
}

/**
 * Seal and keep one picture of a session's page, answering its id, or null
 * when it cannot be kept: no pictures folder or key, the session's 20 used,
 * too big, not a JPEG, or a write that failed (logged by code only).
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
  try {
    await fs.mkdir(dir, { recursive: true, mode: 0o700 });
    await fs.writeFile(tmp, encryptBytes(a.jpeg), { mode: 0o600, flag: "wx" });
    await fs.rename(tmp, file);
  } catch (err) {
    await unlinkQuiet(tmp);
    console.error(`[browser] picture not written: ${err && typeof err === "object" && "code" in err ? String((err as { code: unknown }).code) : "error"}`);
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

/** Delete these pictures' files and rows (an erasure, a sweep), answering how many rows went. */
async function deleteShots(ids: readonly string[]): Promise<number> {
  if (ids.length === 0) return 0;
  const dir = shotsDirFrom();
  if (dir) for (const id of ids) if (isShotId(id)) await unlinkQuiet(fileOf(dir, id));
  const gone = await prisma.teammateBrowserShot.deleteMany({ where: { id: { in: [...ids] } } });
  return gone.count;
}

/** Every picture of these sessions, files and rows (the person's account erasure, erasure-sweep.ts). */
export async function deleteShotsOfSessions(sessionIds: readonly string[]): Promise<number> {
  if (sessionIds.length === 0) return 0;
  const rows = await prisma.teammateBrowserShot.findMany({ where: { browserSessionId: { in: [...sessionIds] } }, select: { id: true } });
  return deleteShots(rows.map((r) => r.id));
}

/**
 * The sweep's part (sessions.ts sweepBrowserSessions): expired pictures,
 * rows and files, then files no row names older than an hour, at most
 * SWEEP_MAX of each a tick.
 */
export async function sweepShots(now: Date): Promise<{ expired: number; orphans: number }> {
  let expired = 0;
  for (let i = 0; i < SWEEP_MAX / BATCH; i++) {
    const rows = await prisma.teammateBrowserShot.findMany({ where: { expiresAt: { lte: now } }, select: { id: true }, take: BATCH });
    if (rows.length === 0) break;
    expired += await deleteShots(rows.map((r) => r.id));
    if (rows.length < BATCH) break;
  }

  let orphans = 0;
  const dir = shotsDirFrom();
  if (!dir) return { expired, orphans };
  let names: string[];
  try {
    names = await fs.readdir(dir);
  } catch {
    return { expired, orphans };
  }
  const old: Array<{ id: string; name: string }> = [];
  for (const name of names) {
    if (old.length >= SWEEP_MAX) break;
    const m = FILE.exec(name);
    if (!m) continue;
    try {
      const st = await fs.stat(path.join(dir, name));
      if (now.getTime() - st.mtimeMs >= ORPHAN_AGE_MS) old.push({ id: m[1], name });
    } catch {
      /* gone meanwhile */
    }
  }
  for (let i = 0; i < old.length; i += BATCH) {
    const batch = old.slice(i, i + BATCH);
    const kept = new Set(
      (await prisma.teammateBrowserShot.findMany({ where: { id: { in: [...new Set(batch.map((b) => b.id))] } }, select: { id: true } })).map((r) => r.id),
    );
    for (const f of batch) {
      // A half-written file never has a row worth keeping it for.
      if (kept.has(f.id) && !f.name.endsWith(".tmp")) continue;
      if (await unlinkQuiet(path.join(dir, f.name))) orphans += 1;
    }
  }
  return { expired, orphans };
}
