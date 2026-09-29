import { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSessionOrFail, jsonError, jsonSuccess } from "@/lib/api-helpers";
import { requirePlatformAdminApi } from "@/lib/platform-admin";
import { escapeHtml, logStaffAction, requestIp, staffActorFromSession } from "@/lib/staff-audit";
import { sendEmail } from "@/lib/email";
import { staffNames } from "@/lib/admin/company-detail";
import { readConsolePrefs } from "@/lib/admin/console-prefs";

/**
 * The Staff list (the PlatformAdmin allow-list that gates the Staff console).
 * Platform staff only, gated on the same check as the rest of /api/admin/*.
 * One flat list: no read-only tier.
 *
 * GET    → list all staff, with who added each person and when they last
 *          opened the console
 * POST   → add by email (body: { email, name? }); every existing staff member
 *          is told by email, and the add is recorded as a StaffAction row in
 *          the same transaction
 * DELETE → remove by id (body: { id }); refuses to remove the last one (under
 *          a lock on the whole list, so two removals at once can never empty
 *          it); the removal is recorded in the same transaction and, like an
 *          add, emailed to everyone still on the list. Removing yourself is
 *          allowed: the page's confirm says so in words.
 */

/** One notification per remaining staff member, after commit, best effort. */
function notifyStaff(to: string[], subject: string, html: string, template: string, variables: Record<string, string>) {
  for (const address of to) {
    void sendEmail({ to: address, subject, html, template, variables }).catch((err) =>
      console.error("[platform-staff] notify failed:", err),
    );
  }
}

function who(name: string | null, email: string): string {
  return escapeHtml(name ? `${name} (${email})` : email);
}

const EMAIL_RE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;

export async function GET() {
  const { error, session } = await getSessionOrFail();
  if (error) return error;
  const denied = await requirePlatformAdminApi(session);
  if (denied) return denied;

  const rows = await prisma.platformAdmin.findMany({
    orderBy: { createdAt: "asc" },
    select: { id: true, email: true, name: true, createdAt: true, consolePrefs: true },
  });
  // Who added each person: the newest admin.staff.added row naming them. A
  // person added before the log existed has none, and reads "Unknown".
  const adds = rows.length
    ? await prisma.staffAction.findMany({
        where: { action: "admin.staff.added", targetLabel: { in: rows.map((r) => r.email) } },
        orderBy: { createdAt: "desc" },
        select: { targetLabel: true, actorEmail: true, createdAt: true },
      })
    : [];
  const addedBy = new Map<string, string>();
  for (const a of adds) if (a.targetLabel && !addedBy.has(a.targetLabel)) addedBy.set(a.targetLabel, a.actorEmail);
  const names = await staffNames([...addedBy.values()]);
  const staff = rows.map((r) => {
    const by = addedBy.get(r.email) ?? null;
    return {
      id: r.id,
      email: r.email,
      name: r.name,
      createdAt: r.createdAt,
      addedByEmail: by,
      addedByName: by ? names.get(by) ?? by : null,
      // Stamped by the console layout when they open it (console-me.ts).
      lastOpenedAt: readConsolePrefs(r.consolePrefs).lastOpenedAt,
    };
  });
  // `you` lets the page say "You are removing yourself" in its confirm.
  return jsonSuccess({ staff, you: staffActorFromSession(session).email });
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
  // Names and emails are escaped: EMAIL_RE admits "<" and a name is free text.
  notifyStaff(
    outcome.notify,
    `${email} was added to the WorkwrK staff list`,
    `<p>${escapeHtml(actor.email)} added ${who(name, email)} to the WorkwrK staff list. They can now open the Staff console and change any company. If that is not expected, remove them from Staff console › Staff.</p>`,
    "staff_added",
    { addedBy: actor.email, added: email },
  );

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

    // Lockout guard: never remove the last remaining staff member. The
    // whole list is locked first, so two removals of the last two rows are
    // serialised and the second one sees a count of one.
    await tx.$queryRaw`SELECT "id" FROM "PlatformAdmin" FOR UPDATE`;
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
    const others = await tx.platformAdmin.findMany({ select: { email: true } });
    return { status: 200 as const, email: target.email, name: target.name, notify: others.map((o) => o.email) };
  });

  if (outcome.status === 404) return jsonError("Not found", 404);
  if (outcome.status === 400) return jsonError("Can't remove the last staff member", 400);
  // Every staff remove notifies everyone still on the list, the same as an add.
  notifyStaff(
    outcome.notify,
    `${outcome.email} was removed from the WorkwrK staff list`,
    `<p>${escapeHtml(actor.email)} removed ${who(outcome.name, outcome.email)} from the WorkwrK staff list. They can no longer open the Staff console. Their WorkwrK login is not touched.</p>`,
    "staff_removed",
    { removedBy: actor.email, removed: outcome.email },
  );

  return jsonSuccess({ removed: true, id, email: outcome.email });
}
