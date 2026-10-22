// Ended sessions: a plain log out ends only that browser's session and every
// copy of its cookie (2026-10-22: logging out on a phone used to end the
// laptop too, and everyone sharing one login).
//
// Every token carries a session id (`sid`, 128 random bits, base64url) from
// its sign-in. A plain log out (the signOut event in src/lib/auth.ts) lists
// that id here instead of bumping the account's tokenVersion, so the
// person's other devices stay signed in and their connected AI apps stay
// connected. The five-minute revalidation looks the id up (one primary key
// read) and ends a token that is listed: the browser that logged out has no
// cookie left, and any copy of its cookie ends at its next check. Log out
// everywhere, a password change, a removal and every other bump still bump,
// unchanged.
//
// A token from before session ids gets one on its next jwt run, derived from
// its account and its sign-in time, so the browser and any copy of its
// cookie taken before then derive the SAME id: once the browser has saved
// its id (its next GET /api/auth/session), its log out ends the copy too. A
// log out from a cookie that never saved an id keeps the old rule, the bump.
//
// A row is kept until `expiresAt`: the token's sign-in time plus its absolute
// lifetime (the workspace default when the token carries none), never less
// than a day past the cookie's own life from now (a copy nobody renews dies
// by its JWT expiry before its row goes, even if an Admin lengthens the
// lifetime later), and never more than 365 days from now. The
// ratelimit-cleanup cron sweeps them in batches.
//
// Server-only (prisma). The pure parts are exported for the tests.

import { createHash, randomBytes } from "node:crypto";
import { prisma } from "@/lib/prisma";
import { NEXTAUTH_MAX_AGE_S } from "@/lib/auth/session-policy";
import { DEFAULT_SIGN_IN_POLICY } from "@/lib/settings/org-policy";

const DAY_MS = 86_400_000;
const KEEP_MAX_DAYS = 365;
const SID_PATTERN = /^[A-Za-z0-9_-]{22}$/;

/** A session id as this module makes them: 16 bytes, base64url, 22 characters. */
export function isSessionId(v: unknown): v is string {
  return typeof v === "string" && SID_PATTERN.test(v);
}

/** A fresh session id for a sign-in: 128 random bits. */
export function newSessionId(): string {
  return randomBytes(16).toString("base64url");
}

/**
 * The id a token from before session ids takes on its next jwt run. Derived
 * from the account and the sign-in time when the token has one, so every
 * copy of the same cookie agrees; random otherwise.
 */
export function legacySessionId(userId: string, authAt: unknown): string {
  if (typeof authAt !== "number" || !Number.isFinite(authAt) || authAt <= 0) return newSessionId();
  return createHash("sha256").update(`workwrk-sid:${userId}:${authAt}`).digest().subarray(0, 16).toString("base64url");
}

/** When the row for a session logged out now may go. Pure; tested. */
export function endedSessionExpiry(authAt: unknown, maxDays: unknown, now: number = Date.now()): Date {
  const days = typeof maxDays === "number" && Number.isFinite(maxDays) && maxDays > 0 ? maxDays : DEFAULT_SIGN_IN_POLICY.sessionMaxDays;
  const start = typeof authAt === "number" && Number.isFinite(authAt) && authAt > 0 && authAt <= now ? authAt : now;
  const lifetimeEnd = start + days * DAY_MS;
  const cookieFloor = now + NEXTAUTH_MAX_AGE_S * 1000 + DAY_MS;
  return new Date(Math.min(now + KEEP_MAX_DAYS * DAY_MS, Math.max(lifetimeEnd, cookieFloor)));
}

/**
 * List a session as ended. Throws when the row cannot be written (the caller
 * falls back to the bump). Two log outs of the same session at once (a
 * double click on Log out) race on the key: the one that loses finds the row
 * written, which is the same answer, so it never falls back to the bump and
 * ends every other device.
 */
export async function recordEndedSession(input: { sid: string; userId: string; authAt?: unknown; maxDays?: unknown; now?: Date }): Promise<void> {
  const now = input.now ?? new Date();
  try {
    await prisma.endedSession.upsert({
      where: { sid: input.sid },
      create: { sid: input.sid, userId: input.userId, endedAt: now, expiresAt: endedSessionExpiry(input.authAt, input.maxDays, now.getTime()) },
      update: {},
    });
  } catch (err) {
    if ((err as { code?: unknown } | null)?.code === "P2002") return;
    throw err;
  }
}

/** Is this session listed as ended? One primary key read. Throws on a failed read (the caller decides). */
export async function isSessionEnded(sid: string): Promise<boolean> {
  const row = await prisma.endedSession.findUnique({ where: { sid }, select: { sid: true } });
  return !!row;
}

export const ENDED_SESSION_SWEEP_BATCH = 5000;
const ENDED_SESSION_SWEEP_MAX_BATCHES = 20;

/** Delete the rows past their expiresAt, a batch at a time. Returns how many went. */
export async function sweepEndedSessions(now: Date = new Date(), batch: number = ENDED_SESSION_SWEEP_BATCH): Promise<number> {
  let removed = 0;
  for (let i = 0; i < ENDED_SESSION_SWEEP_MAX_BATCHES; i++) {
    const rows = await prisma.endedSession.findMany({ where: { expiresAt: { lt: now } }, select: { sid: true }, take: batch });
    if (rows.length === 0) break;
    removed += (await prisma.endedSession.deleteMany({ where: { sid: { in: rows.map((r) => r.sid) }, expiresAt: { lt: now } } })).count;
    if (rows.length < batch) break;
  }
  return removed;
}
