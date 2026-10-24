// The activity rows about one person's own AI teammate work (review round 1
// of Phase 4): what a teammate did in their browser and in their Google, and
// the person's own browser sessions, take overs and Google connection.
//
// WHO READS THEM. The person they are about, and Owners and Admins. The
// privacy page says a teammate's browser steps are kept for the person
// alone and that Owners and Admins see in the audit log which sites a
// teammate opened for them (docs/plans/ai-teammates-phase4.md Decisions 23
// and 24); the Phase 3 Google rows say when a teammate sent mail or changed
// a calendar, with Google's ids. So, beside ACCESS_ACTIVITY_TYPES
// (./access-activity.ts):
//   - the home dashboard (/api/dashboard) never shows them, to anyone;
//   - /api/activity shows them in My team and Everyone only to an Owner or an
//     Admin, and otherwise, in every scope, only to the person they are about
//     (aboutViewer: the row's actingForId, or its actor when it names no one
//     it acts for; a connection row's person);
//   - /api/audit (Owners and Admins) shows them whole, and a browser
//     session's end with its sites (browserSessionAuditSummary);
//   - the person's data export (/api/me/export) holds Just me's rows whole
//     (myActivityWhere, activityLogs), and in a list of its own the personal
//     rows they wrote about someone else, trimmed to the writer's part
//     (exportWrittenAboutOthersWhere, activityAboutOthers; review rounds 3
//     and 4 of Phase 4), each list with its own cap and left-out count.
// Managers and the People team no longer see their reports' teammate
// browser and Google rows in Activity.
//
// AI APPS (MCP) TOO (final review of the MCP server, privacy H1). A person's
// AI app rows (docs/plans/mcp-server.md 7) are theirs in the same way: an
// app connected, disconnected for any reason, or caught using a key twice
// (mcp.app.*, written with actingForId the person), and every change an app
// made as them (mcp.tool.<tool>, one for each write tool in
// MCP_AUDIT_COPY.tools, so a tool added later is personal from its first
// row). The privacy page says Owners and Admins see them in the audit log;
// a manager's My team, the People team's Everyone, the home dashboard and
// Ask AI's context read them no more. The person's Just me and export keep
// them, through actingForId; an Admin's export holds an Admin's own
// disconnects of other people's apps (admin_off) as the writer's part only.
//
// WHICH ROWS. Every agent.<tool> row of a Google, browser or skill tool
// (derived from the tool lists, so a tool added later is personal from its
// first row), the browser rows about one person's session, every
// teammate_connection row, and every row about one person's own skills
// (docs/plans/ai-teammates-phase5.md Decision 24: recorded, saved, changed,
// deleted, made a routine; hosts and counts only, never a skill's name, a
// step's words or a value). The workspace's own configuration rows stay as
// they are (WORKSPACE_TEAMMATE_ACTIVITY_TYPES): the switch, Stop every
// browser, the sites lists, the Google policy, and Phase 5's skills switch
// and Delete every skill (a count only).
//
// Pure: imports the tool name lists, the MCP copy (for its tool names) and
// types only.

import type { Prisma } from "@/generated/prisma";
import { BROWSER_TOOL_NAMES, CONNECTOR_TOOL_NAMES, SKILL_TOOL_NAMES } from "@/lib/agents/tool-names";
import { MCP_AUDIT_COPY, MCP_WRITER_PART_COPY } from "@/lib/mcp/mcp-copy";
import type { ActivityScope } from "@/lib/activity-scope";
import type { Viewer } from "./types";

/** The browser rows about one person's session (src/lib/browser/sessions.ts, take-over.ts). */
const PERSONAL_BROWSER_TYPES = ["teammate_browser.take_over", "teammate_browser.session_started", "teammate_browser.session_ended"] as const;

/** The person's own Google connection (src/lib/connectors/connections.ts). */
const PERSONAL_CONNECTION_TYPES = ["teammate_connection.connected", "teammate_connection.disconnected", "teammate_connection.needs_reconnect"] as const;

/**
 * The rows about one person's own skills (Phase 5 Decision 24), each about
 * its acting person ("acted", aboutViewer): a recording's start and end,
 * a skill saved, changed or deleted, and a routine made from one.
 */
export const PERSONAL_SKILL_TYPES = ["teammate_skill.recording", "teammate_skill.saved", "teammate_skill.changed", "teammate_skill.deleted", "teammate_skill.routine"] as const;

/**
 * A person's own AI app (MCP) rows (final review of the MCP server, privacy
 * H1), each about its acting person ("acted", aboutViewer): src/lib/oauth/
 * grants.ts writes the mcp.app.* rows and src/lib/mcp/registry.ts
 * auditWrite one mcp.tool.<tool> row for each write that changed something,
 * every one with actingForId the person.
 */
export const PERSONAL_MCP_TYPES: readonly string[] = [
  "mcp.app.connected",
  "mcp.app.revoked",
  "mcp.app.reuse_detected",
  ...Object.keys(MCP_AUDIT_COPY.tools).map((t) => `mcp.tool.${t}`),
];

export const PERSONAL_TEAMMATE_ACTIVITY_TYPES: readonly string[] = [
  // executor.ts auditAgentAction writes `agent.${toolName}`.
  ...CONNECTOR_TOOL_NAMES.map((n) => `agent.${n}`),
  ...BROWSER_TOOL_NAMES.map((n) => `agent.${n}`),
  ...SKILL_TOOL_NAMES.map((n) => `agent.${n}`),
  ...PERSONAL_BROWSER_TYPES,
  ...PERSONAL_CONNECTION_TYPES,
  ...PERSONAL_SKILL_TYPES,
  ...PERSONAL_MCP_TYPES,
];

/**
 * The workspace's own teammate configuration rows, which stay readable as
 * before: written by Owners, Admins and a teammate's managers about the
 * workspace or a teammate, never about one person's browsing or mail.
 */
export const WORKSPACE_TEAMMATE_ACTIVITY_TYPES: readonly string[] = [
  "teammate_browser.changed",
  "teammate_browser.stopped_all",
  "teammate_browser.sites_changed",
  "teammate_browser.site_changed",
  "teammate_connectors.changed",
  "teammate_connectors.disconnect_all_started",
  "teammate_connectors.disconnected_all",
  // Phase 5: the skills switch, and Delete every skill (its count only).
  "teammate_browser.skills_changed",
  "teammate_browser.skills_deleted_all",
];

const PERSONAL_SET: ReadonlySet<string> = new Set(PERSONAL_TEAMMATE_ACTIVITY_TYPES);

export function isPersonalTeammateActivityType(type: string | null | undefined): boolean {
  return !!type && PERSONAL_SET.has(type);
}

/** The personal rows that are about the person their actor acted for, or else their actor. */
const ACTED_TYPES: readonly string[] = PERSONAL_TEAMMATE_ACTIVITY_TYPES.filter((t) => !(PERSONAL_CONNECTION_TYPES as readonly string[]).includes(t));

/**
 * The personal rows about this person, as a where clause. A teammate's act,
 * a browser session and a take over are about the person the row acts for
 * (actingForId), or, on a row that names no one, its actor. A connection
 * row is about the person whose Google it is, its target (connections.ts
 * writes targetType "user" and the person's id on every one). So a manager
 * who ended a report's browser or removed their Google, and an Admin who
 * stopped every browser, is the actor of a row that is not theirs.
 */
function aboutViewer(viewerId: string): Prisma.ActivityLogWhereInput[] {
  return [
    { type: { in: [...ACTED_TYPES] }, actingForId: viewerId },
    { type: { in: [...ACTED_TYPES] }, actingForId: null, actorId: viewerId },
    { type: { in: [...PERSONAL_CONNECTION_TYPES] }, targetType: "user", targetId: viewerId },
  ];
}

/** The rows a viewer may read past Just me: every row that is not personal, and the personal rows about them. */
export function personalRowRule(viewerId: string): Prisma.ActivityLogWhereInput {
  return { OR: [{ type: { notIn: [...PERSONAL_TEAMMATE_ACTIVITY_TYPES] } }, ...aboutViewer(viewerId)] };
}

/**
 * "Just me": the viewer's own rows, and the personal rows about them,
 * whoever wrote them (the system ending their browser, an Admin stopping
 * it), never a personal row about someone else.
 *
 * The person's data export (GET /api/me/export, GDPR Article 15) reads its
 * main activity list, activityLogs, by this too, with no workspace, so it
 * covers every one (review round 2 of Phase 4).
 *
 * INDEXES. Every arm can read by an index of one person's rows: the actor
 * ("ActivityLog_actorId_idx") for their own rows and a row about its actor;
 * actingForId for a row that acts for them, and the target as a user for
 * their Google connection's rows (the two partial indexes of
 * prisma/sql/2026-10-11-ai-teammates-phase4-activity-indexes.sql, review
 * round 3 of Phase 4); never the type index alone across every workspace.
 */
export function myActivityWhere(viewerId: string): Prisma.ActivityLogWhereInput {
  return { OR: [{ actorId: viewerId, type: { notIn: [...PERSONAL_TEAMMATE_ACTIVITY_TYPES] } }, ...aboutViewer(viewerId)] };
}

const CONNECTION_SET: ReadonlySet<string> = new Set(PERSONAL_CONNECTION_TYPES);

/**
 * The personal rows a person wrote about someone else's teammate work, as a
 * where clause: the second activity list of their data export,
 * activityAboutOthers (GET /api/me/export). The actor is the person, and
 * the row is not about them (aboutViewer, spelt out so a null column never
 * drops a row: SQL's NOT of a null is null, not true). A teammate's act, a
 * session or a take over that acts for someone else (actingForId neither
 * null, when the row is about its actor, nor the person); a connection row
 * whose Google is not the person's (its target not this person as a user,
 * or naming none). So a manager's removal that ended a report's browser,
 * and each row of an Admin's Disconnect everyone. They are the writer's
 * acts, so an Article 15 answer without them is incomplete (review round 3
 * of Phase 4); what they were about is the other person's, so the export
 * carries only the writer's part (isWriterPartOnly, writerPartSentence, and
 * route.ts exportedActivity). No row it finds is one myActivityWhere finds.
 *
 * A LIST OF ITS OWN (review round 4 of Phase 4). In round 3 these rows
 * shared the main list's newest 10,000 with the person's own: an Admin who
 * disconnected everyone in a workspace of 10,000 Google connections then
 * exported 10,000 identical trimmed lines and none of their own records.
 * The export now reads them on their own, with their own cap and left-out
 * count, and the main list by myActivityWhere alone.
 *
 * INDEXES. Each arm names actorId, so it reads by "ActivityLog_actorId_idx".
 * Takes no workspace: the export covers every one.
 */
export function exportWrittenAboutOthersWhere(personId: string): Prisma.ActivityLogWhereInput {
  return {
    OR: [
      { actorId: personId, type: { in: [...ACTED_TYPES] }, NOT: [{ actingForId: null }, { actingForId: personId }] },
      { actorId: personId, type: { in: [...PERSONAL_CONNECTION_TYPES] }, OR: [{ targetType: null }, { targetId: null }, { NOT: [{ targetType: "user", targetId: personId }] }] },
    ],
  };
}

/** The columns that say whom a personal row is about. */
export type AboutFacts = { type: string; actorId: string | null; actingForId: string | null; targetType: string | null; targetId: string | null };

/**
 * Whether a personal row is about this person, as aboutViewer's where clause
 * reads it (review round 3 of Phase 4): a connection row by its target as a
 * user, any other by its actingForId, or its actor when it names no one it
 * acts for. False for a row that is not personal.
 */
export function personalRowIsAbout(row: AboutFacts, personId: string): boolean {
  if (!isPersonalTeammateActivityType(row.type)) return false;
  if (CONNECTION_SET.has(row.type)) return row.targetType === "user" && row.targetId === personId;
  return row.actingForId === personId || (row.actingForId === null && row.actorId === personId);
}

/** A personal row that is not about this person: of it, only its writer's part is theirs (review round 3 of Phase 4). */
export function isWriterPartOnly(row: AboutFacts, personId: string): boolean {
  return isPersonalTeammateActivityType(row.type) && !personalRowIsAbout(row, personId);
}

/**
 * What the export says of a row a person wrote about someone else's
 * teammate work (review round 3 of Phase 4), by its type only: the kind of
 * action, never a site, an id or a name, which are the other person's.
 */
export const WRITER_PART_COPY = {
  sessionStarted: "Opened another person's AI teammate browser",
  sessionEnded: "Closed another person's AI teammate browser",
  takeOver: "Took over another person's AI teammate browser",
  connected: "Connected another person's Google to AI teammates",
  disconnected: "Disconnected another person's Google from AI teammates",
  needsReconnect: "Another person's Google stopped working for AI teammates",
  browserAct: "An AI teammate used a browser for another person",
  googleAct: "An AI teammate used Google for another person",
  // Phase 5's rows (docs/plans/ai-teammates-phase5.md step 1), by type only;
  // each says whose, as the rows above do (review of Phase 5 step 1).
  skillRecording: "Recorded another person's skill",
  skillSaved: "Saved another person's skill",
  skillChanged: "Changed another person's skill",
  skillDeleted: "Deleted another person's skill",
  skillRoutine: "Made a routine from another person's skill",
  skillAct: "An AI teammate started a skill for another person",
  // The MCP server's rows (final review, privacy H1): an Owner or Admin who
  // turned off AI apps, or changed the allowed apps, disconnected other
  // people's apps (admin_off, app_not_allowed), as a leaver change does.
  mcpDisconnected: MCP_WRITER_PART_COPY.disconnected,
  mcpAct: MCP_WRITER_PART_COPY.acted,
  other: "Acted on another person's AI teammate work",
} as const;

const BROWSER_TOOL_SET: ReadonlySet<string> = new Set(BROWSER_TOOL_NAMES);
const CONNECTOR_TOOL_SET: ReadonlySet<string> = new Set(CONNECTOR_TOOL_NAMES);
const SKILL_TOOL_SET: ReadonlySet<string> = new Set(SKILL_TOOL_NAMES);

/** The export's sentence for a row its reader wrote about someone else, by type only (WRITER_PART_COPY). */
export function writerPartSentence(type: string): string {
  switch (type) {
    case "teammate_browser.session_started":
      return WRITER_PART_COPY.sessionStarted;
    case "teammate_browser.session_ended":
      return WRITER_PART_COPY.sessionEnded;
    case "teammate_browser.take_over":
      return WRITER_PART_COPY.takeOver;
    case "teammate_connection.connected":
      return WRITER_PART_COPY.connected;
    case "teammate_connection.disconnected":
      return WRITER_PART_COPY.disconnected;
    case "teammate_connection.needs_reconnect":
      return WRITER_PART_COPY.needsReconnect;
    case "teammate_skill.recording":
      return WRITER_PART_COPY.skillRecording;
    case "teammate_skill.saved":
      return WRITER_PART_COPY.skillSaved;
    case "teammate_skill.changed":
      return WRITER_PART_COPY.skillChanged;
    case "teammate_skill.deleted":
      return WRITER_PART_COPY.skillDeleted;
    case "teammate_skill.routine":
      return WRITER_PART_COPY.skillRoutine;
    case "mcp.app.revoked":
      return WRITER_PART_COPY.mcpDisconnected;
  }
  if (type.startsWith("mcp.")) return WRITER_PART_COPY.mcpAct;
  const tool = type.startsWith("agent.") ? type.slice("agent.".length) : "";
  if (BROWSER_TOOL_SET.has(tool)) return WRITER_PART_COPY.browserAct;
  if (CONNECTOR_TOOL_SET.has(tool)) return WRITER_PART_COPY.googleAct;
  if (SKILL_TOOL_SET.has(tool)) return WRITER_PART_COPY.skillAct;
  return WRITER_PART_COPY.other;
}

/** Owners and Admins read every personal row in My team and Everyone (see the header). */
export function readsEveryPersonalRow(viewer: Pick<Viewer, "orgRole">): boolean {
  return viewer.orgRole === "OWNER" || viewer.orgRole === "ADMIN";
}

/**
 * The rows one Activity scope holds for this viewer (/api/activity, its CSV
 * and its Type list ask the same): Just me is myActivityWhere; My team the
 * viewer and their reports as actors (`teamIds`, any depth); Everyone the
 * workspace. Past Just me, a viewer who is not an Owner or an Admin reads a
 * personal row only when it is about them (personalRowRule). The scope's
 * actors stay in `actorId`, where the route narrows them by ?actorIds=.
 */
export function activityScopeWhere(viewer: Pick<Viewer, "userId" | "organizationId" | "orgRole">, scope: ActivityScope, teamIds: readonly string[]): Prisma.ActivityLogWhereInput {
  const org = viewer.organizationId;
  if (scope === "my") return { organizationId: org, ...myActivityWhere(viewer.userId) };
  const where: Prisma.ActivityLogWhereInput = { organizationId: org };
  if (scope === "team") where.actorId = { in: [...new Set([viewer.userId, ...teamIds])] };
  if (!readsEveryPersonalRow(viewer)) where.AND = [personalRowRule(viewer.userId)];
  return where;
}

// ── The audit line of a browser session's end ────────────────────────

function host(v: unknown): string | null {
  return typeof v === "string" && v.length > 0 && v.length <= 253 && /^[a-z0-9._-]+$/i.test(v) ? v.toLowerCase() : null;
}

function count(v: unknown): number {
  return typeof v === "number" && Number.isFinite(v) && v > 0 ? Math.floor(v) : 0;
}

function times(n: number, one: string, many: string): string {
  if (n === 0) return `no ${many}`;
  return n === 1 ? `1 ${one}` : `${n.toLocaleString("en-US")} ${many}`;
}

/** At most this many sites are named; sessions.ts keeps 30. */
const SITES_NAMED = 30;

/**
 * The Settings > Audit line of a teammate_browser.session_ended row: its own
 * sentence and every site the session used, with how many reads and
 * actions each had (metadata.sites, sessions.ts hostsOf). Only the audit
 * surface prints it, for Owners and Admins; null when the row holds no site
 * list, so the row's own sentence stands.
 */
export function browserSessionAuditSummary(description: string, metadata: unknown): string | null {
  const m = metadata && typeof metadata === "object" && !Array.isArray(metadata) ? (metadata as Record<string, unknown>) : null;
  if (!m || !Array.isArray(m.sites)) return null;
  const said = description.trim().replace(/[.\s]+$/, "");
  const sites = m.sites
    .map((s) => (s && typeof s === "object" ? (s as Record<string, unknown>) : {}))
    .map((s) => ({ site: host(s.site), reads: count(s.reads), acts: count(s.acts) }))
    .filter((s): s is { site: string; reads: number; acts: number } => s.site !== null)
    .slice(0, SITES_NAMED);
  if (sites.length === 0) return `${said}. It used no site.`;
  const each = sites.map((s) => `${s.site}, ${times(s.reads, "read", "reads")} and ${times(s.acts, "action", "actions")}`);
  return `${said}. Sites: ${each.join("; ")}.`;
}
