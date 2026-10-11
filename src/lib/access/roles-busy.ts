// The answer every route gives when the workspace's role lock was busy
// (membership.ts lockOrgRoles, OrgRolesBusy): 503 with code roles_busy, the
// plain sentence, and Retry-After, never a timeout's bare 500. Nothing was
// written, so trying again is always safe.

import { NextResponse } from "next/server";
import { rolesBusyAnswer } from "./org-roles-busy";

/** The 503 for an OrgRolesBusy, or null for any other error (the caller rethrows it). */
export function rolesBusyResponse(e: unknown): NextResponse | null {
  const busy = rolesBusyAnswer(e);
  if (!busy) return null;
  return NextResponse.json(
    { error: busy.error, code: busy.code },
    { status: busy.status, headers: { "Retry-After": String(busy.retryAfterSeconds) } },
  );
}

/**
 * For `.catch()` on a role-locked transaction: the 503 for an OrgRolesBusy,
 * and any other error thrown on, as it was.
 */
export function rolesBusyOrThrow(e: unknown): NextResponse {
  const busy = rolesBusyResponse(e);
  if (busy) return busy;
  throw e;
}
