// Meeting call rooms: derived, never stored (zero migration).
//
// Every Meeting gets a deterministic Jitsi room name and a signed guest code,
// both HMAC'd from the meeting id with the server secret so rooms are
// unguessable without a link. The guest code powers the public /meet/[code]
// page, and external people and AI notetaker bots join with that URL, no
// WorkwrK account involved.

import { createHmac } from "crypto";

const SECRET = () => process.env.NEXTAUTH_SECRET || "workwrk-dev-secret";

function hmac(input: string): string {
  return createHmac("sha256", SECRET()).update(input).digest("hex");
}

/**
 * Codes minted before guest-link expiry shipped carry no `exp` segment. They
 * stay valid for a 7-day grace so nobody's in-flight invitation breaks on
 * deploy day, and stop resolving after it. The grace is a DATE, not a
 * duration from first use, so it cannot be extended by holding on to a link.
 */
export const LEGACY_GUEST_CODE_GRACE_UNTIL = Date.parse("2026-09-29T00:00:00.000Z");

/** Jitsi room name: unguessable, stable per meeting. */
export function meetingRoomName(meetingId: string): string {
  return `WorkwrK-${meetingId.slice(-6)}-${hmac(`room:${meetingId}`).slice(0, 10)}`;
}

/**
 * MEETING GUEST CODES EXPIRE TOO (spec-talk.md section 2.5 Data, comms #25).
 *
 * The old shape was `<meetingId>.<sig>`, an HMAC of the id and nothing else,
 * valid for ever. Deleting the meeting was the ONLY revocation there was: a
 * link forwarded out of an email thread in March still opened the room in
 * December, and the route's "24 hours after scheduledAt" check lived at the
 * call site rather than in the code, so anything that forgot to apply it
 * handed out a permanent key.
 *
 * The new shape is `m.<meetingId>.<exp>.<sig>`, where `exp` is epoch millis
 * baked into the signature, so it cannot be edited and cannot be forgotten.
 * The "m." prefix is what lets the two kinds be told apart without guessing:
 * a chat code starts "c.", a meeting code starts "m.", and anything else is
 * a pre-Phase-4 meeting code inside its grace.
 */
export const MEETING_GUEST_CODE_TTL_MS = 24 * 3600_000;

export interface MeetingGuestCode {
  meetingId: string;
  /** Epoch millis, or null for a pre-expiry code inside its grace. */
  expiresAt: number | null;
}

/**
 * Signed code for the public guest page: `m.<meetingId>.<exp>.<sig>`.
 *
 * `expiresAt` is the meeting's scheduled END plus 24 hours when the caller
 * knows the schedule, and 24 hours from mint when it does not. Re-reading the
 * meeting mints a FRESH code, so a link copied on the morning of a
 * rescheduled meeting still lands: the expiry travels with the copy, not with
 * the meeting.
 */
export function meetingGuestCode(meetingId: string, expiresAt = Date.now() + MEETING_GUEST_CODE_TTL_MS): string {
  const exp = Math.floor(expiresAt);
  return `m.${meetingId}.${exp}.${hmac(`mguest:${meetingId}:${exp}`).slice(0, 16)}`;
}

/** The expiry for a meeting whose schedule we know: its end plus 24 hours. */
export function meetingGuestExpiry(scheduledAt: Date | string | null, durationMinutes = 60): number {
  if (!scheduledAt) return Date.now() + MEETING_GUEST_CODE_TTL_MS;
  const start = typeof scheduledAt === "string" ? Date.parse(scheduledAt) : scheduledAt.getTime();
  if (!Number.isFinite(start)) return Date.now() + MEETING_GUEST_CODE_TTL_MS;
  return start + durationMinutes * 60_000 + MEETING_GUEST_CODE_TTL_MS;
}

/**
 * Verify a meeting guest code. Returns its payload, or null on a bad
 * signature, a bad shape, or a legacy code whose 7-day grace has run out.
 *
 * The caller must ALSO compare `expiresAt` against the clock and answer 410
 * rather than 404 when it has passed: the link was real and it is over, which
 * is a different thing from a tampered one.
 */
export function verifyMeetingGuestCode(code: string, now = Date.now()): MeetingGuestCode | null {
  if (code.startsWith("m.")) {
    const parts = code.slice(2).split(".");
    if (parts.length !== 3) return null;
    const [meetingId, expRaw, sig] = parts;
    const exp = Number(expRaw);
    if (!meetingId || !Number.isInteger(exp) || exp <= 0) return null;
    if (sig !== hmac(`mguest:${meetingId}:${exp}`).slice(0, 16)) return null;
    return { meetingId, expiresAt: exp };
  }

  // The pre-expiry shape, `<meetingId>.<sig>`, inside its grace only.
  if (now > LEGACY_GUEST_CODE_GRACE_UNTIL) return null;
  const dot = code.lastIndexOf(".");
  if (dot <= 0) return null;
  const meetingId = code.slice(0, dot);
  const sig = code.slice(dot + 1);
  if (sig !== hmac(`guest:${meetingId}`).slice(0, 16)) return null;
  return { meetingId, expiresAt: null };
}

// meetingJitsiUrl() is GONE (Phase 4, decision Q1). It built
// https://meet.jit.si/<room> and was handed to clients as `call.jitsiUrl`,
// which made a public third-party room an advertised part of the meeting's
// API surface. A notetaker bot or a link-only client joins through the
// signed guest door (`call.guestUrl`, /meet/<code>) like every other
// outside participant, and that door answers honestly when this deployment
// has no media server rather than routing anyone off the product.

/**
 * GUEST LINKS EXPIRE (spec-talk section 2.5 Data, comms #25).
 *
 * A chat guest link used to be a permanent HMAC: copied once into an email
 * thread, it let a stranger into that conversation's calls for as long as
 * the conversation existed, and the only revocation was Reset guest link
 * (which bumps `callEpoch`) or a member leaving. Now the expiry is signed
 * into the code itself, so a copied link goes dead on its own.
 *
 * Codes minted before this shipped have no `exp` segment. They stay valid
 * for a 7-day grace so nobody's in-flight invitation breaks on deploy day,
 * and stop resolving after it. The grace is a date, not a duration from
 * first use, so it cannot be extended by holding on to a link.
 */
export const CHAT_GUEST_CODE_TTL_MS = 24 * 3600_000;

export interface ChatGuestCode {
  conversationId: string;
  epoch: number;
  /** Epoch millis, or null for a pre-expiry code inside its grace. */
  expiresAt: number | null;
}

/** Signed guest code for a chat call: "c.<conversationId>.<epoch>.<exp>.<sig>".
 *  Epoch is baked in, so a member leaving (which bumps callEpoch) kills
 *  every previously shared guest link for that conversation; `exp` kills it
 *  on its own 24 hours later even if nobody leaves. */
export function chatGuestCode(conversationId: string, epoch: number, expiresAt = Date.now() + CHAT_GUEST_CODE_TTL_MS): string {
  const exp = Math.floor(expiresAt);
  return `c.${conversationId}.${epoch}.${exp}.${hmac(`chatguest:${conversationId}:${epoch}:${exp}`).slice(0, 16)}`;
}

/** Verify a chat guest code; returns its payload or null on a bad signature,
 *  a bad shape, or a legacy code whose grace has run out.
 *
 *  The caller must ALSO check `epoch` against the live conversation (a stale
 *  epoch means the link was rotated away) and `expiresAt` against the clock
 *  (past it is a 410, not a 404: the link was real, it is over). */
export function verifyChatGuestCode(code: string, now = Date.now()): ChatGuestCode | null {
  if (!code.startsWith("c.")) return null;
  const parts = code.slice(2).split(".");

  if (parts.length === 4) {
    const [conversationId, epochRaw, expRaw, sig] = parts;
    const epoch = Number(epochRaw);
    const exp = Number(expRaw);
    if (!conversationId || !Number.isInteger(epoch) || epoch < 0) return null;
    if (!Number.isInteger(exp) || exp <= 0) return null;
    if (sig !== hmac(`chatguest:${conversationId}:${epoch}:${exp}`).slice(0, 16)) return null;
    return { conversationId, epoch, expiresAt: exp };
  }

  // The pre-expiry shape, inside its grace only.
  if (parts.length === 3) {
    if (now > LEGACY_GUEST_CODE_GRACE_UNTIL) return null;
    const [conversationId, epochRaw, sig] = parts;
    const epoch = Number(epochRaw);
    if (!conversationId || !Number.isInteger(epoch) || epoch < 0) return null;
    if (sig !== hmac(`chatguest:${conversationId}:${epoch}`).slice(0, 16)) return null;
    return { conversationId, epoch, expiresAt: null };
  }

  return null;
}

/** Is this code past its own expiry? A legacy code (null) never is: its
 *  limit is the grace date, which `verifyChatGuestCode` already applied.
 *  The clock is read here rather than at the call sites so a server page can
 *  ask the question without reading the clock inside its own render. */
export function guestCodeExpired(expiresAt: number | null, now = Date.now()): boolean {
  return expiresAt !== null && now > expiresAt;
}

/** Jitsi room for a chat conversation's calls. Same derivation
 *  scheme as meetings, distinct namespace so the two never collide. The
 *  epoch (bumped when a member leaves) rotates the room so ex-members'
 *  captured room names stop working. */
export function chatRoomName(conversationId: string, epoch = 0): string {
  return `WorkwrK-hud-${conversationId.slice(-6)}-${hmac(`chat:${conversationId}:${epoch}`).slice(0, 10)}`;
}
