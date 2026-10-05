// What the audit log retention purge (POST /api/cron/audit-purge) may never
// delete. ActivityLog is the audit log AND, for a few features, the only
// place their state lives; a retention window is about history, never about
// breaking a feature. Every row here is read back by something:
//
//   weekly_review_decided   who else decided a weekly review (lib/weekly-review.ts,
//                           lib/people/weekly-queue.server.ts, the manager-review route)
//   okr_created             who created each goal, which decides who may edit it
//                           (lib/alignment-scope.ts)
//   user.invited            the invite facts on /join (lib/auth/invite-facts.server.ts)
//   access.invited          who shared a node with whom (lib/access/grants.ts)
//   access.matrix_retired   the only copy of the retired permissions grid
//                           (/api/settings/matrix-export)
//   access.migrated         the access backfill's record (scripts/MIGRATIONS.md)
//   settings.updated.access an Admin's change to the access settings, and
//   access.settings.migrated  the proof the public SOP link carry-over reads
//   access.settings.restored  before it may turn Public links on: without
//                           them an Admin's Off could not be told from a
//                           value nobody chose (scripts/migrate-public-sop-links.ts,
//                           scripts/repair-deploy-data-steps.ts)
//   terms.*                 consent: which policy version a person accepted
//   staff.*                 WorkwrK staff actions in this company (lib/staff-audit.ts)
//   audit.purged            the purge's own record
import type { Prisma } from "@/generated/prisma";

export const AUDIT_PURGE_KEEP_TYPES: readonly string[] = [
  "weekly_review_decided",
  "okr_created",
  "user.invited",
  "access.invited",
  "access.matrix_retired",
  "access.migrated",
  "settings.updated.access",
  "access.settings.migrated",
  "access.settings.restored",
  "audit.purged",
];
export const AUDIT_PURGE_KEEP_PREFIXES: readonly string[] = ["terms.", "staff."];

/** Whether the purge may delete a row of this type (pure; tested). */
export function auditPurgeMayDelete(type: string): boolean {
  if (AUDIT_PURGE_KEEP_TYPES.includes(type)) return false;
  return !AUDIT_PURGE_KEEP_PREFIXES.some((p) => type.startsWith(p));
}

/** The purge's row filter for one org and cut-off. */
export function auditPurgeWhere(organizationId: string, cutoff: Date): Prisma.ActivityLogWhereInput {
  return {
    organizationId,
    createdAt: { lt: cutoff },
    type: { notIn: [...AUDIT_PURGE_KEEP_TYPES] },
    NOT: AUDIT_PURGE_KEEP_PREFIXES.map((p) => ({ type: { startsWith: p } })),
  };
}
