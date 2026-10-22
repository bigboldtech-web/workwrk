import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSessionOrFail, getUserId, jsonError } from "@/lib/api-helpers";
import { subjectRowView } from "@/lib/people/review-visibility";
import type { Prisma } from "@/generated/prisma";
import { exportWrittenAboutOthersWhere, isWriterPartOnly, myActivityWhere, writerPartSentence } from "@/lib/access/personal-activity";
import { agentIdsIn } from "@/lib/access/manager-candidate";
import { SKILLS_EXPORT_NOTE } from "@/lib/agents/teammate-copy";
import { MCP_EXPORT_COPY } from "@/lib/mcp/mcp-copy";
import { storedSteps } from "@/lib/skills/steps";
import { deletesOnOf } from "@/lib/skills/views";

/**
 * The most messages of one teammate chat the export carries, newest kept
 * (review round 3 of Phase 3): one chat can run to tens of thousands of
 * rows, and the export is one response. A chat cut says how many it left
 * out, so the copy never reads as whole when it is not. Not exported: a
 * route file exports its handlers only.
 */
const TEAMMATE_CHAT_EXPORT_MAX = 5_000;

/**
 * The most teammate chat messages the whole export carries, across every
 * teammate and group chat (review round 4 of Phase 3): with only the per chat
 * cap, a person with many long chats read them all at once, side by side,
 * and the export could fail or run the server out of memory. Chats are read
 * one at a time, the most recently active first, each taking its newest
 * messages up to what is left of this and of TEAMMATE_CHAT_EXPORT_MAX; each
 * says how many it left out.
 */
const TEAMMATE_CHATS_EXPORT_BUDGET = 20_000;

/**
 * The most requests a teammate asked the person to approve that the export
 * carries, newest kept, with how many it left out (review round 4 of Phase
 * 3): each holds what it would send, an email's whole body among them.
 */
const TEAMMATE_REQUESTS_EXPORT_MAX = 5_000;

/** The chats with AI teammates: one per teammate, and the group chats (src/lib/agents/group-server.ts GROUP_KIND). */
const TEAMMATE_CHAT_KINDS = ["TEAMMATE", "TEAMMATE_GROUP"];

/**
 * The most characters of one tool call's input a teammate chat message
 * carries, its JSON cut there and marked (review round 5 of Phase 3). A
 * call's result is left out altogether (TOOL_CALLS_NOTE).
 */
const TEAMMATE_TOOL_INPUT_EXPORT_MAX = 2_000;

/**
 * The most bytes the teammate chat messages and requests add to the export
 * together, counted as the UTF-8 length of each row as exported (review
 * round 5 of Phase 3): a cap on rows alone let 20,000 messages, each holding
 * whole tool results, reach gigabytes in one response. Requests take it
 * first, then chats, most recently active first; once it runs out no more
 * rows are taken, and each list says how many it left out.
 */
const TEAMMATE_EXPORT_BYTE_BUDGET = 50 * 1024 * 1024;

/** Rows read at once from one chat or the requests: whole tool results are read, then dropped, a page at a time. */
const TEAMMATE_EXPORT_PAGE = 100;

/** The most activity rows and notifications the export carries, each the newest, with how many it left out (review round 5 of Phase 3). */
const ACTIVITY_EXPORT_MAX = 10_000;
const NOTIFICATIONS_EXPORT_MAX = 10_000;

/**
 * The most rows of activityAboutOthers the export carries, the newest, with
 * how many it left out (review round 4 of Phase 4): the personal teammate
 * rows the person wrote about someone else, read on their own so they never
 * take the place of the person's own rows in activityLogs. One Disconnect
 * everyone writes a row a connection, so an Admin can write thousands at
 * once, each the same trimmed line.
 */
const ACTIVITY_ABOUT_OTHERS_EXPORT_MAX = 1_000;

/** What the export says beside activityAboutOthers (review round 4 of Phase 4). */
const ACTIVITY_ABOUT_OTHERS_NOTE = "Records of your actions on other people's AI teammate work, such as closing their teammate's browser or disconnecting their Google: the kind of action, when, and your own IP address and browser. Whom each was about and its details, such as the sites a browser used, are left out, since those are the other person's.";

/**
 * The activity rows' columns the export carries (review round 2 of Phase 4).
 * Every row of activityLogs is the person's (myActivityWhere): one they
 * wrote that is not a personal teammate row, or a personal teammate row
 * about them, whoever wrote it. So each keeps its metadata (a browser
 * session's sites are theirs), but the IP address and user agent of a row
 * someone else wrote (a manager ending their browser, an Admin
 * disconnecting their Google) are that writer's, and are left out
 * (exportedActivity). activityAboutOthers (exportWrittenAboutOthersWhere,
 * review rounds 3 and 4 of Phase 4) holds the personal teammate rows the
 * person wrote about someone else, each trimmed to the writer's part (see
 * exportedActivity).
 */
const ACTIVITY_EXPORT_SELECT = {
  id: true, organizationId: true, type: true, description: true, severity: true,
  actorId: true, actorType: true, actorLabel: true, actingForId: true, targetType: true, targetId: true,
  metadata: true, oldValue: true, newValue: true, ipAddress: true, userAgent: true, createdAt: true,
} as const;

type ExportedActivityRow = Prisma.ActivityLogGetPayload<{ select: typeof ACTIVITY_EXPORT_SELECT }>;

/**
 * An activity row as exported: the writer's IP address and user agent only
 * on the person's own rows (see ACTIVITY_EXPORT_SELECT). A personal teammate
 * row the person wrote about someone else (review round 3 of Phase 4: a
 * manager's removal that ended a report's browser, an Admin's Disconnect
 * everyone) is theirs as the writer only: its id, workspace, type, time,
 * actor columns, severity and the writer's own IP address and user agent,
 * with a sentence by its type alone (writerPartSentence). Whom it was
 * about, its sites and its other facts (actingForId, targetType, targetId,
 * metadata, oldValue, newValue) are the other person's, and are null.
 * Before round 3, the export left these rows out, so an Article 15 answer
 * missed them. Every row of activityAboutOthers takes this path (its where
 * clause finds only rows isWriterPartOnly trims), and no row of
 * activityLogs does.
 */
function exportedActivity(row: ExportedActivityRow, userId: string): ExportedActivityRow {
  const own = row.actorId === userId ? row : { ...row, ipAddress: null, userAgent: null };
  if (!isWriterPartOnly(row, userId)) return own;
  return { ...own, description: writerPartSentence(row.type), actingForId: null, targetType: null, targetId: null, metadata: null, oldValue: null, newValue: null };
}

/**
 * The most browser steps (AI teammates Phase 4: what a teammate did in a
 * browser for the person, as kinds and sites only) the export carries,
 * newest kept, within what is left of TEAMMATE_EXPORT_BYTE_BUDGET, with how
 * many it left out. Steps are kept 30 days, so they are read through the
 * person's sessions of the last 31 days (by "userId", "startedAt"),
 * BROWSER_SESSIONS_PER_READ sessions at a time.
 */
const BROWSER_STEPS_EXPORT_MAX = 20_000;
const BROWSER_SESSIONS_PER_READ = 20;
const BROWSER_STEPS_DAYS = 31;

/** What the export says beside the browser steps (Phase 4). */
const BROWSER_STEPS_NOTE = "Each step an AI teammate took in a web browser for you: its kind, the site and when. Steps are kept 30 days. What the pages showed and what was typed in them are never kept.";

/**
 * The person's skills (AI teammates Phase 5, Decision 14): each with its
 * steps as stored, in every workspace, oldest first, within what is left of
 * TEAMMATE_EXPORT_BYTE_BUDGET after the browser steps, with how many it left
 * out. A person keeps at most 50 skills a workspace (SKILL_LIMITS.perPerson),
 * read SKILLS_PER_READ at a time by ("userId", "createdAt").
 */
const SKILLS_PER_READ = 50;

/**
 * The AI apps the person connected through the MCP server
 * (docs/plans/mcp-server.md 5.5, step 4): at most this many of their
 * connections, newest first, live or ended (an ended one is kept 90 days
 * after it ends, src/lib/oauth/sweep.ts), each with at most 90 days of daily
 * counts.
 */
const CONNECTED_APPS_EXPORT_MAX = 500;

/**
 * The person's AI app connections as exported: the app's label, where it
 * sends them back (the grant's host and the addresses the app registered),
 * the workspace, what it may do, when it was connected, last used and
 * ended, and why, and its daily requests and changes. NEVER A HASH: no
 * token, code or secret row is read, and of the grant neither its token
 * family nor the account version it was given at.
 */
async function exportedConnectedApps(userId: string) {
  const [newest, total] = await Promise.all([
    prisma.oAuthGrant.findMany({
      where: { userId },
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      take: CONNECTED_APPS_EXPORT_MAX,
      select: {
        id: true, clientId: true, organizationId: true, appName: true, redirectHost: true, scopes: true,
        createdAt: true, authorizedAt: true, endsBy: true, lastUsedAt: true, revokedAt: true, revokedReason: true,
      },
    }),
    prisma.oAuthGrant.count({ where: { userId } }),
  ]);
  if (newest.length === 0) return { connectedApps: [], connectedAppsLeftOut: 0 };
  const [clients, days] = await Promise.all([
    prisma.oAuthClient.findMany({ where: { id: { in: [...new Set(newest.map((g) => g.clientId))] } }, select: { id: true, redirectUris: true } }),
    prisma.mcpUsageDay.findMany({
      where: { userId, grantId: { in: newest.map((g) => g.id) } },
      orderBy: [{ day: "asc" }],
      select: { grantId: true, day: true, calls: true, writes: true, refused: true },
    }),
  ]);
  const uris = new Map(clients.map((c) => [c.id, c.redirectUris]));
  return {
    // Oldest first, as every other list here.
    connectedApps: [...newest].reverse().map((g) => ({
      app: g.appName,
      organizationId: g.organizationId,
      access: g.scopes.includes("mcp:write") ? "read and change" : "read",
      sendsYouBackTo: { host: g.redirectHost, addresses: uris.get(g.clientId) ?? [] },
      firstConnectedAt: g.createdAt,
      connectedAt: g.authorizedAt,
      endsBy: g.endsBy,
      lastUsedAt: g.lastUsedAt,
      disconnectedAt: g.revokedAt,
      disconnectedBecause: g.revokedReason,
      days: days.filter((d) => d.grantId === g.id).map((d) => ({ day: d.day, requests: d.calls, changes: d.writes, refused: d.refused })),
    })),
    connectedAppsLeftOut: Math.max(0, total - newest.length),
  };
}

/** The top-level reads run this many at a time, never all at once (review round 5 of Phase 3). */
const EXPORT_READS_AT_ONCE = 5;

/** What the export says beside the teammate chats about their tool calls (review round 5 of Phase 3). */
const TOOL_CALLS_NOTE = `Each teammate message's tool calls show the tool, whether it failed and what it was asked, cut at ${TEAMMATE_TOOL_INPUT_EXPORT_MAX.toLocaleString("en-US")} characters. What a tool returned is left out: those are your workspace's records the tool read, which can hold other people's data.`;

/** The UTF-8 length of a row as the export writes it. */
const bytesOf = (row: unknown): number => Buffer.byteLength(JSON.stringify(row) ?? "", "utf8");

/** A teammate chat message's tool calls as exported: name, whether it failed, the input cut at TEAMMATE_TOOL_INPUT_EXPORT_MAX. */
function exportedCalls(raw: unknown): Array<{ name: string | null; failed: boolean; input: unknown; inputCut?: true }> | null {
  if (!Array.isArray(raw)) return null;
  return raw.map((c) => {
    const call = c && typeof c === "object" ? (c as Record<string, unknown>) : {};
    const name = typeof call.name === "string" ? call.name : null;
    const failed = call.state === "failed" || (call.state === undefined && typeof call.errorText === "string" && call.errorText.length > 0);
    const text = call.input === undefined || call.input === null ? null : JSON.stringify(call.input);
    if (text === null || text === undefined) return { name, failed, input: null };
    if (text.length <= TEAMMATE_TOOL_INPUT_EXPORT_MAX) return { name, failed, input: call.input };
    return { name, failed, input: text.slice(0, TEAMMATE_TOOL_INPUT_EXPORT_MAX), inputCut: true as const };
  });
}

type Reads = ReadonlyArray<() => Promise<unknown>>;

/** Run the reads EXPORT_READS_AT_ONCE at a time, answers in their order. */
/**
 * The reviews whose manager half names this person, less those in a
 * workspace where they hold the Agent tier: an Agent is nobody's manager,
 * so a launch stamp from before rule 6 gives them nothing, a download of
 * the subject's self review and calibration included (docs-found fixes
 * batch 4). The rows are exported as stored.
 */
async function reviewsStampedTo(userId: string) {
  const rows = await prisma.review.findMany({ where: { reviewerId: userId }, include: { cycle: { select: { organizationId: true } } } });
  const orgs = [...new Set(rows.map((r) => r.cycle.organizationId))];
  const agentIn = new Set<string>();
  for (const org of orgs) if ((await agentIdsIn(org, [userId])).has(userId)) agentIn.add(org);
  return rows.filter((r) => !agentIn.has(r.cycle.organizationId)).map(({ cycle: _cycle, ...row }) => { void _cycle; return row; });
}

async function inGroups<T extends Reads>(reads: T): Promise<{ -readonly [K in keyof T]: T[K] extends () => Promise<infer R> ? R : never }> {
  const out: unknown[] = [];
  for (let i = 0; i < reads.length; i += EXPORT_READS_AT_ONCE) {
    out.push(...(await Promise.all(reads.slice(i, i + EXPORT_READS_AT_ONCE).map((read) => read()))));
  }
  return out as { -readonly [K in keyof T]: T[K] extends () => Promise<infer R> ? R : never };
}

/**
 * GDPR Article 15 / CCPA Right to Know — exports a copy of the requester's
 * personal data as JSON. Rate-limited by sessionless auth and scoped strictly
 * to the requesting user.
 *
 * AI TEAMMATES' RECORDS ARE IN IT (review round 3 of Phase 3): the person's
 * Google connections for their teammates (the account's address, products,
 * status and dates; never a token, sealed or not), what they allowed each
 * teammate (AgentPersonSetting), every request a teammate asked them to
 * approve with what it would send or change (AgentAction), and their chats
 * with their teammates, each at most TEAMMATE_CHAT_EXPORT_MAX messages.
 * Since review round 4, at most TEAMMATE_CHATS_EXPORT_BUDGET chat messages
 * and TEAMMATE_REQUESTS_EXPORT_MAX requests in all, newest kept, each list
 * saying how many it left out.
 *
 * BOUNDED IN BYTES TOO (review round 5 of Phase 3). A teammate message's
 * call record holds whole tool results, so the rows alone could reach
 * gigabytes, and activity rows and notifications had no cap at all. A tool
 * call now carries its name, whether it failed and its input cut at
 * TEAMMATE_TOOL_INPUT_EXPORT_MAX, never its result (the workspace's records
 * the tool read, which can hold other people's data; TOOL_CALLS_NOTE says
 * so in the export); messages and requests share TEAMMATE_EXPORT_BYTE_BUDGET,
 * read a page at a time; activity rows and notifications keep the newest
 * ACTIVITY_EXPORT_MAX and NOTIFICATIONS_EXPORT_MAX; and the reads run
 * EXPORT_READS_AT_ONCE at a time.
 *
 * AI TEAMMATES' BROWSER STEPS (Phase 4): what a teammate did in a browser for
 * the person, as kinds and sites only (never a page's text or an address
 * path, which are never kept), the newest BROWSER_STEPS_EXPORT_MAX within
 * what is left of the byte budget after the chats, with how many were left
 * out. Pictures of pages are not in it: they are kept 24 hours, for the
 * person to see in their chat.
 *
 * THEIR SKILLS (AI teammates Phase 5, Decision 14): every skill of theirs in
 * every workspace, oldest first, each with its steps as stored (kinds,
 * hosts, page words, roles, names, titles, the fixed values and the labels
 * of values asked each time) but never a picture's id, within what is left
 * of the byte budget after the browser steps, with how many were left out
 * and SKILLS_EXPORT_NOTE.
 *
 * THE AI APPS THEY CONNECTED (the MCP server, docs/plans/mcp-server.md 5.5,
 * step 4): connectedApps, every connection of theirs still kept, live or
 * ended, with where each app sends them back and its daily counts, and
 * never a hash (exportedConnectedApps).
 *
 * ACTIVITY ROWS ARE THE PERSON'S OWN (review round 2 of Phase 4): activityLogs
 * is read as Activity's Just me reads it (myActivityWhere,
 * src/lib/access/personal-activity.ts), in every workspace: the rows they
 * wrote, and the personal teammate rows about them that someone else wrote.
 * Explicit columns, the writer's IP address and user agent only on the
 * person's own rows. The personal teammate rows the person wrote about
 * someone else (review round 3 of Phase 4) are a second list,
 * activityAboutOthers (exportWrittenAboutOthersWhere), each trimmed to the
 * writer's part (exportedActivity), the newest
 * ACTIVITY_ABOUT_OTHERS_EXPORT_MAX, with activityAboutOthersLeftOut and
 * ACTIVITY_ABOUT_OTHERS_NOTE. Review round 4 of Phase 4: in round 3 they
 * shared activityLogs' newest ACTIVITY_EXPORT_MAX, so an Admin's Disconnect
 * everyone in a large workspace pushed every one of their own rows out of
 * the export.
 */
export async function GET() {
  const { error, session } = await getSessionOrFail();
  if (error) return error;

  const userId = getUserId(session);

  try {
    const [
      user,
      notificationsNewest,
      notificationsTotal,
      kpiRecords,
      kraAssignments,
      reviewsAsSubject,
      reviewsAsReviewer,
      feedbackGiven,
      feedbackReceived,
      meetingAttendances,
      actionItems,
      checkIns,
      kudosGiven,
      kudosReceived,
      ideasSubmitted,
      ideaVotes,
      ideaComments,
      activityLogsNewest,
      activityLogsTotal,
      aboutOthersNewest,
      aboutOthersTotal,
      consentRecords,
      teammateConnections,
      teammateSettings,
      teammateRequestsTotal,
      teammateChats,
      teammateMemories,
      teammateRoutines,
    ] = await inGroups([
      () =>
        prisma.user.findUnique({
          where: { id: userId },
          select: {
            id: true, email: true, firstName: true, lastName: true,
            avatar: true, phone: true, dateOfBirth: true, status: true,
            joinDate: true, createdAt: true, updatedAt: true,
            organizationId: true, accessLevel: true,
          },
        }),
      // The newest NOTIFICATIONS_EXPORT_MAX, and how many there are.
      () => prisma.notification.findMany({ where: { userId }, orderBy: [{ createdAt: "desc" }, { id: "desc" }], take: NOTIFICATIONS_EXPORT_MAX }),
      () => prisma.notification.count({ where: { userId } }),
      () => prisma.kPIRecord.findMany({ where: { userId } }),
      () => prisma.kRAAssignment.findMany({ where: { userId } }),
      () => prisma.review.findMany({ where: { subjectId: userId } }),
      () => reviewsStampedTo(userId),
      () => prisma.peerFeedback.findMany({ where: { giverId: userId } }),
      () => prisma.peerFeedback.findMany({ where: { receiverId: userId } }),
      () => prisma.meetingAttendee.findMany({ where: { userId } }),
      () => prisma.actionItem.findMany({ where: { assigneeId: userId } }),
      () => prisma.checkIn.findMany({ where: { userId } }),
      () => prisma.kudos.findMany({ where: { giverId: userId } }),
      () => prisma.kudos.findMany({ where: { receiverId: userId } }),
      () => prisma.idea.findMany({ where: { submitterId: userId } }),
      () => prisma.ideaVote.findMany({ where: { userId } }),
      () => prisma.ideaComment.findMany({ where: { userId } }),
      // The newest ACTIVITY_EXPORT_MAX, and how many there are: the
      // person's own rows and the personal teammate rows about them, whoever
      // wrote them, in every workspace (review round 2 of Phase 4: every row
      // the person was the actor of was read whole, so a manager's export
      // held the sites of a report whose browser they ended, and the
      // report's own missed it).
      () => prisma.activityLog.findMany({ where: myActivityWhere(userId), orderBy: [{ createdAt: "desc" }, { id: "desc" }], take: ACTIVITY_EXPORT_MAX, select: ACTIVITY_EXPORT_SELECT }),
      () => prisma.activityLog.count({ where: myActivityWhere(userId) }),
      // The newest ACTIVITY_ABOUT_OTHERS_EXPORT_MAX personal teammate rows
      // the person wrote about someone else, and how many there are, each
      // trimmed to the writer's part below (review round 3 of Phase 4: round
      // 2 left them out). Read on their own (review round 4 of Phase 4: in
      // round 3 they shared the cap above, so an Admin's Disconnect everyone
      // could fill it and push out every row of the person's own).
      () => prisma.activityLog.findMany({ where: exportWrittenAboutOthersWhere(userId), orderBy: [{ createdAt: "desc" }, { id: "desc" }], take: ACTIVITY_ABOUT_OTHERS_EXPORT_MAX, select: ACTIVITY_EXPORT_SELECT }),
      () => prisma.activityLog.count({ where: exportWrittenAboutOthersWhere(userId) }),
      () => prisma.consentRecord.findMany({ where: { userId } }),
      // Never the sealed tokens: what the person can be shown of a connection.
      () =>
        prisma.teammateConnection.findMany({
          where: { userId },
          orderBy: { connectedAt: "asc" },
          select: { organizationId: true, provider: true, products: true, accountEmail: true, status: true, connectedAt: true, lastUsedAt: true },
        }),
      () =>
        prisma.agentPersonSetting.findMany({
          where: { userId },
          select: { agentId: true, connectorProducts: true, approvalRules: true, createdAt: true, updatedAt: true, agent: { select: { name: true, organizationId: true } } },
        }),
      // How many requests there are; the newest are read a page at a time below.
      () => prisma.agentAction.count({ where: { actingForId: userId } }),
      // The most recently active first: they take the message budget first.
      () =>
        prisma.chatSession.findMany({
          where: { userId, kind: { in: TEAMMATE_CHAT_KINDS } },
          orderBy: [{ updatedAt: "desc" }, { id: "desc" }],
          select: { id: true, organizationId: true, kind: true, title: true, agentId: true, createdAt: true, updatedAt: true },
        }),
      // What the person's teammates remember about them (person scope), and
      // the routines that work as them (lead, after review round 3 of Phase 3).
      () =>
        prisma.agentMemory.findMany({
          where: { scope: "person", scopeId: userId },
          orderBy: { createdAt: "asc" },
          select: { key: true, value: true, source: true, createdAt: true, updatedAt: true, agent: { select: { name: true, organizationId: true } } },
        }),
      () =>
        prisma.agentRoutine.findMany({
          where: { actingForId: userId },
          orderBy: { createdAt: "asc" },
          select: { name: true, prompt: true, schedule: true, status: true, createdAt: true, lastRunAt: true, agent: { select: { name: true, organizationId: true } } },
        }),
    ] as const);

    // What is left of TEAMMATE_EXPORT_BYTE_BUDGET; once a row would pass
    // it, no more rows are taken (see the constant).
    let bytesLeft = TEAMMATE_EXPORT_BYTE_BUDGET;
    let bytesOut = false;
    const take = (row: unknown): boolean => {
      if (bytesOut) return false;
      const size = bytesOf(row);
      if (size > bytesLeft) {
        bytesOut = true;
        return false;
      }
      bytesLeft -= size;
      return true;
    };

    // The requests first: the newest, a page at a time, at most
    // TEAMMATE_REQUESTS_EXPORT_MAX, oldest first in the export. What each
    // would send or change, as the person approved it when they changed it
    // on the card (editedInput), else as asked.
    const requestsNewest = [];
    let requestCursor: string | null = null;
    while (requestsNewest.length < TEAMMATE_REQUESTS_EXPORT_MAX && !bytesOut) {
      const want = Math.min(TEAMMATE_EXPORT_PAGE, TEAMMATE_REQUESTS_EXPORT_MAX - requestsNewest.length);
      const page: Array<{
        id: string; organizationId: string; agentId: string | null; toolName: string; status: string; preview: unknown; input: unknown; editedInput: unknown;
        createdAt: Date; decidedAt: Date | null; executedAt: Date | null; expiresAt: Date;
      }> = await prisma.agentAction.findMany({
        where: { actingForId: userId },
        orderBy: [{ createdAt: "desc" }, { id: "desc" }],
        take: want,
        ...(requestCursor ? { cursor: { id: requestCursor }, skip: 1 } : {}),
        select: {
          id: true, organizationId: true, agentId: true, toolName: true, status: true, preview: true, input: true, editedInput: true,
          createdAt: true, decidedAt: true, executedAt: true, expiresAt: true,
        },
      });
      for (const r of page) {
        const row = {
          id: r.id,
          organizationId: r.organizationId,
          agentId: r.agentId,
          tool: r.toolName,
          status: r.status,
          title: typeof (r.preview as { title?: unknown } | null)?.title === "string" ? (r.preview as { title: string }).title : null,
          input: r.editedInput ?? r.input,
          createdAt: r.createdAt,
          decidedAt: r.decidedAt,
          executedAt: r.executedAt,
          expiresAt: r.expiresAt,
        };
        if (!take(row)) break;
        requestsNewest.push(row);
      }
      if (page.length < want) break;
      requestCursor = page[page.length - 1].id;
    }
    const teammateRequests = requestsNewest.reverse();

    // Then each chat's newest messages, oldest first, and how many were left
    // out: one chat at a time, a page at a time, within what is left of the
    // row budget (TEAMMATE_CHATS_EXPORT_BUDGET) and the byte budget. A chat
    // past either is still listed, every message counted as left out.
    const chats = [];
    let rowsLeft = TEAMMATE_CHATS_EXPORT_BUDGET;
    for (const c of teammateChats) {
      const total = await prisma.chatMessage.count({ where: { sessionId: c.id } });
      const wanted = bytesOut ? 0 : Math.min(TEAMMATE_CHAT_EXPORT_MAX, rowsLeft, total);
      const newest = [];
      let cursor: string | null = null;
      while (newest.length < wanted && !bytesOut) {
        const want = Math.min(TEAMMATE_EXPORT_PAGE, wanted - newest.length);
        const page: Array<{ id: string; role: string; kind: string | null; content: string; toolCalls: unknown; createdAt: Date }> = await prisma.chatMessage.findMany({
          where: { sessionId: c.id },
          orderBy: [{ createdAt: "desc" }, { id: "desc" }],
          take: want,
          ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
          select: { id: true, role: true, kind: true, content: true, toolCalls: true, createdAt: true },
        });
        for (const m of page) {
          const row = { id: m.id, role: m.role, kind: m.kind, content: m.content, toolCalls: exportedCalls(m.toolCalls), createdAt: m.createdAt };
          if (!take(row)) break;
          newest.push(row);
        }
        if (page.length < want) break;
        cursor = page[page.length - 1].id;
      }
      rowsLeft -= newest.length;
      const { updatedAt, ...chat } = c;
      chats.push({ ...chat, lastActiveAt: updatedAt, messages: newest.reverse(), messagesLeftOut: Math.max(0, total - newest.length) });
    }

    // Then the browser steps (Phase 4): newest first, through the person's
    // sessions of the last BROWSER_STEPS_DAYS days, kinds and sites only.
    const since = new Date(Date.now() - BROWSER_STEPS_DAYS * 24 * 60 * 60 * 1000);
    const browserSessions: Array<{ id: string; organizationId: string }> = await prisma.teammateBrowserSession.findMany({
      where: { userId, startedAt: { gte: since } },
      orderBy: [{ startedAt: "desc" }, { id: "desc" }],
      select: { id: true, organizationId: true },
    });
    const orgOfSession = new Map(browserSessions.map((b) => [b.id, b.organizationId]));
    const browserStepsTotal = browserSessions.length > 0 ? await prisma.teammateBrowserStep.count({ where: { browserSessionId: { in: browserSessions.map((b) => b.id) } } }) : 0;
    const browserStepsNewest = [];
    for (let i = 0; i < browserSessions.length && browserStepsNewest.length < BROWSER_STEPS_EXPORT_MAX && !bytesOut; i += BROWSER_SESSIONS_PER_READ) {
      const ids = browserSessions.slice(i, i + BROWSER_SESSIONS_PER_READ).map((b) => b.id);
      const page: Array<{ browserSessionId: string; kind: string; site: string | null; outcome: string; at: Date }> = await prisma.teammateBrowserStep.findMany({
        where: { browserSessionId: { in: ids } },
        orderBy: [{ at: "desc" }, { id: "desc" }],
        take: BROWSER_STEPS_EXPORT_MAX - browserStepsNewest.length,
        select: { browserSessionId: true, kind: true, site: true, outcome: true, at: true },
      });
      for (const st of page) {
        const row = { at: st.at, organizationId: orgOfSession.get(st.browserSessionId) ?? null, kind: st.kind, site: st.site, outcome: st.outcome };
        if (!take(row)) break;
        browserStepsNewest.push(row);
      }
    }

    // Then the person's skills (Phase 5): oldest first, every workspace, a
    // page at a time, each its steps as stored without a picture's id (a
    // picture is kept 24 hours only, for the person in their chat), within
    // what is left of the byte budget.
    const skillsTotal = await prisma.teammateSkill.count({ where: { userId } });
    const skillsKept: Array<Record<string, unknown>> = [];
    const teammateNames = new Map<string, string | null>();
    let skillCursor: string | null = null;
    while (skillsKept.length < skillsTotal && !bytesOut) {
      const page: Array<{
        id: string; organizationId: string; agentId: string; name: string; description: string; status: string; steps: unknown; startUrl: string | null;
        orphanedAt: Date | null; lastRunAt: Date | null; runCount: number; createdAt: Date; updatedAt: Date;
      }> = await prisma.teammateSkill.findMany({
        where: { userId },
        orderBy: [{ createdAt: "asc" }, { id: "asc" }],
        take: SKILLS_PER_READ,
        ...(skillCursor ? { cursor: { id: skillCursor }, skip: 1 } : {}),
        select: { id: true, organizationId: true, agentId: true, name: true, description: true, status: true, steps: true, startUrl: true, orphanedAt: true, lastRunAt: true, runCount: true, createdAt: true, updatedAt: true },
      });
      const unknown = [...new Set(page.map((k) => k.agentId).filter((a) => !teammateNames.has(a)))];
      if (unknown.length > 0) {
        const agents = await prisma.agent.findMany({ where: { id: { in: unknown } }, select: { id: true, name: true } });
        for (const a of unknown) teammateNames.set(a, agents.find((x) => x.id === a)?.name ?? null);
      }
      for (const k of page) {
        const row = {
          teammate: teammateNames.get(k.agentId) ?? null,
          organizationId: k.organizationId,
          name: k.name,
          description: k.description,
          status: k.status,
          steps: storedSteps(k.steps).map(({ shotId: _shotId, ...step }) => { void _shotId; return step; }),
          startUrl: k.startUrl,
          createdAt: k.createdAt,
          updatedAt: k.updatedAt,
          lastRunAt: k.lastRunAt,
          runCount: k.runCount,
          deletesOn: deletesOnOf(k.orphanedAt),
        };
        if (!take(row)) break;
        skillsKept.push(row);
      }
      if (page.length < SKILLS_PER_READ) break;
      skillCursor = page[page.length - 1].id;
    }

    // The AI apps the person connected through the MCP server (step 4 of docs/plans/mcp-server.md).
    const { connectedApps, connectedAppsLeftOut } = await exportedConnectedApps(userId);

    const payload = {
      exportedAt: new Date().toISOString(),
      legalBasis: "GDPR Art. 15 / CCPA Right to Know",
      subject: user,
      records: {
        // The newest NOTIFICATIONS_EXPORT_MAX, oldest first.
        notifications: [...notificationsNewest].reverse(),
        notificationsLeftOut: Math.max(0, notificationsTotal - notificationsNewest.length),
        kpiRecords,
        kraAssignments,
        // The subject's own rows keep the product's rules (review-visibility):
        // no manager draft, calibration or 9-box potential.
        reviewsAsSubject: reviewsAsSubject.map((r) => subjectRowView(r, userId)),
        reviewsAsReviewer,
        feedbackGiven,
        // DECIDED: the subject reads the aggregate of peer feedback, never
        // the written answers, a single peer's rating or who wrote them.
        feedbackReceived: feedbackReceived.map((f) => ({ ...f, giverId: null, rating: null, collaborationRating: null, strengths: null, improvements: null, comments: null })),
        meetingAttendances,
        actionItems,
        checkIns,
        kudosGiven,
        kudosReceived,
        ideasSubmitted,
        ideaVotes,
        ideaComments,
        // The newest ACTIVITY_EXPORT_MAX, oldest first (review round 2 of Phase 4: see ACTIVITY_EXPORT_SELECT and exportedActivity).
        activityLogs: [...activityLogsNewest].reverse().map((r) => exportedActivity(r, userId)),
        activityLogsLeftOut: Math.max(0, activityLogsTotal - activityLogsNewest.length),
        // The newest ACTIVITY_ABOUT_OTHERS_EXPORT_MAX, oldest first, each the writer's part (review rounds 3 and 4 of Phase 4).
        activityAboutOthers: [...aboutOthersNewest].reverse().map((r) => exportedActivity(r, userId)),
        activityAboutOthersLeftOut: Math.max(0, aboutOthersTotal - aboutOthersNewest.length),
        activityAboutOthersNote: ACTIVITY_ABOUT_OTHERS_NOTE,
        consentRecords,
        teammateConnections,
        teammateAllows: teammateSettings.map((t) => ({
          agentId: t.agentId,
          teammate: t.agent?.name ?? null,
          organizationId: t.agent?.organizationId ?? null,
          googleProductsAllowed: t.connectorProducts,
          approvalRules: t.approvalRules,
          createdAt: t.createdAt,
          updatedAt: t.updatedAt,
        })),
        // Oldest first, the newest TEAMMATE_REQUESTS_EXPORT_MAX within the byte budget.
        teammateRequests,
        teammateRequestsLeftOut: Math.max(0, teammateRequestsTotal - teammateRequests.length),
        // The most recently active first (they took the budget first).
        teammateChats: chats,
        teammateChatsNote: TOOL_CALLS_NOTE,
        // Oldest first, the newest BROWSER_STEPS_EXPORT_MAX within the byte budget (Phase 4).
        teammateBrowserSteps: browserStepsNewest.reverse(),
        teammateBrowserStepsLeftOut: Math.max(0, browserStepsTotal - browserStepsNewest.length),
        teammateBrowserStepsNote: BROWSER_STEPS_NOTE,
        // Oldest first, within the byte budget (Phase 5).
        teammateSkills: skillsKept,
        teammateSkillsLeftOut: Math.max(0, skillsTotal - skillsKept.length),
        teammateSkillsNote: SKILLS_EXPORT_NOTE,
        // Oldest first, the newest CONNECTED_APPS_EXPORT_MAX (the MCP server, docs/plans/mcp-server.md 5.5).
        connectedApps,
        connectedAppsLeftOut,
        connectedAppsNote: MCP_EXPORT_COPY.connectedAppsNote,
        teammateMemories: teammateMemories.map((m) => ({
          teammate: m.agent?.name ?? null,
          organizationId: m.agent?.organizationId ?? null,
          key: m.key,
          value: m.value,
          savedFrom: m.source,
          createdAt: m.createdAt,
          updatedAt: m.updatedAt,
        })),
        teammateRoutines: teammateRoutines.map((r) => ({
          teammate: r.agent?.name ?? null,
          organizationId: r.agent?.organizationId ?? null,
          name: r.name,
          prompt: r.prompt,
          schedule: r.schedule,
          status: r.status,
          createdAt: r.createdAt,
          lastRunAt: r.lastRunAt,
        })),
      },
    };

    return new NextResponse(JSON.stringify(payload, null, 2), {
      status: 200,
      headers: {
        "Content-Type": "application/json",
        "Content-Disposition": `attachment; filename="workwrk-data-export-${userId}.json"`,
        "Cache-Control": "no-store",
      },
    });
  } catch (err) {
    console.error("[export] failed:", err);
    return jsonError("Failed to build export", 500);
  }
}
