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
// The raw token is read for its sign-in time (authAt) only, from the cookie
// alone: never from an Authorization header (next-auth's getToken would
// otherwise take a bearer token in its place).
//
// Server-only.

import { getServerSession } from "next-auth";
import { getToken } from "next-auth/jwt";
import { cookies } from "next/headers";
import { authOptions } from "@/lib/auth";
import { freshWorkspaceActor } from "@/lib/access/workspace-admin";

export type ConsentSession =
  | { kind: "none" }
  | { kind: "stale" }
  | { kind: "ok"; userId: string; organizationId: string; email: string; tokenVersion: number; authAt: number | null };

async function signInTime(): Promise<{ authAt: number | null; ended: boolean }> {
  try {
    const jar = await cookies();
    const raw = await getToken({ req: { cookies: jar, headers: new Headers() } as never, secret: process.env.NEXTAUTH_SECRET || process.env.AUTH_SECRET });
    if (!raw) return { authAt: null, ended: false };
    return { authAt: typeof raw.authAt === "number" ? raw.authAt : null, ended: raw.revoked === true || raw.policyEnded === true };
  } catch {
    return { authAt: null, ended: false };
  }
}

/** Who is consenting, read fresh: none (log in), stale (log in again), or the person. */
export async function consentSession(): Promise<ConsentSession> {
  const session = await getServerSession(authOptions);
  const u = session?.user as { id?: string; organizationId?: string; email?: string | null; tokenVersion?: number } | undefined;
  if (!u?.id || !u.organizationId) return { kind: "none" };
  if (typeof u.tokenVersion !== "number") return { kind: "stale" };
  const fresh = await freshWorkspaceActor(session);
  if (!fresh.ok) return { kind: "stale" };
  const clock = await signInTime();
  if (clock.ended) return { kind: "stale" };
  return { kind: "ok", userId: u.id, organizationId: u.organizationId, email: u.email ?? "", tokenVersion: u.tokenVersion, authAt: clock.authAt };
}
