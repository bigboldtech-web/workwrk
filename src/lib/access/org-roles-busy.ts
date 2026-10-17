// The workspace's role lock was not free in time (membership.ts
// lockOrgRoles, docs-found fixes batch 4), or its seat lock (seats.ts
// lockWorkspaceSeats, batch 5). Pure, so a route, a SCIM call and a test can
// all recognise it without loading the locks' own modules.

/** What a writer that could not get the role lock in time is told (503, code roles_busy). */
export const ORG_ROLES_BUSY = "Someone else is changing roles or reporting lines in this workspace right now. Try again in a moment.";

/** What a writer that could not get the seat lock in time is told (the same 503, code roles_busy). */
export const SEATS_BUSY = "Someone else is adding people or changing seats in this workspace right now. Try again in a moment.";

/**
 * How long a writer waits for a workspace lock (the role lock, and the seat
 * lock after it) before it answers busy: well inside the transaction's own
 * timeout, so a waiter gets a plain 503 and never a timeout's 500.
 */
export const LOCK_WAIT_MS = 3_000;

/**
 * The interactive transaction's options for one that takes the role lock and
 * then the seat lock: both waits (LOCK_WAIT_MS each) and its few reads and
 * writes fit inside it. Prisma's default of 5 seconds did not, so a second
 * wait ran into the timeout's 500 while the role lock was still held.
 */
export const LOCKED_TX = { timeout: 10_000 } as const;

/** The role lock was not free in time, or too many writers were already waiting. Nothing was written. */
export class OrgRolesBusy extends Error {
  readonly code = "roles_busy";
  constructor(message: string = ORG_ROLES_BUSY) {
    super(message);
    this.name = "OrgRolesBusy";
  }
}

/** The seat lock was not free in time (an import, an invitation or a plan change holds it). Nothing was written. */
export class SeatsBusy extends OrgRolesBusy {
  constructor() {
    super(SEATS_BUSY);
    this.name = "SeatsBusy";
  }
}

export function isOrgRolesBusy(e: unknown): e is OrgRolesBusy {
  if (e instanceof OrgRolesBusy) return true;
  const name = typeof e === "object" && e !== null ? (e as { name?: unknown }).name : undefined;
  return name === "OrgRolesBusy" || name === "SeatsBusy";
}

/** A route's answer when a workspace lock was busy (OrgRolesBusy or SeatsBusy), or null for any other error. */
export function rolesBusyAnswer(e: unknown): { status: 503; error: string; code: "roles_busy"; retryAfterSeconds: number } | null {
  if (!isOrgRolesBusy(e)) return null;
  const seats = (e as { name?: unknown }).name === "SeatsBusy";
  return { status: 503, error: seats ? SEATS_BUSY : ORG_ROLES_BUSY, code: "roles_busy", retryAfterSeconds: 2 };
}

/** Postgres' "canceling statement due to lock timeout" (55P03), however the driver adapter wraps it. */
export function isLockTimeout(e: unknown, depth = 0): boolean {
  if (!e || typeof e !== "object" || depth > 4) return false;
  const o = e as { code?: unknown; originalCode?: unknown; message?: unknown; meta?: unknown; cause?: unknown };
  if (o.code === "55P03" || o.originalCode === "55P03") return true;
  if (typeof o.message === "string" && /55P03|lock timeout/i.test(o.message)) return true;
  try {
    if (o.meta !== undefined && /55P03|lock timeout/i.test(JSON.stringify(o.meta))) return true;
  } catch {
    // meta that will not serialise says nothing about a lock
  }
  return isLockTimeout(o.cause, depth + 1);
}

/**
 * Postgres ended this transaction to break a deadlock (40P01; Prisma's P2034,
 * "a write conflict or a deadlock"), however the driver adapter wraps it.
 * Nothing it wrote was kept, so a writer answers it as busy, as a lock
 * timeout (docs-found fixes batch 9: writeCheckIn answered it 500).
 */
export function isDeadlock(e: unknown, depth = 0): boolean {
  if (!e || typeof e !== "object" || depth > 4) return false;
  const o = e as { code?: unknown; originalCode?: unknown; message?: unknown; meta?: unknown; cause?: unknown };
  if (o.code === "40P01" || o.originalCode === "40P01" || o.code === "P2034") return true;
  if (typeof o.message === "string" && /40P01|deadlock detected/i.test(o.message)) return true;
  try {
    if (o.meta !== undefined && /40P01|deadlock detected/i.test(JSON.stringify(o.meta))) return true;
  } catch {
    // meta that will not serialise says nothing about a deadlock
  }
  return isDeadlock(o.cause, depth + 1);
}
