// The one place a staff member's change to a company is applied
// (spec-admin-backoffice section 2.3 Data, section 4 steps 1 and 2a).
//
// PATCH /api/admin/companies/[id] is the one writer and calls
// `applyCompanyPatch`, so there is exactly one validated, transactional,
// audited path. The list-level PATCH /api/admin/companies (it wrote whatever
// strings arrived, with no audit row and no session revocation, and was the
// way around every confirm the company page adds) is deleted along with the
// list's quick-edit dialog (spec section 0 and section 4 step 4).
//
// Every branch runs inside ONE transaction with its StaffAction row; a
// change that cannot record itself does not happen. The customer's own
// audit row is written after commit, best effort (see staff-audit.ts).

import { prisma } from "@/lib/prisma";
import {
  logStaffAction,
  planLabel,
  statusLabel,
  writeTenantRow,
  type LoggedStaffAction,
  type StaffActor,
} from "@/lib/staff-audit";
import { setFeature } from "@/lib/enterprise-features";
import { writeOrgSettingsKeys } from "@/lib/org-settings-write";
import { confirmMatches, deletionSchedule, FEATURE_LABELS, statusRevokesSessions, type CompanyPatch } from "@/lib/admin/company-patch-rules";
import { seatsAreUnlimited } from "@/lib/admin/companies-list";
import { trialEndDay, trialEndFromDay, trialEndRefusal } from "@/lib/admin/trial-end";
import { MODULES } from "@/lib/modules";
import { subscriptionStillOpen } from "@/services/billing";
import { endWorkspaceConnections } from "@/lib/connectors/connections";

/** A company cancelled here is deleted this many days later, as an Owner's own delete is. */
const STAFF_CANCEL_GRACE_DAYS = 30;

export {
  VALID_PLANS,
  VALID_STATUSES,
  VALID_FEATURES,
  VALID_MODULES,
  MAX_SEATS,
  FEATURE_LABELS,
  validateCompanyPatch,
  statusRevokesSessions,
  confirmMatches,
  deletionSchedule,
  type DeletionSchedule,
  type CompanyPlan,
  type CompanyStatus,
  type CompanyPatch,
  type ValidatedPatch,
} from "@/lib/admin/company-patch-rules";

const SELF_LOCKOUT =
  "You belong to this workspace, so suspending it would sign you out of the console with no way back in. Ask another staff member to do it.";

export interface ApplyCompanyPatchInput {
  id: string;
  patch: CompanyPatch;
  actor: StaffActor;
  ip: string | null;
}

export type ApplyCompanyPatchResult =
  | {
      ok: true;
      /** Which fields actually changed; a value equal to the current one is not a write. */
      changed: CompanyPatchField[];
      /** How many people had every live session revoked (suspend or cancel). */
      signedOut: number;
      company: { id: string; name: string; slug: string; plan: string; status: string };
    }
  | { ok: false; status: 400 | 404 | 409; error: string };

export type CompanyPatchField = "plan" | "status" | "feature" | "seats" | "module" | "trialEnd";

/**
 * Applies the patch in one transaction with one StaffAction row per changed
 * field, and bumps `tokenVersion` on every anchored member with no other
 * healthy workspace when the new status is SUSPENDED or CANCELLED (their
 * live sessions die at the next five-minute check). Everyone else acting in
 * the company is moved to a healthy workspace by that same check.
 */
export async function applyCompanyPatch(input: ApplyCompanyPatchInput): Promise<ApplyCompanyPatchResult> {
  const { id, patch, actor, ip } = input;
  const logged: LoggedStaffAction[] = [];

  // A subscription stored as INCOMPLETE may be Stripe's unpaid or paused,
  // which still raise invoices (the row stores those, and the dead
  // incomplete_expired, the same way), so Stripe is asked before a company is
  // set to Cancelled, outside the transaction. Refused unless Stripe says it
  // has ended; refused too when Stripe cannot say.
  if (patch.status === "CANCELLED") {
    const sub = await prisma.subscription.findUnique({ where: { organizationId: id }, select: { stripeSubscriptionId: true, status: true } });
    if (sub?.stripeSubscriptionId && String(sub.status) === "INCOMPLETE") {
      const open = await subscriptionStillOpen(sub.stripeSubscriptionId).catch(() => null);
      if (open !== false) {
        return {
          ok: false,
          status: 409,
          error: open === null
            ? "Stripe could not be asked whether this company's subscription has ended. Check it in Stripe, cancel it there if it is still open, then set the company to Cancelled."
            : "This company has a Stripe subscription that can still bill (unpaid or paused). Cancel it in Stripe first, then set it to Cancelled: a cancelled company is deleted in 30 days and must not be billed.",
        };
      }
    }
  }

  const result = await prisma.$transaction(
    async (tx) => {
      // Row lock first: two staff members saving the same company at once
      // are serialised, so each StaffAction row's "before" is the value the
      // other write left, and the audit trail adds up.
      await tx.$queryRaw`SELECT "id" FROM "Organization" WHERE "id" = ${id} FOR UPDATE`;
      const org = await tx.organization.findUnique({
        where: { id },
        select: {
          id: true,
          name: true,
          slug: true,
          plan: true,
          status: true,
          settings: true,
          trialEndsAt: true,
          createdAt: true,
          subscription: { select: { stripeSubscriptionId: true, stripeCustomerId: true, status: true, billingMode: true, trialEndsAt: true } },
        },
      });
      if (!org) return null;

      // Refusals come first, before ANY field is written: returning from
      // this callback commits, so a refusal after the plan branch would
      // leave the plan changed under an error response.
      if (patch.status && patch.status !== org.status && statusRevokesSessions(patch.status)) {
        if (!confirmMatches(patch.confirm, org.name)) {
          return { refused: `Type the company name (${org.name}) to confirm.` };
        }
        if (actor.userId) {
          // A staff member who belongs to this workspace would sign
          // themselves out of the console and, with no healthy workspace to
          // fall back to, could not sign back in to undo it. Refuse; another
          // staff member does it.
          const self = await tx.user.findFirst({
            where: {
              id: actor.userId,
              OR: [{ organizationId: id }, { organizationMemberships: { some: { organizationId: id } } }],
            },
            select: { id: true },
          });
          if (self) return { refused: SELF_LOCKOUT };
        }
      }
      // A cancelled company is deleted 30 days later (below), so it must not
      // go on being billed: a live Stripe subscription is cancelled in Stripe
      // first (this console never calls Stripe).
      if (
        patch.status === "CANCELLED" &&
        org.status !== "CANCELLED" &&
        org.subscription?.stripeSubscriptionId &&
        ["ACTIVE", "TRIALING", "PAST_DUE"].includes(String(org.subscription.status))
      ) {
        return { refused: "This company has a live Stripe subscription. Cancel it in Stripe first, then set it to Cancelled: a cancelled company is deleted in 30 days and must not be billed." };
      }

      // Seats live on the subscription: with no subscription there is no
      // seat count to correct, and creating a Subscription row here would
      // invent a billing relationship nobody sold (and would make the
      // customer's own redeem refuse a code). Refused before any write.
      const sub =
        patch.seats !== undefined
          ? await tx.subscription.findUnique({ where: { organizationId: id }, select: { id: true, seats: true } })
          : null;
      if (patch.seats !== undefined && !sub) {
        return { refused: "This company has no subscription, so there is no seat count to change." };
      }
      // A self-serve trial's end is the company's own only while nothing else
      // decides it (src/lib/admin/trial-end.ts), judged on the status this
      // same patch leaves. Refused before any write.
      if (patch.trialEndsOn !== undefined) {
        const why = trialEndRefusal({
          status: patch.status ?? org.status,
          trialEndsAt: org.trialEndsAt,
          subscription: org.subscription,
        });
        if (why) return { refused: why };
      }
      // A module needs its Product row (seeded by scripts/seed-products.ts).
      // Missing on this server: say so and write nothing, never a 500.
      const moduleDef = patch.module ? MODULES.find((m) => m.appKey === patch.module!.key) ?? null : null;
      const product = moduleDef
        ? await tx.product.findUnique({ where: { slug: moduleDef.productSlug }, select: { id: true } })
        : null;
      if (moduleDef && !product) {
        return { conflict: `${moduleDef.label} is not set up on this server (its product row is missing), so nothing was changed.` };
      }

      const changed: CompanyPatchField[] = [];
      let signedOut = 0;
      let moved = 0;
      let scheduledFor: Date | null = null;
      let plan: string = org.plan;
      let status: string = org.status;

      if (patch.plan && patch.plan !== org.plan) {
        await tx.organization.update({ where: { id }, data: { plan: patch.plan } });
        logged.push(
          await logStaffAction({
            db: tx,
            action: "admin.org.plan_changed",
            actor,
            ip,
            targetCompanyId: id,
            targetLabel: org.name,
            summary: `Changed ${org.name}'s plan from ${planLabel(org.plan)} to ${planLabel(patch.plan)}`,
            before: { plan: org.plan },
            after: { plan: patch.plan },
          }),
        );
        changed.push("plan");
        plan = patch.plan;
      }

      if (patch.feature) {
        const settings = (org.settings && typeof org.settings === "object" ? org.settings : {}) as Record<string, unknown>;
        const flags = (settings.features && typeof settings.features === "object" ? settings.features : {}) as Record<
          string,
          boolean
        >;
        const was = Boolean(flags[patch.feature.key]);
        if (was !== patch.feature.enabled) {
          await setFeature(id, patch.feature.key, patch.feature.enabled, tx);
          const label = FEATURE_LABELS[patch.feature.key];
          logged.push(
            await logStaffAction({
              db: tx,
              action: "admin.org.feature_changed",
              actor,
              ip,
              targetCompanyId: id,
              targetLabel: org.name,
              summary: `Turned ${label} ${patch.feature.enabled ? "on" : "off"} for ${org.name}`,
              before: { feature: patch.feature.key, label, enabled: was },
              after: { feature: patch.feature.key, label, enabled: patch.feature.enabled },
            }),
          );
          changed.push("feature");
        }
      }

      if (patch.seats !== undefined && sub) {
        const was = seatsAreUnlimited(sub.seats) ? null : sub.seats;
        const next = patch.seats === 0 || seatsAreUnlimited(patch.seats) ? null : patch.seats;
        if (was !== next) {
          await tx.subscription.update({ where: { id: sub.id }, data: { seats: next ?? 0 } });
          logged.push(
            await logStaffAction({
              db: tx,
              action: "admin.org.seats_changed",
              actor,
              ip,
              targetCompanyId: id,
              targetLabel: org.name,
              summary: `Changed ${org.name}'s seats from ${was ?? "unlimited"} to ${next ?? "unlimited"}`,
              before: { seats: was },
              after: { seats: next },
            }),
          );
          changed.push("seats");
        }
      }

      if (moduleDef && product && patch.module) {
        const current = await tx.productInstallation.findUnique({
          where: { organizationId_productId: { organizationId: id, productId: product.id } },
          select: { id: true, status: true },
        });
        const was = current?.status === "ACTIVE";
        if (was !== patch.module.enabled) {
          if (patch.module.enabled) {
            // The same row the Owner's own switch writes. installedById stays
            // as it was: a WorkwrK employee is not a member of this company.
            await tx.productInstallation.upsert({
              where: { organizationId_productId: { organizationId: id, productId: product.id } },
              create: { organizationId: id, productId: product.id, status: "ACTIVE" },
              update: { status: "ACTIVE", pausedAt: null, removedAt: null },
            });
          } else {
            // Paused, not removed: nothing is deleted, and the Owner (or
            // staff) turns it back on with the same switch.
            await tx.productInstallation.update({
              where: { id: current!.id },
              data: { status: "PAUSED", pausedAt: new Date() },
            });
          }
          logged.push(
            await logStaffAction({
              db: tx,
              action: "admin.org.module_changed",
              actor,
              ip,
              targetCompanyId: id,
              targetLabel: org.name,
              summary: `Turned ${moduleDef.label} ${patch.module.enabled ? "on" : "off"} for ${org.name}`,
              before: { module: moduleDef.appKey, label: moduleDef.label, enabled: was },
              after: { module: moduleDef.appKey, label: moduleDef.label, enabled: patch.module.enabled },
            }),
          );
          changed.push("module");
        }
      }

      if (patch.status && patch.status !== org.status) {
        await tx.organization.update({ where: { id }, data: { status: patch.status } });

        // The deletion schedule (cancelledAt, cancelledById,
        // scheduledHardDeleteAt, read by /api/cron/org-hard-delete) never
        // survives a staff status change. Leaving CANCELLED clears it, the
        // same as /api/organizations/restore, so a stale past date can never
        // purge a company the next time it is cancelled.
        //
        // Entering CANCELLED schedules the same deletion an Owner's own
        // delete does, 30 days out, with its WorkspaceDeletion record: the
        // privacy policy promises a terminated workspace's data is deleted 30
        // days later, and a company cancelled here (a contract ended, terms
        // broken) used to be kept forever. cancelledById stays empty: no
        // person of the workspace asked. Setting any other status within the
        // 30 days cancels it, as before.
        const deletion = deletionSchedule(org.settings);
        if (deletion) {
          await writeOrgSettingsKeys(id, { cancelledAt: null, cancelledById: null, scheduledHardDeleteAt: null }, tx);
        }
        if (patch.status === "CANCELLED") {
          const at = new Date();
          scheduledFor = new Date(at.getTime() + STAFF_CANCEL_GRACE_DAYS * 86_400_000);
          await writeOrgSettingsKeys(id, { cancelledAt: at.toISOString(), cancelledById: null, scheduledHardDeleteAt: scheduledFor.toISOString() }, tx);
          await tx.workspaceDeletion.create({
            data: {
              // A staff cancellation's record: Staff Analytics reads the
              // wd_staff_ prefix as "Workspace cancelled" (from the console),
              // not "Deleted by its Owner", before and after the purge.
              id: `wd_staff_${id}_${at.getTime()}`,
              organizationId: id,
              plan: org.plan,
              signedUpAt: org.createdAt,
              requestedAt: at,
              stripeCustomerId: org.subscription?.stripeCustomerId ?? null,
              stripeSubscriptionId: org.subscription?.stripeSubscriptionId ?? null,
            },
          });
        }

        if (statusRevokesSessions(patch.status)) {
          // Everyone ANCHORED here: the same bump "Sign out everywhere"
          // uses, so every live token dies at its next check, at most five
          // minutes away. People who only hold a membership here and work
          // in another, healthy company are not signed out of it; if a
          // token of theirs is acting in this company, the session check in
          // lib/auth.ts moves it to a healthy one or revokes it.
          //
          // Only people with NO other healthy workspace are signed out this
          // way. An anchored member who also belongs to a healthy company is
          // left alone here: the same check sees this company is suspended
          // and moves their session into the healthy one. Bumping them too
          // would revoke the token before that move could run, throwing out
          // someone who was mostly working somewhere else.
          const bumped = await tx.user.updateMany({
            where: {
              organizationId: id,
              NOT: {
                organizationMemberships: {
                  some: {
                    organizationId: { not: id },
                    organization: { status: { notIn: ["SUSPENDED", "CANCELLED"] } },
                  },
                },
              },
            },
            data: { tokenVersion: { increment: 1 } },
          });
          signedOut = bumped.count;
          moved = await tx.user.count({ where: { organizationId: id } }) - signedOut;
        }
        logged.push(
          await logStaffAction({
            db: tx,
            action: "admin.org.status_changed",
            actor,
            ip,
            targetCompanyId: id,
            targetLabel: org.name,
            summary: `Set ${org.name} from ${statusLabel(org.status)} to ${statusLabel(patch.status)}${
              statusRevokesSessions(patch.status) ? `, signing out ${signedOut} ${signedOut === 1 ? "person" : "people"}` : ""
            }${moved > 0 ? ` (${moved} more moved to another workspace they belong to)` : ""}${deletion?.scheduledHardDeleteAt ? `, and cancelled the deletion scheduled for ${deletion.scheduledHardDeleteAt.slice(0, 10)}` : ""}${scheduledFor ? `; its data is deleted for good on ${scheduledFor.toISOString().slice(0, 10)} unless it is set back before then` : ""}`,
            before: { status: org.status, ...(deletion ? { deletionSchedule: deletion } : {}) },
            after: { status: patch.status, signedOut, movedToOtherWorkspace: moved, ...(scheduledFor ? { scheduledHardDeleteAt: scheduledFor.toISOString() } : {}) },
          }),
        );
        changed.push("status");
        status = patch.status;
      }

      if (patch.trialEndsOn !== undefined) {
        const was = org.trialEndsAt;
        const next = patch.trialEndsOn === null ? null : trialEndFromDay(patch.trialEndsOn);
        if ((was?.getTime() ?? null) !== (next?.getTime() ?? null)) {
          await tx.organization.update({ where: { id }, data: { trialEndsAt: next } });
          const day = (d: Date | null) => (d ? trialEndDay(d) : "none");
          logged.push(
            await logStaffAction({
              db: tx,
              action: "admin.org.trial_end_changed",
              actor,
              ip,
              targetCompanyId: id,
              // No name in this row: while the company exists the audit
              // page names it through the link, and once it is deleted for
              // good nothing kept may name it.
              targetLabel: null,
              summary: next ? `Set the trial end from ${day(was)} to ${day(next)}` : `Cleared the trial end (was ${day(was)})`,
              before: { trialEndsAt: was?.toISOString() ?? null },
              after: { trialEndsAt: next?.toISOString() ?? null },
            }),
          );
          changed.push("trialEnd");
        }
      }

      return { changed, signedOut, company: { id: org.id, name: org.name, slug: org.slug, plan, status } };
    },
    { timeout: 20_000 },
  );

  if (!result) return { ok: false, status: 404, error: "Company not found" };
  // A string check, not just "in": the transaction's return shapes are
  // normalised into one object type, so "in" alone does not narrow it.
  if ("refused" in result && typeof result.refused === "string") return { ok: false, status: 400, error: result.refused };
  if ("conflict" in result && typeof result.conflict === "string") return { ok: false, status: 409, error: result.conflict };

  // The customer's half, after commit and best effort.
  for (const row of logged) void writeTenantRow(row);

  // A company closed here is deleted in 30 days, as an Owner's own delete
  // is: its Google connections for AI teammates end now, as the system (no
  // person of the workspace acted), and Google is told
  // (docs/plans/ai-teammates-phase3.md Decision 20). Never failing the patch:
  // the cron sweep ends any this misses on its next tick (review of step 2).
  if (result.changed?.includes("status") && result.company?.status === "CANCELLED") {
    await endWorkspaceConnections(id, "workspace_deleted", null).catch((e) => {
      console.error(`[connectors] staff closure hook failed: ${e instanceof Error ? e.message.split("\n").pop() : String(e)}`);
    });
  }

  return { ok: true, ...result };
}
