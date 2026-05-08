// SCIM 2.0 Users — single resource. GET / PUT / PATCH / DELETE.
//
// PATCH supports the SCIM 2.0 "Operations" body (RFC 7644 §3.5.2),
// which is what Okta sends for incremental changes. PUT is a full
// replace — Azure AD uses it more.
//
// DELETE soft-deactivates by default (status = INACTIVE), not a hard
// row drop. Real deletion is a separate hard-delete admin action; an
// IdP de-provision should never lose audit trail.

import { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { authenticateScim, scimError, scimResponse } from "@/lib/scim-auth";
import { userToScim } from "@/lib/scim-mappers";

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
  if (!user) return scimError(404, "User not found");
  return scimResponse(userToScim({ ...user, externalId: null }));
}

export async function PUT(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const auth = await authenticateScim(req);
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

  if (Object.keys(data).length === 0) return scimError(400, "No fields to update");

  const updated = await prisma.user.update({
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
  return scimResponse(userToScim({ ...updated, externalId: null }));
}

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const auth = await authenticateScim(req);
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
    // Unknown paths are silently ignored — SCIM spec allows skipping
    // unsupported attributes rather than 400-ing the whole request.
  }

  if (Object.keys(data).length === 0) {
    return scimResponse(userToScim({ ...existing, externalId: null }));
  }

  const updated = await prisma.user.update({
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
  return scimResponse(userToScim({ ...updated, externalId: null }));
}

export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const auth = await authenticateScim(req);
  if (!auth.ok) return auth.response;

  const { id } = await params;
  const existing = await prisma.user.findFirst({
    where: { id, organizationId: auth.organizationId },
    select: { id: true, status: true },
  });
  if (!existing) return scimError(404, "User not found");

  // Soft delete — SCIM clients call this when a user is removed from
  // the WorkWrk app on their side. Hard delete is a separate admin
  // action so we never lose audit / time-off / payroll history.
  await prisma.user.update({
    where: { id },
    data: { status: "INACTIVE" },
  });

  // 204 No Content per RFC 7644.
  return new Response(null, { status: 204 });
}
