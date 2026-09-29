// The one place a staff member's change to a company is applied
// (spec-admin-backoffice section 2.3 Data, section 4 steps 1 and 2a).
//
// Both PATCH routes (`/api/admin/companies` and `/api/admin/companies/[id]`)
// call `applyCompanyPatch`, so there is exactly one validated, transactional,
// audited path: the list-level endpoint used to write whatever strings
// arrived, with no audit row and no session revocation, and was the way
// around every confirm the company page adds.
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
import { FEATURE_LABELS, statusRevokesSessions, type CompanyPatch } from "@/lib/admin/company-patch-rules";

export {
  VALID_PLANS,
  VALID_STATUSES,
  VALID_FEATURES,
  FEATURE_LABELS,
  validateCompanyPatch,
  statusRevokesSessions,
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
      changed: ("plan" | "status" | "feature")[];
      /** How many people had every live session revoked (suspend or cancel). */
      signedOut: number;
      company: { id: string; name: string; slug: string; plan: string; status: string };
    }
  | { ok: false; status: 400 | 404; error: string };

/**
 * Applies the patch in one transaction with one StaffAction row per changed
 * field, and bumps `tokenVersion` on every member when the new status is
 * SUSPENDED or CANCELLED (every live session dies at its next five-minute
 * check; the JWT callback also revokes on the workspace status itself).
 */
export async function applyCompanyPatch(input: ApplyCompanyPatchInput): Promise<ApplyCompanyPatchResult> {
  const { id, patch, actor, ip } = input;
  const logged: LoggedStaffAction[] = [];

  const result = await prisma.$transaction(
    async (tx) => {
      const org = await tx.organization.findUnique({
        where: { id },
        select: { id: true, name: true, slug: true, plan: true, status: true, settings: true },
      });
      if (!org) return null;

      const changed: ("plan" | "status" | "feature")[] = [];
      let signedOut = 0;
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

      if (patch.status && patch.status !== org.status) {
        if (statusRevokesSessions(patch.status) && actor.userId) {
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
        await tx.organization.update({ where: { id }, data: { status: patch.status } });
        if (statusRevokesSessions(patch.status)) {
          // Everyone anchored here plus everyone reachable through a
          // membership: the same bump "Sign out everywhere" uses, so every
          // live token dies at its next check, at most five minutes away.
          const bumped = await tx.user.updateMany({
            where: {
              OR: [{ organizationId: id }, { organizationMemberships: { some: { organizationId: id } } }],
            },
            data: { tokenVersion: { increment: 1 } },
          });
          signedOut = bumped.count;
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
            }`,
            before: { status: org.status },
            after: { status: patch.status, signedOut },
          }),
        );
        changed.push("status");
        status = patch.status;
      }

      return { changed, signedOut, company: { id: org.id, name: org.name, slug: org.slug, plan, status } };
    },
    { timeout: 20_000 },
  );

  if (!result) return { ok: false, status: 404, error: "Company not found" };
  // A string check, not just "in": the transaction's return shapes are
  // normalised into one object type, so "in" alone does not narrow it.
  if ("refused" in result && typeof result.refused === "string") return { ok: false, status: 400, error: result.refused };

  // The customer's half, after commit and best effort.
  for (const row of logged) void writeTenantRow(row);

  return { ok: true, ...result };
}
