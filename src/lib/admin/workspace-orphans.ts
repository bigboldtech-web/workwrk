// The tables a company's hard delete does not reach by cascade: each has an
// organizationId and no foreign key to Organization (checked against
// pg_constraint, 2026-10-05), so without a delete by organizationId its rows
// would outlive the company for good, against the privacy policy's promise to
// delete workspace data 30 days after termination. Rows of the few whose
// parent does cascade go anyway and are listed too, so this is the whole set.
// WorkspaceDeletion is NOT here: it is kept on purpose, with no name in it.
//
// No foreign key points into these tables except ones that cascade
// (AgreementParty, KudosReaction), so deleting their rows cannot fail a
// transaction. Read by the hard-delete cron (/api/cron/org-hard-delete) and by
// scripts/purge-deleted-workspace-orphans.ts, for companies deleted before it.

export const WORKSPACE_ORPHAN_TABLES = [
  "ActivityLog", "Agreement", "AutomationRunStep", "AutomationWorkflowVersion", "CallSession", "ConsentRecord",
  "ContentSnapshot", "EmailLog", "ExternalData", "ItemTemplate", "ItemType", "ItemUpdateAttachment", "ItemUpdateReaction",
  "Kudos", "LegacyRedirect", "MeetingTemplate", "PerformanceScore", "ProcessRun", "Reminder", "TalentAssessment",
  "TalkUpdateRun", "Template", "TrashItem",
] as const;

export type WorkspaceOrphanTable = (typeof WORKSPACE_ORPHAN_TABLES)[number];

export function isWorkspaceOrphanTable(name: string): name is WorkspaceOrphanTable {
  return (WORKSPACE_ORPHAN_TABLES as readonly string[]).includes(name);
}
