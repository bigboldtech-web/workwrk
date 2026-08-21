// Meeting call rooms — derived, never stored (zero migration).
//
// Every Meeting gets a deterministic Jitsi room name and a signed guest code,
// both HMAC'd from the meeting id with the server secret so rooms are
// unguessable without a link. The guest code powers the public /meet/[code]
// page — external people and AI notetaker bots join with that URL, no
// WorkwrK account involved.

import { createHmac } from "crypto";

const SECRET = () => process.env.NEXTAUTH_SECRET || "workwrk-dev-secret";

function hmac(input: string): string {
  return createHmac("sha256", SECRET()).update(input).digest("hex");
}

/** Jitsi room name — unguessable, stable per meeting. */
export function meetingRoomName(meetingId: string): string {
  return `WorkwrK-${meetingId.slice(-6)}-${hmac(`room:${meetingId}`).slice(0, 10)}`;
}

/** Signed code for the public guest page: <meetingId>.<sig>. */
export function meetingGuestCode(meetingId: string): string {
  return `${meetingId}.${hmac(`guest:${meetingId}`).slice(0, 16)}`;
}

/** Verify a guest code; returns the meetingId or null. */
export function verifyMeetingGuestCode(code: string): string | null {
  const dot = code.lastIndexOf(".");
  if (dot <= 0) return null;
  const meetingId = code.slice(0, dot);
  const sig = code.slice(dot + 1);
  return sig === hmac(`guest:${meetingId}`).slice(0, 16) ? meetingId : null;
}

/** Direct Jitsi URL — what AI notetaker bots and link-only clients use. */
export function meetingJitsiUrl(meetingId: string): string {
  return `https://meet.jit.si/${meetingRoomName(meetingId)}`;
}
