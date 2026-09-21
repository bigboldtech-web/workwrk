// settings.process (spec-process section 2 `/sops/manage`, section 4 step 7):
// the org-wide process taxonomies and the acknowledgement defaults, one JSON
// section on Organization.settings with a strict schema, so a stray key is a
// 400 and never a silent strip.
//
//   policyCategories   the Policy categories tab (seeded once from the old
//                      datalist on the policy page)
//   contractFolders    the Contract folders tab (seeded once from the old
//                      CATEGORY_OPTIONS array on the Contracts pages)
//   ackStatement       read by /policies/[id] as the placeholder and by
//                      POST /api/policies/[id]/acknowledge when the policy
//                      sets none of its own
//   ackDueDays         read by AssignDialog as the default "Acknowledge by"
//                      and by POST /api/policies/[id]/assignments
//   ackRemindDays      read by the send-reminders cron (0 = off)
//
// Pure module apart from zod, so vitest proves the seeds, the parse and the
// list edits without a database.

import { z } from "zod";

/** The seven categories the policy page's datalist carried before Organize. */
export const POLICY_CATEGORY_SEEDS: readonly string[] = ["HR", "Security", "Compliance", "Operations", "Code of Conduct", "Leave", "Expense"];
/** The eight folders the Contracts pages' CATEGORY_OPTIONS carried before Organize. */
export const CONTRACT_FOLDER_SEEDS: readonly string[] = ["SLA", "NDA", "Vendor", "Employment", "Partner", "Sales", "Service", "Other"];

/**
 * The attestation every acknowledgement is recorded against when neither the
 * policy nor the org sets one. It is the sentence every existing
 * PolicyAcknowledgment row already carries, so the evidence chain stays
 * consistent across the release.
 */
export const DEFAULT_ACK_STATEMENT = "I have read, understood, and agree to comply with this policy.";

const nameList = z.array(z.string().trim().min(1).max(60)).max(200);

export const processSettingsSchema = z.strictObject({
  policyCategories: nameList,
  contractFolders: nameList,
  ackStatement: z.string().trim().max(1000),
  ackDueDays: z.number().int().min(0).max(365).nullable(),
  ackRemindDays: z.number().int().min(0).max(90),
});

/** PATCH accepts any subset; every present key is validated in full. */
export const processSettingsPatchSchema = processSettingsSchema.partial().strict();

export type ProcessSettings = z.infer<typeof processSettingsSchema>;
export type ProcessSettingsPatch = z.infer<typeof processSettingsPatchSchema>;

export const DEFAULT_PROCESS_SETTINGS: ProcessSettings = {
  policyCategories: [...POLICY_CATEGORY_SEEDS],
  contractFolders: [...CONTRACT_FOLDER_SEEDS],
  ackStatement: DEFAULT_ACK_STATEMENT,
  ackDueDays: null,
  ackRemindDays: 0,
};

/** Trim, drop blanks, dedupe case-insensitively (first spelling wins). */
export function dedupeNames(list: readonly string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of list) {
    const name = String(raw ?? "").trim();
    if (!name) continue;
    const key = name.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(name);
  }
  return out;
}

/**
 * Read the stored section, filling every missing key with its default. The
 * two lists are SEEDED (not merely defaulted) when they are absent: the
 * caller writes the parsed value back once so the seed happens exactly once
 * per org (`seeded` says whether that write is needed).
 */
export function parseProcessSettings(raw: unknown): { value: ProcessSettings; seeded: boolean } {
  const r = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  const hasPolicies = Array.isArray(r.policyCategories);
  const hasContracts = Array.isArray(r.contractFolders);
  const value: ProcessSettings = {
    policyCategories: hasPolicies ? dedupeNames(r.policyCategories as string[]) : [...POLICY_CATEGORY_SEEDS],
    contractFolders: hasContracts ? dedupeNames(r.contractFolders as string[]) : [...CONTRACT_FOLDER_SEEDS],
    ackStatement: typeof r.ackStatement === "string" && r.ackStatement.trim() ? r.ackStatement.trim() : DEFAULT_ACK_STATEMENT,
    ackDueDays: typeof r.ackDueDays === "number" && Number.isInteger(r.ackDueDays) && r.ackDueDays >= 0 ? r.ackDueDays : null,
    ackRemindDays: typeof r.ackRemindDays === "number" && Number.isInteger(r.ackRemindDays) && r.ackRemindDays >= 0 ? r.ackRemindDays : 0,
  };
  return { value, seeded: !hasPolicies || !hasContracts };
}

/** Rename one entry everywhere in a list; renaming onto an existing name merges. */
export function renameListEntry(list: readonly string[], from: string, to: string): string[] {
  const next = to.trim();
  if (!next) return dedupeNames(list);
  return dedupeNames(list.map((n) => (n === from ? next : n)));
}

export function removeListEntry(list: readonly string[], name: string): string[] {
  return dedupeNames(list.filter((n) => n !== name));
}

export function addListEntry(list: readonly string[], name: string): string[] {
  return dedupeNames([...list, name]);
}

/** "Acknowledge by" default: today plus the org's ackDueDays, as YYYY-MM-DD, or null when unset. */
export function defaultAckDueDate(ackDueDays: number | null, now: Date = new Date()): string | null {
  if (ackDueDays === null || ackDueDays <= 0) return null;
  const d = new Date(now.getTime() + ackDueDays * 86_400_000);
  return d.toISOString().slice(0, 10);
}
