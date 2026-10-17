// Showing a teammate how (docs/plans/ai-teammates-phase5.md Decisions 5 to
// 7 and 9, step 2): a recording is a take over with the recorder on, its
// events read by a poll and at its end, its steps written as a draft skill
// the person reviews before the teammate can use it.
//
// ONLY THE PERSON, ONLY FROM THEIR PRESS. startRecording reads the session
// by the viewer's own id (anyone else's, an Owner's included, is not there),
// then, in order: the session's status as Take over reads it; skills
// available (skillsAccess: skillsOffered(), the computer's access, the
// workspace's switch, the teammate holding use_skill); at least three minutes
// left; then, under the browser's lock, the session as Take over uses it, and
// one transaction: the workspace's switch read again (FOR SHARE, so a switch
// turned off meanwhile waits for it or refuses it), the skill's row under the
// person's lock (store.ts createRecording, every cap), the teammate's
// ask_to_show_me card PENDING to RUNNING when it came from one, and the
// session to handed_over naming the recording, together. Then, under the
// lock still: the browser's handedOver flag, the guard's notes emptied, the
// recorder on (handle.watch(true)) and a picture of the start page.
//
// THE MODEL IS TOLD NOTHING WHILE IT RUNS (Decision 6): every browser tool
// of the session is locked by the take over, and the guard keeps no note.
// At the end the model hears only whether the person finished
// (take-over.ts finishTakeOver), never a step.
//
// THE POLL, every pollMs, unref'd: under the browser's lock tried without
// waiting (a step in flight: next tick), the events since the last tick
// (kept by steps.ts keepRecorded: a field's repeated typing folded, at most
// 400, past it full with one gap), a
// picture of each new page (within the session's 20 and Phase 4's disk
// rules), the steps rebuilt from every event so far (steps.ts
// stepsFromRecording) and written whole, one write at a time. A write that
// finds no recording row stops the recording here: it was finished or
// deleted elsewhere.
//
// THE END (endRecordingOf), from Done or Discard (take-over.ts), from the
// browser's end (sessions.ts endBrowserSession), and from the switch off or
// "Delete every skill" (stopRecordingsOf): the poll stopped, one last drain
// with the page still there (within 2 seconds, skipped when the browser is
// held or gone), the recorder off, handing over what was still waiting (a
// stop that never answered, or a drain skipped with nothing handed over, is
// a gap: review of Phase 5 step 2, low 1), the last steps written, the row kept as a
// draft or deleted (store.ts finishRecordingRow), the session's mark
// cleared, one audit row with counts and hosts only, and, when kept, the
// chat line in the end's own words. Only the end that finished the row
// audits and tells.
//
// NOTHING TYPED OR CHOSEN, AND NO NAME OR STEP, IN ANY LOG, AUDIT ROW OR
// LINE BUT THE ONE THE PERSON READS: the audit rows carry hosts and counts;
// the chat line names the skill by the person's own words.
//
// Server-only: imports prisma and drives the browser.

import type { Viewer } from "@/lib/access/types";
import { logActivity } from "@/lib/activity";
import { writeEventLine } from "@/lib/agents/actions";
import { computerAgentById, type ComputerAgent } from "@/lib/agents/browser-access";
import { BROWSER_COPY, BROWSER_PANEL_COPY, BROWSER_ROUTE_ERRORS, RECORDING_COPY, SKILL_AUDIT_COPY, SKILL_ROUTE_ERRORS } from "@/lib/agents/teammate-copy";
import { liveViewUrl } from "@/lib/browser/browserbase";
import { browserConfig, skillsOffered } from "@/lib/browser/config";
import { liveBrowser, liveBrowsersWhere, takeEvents, withBrowserLock, type LiveBrowser } from "@/lib/browser/live";
import { armWindows, computerAccess, endBrowserSession, GUARD_GONE_ONLY, ownSessionRow, recordStep, sessionViewFor, SYSTEM_END, useBrowserSession, type ComputerAccess, type ComputerRefusal, type PolicyRow } from "@/lib/browser/sessions";
import { saveShot } from "@/lib/browser/shots";
import { siteOf } from "@/lib/browser/sites";
import type { BrowserSessionView } from "@/lib/browser/views";
import { prisma } from "@/lib/prisma";
import { publishToUser } from "@/lib/realtime-bus";
import { keepRecorded, recordableAddress, shotKey, stepsFromRecording } from "./steps";
import { createRecording, finishRecordingRow, writeRecordedSteps, type SkillCapRefusal } from "./store";
import { SKILL_LIMITS, type RecordedEvent, type RecordingEnd } from "./types";

/** A recording in this process (live.ts LiveBrowser.recording): its events so far, never kept, and its poll. */
export interface LiveRecording {
  skillId: string;
  events: RecordedEvent[];
  /** The address the recording started on, whole, in memory only: steps.ts keeps its origin and path at most. */
  startUrl: string;
  /** Each page's picture, by shotKey(address). */
  pageShots: Map<string, string>;
  full: boolean;
  timer: NodeJS.Timeout | null;
  /** Set once its end began: the poll writes nothing more. */
  stopped?: boolean;
  /** New events or pictures since the last write. */
  dirty?: boolean;
  /** The pages whose picture was tried, kept or not, so each is tried once. */
  shotTried?: Set<string>;
  /** One write at a time, the last always from every event so far. */
  writing?: Promise<void>;
}

type Refusal = { ok: false; status: number; code: string; error: string };

const refusal = (status: number, code: string, error: string): Refusal => ({ ok: false, status, code, error });
const notFound = (): Refusal => refusal(404, "not_found", BROWSER_ROUTE_ERRORS.notFound);
const ended = (): Refusal => refusal(409, "ended", BROWSER_ROUTE_ERRORS.ended);
const busy = (): Refusal => refusal(409, "busy", BROWSER_ROUTE_ERRORS.busy);

/** How long a recording's start waits for a step in flight to finish (Take over's own wait). */
const RECORD_LOCK_WAIT_MS = 20_000;
/** The most a recording's end waits for its last drain, and for the recorder to switch off. */
const END_DRAIN_MS = 2_000;
/** A recorder stop that did not answer within END_DRAIN_MS. */
const STOP_LATE = Symbol("stop_late");
/** How long the start's transaction may take (it waits on the person's lock). */
const LOCK_TX = { timeout: 20_000, maxWait: 10_000 } as const;

function errorLine(err: unknown): string {
  return err instanceof Error ? err.name : "error";
}

/** `p`, or `late` once `ms` passed. */
function within<T>(p: Promise<T>, ms: number, late: T): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const t = new Promise<T>((r) => {
    timer = setTimeout(() => r(late), ms);
    timer.unref?.();
  });
  return Promise.race([p, t]).finally(() => clearTimeout(timer));
}

// ── Whether skills may be used here now ─────────────────────────────

export type SkillsRefusal = ComputerRefusal | "not_offered" | "skills_off" | "cant_learn";

/**
 * Whether this teammate may learn by showing now, read fresh (Decisions 1, 2
 * and 4), in this order, each refusal its own: this WorkwrK offers it
 * (skillsOffered), the computer's access (every Phase 4 refusal), the
 * workspace's switch (skillsEnabled), the teammate holding use_skill in its
 * stored tools (a skill it could never use is not recorded).
 */
export async function skillsAccess(a: {
  organizationId: string;
  agent: Pick<ComputerAgent, "browserSites" | "learns">;
}): Promise<{ ok: true; access: Extract<ComputerAccess, { ok: true }>; policy: PolicyRow } | { ok: false; reason: SkillsRefusal }> {
  if (!skillsOffered()) return { ok: false, reason: "not_offered" };
  const access = await computerAccess({ organizationId: a.organizationId, agent: a.agent });
  if (!access.ok) return { ok: false, reason: access.reason };
  if (!access.policy.skillsEnabled) return { ok: false, reason: "skills_off" };
  if (a.agent.learns !== true) return { ok: false, reason: "cant_learn" };
  return { ok: true, access, policy: access.policy };
}

/** A refusal of skillsAccess as the record route answers it (Decision 28: its real reason); the messages route's Teach a skill and the Skills tab say it too (step 3). */
export function skillsRefusal(reason: SkillsRefusal, agentName: string): Refusal {
  switch (reason) {
    case "not_offered":
    case "skills_off":
      return refusal(403, "skills_off", SKILL_ROUTE_ERRORS.skillsOff);
    case "cant_learn":
      return refusal(409, "cant_learn", SKILL_ROUTE_ERRORS.cantLearn(agentName));
    case "not_configured":
      return refusal(503, "not_configured", BROWSER_ROUTE_ERRORS.notConfigured);
    case "trial":
      return refusal(403, "trial", BROWSER_ROUTE_ERRORS.trial);
    case "plan":
      return refusal(403, "plan", BROWSER_ROUTE_ERRORS.plan);
    case "workspace_closed":
      return refusal(409, "workspace_closed", BROWSER_ROUTE_ERRORS.workspaceClosed);
    case "workspace_off":
      return refusal(403, "workspace_off", BROWSER_COPY.workspaceOff);
    case "no_sites":
      return refusal(409, "no_sites", BROWSER_COPY.noSites(agentName));
  }
}

const CAP_REFUSAL: Readonly<Record<SkillCapRefusal, () => Refusal>> = {
  already_recording: () => refusal(409, "already_recording", SKILL_ROUTE_ERRORS.alreadyRecording),
  too_many_for_teammate: () => refusal(409, "too_many_for_teammate", SKILL_ROUTE_ERRORS.tooManyForTeammate(SKILL_LIMITS.perTeammate)),
  too_many: () => refusal(409, "too_many", SKILL_ROUTE_ERRORS.tooMany(SKILL_LIMITS.perPerson)),
  recordings_today: () => refusal(429, "recordings_today", SKILL_ROUTE_ERRORS.recordingsToday(SKILL_LIMITS.recordingsPerDay)),
  name_taken: () => refusal(409, "name_taken", SKILL_ROUTE_ERRORS.nameTaken),
};

class CardDecided extends Error {}
class SessionMoved extends Error {}
class SkillsTurnedOff extends Error {}
class CapRefused extends Error {
  constructor(readonly reason: SkillCapRefusal) {
    super(reason);
  }
}

// ── The steps so far ────────────────────────────────────────────────

/** The steps of every event so far, written whole, one write at a time (see the header). False when no recording row is there any more. */
function persist(rec: LiveRecording, o: { final?: true } = {}): Promise<boolean> {
  const before = rec.writing ?? Promise.resolve();
  const next = before.then(async () => {
    if (rec.stopped && !o.final) return true;
    rec.dirty = false;
    const steps = stepsFromRecording({ startUrl: rec.startUrl, events: rec.events, pageShots: rec.pageShots });
    if (steps.length >= SKILL_LIMITS.recordedStepsMax) rec.full = true;
    return writeRecordedSteps(rec.skillId, steps, rec.full);
  });
  rec.writing = next.then(
    () => undefined,
    () => undefined,
  );
  return next.catch(() => true);
}

/** Events kept in memory (steps.ts keepRecorded): a field's repeated typing folded, at most eventsMax, past it full with one gap. */
function keepEvents(rec: LiveRecording, events: readonly RecordedEvent[]): void {
  const kept = keepRecorded(rec.events, events, SKILL_LIMITS.eventsMax);
  if (kept.full) rec.full = true;
  if (kept.added > 0) rec.dirty = true;
}

/** "May be missing" at the page open now (Decision 7: a gap is never silent). */
function keepGap(lb: LiveBrowser, rec: LiveRecording): void {
  let url = "";
  try {
    url = lb.handle.currentUrl();
  } catch {
    url = "";
  }
  keepEvents(rec, [{ type: "gap", control: null, at: Date.now(), page: /^https?:/i.test(url) ? url : (rec.events[rec.events.length - 1]?.page ?? rec.startUrl) }]);
}

/** The person's input since the last read, kept (keepEvents), and a picture of the page open now when it has none yet. Under the browser's lock. False when it could not be read. */
async function collect(lb: LiveBrowser, rec: LiveRecording, o: { picture: boolean }): Promise<boolean> {
  let drained: Awaited<ReturnType<LiveBrowser["handle"]["drainEvents"]>>;
  try {
    drained = await lb.handle.drainEvents();
  } catch {
    return false;
  }
  keepEvents(rec, drained.events);
  if (!o.picture) return true;
  const url = lb.handle.currentUrl();
  if (!/^https?:/i.test(url)) return true;
  const key = shotKey(url);
  const tried = (rec.shotTried ??= new Set());
  if (rec.pageShots.has(key) || tried.has(key)) return true;
  tried.add(key);
  try {
    const pic = await lb.handle.screenshot({});
    const id = await saveShot({ row: { id: lb.rowId, organizationId: lb.organizationId, userId: lb.userId }, kind: "page", jpeg: pic.jpeg, width: pic.width, height: pic.height });
    if (id) {
      rec.pageShots.set(key, id);
      rec.dirty = true;
    }
  } catch {
    // No picture of this page: its step shows none.
  }
  return true;
}

/** The recording here stops, its row finished or gone elsewhere: the recorder off and the session's mark cleared. */
async function dropHere(rowId: string, rec: LiveRecording): Promise<void> {
  rec.stopped = true;
  if (rec.timer) clearTimeout(rec.timer);
  rec.timer = null;
  const lb = liveBrowser(rowId);
  if (lb && lb.recording === rec) {
    lb.recording = null;
    await within(lb.handle.watch(false), END_DRAIN_MS, undefined);
  }
  await prisma.teammateBrowserSession.updateMany({ where: { id: rowId, recordingSkillId: rec.skillId }, data: { recordingSkillId: null } }).catch(() => undefined);
}

function armPoll(rowId: string, rec: LiveRecording): void {
  if (rec.stopped) return;
  if (rec.timer) clearTimeout(rec.timer);
  const timer = setTimeout(() => void pollOnce(rowId, rec), SKILL_LIMITS.pollMs);
  timer.unref?.();
  rec.timer = timer;
}

/** One tick of the poll (see the header). Never throws. */
async function pollOnce(rowId: string, rec: LiveRecording): Promise<void> {
  rec.timer = null;
  if (rec.stopped) return;
  try {
    const out = await withBrowserLock(rowId, 0, async (lb) => {
      if (lb.recording !== rec) return "stop" as const;
      await collect(lb, rec, { picture: true });
      return "ok" as const;
    });
    if (rec.stopped) return;
    if (typeof out === "object" && "gone" in out) {
      rec.stopped = true;
      return;
    }
    if (out === "stop") return;
    if (rec.dirty) {
      const still = await persist(rec);
      if (!still && !rec.stopped) {
        await dropHere(rowId, rec);
        return;
      }
    }
  } catch (err) {
    console.error(`[skills] recording poll ${errorLine(err)}`);
  }
  armPoll(rowId, rec);
}

// ── Starting ────────────────────────────────────────────────────────

/**
 * The person starts showing the teammate how (see the header), from the
 * browser card (no actionId) or from the teammate's ask_to_show_me card
 * (actionId). `name` is the person's own words, cleaned by the route.
 * Answers the session as it is now, the live view's address and the skill.
 */
export async function startRecording(
  viewer: Pick<Viewer, "userId" | "organizationId">,
  rowId: string,
  o: { name: string; actionId: string | null },
): Promise<{ ok: true; view: BrowserSessionView; url: string; skillId: string } | Refusal> {
  const row = await ownSessionRow(viewer, rowId);
  if (!row) return notFound();
  if (row.status === "ended" || row.status === "ending") return ended();
  // Still starting (its guard is not attached yet), or the person has it already: asked again in a moment.
  if (row.status === "starting" || row.status === "handed_over") return busy();
  const cfg = browserConfig();
  if (!cfg) {
    // The computer is off on this WorkwrK now: nothing may drive the browser.
    await endBrowserSession(row.id, "turned_off", SYSTEM_END);
    return ended();
  }
  const agent = await computerAgentById(viewer.organizationId, row.agentId);
  if (!agent || !agent.browserTools) {
    // Paused, removed or holding no browser tool: its browsers end (Phase 4 Decision 6).
    await endBrowserSession(row.id, "teammate_off", SYSTEM_END);
    return ended();
  }
  const skills = await skillsAccess({ organizationId: viewer.organizationId, agent });
  if (!skills.ok) return skillsRefusal(skills.reason, agent.name);
  if (row.endsBy.getTime() - Date.now() < SKILL_LIMITS.minMinutesToRecord * 60_000) return refusal(409, "too_late", SKILL_ROUTE_ERRORS.tooLate);

  const out = await withBrowserLock(row.id, RECORD_LOCK_WAIT_MS, async (lb) => {
    // Read again under the lock: a take over or a recording that landed while this one waited.
    if (lb.handedOver === true || lb.recording) return busy();
    const use = await useBrowserSession({ person: viewer, agentId: row.agentId, browserSessionId: row.id, runId: null, purpose: "take_over" });
    if (!use.ok) {
      if (use.reason === "busy" || use.reason === "person_has_it") return busy();
      if (use.reason === "not_reached") return refusal(503, "not_reached", BROWSER_ROUTE_ERRORS.notReached);
      return ended();
    }
    if (use.row.status === "handed_over") return busy();
    const url = lb.handle.currentUrl();
    const startUrl = recordableAddress(url);
    // No web page open (about:blank): nothing to start a skill from (step 1's note).
    if (!startUrl) return refusal(409, "no_page", SKILL_ROUTE_ERRORS.noPage);
    const now = new Date();
    let skillId: string;
    try {
      skillId = await prisma.$transaction(async (tx) => {
        // The switch read again, waiting on a change in flight (sessions.ts setSkillsEnabled takes the row FOR UPDATE).
        const pol = await tx.$queryRaw<Array<{ enabled: boolean; skillsEnabled: boolean }>>`
          SELECT "enabled", "skillsEnabled" FROM "TeammateBrowserPolicy" WHERE "organizationId" = ${viewer.organizationId} FOR SHARE`;
        if (pol[0]?.enabled !== true || pol[0]?.skillsEnabled !== true) throw new SkillsTurnedOff();
        const made = await createRecording(tx, { organizationId: viewer.organizationId, userId: viewer.userId, agentId: row.agentId, name: o.name, sessionId: row.id, startUrl });
        if (!made.ok) throw new CapRefused(made.reason);
        if (o.actionId) {
          const card = await tx.agentAction.updateMany({
            where: {
              id: o.actionId,
              actingForId: viewer.userId,
              organizationId: viewer.organizationId,
              toolName: "ask_to_show_me",
              status: "PENDING",
              input: { path: ["browserSessionId"], equals: row.id },
            },
            data: { status: "RUNNING", decidedVia: "person", decidedById: viewer.userId, decidedAt: now },
          });
          if (card.count !== 1) throw new CardDecided();
        }
        const moved = await tx.teammateBrowserSession.updateMany({
          where: { id: row.id, status: { in: ["live", "waiting"] }, recordingSkillId: null },
          data: { status: "handed_over", handedOverAt: now, waitingSince: null, lastActiveAt: now, recordingSkillId: made.skillId },
        });
        if (moved.count !== 1) throw new SessionMoved();
        return made.skillId;
      }, LOCK_TX);
    } catch (err) {
      if (err instanceof CardDecided) return refusal(409, "card_decided", BROWSER_ROUTE_ERRORS.cardDecided);
      if (err instanceof SessionMoved) return ended();
      if (err instanceof SkillsTurnedOff) return refusal(403, "skills_off", SKILL_ROUTE_ERRORS.skillsOff);
      if (err instanceof CapRefused) return CAP_REFUSAL[err.reason]();
      throw err;
    }
    // Still under the lock (take-over.ts): every call after this one sees the person has it.
    lb.handedOver = true;
    takeEvents(lb);
    const rec: LiveRecording = { skillId, events: [], startUrl: url, pageShots: new Map(), full: false, timer: null, dirty: true, shotTried: new Set() };
    lb.recording = rec;
    await lb.handle.watch(true);
    let picture: Awaited<ReturnType<LiveBrowser["handle"]["screenshot"]>> | null = null;
    try {
      picture = await lb.handle.screenshot({});
    } catch {
      picture = null;
    }
    armWindows(row.id, { status: "handed_over", lastActiveAt: now, waitingSince: null, handedOverAt: now, endsBy: use.row.endsBy });
    return { ok: true as const, rec, url, picture };
  });
  if (typeof out === "object" && "busy" in out) return busy();
  if (typeof out === "object" && "gone" in out) {
    // This process no longer holds its guard (Phase 4 Decision 7): only a row that had one ends so.
    await endBrowserSession(row.id, "restarted", SYSTEM_END, { only: GUARD_GONE_ONLY });
    return ended();
  }
  if (!out.ok) return out;
  const { rec, url } = out;
  const site = siteOf(url) ?? row.currentSite;

  // The start page's picture (Decision 9), its first steps on record, and the poll.
  if (out.picture) {
    rec.shotTried?.add(shotKey(url));
    const shotId = await saveShot({ row: { id: row.id, organizationId: row.organizationId, userId: row.userId }, kind: "page", jpeg: out.picture.jpeg, width: out.picture.width, height: out.picture.height }).catch(() => null);
    if (shotId) rec.pageShots.set(shotKey(url), shotId);
  }
  await persist(rec);
  armPoll(row.id, rec);

  // Counted by the next start's day cap (store.ts createRecording).
  await recordStep(row.id, viewer.userId, { kind: "take_over", code: "recording", site, outcome: "ok", actionId: o.actionId });
  await logActivity({
    type: "teammate_skill.recording",
    actorId: viewer.userId,
    actingForId: row.userId,
    organizationId: viewer.organizationId,
    description: SKILL_AUDIT_COPY.recordingStarted(site ?? BROWSER_PANEL_COPY.STEP_WORDS.unknownSite),
    targetId: row.agentId,
    targetType: "agent",
    metadata: { phase: "start", site, browserSessionId: row.id, skillId: rec.skillId, agentId: row.agentId, actionId: o.actionId },
    severity: "info",
  });
  publishToUser(viewer.userId, { type: "agent.changed", agentId: row.agentId, browserSessionId: row.id });

  const view = await sessionViewFor(viewer, row.id);
  if (!view) return notFound();
  if (!row.providerSessionId) return refusal(503, "provider_unavailable", BROWSER_ROUTE_ERRORS.liveViewFailed);
  const live = await liveViewUrl(cfg, row.providerSessionId);
  if (!live.ok) return refusal(503, "provider_unavailable", BROWSER_ROUTE_ERRORS.liveViewFailed);
  return { ok: true, view, url: live.data, skillId: rec.skillId };
}

// ── Ending ──────────────────────────────────────────────────────────

/** The chat line a kept recording's end writes, in the end's own words. */
function recordedLineFor(reason: RecordingEnd, steps: number, name: string): string {
  if (reason === "done") return RECORDING_COPY.recordedLine(steps, name);
  if (reason === "skills_off") return RECORDING_COPY.stoppedSkillsOff;
  return RECORDING_COPY.endedWhileRecording(steps);
}

/**
 * A recording's end (see the header): `keep` a draft (Done, and every end
 * the person did not choose) or delete it (Discard), `reason` the row's
 * recordingEndReason, `drain` the last of the person's input read first.
 * `locked`: the caller holds the browser's lock (sessions.ts endWhenFree), so
 * the drain runs under it. Null when this session records nothing, or when
 * another end finished the row first.
 */
export async function endRecordingOf(rowId: string, o: { keep: boolean; reason: RecordingEnd; drain: boolean; locked?: boolean }): Promise<{ skillId: string; kept: boolean; steps: number } | null> {
  const lb = liveBrowser(rowId);
  const rec = lb?.recording ?? null;
  if (rec) {
    rec.stopped = true;
    if (rec.timer) clearTimeout(rec.timer);
    rec.timer = null;
  }
  const row = await prisma.teammateBrowserSession
    .findUnique({ where: { id: rowId }, select: { id: true, organizationId: true, userId: true, agentId: true, chatSessionId: true, currentSite: true, recordingSkillId: true } })
    .catch(() => null);
  const skillId = row?.recordingSkillId ?? rec?.skillId ?? null;

  // The last of the person's input, with the page still there. Read: it ran
  // (a step holding the lock past 2 seconds, or a drain that never answered,
  // leaves it unread).
  let read = true;
  if (lb && rec && o.drain) {
    const last = async (b: LiveBrowser): Promise<boolean> => (b.recording === rec ? collect(b, rec, { picture: false }) : true);
    const got = o.locked ? await within(last(lb), END_DRAIN_MS, false) : await withBrowserLock(rowId, END_DRAIN_MS, last);
    read = got === true;
  }
  if (lb && rec && lb.recording === rec) {
    lb.recording = null;
    // The recorder off: what was still waiting is handed over and kept
    // (cdp-driver.ts stopWatching, with its own gap for what it could not
    // read). A stop that never answered, or a last drain unread with no
    // hand over, is a gap (review of Phase 5 step 2, low 1): never silent.
    const left = await within<{ events: RecordedEvent[] } | void | typeof STOP_LATE>(lb.handle.watch(false), END_DRAIN_MS, STOP_LATE);
    if (left !== STOP_LATE && left && Array.isArray(left.events)) keepEvents(rec, left.events);
    else if (left === STOP_LATE || !read) keepGap(lb, rec);
  }
  if (!skillId) return null;
  // Every event so far, written once more before the row is finished.
  if (rec && rec.skillId === skillId) await persist(rec, { final: true });
  const named = await prisma.teammateSkill.findUnique({ where: { id: skillId }, select: { name: true } }).catch(() => null);
  const fin = await finishRecordingRow(skillId, o.keep, o.reason);
  await prisma.teammateBrowserSession.updateMany({ where: { id: rowId, recordingSkillId: skillId }, data: { recordingSkillId: null } }).catch((err) => console.error(`[skills] recording mark not cleared ${errorLine(err)}`));
  if (!fin.finished || !row) return null;

  await logActivity({
    type: "teammate_skill.recording",
    actorId: o.reason === "done" ? row.userId : null,
    ...(o.reason === "done" ? {} : { actorType: "system", actorLabel: "WorkwrK" }),
    actingForId: row.userId,
    organizationId: row.organizationId,
    description: SKILL_AUDIT_COPY.recordingEnded(fin.steps, fin.kept),
    targetId: row.agentId,
    targetType: "agent",
    metadata: { phase: "end", kept: fin.kept, steps: fin.steps, sites: fin.sites, reason: o.reason, browserSessionId: rowId, skillId, agentId: row.agentId },
    severity: "info",
  });
  if (fin.kept) {
    const person = await prisma.user.findUnique({ where: { id: row.userId }, select: { deletedAt: true } }).catch(() => null);
    // An erased person's chats are blanked; nothing new is written to them.
    if (person && !person.deletedAt) {
      await writeEventLine(row.chatSessionId, { text: recordedLineFor(o.reason, fin.steps, named?.name ?? ""), event: "skill_recorded", agentId: row.agentId, skillId });
    }
  }
  publishToUser(row.userId, { type: "agent.changed", agentId: row.agentId, browserSessionId: rowId });
  return { skillId, kept: fin.kept, steps: fin.steps };
}

/**
 * Every recording in a workspace stopped and kept as a draft (the skills
 * switch off): the take over goes on as a plain one, and its card reads it
 * at its next read. "Delete every skill" (step 3) stops them with `keep`
 * false: what was recorded is deleted rather than kept, so no line tells the
 * person a draft was kept that the next statement deletes. A recording in
 * another process does not exist (one instance, Phase 4's sweep part 2).
 * Answers how many were kept as drafts (the switch's "kept as drafts" says
 * that number, review of step 3: an empty recording is deleted, never
 * counted), or, with `keep` false, how many stopped.
 */
export async function stopRecordingsOf(organizationId: string, reason: "skills_off", o: { keep?: boolean } = {}): Promise<number> {
  const rows = await prisma.teammateBrowserSession.findMany({
    where: { organizationId, status: { in: ["starting", "live", "waiting", "handed_over", "ending"] }, recordingSkillId: { not: null } },
    select: { id: true },
    take: 1000,
  });
  const ids = new Set(rows.map((r) => r.id));
  for (const lb of liveBrowsersWhere((b) => b.organizationId === organizationId && !!b.recording)) ids.add(lb.rowId);
  let n = 0;
  for (const id of ids) {
    const out = await endRecordingOf(id, { keep: o.keep !== false, reason, drain: true }).catch((err) => {
      console.error(`[skills] recording not stopped ${errorLine(err)}`);
      return null;
    });
    if (out && (out.kept || o.keep === false)) n += 1;
  }
  return n;
}

/**
 * The sweep's part (sessions.ts sweepBrowserSessions): a "recording" skill
 * whose session ended, or no longer names it, is finished as "ended" (a
 * crash between a browser's end and its recording's), at most `limit`.
 * One whose session is still ending is left to the next tick: its end
 * finishes it. Answers how many it finished.
 */
export async function closeOrphanRecordings(limit: number, deadline = Number.POSITIVE_INFINITY): Promise<number> {
  const skills = await prisma.teammateSkill.findMany({ where: { status: "recording" }, select: { id: true, organizationId: true, userId: true, agentId: true, recordingSessionId: true }, take: Math.max(0, limit), orderBy: { createdAt: "asc" } });
  let n = 0;
  for (const s of skills) {
    if (Date.now() >= deadline) break;
    const row = s.recordingSessionId ? await prisma.teammateBrowserSession.findUnique({ where: { id: s.recordingSessionId }, select: { status: true, recordingSkillId: true } }) : null;
    if (row && row.status === "ending") continue;
    if (row && ["starting", "live", "waiting", "handed_over"].includes(String(row.status)) && row.recordingSkillId === s.id) continue;
    const fin = await finishRecordingRow(s.id, true, "ended");
    if (!fin.finished) continue;
    n += 1;
    await logActivity({
      type: "teammate_skill.recording",
      actorId: null,
      actorType: "system",
      actorLabel: "WorkwrK",
      actingForId: s.userId,
      organizationId: s.organizationId,
      description: SKILL_AUDIT_COPY.recordingEnded(fin.steps, fin.kept),
      targetId: s.agentId,
      targetType: "agent",
      metadata: { phase: "end", kept: fin.kept, steps: fin.steps, sites: fin.sites, reason: "ended", browserSessionId: s.recordingSessionId, skillId: s.id, agentId: s.agentId },
      severity: "info",
    });
  }
  return n;
}
