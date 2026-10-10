// The rules every Google connector call is held to, as the executor, the
// approval queue, the previews and the tools read them
// (docs/plans/ai-teammates-phase3.md step 3). Pure: the copy file and the
// name lists, nothing that reads a database or Google.
//
// EVERY REFUSAL NAMES ITS REAL REASON. A connector tool missing from a turn's
// set says why (the turn is a Talk answer, the person did not allow this
// teammate, the connection needs reconnecting), never only "This teammate
// can't use that tool"; a failed Google call says what Google answered, in
// the person's words, and never repeats anything Google sent.
//
// WHAT IS KEPT (Decision 16). A read's call record, in the chat's call log
// and the run's output, keeps how many it found and whether it was cut, and
// nothing it found: no subject, snippet, body, title or id. The model read
// the whole answer once, inside <tool_data>; the person reads the teammate's
// answer. An audit row names the Google id and how many people a write
// reached, never a subject or an address.
//
// THE LIMITS (Decision 22). Per answer: 12 connector calls, and per tool its
// own count, every calendar write sharing one; per person, 30 a minute across
// answers (the executor's rateLimit).

import type { ConnectorRefusal } from "@/lib/connectors/connections";
import type { GoogleFailure } from "@/lib/connectors/google/http";
import { CONNECTOR_LIMITS as L, CONNECTOR_PRODUCTS, TOOL_PRODUCT, type ConnectorProduct } from "@/lib/connectors/products";
import { CONNECTIONS_COPY, CONNECTOR_COPY, CONNECTOR_TITLES, PRINT_FIELD_WORDS, titleList } from "./teammate-copy";
import { PRINT_FIELDS, type PrintField } from "./teammate-print";
import type { ConnectorToolName } from "./tool-names";

/** A product as the person reads it: "Gmail", "Google Calendar". */
export function productWord(p: ConnectorProduct): string {
  return p === "gmail" ? CONNECTIONS_COPY.gmail : CONNECTIONS_COPY.calendar;
}

/** Why a teammate may not use this product of the person's Google now, as the sentence the model and the tool row read. */
export function connectorRefusalSentence(r: { reason: ConnectorRefusal; changed?: readonly PrintField[] }, agentName: string, product: ConnectorProduct): string {
  const p = productWord(product);
  switch (r.reason) {
    case "not_configured":
      return CONNECTOR_COPY.notConfigured;
    case "workspace_closed":
      return CONNECTOR_COPY.workspaceClosed;
    case "workspace_off":
      return CONNECTOR_COPY.workspaceOff(p);
    case "not_connected":
      return CONNECTOR_COPY.notConnected;
    case "needs_reconnect":
      return CONNECTOR_COPY.needsReconnect;
    case "not_granted":
      return CONNECTOR_COPY.notGranted(p);
    case "not_allowed":
      return CONNECTOR_COPY.notAllowed(agentName, p);
    case "teammate_changed": {
      // No part named: nothing can be said to be unchanged, so every part is.
      const parts = r.changed && r.changed.length > 0 ? r.changed : PRINT_FIELDS;
      return CONNECTOR_COPY.teammateChanged(agentName, titleList(parts.map((f) => PRINT_FIELD_WORDS[f] ?? f), 6));
    }
  }
}

/** Where a turn's answer goes when it is not the person's alone (Decision 13). */
export type NotHereKind = "talk" | "automation" | "delegated";

/** The turns that never use Google: their answer posts, flows on, or goes back to another teammate. */
export function notHereKindOf(trigger: string): NotHereKind | null {
  if (trigger === "TALK") return "talk";
  if (trigger === "AUTOMATION") return "automation";
  if (trigger === "DELEGATED") return "delegated";
  return null;
}

/**
 * Why a Google call is refused where the answer is not the person's alone,
 * naming only `products`: the ones the teammate holds tools for that are on
 * here (review of step 5), as block 2 names them (engine.ts
 * connectorNotHereLine), so a teammate with Gmail tools alone is never said to
 * have a calendar. None given names both, as block 2's line does.
 */
export function notHereSentence(kind: NotHereKind, products: readonly ConnectorProduct[] = CONNECTOR_PRODUCTS): string {
  const named = CONNECTOR_PRODUCTS.filter((p) => products.includes(p));
  const p = (named.length > 0 ? named : CONNECTOR_PRODUCTS).map(productWord).join(" and ");
  return kind === "talk" ? CONNECTOR_COPY.notHereTalk(p) : kind === "automation" ? CONNECTOR_COPY.notHereAutomation(p) : CONNECTOR_COPY.notHereDelegated(p);
}

/** Whether a turn started this way may use Google at all: the person's own chats and continues, and their routines (Decision 13). */
export function connectorTrigger(trigger: string): boolean {
  return trigger === "CHAT" || trigger === "RESUME" || trigger === "ROUTINE";
}

/** The calendar's writes: an etag rides on each, and Google's answer to one is its own (step 4). */
const CALENDAR_WRITES: ReadonlySet<ConnectorToolName> = new Set<ConnectorToolName>(["create_event", "update_event", "cancel_event", "respond_to_invite"]);

/**
 * A failed Google call, in the person's words. `notFound` is the tool's own
 * (an email, a conversation, an event); an unknown outcome is only ever a
 * write's, and says to check before asking again (Decision 24). `tool` names
 * the call, so a write's sentence is its own (review of step 3): a draft
 * Google did not confirm is checked in Drafts, never in Sent, a calendar
 * change in the calendar, and an email Gmail refused never reads as a search
 * to reword. A calendar write's 412 is the event changed since its card
 * (Decisions 12 and 15).
 */
export function googleFailureSentence(
  f: { failure: GoogleFailure; retryAfter?: number },
  o: { product: ConnectorProduct; notFound: string; tool?: ConnectorToolName },
): string {
  const draft = o.tool === "draft_email";
  const email = o.tool === "send_email" || o.tool === "reply_email";
  const event = o.tool !== undefined && CALENDAR_WRITES.has(o.tool);
  switch (f.failure) {
    case "not_connected":
      return CONNECTOR_COPY.notConnected;
    case "needs_reconnect":
      return CONNECTOR_COPY.needsReconnect;
    case "scope_missing":
      return CONNECTOR_COPY.notGranted(productWord(o.product));
    case "not_found":
      return o.notFound;
    case "rate_limited":
      return CONNECTOR_COPY.googleBusy(Math.max(1, Math.round(f.retryAfter ?? 30)));
    case "unavailable":
      return CONNECTOR_COPY.googleUnavailable;
    case "client":
      return CONNECTOR_COPY.clientBroken;
    case "bad_request":
      return draft ? CONNECTOR_COPY.googleRejectedDraft : email ? CONNECTOR_COPY.googleRejectedEmail : event ? CONNECTOR_COPY.googleRejectedEvent : CONNECTOR_COPY.googleBadRequest;
    case "unknown_outcome":
      return draft ? CONNECTOR_COPY.unknownOutcomeDraft : event ? CONNECTOR_COPY.unknownOutcomeCalendar : CONNECTOR_COPY.unknownOutcomeEmail;
    case "changed":
      return event ? CONNECTOR_COPY.eventChanged : CONNECTOR_COPY.googleRefused;
    case "forbidden":
      return CONNECTOR_COPY.googleRefused;
  }
}

/**
 * Why an approval could not run a Google card yet, with nothing sent: it
 * stays PENDING and can be approved again (review of step 3).
 *   connection_needed  the person connects, reconnects or adds the product first
 *   retry_later        Google, or WorkwrK's own link to it, is not answering now
 *   agent_paused       the teammate was paused or removed between the approval's
 *                      own check and its Google call (review of step 4): the
 *                      card waits, as a paused teammate's card always does
 */
export type HeldCode = "connection_needed" | "retry_later" | "agent_paused";

export function isHeldCode(v: unknown): v is HeldCode {
  return v === "connection_needed" || v === "retry_later" || v === "agent_paused";
}

/**
 * A failed Google call that happened before anything was sent, as the code
 * its card waits with; null for one that ends the card (a write whose outcome
 * is unknown, a request Google refused as written, something gone).
 */
export function heldForFailure(failure: GoogleFailure): HeldCode | null {
  if (failure === "not_connected" || failure === "needs_reconnect" || failure === "scope_missing") return "connection_needed";
  if (failure === "unavailable" || failure === "rate_limited" || failure === "client") return "retry_later";
  return null;
}

/**
 * The person's connection refusing a card at its approval: a connection to
 * make or mend waits, and so does a teammate paused or removed meanwhile
 * (review of step 4: before, the card FAILED for good though nothing was
 * sent); any other reason ends it.
 */
export function heldForRefusal(reason: ConnectorRefusal | "teammate_off"): HeldCode | null {
  if (reason === "teammate_off") return "agent_paused";
  return reason === "not_connected" || reason === "needs_reconnect" || reason === "not_granted" ? "connection_needed" : null;
}

/**
 * A Google write as the model and the history name it (CONNECTOR_TITLES):
 * never the card's own title, which can quote a subject from someone else's
 * email (review of step 3).
 */
export function connectorTitle(tool: ConnectorToolName): string {
  return CONNECTOR_TITLES[tool] ?? CONNECTOR_COPY.googleAction;
}

function rec(v: unknown): Record<string, unknown> {
  return v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : {};
}

/**
 * What the call log keeps of a connector read that worked (Decision 16): how
 * many, and that the answer was cut. Never what it found.
 */
export function connectorStored(result: unknown): { count: number; partial?: true } {
  const r = rec(result);
  const count = typeof r.count === "number" && Number.isFinite(r.count) ? Math.max(0, Math.floor(r.count)) : 0;
  return r.partial === true ? { count, partial: true } : { count };
}

/**
 * A connector write's audit facts (Decision 16): the product, the id Google
 * gave what was made, and how many people it reached. No subject, no address,
 * no title. A calendar change or cancel reached the people Google told
 * (its preparation's `notify`); a new event, the people it invited.
 */
export function connectorAuditFacts(tool: ConnectorToolName, input: Record<string, unknown> | null, result: unknown): Record<string, unknown> {
  const r = rec(result);
  const id = [rec(r.email).id, rec(r.draft).id, rec(r.event).id].find((v): v is string => typeof v === "string" && v.length > 0) ?? null;
  const many = (v: unknown) => (Array.isArray(v) ? v.length : 0);
  const i = input ?? {};
  const email = tool === "draft_email" || tool === "send_email" || tool === "reply_email";
  const told = typeof i.notify === "number" && Number.isFinite(i.notify) ? Math.max(0, Math.floor(i.notify)) : null;
  return {
    provider: "google",
    product: TOOL_PRODUCT[tool],
    googleId: id,
    ...(email ? { recipients: many(i.to) + many(i.cc) } : {}),
    ...(told !== null ? { attendees: told } : Array.isArray(i.attendees) ? { attendees: many(i.attendees) } : {}),
  };
}

/** One answer's connector counts (Decision 22): every call, and each tool's own. */
export interface ConnectorCounters {
  calls: number;
  searches: number;
  threads: number;
  eventReads: number;
  freeTime: number;
  drafts: number;
  sends: number;
  calendarWrites: number;
}

export function emptyConnectorCounters(): ConnectorCounters {
  return { calls: 0, searches: 0, threads: 0, eventReads: 0, freeTime: 0, drafts: 0, sends: 0, calendarWrites: 0 };
}

/**
 * Each connector tool's own count per answer, and what passing it says.
 * Typed by the name list, so a tool with no count of its own is a compile
 * error. The four calendar writes share one count: five changes to the
 * person's calendar an answer, whichever kind (step 4).
 */
export const CONNECTOR_TURN_LIMITS: Readonly<Record<ConnectorToolName, { key: keyof ConnectorCounters; max: number; sentence: string }>> = {
  search_email: { key: "searches", max: L.searchesPerTurn, sentence: CONNECTOR_COPY.tooManySearches },
  read_email: { key: "threads", max: L.threadsPerTurn, sentence: CONNECTOR_COPY.tooManyThreads },
  draft_email: { key: "drafts", max: L.draftsPerTurn, sentence: CONNECTOR_COPY.tooManyDrafts },
  send_email: { key: "sends", max: L.sendsPerTurn, sentence: CONNECTOR_COPY.tooManySends },
  reply_email: { key: "sends", max: L.sendsPerTurn, sentence: CONNECTOR_COPY.tooManySends },
  list_events: { key: "eventReads", max: L.eventReadsPerTurn, sentence: CONNECTOR_COPY.tooManyEventReads },
  find_free_time: { key: "freeTime", max: L.freeTimePerTurn, sentence: CONNECTOR_COPY.tooManyFreeTime },
  create_event: { key: "calendarWrites", max: L.calendarWritesPerTurn, sentence: CONNECTOR_COPY.tooManyCalendarWrites },
  update_event: { key: "calendarWrites", max: L.calendarWritesPerTurn, sentence: CONNECTOR_COPY.tooManyCalendarWrites },
  cancel_event: { key: "calendarWrites", max: L.calendarWritesPerTurn, sentence: CONNECTOR_COPY.tooManyCalendarWrites },
  respond_to_invite: { key: "calendarWrites", max: L.calendarWritesPerTurn, sentence: CONNECTOR_COPY.tooManyCalendarWrites },
};
