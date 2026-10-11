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
//     session's end with its sites (browserSessionAuditSummary).
// Managers and the People team no longer see their reports' teammate
// browser and Google rows in Activity.
//
// WHICH ROWS. Every agent.<tool> row of a Google or browser tool (derived
// from the tool lists, so a tool added later is personal from its first
// row), the browser rows about one person's session, and every
// teammate_connection row. The workspace's own configuration rows stay as
// they are (WORKSPACE_TEAMMATE_ACTIVITY_TYPES): the switch, Stop every
// browser, the sites lists, the Google policy.
//
// Pure: imports the tool name lists and types only.

import type { Prisma } from "@/generated/prisma";
import { BROWSER_TOOL_NAMES, CONNECTOR_TOOL_NAMES } from "@/lib/agents/tool-names";
import type { ActivityScope } from "@/lib/activity-scope";
import type { Viewer } from "./types";

/** The browser rows about one person's session (src/lib/browser/sessions.ts, take-over.ts). */
const PERSONAL_BROWSER_TYPES = ["teammate_browser.take_over", "teammate_browser.session_started", "teammate_browser.session_ended"] as const;

/** The person's own Google connection (src/lib/connectors/connections.ts). */
const PERSONAL_CONNECTION_TYPES = ["teammate_connection.connected", "teammate_connection.disconnected", "teammate_connection.needs_reconnect"] as const;

export const PERSONAL_TEAMMATE_ACTIVITY_TYPES: readonly string[] = [
  // executor.ts auditAgentAction writes `agent.${toolName}`.
  ...CONNECTOR_TOOL_NAMES.map((n) => `agent.${n}`),
  ...BROWSER_TOOL_NAMES.map((n) => `agent.${n}`),
  ...PERSONAL_BROWSER_TYPES,
  ...PERSONAL_CONNECTION_TYPES,
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
 */
export function myActivityWhere(viewerId: string): Prisma.ActivityLogWhereInput {
  return { OR: [{ actorId: viewerId, type: { notIn: [...PERSONAL_TEAMMATE_ACTIVITY_TYPES] } }, ...aboutViewer(viewerId)] };
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
