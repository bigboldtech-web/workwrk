// SCIM 2.0 Users: single resource. GET / PUT / PATCH / DELETE.
//
// PATCH supports the SCIM 2.0 "Operations" body (RFC 7644 §3.5.2),
// which is what Okta sends for incremental changes. PUT is a full
// replace; Azure AD uses it more.
//
// DELETE soft-deactivates by default (status = INACTIVE), not a hard
// row drop. Real deletion is a separate hard-delete admin action; an
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

import { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { scimDeprovision, scimReactivated } from "@/lib/scim-deprovision";
import { authenticateScim, isDeprovisionOnly, scimError, scimResponse, scimWorkspaceInactiveError } from "@/lib/scim-auth";
import { userToScim } from "@/lib/scim-mappers";
import { isReservedStaffAddress, STAFF_ADDRESS_REFUSAL } from "@/lib/platform-admin";
import { lockWorkspaceSeats, seatsFor } from "@/lib/seats";
import { isErasedAccount } from "@/lib/compliance/erased-account";

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
  const user = await prisma.user.findFirst({
    where: { id, organizationId: auth.organizationId },
    select: {
      id: true,
      email: true,
      firstName: true,
      lastName: true,
      status: true,
      createdAt: true,
      updatedAt: true,
    },
  });
  if (!user || (await isErasedAccount(prisma, id))) return scimError(404, "User not found");
  return scimResponse(userToScim({ ...user, externalId: null }));
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

  const existing = await prisma.user.findFirst({
    where: { id, organizationId: auth.organizationId },
  });
  if (!existing) return scimError(404, "User not found");

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

  if ((await isErasedAccount(prisma, id)) && refuseForErased(data)) return scimError(404, "User not found");
  if (Object.keys(data).length === 0) return scimError(400, "No fields to update");
  if (auth.workspaceInactive) {
    // Suspended or cancelled: only a deprovision goes through. An identity
    // provider that deprovisions with a FULL resource (name, emails and
    // active:false) is still deprovisioning, so the rest is dropped and the
    // deactivation lands; otherwise the fired person would come back ACTIVE
    // the day the company is reactivated.
    if (data.status !== "INACTIVE") return scimWorkspaceInactiveError();
    for (const k of Object.keys(data)) if (k !== "status") delete data[k];
    if (!isDeprovisionOnly(data)) return scimWorkspaceInactiveError();
  }
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
  }
  const reactivating = data.status === "ACTIVE" && existing.status === "INACTIVE";

  // Reactivating someone takes a seat again (src/lib/seats.ts), checked and
  // taken under the workspace's lock.
  const placed = await prisma.$transaction(async (tx) => {
    if (reactivating) {
      await lockWorkspaceSeats(tx, auth.organizationId);
      const seats = await seatsFor(auth.organizationId, 1, tx);
      if (!seats.ok) return { refused: seats.message } as const;
    }
    const row = await tx.user.update({
      where: { id },
      data,
      select: {
        id: true,
        email: true,
        firstName: true,
        lastName: true,
        status: true,
        createdAt: true,
        updatedAt: true,
      },
    });
    return { updated: row } as const;
  });
  if (placed.refused !== undefined) return scimError(403, placed.refused);
  const updated = placed.updated;
  if (reactivating) await scimReactivated(auth.organizationId, id).catch((e: unknown) => console.error("scim reactivation audit failed", e));
  return scimResponse(userToScim({ ...updated, externalId: null }));
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
  if (!existing) return scimError(404, "User not found");

  const data: Record<string, unknown> = {};
  for (const op of body.Operations as Array<{ op?: string; path?: string; value?: unknown }>) {
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

  if ((await isErasedAccount(prisma, id)) && refuseForErased(data)) return scimError(404, "User not found");
  if (Object.keys(data).length === 0) {
    return scimResponse(userToScim({ ...existing, externalId: null }));
  }
  if (auth.workspaceInactive) {
    // Suspended or cancelled: only a deprovision goes through. An identity
    // provider that deprovisions with a FULL resource (name, emails and
    // active:false) is still deprovisioning, so the rest is dropped and the
    // deactivation lands; otherwise the fired person would come back ACTIVE
    // the day the company is reactivated.
    if (data.status !== "INACTIVE") return scimWorkspaceInactiveError();
    for (const k of Object.keys(data)) if (k !== "status") delete data[k];
    if (!isDeprovisionOnly(data)) return scimWorkspaceInactiveError();
  }
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
  }
  const reactivating = data.status === "ACTIVE" && existing.status === "INACTIVE";

  // Reactivating someone takes a seat again (src/lib/seats.ts), checked and
  // taken under the workspace's lock.
  const placed = await prisma.$transaction(async (tx) => {
    if (reactivating) {
      await lockWorkspaceSeats(tx, auth.organizationId);
      const seats = await seatsFor(auth.organizationId, 1, tx);
      if (!seats.ok) return { refused: seats.message } as const;
    }
    const row = await tx.user.update({
      where: { id },
      data,
      select: {
        id: true,
        email: true,
        firstName: true,
        lastName: true,
        status: true,
        createdAt: true,
        updatedAt: true,
      },
    });
    return { updated: row } as const;
  });
  if (placed.refused !== undefined) return scimError(403, placed.refused);
  const updated = placed.updated;
  if (reactivating) await scimReactivated(auth.organizationId, id).catch((e: unknown) => console.error("scim reactivation audit failed", e));
  return scimResponse(userToScim({ ...updated, externalId: null }));
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
  if (!existing) return scimError(404, "User not found");

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
