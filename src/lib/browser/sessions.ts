// The computer's sessions (docs/plans/ai-teammates-phase4.md step 2): whether
// a workspace and a teammate may use a browser now, starting one under the
// caps, using it, ending it for every reason Decision 6 names, the policy's
// switch and lists, usage, the steps, and the cron's sweep and reaper.
//
// ONE SESSION PER PERSON PER WORKSPACE (Decision 6), for one teammate in one
// chat, started by the first browser call and never shared: a partial unique
// index in the SQL, and every start under one platform-wide advisory lock
// (73030) that reads the person's live row FOR UPDATE.
//
// THE CAPS ARE COUNTED IN THE DATABASE, UNDER THAT LOCK (Decision 5): the
// person's 20 a day, the workspace's sessions a day and browsers at once, the
// deployment's BROWSER_MAX_AT_ONCE, and the month's minutes, each session
// reserving min(its plan's minutes a session, the minutes left) when it
// starts, so starts racing each other can never pass the month. Browsers
// "at once" are counted from every live and ending row by status, whatever
// month it started in (toward the safer side than the spec's month-scoped
// count: a browser started last month still runs). The day's sessions count
// only the starts that reached a browser (review of Phase 4 step 2).
//
// GROWTH AND UP, NEVER A TRIAL (Decision 4), OFF UNTIL SWITCHED ON (Decision
// 3), every value read fresh on every call (computerAccess).
//
// A BROWSER IS DRIVEN ONLY THROUGH THE GUARD IT STARTED WITH (Decision 7).
// The guard lives in this process (live.ts, BOOT_ID); a row whose bootId is
// another process's, or that this process no longer holds, is ended
// "restarted", never reattached. The guard reads the rules held on the
// process's entry, which every list change in this process replaces at once
// (refreshLiveRules), so a site taken away stops the next hop, the person's
// own clicks during a take over included, and a browser on a page of that
// site leaves it for about:blank (review of Phase 4 step 2). A row still
// starting is never ended "restarted": its guard is not attached yet.
//
// ENDING HAS ONE WINNER (endBrowserSession): one compare-and-swap to
// "ending"; only its winner cancels the session's waiting cards, closes the
// connection, releases the provider's browser, writes the "end" step, the
// chat line and the one audit row with its hosts, reads and acts. A release
// the provider did not confirm is tried again by the sweep every two minutes,
// eight times, after which the provider's own time limit has ended it. An
// end decided on an earlier read swaps only while the row still meets that
// read's condition, and the sweep's time-based ends wait for no step: one in
// flight is left to the next tick (review of Phase 4 step 2).
//
// NOTHING A PAGE SHOWED IS KEPT HERE (Decision 23): steps hold kinds, hosts,
// outcomes and codes; a session row its current host only until it ends.
// Audit rows (Decision 24) hold hosts, kinds and counts, never a path, an
// element's words or typed text.
//
// Server-only: imports prisma.

import { randomBytes } from "node:crypto";
import { Prisma } from "@/generated/prisma";
import { logActivity } from "@/lib/activity";
import { actorLabelFor, resolveActingPerson, type ActingPerson } from "@/lib/agents/acting";
import { actionHref, writeEventLine } from "@/lib/agents/actions";
import { computerAgentById, type ComputerAgent } from "@/lib/agents/browser-access";
import { OPEN_RUN_STATUSES, RUN_LOCK_TX_MAX_WAIT_MS, RUN_LOCK_TX_TIMEOUT_MS, runStillOpen } from "@/lib/agents/budget";
import { agentAuditLine, BROWSER_AUDIT_COPY, BROWSER_COPY, BROWSER_PANEL_COPY } from "@/lib/agents/teammate-copy";
import { BROWSER_LIMITS } from "@/lib/plan-limits-data";
import { prisma } from "@/lib/prisma";
import { publishToUser } from "@/lib/realtime-bus";
import { createProviderSession, listRunningProviderSessions, releaseProviderSession } from "./browserbase";
import { attachBrowser, type GuardHooks } from "./cdp-driver";
import { SESSION_CAPS, SESSION_TIMES } from "./classes";
import { browserConfig, browserReleaseConfig, siteRulesFor, type BrowserConfig } from "./config";
import { BOOT_ID, dropLiveBrowser, liveBrowser, liveBrowsersWhere, noteEvent, putLiveBrowser, withBrowserLock, type LiveBrowser } from "./live";
import { sweepShots } from "./shots";
import { neverReason, siteOf, siteVerdict, effectiveSites, type SiteRules } from "./sites";
import { LIVE_STATUSES, STEP_KINDS, STEP_OUTCOMES, type EndReason, type SessionStatus, type StepKind, type StepOutcome } from "./types";
import { endedLine, sessionMinutes, stepLine, type BrowserPolicyView, type BrowserSessionView, type BrowserUsage, type ComputerRefusal } from "./views";

export type { ComputerRefusal } from "./views";

// ── Locks and limits ────────────────────────────────────────────────

/** Every start, platform-wide (Decision 5): starts are rare and each transaction short. Its own key space. */
export const START_LOCK_CLASS = 73_030;
/** A session's waiting card (step 3, executor.ts withBrowserCardLock). */
export const CARD_LOCK_CLASS = 73_031;
/** The workspace's browser policy: the switch and both lists. */
export const POLICY_LOCK_CLASS = 73_032;

/** How long a transaction that waits on one of these locks may take. */
const LOCK_TX = { timeout: 20_000, maxWait: 10_000 } as const;

/** The longest lists (the CHECKs in prisma/sql/2026-10-11-ai-teammates-phase4*.sql). */
export const SITE_LIST_MAX = { allow: 200, block: 500, teammate: 50 } as const;

/** The browser cards a session can be waiting on (step 3). */
export const BROWSER_CARD_TOOLS = ["click", "type_text", "select_option", "ask_to_take_over"] as const;

/** A release the provider did not confirm is tried again this often, this many times (Decision 27). */
export const STOP_RETRY_MS = 2 * 60_000;
export const STOP_ATTEMPTS_MAX = 8;

/** Tagged provider sessions the reaper releases a tick at most. */
export const REAP_MAX = 50;
/** Steps the retention deletes a tick at most. */
export const STEP_RETENTION_BATCH = 5000;

/** How many sessions end side by side (each may wait on the provider up to 10 seconds). */
const END_AT_ONCE = 5;

const LIVE = [...LIVE_STATUSES] as string[];

// ── Who ended it ────────────────────────────────────────────────────

/** Who ends a session, as its audit row names them. */
export type EndActor = { id: string | null; type: "person" | "system" | "agent" };
export const SYSTEM_END: EndActor = { id: null, type: "system" };

function actorOf(actorId: string | null): EndActor {
  return actorId ? { id: actorId, type: "person" } : SYSTEM_END;
}

function errorLine(err: unknown): string {
  return err instanceof Error ? (err.message.split("\n").pop() ?? err.message) : String(err);
}

function stepId(): string {
  return `st${randomBytes(12).toString("hex")}`;
}

// ── The rows ────────────────────────────────────────────────────────

export const SESSION_SELECT = {
  id: true,
  organizationId: true,
  userId: true,
  agentId: true,
  chatSessionId: true,
  provider: true,
  providerSessionId: true,
  region: true,
  status: true,
  endReason: true,
  bootId: true,
  reservedMinutes: true,
  startedAt: true,
  endsBy: true,
  lastActiveAt: true,
  lastRunId: true,
  waitingSince: true,
  handedOverAt: true,
  currentSite: true,
  endedAt: true,
  billedMinutes: true,
  stopAttempts: true,
  nextStopAt: true,
} as const;

export type SessionRow = Prisma.TeammateBrowserSessionGetPayload<{ select: typeof SESSION_SELECT }>;

export interface PolicyRow {
  enabled: boolean;
  allowSites: string[];
  blockSites: string[];
  updatedAt: Date | null;
}

const NO_POLICY: PolicyRow = { enabled: false, allowSites: [], blockSites: [], updatedAt: null };

function strings(v: unknown): string[] {
  return Array.isArray(v) ? v.filter((s): s is string => typeof s === "string") : [];
}

async function readPolicy(organizationId: string): Promise<PolicyRow> {
  const row = await prisma.teammateBrowserPolicy.findUnique({ where: { organizationId }, select: { enabled: true, allowSites: true, blockSites: true, updatedAt: true } });
  if (!row) return NO_POLICY;
  return { enabled: row.enabled === true, allowSites: strings(row.allowSites), blockSites: strings(row.blockSites), updatedAt: row.updatedAt ?? null };
}

// ── Whether the computer may be used ────────────────────────────────

export type BrowserCaps = NonNullable<(typeof BROWSER_LIMITS)[string]>;

export type ComputerAccess =
  | { ok: true; cfg: BrowserConfig; caps: BrowserCaps; policy: PolicyRow; rules: SiteRules; sites: string[] }
  | { ok: false; reason: ComputerRefusal };

/** The workspace's status and plan, read now. */
async function workspaceOf(organizationId: string): Promise<{ status: string; plan: string } | null> {
  const org = await prisma.organization.findUnique({ where: { id: organizationId }, select: { status: true, plan: true } });
  return org ? { status: String(org.status), plan: String(org.plan ?? "STARTER") } : null;
}

/** The workspace's own refusal, before any teammate: not configured, closed, a trial, the plan, the switch off. */
function workspaceRefusal(cfg: BrowserConfig | null, org: { status: string; plan: string } | null, policy: PolicyRow): ComputerRefusal | null {
  if (!cfg) return "not_configured";
  if (!org) return "workspace_closed";
  if (org.status === "TRIAL") return "trial";
  if (org.status !== "ACTIVE") return "workspace_closed";
  if (!BROWSER_LIMITS[org.plan]) return "plan";
  if (!policy.enabled) return "workspace_off";
  return null;
}

/**
 * Whether this workspace's teammates may use the computer at all now
 * (`available`, the switch included), and the first reason why not.
 */
export async function workspaceComputer(organizationId: string): Promise<{ available: boolean; reason: ComputerRefusal | null; plan: string; policy: PolicyRow }> {
  const cfg = browserConfig();
  const [org, policy] = await Promise.all([workspaceOf(organizationId), readPolicy(organizationId)]);
  const reason = workspaceRefusal(cfg, org, policy);
  return { available: reason === null, reason, plan: org?.plan ?? "STARTER", policy };
}

/**
 * Whether this teammate may use the computer now, in this order, each
 * refusal its own (Decision 33): not configured, the workspace closed, a
 * trial, the plan, the switch off, no site the teammate may open.
 */
export async function computerAccess(a: { organizationId: string; agent: Pick<ComputerAgent, "browserSites"> }): Promise<ComputerAccess> {
  const cfg = browserConfig();
  if (!cfg) return { ok: false, reason: "not_configured" };
  const [org, policy] = await Promise.all([workspaceOf(a.organizationId), readPolicy(a.organizationId)]);
  const reason = workspaceRefusal(cfg, org, policy);
  if (reason) return { ok: false, reason };
  const caps = BROWSER_LIMITS[org!.plan]!;
  const workspace = { allow: policy.allowSites, block: policy.blockSites };
  const sites = effectiveSites(a.agent.browserSites, workspace);
  if (sites.length === 0) return { ok: false, reason: "no_sites" };
  return { ok: true, cfg, caps, policy, rules: siteRulesFor(cfg, workspace, a.agent.browserSites), sites };
}

// ── The guard's hooks ───────────────────────────────────────────────

/**
 * The guard of one session: the rules its process entry holds now (or those
 * it started with, until the entry exists), the frame rule, and the notes
 * each event leaves for the next call's result.
 */
function guardHooks(rowId: string, initial: SiteRules): GuardHooks {
  const rules = () => liveBrowser(rowId)?.rules ?? initial;
  return {
    verdict: (url, mainFrame) => {
      const r = rules();
      if (mainFrame) return siteVerdict(url, r);
      // Frames of other sites load, unread and undriven (Decision 10); never a never-allowed host.
      const site = siteOf(url);
      if (!site) return { ok: true, frame: true };
      if (neverReason(site, { appHosts: r.appHosts, fixtureSuffix: r.fixtureSuffix })) return { ok: false, code: "never", site };
      return { ok: true, frame: true };
    },
    onRefused: (host, code, mainFrame) => {
      if (mainFrame === false) return;
      noteEvent(liveBrowser(rowId), code === "private_address" ? BROWSER_COPY.privateAddress : BROWSER_COPY.redirectRefused(host ?? BROWSER_PANEL_COPY.STEP_WORDS.unknownSite));
    },
    onLost: () => {
      const lb = liveBrowser(rowId);
      // Before the browser was handed out, its start answers for it.
      if (!lb) return;
      lb.lost = true;
      void endBrowserSession(rowId, "provider_ended", SYSTEM_END).catch((err) => console.error(`[browser] a lost browser did not end: ${errorLine(err)}`));
    },
    onDialog: () => noteEvent(liveBrowser(rowId), BROWSER_COPY.dialogClosed),
    onDownload: () => noteEvent(liveBrowser(rowId), BROWSER_COPY.downloadsOff),
    onUpload: () => noteEvent(liveBrowser(rowId), BROWSER_COPY.uploadsOff),
    onPopup: (url) => noteEvent(liveBrowser(rowId), BROWSER_COPY.popupClosed(siteOf(url) ?? BROWSER_PANEL_COPY.STEP_WORDS.unknownSite)),
  };
}

// ── Starting a session ──────────────────────────────────────────────

export type OpenRefusal =
  | ComputerRefusal
  | "other_teammate"
  | "busy"
  | "person_today"
  | "workspace_today"
  | "workspace_at_once"
  | "platform_at_once"
  | "month_used"
  | "provider_unavailable"
  | "provider_busy"
  | "start_failed";

export type OpenResult = { ok: true; rowId: string } | { ok: false; reason: OpenRefusal; otherName?: string; retryAfter?: number; atOnce?: number };

type Counted = { id: string; reserved: number; seconds: number } | { refusal: OpenRefusal; otherAgentId?: string; atOnce?: number };

/**
 * The month's minutes, the day's sessions and the person's, for one
 * workspace, in one statement (see the header). The day's sessions count
 * only those that reached a browser (review of Phase 4 step 2): a start the
 * provider never answered costs nothing and must not use up the person's 20
 * or the workspace's day. Browsers at once are counted by liveCounts, every
 * live status, as before.
 */
async function monthCounts(db: Prisma.TransactionClient | typeof prisma, organizationId: string, userId: string): Promise<{ today: number; personToday: number; month: number }> {
  const rows = await db.$queryRaw<Array<{ today: number; personToday: number; month: number }>>`
    SELECT count(*) FILTER (WHERE "providerSessionId" IS NOT NULL AND "startedAt" >= date_trunc('day', now() AT TIME ZONE 'UTC'))::int AS "today",
           count(*) FILTER (WHERE "providerSessionId" IS NOT NULL AND "userId" = ${userId} AND "startedAt" >= date_trunc('day', now() AT TIME ZONE 'UTC'))::int AS "personToday",
           COALESCE(sum(CASE WHEN "status" = 'ended' THEN COALESCE("billedMinutes", "reservedMinutes") ELSE "reservedMinutes" END), 0)::int AS "month"
      FROM "TeammateBrowserSession"
     WHERE "organizationId" = ${organizationId} AND "startedAt" >= date_trunc('month', now() AT TIME ZONE 'UTC')`;
  const r = rows[0];
  return { today: Number(r?.today ?? 0), personToday: Number(r?.personToday ?? 0), month: Number(r?.month ?? 0) };
}

/** Browsers running now: the deployment's, and this workspace's, by status whatever month they started (see the header). */
async function liveCounts(db: Prisma.TransactionClient | typeof prisma, organizationId: string): Promise<{ platform: number; atOnce: number }> {
  const rows = await db.$queryRaw<Array<{ platform: number; atOnce: number }>>`
    SELECT count(*)::int AS "platform", count(*) FILTER (WHERE "organizationId" = ${organizationId})::int AS "atOnce"
      FROM "TeammateBrowserSession"
     WHERE "status" IN ('starting', 'live', 'waiting', 'handed_over', 'ending')`;
  return { platform: Number(rows[0]?.platform ?? 0), atOnce: Number(rows[0]?.atOnce ?? 0) };
}

/**
 * Start the person's browser for this teammate and chat, in order (spec
 * step 2): the caps under one lock and the row "starting"; the provider's
 * browser; the guard; the row "live"; the audit row; the chat line, only
 * while the turn's run is open (budget.ts runStillOpen).
 */
export async function openBrowserSession(a: {
  person: ActingPerson;
  agent: ComputerAgent;
  chatSessionId: string;
  runId: string;
  access: Extract<ComputerAccess, { ok: true }>;
}): Promise<OpenResult> {
  const { person, agent, access } = a;
  const { cfg, caps } = access;
  const org = person.organizationId;
  const user = person.userId;

  const counted: Counted = await prisma.$transaction(async (tx): Promise<Counted> => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(${START_LOCK_CLASS}::int, 0)`;
    const mine = await tx.$queryRaw<Array<{ id: string; agentId: string }>>`
      SELECT "id", "agentId" FROM "TeammateBrowserSession"
       WHERE "organizationId" = ${org} AND "userId" = ${user} AND "status" IN ('starting', 'live', 'waiting', 'handed_over')
       FOR UPDATE`;
    if (mine.length > 0) return mine[0].agentId === agent.id ? { refusal: "busy" } : { refusal: "other_teammate", otherAgentId: mine[0].agentId };
    const live = await liveCounts(tx, org);
    const month = await monthCounts(tx, org, user);
    if (month.personToday >= SESSION_CAPS.personPerDay) return { refusal: "person_today" };
    if (month.today >= caps.sessionsPerDay) return { refusal: "workspace_today" };
    if (live.atOnce >= caps.atOnce) return { refusal: "workspace_at_once", atOnce: caps.atOnce };
    if (live.platform >= cfg.maxAtOnce) return { refusal: "platform_at_once" };
    const left = caps.minutesPerMonth - month.month;
    if (left < 1) return { refusal: "month_used" };
    let reserved = Math.min(caps.sessionMinutes, left);
    let seconds = reserved * 60;
    // The stand-in's short sessions, for its proofs only (config.ts testTimes).
    if (cfg.testTimes.sessionSeconds) {
      seconds = Math.min(seconds, cfg.testTimes.sessionSeconds);
      reserved = Math.max(1, Math.ceil(seconds / 60));
    }
    const now = new Date();
    const row = await tx.teammateBrowserSession.create({
      data: {
        organizationId: org,
        userId: user,
        agentId: agent.id,
        chatSessionId: a.chatSessionId,
        provider: cfg.provider,
        status: "starting",
        bootId: BOOT_ID,
        reservedMinutes: reserved,
        startedAt: now,
        endsBy: new Date(now.getTime() + seconds * 1000),
        lastActiveAt: now,
        lastRunId: a.runId,
      },
      select: { id: true },
    });
    return { id: row.id, reserved, seconds };
  }, LOCK_TX);

  if ("refusal" in counted) {
    if (counted.refusal === "other_teammate" && counted.otherAgentId) {
      const other = await prisma.agent.findUnique({ where: { id: counted.otherAgentId }, select: { name: true } }).catch(() => null);
      return { ok: false, reason: "other_teammate", ...(other?.name ? { otherName: other.name } : {}) };
    }
    return { ok: false, reason: counted.refusal, ...(counted.atOnce ? { atOnce: counted.atOnce } : {}) };
  }
  const rowId = counted.id;

  // The provider's browser, tagged with this deployment and its row; its own
  // limit is the reserved time plus a minute (the last backstop, Decision 27).
  const created = await createProviderSession(cfg, { rowId, timeoutSeconds: counted.seconds + 60 });
  if (!created.ok) {
    await endBrowserSession(rowId, "start_failed", SYSTEM_END).catch((err) => console.error(`[browser] a failed start did not end: ${errorLine(err)}`));
    if (created.failure === "rate_limited") return { ok: false, reason: "provider_busy", ...(created.retryAfter ? { retryAfter: created.retryAfter } : {}) };
    return { ok: false, reason: "provider_unavailable" };
  }
  const { providerSessionId, connectUrl } = created.data;
  // The row names the provider's browser before anything else, so ending it releases that browser.
  const named = await prisma.teammateBrowserSession.updateMany({ where: { id: rowId, status: "starting" }, data: { providerSessionId, region: cfg.region } });
  if (named.count !== 1) {
    // Ended meanwhile (Stop, the sweep): its browser goes too.
    const rc = browserReleaseConfig();
    if (rc) await releaseProviderSession(rc, providerSessionId).catch(() => "failed");
    return { ok: false, reason: "start_failed" };
  }

  let handle: LiveBrowser["handle"];
  try {
    handle = await attachBrowser(connectUrl, guardHooks(rowId, access.rules), { fixtureSuffix: access.rules.fixtureSuffix });
  } catch (err) {
    console.error(`[browser] the guard was not attached: ${errorLine(err)}`);
    await endBrowserSession(rowId, "start_failed", SYSTEM_END).catch(() => undefined);
    return { ok: false, reason: "start_failed" };
  }
  putLiveBrowser({
    rowId,
    organizationId: org,
    userId: user,
    agentId: agent.id,
    handle,
    rules: access.rules,
    links: new Set(),
    refs: new Map(),
    refsUrl: null,
    seq: 0,
    lost: false,
    events: [],
  });
  const now = new Date();
  const went = await prisma.teammateBrowserSession.updateMany({ where: { id: rowId, status: "starting" }, data: { status: "live", lastActiveAt: now } });
  if (went.count !== 1) {
    // Ended while the guard was put in place: its end could not close what did not exist yet.
    await dropLiveBrowser(rowId);
    const rc = browserReleaseConfig();
    if (rc) await releaseProviderSession(rc, providerSessionId).catch(() => "failed");
    return { ok: false, reason: "start_failed" };
  }

  await logActivity({
    type: "teammate_browser.session_started",
    actorId: user,
    actorType: "agent",
    actorLabel: actorLabelFor(agent, person),
    actingForId: user,
    organizationId: org,
    description: agentAuditLine(agent.name, person.name, BROWSER_AUDIT_COPY.sessionStarted),
    targetId: agent.id,
    targetType: "agent",
    metadata: { browserSessionId: rowId, agentId: agent.id, region: cfg.region, reservedMinutes: counted.reserved },
    severity: "info",
  });
  await writeEventLine(
    a.chatSessionId,
    { text: BROWSER_PANEL_COPY.startedLine, event: "browser_started", agentId: agent.id, browserSessionId: rowId },
    { whileOpen: { runId: a.runId, personId: user } },
  );
  publishToUser(user, { type: "agent.changed", agentId: agent.id, browserSessionId: rowId });
  return { ok: true, rowId };
}

// ── Using a session ─────────────────────────────────────────────────

export type UseRefusal = "none" | "ended" | "other_teammate" | "other_turn" | "person_has_it" | "restarted" | "time_cap" | "busy";

export type UseResult = { ok: true; row: SessionRow } | { ok: false; reason: UseRefusal; otherName?: string };

/** Whether another run of the person's still holds the browser: open, and started within staleRunMs. */
async function runHolds(runId: string | null, exceptRunId: string | null, now: Date): Promise<boolean> {
  if (!runId || runId === exceptRunId) return false;
  const run = await prisma.agentRun.findUnique({ where: { id: runId }, select: { status: true, startedAt: true, endedAt: true } });
  if (!run || run.endedAt !== null) return false;
  if (!(OPEN_RUN_STATUSES as readonly string[]).includes(String(run.status))) return false;
  return now.getTime() - run.startedAt.getTime() < SESSION_TIMES.staleRunMs;
}

/**
 * The session a call may use now, or why not (spec step 2):
 *   model      the person's live row: another teammate's, one still
 *              starting, one the person has, another running turn's, or one
 *              whose guard or time is gone are refused, each by its reason;
 *              otherwise its lastActiveAt and lastRunId move to this turn;
 *   approval   the card's own row, read fresh, the same person and teammate:
 *              ended, held by the person, or its guard or time gone refuse;
 *   take_over  as approval, a row the person has allowed.
 * A row whose guard is gone ends "restarted"; past its time, "time_cap".
 */
export async function useBrowserSession(a: {
  person: Pick<ActingPerson, "organizationId" | "userId">;
  agentId: string;
  browserSessionId?: string;
  runId: string | null;
  purpose: "model" | "approval" | "take_over";
}): Promise<UseResult> {
  const now = new Date();
  let row: SessionRow | null;
  if (a.purpose === "model") {
    row = await prisma.teammateBrowserSession.findFirst({
      where: { organizationId: a.person.organizationId, userId: a.person.userId, status: { in: LIVE } },
      select: SESSION_SELECT,
    });
    if (!row) return { ok: false, reason: "none" };
    if (row.agentId !== a.agentId) {
      const other = await prisma.agent.findUnique({ where: { id: row.agentId }, select: { name: true } }).catch(() => null);
      return { ok: false, reason: "other_teammate", ...(other?.name ? { otherName: other.name } : {}) };
    }
    if (row.status === "starting") return { ok: false, reason: "busy" };
    if (row.status === "handed_over") return { ok: false, reason: "person_has_it" };
    if (await runHolds(row.lastRunId, a.runId, now)) return { ok: false, reason: "other_turn" };
  } else {
    if (!a.browserSessionId) return { ok: false, reason: "none" };
    row = await prisma.teammateBrowserSession.findFirst({
      where: { id: a.browserSessionId, organizationId: a.person.organizationId, userId: a.person.userId, agentId: a.agentId },
      select: SESSION_SELECT,
    });
    if (!row) return { ok: false, reason: "none" };
    if (row.status === "ended" || row.status === "ending") return { ok: false, reason: "ended" };
    if (row.status === "starting") return { ok: false, reason: "busy" };
    if (row.status === "handed_over" && a.purpose === "approval") return { ok: false, reason: "person_has_it" };
  }

  const lb = liveBrowser(row.id);
  if (row.bootId !== BOOT_ID || !lb || lb.lost) {
    await endBrowserSession(row.id, lb?.lost ? "provider_ended" : "restarted", SYSTEM_END);
    return { ok: false, reason: "restarted" };
  }
  if (now.getTime() >= row.endsBy.getTime()) {
    await endBrowserSession(row.id, "time_cap", SYSTEM_END);
    return { ok: false, reason: "time_cap" };
  }
  const allowed = a.purpose === "take_over" ? ["live", "waiting", "handed_over"] : ["live", "waiting"];
  const touched = await prisma.teammateBrowserSession.updateMany({
    where: { id: row.id, status: { in: allowed } },
    data: { lastActiveAt: now, ...(a.purpose === "model" ? { lastRunId: a.runId } : {}) },
  });
  if (touched.count !== 1) return { ok: false, reason: "ended" };
  return { ok: true, row: { ...row, lastActiveAt: now, ...(a.purpose === "model" ? { lastRunId: a.runId } : {}) } };
}

/** After a turn that used the browser: its idle window starts at the turn's end, not its last call (spec step 3). */
export async function touchAfterTurn(organizationId: string, userId: string, agentId: string): Promise<void> {
  await prisma.teammateBrowserSession.updateMany({
    where: { organizationId, userId, agentId, status: { in: ["live", "waiting"] } },
    data: { lastActiveAt: new Date() },
  });
}

// ── Steps ───────────────────────────────────────────────────────────

const KIND_SET: ReadonlySet<string> = new Set(STEP_KINDS);
const OUTCOME_SET: ReadonlySet<string> = new Set(STEP_OUTCOMES);

/**
 * One step of a session, as kinds and hosts only (Decision 23), numbered in
 * order under the session row's lock. At most stepsPerSession a session; the
 * "end" step is always written. Never for a person whose account is deleted.
 * `whileOpen`: a step a turn writes is written only while that turn's run is
 * open and its person still has an account (budget.ts runStillOpen, review
 * round 4 of Phase 3), the run's lock taken first, as the erasure takes it.
 * Answers whether it was written; a failure is logged, never thrown.
 */
export async function recordStep(
  rowId: string,
  userId: string,
  s: { kind: StepKind; site: string | null; outcome: StepOutcome; code?: string | null; actionId?: string | null; shotId?: string | null },
  opts: { whileOpen?: { runId: string; personId: string } } = {},
): Promise<boolean> {
  if (!KIND_SET.has(s.kind) || !OUTCOME_SET.has(s.outcome)) return false;
  const site = typeof s.site === "string" && s.site.length > 0 && s.site.length <= 253 ? s.site : null;
  const code = typeof s.code === "string" && s.code ? s.code.slice(0, 40) : null;
  const ref = (v: string | null | undefined) => (typeof v === "string" && v.length > 0 && v.length <= 64 ? v : null);
  try {
    return await prisma.$transaction(async (tx) => {
      const open = opts.whileOpen;
      if (open && !(await runStillOpen(tx, open.runId, open.personId))) return false;
      const held = await tx.$queryRaw<Array<{ id: string }>>`
        SELECT s."id" FROM "TeammateBrowserSession" s JOIN "User" u ON u."id" = s."userId"
         WHERE s."id" = ${rowId} AND s."userId" = ${userId} AND u."deletedAt" IS NULL
         FOR UPDATE OF s`;
      if (held.length === 0) return false;
      const [c] = await tx.$queryRaw<Array<{ n: number; top: number }>>`
        SELECT count(*)::int AS "n", COALESCE(max("seq"), 0)::int AS "top" FROM "TeammateBrowserStep" WHERE "browserSessionId" = ${rowId}`;
      if (s.kind !== "end" && Number(c?.n ?? 0) >= SESSION_CAPS.stepsPerSession) return false;
      await tx.teammateBrowserStep.create({
        data: { id: stepId(), browserSessionId: rowId, userId, seq: Number(c?.top ?? 0) + 1, kind: s.kind, site, outcome: s.outcome, code, actionId: ref(s.actionId), shotId: ref(s.shotId), at: new Date() },
      });
      return true;
    }, { timeout: RUN_LOCK_TX_TIMEOUT_MS, maxWait: RUN_LOCK_TX_MAX_WAIT_MS });
  } catch (err) {
    console.error(`[browser] step not written: ${errorLine(err)}`);
    return false;
  }
}

/** Each host a session's steps name, with its reads and acts that ran, most used first, at most 30 (Decision 24). */
async function hostsOf(rowId: string): Promise<Array<{ site: string; reads: number; acts: number }>> {
  const steps = await prisma.teammateBrowserStep.findMany({ where: { browserSessionId: rowId }, select: { site: true, kind: true, outcome: true } });
  const by = new Map<string, { site: string; reads: number; acts: number; all: number }>();
  for (const st of steps) {
    if (!st.site) continue;
    const h = by.get(st.site) ?? { site: st.site, reads: 0, acts: 0, all: 0 };
    h.all += 1;
    if (st.outcome === "ok" && ["open", "read", "find", "scroll", "show"].includes(st.kind)) h.reads += 1;
    if (st.outcome === "ok" && ["click", "type", "select"].includes(st.kind)) h.acts += 1;
    by.set(st.site, h);
  }
  return [...by.values()]
    .sort((x, y) => y.all - x.all || x.site.localeCompare(y.site))
    .slice(0, 30)
    .map(({ site, reads, acts }) => ({ site, reads, acts }));
}

// ── Ending a session ────────────────────────────────────────────────

/** Ask the provider to end the browser, through the release settings alone (never BROWSER_OFFERED). */
async function release(providerSessionId: string | null): Promise<"released" | "already" | "failed" | "none"> {
  if (!providerSessionId) return "none";
  const rc = browserReleaseConfig();
  if (!rc) return "failed";
  try {
    return await releaseProviderSession(rc, providerSessionId);
  } catch {
    return "failed";
  }
}

/** The row "ended": its time billed (none when no browser ever started), its host forgotten. */
async function markEnded(row: { id: string; providerSessionId: string | null; reservedMinutes: number; startedAt: Date }, now: Date, billed?: number): Promise<number> {
  const minutes = billed ?? (row.providerSessionId ? Math.min(row.reservedMinutes, Math.max(0, Math.ceil((now.getTime() - row.startedAt.getTime()) / 60_000))) : 0);
  await prisma.teammateBrowserSession.updateMany({
    where: { id: row.id, status: "ending" },
    data: { status: "ended", endedAt: now, billedMinutes: minutes, nextStopAt: null, currentSite: null },
  });
  return minutes;
}

/**
 * The session's waiting browser cards, cancelled with the reason (spec step
 * 2): every PENDING one, and a take over in progress (RUNNING). Their Inbox
 * rows are marked read: nothing is left to decide there.
 */
async function cancelCards(row: { id: string; chatSessionId: string | null; agentId: string }, reason: EndReason, now: Date): Promise<number> {
  const cards = await prisma.agentAction.findMany({
    where: {
      ...(row.chatSessionId ? { sessionId: row.chatSessionId } : {}),
      toolName: { in: [...BROWSER_CARD_TOOLS] },
      status: { in: ["PENDING", "RUNNING"] },
      input: { path: ["browserSessionId"], equals: row.id },
    },
    select: { id: true, status: true, toolName: true, actingForId: true },
  });
  const ids = cards.filter((c) => c.status === "PENDING" || c.toolName === "ask_to_take_over").map((c) => c.id);
  if (ids.length === 0) return 0;
  const closed = await prisma.agentAction.updateMany({
    where: { id: { in: ids }, OR: [{ status: "PENDING" }, { status: "RUNNING", toolName: "ask_to_take_over" }] },
    data: { status: "CANCELLED", decidedVia: "system", decidedAt: now, error: BROWSER_COPY.cancelledClosed(endedLine(reason)) },
  });
  const agent = await prisma.agent.findUnique({ where: { id: row.agentId }, select: { slug: true } }).catch(() => null);
  if (agent) {
    const byPerson = new Map<string, string[]>();
    for (const c of cards.filter((x) => ids.includes(x.id))) byPerson.set(c.actingForId, [...(byPerson.get(c.actingForId) ?? []), actionHref(agent.slug, c.id)]);
    for (const [userId, links] of byPerson) {
      await prisma.notification.updateMany({ where: { userId, link: { in: links }, read: false }, data: { read: true } }).catch(() => undefined);
    }
  }
  return closed.count;
}

/**
 * What a row must still be to end "restarted" when its guard is found gone
 * (review of Phase 4 step 2): one that had a guard. A row still starting
 * has none attached yet, and its start answers for it.
 */
export const GUARD_GONE_ONLY = { status: { in: ["live", "waiting", "handed_over"] } } satisfies Prisma.TeammateBrowserSessionWhereInput;

/**
 * End a session (see the header): one winner, which cancels its waiting
 * cards, closes the connection, releases the provider's browser (or leaves
 * the release to the sweep), writes the "end" step, the chat line, the one
 * audit row and publishes. False when it was ended already.
 *
 * `only` (review of Phase 4 step 2): a condition the row must still meet at
 * the swap itself, so an end decided on an earlier read (the sweep's idle,
 * waiting and take over parts; a guard found gone) never ends a row that
 * moved since: a turn touched it, the person approved, Done was pressed, or
 * it is still starting.
 */
export async function endBrowserSession(rowId: string, reason: EndReason, actor: EndActor, o: { only?: Prisma.TeammateBrowserSessionWhereInput } = {}): Promise<boolean> {
  const now = new Date();
  const won = await prisma.teammateBrowserSession.updateMany({
    where: { id: rowId, status: { in: LIVE }, ...(o.only ? { AND: [o.only] } : {}) },
    data: { status: "ending", endReason: reason, waitingSince: null, nextStopAt: now },
  });
  if (won.count !== 1) return false;
  const row = await prisma.teammateBrowserSession.findUnique({ where: { id: rowId }, select: SESSION_SELECT });
  if (!row) return true;

  await cancelCards(row, reason, now).catch((err) => console.error(`[browser] cards of an ended browser not cancelled: ${errorLine(err)}`));
  await dropLiveBrowser(rowId);
  const released = await release(row.providerSessionId);
  let minutes: number;
  if (released === "failed") {
    await prisma.teammateBrowserSession.updateMany({
      where: { id: rowId, status: "ending" },
      data: { stopAttempts: { increment: 1 }, nextStopAt: new Date(now.getTime() + STOP_RETRY_MS) },
    });
    minutes = sessionMinutes({ ...row, status: "ending" }, now);
  } else {
    minutes = await markEnded(row, now);
  }

  const [person, agent] = await Promise.all([
    prisma.user.findUnique({ where: { id: row.userId }, select: { deletedAt: true, firstName: true, lastName: true, email: true } }).catch(() => null),
    prisma.agent.findUnique({ where: { id: row.agentId }, select: { name: true } }).catch(() => null),
  ]);
  await recordStep(rowId, row.userId, { kind: "end", site: row.currentSite, outcome: "ok", code: reason });
  // An erased person's chats are blanked; nothing new is written to them.
  if (person && !person.deletedAt) {
    await writeEventLine(row.chatSessionId, { text: endedLine(reason), event: "browser_ended", agentId: row.agentId, browserSessionId: rowId });
  }
  const personName = person ? `${person.firstName ?? ""} ${person.lastName ?? ""}`.trim() || person.email : "a person";
  const agentName = agent?.name ?? "A teammate";
  const sites = await hostsOf(rowId).catch(() => []);
  await logActivity({
    type: "teammate_browser.session_ended",
    actorId: actor.type === "system" ? null : (actor.id ?? row.userId),
    ...(actor.type === "system" ? { actorType: "system", actorLabel: "WorkwrK", actingForId: row.userId } : {}),
    ...(actor.type === "agent" ? { actorType: "agent", actorLabel: actorLabelFor({ name: agentName }, { name: personName }), actingForId: row.userId } : {}),
    organizationId: row.organizationId,
    description: agentAuditLine(agentName, personName, BROWSER_AUDIT_COPY.sessionEnded(minutes)),
    targetId: row.agentId,
    targetType: "agent",
    metadata: { browserSessionId: rowId, agentId: row.agentId, reason, minutes, sites, released: released !== "failed" },
    severity: "info",
  });
  publishToUser(row.userId, { type: "agent.changed", agentId: row.agentId, browserSessionId: rowId });
  return true;
}

/**
 * End a row unless a step holds its browser now (review of Phase 4 step 2):
 * the browser's lock tried without waiting, a holder read as "not now" (the
 * next tick looks again), and the end run under the lock, so no step starts
 * on a browser being closed. A row whose browser this process does not hold
 * has no step in flight here, and ends as it would have.
 */
async function endWhenFree(rowId: string, reason: EndReason, actor: EndActor, only: Prisma.TeammateBrowserSessionWhereInput): Promise<boolean> {
  const out = await withBrowserLock(rowId, 0, () => endBrowserSession(rowId, reason, actor, { only }));
  if (typeof out === "boolean") return out;
  if ("busy" in out) return false;
  return endBrowserSession(rowId, reason, actor, { only });
}

/**
 * End these rows side by side, END_AT_ONCE at a time; how many this call
 * ended. `only` and `whenFree`: see endBrowserSession and endWhenFree.
 */
async function endRows(
  ids: readonly string[],
  reason: EndReason,
  actor: EndActor,
  deadline = Number.POSITIVE_INFINITY,
  o: { only?: Prisma.TeammateBrowserSessionWhereInput; whenFree?: boolean } = {},
): Promise<number> {
  let ended = 0;
  for (let i = 0; i < ids.length; i += END_AT_ONCE) {
    if (Date.now() >= deadline) break;
    const outs = await Promise.all(
      ids.slice(i, i + END_AT_ONCE).map((id) =>
        (o.whenFree && o.only ? endWhenFree(id, reason, actor, o.only) : endBrowserSession(id, reason, actor, o.only ? { only: o.only } : {})).catch((err) => {
          console.error(`[browser] a browser did not end: ${errorLine(err)}`);
          return false;
        }),
      ),
    );
    ended += outs.filter(Boolean).length;
  }
  return ended;
}

/** The most rows one hook ends: every workspace's live rows are far fewer (its plan's browsers at once). */
const HOOK_MAX = 1000;

async function liveIds(where: Prisma.TeammateBrowserSessionWhereInput): Promise<string[]> {
  const rows = await prisma.teammateBrowserSession.findMany({ where: { ...where, status: { in: LIVE } }, select: { id: true }, take: HOOK_MAX, orderBy: { startedAt: "asc" } });
  return rows.map((r) => r.id);
}

/** People leaving, deactivated, or no longer someone a teammate may act for here (leaver-hooks.ts). */
export async function endBrowserSessionsFor(organizationId: string, userIds: readonly string[], reason: "left" | "deactivated" | "no_access", actorId: string | null): Promise<number> {
  const ids = [...new Set(userIds.filter((id) => typeof id === "string" && id.length > 0))];
  if (ids.length === 0) return 0;
  return endRows(await liveIds({ organizationId, userId: { in: ids } }), reason, actorOf(actorId));
}

/** A person's own account deleted (POST /api/me/delete): their browsers in every workspace. */
export async function endAllBrowserSessionsOf(userId: string, actorId: string | null = null): Promise<number> {
  return endRows(await liveIds({ userId }), "left", actorOf(actorId));
}

/** The switch off, Stop every browser, the workspace closed or suspended, the plan dropped: every browser in it. */
export async function endWorkspaceBrowserSessions(organizationId: string, reason: "turned_off" | "workspace_closed" | "admin_stopped" | "plan", actorId: string | null): Promise<number> {
  return endRows(await liveIds({ organizationId }), reason, actorOf(actorId));
}

/** A teammate paused, removed, or its browser tools taken away. */
export async function endTeammateBrowserSessions(agentId: string): Promise<number> {
  return endRows(await liveIds({ agentId }), "teammate_off", SYSTEM_END);
}

// ── The rules this process's browsers obey ──────────────────────────

/** How a refusal ends a live session (the sweep's and refreshLiveRules' mapping). */
export function endReasonFor(reason: ComputerRefusal): EndReason {
  if (reason === "trial" || reason === "plan") return "plan";
  if (reason === "workspace_closed") return "workspace_closed";
  if (reason === "no_sites") return "teammate_off";
  return "turned_off";
}

/** How long the rules' refresh waits for a step in flight before it leaves the page (review of Phase 4 step 2). */
export const RULES_LOCK_WAIT_MS = 10_000;

/**
 * The page a browser is on, left for about:blank when the rules it obeys now
 * refuse it (review of Phase 4 step 2): under the browser's lock, so no step
 * is half way through it; the read's refs, their page and the row's current
 * host forgotten, a "refused" step written with the verdict's code, and a
 * note for the next result. A browser busy past the wait keeps the page
 * until its next call (step 3 checks the current page's verdict before every
 * read); the guard already refuses its next hop.
 */
async function leaveRefusedPage(rowId: string): Promise<void> {
  const out = await withBrowserLock(rowId, RULES_LOCK_WAIT_MS, async (lb) => {
    const url = lb.handle.currentUrl();
    const site = siteOf(url);
    // about:blank, Chrome's own pages: no site to leave.
    if (!site || !/^https?:/i.test(url)) return false;
    const verdict = siteVerdict(url, lb.rules);
    if (verdict.ok) return false;
    await lb.handle.blank();
    lb.refs.clear();
    lb.refsUrl = null;
    noteEvent(lb, BROWSER_COPY.siteNoLongerAllowed(site));
    await prisma.teammateBrowserSession.updateMany({ where: { id: rowId, status: { in: LIVE } }, data: { currentSite: null } });
    await recordStep(rowId, lb.userId, { kind: "open", site, outcome: "refused", code: verdict.code });
    return true;
  });
  if (typeof out === "object" && "busy" in out) console.error("[browser] a page no longer allowed was not left: a step held the browser");
}

/**
 * Give this process's browsers of a workspace (or of one teammate) the
 * rules as they are now, the moment a list or a teammate's sites change: the
 * guard reads them on every request, a take over's own clicks included, and
 * a browser on a page the new rules refuse leaves it (leaveRefusedPage). One
 * that may no longer browse at all ends. Best effort: a failure is logged,
 * and the next call or the sweep catches it.
 */
export async function refreshLiveRules(filter: { organizationId?: string; agentId?: string }): Promise<void> {
  const browsers = liveBrowsersWhere((lb) => (!filter.organizationId || lb.organizationId === filter.organizationId) && (!filter.agentId || lb.agentId === filter.agentId));
  const leaving: Array<Promise<void>> = [];
  for (const lb of browsers) {
    try {
      const agent = await computerAgentById(lb.organizationId, lb.agentId);
      if (!agent || !agent.browserTools) {
        await endBrowserSession(lb.rowId, "teammate_off", SYSTEM_END);
        continue;
      }
      const access = await computerAccess({ organizationId: lb.organizationId, agent });
      if (!access.ok) {
        await endBrowserSession(lb.rowId, endReasonFor(access.reason), SYSTEM_END);
        continue;
      }
      // The guard first, at once: the next hop obeys the new rules even while a step holds the browser.
      lb.rules = access.rules;
      leaving.push(leaveRefusedPage(lb.rowId).catch((err) => console.error(`[browser] a page no longer allowed was not left: ${errorLine(err)}`)));
    } catch (err) {
      console.error(`[browser] a browser's rules were not refreshed: ${errorLine(err)}`);
    }
  }
  await Promise.all(leaving);
}

// ── Usage, the switch and the lists ─────────────────────────────────

/** The workspace's browser use this month, as numbers only (Decision 30); the cost from the founder's rate only (Decision 34). */
export async function browserUsage(organizationId: string): Promise<BrowserUsage> {
  const [org, live, month] = await Promise.all([workspaceOf(organizationId), liveCounts(prisma, organizationId), monthCounts(prisma, organizationId, "")]);
  const caps = org ? BROWSER_LIMITS[org.plan] : null;
  const cfg = browserConfig();
  const price = cfg?.priceCentsPerHour ?? null;
  return {
    minutesUsed: month.month,
    minutesCap: caps?.minutesPerMonth ?? 0,
    atOnce: live.atOnce,
    atOnceCap: caps?.atOnce ?? 0,
    sessionsToday: month.today,
    sessionsTodayCap: caps?.sessionsPerDay ?? 0,
    costCents: price === null ? null : Math.round((month.month * price) / 60),
  };
}

/** What Owners and Admins see (GET /api/teammate-browser/policy): never a browser, a person or a step. */
export async function browserPolicyView(organizationId: string): Promise<BrowserPolicyView> {
  const cfg = browserConfig();
  const w = await workspaceComputer(organizationId);
  // The switch itself is not a reason the section cannot offer it.
  const reason = w.reason === "workspace_off" ? null : w.reason;
  const available = reason === null;
  return {
    available,
    reason,
    plan: w.plan,
    region: cfg?.region ?? null,
    enabled: w.policy.enabled,
    allowSites: w.policy.allowSites,
    blockSites: w.policy.blockSites,
    usage: available ? await browserUsage(organizationId) : null,
    updatedAt: w.policy.updatedAt ? w.policy.updatedAt.toISOString() : null,
  };
}

/**
 * Turn the computer on or off for the workspace, answering what it was just
 * before this write and what it left (both under the policy's lock, the
 * Phase 3 setPolicyProduct shape). Off ends every browser in it at once,
 * after the commit, whatever it was before (a start racing the switch).
 */
export async function setComputerEnabled(organizationId: string, on: boolean, actorId: string): Promise<{ before: boolean; after: boolean; ended: number }> {
  const out = await prisma.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(${POLICY_LOCK_CLASS}::int, hashtext(${organizationId}))`;
    const was = await tx.$queryRaw<Array<{ enabled: boolean }>>`
      SELECT "enabled" FROM "TeammateBrowserPolicy" WHERE "organizationId" = ${organizationId} FOR UPDATE`;
    const rows = await tx.$queryRaw<Array<{ enabled: boolean }>>`
      INSERT INTO "TeammateBrowserPolicy" ("organizationId", "enabled", "allowSites", "blockSites", "updatedById", "createdAt", "updatedAt")
      VALUES (${organizationId}, ${on}::boolean, ARRAY[]::text[], ARRAY[]::text[], ${actorId}, (now() AT TIME ZONE 'UTC'), (now() AT TIME ZONE 'UTC'))
      ON CONFLICT ("organizationId") DO UPDATE SET
        "enabled" = ${on}::boolean,
        "updatedById" = ${actorId},
        "updatedAt" = (now() AT TIME ZONE 'UTC')
      RETURNING "enabled"`;
    return { before: was[0]?.enabled === true, after: rows[0]?.enabled === true };
  }, LOCK_TX);
  const ended = out.after ? 0 : await endWorkspaceBrowserSessions(organizationId, "turned_off", actorId);
  return { ...out, ended };
}

const LIST_COLUMN = { allow: Prisma.raw('"allowSites"'), block: Prisma.raw('"blockSites"') } as const;

/**
 * One site added to or removed from one of the workspace's lists, as one
 * statement that changes the array where it is (array_append or
 * array_remove), never a list worked out here, so two Admins at once never
 * lose each other's change; what it was is read in the same transaction
 * under the lock, so `changed` is exactly this write's. A list at its most
 * answers tooMany and changes nothing.
 */
export async function changePolicySite(
  organizationId: string,
  list: "allow" | "block",
  change: { add: string } | { remove: string },
  actorId: string,
): Promise<{ changed: boolean; sites: string[]; tooMany?: true }> {
  const col = LIST_COLUMN[list];
  const max = SITE_LIST_MAX[list];
  const adding = "add" in change;
  const site = adding ? change.add : change.remove;
  const out = await prisma.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(${POLICY_LOCK_CLASS}::int, hashtext(${organizationId}))`;
    const was = await tx.$queryRaw<Array<{ sites: string[] }>>`
      SELECT ${col} AS "sites" FROM "TeammateBrowserPolicy" WHERE "organizationId" = ${organizationId} FOR UPDATE`;
    const before = strings(was[0]?.sites);
    if (adding && before.includes(site)) return { changed: false, sites: before };
    if (!adding && !before.includes(site)) return { changed: false, sites: before };
    if (adding && before.length >= max) return { changed: false, sites: before, tooMany: true as const };
    const rows = adding
      ? await tx.$queryRaw<Array<{ sites: string[] }>>`
          INSERT INTO "TeammateBrowserPolicy" ("organizationId", "enabled", "allowSites", "blockSites", "updatedById", "createdAt", "updatedAt")
          VALUES (${organizationId}, false,
                  CASE WHEN ${list}::text = 'allow' THEN ARRAY[${site}::text] ELSE ARRAY[]::text[] END,
                  CASE WHEN ${list}::text = 'block' THEN ARRAY[${site}::text] ELSE ARRAY[]::text[] END,
                  ${actorId}, (now() AT TIME ZONE 'UTC'), (now() AT TIME ZONE 'UTC'))
          ON CONFLICT ("organizationId") DO UPDATE SET
            ${col} = CASE WHEN ${site}::text = ANY("TeammateBrowserPolicy".${col}) THEN "TeammateBrowserPolicy".${col}
                          ELSE array_append("TeammateBrowserPolicy".${col}, ${site}::text) END,
            "updatedById" = ${actorId},
            "updatedAt" = (now() AT TIME ZONE 'UTC')
          RETURNING ${col} AS "sites"`
      : await tx.$queryRaw<Array<{ sites: string[] }>>`
          UPDATE "TeammateBrowserPolicy"
             SET ${col} = array_remove(${col}, ${site}::text), "updatedById" = ${actorId}, "updatedAt" = (now() AT TIME ZONE 'UTC')
           WHERE "organizationId" = ${organizationId}
          RETURNING ${col} AS "sites"`;
    const after = strings(rows[0]?.sites);
    return { changed: after.length !== before.length || after.some((s, i) => s !== before[i]), sites: after };
  }, LOCK_TX);
  if (out.changed) await refreshLiveRules({ organizationId });
  return out;
}

/**
 * One site added to or removed from a teammate's own list, under a lock on
 * its Agent row (FOR UPDATE), one change per request (the Phase 3 step 5
 * fix: a stale page can never write a whole list back). Null when the
 * teammate is not in this workspace. A list at its most answers tooMany.
 */
export async function changeTeammateSite(
  agentId: string,
  organizationId: string,
  change: { add: string } | { remove: string },
): Promise<{ changed: boolean; sites: string[]; tooMany?: true } | null> {
  const adding = "add" in change;
  const site = adding ? change.add : change.remove;
  const out = await prisma.$transaction(async (tx) => {
    const held = await tx.$queryRaw<Array<{ browserSites: string[] }>>`
      SELECT "browserSites" FROM "Agent" WHERE "id" = ${agentId} AND "organizationId" = ${organizationId} FOR UPDATE`;
    if (held.length === 0) return null;
    const before = strings(held[0].browserSites);
    if (adding && before.includes(site)) return { changed: false, sites: before };
    if (!adding && !before.includes(site)) return { changed: false, sites: before };
    if (adding && before.length >= SITE_LIST_MAX.teammate) return { changed: false, sites: before, tooMany: true as const };
    const rows = adding
      ? await tx.$queryRaw<Array<{ browserSites: string[] }>>`
          UPDATE "Agent" SET "browserSites" = array_append("browserSites", ${site}::text), "updatedAt" = (now() AT TIME ZONE 'UTC')
           WHERE "id" = ${agentId} RETURNING "browserSites"`
      : await tx.$queryRaw<Array<{ browserSites: string[] }>>`
          UPDATE "Agent" SET "browserSites" = array_remove("browserSites", ${site}::text), "updatedAt" = (now() AT TIME ZONE 'UTC')
           WHERE "id" = ${agentId} RETURNING "browserSites"`;
    return { changed: true, sites: strings(rows[0]?.browserSites) };
  }, LOCK_TX);
  if (out?.changed) await refreshLiveRules({ agentId });
  return out;
}

// ── What the person sees ────────────────────────────────────────────

function iso(d: Date | null): string | null {
  return d ? d.toISOString() : null;
}

const STATUS_SET: ReadonlySet<string> = new Set(["starting", "live", "waiting", "handed_over", "ending", "ended"]);

/** The session views of these rows (the person's own, read by their id). */
async function viewsOf(rows: SessionRow[], now: Date): Promise<BrowserSessionView[]> {
  if (rows.length === 0) return [];
  const ids = rows.map((r) => r.id);
  const [agents, steps, shots, cards] = await Promise.all([
    prisma.agent.findMany({ where: { id: { in: [...new Set(rows.map((r) => r.agentId))] } }, select: { id: true, name: true } }),
    prisma.teammateBrowserStep.findMany({ where: { browserSessionId: { in: ids } }, orderBy: [{ browserSessionId: "asc" }, { seq: "asc" }], select: { browserSessionId: true, seq: true, kind: true, site: true, outcome: true, code: true, at: true, shotId: true } }),
    prisma.teammateBrowserShot.findMany({ where: { browserSessionId: { in: ids }, expiresAt: { gt: now } }, orderBy: { createdAt: "asc" }, select: { id: true, browserSessionId: true, kind: true, createdAt: true, expiresAt: true } }),
    prisma.agentAction.findMany({
      where: { toolName: { in: [...BROWSER_CARD_TOOLS] }, status: "PENDING", sessionId: { in: [...new Set(rows.map((r) => r.chatSessionId).filter((c): c is string => !!c))] } },
      select: { id: true, toolName: true, input: true },
    }),
  ]);
  const names = new Map(agents.map((a) => [a.id, a.name]));
  return rows.map((r) => {
    const waitingCard = cards.find((c) => (c.input as Record<string, unknown> | null)?.browserSessionId === r.id);
    const status = (STATUS_SET.has(r.status) ? r.status : "ended") as SessionStatus;
    return {
      id: r.id,
      agentId: r.agentId,
      agentName: names.get(r.agentId) ?? "",
      status,
      site: r.currentSite,
      startedAt: r.startedAt.toISOString(),
      endsBy: r.endsBy.toISOString(),
      endedAt: iso(r.endedAt),
      endReason: (r.endReason as EndReason | null) ?? null,
      endedLine: status === "ended" || status === "ending" ? endedLine((r.endReason as EndReason | null) ?? null) : null,
      minutes: sessionMinutes(r, now),
      waiting: waitingCard && (status === "waiting" || status === "live") ? { actionId: waitingCard.id, kind: waitingCard.toolName === "ask_to_take_over" ? "take_over" : "act" } : null,
      steps: steps
        .filter((s) => s.browserSessionId === r.id)
        .map((s) => ({
          seq: s.seq,
          kind: s.kind as StepKind,
          site: s.site,
          outcome: s.outcome as StepOutcome,
          code: s.code,
          at: s.at.toISOString(),
          shotId: s.shotId,
          line: stepLine({ kind: s.kind as StepKind, site: s.site, outcome: s.outcome as StepOutcome }),
        })),
      shots: shots.filter((s) => s.browserSessionId === r.id).map((s) => ({ id: s.id, kind: s.kind === "element" ? "element" : "page", at: s.createdAt.toISOString(), expiresAt: s.expiresAt.toISOString() })),
    };
  });
}

/** One session, only the viewer's own in their workspace; null for anyone else's, an Owner's included (Decision 30). */
export async function sessionViewFor(viewer: { userId: string; organizationId: string }, rowId: string): Promise<BrowserSessionView | null> {
  if (typeof rowId !== "string" || !rowId || rowId.length > 64) return null;
  const row = await prisma.teammateBrowserSession.findFirst({ where: { id: rowId, userId: viewer.userId, organizationId: viewer.organizationId }, select: SESSION_SELECT });
  if (!row) return null;
  return (await viewsOf([row], new Date()))[0] ?? null;
}

/** The viewer's own sessions in one chat, newest six. */
export async function sessionsInChat(viewer: { userId: string; organizationId: string }, chatSessionId: string): Promise<BrowserSessionView[]> {
  if (typeof chatSessionId !== "string" || !chatSessionId || chatSessionId.length > 64) return [];
  const rows = await prisma.teammateBrowserSession.findMany({
    where: { chatSessionId, userId: viewer.userId, organizationId: viewer.organizationId },
    orderBy: { startedAt: "desc" },
    take: 6,
    select: SESSION_SELECT,
  });
  return viewsOf(rows, new Date());
}

/** The viewer's own row, as the session routes read it before acting; null for anyone else's. */
export async function ownSessionRow(viewer: { userId: string; organizationId: string }, rowId: string): Promise<SessionRow | null> {
  if (typeof rowId !== "string" || !rowId || rowId.length > 64) return null;
  return prisma.teammateBrowserSession.findFirst({ where: { id: rowId, userId: viewer.userId, organizationId: viewer.organizationId }, select: SESSION_SELECT });
}

// ── The cron's sweep ────────────────────────────────────────────────

export type BrowserSweepCounts = {
  /** Parts that threw (logged); the tick fails, and the other parts still ran. */
  failed: number;
  startFailed: number;
  restarted: number;
  timeCap: number;
  idle: number;
  waited: number;
  takeOver: number;
  noAccess: number;
  retried: number;
  reaped: number;
  stepsDeleted: number;
  shotsDeleted: number;
};

/** Why a person may no longer be acted for, as the sweep ends their browser. */
function leaverReason(r: string): EndReason {
  if (r === "gone") return "left";
  if (r === "inactive") return "deactivated";
  return "no_access";
}

/**
 * The cron's step (run-due-agents), each part only while the budget lasts
 * and each on its own (one that throws is counted in `failed`, which fails
 * the tick, and the rest still run), the answer counts only:
 *   1. "starting" past SESSION_TIMES.startMs            start_failed
 *   2. a guard another process held, or that this one
 *      no longer holds (or lost its connection)          restarted
 *   3. past endsBy                                       time_cap
 *   4. handed over past takeOverMs                       take_over_too_long
 *   5. waiting past waitingMs                            waited_too_long
 *   6. live, idle past idleMs, its last run ended or
 *      stale                                             idle
 *      (4 to 6 each end a row only if it still meets its condition at the
 *      swap and no step holds its browser: review of Phase 4 step 2)
 *   7. the rest: the person may no longer be acted for (left, deactivated,
 *      no_access), the computer may not be used (turned_off, plan,
 *      workspace_closed, teammate_off for no sites), the teammate paused,
 *      removed or holding no browser tool (teammate_off)
 *   8. releases the provider did not confirm, tried again; after
 *      STOP_ATTEMPTS_MAX the row is ended at its reserved minutes (the
 *      provider's own limit has ended it by then)
 *   9. the reaper: provider sessions tagged with this deployment whose row
 *      is gone or not live, released, at most REAP_MAX; untagged ones and
 *      other deployments' are left alone
 *  10. steps older than 30 days, at most STEP_RETENTION_BATCH
 *  11. pictures past their 24 hours, and files no row names
 * Two app processes would end each other's browsers as "restarted": the
 * deployment runs one (pm2 one workwrk instance), failing closed if not.
 */
export async function sweepBrowserSessions(now: Date, o: { limit: number; budgetMs: number }): Promise<BrowserSweepCounts> {
  const counts: BrowserSweepCounts = { failed: 0, startFailed: 0, restarted: 0, timeCap: 0, idle: 0, waited: 0, takeOver: 0, noAccess: 0, retried: 0, reaped: 0, stepsDeleted: 0, shotsDeleted: 0 };
  const deadline = Date.now() + Math.max(0, o.budgetMs);
  const limit = Math.max(0, o.limit);
  const cfg = browserConfig();
  const ms = (seconds: number | null | undefined, fallback: number) => (cfg?.standIn && seconds ? seconds * 1000 : fallback);
  const idleMs = ms(cfg?.testTimes.idleSeconds, SESSION_TIMES.idleMs);
  const waitingMs = ms(cfg?.testTimes.waitSeconds, SESSION_TIMES.waitingMs);
  const before = (n: number) => new Date(now.getTime() - n);
  const open = () => Date.now() < deadline;
  const ids = async (where: Prisma.TeammateBrowserSessionWhereInput) =>
    (await prisma.teammateBrowserSession.findMany({ where, select: { id: true }, take: limit, orderBy: { startedAt: "asc" } })).map((r) => r.id);
  // Each part on its own: one that throws is counted and logged, and the rest still run.
  const part = async (fn: () => Promise<void>, what: string) => {
    if (!open()) return;
    try {
      await fn();
    } catch (err) {
      counts.failed += 1;
      console.error(`[cron-failure] run-due-agents: the browser sweep's ${what} threw: ${errorLine(err)}`);
    }
  };

  await part(async () => {
    counts.startFailed = await endRows(await ids({ status: "starting", startedAt: { lt: before(SESSION_TIMES.startMs) } }), "start_failed", SYSTEM_END, deadline);
  }, "start check");

  await part(async () => {
    const elsewhere = await ids({ status: { in: ["live", "waiting", "handed_over"] }, bootId: { not: BOOT_ID } });
    const here = await prisma.teammateBrowserSession.findMany({ where: { status: { in: ["live", "waiting", "handed_over"] }, bootId: BOOT_ID }, select: { id: true }, take: limit });
    const orphaned = here.map((r) => r.id).filter((id) => !liveBrowser(id));
    const lost = here.map((r) => r.id).filter((id) => liveBrowser(id)?.lost === true);
    counts.restarted = (await endRows([...elsewhere, ...orphaned], "restarted", SYSTEM_END, deadline)) + (await endRows(lost, "provider_ended", SYSTEM_END, deadline));
  }, "guard check");

  await part(async () => {
    counts.timeCap = await endRows(await ids({ status: { in: LIVE }, endsBy: { lte: now } }), "time_cap", SYSTEM_END, deadline);
  }, "time cap");

  // The time-based parts (review of Phase 4 step 2): each row ends only if
  // it still meets its condition at the swap, and only while no step holds
  // its browser; time_cap, the access refusals, Stop and the hard cap still
  // end at once.
  await part(async () => {
    const only = { status: "handed_over", handedOverAt: { lt: before(SESSION_TIMES.takeOverMs) } } satisfies Prisma.TeammateBrowserSessionWhereInput;
    counts.takeOver = await endRows(await ids(only), "take_over_too_long", SYSTEM_END, deadline, { only, whenFree: true });
  }, "take over check");

  await part(async () => {
    const only = { status: "waiting", waitingSince: { lt: before(waitingMs) } } satisfies Prisma.TeammateBrowserSessionWhereInput;
    counts.waited = await endRows(await ids(only), "waited_too_long", SYSTEM_END, deadline, { only, whenFree: true });
  }, "waiting check");

  await part(async () => {
    const only = { status: "live", lastActiveAt: { lt: before(idleMs) } } satisfies Prisma.TeammateBrowserSessionWhereInput;
    const idle = await prisma.teammateBrowserSession.findMany({ where: only, select: { id: true, lastRunId: true }, take: limit, orderBy: { lastActiveAt: "asc" } });
    const quiet: string[] = [];
    for (const r of idle) if (!(await runHolds(r.lastRunId, null, now))) quiet.push(r.id);
    counts.idle = await endRows(quiet, "idle", SYSTEM_END, deadline, { only, whenFree: true });
  }, "idle check");

  await part(async () => {
    const rest = await prisma.teammateBrowserSession.findMany({
      where: { status: { in: ["live", "waiting", "handed_over"] } },
      select: { id: true, organizationId: true, userId: true, agentId: true },
      take: limit,
      orderBy: { lastActiveAt: "asc" },
    });
    for (const r of rest) {
      if (!open()) break;
      const acting = await resolveActingPerson(r.organizationId, r.userId);
      let reason: EndReason | null = null;
      if (!acting.ok) reason = leaverReason(acting.reason);
      else {
        const agent = await computerAgentById(r.organizationId, r.agentId);
        if (!agent || !agent.browserTools) reason = "teammate_off";
        else {
          const access = await computerAccess({ organizationId: r.organizationId, agent });
          if (!access.ok) reason = endReasonFor(access.reason);
        }
      }
      if (reason && (await endBrowserSession(r.id, reason, SYSTEM_END).catch(() => false))) counts.noAccess += 1;
    }
  }, "access check");

  await part(async () => {
    const due = await prisma.teammateBrowserSession.findMany({
      where: { status: "ending", nextStopAt: { lte: now } },
      select: { id: true, providerSessionId: true, reservedMinutes: true, startedAt: true, stopAttempts: true },
      take: limit,
      orderBy: { nextStopAt: "asc" },
    });
    let givenUp = 0;
    for (const r of due) {
      if (!open()) break;
      const out = await release(r.providerSessionId);
      if (out !== "failed") {
        await markEnded(r, now);
        counts.retried += 1;
      } else if (r.stopAttempts + 1 >= STOP_ATTEMPTS_MAX) {
        await markEnded(r, now, r.reservedMinutes);
        givenUp += 1;
      } else {
        await prisma.teammateBrowserSession.updateMany({ where: { id: r.id, status: "ending" }, data: { stopAttempts: { increment: 1 }, nextStopAt: new Date(now.getTime() + STOP_RETRY_MS) } });
      }
    }
    if (givenUp > 0) console.error(`[browser] ${givenUp} release(s) the provider never confirmed, ended at their reserved minutes`);
  }, "release retry");

  await part(async () => {
    const rc = browserReleaseConfig();
    if (!rc) return;
    const listed = await listRunningProviderSessions(rc);
    if (!listed.ok) return;
    const tagged = listed.data.filter((s) => s.tag === rc.deploymentTag).slice(0, 500);
    if (tagged.length === 0) return;
    const rows = await prisma.teammateBrowserSession.findMany({
      where: { OR: [{ providerSessionId: { in: tagged.map((t) => t.providerSessionId) } }, { id: { in: tagged.map((t) => t.rowId).filter((x): x is string => !!x) } }] },
      select: { id: true, providerSessionId: true, status: true },
    });
    const byPid = new Map(rows.filter((r) => r.providerSessionId).map((r) => [r.providerSessionId as string, r]));
    const byRow = new Map(rows.map((r) => [r.id, r]));
    for (const t of tagged) {
      if (counts.reaped >= REAP_MAX || !open()) break;
      const row = byPid.get(t.providerSessionId) ?? (t.rowId ? byRow.get(t.rowId) : undefined);
      // A row still starting has not written its provider id yet: it is live.
      if (row && LIVE.includes(row.status)) continue;
      const out = await releaseProviderSession(rc, t.providerSessionId).catch(() => "failed" as const);
      if (out !== "failed") counts.reaped += 1;
    }
  }, "reaper");

  await part(async () => {
    counts.stepsDeleted = await prisma.$executeRaw`
      DELETE FROM "TeammateBrowserStep"
       WHERE "id" IN (SELECT "id" FROM "TeammateBrowserStep"
                       WHERE "at" < (now() AT TIME ZONE 'UTC') - interval '30 days'
                       LIMIT ${STEP_RETENTION_BATCH})`;
  }, "step retention");

  await part(async () => {
    const s = await sweepShots(now);
    counts.shotsDeleted = s.expired + s.orphans;
  }, "pictures");

  return counts;
}
