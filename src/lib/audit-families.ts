// The Audit log's tabs (spec-settings-workspace `/settings/audit`): All,
// Access, Security, Data and Settings, each a SERVER-SIDE family of event
// types, so a tab filters the whole log and not the rows already loaded.
// Pure; tested. A type matches a family by exact name or by prefix (a
// prefix ends in "." or "_").

export const AUDIT_FAMILIES = ["all", "access", "security", "data", "settings"] as const;
export type AuditFamily = (typeof AUDIT_FAMILIES)[number];

export const AUDIT_FAMILY_LABELS: Record<AuditFamily, string> = {
  all: "All",
  access: "Access",
  security: "Security",
  data: "Data",
  settings: "Settings",
};

const FAMILY_MATCH: Record<Exclude<AuditFamily, "all">, string[]> = {
  access: [
    "access.", "org_role.", "membership.", "visibility.", "user.invited", "user_added", "user_removed",
    "reporting_line_changed", "org.switch.", "invitation.",
  ],
  security: ["security.", "login", "logout", "mfa_", "password_", "signed_out_all_devices", "auth.", "terms.", "sso."],
  data: ["data.", "csv_exported", "tenant_export", "audit.purged", "legacy_marketing_imported", "import."],
  settings: ["settings.", "staff.", "organization_", "module.", "apps."],
};

export function isAuditFamily(v: unknown): v is AuditFamily {
  return typeof v === "string" && (AUDIT_FAMILIES as readonly string[]).includes(v);
}

/** Whether one type belongs to a family (tested). */
export function typeInFamily(type: string, family: AuditFamily): boolean {
  if (family === "all") return true;
  return FAMILY_MATCH[family].some((m) => (m.endsWith(".") || m.endsWith("_") ? type.startsWith(m) : type === m || type.startsWith(`${m}.`)));
}

/** The Prisma `type` condition for a family (null for All). */
export function familyWhere(family: AuditFamily): { OR: ({ type: { startsWith: string } } | { type: string })[] } | null {
  if (family === "all") return null;
  return {
    OR: FAMILY_MATCH[family].flatMap((m) =>
      m.endsWith(".") || m.endsWith("_") ? [{ type: { startsWith: m } }] : [{ type: m }, { type: { startsWith: `${m}.` } }],
    ),
  };
}

/** The date-range presets of the filter panel, as a lower bound (tested). */
export const AUDIT_RANGES = ["today", "7d", "30d", "90d"] as const;
export type AuditRange = (typeof AUDIT_RANGES)[number];
export function rangeStart(range: string | null, now: Date = new Date()): Date | null {
  if (range === "today") return new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const days = range === "7d" ? 7 : range === "30d" ? 30 : range === "90d" ? 90 : 0;
  return days ? new Date(now.getTime() - days * 86_400_000) : null;
}

/** "Who" for a row: a person, or the named non-person actor (tested). */
export function actorLabelOf(row: {
  actorType?: string | null;
  actorLabel?: string | null;
  actor?: { firstName?: string | null; lastName?: string | null; email?: string | null } | null;
}): string {
  if (row.actor) return `${row.actor.firstName ?? ""} ${row.actor.lastName ?? ""}`.trim() || row.actor.email || "Someone";
  if (row.actorLabel) return row.actorLabel;
  switch (row.actorType) {
    case "platform_staff": return "WorkwrK Support";
    case "api_key": return "API key";
    case "agent": return "Agent";
    case "scim": return "Identity provider";
    default: return "System";
  }
}

const LEVEL_WORDS: Record<string, string> = {
  SUPER_ADMIN: "Owner",
  COMPANY_ADMIN: "Admin",
  C_LEVEL: "Executive",
  VP: "VP",
  DIRECTOR: "Director",
  MANAGER: "Manager",
  TEAM_LEAD: "Team lead",
  EMPLOYEE: "Member",
  AGENT: "Agent",
  HR: "People team (HR)",
};

/**
 * An older audit sentence can carry a raw access level ("Invited ana@x as
 * EMPLOYEE"); the log prints the word a person reads (tested). Only whole
 * upper-case tokens are replaced, so an email or a name is never touched.
 */
export function humanizeAuditSentence(text: string): string {
  return text.replace(/\b(SUPER_ADMIN|COMPANY_ADMIN|C_LEVEL|TEAM_LEAD|EMPLOYEE|DIRECTOR|MANAGER|AGENT|VP)\b/g, (m) => LEVEL_WORDS[m] ?? m);
}
