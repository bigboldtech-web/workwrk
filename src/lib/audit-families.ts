// The Audit log's tabs (spec-settings-workspace `/settings/audit`): All,
// Access, Security, Data and Settings, each a SERVER-SIDE family of event
// types, so a tab filters the whole log and not the rows already loaded.
// Pure; tested. A type matches a family by exact name or by prefix (a
// prefix ends in "." or "_").
//
// The MCP server (docs/plans/mcp-server.md 7): each change an AI app made
// (mcp.tool.*) is Data, and an app connected, disconnected or caught using a
// key twice (mcp.app.*) is Security. Who made a change an app made as a
// person reads "Max Member via Claude (MCP)" (actorLabelOf).

import { MCP_AUDIT_COPY, MCP_VIA_COPY } from "@/lib/mcp/mcp-copy";
import { SECURITY_EVENT_LABEL } from "@/lib/account/security-events";

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
  security: ["security.", "login", "logout", "mfa_", "password_", "signed_out_all_devices", "auth.", "terms.", "sso.", "mcp.app."],
  data: ["data.", "csv_exported", "tenant_export", "audit.purged", "legacy_marketing_imported", "import.", "mcp.tool."],
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

/**
 * "Who" for a row: a person, or the named non-person actor (tested). A
 * change an AI app made as a person (actorType "mcp", actorLabel
 * "<app> (MCP)") names both: "Max Member via Claude (MCP)".
 */
export function actorLabelOf(row: {
  actorType?: string | null;
  actorLabel?: string | null;
  actor?: { firstName?: string | null; lastName?: string | null; email?: string | null } | null;
}): string {
  if (row.actor) {
    const person = `${row.actor.firstName ?? ""} ${row.actor.lastName ?? ""}`.trim() || row.actor.email || "Someone";
    return row.actorType === "mcp" && row.actorLabel ? MCP_VIA_COPY.personVia(person, row.actorLabel) : person;
  }
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
  HR: "People team",
};

/**
 * An older audit sentence can carry a raw access level ("Invited ana@x as
 * EMPLOYEE"); the log prints the word a person reads (tested). Only whole
 * upper-case tokens are replaced, so an email or a name is never touched.
 */
export function humanizeAuditSentence(text: string): string {
  return text.replace(/\b(SUPER_ADMIN|COMPANY_ADMIN|C_LEVEL|TEAM_LEAD|EMPLOYEE|DIRECTOR|MANAGER|AGENT|VP)\b/g, (m) => LEVEL_WORDS[m] ?? m);
}

/**
 * The word the log shows for a stored target type ("user" is "Person",
 * "scim_token" is "SCIM token"), never the raw key (tested). Unknown types
 * are spaced and capitalised rather than shown as code.
 */
const TARGET_WORDS: Record<string, string> = {
  user: "Person",
  organization: "Workspace",
  invitation: "Invitation",
  export: "Export",
  scim_token: "SCIM token",
  api_key: "API key",
  apikey: "API key",
  webhook_subscription: "Webhook",
  identity_provider: "Identity provider",
  okr: "Goal",
  kra: "KRA",
  sop: "SOP",
  doc: "Doc",
  file: "File",
  datatable: "Table",
  formdefinition: "Form",
  reviewcycle: "Review cycle",
  review_cycle: "Review cycle",
  weekly_review: "Weekly review",
  process_run: "Process run",
  talent_assessment: "Talent assessment",
  candor_session: "Candor session",
  budget_plan: "Budget plan",
  purchase_order: "Purchase order",
  fiscal_year: "Fiscal year",
  appsumo_code: "AppSumo code",
  space: "Space",
  folder: "Folder",
  board: "List",
  list: "List",
  // The MCP server's audit rows (docs/plans/mcp-server.md 7): a task an app
  // changed, and the connection an mcp.app.* row is about.
  item: "Task",
  oauth_grant: MCP_AUDIT_COPY.targetWord,
};

export function targetTypeWord(type: string | null | undefined): string {
  if (!type) return "";
  const k = type.toLowerCase();
  if (TARGET_WORDS[k]) return TARGET_WORDS[k];
  const spaced = type.replace(/([a-z])([A-Z])/g, "$1 $2").replace(/[_.]+/g, " ").trim().toLowerCase();
  return spaced.charAt(0).toUpperCase() + spaced.slice(1);
}

const VALUE_WORDS: Record<string, string> = {
  ...LEVEL_WORDS,
  OWNER: "Owner",
  ADMIN: "Admin",
  MEMBER: "Member",
  GUEST: "Guest",
  ACTIVE: "Active",
  INACTIVE: "Deactivated",
  ON_LEAVE: "On leave",
  PROBATION: "Probation",
  PIP: "Improvement plan",
  NOTICE_PERIOD: "Notice period",
};

/** A before or after value in words: enums become the words a person reads, objects stay compact (tested). */
export function auditValueWords(v: unknown): string {
  if (v === undefined || v === null || v === "") return "·";
  if (typeof v === "string") return VALUE_WORDS[v] ?? humanizeAuditSentence(v);
  if (typeof v === "boolean") return v ? "On" : "Off";
  if (typeof v === "number") return String(v);
  if (Array.isArray(v)) return v.length === 0 ? "None" : v.map((x) => auditValueWords(x)).join(", ");
  return JSON.stringify(v);
}

// The words a stored event key is spelled with that read differently.
const TYPE_TOKEN_WORDS: Record<string, string> = {
  api: "API",
  ai: "AI",
  mcp: "MCP",
  scim: "SCIM",
  sso: "SSO",
  csv: "CSV",
  kpi: "KPI",
  kra: "KRA",
  okr: "OKR",
  sop: "SOP",
  id: "ID",
  url: "URL",
  oauth: "OAuth",
  appsumo: "AppSumo",
  mfa: "two step verification",
  org: "workspace",
  organization: "workspace",
};

/**
 * An event type in words, for the Audit log's Filter > Type (tested): the
 * stored key ("api_key_created", "org_role.changed") is never shown. The
 * words My settings > Security uses for a sign-in event, and the MCP
 * server's own words for an AI app's rows, where they exist; else the key
 * spelled out ("API key created", "Workspace role changed").
 */
export function auditTypeWords(type: string): string {
  const known = SECURITY_EVENT_LABEL[type];
  if (known) return known;
  const tool = /^mcp\.tool\.(.+)$/.exec(type)?.[1];
  if (tool && Object.prototype.hasOwnProperty.call(MCP_AUDIT_COPY.tools, tool)) return MCP_AUDIT_COPY.tools[tool as keyof typeof MCP_AUDIT_COPY.tools];
  if (type === "mcp.app.connected") return MCP_AUDIT_COPY.connected;
  if (type === "mcp.app.revoked") return MCP_AUDIT_COPY.revoked;
  if (type === "mcp.app.reuse_detected") return MCP_AUDIT_COPY.reuse;
  const words = type
    .replace(/([a-z])([A-Z])/g, "$1 $2")
    .split(/[\s._:-]+/)
    .filter(Boolean)
    .map((w) => TYPE_TOKEN_WORDS[w.toLowerCase()] ?? w.toLowerCase());
  const out = words.join(" ");
  return out ? out.charAt(0).toUpperCase() + out.slice(1) : type;
}

/** A before/after key in words ("inviteExpiryDays" is "Invite expiry days"). */
export function auditKeyWords(k: string): string {
  if (k === "level") return "Tier";
  const spaced = k.replace(/([a-z])([A-Z])/g, "$1 $2").replace(/[_.]+/g, " ").trim().toLowerCase();
  return spaced.charAt(0).toUpperCase() + spaced.slice(1);
}
