// What a browser step would do, decided by the server before it is asked and
// again at its approval (docs/plans/ai-teammates-phase4.md step 3; previews.ts
// prepareCall calls prepareBrowser for click, type_text, select_option and
// ask_to_take_over). The reads never reach here: they run at once.
//
// THE CARD IS WHAT RUNS (Decision 14). The first preparation, in the
// person's own chat or its continue, reads the person and the teammate now,
// whether the computer may be used, and the person's session for this
// teammate; then, under the browser's lock: no other step of the session
// waiting (Decision 13), the session's steps not used up, the element's id
// from the newest read of this very page, the page's site allowed, the
// control found again in a fresh read by its fingerprint, never a password,
// code, card or bank field (Decision 18), and a picture around it for the
// card (Decision 16: the person's only). What it stores (browser-rules.ts
// BrowserCardInput) is what the card shows and what runs: the session, the
// page's address, the element's fingerprint, the words to type or the
// option, and the picture.
//
// AT ITS APPROVAL the stored input is kept: the person and the teammate are
// read again, the computer's access, the card's own session (theirs, this
// teammate's, live and in this process), the site of its page with the
// lists as they are now, and an edited text cleaned again. The document the
// card was asked on, the element's twins and anchor (review of Phase 4 step
// 3) are checked by the handler, under the lock. The element
// itself is checked by the handler, under the browser's lock, on the page as
// it is then. The person holding the browser leaves the card waiting
// (browser_busy), as a browser still starting does (retry_later).
//
// A take over request (ask_to_take_over) is prepared the same way and never
// approved: Take over on its card decides it (src/lib/browser/take-over.ts).
//
// UNDER THE LOCK THE SESSION IS READ AGAIN FIRST (review round 1 of Phase 4,
// browser-tools.ts recheckUnderLock): a take over or an end that landed
// while the preparation waited refuses it, by its real reason, before the
// page is read or pictured.
//
// Server-only: reads prisma and drives the browser.

import { computerAgentById } from "./browser-access";
import { browserCard, browserRefusalSentence, isTakeOverReason, storedCardInput, type BrowserCardInput } from "./browser-rules";
import { BROWSER_INPUT, badInput, closedSentence, goneAnswer, recheckUnderLock, rulesForCall } from "./browser-tools";
import type { HeldCode } from "./connector-rules";
import type { Found, PrepareContext } from "./previews";
import { BROWSER_COPY, TEAMMATE_TOOL_ERRORS as ERR } from "./teammate-copy";
import type { BrowserToolName } from "./tool-names";
import { withBrowserLock } from "@/lib/browser/live";
import { cleanTyped, prepareStepOn, prepareTakeOverOn } from "@/lib/browser/page-calls";
// Not a React hook, whatever its name says: the session a call may use now.
import { computerAccess, stepsUsedUp, useBrowserSession as browserSessionFor, waitingCardOf } from "@/lib/browser/sessions";
import { saveShot } from "@/lib/browser/shots";
import { siteVerdict } from "@/lib/browser/sites";

type Refused = { error: string; held?: HeldCode; readWeb?: true };

/** How long a preparation waits for a step in flight on the same browser. */
const PREPARE_LOCK_WAIT_MS = 20_000;

const CARD_TOOLS = ["click", "type_text", "select_option", "ask_to_take_over"] as const;
type CardTool = (typeof CARD_TOOLS)[number];

function isCardTool(t: string): t is CardTool {
  return (CARD_TOOLS as readonly string[]).includes(t);
}

/**
 * Prepare one browser card (see the file header). A refusal says why in the
 * person's words; at an approval, `held` when nothing was sent and the card
 * can wait. `readWeb`: the preparation read the page, so the turn asks
 * before every later write (Decision 15).
 */
export async function prepareBrowser(tool: BrowserToolName, raw: Record<string, unknown>, ctx: PrepareContext): Promise<(Found & { readWeb?: true }) | Refused> {
  if (!isCardTool(tool)) return { error: ERR.notAllowed };
  const approval = ctx.teammate.trigger === "APPROVAL";
  const person = ctx.person;
  const first = person.firstName;
  const agent = await computerAgentById(person.organizationId, ctx.teammate.agentId);
  // Paused or removed since the approval's own check: the card waits, as a paused teammate's does.
  if (!agent || !agent.browserTools) return approval ? { error: BROWSER_COPY.teammateOff, held: "agent_paused" } : { error: BROWSER_COPY.teammateOff };
  const access = await computerAccess({ organizationId: person.organizationId, agent });
  if (!access.ok) return { error: browserRefusalSentence(access.reason, agent.name, first) };

  if (approval) {
    if (tool === "ask_to_take_over") return { error: BROWSER_COPY.useTakeOver };
    const stored = storedCardInput(tool, raw);
    if (!stored) return { error: ERR.notAllowed };
    const use = await browserSessionFor({ person, agentId: agent.id, browserSessionId: stored.browserSessionId, runId: null, purpose: "approval" });
    if (!use.ok) {
      if (use.reason === "person_has_it") return { error: BROWSER_COPY.personHasIt(first), held: "browser_busy" };
      if (use.reason === "busy") return { error: BROWSER_COPY.starting, held: "retry_later" };
      if (use.reason === "ended") return { error: closedSentence(use.endReason, use.minutes) };
      return { error: browserRefusalSentence(use.reason, agent.name, first, { minutes: use.minutes }) };
    }
    // The lists as they are now: a site taken away since the card was asked runs nothing.
    if (!siteVerdict(stored.pageUrl, access.rules).ok) return { error: BROWSER_COPY.siteNowNotAllowed(stored.site) };
    const input: BrowserCardInput = { ...stored };
    if (tool === "type_text") {
      const text = cleanTyped(stored.text);
      if (!text.trim()) return { error: BROWSER_COPY.emptyText };
      input.text = text;
    }
    return { input: { ...input }, risk: "IRREVERSIBLE", preview: browserCard(tool, input), targetKey: null };
  }

  // The first preparation: the model's input, read by the tool's own schema.
  const parsed = BROWSER_INPUT[tool].safeParse(raw);
  if (!parsed.success) return badInput(parsed.error);
  const asked = parsed.data as { element?: string; text?: string; pressEnter?: boolean; option?: string; reason?: string };
  const runId = ctx.turn?.runId ?? null;
  const use = await browserSessionFor({ person, agentId: agent.id, runId, purpose: "model" });
  if (!use.ok) {
    if (use.reason === "ended") return { error: closedSentence(use.endReason, use.minutes) };
    return { error: browserRefusalSentence(use.reason, agent.name, first, { otherName: use.otherName, minutes: use.minutes }) };
  }
  const row = use.row;

  const out = await withBrowserLock(row.id, PREPARE_LOCK_WAIT_MS, async (lb) => {
    // Read again under the lock (see the file header): nothing is read or pictured while the person has it.
    const moved = await recheckUnderLock(lb, row.id, { approval: false, runId, first });
    if (moved) return { error: moved.error } as Refused;
    // This call's rules (carried from step 2): read fresh, obeyed by the guard
    // from now on, never over newer ones a refresh installed (review of Phase
    // 4 step 3, browser-tools.ts rulesForCall).
    const ruled = await rulesForCall(lb, access, first);
    if (!ruled.ok) return { error: ruled.error } as Refused;
    if (await waitingCardOf(row.id, row.chatSessionId)) return { error: BROWSER_COPY.oneStepWaits(first) } as Refused;
    if (await stepsUsedUp(row.id)) return { error: BROWSER_COPY.tooManySteps } as Refused;
    if (tool === "ask_to_take_over") {
      const reason = isTakeOverReason(asked.reason) ? asked.reason : "other";
      const t = prepareTakeOverOn(lb, reason);
      if (!t.ok) return { error: t.error } as Refused;
      return { facts: t.facts, picture: null };
    }
    const s = await prepareStepOn(lb, tool, { element: String(asked.element ?? ""), text: asked.text, pressEnter: asked.pressEnter, option: asked.option }, first);
    if (!s.ok) return { error: s.error } as Refused;
    return { facts: s.facts, picture: s.picture };
  });
  if ("busy" in out) return { error: BROWSER_COPY.busyNow };
  if ("gone" in out) {
    // This process no longer holds its guard: ended, never reattached
    // (Decision 7), unless an end landed while it waited, which says its own
    // reason (review round 1 of Phase 4).
    return { error: (await goneAnswer(row.id)).error };
  }
  if ("error" in out) return out;

  const shotId = out.picture ? await saveShot({ row: { id: row.id, organizationId: row.organizationId, userId: row.userId }, kind: "element", jpeg: out.picture.jpeg, width: out.picture.width, height: out.picture.height }) : null;
  const input: BrowserCardInput = {
    browserSessionId: row.id,
    ...out.facts,
    shotId,
    shot: shotId && out.picture ? { width: Math.max(1, Math.min(4000, Math.round(out.picture.width))), height: Math.max(1, Math.min(4000, Math.round(out.picture.height))) } : null,
  };
  return { input: { ...input }, risk: "IRREVERSIBLE", preview: browserCard(tool, input), targetKey: null, readWeb: true };
}
