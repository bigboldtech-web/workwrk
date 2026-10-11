// The workspace's role lock was not free in time (membership.ts
// lockOrgRoles, docs-found fixes batch 4). Pure, so a route, a SCIM call and
// a test can all recognise it without loading the lock's own module.

/** What a writer that could not get the role lock in time is told (503, code roles_busy). */
export const ORG_ROLES_BUSY = "Someone else is changing roles or reporting lines in this workspace right now. Try again in a moment.";

/** The role lock was not free in time, or too many writers were already waiting. Nothing was written. */
export class OrgRolesBusy extends Error {
  readonly code = "roles_busy";
  constructor() {
    super(ORG_ROLES_BUSY);
    this.name = "OrgRolesBusy";
  }
}

export function isOrgRolesBusy(e: unknown): e is OrgRolesBusy {
  return e instanceof OrgRolesBusy || (typeof e === "object" && e !== null && (e as { name?: unknown }).name === "OrgRolesBusy");
}

/** A route's answer when the role lock was busy (OrgRolesBusy), or null for any other error. */
export function rolesBusyAnswer(e: unknown): { status: 503; error: string; code: "roles_busy"; retryAfterSeconds: number } | null {
  return isOrgRolesBusy(e) ? { status: 503, error: ORG_ROLES_BUSY, code: "roles_busy", retryAfterSeconds: 2 } : null;
}
