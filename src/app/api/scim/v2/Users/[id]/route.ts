// SCIM 2.0 Users: single resource. GET / PUT / PATCH / DELETE.
//
// PATCH supports the SCIM 2.0 "Operations" body (RFC 7644 §3.5.2),
// which is what Okta sends for incremental changes. PUT is a full
// replace; Azure AD uses it more.
//
// DELETE soft-deactivates by default (the seat here deactivated, D14), not
// a hard row drop. Real deletion is a separate hard-delete admin action; an
// IdP de-provision should never lose audit trail.
//
// AN ERASED ACCOUNT (review round 8 of Phase 3). A person who deleted their
// own account (POST /api/me/delete) is gone for the identity provider: GET,
// PUT and PATCH answer as for an unknown user, so a push never writes their
// real address and names back onto the anonymised row, and active:true never
// brings it back. Before, a push did both, and the erasure sweep then never
// recognised the account, so their AI teammates' words stayed for good. A
// deprovision (active:false, or DELETE) still answers a harmless success,
// its other fields dropped: identity providers retry on errors.
// Review round 9 of Phase 3: "erased" means in the state its erasure left it
// (src/lib/compliance/erased-account.ts). An erased account an Admin restored
// before round 8, or removed after such a restore, is an ordinary account
// here, read and written as anyone is. No SCIM path sets deletedAt, so none
// can move an erased account out of that state.
//
// SOMEONE WHO WORKS HERE THROUGH A MEMBERSHIP (docs-found fixes batch 7),
// anchored in another workspace: GET reads them, active:false and DELETE end
// their membership seat here and hand their work here over
// (scim-deprovision.ts scimDeprovisionMember), active:true brings that seat
// back, and every other field is left as it is, answered as stored: their
// names and address are one row every workspace they belong to reads, so
// this workspace's identity provider never writes them. A membership row an
// earlier build deleted still lets a retried deprovision find them
// (formerMemberDeprovision), finishing a handover a failure left or
// answering a harmless success.
//
// THIS WORKSPACE'S SEAT (docs/plans/workspace-status.md D14). `active` is the
// seat here, live or not, for everyone (an HR label is live), never the
// account's status, which is the anchored workspace's. A reactivation brings
// back the seat here through workspace-status.ts restoreSeat, under the seat
// check and the line check (src/lib/scim-reactivate.ts, the one path POST
// takes too), for someone anchored here (their account's
// seat) or here through a membership (that membership; when their account
// is ended where it is anchored, it moves here, D6). It never changes
// another workspace, except that restoring the anchored seat brings back
// the seats the one-time step ended with the account (D16). A seat this
// workspace REMOVED is not brought back by active:true: an Owner or Admin
// restores it in WorkwrK, since a removal is a decision the identity
// provider's periodic push must not undo (before, it wrote ACTIVE beside the
// removal). The status is never written onto the account here: an
// active:true on a live seat leaves its HR label as it is.
//
// A NAME AND ADDRESS SHARED WITH ANOTHER WORKSPACE (the final review,
// security H1; src/lib/access/shared-identity.ts). For someone anchored here
// whose account holds any membership in another workspace (any state), the
// sign-in address, its verification and the names are never written: they
// are how the person signs in everywhere, and an address this identity
// provider set would let it take the account over in every workspace. The
// request still answers success with the stored values, so the sync goes
// on. Checked again under the person's row lock at the write.
//
// EVERY ACCOUNT WRITE IS GUARDED BY THIS WORKSPACE (the final review,
// integrity L2): the fields land only while the person is still anchored
// here (updateMany by id and workspace). A move by another admin in between
// lands nothing, and the answer is the one for a person gone from here (the
// member's resource as stored, or 404).
//
// THE MANAGER (docs/plans/workspace-status-2.md E9 i, step 7;
// src/lib/scim-manager.ts). The enterprise extension's `manager` on PUT and
// PATCH (`urn:...:User:manager` and `manager.value` paths, add, replace
// and remove, or a value with no path) is THIS workspace's line, for both
// kinds of person: the account's line for someone anchored here, the
// membership's for someone here through one, written through
// seat-writes.ts writeLineHere under the workspace's role lock (taken
// before the person's row lock) and the rules of every line here (E4, E5).
// It is not the shared identity: a membership person's manager here is
// written although their names and address never are. A refused manager
// writes nothing of the line, the rest of the request goes on, and one
// Audit log row says why. A PUT that leaves the manager out leaves the line
// as it is, and one naming the manager the person already has takes no role
// lock at all (scimManagerChanges, the step 7 review L3). Every resource answered names the line the seat here holds, as
// a reference to the manager's SCIM id, while that manager holds a seat
// here. Not in a suspended or cancelled workspace (a deprovision only), and
// never on an erased account.

import { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import type { Prisma } from "@/generated/prisma";
import { formerMemberDeprovision, scimDeprovision, scimDeprovisionMember } from "@/lib/scim-deprovision";
import { authenticateScim, isDeprovisionOnly, scimError, scimResponse, scimWorkspaceInactiveError } from "@/lib/scim-auth";
import { managerAskOfOperation, managerAskOfResource, type ScimManagerAsk } from "@/lib/scim-mappers";
import { isReservedStaffAddress, STAFF_ADDRESS_REFUSAL } from "@/lib/platform-admin";
import { isErasedAccount } from "@/lib/compliance/erased-account";
import { personSeatIn, type PersonSeat } from "@/lib/access/acting-workspace";
import { seatIsLive } from "@/lib/access/workspace-status";
import { SCIM_USER_SELECT, scimReactivateSeat } from "@/lib/scim-reactivate";
import { IDENTITY_FIELDS, identityShared, touchesIdentity, withoutIdentity } from "@/lib/access/shared-identity";
import { lockPerson } from "@/lib/access/workspace-anchor";
import { lockOrgRoles } from "@/lib/access/membership";
import { LOCKED_TX } from "@/lib/access/org-roles-busy";
import { scimManagerChanges, scimManagerHere, scimManagerRetry, scimSetManager, scimUserHere } from "@/lib/scim-manager";

/** The row SCIM answers with. */
const SEAT_ROW_SELECT = SCIM_USER_SELECT;
type SeatRow = Prisma.UserGetPayload<{ select: typeof SEAT_ROW_SELECT }>;
type Db = Prisma.TransactionClient | typeof prisma;

/** The person and their seat here (any state, a removed one included; acting-workspace.ts personSeatIn), or null when they hold none here. */
async function seatHere(organizationId: string, id: string, db: Db = prisma): Promise<{ row: SeatRow; seat: PersonSeat } | null> {
  const row = await db.user.findUnique({ where: { id }, select: SEAT_ROW_SELECT });
  if (!row) return null;
  const seat = await personSeatIn(organizationId, id, db);
  return seat ? { row, seat } : null;
}

/** The resource as SCIM answers it: `active` is the seat here, the manager the line it holds (see the header). */
function scimOf(organizationId: string, row: SeatRow, seat: PersonSeat | null) {
  return scimUserHere(organizationId, row, seat);
}

/**
 * Write the identity provider's fields (never the status: see the header).
 * A reactivation goes through SCIM's one way back for a deactivated seat
 * (src/lib/scim-reactivate.ts scimReactivateSeat, the same path POST takes):
 * the seat check, restoreSeat here, then the lines that no longer hold and
 * their open reviews, in one transaction with the fields, under bounded
 * locks (a busy one answers 503). A refused reactivation writes nothing,
 * the fields included. `manager` (see the header) is written in the same
 * transaction as the fields, under the role lock taken first; a refused one
 * leaves the fields written; one the seat here already holds takes no lock.
 */
async function writeScimUser(organizationId: string, id: string, data: Record<string, unknown>, reactivating: boolean, manager?: ScimManagerAsk): Promise<Response> {
  const fields = Object.fromEntries(Object.entries(data).filter(([k]) => k !== "status"));
  if (reactivating) {
    const r = await scimReactivateSeat(organizationId, id, fields, manager);
    return r.ok ? scimResponse(await scimOf(organizationId, r.row, r.seat)) : scimError(r.status, r.error);
  }
  // A manager the seat here already holds (or a clear of an empty line) is
  // no change: no role lock is taken for it (the step 7 review L3). A real
  // change is checked again, in full, under the lock.
  const line = manager && (await scimManagerChanges(organizationId, id, manager)) ? manager : undefined;
  if (Object.keys(fields).length > 0 || line) {
    // Under the person's row lock: the shared-identity rule read again, and
    // the write only while they are anchored here (see the header). A line
    // write takes this workspace's role lock first (seat-writes.ts's order).
    try {
      await prisma.$transaction(async (tx) => {
        if (line) await lockOrgRoles(tx, organizationId);
        await lockPerson(tx, id);
        const write = touchesIdentity(fields) && (await identityShared(tx, id, organizationId)) ? withoutIdentity(fields) : fields;
        if (Object.keys(write).length > 0) await tx.user.updateMany({ where: { id, organizationId }, data: write });
        if (line) await scimManagerHere(tx, organizationId, id, line);
      }, LOCKED_TX);
    } catch (e) {
      // Busy, a deadlock Postgres broke, or past its time: nothing written, and the provider retries.
      const retry = scimManagerRetry(e);
      if (retry) return scimError(503, retry);
      throw e;
    }
  }
  const now = await seatHere(organizationId, id);
  return now ? scimResponse(await scimOf(organizationId, now.row, now.seat)) : scimError(404, "User not found");
}

/** The manager alone, in its own transaction (see the header), after the rest of the request; a busy one is the 503 the provider retries. */
async function writeManagerAlone(organizationId: string, id: string, manager: ScimManagerAsk | undefined): Promise<Response | null> {
  if (!manager) return null;
  const out = await scimSetManager(organizationId, id, manager);
  return out.ok ? null : scimError(out.status, out.error);
}

/**
 * Leaves the address, its verification and the names out of `data` (in
 * place) when the account is shared with another workspace (see the header):
 * the rest of the request goes on, and the answer shows them as stored.
 */
async function dropSharedIdentity(data: Record<string, unknown>, id: string, organizationId: string): Promise<void> {
  if (!touchesIdentity(data) || !(await identityShared(prisma, id, organizationId))) return;
  for (const k of IDENTITY_FIELDS) delete data[k];
}

/** What a request asks of someone's seat here: to end it, to bring it back, or neither. */
type Intent = "deprovision" | "reactivate" | "other";

/**
 * A request to someone who is not anchored here (see the header): a
 * membership seat here (any state), or a membership row an earlier build
 * deleted that this identity provider had ended. A deprovision ends the
 * seat, a reactivation brings a deactivated one back (never in a suspended
 * or cancelled workspace, `workspaceInactive`: the step 4 review L3);
 * anything else is answered as stored. Null when they hold no seat here (or
 * their account was erased) and nothing acts.
 */
async function forMember(organizationId: string, id: string, intent: Intent, workspaceInactive = false, manager?: ScimManagerAsk): Promise<Response | null> {
  const found = await seatHere(organizationId, id);
  const seat = found?.seat.kind === "membership" ? found.seat : null;
  if (!seat && (intent !== "deprovision" || (await formerMemberDeprovision(organizationId, id)) === null)) return null;
  if (intent === "deprovision") {
    const out = await scimDeprovisionMember(organizationId, id);
    if (!out.ok) return scimError(out.status, out.error);
    // The manager, this workspace's own line, after the end (see the header):
    // never in a closed workspace, never on an erased account.
    if (manager && !workspaceInactive && !(await isErasedAccount(prisma, id))) {
      const busy = await writeManagerAlone(organizationId, id, manager);
      if (busy) return busy;
    }
    const after = await seatHere(organizationId, id);
    const row = after?.row ?? (await prisma.user.findUnique({ where: { id }, select: SEAT_ROW_SELECT }));
    if (!row) return scimError(404, "User not found");
    return scimResponse(await scimOf(organizationId, row, after?.seat.kind === "membership" ? after.seat : null));
  }
  if (!found || !seat || (await isErasedAccount(prisma, id))) return null;
  // Only a deprovision goes through while the workspace is suspended or cancelled.
  if (workspaceInactive) return scimWorkspaceInactiveError();
  if (intent === "reactivate" && !seatIsLive(seat)) return writeScimUser(organizationId, id, {}, true, manager);
  if (manager) {
    // Their manager here is this workspace's own (see the header), though
    // their names and address are not.
    const busy = await writeManagerAlone(organizationId, id, manager);
    if (busy) return busy;
    const now = await seatHere(organizationId, id);
    return now ? scimResponse(await scimOf(organizationId, now.row, now.seat)) : scimError(404, "User not found");
  }
  return scimResponse(await scimOf(organizationId, found.row, seat));
}

/**
 * A request to an erased account (see the header): only a deprovision goes
 * on, with every other field dropped; anything else is refused as for an
 * unknown user. Changes `data` in place; answers whether to refuse.
 */
function refuseForErased(data: Record<string, unknown>): boolean {
  if (data.status !== "INACTIVE") return true;
  for (const k of Object.keys(data)) if (k !== "status") delete data[k];
  return false;
}

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const auth = await authenticateScim(req);
  if (!auth.ok) return auth.response;

  const { id } = await params;
  // Anchored here, or here through a membership (batch 7), with the seat here (D14).
  const found = await seatHere(auth.organizationId, id);
  if (!found || (await isErasedAccount(prisma, id))) return scimError(404, "User not found");
  return scimResponse(await scimOf(auth.organizationId, found.row, found.seat));
}

/**
 * After a deprovision of someone anchored here: when it moved their account
 * to their other workspace (D3), they now work here through the membership
 * the move left, so the rest of the request is answered as for a member
 * here (their names and address are no longer this workspace's to write).
 * Null while they are still anchored here.
 */
async function movedAway(organizationId: string, id: string, manager?: ScimManagerAsk): Promise<Response | null> {
  const now = await seatHere(organizationId, id);
  if (!now || now.seat.kind === "anchor") return null;
  // Their line here moved with the swap onto the membership the move left
  // (E3): the manager is still this workspace's to write (see the header).
  if (manager) {
    const busy = await writeManagerAlone(organizationId, id, manager);
    if (busy) return busy;
    const after = await seatHere(organizationId, id);
    return after ? scimResponse(await scimOf(organizationId, after.row, after.seat)) : scimError(404, "User not found");
  }
  return scimResponse(await scimOf(organizationId, now.row, now.seat));
}

export async function PUT(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const auth = await authenticateScim(req, { allowDeprovisionWhileInactive: true });
  if (!auth.ok) return auth.response;

  const { id } = await params;
  const body = await req.json().catch(() => null);
  if (!body) return scimError(400, "Invalid JSON body");

  // The manager this workspace's line names (see the header); a PUT that leaves it out leaves the line as it is.
  let manager = managerAskOfResource(body);
  const existing = await prisma.user.findFirst({
    where: { id, organizationId: auth.organizationId },
  });
  if (!existing) {
    // Someone who works here through a membership: their seat here only (batch 7, D14), and their manager here.
    const member = await forMember(auth.organizationId, id, body.active === false ? "deprovision" : body.active === true ? "reactivate" : "other", auth.workspaceInactive, manager);
    return member ?? scimError(404, "User not found");
  }

  const data: Record<string, unknown> = {};
  if (typeof body.name?.givenName === "string") data.firstName = body.name.givenName.trim();
  if (typeof body.name?.familyName === "string") data.lastName = body.name.familyName.trim();
  if (typeof body.userName === "string") {
    const next = body.userName.trim().toLowerCase();
    if (next && next.includes("@")) data.email = next;
  }
  if (Array.isArray(body.emails)) {
    const primary = body.emails.find((e: { primary?: boolean; value?: string }) => e.primary && e.value)
      ?? body.emails.find((e: { value?: string }) => e.value);
    if (primary?.value) data.email = String(primary.value).toLowerCase();
  }
  if (typeof body.active === "boolean") {
    data.status = body.active ? "ACTIVE" : "INACTIVE";
  }

  const erased = await isErasedAccount(prisma, id);
  if (erased && refuseForErased(data)) return scimError(404, "User not found");
  // An erased account's deprovision drops every other field, the manager too.
  if (erased) manager = undefined;
  if (Object.keys(data).length === 0 && !manager) return scimError(400, "No fields to update");
  if (auth.workspaceInactive) {
    // Suspended or cancelled: only a deprovision goes through. An identity
    // provider that deprovisions with a FULL resource (name, emails and
    // active:false) is still deprovisioning, so the rest is dropped and the
    // deactivation lands; otherwise the fired person would come back ACTIVE
    // the day the company is reactivated.
    if (data.status !== "INACTIVE") return scimWorkspaceInactiveError();
    for (const k of Object.keys(data)) if (k !== "status") delete data[k];
    manager = undefined;
    if (!isDeprovisionOnly(data)) return scimWorkspaceInactiveError();
  }
  // Shared with another workspace: never written, the rest answered as stored (see the header).
  await dropSharedIdentity(data, id, auth.organizationId);
  if (typeof data.email === "string" && data.email !== existing.email.toLowerCase()) {
    if (await isReservedStaffAddress(data.email)) return scimError(400, STAFF_ADDRESS_REFUSAL, "invalidValue");
    // A renamed address is not a proven one: verification is per address.
    data.emailVerifiedAt = null;
  }

  // Deprovisioning goes through the one handover path; the other fields
  // (a name change riding along) are written after it.
  // Called when already INACTIVE too: a retry after a failed handover
  // finishes it there (scimDeprovision's resume path), else it is a no-op.
  if (data.status === "INACTIVE") {
    const out = await scimDeprovision(auth.organizationId, id);
    if (!out.ok) return scimError(out.status, out.error);
    delete data.status;
    const moved = await movedAway(auth.organizationId, id, manager);
    if (moved) return moved;
  }
  const reactivating = data.status === "ACTIVE" && existing.status === "INACTIVE";

  return writeScimUser(auth.organizationId, id, data, reactivating, manager);
}

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const auth = await authenticateScim(req, { allowDeprovisionWhileInactive: true });
  if (!auth.ok) return auth.response;

  const { id } = await params;
  const body = await req.json().catch(() => null);
  if (!body || !Array.isArray(body.Operations)) {
    return scimError(400, "Operations array required", "invalidSyntax");
  }

  const existing = await prisma.user.findFirst({
    where: { id, organizationId: auth.organizationId },
  });

  const data: Record<string, unknown> = {};
  // The manager this workspace's line names (see the header): the last operation that touches it decides, a remove included.
  let manager: ScimManagerAsk | undefined;
  for (const op of body.Operations as Array<{ op?: string; path?: string; value?: unknown }>) {
    const asked = managerAskOfOperation(op);
    if (asked !== undefined) manager = asked;
    const verb = (op.op ?? "").toLowerCase();
    if (verb !== "replace" && verb !== "add") continue;

    const path = op.path;
    const value = op.value;

    // Some IdPs (Okta) set top-level field names without a path; some
    // (Azure AD) use SCIM paths like `name.givenName` or `active`.
    if (!path) {
      // Whole-resource patch. Pull known fields out of `value`.
      const v = value as Record<string, unknown> | undefined;
      if (v) {
        if (typeof v["active"] === "boolean") {
          data.status = v["active"] ? "ACTIVE" : "INACTIVE";
        }
        const name = v["name"] as Record<string, unknown> | undefined;
        if (typeof name?.["givenName"] === "string") data.firstName = String(name["givenName"]).trim();
        if (typeof name?.["familyName"] === "string") data.lastName = String(name["familyName"]).trim();
      }
      continue;
    }

    if (path === "active" && typeof value === "boolean") {
      data.status = value ? "ACTIVE" : "INACTIVE";
    } else if (path === "name.givenName" && typeof value === "string") {
      data.firstName = value.trim();
    } else if (path === "name.familyName" && typeof value === "string") {
      data.lastName = value.trim();
    } else if (path === "userName" && typeof value === "string") {
      const next = value.trim().toLowerCase();
      if (next.includes("@")) data.email = next;
    }
    // Unknown paths are silently ignored; SCIM spec allows skipping
    // unsupported attributes rather than 400-ing the whole request.
  }

  if (!existing) {
    // Someone who works here through a membership: their seat here only (batch 7, D14), and their manager here.
    const member = await forMember(auth.organizationId, id, data.status === "INACTIVE" ? "deprovision" : data.status === "ACTIVE" ? "reactivate" : "other", auth.workspaceInactive, manager);
    return member ?? scimError(404, "User not found");
  }
  const erased = await isErasedAccount(prisma, id);
  if (erased && refuseForErased(data)) return scimError(404, "User not found");
  // An erased account's deprovision drops every other field, the manager too.
  if (erased) manager = undefined;
  if (Object.keys(data).length === 0 && !manager) {
    const found = await seatHere(auth.organizationId, id);
    return found ? scimResponse(await scimOf(auth.organizationId, found.row, found.seat)) : scimError(404, "User not found");
  }
  if (auth.workspaceInactive) {
    // Suspended or cancelled: only a deprovision goes through. An identity
    // provider that deprovisions with a FULL resource (name, emails and
    // active:false) is still deprovisioning, so the rest is dropped and the
    // deactivation lands; otherwise the fired person would come back ACTIVE
    // the day the company is reactivated.
    if (data.status !== "INACTIVE") return scimWorkspaceInactiveError();
    for (const k of Object.keys(data)) if (k !== "status") delete data[k];
    manager = undefined;
    if (!isDeprovisionOnly(data)) return scimWorkspaceInactiveError();
  }
  // Shared with another workspace: never written, the rest answered as stored (see the header).
  await dropSharedIdentity(data, id, auth.organizationId);
  if (typeof data.email === "string" && data.email !== existing.email.toLowerCase()) {
    if (await isReservedStaffAddress(data.email)) return scimError(400, STAFF_ADDRESS_REFUSAL, "invalidValue");
    // A renamed address is not a proven one: verification is per address.
    data.emailVerifiedAt = null;
  }

  // Deprovisioning goes through the one handover path; the other fields
  // (a name change riding along) are written after it.
  // Called when already INACTIVE too: a retry after a failed handover
  // finishes it there (scimDeprovision's resume path), else it is a no-op.
  if (data.status === "INACTIVE") {
    const out = await scimDeprovision(auth.organizationId, id);
    if (!out.ok) return scimError(out.status, out.error);
    delete data.status;
    const moved = await movedAway(auth.organizationId, id, manager);
    if (moved) return moved;
  }
  const reactivating = data.status === "ACTIVE" && existing.status === "INACTIVE";

  return writeScimUser(auth.organizationId, id, data, reactivating, manager);
}

export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const auth = await authenticateScim(req, { allowDeprovisionWhileInactive: true });
  if (!auth.ok) return auth.response;

  const { id } = await params;
  const existing = await prisma.user.findFirst({
    where: { id, organizationId: auth.organizationId },
    select: { id: true, status: true },
  });
  if (!existing) {
    // Someone who works here through a membership: their membership seat
    // here ends, their account stays (batch 7, D14).
    const member = await forMember(auth.organizationId, id, "deprovision");
    if (!member) return scimError(404, "User not found");
    return member.ok ? new Response(null, { status: 204 }) : member;
  }

  // Soft delete: SCIM clients call this when a user is removed from
  // the WorkWrk app on their side. Hard delete is a separate admin
  // action so we never lose audit / time-off / payroll history.
  // Deactivate AND hand the person's work over (src/lib/scim-deprovision.ts),
  // never a bare status flip that leaves their Spaces and tasks ownerless.
  const out = await scimDeprovision(auth.organizationId, id);
  if (!out.ok) return scimError(out.status, out.error);

  // 204 No Content per RFC 7644.
  return new Response(null, { status: 204 });
}
