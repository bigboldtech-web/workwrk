import { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSessionOrFail, jsonError, jsonSuccess } from "@/lib/api-helpers";
import { requirePlatformAdminApi } from "@/lib/platform-admin";

/**
 * Manage the WorkwrK platform-staff allowlist (the PlatformAdmin table that
 * gates the cross-tenant back-office). Platform staff only — gated on the same
 * check as the rest of /api/admin/*. Replaces hand-seeding rows via SQL.
 *
 * GET    → list all staff
 * POST   → add by email (body: { email, name? })
 * DELETE → remove by id (body: { id }); refuses to remove the last one
 */

const EMAIL_RE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;

export async function GET() {
  const { error, session } = await getSessionOrFail();
  if (error) return error;
  const denied = await requirePlatformAdminApi(session);
  if (denied) return denied;

  const staff = await prisma.platformAdmin.findMany({
    orderBy: { createdAt: "asc" },
    select: { id: true, email: true, name: true, createdAt: true },
  });
  return jsonSuccess({ staff });
}

export async function POST(req: NextRequest) {
  const { error, session } = await getSessionOrFail();
  if (error) return error;
  const denied = await requirePlatformAdminApi(session);
  if (denied) return denied;

  const body = await req.json().catch(() => ({}));
  const email = typeof body?.email === "string" ? body.email.trim().toLowerCase() : "";
  const name =
    typeof body?.name === "string" && body.name.trim() ? body.name.trim() : null;

  if (!EMAIL_RE.test(email)) return jsonError("Enter a valid email address");

  const existing = await prisma.platformAdmin.findUnique({
    where: { email },
    select: { id: true },
  });
  if (existing) return jsonError("That email is already a platform staff member", 409);

  const created = await prisma.platformAdmin.create({
    data: { email, name },
    select: { id: true, email: true, name: true, createdAt: true },
  });
  return jsonSuccess({ staff: created }, 201);
}

export async function DELETE(req: NextRequest) {
  const { error, session } = await getSessionOrFail();
  if (error) return error;
  const denied = await requirePlatformAdminApi(session);
  if (denied) return denied;

  const body = await req.json().catch(() => ({}));
  const id = typeof body?.id === "string" ? body.id : "";
  if (!id) return jsonError("id is required");

  const target = await prisma.platformAdmin.findUnique({
    where: { id },
    select: { id: true, email: true },
  });
  if (!target) return jsonError("Not found", 404);

  // Lockout guard — never remove the last remaining staff member.
  const count = await prisma.platformAdmin.count();
  if (count <= 1) {
    return jsonError("Can't remove the last platform staff member", 400);
  }

  await prisma.platformAdmin.delete({ where: { id } });
  return jsonSuccess({ removed: true, id, email: target.email });
}
