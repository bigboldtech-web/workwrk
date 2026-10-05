// The two setup milestones the staff console's funnel counts, as where
// clauses. Shared by GET /api/admin/analytics (live companies) and the
// hard-delete cron (/api/cron/org-hard-delete), which records both for a
// company in WorkspaceDeletion before it is deleted for good, so a deleted
// company keeps the place in the funnel it had earned. One definition, so the
// two can never disagree about what "finished setup" means.

import type { Prisma } from "@/generated/prisma";

/** Finished the setup console. */
export const SETUP_DONE: Prisma.OrganizationWhereInput = { settings: { path: ["setupCompleted"], equals: true } };

/** Created something: any SOP, KRA, task or List item. */
export const CREATED_SOMETHING: Prisma.OrganizationWhereInput = {
  OR: [{ sops: { some: {} } }, { kras: { some: {} } }, { tasks: { some: {} } }, { items: { some: {} } }],
};
