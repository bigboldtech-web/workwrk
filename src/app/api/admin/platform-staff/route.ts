import { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSessionOrFail, jsonError, jsonSuccess } from "@/lib/api-helpers";
import { requirePlatformAdminApi } from "@/lib/platform-admin";
import { logStaffAction, requestIp, staffActorFromSession } from "@/lib/staff-audit";
import { sendEmail } from "@/lib/email";

/**
 * The Staff list (the PlatformAdmin allow-list that gates the Staff console).
 * Platform staff only, gated on the same check as the rest of /api/admin/*.
 * One flat list: no read-only tier.
 *
 * GET    → list all staff
 * POST   → add by email (body: { email, name? }); every existing staff member
 *          is told by email, and the add is recorded as a StaffAction row in
 *          the same transaction
 * DELETE → remove by id (body: { id }); refuses to remove the last one; the
 *          removal is recorded in the same transaction
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

  const actor = staffActorFromSession(session);
  const ip = requestIp(req);

  const outcome = await prisma.$transaction(async (tx) => {
    const existing = await tx.platformAdmin.findUnique({ where: { email }, select: { id: true } });
    if (existing) return { duplicate: true as const };

    const created = await tx.platformAdmin.create({
      data: { email, name },
      select: { id: true, email: true, name: true, createdAt: true },
    });
    await logStaffAction({
      db: tx,
      action: "admin.staff.added",
      actor,
      ip,
      targetLabel: email,
      summary: `Added ${name ? `${name} (${email})` : email} to the staff list`,
      after: { email, name },
    });
    // Everyone on the list at the moment of the add, minus the newcomer.
    const others = await tx.platformAdmin.findMany({
      where: { email: { not: email } },
      select: { email: true },
    });
    return { duplicate: false as const, created, notify: others.map((o) => o.email) };
  });

  if (outcome.duplicate) return jsonError("That email is already on the staff list", 409);

  // Every staff add notifies everyone (decided): after commit, best effort.
  for (const to of outcome.notify) {
    void sendEmail({
      to,
      subject: `${email} was added to the WorkwrK staff list`,
      html: `<p>${actor.email} added ${name ? `${name} (${email})` : email} to the WorkwrK staff list. They can now open the Staff console and change any company. If that is not expected, remove them from Staff console › Staff.</p>`,
      template: "staff_added",
      variables: { addedBy: actor.email, added: email },
    }).catch((err) => console.error("[platform-staff] notify failed:", err));
  }

  return jsonSuccess({ staff: outcome.created }, 201);
}

export async function DELETE(req: NextRequest) {
  const { error, session } = await getSessionOrFail();
  if (error) return error;
  const denied = await requirePlatformAdminApi(session);
  if (denied) return denied;

  const body = await req.json().catch(() => ({}));
  const id = typeof body?.id === "string" ? body.id : "";
  if (!id) return jsonError("id is required");

  const actor = staffActorFromSession(session);
  const ip = requestIp(req);

  const outcome = await prisma.$transaction(async (tx) => {
    const target = await tx.platformAdmin.findUnique({
      where: { id },
      select: { id: true, email: true, name: true },
    });
    if (!target) return { status: 404 as const };

    // Lockout guard: never remove the last remaining staff member.
    const count = await tx.platformAdmin.count();
    if (count <= 1) return { status: 400 as const };

    await tx.platformAdmin.delete({ where: { id } });
    await logStaffAction({
      db: tx,
      action: "admin.staff.removed",
      actor,
      ip,
      targetLabel: target.email,
      summary: `Removed ${target.name ? `${target.name} (${target.email})` : target.email} from the staff list`,
      before: { email: target.email, name: target.name },
    });
    return { status: 200 as const, email: target.email };
  });

  if (outcome.status === 404) return jsonError("Not found", 404);
  if (outcome.status === 400) return jsonError("Can't remove the last staff member", 400);
  return jsonSuccess({ removed: true, id, email: outcome.email });
}
