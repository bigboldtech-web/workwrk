// This request's own session cookie, read raw, and whether a log out has
// ended it, read fresh (2026-10-22).
//
// A plain log out lists the session's id (src/lib/auth/ended-sessions.ts)
// and bumps nothing, so a copy of the logged-out cookie ends only at its
// next session check, up to five minutes on (src/lib/auth.ts). The
// tokenVersion check that the privileged writes and the AI app consent make
// (src/lib/access/workspace-admin.ts freshWorkspaceActor) never sees a plain
// log out, so they ask here too: a copy of a logged-out cookie is refused at
// once, as the bump refused it before.
//
// The cookie is read from the cookie jar alone, never from an Authorization
// header (next-auth's getToken would otherwise take a bearer token in its
// place). A cookie from before session ids carries none: it goes by the id
// its next jwt run derives (ended-sessions.ts legacySessionId).
//
// Fails closed: a lookup that fails is "ended", since a privileged write or
// a grant is never made on an unknown, except a missing table, which is
// "not listed" (isSessionEnded). A cookie that cannot be read at all (no
// request around, as in a script) decides nothing: the session the caller
// holds did not come from it.
//
// Server-only.

import { getToken } from "next-auth/jwt";
import { cookies } from "next/headers";
import { isSessionEnded, isSessionId, legacySessionId } from "./ended-sessions";

export interface SessionCookie {
  /** The account the cookie names, when it names one. */
  id: string | null;
  /** The sign-in time (ms), when the cookie carries one. */
  authAt: number | null;
  /** The cookie itself says the session ended (revoked, or a policy end). */
  ended: boolean;
  /** The session id the cookie goes by: its own, or the derived one. */
  sid: string | null;
}

/** The session id a raw token goes by, or null when it has none to agree on. Pure; tested. */
export function sessionIdOfToken(raw: { id?: unknown; sid?: unknown; authAt?: unknown }): string | null {
  if (isSessionId(raw.sid)) return raw.sid;
  return typeof raw.id === "string" && typeof raw.authAt === "number" ? legacySessionId(raw.id, raw.authAt) : null;
}

/** This request's session cookie, or null when there is none or it cannot be read. */
export async function readSessionCookie(): Promise<SessionCookie | null> {
  try {
    const jar = await cookies();
    const raw = await getToken({ req: { cookies: jar, headers: new Headers() } as never, secret: process.env.NEXTAUTH_SECRET || process.env.AUTH_SECRET });
    if (!raw) return null;
    return {
      id: typeof raw.id === "string" ? raw.id : null,
      authAt: typeof raw.authAt === "number" ? raw.authAt : null,
      ended: raw.revoked === true || raw.policyEnded === true,
      sid: sessionIdOfToken(raw),
    };
  } catch {
    return null;
  }
}

/**
 * Has `userId`'s session in this request ended, as the cookie and the list
 * of ended sessions say now? Pass `cookie` when the caller already read it.
 * A cookie naming another account is not this session's and decides
 * nothing. A lookup that fails is true (fail closed); a missing table is
 * false.
 */
export async function sessionEndedNow(userId: string, cookie?: SessionCookie | null): Promise<boolean> {
  const c = cookie === undefined ? await readSessionCookie() : cookie;
  if (!c) return false;
  if (c.id !== null && c.id !== userId) return false;
  if (c.ended) return true;
  if (!c.sid) return false;
  return isSessionEnded(c.sid).catch(() => true);
}
