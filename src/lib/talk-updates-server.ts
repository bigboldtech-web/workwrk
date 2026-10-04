// Scheduled AI updates in Talk: the runner, the cron's loop, and what the
// routes share (Batch 8). The rules are src/lib/talk-updates.ts.
//
// ONE RUN, in order. Every refusal is written on the run row; the ones that
// cannot fix themselves (PAUSING_REASONS) also pause the update, so it stops
// instead of failing the same way every morning:
//
//   1. the workspace still has the opt-in on (and AI on)
//   2. the person who set it up is a live member, not a Guest and not an
//      Agent account, still has AI, and may still post there (the same
//      talkRole and canPost their own composer answers to)
//   3. the conversation is a private channel or a group chat, nobody in it
//      is a Guest, and it holds at most MAX_UPDATE_READERS people
//   4. the List or Space is still theirs to open
//   5. the facts: only the tasks that EVERY reader can open (readableItemsVia
//      for each reader, intersected), recomputed now
//   6. one use of the workspace's daily cap (a provider failure gives it back)
//   7. the model, outside any transaction
//   8. one message, through the composer's own write (src/lib/talk-post.ts),
//      with a clientId taken from the run, so a retried run never posts twice
//
// Server-only.

import { prisma } from "@/lib/prisma";
import { can } from "@/lib/access";
import { viewerForUser } from "@/lib/access/viewer";
import { logActivity } from "@/lib/activity";
import { aiTalkUpdatesOn } from "@/lib/ai/ai-features";
import { claimAiUse, releaseAiUse } from "@/lib/ai-usage";
import { createMessageWithFallback, getAnthropicForOrg, isAiConfigured, modelFor } from "@/lib/ai-client";
import { getBoardStatuses, isDoneStatus, makeStatusLookup } from "@/lib/board-items-shared";
import {
  boardForViewer,
  listReader,
  memberViewer,
  readableItemsVia,
  recipientRows,
  spaceForViewer,
  type LinkViewer,
} from "@/lib/list-links-server";
import { loadConversationRole, talkGateForUser, type TalkGate } from "@/lib/talk-gate";
import { canPost } from "@/lib/talk-access";
import { afterMessageSent, insertConversationMessage } from "@/lib/talk-post";
import {
  MANUAL_COOLDOWN_MS,
  MAX_FACT_TASKS,
  MAX_UPDATE_READERS,
  PAUSING_REASONS,
  STALE_AFTER_MS,
  buildUpdateRequest,
  cleanUpdateAnswer,
  updateTitle,
  conversationProblem,
  dueState,
  nextTalkUpdateAt,
  reportWindowStart,
  talkUpdatesPerDay,
  updatePostBody,
  type RunReason,
  type TalkUpdateKind,
  type TalkUpdateSchedule,
  type UpdateTaskFact,
} from "@/lib/talk-updates";

/** A run still "running" after this long died with its process. */
const STUCK_RUN_MS = 10 * 60 * 1000;

/** The model a post asks, unless the workspace's own key names another. */
export const UPDATE_MODEL = "claude-haiku-4-5";
const UPDATE_TIMEOUT_MS = 60_000;

/** The app cannot read the crontab, so the founder sets this with the cron row (scripts/CRON-SETUP.md). */
export function talkUpdatesCronInstalled(): boolean {
  return process.env.TALK_UPDATES_CRON === "on";
}

/** A database without the Batch 8 tables (the SQL file not applied yet). */
export function isMissingUpdatesTable(err: unknown): boolean {
  const code = (err as { code?: string } | null)?.code;
  if (code === "P2021" || code === "P2022") return true;
  return /relation "?TalkUpdate(Run)?"? does not exist/i.test(String((err as Error | null)?.message ?? ""));
}

export type UpdateRow = NonNullable<Awaited<ReturnType<typeof prisma.talkUpdate.findUnique>>>;

export { conversationProblem };

export function scheduleOf(u: Pick<UpdateRow, "cadence" | "weekday" | "timeOfDay" | "timezone">): TalkUpdateSchedule {
  return { cadence: u.cadence as TalkUpdateSchedule["cadence"], weekday: u.weekday, timeOfDay: u.timeOfDay, timezone: u.timezone };
}

type Step<T> = ({ ok: true } & T) | { ok: false; reason: RunReason };

// ── 2. The person who set it up ────────────────────────────────────

export async function creatorState(
  organizationId: string,
  creatorId: string,
): Promise<Step<{ gate: TalkGate; creator: LinkViewer }>> {
  const gate = await talkGateForUser(creatorId, organizationId);
  if (!gate.ok) return { ok: false, reason: gate.reason === "talk_off" ? "talk_off" : "creator_gone" };
  const viewer = await viewerForUser(organizationId, creatorId);
  if (!viewer) return { ok: false, reason: "creator_gone" };
  if (viewer.orgRole === "GUEST") return { ok: false, reason: "creator_guest" };
  if (viewer.isAgent) return { ok: false, reason: "creator_agent" };
  const ai = await can(viewer, "view", { type: "app", key: "ai" });
  if (!ai.allowed) return { ok: false, reason: "ai_off" };
  const creator = await memberViewer(creatorId, organizationId);
  if (!creator) return { ok: false, reason: "creator_gone" };
  return { ok: true, gate: gate.gate, creator };
}

// ── 3. Where it posts, and who reads it ────────────────────────────

/**
 * Everyone who reads the conversation, as viewers: every member who can sign
 * in (a removed or deactivated member reads nothing, so they are not asked),
 * and a refusal when any member is a Guest or there are too many people.
 */
export async function conversationReaders(
  conversationId: string,
  organizationId: string,
): Promise<Step<{ readers: LinkViewer[]; count: number }>> {
  const members = await prisma.conversationMember.findMany({
    where: { conversationId },
    select: { userId: true },
    take: MAX_UPDATE_READERS + 1,
  });
  if (members.length > MAX_UPDATE_READERS) return { ok: false, reason: "too_many_people" };
  const rows = await recipientRows(members.map((m) => m.userId), organizationId);
  if (rows.some((r) => r.guest && !r.deletedAt && r.status !== "INACTIVE")) return { ok: false, reason: "guests" };
  const readers: LinkViewer[] = [];
  for (const r of rows) {
    if (r.deletedAt || r.status === "INACTIVE") continue;
    const v = await memberViewer(r.id, organizationId);
    if (v) readers.push(v);
  }
  return { ok: true, readers, count: members.length };
}

async function whereItPosts(
  u: UpdateRow,
  gate: TalkGate,
): Promise<Step<{ conversation: { id: string; type: "DM" | "GROUP" | "CHANNEL"; name: string | null }; readers: LinkViewer[] }>> {
  const ctx = await loadConversationRole(u.conversationId, gate);
  if (!ctx || ctx.role === "none" || !ctx.membershipId) return { ok: false, reason: "cannot_post" };
  const problem = conversationProblem(ctx.conversation);
  if (problem) return { ok: false, reason: problem };
  if (!canPost(ctx.conversation, ctx.role)) return { ok: false, reason: "cannot_post" };
  const readers = await conversationReaders(u.conversationId, u.organizationId);
  if (!readers.ok) return readers;
  return {
    ok: true,
    conversation: { id: ctx.conversation.id, type: ctx.conversation.type, name: ctx.conversation.name },
    readers: readers.readers,
  };
}

// ── 4. What it reports on ──────────────────────────────────────────

interface ScopeList {
  id: string;
  name: string;
  statuses: unknown;
}

export async function scopeFor(
  scopeKind: string,
  scopeId: string,
  viewer: LinkViewer,
): Promise<Step<{ name: string; lists: ScopeList[] }>> {
  if (scopeKind === "list") {
    const b = await boardForViewer(viewer, scopeId);
    if (!b) return { ok: false, reason: "scope_gone" };
    const row = await prisma.board.findUnique({ where: { id: b.id }, select: { id: true, name: true, statuses: true, archivedAt: true } });
    return row && !row.archivedAt ? { ok: true, name: row.name, lists: [{ id: row.id, name: row.name, statuses: row.statuses }] } : { ok: false, reason: "scope_gone" };
  }
  const s = await spaceForViewer(viewer, scopeId);
  if (!s) return { ok: false, reason: "scope_gone" };
  const all = await prisma.board.findMany({
    where: { spaceId: scopeId, organizationId: viewer.organizationId, archivedAt: null },
    select: { id: true, name: true, statuses: true },
    take: 200,
  });
  const reader = listReader(viewer);
  const lists: ScopeList[] = [];
  for (const b of all) if (await reader.canRead(b.id)) lists.push(b);
  return { ok: true, name: s.name, lists };
}

// ── 5. The facts every reader can open ─────────────────────────────

/** Can every reader open this List? (Its name may then be said.) */
async function everyoneReadsList(readers: readonly LinkViewer[], listId: string): Promise<boolean> {
  for (const r of readers) if (!(await listReader(r).canRead(listId))) return false;
  return true;
}

/** Can every reader open the scope itself? (Its name may then be said.) */
export async function everyoneReadsScope(scopeKind: string, scopeId: string, readers: readonly LinkViewer[]): Promise<boolean> {
  if (scopeKind === "list") return everyoneReadsList(readers, scopeId);
  for (const r of readers) if (!(await spaceForViewer(r, scopeId))) return false;
  return true;
}

export interface SharedFacts {
  tasks: UpdateTaskFact[];
  /** Tasks a post would report (finished, moved, overdue or due soon), before the reach check. */
  candidates: number;
}

export async function sharedFacts(args: {
  organizationId: string;
  lists: ScopeList[];
  readers: LinkViewer[];
  windowStart: Date;
  now: Date;
  /** The update's zone: what "today" means for a due date. */
  timezone: string;
}): Promise<SharedFacts> {
  const { lists, readers, windowStart, now } = args;
  if (lists.length === 0 || readers.length === 0) return { tasks: [], candidates: 0 };
  const listIds = lists.map((l) => l.id);
  const soon = new Date(now.getTime() + 3 * 24 * 60 * 60 * 1000);
  const select = {
    id: true, title: true, status: true, boardId: true, organizationId: true, ownerId: true,
    assigneeIds: true, parentItemId: true, dueAt: true, updatedAt: true,
  } as const;
  const base = { organizationId: args.organizationId, archivedAt: null, parentItemId: null };
  const statusesOf = new Map(lists.map((l) => [l.id, getBoardStatuses(l)] as const));
  // Open work only, List by List (each List names its own done statuses; a
  // task with no status is open), so finished history never crowds it out.
  // isDoneStatus also counts a value the List does not declare as done by
  // its name ("done", "closed", ...), so those leave the open reads too.
  // A List that declares such a status itself (even as an active stage)
  // decides for itself, exactly as isDoneStatus does.
  const doneByName = ["done", "complete", "completed", "closed", "resolved"].flatMap((n) => [n, n.toUpperCase(), n[0].toUpperCase() + n.slice(1)]);
  const openInScope = lists.map((l) => {
    const declared = statusesOf.get(l.id) ?? [];
    const own = new Set(declared.map((x) => x.value));
    return {
      boardId: l.id,
      OR: [
        { status: null },
        { status: { notIn: [...declared.filter((x) => x.group !== "ACTIVE").map((x) => x.value), ...doneByName.filter((n) => !own.has(n))] } },
      ],
    };
  });
  // Three reads, so none crowds another out: what changed in the window
  // (newest first), open work already overdue (most recently due first), and
  // open work due from now to the horizon (soonest first).
  const [moved, overdueRows, upcoming] = await Promise.all([
    prisma.item.findMany({ where: { ...base, boardId: { in: listIds }, updatedAt: { gte: windowStart } }, orderBy: [{ updatedAt: "desc" }, { id: "desc" }], take: 300, select }),
    prisma.item.findMany({ where: { ...base, OR: openInScope, dueAt: { lt: now } }, orderBy: [{ dueAt: "desc" }, { id: "desc" }], take: 200, select }),
    prisma.item.findMany({ where: { ...base, OR: openInScope, dueAt: { gte: now, lte: soon } }, orderBy: [{ dueAt: "asc" }, { id: "asc" }], take: 200, select }),
  ]);
  const byId = new Map<string, (typeof moved)[number]>();
  for (const c of [...moved, ...overdueRows, ...upcoming]) byId.set(c.id, c);
  const all = [...byId.values()];
  if (all.length === 0) return { tasks: [], candidates: 0 };

  // Finished IN the window means moved to a done status in it (its own
  // activity row), not merely edited while done.
  const finished = new Set<string>();
  const changes = await prisma.itemActivity.findMany({
    where: {
      organizationId: args.organizationId,
      entityType: "BOARD_ITEM",
      entityId: { in: all.map((c) => c.id) },
      action: "STATUS_CHANGED",
      createdAt: { gte: windowStart },
    },
    select: { entityId: true, meta: true },
  }).catch(() => [] as Array<{ entityId: string; meta: unknown }>);
  const listOf = new Map(all.map((c) => [c.id, c.boardId] as const));
  for (const ch of changes) {
    const to = (ch.meta as { to?: unknown } | null)?.to;
    const st = statusesOf.get(listOf.get(ch.entityId) ?? "") ?? [];
    if (typeof to === "string" && isDoneStatus(st, to)) finished.add(ch.entityId);
  }

  // What a post would report, BEFORE the reach check, so "nothing to
  // report" can say whether nothing happened or nothing is open to everyone.
  type Row = (typeof all)[number];
  const judged = new Map<string, { done: boolean; finishedHere: boolean; movedHere: boolean; overdue: boolean; due: ReturnType<typeof dueState> }>();
  const reportable: Row[] = [];
  for (const c of all) {
    const st = statusesOf.get(c.boardId) ?? [];
    const done = isDoneStatus(st, c.status);
    const due = dueState(c.dueAt, now, args.timezone);
    const overdue = !done && due.overdue;
    const dueSoon = !done && due.soon;
    const finishedHere = done && finished.has(c.id);
    const movedHere = done ? finishedHere : c.updatedAt.getTime() >= windowStart.getTime();
    if (!movedHere && !overdue && !dueSoon) continue;
    judged.set(c.id, { done, finishedHere, movedHere, overdue, due });
    reportable.push(c);
  }
  if (reportable.length === 0) return { tasks: [], candidates: 0 };

  // EVERY reader, the person who set it up included: one task any of them
  // cannot open is one task the post must not name.
  let shared = new Set(reportable.map((c) => c.id));
  for (const r of readers) {
    const seen = await readableItemsVia(r, reportable);
    shared = new Set([...shared].filter((id) => seen.get(id)?.readable === true));
    if (shared.size === 0) return { tasks: [], candidates: reportable.length };
  }
  const kept = reportable.filter((c) => shared.has(c.id));

  // A List's name only where every reader may know it.
  const sayable = new Set<string>();
  if (lists.length > 1) {
    for (const l of lists) if (kept.some((c) => c.boardId === l.id) && (await everyoneReadsList(readers, l.id))) sayable.add(l.id);
  }
  const listName = new Map(lists.map((l) => [l.id, l.name] as const));
  const people = Array.from(new Set(kept.flatMap((c) => [c.ownerId, ...c.assigneeIds]).filter((x): x is string => !!x)));
  const names = new Map(
    (people.length
      ? await prisma.user.findMany({ where: { id: { in: people }, organizationId: args.organizationId }, select: { id: true, firstName: true } })
      : []
    ).map((u) => [u.id, (u.firstName ?? "").trim()] as const),
  );

  const facts: Array<UpdateTaskFact & { rank: number }> = [];
  for (const c of kept) {
    const j = judged.get(c.id)!;
    const st = statusesOf.get(c.boardId) ?? [];
    const ids = Array.from(new Set([c.ownerId, ...c.assigneeIds].filter((x): x is string => !!x)));
    facts.push({
      title: c.title,
      status: (c.status && makeStatusLookup(st)[c.status]?.label) || c.status || "No status",
      group: j.done ? "done" : "open",
      assignees: ids.map((id) => names.get(id) ?? "").filter(Boolean).slice(0, 3),
      due: j.due.day,
      overdue: j.overdue,
      moved: j.movedHere,
      list: sayable.has(c.boardId) ? listName.get(c.boardId) ?? null : null,
      rank: j.overdue ? 0 : j.finishedHere ? 1 : j.movedHere ? 2 : 3,
    });
  }
  facts.sort((a, b) => a.rank - b.rank);
  return {
    tasks: facts.slice(0, MAX_FACT_TASKS).map((f) => ({
      title: f.title, status: f.status, group: f.group, assignees: f.assignees,
      due: f.due, overdue: f.overdue, moved: f.moved, list: f.list,
    })),
    candidates: reportable.length,
  };
}

// ── One run ────────────────────────────────────────────────────────

export type RunOutcome =
  | { status: "posted"; messageId: string; taskCount: number; runId: string }
  | { status: "skipped" | "failed"; reason: RunReason; runId: string | null };

async function finish(
  u: UpdateRow,
  runId: string | null,
  outcome: { status: "posted" | "skipped" | "failed"; reason?: RunReason; messageId?: string; taskCount?: number },
  now: Date,
): Promise<void> {
  if (runId) {
    await prisma.talkUpdateRun
      .update({
        where: { id: runId },
        data: {
          status: outcome.status,
          reason: outcome.reason ?? null,
          messageId: outcome.messageId ?? null,
          taskCount: outcome.taskCount ?? null,
          finishedAt: new Date(),
        },
      })
      .catch(() => {});
  }
  if (outcome.status === "posted") {
    await prisma.talkUpdate.update({ where: { id: u.id }, data: { lastPostedAt: now } }).catch(() => {});
  } else if (outcome.reason && PAUSING_REASONS.has(outcome.reason)) {
    await prisma.talkUpdate
      .updateMany({ where: { id: u.id, status: "active" }, data: { status: "paused", pausedReason: outcome.reason } })
      .catch(() => {});
  }
}

/**
 * Run one update now. A scheduled run is called after its instant is
 * claimed (processDueTalkUpdates); Post now passes the minute it was pressed,
 * and the run row's (update, instant) key refuses a second press in the
 * same minute. Every exit, a throw included, finishes its run row.
 */
export async function runTalkUpdate(args: {
  update: UpdateRow;
  trigger: "schedule" | "manual";
  dueAt: Date;
  now: Date;
}): Promise<RunOutcome> {
  const { update: u } = args;
  let runId: string | null = null;
  try {
    const run = await prisma.talkUpdateRun.create({
      data: { updateId: u.id, organizationId: u.organizationId, dueAt: args.dueAt, trigger: args.trigger, status: "running" },
      select: { id: true },
    });
    runId = run.id;
  } catch (err) {
    if ((err as { code?: string })?.code === "P2002") return { status: "skipped", reason: "cooldown", runId: null };
    throw err;
  }
  try {
    return await runSteps(u, runId, args);
  } catch (err) {
    console.error(`[talk-update] ${u.id} run ${runId}: ${err instanceof Error ? err.message.split("\n")[0] : String(err)}`);
    await finish(u, runId, { status: "failed", reason: "error" }, args.now);
    return { status: "failed", reason: "error", runId };
  }
}

async function runSteps(
  u: UpdateRow,
  runId: string,
  args: { trigger: "schedule" | "manual"; now: Date },
): Promise<RunOutcome> {
  const { now } = args;
  const stop = async (status: "skipped" | "failed", reason: RunReason): Promise<RunOutcome> => {
    await finish(u, runId, { status, reason }, now);
    return { status, reason, runId };
  };

  // 1. The workspace's opt-in.
  const org = await prisma.organization.findUnique({ where: { id: u.organizationId }, select: { settings: true, plan: true } });
  if (!org || !aiTalkUpdatesOn(org.settings)) return stop("skipped", "off");

  // 2. The person, 3. the conversation, 4. the scope.
  const who = await creatorState(u.organizationId, u.createdById);
  if (!who.ok) return stop("skipped", who.reason);
  const where = await whereItPosts(u, who.gate);
  if (!where.ok) return stop("skipped", where.reason);
  const scope = await scopeFor(u.scopeKind, u.scopeId, who.creator);
  if (!scope.ok) return stop("skipped", scope.reason);

  // 5. The facts, against every reader.
  const kind = u.kind as TalkUpdateKind;
  const windowStart = reportWindowStart(u.cadence as TalkUpdateSchedule["cadence"], now, u.lastPostedAt);
  const readers = [who.creator, ...where.readers.filter((r) => r.userId !== who.creator.userId)];
  const facts = await sharedFacts({ organizationId: u.organizationId, lists: scope.lists, readers, windowStart, now, timezone: u.timezone });
  if (facts.tasks.length === 0) return stop("skipped", facts.candidates === 0 ? "nothing_new" : "nothing_shared");
  const scopeName = (await everyoneReadsScope(u.scopeKind, u.scopeId, readers)) ? scope.name : null;

  // 6. Cost.
  if (!(await isAiConfigured(u.organizationId))) return stop("skipped", "not_configured");
  const claim = await claimAiUse(u.organizationId, "talk_update", talkUpdatesPerDay(org.plan));
  if (claim === "limit") return stop("skipped", "daily_limit");
  if (claim === "not_ready") return stop("skipped", "not_ready");

  // 7. The model.
  const cadence = u.cadence as TalkUpdateSchedule["cadence"];
  const request = buildUpdateRequest({
    kind,
    cadence,
    scopeName: scopeName ?? (u.scopeKind === "list" ? "a List" : "a Space"),
    windowStart: windowStart.toISOString(),
    now: now.toISOString(),
    timezone: u.timezone,
    tasks: facts.tasks,
  });
  let answer = "";
  let cutOff = false;
  try {
    const ai = await getAnthropicForOrg(u.organizationId);
    const msg = await createMessageWithFallback(
      ai.client,
      { model: modelFor(ai, UPDATE_MODEL), max_tokens: request.maxTokens, system: request.system, messages: [{ role: "user", content: request.prompt }] },
      { timeout: UPDATE_TIMEOUT_MS, maxRetries: 1 },
    );
    answer = msg.content.map((b) => (b.type === "text" ? b.text : "")).join("");
    // Only an answer the model finished is posted (not one cut off at the
    // token limit, refused, or stopped for any other reason).
    cutOff = msg.stop_reason !== "end_turn" && msg.stop_reason !== "stop_sequence";
  } catch (err) {
    await releaseAiUse(u.organizationId, "talk_update");
    console.error(`[talk-update] ${u.id}: ${err instanceof Error ? err.message.split("\n")[0] : String(err)}`);
    return stop("failed", "ai_failed");
  }
  const text = cutOff ? null : cleanUpdateAnswer(answer);
  if (!text) return stop("failed", "ai_unusable");

  // 8. One message, as the person who set it up, marked as an AI update,
  // carrying who it was checked against: only they read its words later.
  const readerIds = readers.map((r) => r.userId);
  const body = updatePostBody(kind, cadence, scopeName, text);
  const metadata = { kind: "ai_update", update: { id: u.id, kind, scope: scopeName, tasks: facts.tasks.length, readers: readerIds } };
  const posted = await insertConversationMessage({
    conversationId: u.conversationId,
    authorId: u.createdById,
    // Never the author's read cursor: they are not at the keyboard.
    membershipId: null,
    body,
    parentId: null,
    metadata,
    clientId: `tu_${runId}`,
    now,
  });
  if (!posted.ok) return stop("skipped", "cooldown");
  await afterMessageSent({
    conversationId: u.conversationId,
    conversation: { type: where.conversation.type, name: where.conversation.name },
    message: posted.message,
    authorId: u.createdById,
    text: body,
    mentions: [],
    parentId: null,
    isCallCard: false,
    now,
    // Only the people it was checked against are rung.
    onlyUserIds: readerIds,
  });
  await finish(u, runId, { status: "posted", messageId: posted.message.id, taskCount: facts.tasks.length }, now);
  await logActivity({
    type: "data.ai_update_posted",
    actorId: u.createdById,
    organizationId: u.organizationId,
    description: `Posted a scheduled AI update (${updateTitle(kind, cadence)}) from ${facts.tasks.length} ${facts.tasks.length === 1 ? "task" : "tasks"}`,
    targetId: u.conversationId,
    targetType: "conversation",
    metadata: { updateId: u.id, runId, messageId: posted.message.id, trigger: args.trigger, taskCount: facts.tasks.length },
    actorType: "agent",
    actorLabel: "Scheduled AI update",
    actingForId: u.createdById,
  });
  return { status: "posted", messageId: posted.message.id, taskCount: facts.tasks.length, runId };
}

/**
 * Post now's own rule, as ONE compare-and-swap on lastManualAt: a press
 * claims the update only when no press claimed it in the last
 * MANUAL_COOLDOWN_MS, so two presses at once (or across a minute boundary)
 * can never both post. A press that stops before the AI is asked gives the
 * claim back (releaseManualRun), so a press that found nothing to report
 * costs nobody the next ten minutes. A scheduled run still in progress also
 * refuses the press.
 */
export async function claimManualRun(updateId: string, now: Date): Promise<{ ok: true; previous: Date | null } | { ok: false; reason: "busy" | "cooldown" | "just_posted" }> {
  const running = await prisma.talkUpdateRun.findFirst({
    where: { updateId, status: "running", startedAt: { gte: new Date(now.getTime() - STUCK_RUN_MS) } },
    select: { id: true },
  });
  if (running) return { ok: false, reason: "busy" };
  // Posted moments ago, on its schedule or by a press: a second post would
  // say the same thing again.
  const recent = await prisma.talkUpdateRun.findFirst({
    where: { updateId, status: "posted", startedAt: { gte: new Date(now.getTime() - MANUAL_COOLDOWN_MS) } },
    select: { trigger: true },
  });
  if (recent) return { ok: false, reason: recent.trigger === "manual" ? "cooldown" : "just_posted" };
  const before = await prisma.talkUpdate.findUnique({ where: { id: updateId }, select: { lastManualAt: true } });
  const previous = before?.lastManualAt ?? null;
  const claimed = await prisma.talkUpdate.updateMany({
    where: {
      id: updateId,
      OR: [{ lastManualAt: null }, { lastManualAt: { lt: new Date(now.getTime() - MANUAL_COOLDOWN_MS) } }],
    },
    data: { lastManualAt: now },
  });
  return claimed.count === 1 ? { ok: true, previous } : { ok: false, reason: "cooldown" };
}

/** Give a Post now claim back when the press stopped before the AI was asked. */
export async function releaseManualRun(updateId: string, claimedAt: Date, previous: Date | null): Promise<void> {
  await prisma.talkUpdate.updateMany({ where: { id: updateId, lastManualAt: claimedAt }, data: { lastManualAt: previous } }).catch(() => {});
}

/** The reasons a run stops at before the AI is asked: nothing was spent. */
export const BEFORE_AI_REASONS: ReadonlySet<RunReason> = new Set<RunReason>([
  "off", "talk_off", "ai_off", "creator_gone", "creator_guest", "creator_agent", "cannot_post",
  "public_channel", "not_supported", "guests", "too_many_people", "scope_gone",
  "nothing_to_report", "nothing_new", "nothing_shared", "daily_limit", "not_configured", "not_ready", "cooldown",
  "busy", "recent_manual", "just_posted",
]);

// ── The cron's loop ────────────────────────────────────────────────

/**
 * The due updates, each claimed by ONE compare-and-swap on its nextRunAt:
 * the winner moves the schedule to its next instant and runs; a second
 * runner at the same moment matches nothing and moves on. A slot more than
 * STALE_AFTER_MS late is recorded as missed and never posted. Counts only:
 * no workspace, conversation or person is named in the answer.
 */
export async function processDueTalkUpdates(now: Date, opts: { limit: number; budgetMs: number }) {
  const started = Date.now();
  const due = await prisma.talkUpdate.findMany({
    where: { status: "active", nextRunAt: { lte: now } },
    orderBy: [{ nextRunAt: "asc" }, { id: "asc" }],
    take: opts.limit,
  });
  const counts = { due: due.length, posted: 0, skipped: 0, failed: 0, missed: 0 };
  for (const u of due) {
    if (Date.now() - started > opts.budgetMs) break;
    const dueAt = u.nextRunAt!;
    // A Post now still running: the slot is left unclaimed, for the next
    // tick (well inside STALE_AFTER_MS) to decide once that press has ended,
    // so a press that then posts nothing never costs the day its update.
    const pressing = await prisma.talkUpdateRun.findFirst({
      where: { updateId: u.id, trigger: "manual", status: "running", startedAt: { gte: new Date(now.getTime() - STUCK_RUN_MS) } },
      select: { id: true },
    });
    if (pressing) continue;
    const next = nextTalkUpdateAt(scheduleOf(u), now);
    const claimed = await prisma.talkUpdate.updateMany({
      where: { id: u.id, status: "active", nextRunAt: dueAt },
      data: { nextRunAt: next },
    });
    if (claimed.count !== 1) continue;
    // A Post now that POSTED moments ago already said what this slot would:
    // the slot steps aside rather than post twice (and only then says so).
    const manual = await prisma.talkUpdateRun.findFirst({
      where: { updateId: u.id, trigger: "manual", status: "posted", startedAt: { gte: new Date(now.getTime() - MANUAL_COOLDOWN_MS) } },
      select: { id: true },
    });
    if (manual) {
      counts.skipped += 1;
      await prisma.talkUpdateRun
        .create({ data: { updateId: u.id, organizationId: u.organizationId, dueAt, trigger: "schedule", status: "skipped", reason: "recent_manual", finishedAt: new Date() } })
        .catch(() => {});
      continue;
    }
    if (now.getTime() - dueAt.getTime() > STALE_AFTER_MS) {
      counts.missed += 1;
      await prisma.talkUpdateRun
        .create({
          data: { updateId: u.id, organizationId: u.organizationId, dueAt, trigger: "schedule", status: "skipped", reason: "missed", finishedAt: new Date() },
        })
        .catch(() => {});
      continue;
    }
    try {
      const out = await runTalkUpdate({ update: { ...u, nextRunAt: next }, trigger: "schedule", dueAt, now: new Date() });
      counts[out.status] += 1;
    } catch (err) {
      counts.failed += 1;
      console.error(`[talk-update] ${u.id} failed: ${err instanceof Error ? err.message.split("\n")[0] : String(err)}`);
    }
  }
  return counts;
}

// ── What the routes answer ─────────────────────────────────────────

export interface UpdateView {
  id: string;
  kind: TalkUpdateKind;
  kindLabel: string;
  scopeKind: "list" | "space";
  scopeId: string;
  /** Null when this viewer cannot open the List or Space. */
  scopeName: string | null;
  cadence: TalkUpdateSchedule["cadence"];
  weekday: number | null;
  timeOfDay: string;
  timezone: string;
  status: "active" | "paused";
  pausedReason: RunReason | null;
  nextRunAt: string | null;
  lastPostedAt: string | null;
  createdBy: { id: string; name: string };
  lastRun: { status: string; reason: RunReason | null; at: string; taskCount: number | null; trigger: string } | null;
  /** Pause and remove: its creator, a Full holder, an org Owner or Admin; never an Agent account. */
  canManage: boolean;
  /** Resume and change the schedule: only the person it posts as. */
  canResume: boolean;
  /** Post now: only the person it posts as, while they may post here. */
  canRunNow: boolean;
}

/** The updates of one conversation, as this viewer may see them. */
export async function describeUpdates(
  rows: readonly UpdateRow[],
  viewer: {
    userId: string;
    organizationId: string;
    manageAll: boolean;
    linkViewer: LinkViewer | null;
    /** An Agent account manages nothing here. */
    agent: boolean;
    /** May this viewer post in the conversation now (not archived, role allows)? */
    canPostHere: boolean;
  },
): Promise<UpdateView[]> {
  if (rows.length === 0) return [];
  const ids = rows.map((r) => r.id);
  const runs = await prisma.talkUpdateRun.findMany({
    where: { updateId: { in: ids } },
    orderBy: [{ startedAt: "desc" }, { id: "desc" }],
    take: 200,
    select: { id: true, updateId: true, status: true, reason: true, startedAt: true, taskCount: true, trigger: true },
  });
  const lastRun = new Map<string, (typeof runs)[number]>();
  for (const r of runs) if (!lastRun.has(r.updateId)) lastRun.set(r.updateId, r);
  const people = await prisma.user.findMany({
    where: { id: { in: Array.from(new Set(rows.map((r) => r.createdById))) }, organizationId: viewer.organizationId },
    select: { id: true, firstName: true, lastName: true },
  });
  const nameOf = new Map(people.map((p) => [p.id, `${p.firstName ?? ""} ${p.lastName ?? ""}`.trim() || "Someone"] as const));
  const out: UpdateView[] = [];
  for (const r of rows) {
    let scopeName: string | null = null;
    if (viewer.linkViewer) {
      const s = await scopeFor(r.scopeKind, r.scopeId, viewer.linkViewer);
      if (s.ok) scopeName = s.name;
    }
    const run0 = lastRun.get(r.id);
    // A run left "running" by a process that died is not a post in progress:
    // it posted if its message exists (the process died after posting),
    // else it failed.
    let run = run0;
    if (run0 && run0.status === "running" && Date.now() - run0.startedAt.getTime() > STUCK_RUN_MS) {
      const postedIt = await prisma.conversationMessage.findFirst({
        where: { conversationId: r.conversationId, clientId: `tu_${run0.id}` },
        select: { id: true },
      });
      run = postedIt ? { ...run0, status: "posted" } : { ...run0, status: "failed", reason: "error" };
    }
    const mine = r.createdById === viewer.userId;
    out.push({
      id: r.id,
      kind: r.kind as TalkUpdateKind,
      kindLabel: updateTitle(r.kind as TalkUpdateKind, r.cadence as TalkUpdateSchedule["cadence"]),
      scopeKind: r.scopeKind as "list" | "space",
      scopeId: r.scopeId,
      scopeName,
      cadence: r.cadence as TalkUpdateSchedule["cadence"],
      weekday: r.weekday,
      timeOfDay: r.timeOfDay,
      timezone: r.timezone,
      status: r.status === "paused" ? "paused" : "active",
      pausedReason: (r.pausedReason as RunReason | null) ?? null,
      nextRunAt: r.status === "active" && r.nextRunAt ? r.nextRunAt.toISOString() : null,
      lastPostedAt: r.lastPostedAt ? r.lastPostedAt.toISOString() : null,
      createdBy: { id: r.createdById, name: nameOf.get(r.createdById) ?? "Someone who left" },
      lastRun: run
        ? { status: run.status, reason: (run.reason as RunReason | null) ?? null, at: run.startedAt.toISOString(), taskCount: run.taskCount, trigger: run.trigger }
        : null,
      canManage: !viewer.agent && (mine || viewer.manageAll),
      canResume: !viewer.agent && mine,
      canRunNow: !viewer.agent && mine && r.status === "active" && viewer.canPostHere,
    });
  }
  return out;
}
