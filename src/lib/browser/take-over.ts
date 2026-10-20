// Take over (docs/plans/ai-teammates-phase4.md Decision 19): the session's
// person takes the browser into their own hands, to sign in, enter a code or
// pay, while every browser tool of that session is locked; Done (or Give it
// back) hands it back, and the chat continues.
//
// ONLY THE SESSION'S PERSON. Every step reads the row by the viewer's own id
// in their workspace; anyone else's, an Owner's included, is not there.
//
// THE CARD AND THE SESSION MOVE TOGETHER. Starting from a teammate's
// ask_to_take_over card swaps that card PENDING to RUNNING and the session to
// handed_over in one transaction, so a card decided elsewhere (409
// card_decided) or a session that moved (409 ended) changes neither. Done
// swaps the session back to live, and the RUNNING card to EXECUTED with only
// { done } and the note the model reads: nothing the person typed or saw.
//
// THE LIVE VIEW'S ADDRESS is minted for this request, answered with
// Cache-Control: no-store by the route, never stored or logged (Decision 19).
// Take over, and a recording's start, ask for a control view; the live-view
// route asks for one only while the row is handed over, and a watch view
// otherwise (docs/plans/browser-host.md 9.3). Our own host enforces it: a
// watch view never types.
//
// DONE HANDS BACK, THEN REVOKES, BEFORE THE TEAMMATE CAN ACT AGAIN
// (browser-host.md Decision 7, and the review of its step 2). Under the
// browser's lock, once the row is back to live, Done asks the host to close
// every control view of the session, and only then clears the handedOver
// flag and lets the lock go. Chosen by worst case over revoking first: a
// control view minted between a revoke and the hand back (the card's own
// live-view call, another tab, a Take over pressed meanwhile, while Done
// waits up to 20 seconds for the lock) would carry the new epoch and drive
// the browser for up to 15 minutes after the person gave it back. Revoking
// after the swap leaves no such window: from the swap on, the route mints
// watch views only. A mint that read the row before the swap and reached the
// host after the revoke is caught by controlViewUrl, which reads the row
// again after the mint. And since the lock is held to the revoke, the
// teammate's next step never runs while the person's view still takes input.
// A revoke that fails never fails Done: a control view dies at its own 15
// minutes.
//
// NOTHING RUNS, AND NOTHING IS NOTED, WHILE THE PERSON HAS IT (review round 1
// of Phase 4). Under the browser's lock, after its swap, Take over sets the
// browser's handedOver flag and empties the guard's notes; Done swaps the
// row back under the lock, empties them once more and clears the flag. A
// call that waited on the lock behind a take over reads the flag and the
// row again and refuses (browser-tools.ts onBrowser, browser-previews.ts),
// and the guard keeps no note meanwhile (sessions.ts guardHooks), so the
// model hears only that the person finished or gave it back.
//
// A RECORDING IS A TAKE OVER WITH THE RECORDER ON
// (docs/plans/ai-teammates-phase5.md Decision 6, src/lib/skills/recorder.ts
// startRecording). Done keeps its steps as a draft and Discard (Done with
// finished false) deletes them, before the browser is handed back, while the
// page is still there for its last events; a teammate's ask_to_show_me card
// becomes EXECUTED with only { done, note }, `done` true only when a draft
// was kept, never a step. The hand-back's step carries code "recording", and
// the recording's own audit row stands for the take over's end.
//
// Server-only: imports prisma.

import type { Viewer } from "@/lib/access/types";
import { logActivity } from "@/lib/activity";
import { actionHref, writeEventLine, type ResumeChat } from "@/lib/agents/actions";
import { BROWSER_AUDIT_COPY, BROWSER_COPY, BROWSER_ROUTE_ERRORS, BROWSER_PANEL_COPY, RECORDING_COPY } from "@/lib/agents/teammate-copy";
import { prisma } from "@/lib/prisma";
import { publishToUser } from "@/lib/realtime-bus";
import { liveViewUrl, revokeLiveViews, type ProviderResult } from "./browserbase";
import { browserConfig, browserReleaseConfig, type BrowserConfig } from "./config";
import { liveBrowser, takeEvents, withBrowserLock, type LiveBrowser } from "./live";
import { armWindows, armWindowsFromRow, endBrowserSession, GUARD_GONE_ONLY, ownSessionRow, recordStep, sessionViewFor, SYSTEM_END, useBrowserSession, waitingCardOf } from "./sessions";
import type { BrowserSessionView } from "./views";

type Refusal = { ok: false; status: number; code: string; error: string };

const notFound = (): Refusal => ({ ok: false, status: 404, code: "not_found", error: BROWSER_ROUTE_ERRORS.notFound });
const ended = (): Refusal => ({ ok: false, status: 409, code: "ended", error: BROWSER_ROUTE_ERRORS.ended });

/** How long a take over waits for a step in flight to finish. */
const TAKE_OVER_WAIT_MS = 20_000;

/** How long Done waits for the host to close the control views (browser-host.md 9.3), under the browser's lock. */
export const REVOKE_WAIT_MS = 4_000;

/**
 * A control view's address for a handed over row (see the header), answered
 * only while the row is still handed over once it is minted. A row that
 * moved meanwhile answers `moved`, and its address is dropped unseen: its
 * token reached no one, and the revoke that Done sent may have come before
 * it reached the host.
 */
export async function controlViewUrl(cfg: BrowserConfig, rowId: string, providerSessionId: string): Promise<ProviderResult<string> | { ok: false; moved: true }> {
  const url = await liveViewUrl(cfg, providerSessionId, "control");
  if (!url.ok) return url;
  const now = await prisma.teammateBrowserSession.findUnique({ where: { id: rowId }, select: { status: true } }).catch(() => null);
  if (now?.status !== "handed_over") return { ok: false, moved: true };
  return url;
}

class CardDecided extends Error {}
class SessionMoved extends Error {}

function personName(u: { firstName: string | null; lastName: string | null; email: string } | null): string {
  if (!u) return "";
  return `${u.firstName ?? ""} ${u.lastName ?? ""}`.trim() || u.email;
}

/**
 * The person takes the browser (see the header), from the browser card
 * (no actionId) or from the teammate's ask_to_take_over card (actionId).
 * Answers the session as it is now and the live view's address.
 */
export async function startTakeOver(
  viewer: Pick<Viewer, "userId" | "organizationId">,
  rowId: string,
  actionId: string | null,
): Promise<{ ok: true; view: BrowserSessionView; url: string } | Refusal> {
  const row = await ownSessionRow(viewer, rowId);
  if (!row) return notFound();
  if (row.status === "ended" || row.status === "ending") return ended();
  // Still starting: its guard is not attached yet, so it has none to have
  // lost (review of Phase 4 step 2). Asked again in a moment.
  if (row.status === "starting") return { ok: false, status: 409, code: "busy", error: BROWSER_ROUTE_ERRORS.busy };
  const cfg = browserConfig();
  if (!cfg) {
    // The computer is off on this WorkwrK now: nothing may drive the browser.
    await endBrowserSession(row.id, "turned_off", SYSTEM_END);
    return ended();
  }

  const out = await withBrowserLock(row.id, TAKE_OVER_WAIT_MS, async (lb) => {
    const use = await useBrowserSession({ person: viewer, agentId: row.agentId, browserSessionId: row.id, runId: null, purpose: "take_over" });
    if (!use.ok) {
      if (use.reason === "busy") return { ok: false, status: 409, code: "busy", error: BROWSER_ROUTE_ERRORS.busy } as Refusal;
      // Not known to be closed (after the last polish of Phase 4): never "That browser is closed".
      if (use.reason === "not_reached") return { ok: false, status: 503, code: "not_reached", error: BROWSER_ROUTE_ERRORS.notReached } as Refusal;
      return ended();
    }
    const now = new Date();
    try {
      await prisma.$transaction(async (tx) => {
        if (actionId) {
          const card = await tx.agentAction.updateMany({
            where: {
              id: actionId,
              actingForId: viewer.userId,
              organizationId: viewer.organizationId,
              toolName: "ask_to_take_over",
              status: "PENDING",
              input: { path: ["browserSessionId"], equals: row.id },
            },
            data: { status: "RUNNING", decidedVia: "person", decidedById: viewer.userId, decidedAt: now },
          });
          if (card.count !== 1) throw new CardDecided();
        }
        if (use.row.status !== "handed_over") {
          const moved = await tx.teammateBrowserSession.updateMany({
            where: { id: row.id, status: { in: ["live", "waiting"] } },
            data: { status: "handed_over", handedOverAt: now, waitingSince: null, lastActiveAt: now },
          });
          if (moved.count !== 1) throw new SessionMoved();
        }
      });
    } catch (err) {
      if (err instanceof CardDecided) return { ok: false, status: 409, code: "card_decided", error: BROWSER_ROUTE_ERRORS.cardDecided } as Refusal;
      if (err instanceof SessionMoved) return ended();
      throw err;
    }
    // Still under the lock (see the header): every call after this one sees it.
    lb.handedOver = true;
    takeEvents(lb);
    armWindows(row.id, { status: "handed_over", lastActiveAt: now, waitingSince: null, handedOverAt: use.row.status === "handed_over" ? (use.row.handedOverAt ?? now) : now, endsBy: use.row.endsBy });
    return { ok: true as const, row: use.row, at: now };
  });
  if ("busy" in out) return { ok: false, status: 409, code: "busy", error: BROWSER_ROUTE_ERRORS.busy };
  if ("gone" in out) {
    // The browser is not held here: its guard is gone. Only a row that had
    // one ends so (review of Phase 4 step 2).
    await endBrowserSession(row.id, "restarted", SYSTEM_END, { only: GUARD_GONE_ONLY });
    return ended();
  }
  if (!out.ok) return out;

  await recordStep(row.id, viewer.userId, { kind: "take_over", site: row.currentSite, outcome: "ok", actionId });
  const agent = await prisma.agent.findUnique({ where: { id: row.agentId }, select: { name: true } }).catch(() => null);
  await logActivity({
    type: "teammate_browser.take_over",
    actorId: viewer.userId,
    // The session's person (review round 1 of Phase 4): the feeds show the row to them.
    actingForId: row.userId,
    organizationId: viewer.organizationId,
    description: BROWSER_AUDIT_COPY.takeOverStarted(row.currentSite ?? BROWSER_PANEL_COPY.STEP_WORDS.unknownSite),
    targetId: row.agentId,
    targetType: "agent",
    metadata: { browserSessionId: row.id, agentId: row.agentId, agentName: agent?.name ?? null, site: row.currentSite, phase: "start", actionId },
    severity: "warning",
  });
  publishToUser(viewer.userId, { type: "agent.changed", agentId: row.agentId, browserSessionId: row.id });

  const view = await sessionViewFor(viewer, row.id);
  if (!view) return notFound();
  if (!row.providerSessionId) return { ok: false, status: 503, code: "provider_unavailable", error: BROWSER_ROUTE_ERRORS.liveViewFailed };
  const url = await controlViewUrl(cfg, row.id, row.providerSessionId);
  // Given back meanwhile, by Done in another tab: no control view for a browser the person no longer has.
  if (!url.ok && "moved" in url) return { ok: false, status: 409, code: "not_handed_over", error: BROWSER_ROUTE_ERRORS.notHandedOver };
  if (!url.ok) return { ok: false, status: 503, code: "provider_unavailable", error: BROWSER_ROUTE_ERRORS.liveViewFailed };
  return { ok: true, view, url: url.data };
}

/**
 * The person hands the browser back, `finished` or not (see the header).
 * `resume` is true when a teammate's card moved, so the chat continues once,
 * as a decision's answer does.
 */
export async function finishTakeOver(
  viewer: Pick<Viewer, "userId" | "organizationId">,
  rowId: string,
  finished: boolean,
): Promise<{ ok: true; view: BrowserSessionView; resume: boolean; chat: ResumeChat | null; recorded: { skillId: string; steps: number } | null } | Refusal> {
  const row = await ownSessionRow(viewer, rowId);
  if (!row) return notFound();
  // A recording ends with its take over (see the header), before the hand
  // back and outside the browser's lock, which its last drain takes itself.
  let ending: { skillId: string; kept: boolean; steps: number } | null = null;
  const recording = row.status === "handed_over" && (Boolean(row.recordingSkillId) || Boolean(liveBrowser(row.id)?.recording));
  if (recording) {
    const { endRecordingOf } = await import("@/lib/skills/recorder");
    ending = await endRecordingOf(row.id, { keep: finished, reason: "done", drain: true });
  }
  const now = new Date();
  // Where the revoke goes (see the header): read like a release, never BROWSER_OFFERED.
  const rc = browserReleaseConfig();
  const handBack = async (lb: LiveBrowser | null): Promise<boolean> => {
    const back = await prisma.teammateBrowserSession.updateMany({
      where: { id: row.id, status: "handed_over" },
      data: { status: "live", handedOverAt: null, lastActiveAt: now },
    });
    if (back.count !== 1) return false;
    // A step the teammate asked for still waits (the person took over from the
    // browser card meanwhile, step 3): the session waits on it again, from
    // when it was asked, so the idle sweep never closes it under its card and
    // the waiting window stays the card's own.
    const pending = await waitingCardOf(row.id, row.chatSessionId).catch(() => null);
    if (pending) {
      await prisma.teammateBrowserSession.updateMany({ where: { id: row.id, status: "live" }, data: { status: "waiting", waitingSince: pending.createdAt } });
    }
    // Handed back, so from here a live view is minted to watch; every control
    // view is closed before the flag clears and the lock goes (see the header).
    // A failure never fails Done.
    if (rc && row.providerSessionId) {
      try {
        await revokeLiveViews(rc, row.providerSessionId, { timeoutMs: REVOKE_WAIT_MS });
      } catch {
        // Read as failed: the control token still dies at its own 15 minutes.
      }
    }
    if (lb) {
      // Under the lock (see the header): the notes of the person's own steps go, then the flag.
      takeEvents(lb);
      lb.handedOver = false;
    }
    return true;
  };
  // A browser this process no longer holds has nothing to empty: its next call ends it "restarted".
  const out = await withBrowserLock(row.id, TAKE_OVER_WAIT_MS, (lb) => handBack(lb));
  if (typeof out === "object" && "busy" in out) return { ok: false, status: 409, code: "busy", error: BROWSER_ROUTE_ERRORS.busy };
  const back = typeof out === "boolean" ? out : await handBack(null);
  if (!back) return { ok: false, status: 409, code: "not_handed_over", error: BROWSER_ROUTE_ERRORS.notHandedOver };
  // Its idle or waiting window holds from now, in this process (review round 1 of Phase 4).
  await armWindowsFromRow(row.id);

  const user = await prisma.user.findUnique({ where: { id: viewer.userId }, select: { firstName: true, lastName: true, email: true } }).catch(() => null);
  const first = (user?.firstName ?? "").trim() || personName(user) || "The person";
  const card = await prisma.agentAction.findFirst({
    where: { actingForId: viewer.userId, toolName: { in: ["ask_to_take_over", "ask_to_show_me"] }, status: "RUNNING", input: { path: ["browserSessionId"], equals: row.id } },
    select: { id: true, sessionId: true, agentId: true, toolName: true },
  });
  let moved = false;
  if (card) {
    // A request to be shown how is done only when the person's steps were
    // kept as a draft: by this Done, or, when the switch stopped the
    // recording before it, by that stop (never a step, only { done, note }).
    const showMe = card.toolName === "ask_to_show_me";
    const shown = showMe && finished && (ending ? ending.kept : await draftFrom(row.id));
    const done = showMe ? shown : finished;
    const result = showMe
      ? { text: done ? RECORDING_COPY.showMeDoneText : RECORDING_COPY.showMeStoppedText, data: { done, note: done ? BROWSER_COPY.showMeDoneNote(first) : BROWSER_COPY.showMeStoppedNote(first) } }
      : {
          text: finished ? BROWSER_COPY.takeOverDoneText : BROWSER_COPY.takeOverStoppedText,
          data: { done: finished, note: finished ? BROWSER_COPY.takeOverDoneNote(first) : BROWSER_COPY.takeOverStoppedNote(first) },
        };
    const swap = await prisma.agentAction.updateMany({ where: { id: card.id, status: "RUNNING" }, data: { status: "EXECUTED", result, executedAt: now } });
    moved = swap.count === 1;
    if (moved) {
      await writeEventLine(card.sessionId, { text: result.text, event: "action_approved", actionId: card.id, agentId: card.agentId });
    }
  }
  await recordStep(row.id, viewer.userId, { kind: "give_back", site: row.currentSite, outcome: "ok", actionId: card?.id ?? null, code: ending ? "recording" : null });
  // A recording's end wrote its own row (recorder.ts endRecordingOf), which stands for this one.
  if (!ending) {
    await logActivity({
      type: "teammate_browser.take_over",
      actorId: viewer.userId,
      actingForId: row.userId,
      organizationId: viewer.organizationId,
      description: BROWSER_AUDIT_COPY.takeOverEnded(finished),
      targetId: row.agentId,
      targetType: "agent",
      metadata: { browserSessionId: row.id, agentId: row.agentId, site: row.currentSite, phase: "end", finished, actionId: card?.id ?? null },
      severity: "info",
    });
  }

  let chat: ResumeChat | null = null;
  if (moved) {
    const agent = await prisma.agent.findUnique({ where: { id: row.agentId }, select: { slug: true } }).catch(() => null);
    if (agent) {
      chat = { kind: "teammate", slug: agent.slug };
      // Nothing is left to decide on the card's Inbox row.
      await prisma.notification.updateMany({ where: { userId: viewer.userId, link: actionHref(agent.slug, card!.id), read: false }, data: { read: true } }).catch(() => undefined);
    }
  }
  publishToUser(viewer.userId, { type: "agent.changed", agentId: row.agentId, browserSessionId: row.id });
  const view = await sessionViewFor(viewer, row.id);
  if (!view) return notFound();
  return { ok: true, view, resume: moved && chat !== null, chat, recorded: ending && ending.kept ? { skillId: ending.skillId, steps: ending.steps } : null };
}

/** Whether a recording in this session was kept as a draft (an earlier stop finished it, Phase 5 step 2). A read that fails says no. */
async function draftFrom(rowId: string): Promise<boolean> {
  const draft = await prisma.teammateSkill.findFirst({ where: { recordingSessionId: rowId, status: { in: ["draft", "ready"] } }, select: { id: true } }).catch(() => null);
  return draft !== null;
}
