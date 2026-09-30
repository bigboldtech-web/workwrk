// The login-flow enrolment ticket (spec-account-auth `/login` step 2b).
//
// When the org requires two step verification for this person's role and
// they are not enrolled, `authorize` refuses with MFA_ENROL_REQUIRED and a
// ticket instead of a session: the person proved their password seconds ago,
// and the ticket lets exactly that person, for ten minutes, fetch a secret
// and turn two step verification on from the login card, WITHOUT a session.
// It never signs anyone in: after enrolling, the login form submits email,
// password and a live code through the normal `authorize`, so the lockout,
// the timing equaliser and the MFA check all run as before.
//
// The ticket is an HMAC over (userId, tokenVersion, expiry) with the
// NextAuth secret. It dies when:
//   - it expires (10 minutes);
//   - the person's tokenVersion moves (Log out everywhere, a password reset
//     or a staff suspension all bump it);
//   - the person is enrolled (the route refuses an enrolled account, so a
//     replayed ticket cannot replace a live secret).
// Pure apart from node:crypto; tested.

import { createHmac, timingSafeEqual } from "node:crypto";

import { MFA_ENROL_REQUIRED } from "./mfa-enrol-error";

export { MFA_ENROL_REQUIRED, ticketFromLoginError } from "./mfa-enrol-error";
export const ENROL_TICKET_TTL_MS = 10 * 60 * 1000;

function secret(): string {
  return process.env.NEXTAUTH_SECRET || process.env.AUTH_SECRET || "";
}

function sign(userId: string, tokenVersion: number, exp: number, key: string): string {
  return createHmac("sha256", key).update(`mfa-enrol:${userId}:${tokenVersion}:${exp}`).digest("base64url");
}

/** `${userId}.${exp}.${sig}`, or null when no secret is configured (never a guessable ticket). */
export function issueEnrolTicket(userId: string, tokenVersion: number, now: number = Date.now(), key: string = secret()): string | null {
  if (!key) return null;
  const exp = now + ENROL_TICKET_TTL_MS;
  return `${userId}.${exp}.${sign(userId, tokenVersion, exp, key)}`;
}

/** The user id the ticket names, before any check (to load the row it must be checked against). */
export function enrolTicketUserId(ticket: unknown): string | null {
  if (typeof ticket !== "string" || ticket.length > 512) return null;
  const parts = ticket.split(".");
  if (parts.length !== 3 || !parts[0]) return null;
  return parts[0];
}

export function verifyEnrolTicket(
  ticket: unknown,
  current: { userId: string; tokenVersion: number },
  now: number = Date.now(),
  key: string = secret(),
): boolean {
  if (typeof ticket !== "string" || !key) return false;
  const parts = ticket.split(".");
  if (parts.length !== 3) return false;
  const [userId, expRaw, sig] = parts;
  if (userId !== current.userId) return false;
  const exp = Number(expRaw);
  if (!Number.isFinite(exp) || exp <= now || exp > now + ENROL_TICKET_TTL_MS) return false;
  const expected = Buffer.from(sign(userId, current.tokenVersion, exp, key));
  const given = Buffer.from(sig);
  return expected.length === given.length && timingSafeEqual(expected, given);
}

/** The login error string: "MFA_ENROL_REQUIRED:<ticket>". */
export function enrolRequiredError(ticket: string): string {
  return `${MFA_ENROL_REQUIRED}:${ticket}`;
}
