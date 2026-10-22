// The session at the consent page and the decision, as the DATABASE has it
// now (docs/plans/mcp-server.md Decision 5, review H1).
//
// A session is re-checked against the database only every five minutes
// (src/lib/auth.ts), so for those minutes after Sign out everywhere, a
// password change or a demotion's bump, a stolen cookie still reads as signed
// in. Consenting an app is a grant that outlives the session, so both the
// consent page and the decision ask freshWorkspaceActor
// (src/lib/access/workspace-admin.ts): removed, deactivated, a tokenVersion
// the account has moved past, or no level left in the session's workspace is
// `stale`. A session with no tokenVersion at all is stale too (a grant must
// be bound to one).
//
// A plain log out ends one session by its id, with no bump
// (src/lib/auth/ended-sessions.ts), and a copy of that cookie ends only at its
// next five-minute check. The cookie's own end and the list are read fresh
// here (src/lib/auth/session-cookie.ts sessionEndedNow, the helper
// freshWorkspaceActor shares): a copy of a logged-out cookie is stale at
// once, and a failed read of the list is stale as well, since a grant is
// never made on an unknown. A list that is not there yet (P2021) holds
// nobody: no log out can have been written to it.
//
// The raw token is read for its sign-in time (authAt) and its session id
// only, from the cookie alone: never from an Authorization header
// (next-auth's getToken would otherwise take a bearer token in its place).
//
// Server-only.

import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { freshWorkspaceActor } from "@/lib/access/workspace-admin";
import { readSessionCookie, sessionEndedNow } from "@/lib/auth/session-cookie";

export type ConsentSession =
  | { kind: "none" }
  | { kind: "stale" }
  | { kind: "ok"; userId: string; organizationId: string; email: string; tokenVersion: number; authAt: number | null };

/** Who is consenting, read fresh: none (log in), stale (log in again), or the person. */
export async function consentSession(): Promise<ConsentSession> {
  const session = await getServerSession(authOptions);
  const u = session?.user as { id?: string; organizationId?: string; email?: string | null; tokenVersion?: number } | undefined;
  if (!u?.id || !u.organizationId) return { kind: "none" };
  if (typeof u.tokenVersion !== "number") return { kind: "stale" };
  const fresh = await freshWorkspaceActor(session);
  if (!fresh.ok) return { kind: "stale" };
  const cookie = await readSessionCookie();
  if (await sessionEndedNow(u.id, cookie)) return { kind: "stale" };
  return { kind: "ok", userId: u.id, organizationId: u.organizationId, email: u.email ?? "", tokenVersion: u.tokenVersion, authAt: cookie?.authAt ?? null };
}
