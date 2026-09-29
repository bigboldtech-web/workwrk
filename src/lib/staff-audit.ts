// The Staff console's audit trail (spec-admin-backoffice section 1 "Audit,
// one convention" and section 3 item 4).
//
// Every write a WorkwrK staff member makes from the console goes through
// `logStaffAction()`, which writes ONE `StaffAction` row: who (the staff
// member's user id and email), what (the action key), which company, a plain
// sentence, the before and after values, the reason, the IP. The row is
// written INSIDE the caller's transaction, so a write that cannot record
// itself does not happen (the phase's hard rule; stricter than the spec's
// fire-and-forget).
//
// The customer's half: a write that changes a company's workspace also gets
// one row in that workspace's own ActivityLog with the `staff.*` key, a
// customer-facing sentence, `actorId: null`, `actorType: "platform_staff"`
// and `actorLabel: "WorkwrK Support"`. The individual staff member's name,
// email and IP are NEVER written there: the customer is entitled to know that
// WorkwrK changed their plan, not to the name of the employee who did it.
//
// The tenant row is held behind a runtime check until the ActivityLog model
// carries `actorType` and `actorLabel` (the settings and workspace unit's
// migration, spec section 4 step 1). Today the model has a required
// `actorId` with a User relation, so a row with a null actor cannot be
// written, and a row pointing at a WorkwrK employee's user id in another
// organisation (what the routes did before) leaked that employee's identity
// to the customer's audit page. Until the columns land the fact lives in the
// StaffAction row, for ever, and on /admin/audit.

import { prisma } from "@/lib/prisma";
import type { Prisma } from "@/generated/prisma";
import {
  DENIAL_WINDOW_MS,
  STAFF_ACTOR_LABEL,
  STAFF_ACTOR_TYPE,
  isWithinDenialWindow,
  tenantEventFor,
  type StaffActionKey,
  type StaffActor,
  type TenantEvent,
} from "@/lib/staff-audit-helpers";

type Db = typeof prisma | Prisma.TransactionClient;

export {
  STAFF_ACTIONS,
  STAFF_ACTOR_LABEL,
  STAFF_ACTOR_TYPE,
  DENIAL_WINDOW_MS,
  planLabel,
  statusLabel,
  requestIp,
  staffActorFromSession,
  isWithinDenialWindow,
  tenantEventFor,
  escapeHtml,
  type StaffActionKey,
  type StaffActor,
  type TenantEvent,
} from "@/lib/staff-audit-helpers";

/* ───────────────────────── the writes ───────────────────────── */

export interface LogStaffActionInput {
  action: Exclude<StaffActionKey, "admin.access.denied">;
  actor: StaffActor;
  targetCompanyId?: string | null;
  targetLabel?: string | null;
  /** One plain sentence for the staff side; may name the company and the values. */
  summary: string;
  before?: Record<string, unknown> | null;
  after?: Record<string, unknown> | null;
  reason?: string | null;
  ip?: string | null;
  /** The transaction the write runs in. The row is part of the write. */
  db: Db;
}

export interface LoggedStaffAction {
  id: string;
  /** The tenant row this action owes the customer, to write after commit. */
  tenant: { organizationId: string; event: TenantEvent } | null;
}

/**
 * Writes the StaffAction row inside `db` (the caller's transaction). Throws
 * on failure, so the surrounding write rolls back: a change that cannot
 * record itself does not happen.
 *
 * Returns the customer's half, when there is one, for `writeTenantRow()`
 * AFTER the transaction commits. That one is best effort: the customer's
 * audit row must never undo a change the staff member already saw succeed.
 */
export async function logStaffAction(input: LogStaffActionInput): Promise<LoggedStaffAction> {
  const { db } = input;
  const row = await db.staffAction.create({
    data: {
      action: input.action,
      actorUserId: input.actor.userId,
      actorEmail: input.actor.email,
      targetCompanyId: input.targetCompanyId ?? null,
      targetLabel: input.targetLabel ?? null,
      summary: input.summary,
      before: (input.before ?? undefined) as Prisma.InputJsonValue | undefined,
      after: (input.after ?? undefined) as Prisma.InputJsonValue | undefined,
      reason: input.reason ?? null,
      ip: input.ip ?? null,
    },
    select: { id: true },
  });
  const event = input.targetCompanyId ? tenantEventFor(input.action, input.before, input.after) : null;
  return {
    id: row.id,
    tenant: event && input.targetCompanyId ? { organizationId: input.targetCompanyId, event } : null,
  };
}

/**
 * Whether the generated ActivityLog model can hold a named non-person actor
 * (`actorType` and `actorLabel`). Read from the client's runtime data model,
 * so the day the settings and workspace unit's migration lands and the
 * client is regenerated, the tenant rows start flowing with no code change.
 */
export function tenantActorSupported(): boolean {
  const rdm = (prisma as unknown as { _runtimeDataModel?: { models?: Record<string, { fields?: { name: string }[] }> } })
    ._runtimeDataModel;
  const fields = rdm?.models?.ActivityLog?.fields;
  if (!fields) return false;
  const names = new Set(fields.map((f) => f.name));
  return names.has("actorType") && names.has("actorLabel");
}

let heldNoticeShown = false;

/**
 * The customer's row, written after the staff transaction committed. Never
 * throws. While the ActivityLog model cannot carry a named non-person actor
 * the row is held (once-per-process notice), never written with a foreign
 * user id.
 */
export async function writeTenantRow(logged: LoggedStaffAction | null | undefined): Promise<boolean> {
  const tenant = logged?.tenant;
  if (!tenant) return false;
  if (!tenantActorSupported()) {
    if (!heldNoticeShown) {
      heldNoticeShown = true;
      console.warn(
        "[staff-audit] customer audit rows are held: ActivityLog has no actorType/actorLabel yet. The StaffAction row was written.",
      );
    }
    return false;
  }
  try {
    await prisma.activityLog.create({
      data: {
        type: tenant.event.type,
        actorId: null,
        actorType: STAFF_ACTOR_TYPE,
        actorLabel: STAFF_ACTOR_LABEL,
        organizationId: tenant.organizationId,
        description: tenant.event.description,
        targetType: "Organization",
        targetId: tenant.organizationId,
        severity: tenant.event.severity,
        metadata: { staffActionId: logged?.id },
      } as unknown as Prisma.ActivityLogUncheckedCreateInput,
    });
    return true;
  } catch (err) {
    console.error("[staff-audit] failed to write the customer's audit row:", err);
    return false;
  }
}

/**
 * The layout gate's denial log (spec section 1 Access): one
 * `admin.access.denied` row per would-be viewer per ten minutes, counted
 * from the row's creation. A repeat inside the window bumps `hits` and
 * refreshes the IP; a script hammering the host cannot flood the log.
 * Fire and forget: never throws, never blocks the page.
 */
export async function recordDeniedAccess(input: { email: string; userId?: string | null; ip?: string | null }): Promise<void> {
  const email = input.email.trim().toLowerCase() || "unknown";
  try {
    const now = new Date();
    const open = await prisma.staffAction.findFirst({
      where: {
        action: "admin.access.denied",
        actorEmail: email,
        createdAt: { gt: new Date(now.getTime() - DENIAL_WINDOW_MS) },
      },
      orderBy: { createdAt: "desc" },
      select: { id: true, createdAt: true },
    });
    if (open && isWithinDenialWindow(open.createdAt, now)) {
      await prisma.staffAction.update({
        where: { id: open.id },
        data: { hits: { increment: 1 }, ip: input.ip ?? undefined },
      });
      return;
    }
    await prisma.staffAction.create({
      data: {
        action: "admin.access.denied",
        actorUserId: input.userId ?? null,
        actorEmail: email,
        summary: `${email} tried to open the Staff console and is not on the staff list`,
        ip: input.ip ?? null,
      },
    });
  } catch (err) {
    console.error("[staff-audit] failed to record a denied access:", err);
  }
}
