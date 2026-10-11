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
//
// Server-only: imports prisma.

import type { Viewer } from "@/lib/access/types";
import { logActivity } from "@/lib/activity";
import { actionHref, writeEventLine, type ResumeChat } from "@/lib/agents/actions";
import { BROWSER_AUDIT_COPY, BROWSER_COPY, BROWSER_ROUTE_ERRORS, BROWSER_PANEL_COPY } from "@/lib/agents/teammate-copy";
import { prisma } from "@/lib/prisma";
import { publishToUser } from "@/lib/realtime-bus";
import { liveViewUrl } from "./browserbase";
import { browserConfig } from "./config";
import { withBrowserLock } from "./live";
import { endBrowserSession, ownSessionRow, recordStep, sessionViewFor, SYSTEM_END, useBrowserSession } from "./sessions";
import type { BrowserSessionView } from "./views";

type Refusal = { ok: false; status: number; code: string; error: string };

const notFound = (): Refusal => ({ ok: false, status: 404, code: "not_found", error: BROWSER_ROUTE_ERRORS.notFound });
const ended = (): Refusal => ({ ok: false, status: 409, code: "ended", error: BROWSER_ROUTE_ERRORS.ended });

/** How long a take over waits for a step in flight to finish. */
const TAKE_OVER_WAIT_MS = 20_000;

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
  const cfg = browserConfig();
  if (!cfg) {
    // The computer is off on this WorkwrK now: nothing may drive the browser.
    await endBrowserSession(row.id, "turned_off", SYSTEM_END);
    return ended();
  }

  const out = await withBrowserLock(row.id, TAKE_OVER_WAIT_MS, async () => {
    const use = await useBrowserSession({ person: viewer, agentId: row.agentId, browserSessionId: row.id, runId: null, purpose: "take_over" });
    if (!use.ok) return use.reason === "busy" ? ({ ok: false, status: 409, code: "busy", error: BROWSER_ROUTE_ERRORS.busy } as Refusal) : ended();
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
    return { ok: true as const, row: use.row, at: now };
  });
  if ("busy" in out) return { ok: false, status: 409, code: "busy", error: BROWSER_ROUTE_ERRORS.busy };
  if ("gone" in out) {
    // The browser is not held here: its guard is gone.
    await endBrowserSession(row.id, "restarted", SYSTEM_END);
    return ended();
  }
  if (!out.ok) return out;

  await recordStep(row.id, viewer.userId, { kind: "take_over", site: row.currentSite, outcome: "ok", actionId });
  const agent = await prisma.agent.findUnique({ where: { id: row.agentId }, select: { name: true } }).catch(() => null);
  await logActivity({
    type: "teammate_browser.take_over",
    actorId: viewer.userId,
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
  const url = await liveViewUrl(cfg, row.providerSessionId);
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
): Promise<{ ok: true; view: BrowserSessionView; resume: boolean; chat: ResumeChat | null } | Refusal> {
  const row = await ownSessionRow(viewer, rowId);
  if (!row) return notFound();
  const now = new Date();
  const back = await prisma.teammateBrowserSession.updateMany({
    where: { id: row.id, status: "handed_over" },
    data: { status: "live", handedOverAt: null, lastActiveAt: now },
  });
  if (back.count !== 1) return { ok: false, status: 409, code: "not_handed_over", error: BROWSER_ROUTE_ERRORS.notHandedOver };

  const user = await prisma.user.findUnique({ where: { id: viewer.userId }, select: { firstName: true, lastName: true, email: true } }).catch(() => null);
  const first = (user?.firstName ?? "").trim() || personName(user) || "The person";
  const card = await prisma.agentAction.findFirst({
    where: { actingForId: viewer.userId, toolName: "ask_to_take_over", status: "RUNNING", input: { path: ["browserSessionId"], equals: row.id } },
    select: { id: true, sessionId: true, agentId: true },
  });
  let moved = false;
  if (card) {
    const result = {
      text: finished ? BROWSER_COPY.takeOverDoneText : BROWSER_COPY.takeOverStoppedText,
      data: { done: finished, note: finished ? BROWSER_COPY.takeOverDoneNote(first) : BROWSER_COPY.takeOverStoppedNote(first) },
    };
    const swap = await prisma.agentAction.updateMany({ where: { id: card.id, status: "RUNNING" }, data: { status: "EXECUTED", result, executedAt: now } });
    moved = swap.count === 1;
    if (moved) {
      await writeEventLine(card.sessionId, { text: result.text, event: "action_approved", actionId: card.id, agentId: card.agentId });
    }
  }
  await recordStep(row.id, viewer.userId, { kind: "give_back", site: row.currentSite, outcome: "ok", actionId: card?.id ?? null });
  await logActivity({
    type: "teammate_browser.take_over",
    actorId: viewer.userId,
    organizationId: viewer.organizationId,
    description: BROWSER_AUDIT_COPY.takeOverEnded(finished),
    targetId: row.agentId,
    targetType: "agent",
    metadata: { browserSessionId: row.id, agentId: row.agentId, site: row.currentSite, phase: "end", finished, actionId: card?.id ?? null },
    severity: "info",
  });

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
  return { ok: true, view, resume: moved && chat !== null, chat };
}
