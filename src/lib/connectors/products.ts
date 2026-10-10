// The Google products a person may connect to their AI teammates
// (docs/plans/ai-teammates-phase3.md), what each one asks Google for, and the
// limits every connector call is held to. Pure and client safe, so the
// connect routes, the tools, the picker and the tests read one list.
//
// SCOPES ARE THE NARROWEST THAT DO THE JOB, asked per product (Decision 3):
// Calendar alone never asks for Gmail, and nothing can delete or relabel mail
// or change calendar settings. If Google's consent screen lists a scope by
// another name, PRODUCT_SCOPES is the one place to change.
//
// A PRODUCT COUNTS ONLY WHEN GOOGLE GRANTED EVERY ONE OF ITS SCOPES
// (Decision 4): granular consent lets people untick boxes, and a product with
// a box unticked is reported as not connected, never half used.

import type { ConnectorToolName } from "@/lib/agents/tool-names";

export const CONNECTOR_PROVIDERS = ["google"] as const;
export type ConnectorProvider = (typeof CONNECTOR_PROVIDERS)[number];

export const CONNECTOR_PRODUCTS = ["gmail", "calendar"] as const;
export type ConnectorProduct = (typeof CONNECTOR_PRODUCTS)[number];

/** Which products are on, by product: a workspace's switch, a connection's grant, a turn's offer. */
export type ProductSet = Readonly<Record<ConnectorProduct, boolean>>;

/** Nothing on: what a turn is offered until the workspace turns a product on. */
export const NO_PRODUCTS: ProductSet = Object.freeze({ gmail: false, calendar: false });

/** The product each connector tool uses. Typed by the name list, so a new tool with no product is a compile error. */
export const TOOL_PRODUCT: Readonly<Record<ConnectorToolName, ConnectorProduct>> = {
  search_email: "gmail",
  read_email: "gmail",
  draft_email: "gmail",
  send_email: "gmail",
  reply_email: "gmail",
  list_events: "calendar",
  find_free_time: "calendar",
  create_event: "calendar",
  update_event: "calendar",
  cancel_event: "calendar",
  respond_to_invite: "calendar",
};

/** The product a tool uses, or null for a tool that is no connector tool. Read as an own key only. */
export function productOfTool(name: string): ConnectorProduct | null {
  return Object.prototype.hasOwnProperty.call(TOOL_PRODUCT, name) ? TOOL_PRODUCT[name as ConnectorToolName] : null;
}

/** Asked on every connect: the account's OpenID "sub" and its address. */
export const GOOGLE_BASE_SCOPES = ["openid", "email"] as const;

export const PRODUCT_SCOPES: Readonly<Record<ConnectorProduct, readonly string[]>> = {
  gmail: ["https://www.googleapis.com/auth/gmail.readonly", "https://www.googleapis.com/auth/gmail.compose"],
  calendar: ["https://www.googleapis.com/auth/calendar.events", "https://www.googleapis.com/auth/calendar.freebusy"],
};

function isProduct(v: unknown): v is ConnectorProduct {
  return typeof v === "string" && (CONNECTOR_PRODUCTS as readonly string[]).includes(v);
}

/** The scopes one connect asks for: the base ones and each listed product's, each once, and never a product that is not listed. */
export function scopesFor(products: readonly ConnectorProduct[]): string[] {
  const wanted = new Set<string>(products.filter(isProduct));
  const out = new Set<string>(GOOGLE_BASE_SCOPES);
  for (const p of CONNECTOR_PRODUCTS) if (wanted.has(p)) for (const s of PRODUCT_SCOPES[p]) out.add(s);
  return [...out];
}

/**
 * The products Google actually granted, from its space-separated `scope`
 * answer: a product counts only when every one of its scopes is there. A
 * scope this file does not know is ignored.
 */
export function productsGranted(scope: string): ConnectorProduct[] {
  const granted = new Set(String(scope ?? "").split(/\s+/).filter(Boolean));
  return CONNECTOR_PRODUCTS.filter((p) => PRODUCT_SCOPES[p].every((s) => granted.has(s)));
}

/**
 * Product names from a comma string (an environment value, a query string)
 * or a list: the known ones only, each once, in CONNECTOR_PRODUCTS order.
 * Anything else reads as none.
 */
export function parseProducts(raw: unknown): ConnectorProduct[] {
  const items = typeof raw === "string" ? raw.split(",") : Array.isArray(raw) ? raw : [];
  const named = new Set(items.filter((x): x is string => typeof x === "string").map((x) => x.trim().toLowerCase()));
  return CONNECTOR_PRODUCTS.filter((p) => named.has(p));
}

/** A stored list (a policy row, a connection, a person's allow) as a set; unknown names are dropped. */
export function productSet(list: readonly string[] | null | undefined): ProductSet {
  const on = new Set(Array.isArray(list) ? list : []);
  return { gmail: on.has("gmail"), calendar: on.has("calendar") };
}

/**
 * What one answer, one person and one result may hold (Decisions 17 and 22).
 * Per turn: calls, searches, threads, event reads, free-time searches,
 * drafts, sends and calendar writes. Per person: calls a minute across turns.
 * Then how much of a mailbox or a calendar reaches the model, and how much a
 * write may carry.
 */
export const CONNECTOR_LIMITS = {
  callsPerTurn: 12,
  perPersonPerMinute: 30,
  searchesPerTurn: 4,
  searchDefault: 10,
  searchMax: 20,
  snippetChars: 200,
  queryMax: 300,
  threadsPerTurn: 5,
  messagesPerThread: 10,
  bodyChars: 4000,
  threadChars: 20_000,
  eventReadsPerTurn: 4,
  eventsMax: 50,
  listWindowDays: 31,
  descriptionChars: 500,
  freeTimePerTurn: 3,
  freeWindowDays: 14,
  freeOthersMax: 5,
  freeSlotsMax: 10,
  draftsPerTurn: 5,
  sendsPerTurn: 5,
  calendarWritesPerTurn: 5,
  recipientsMax: 20,
  attendeesMax: 20,
  subjectMax: 200,
  bodyMax: 8000,
  titleMax: 200,
} as const;

/** Reads whose results are other people's words: a turn that ran one asks before every write (Decision 9). */
export const TAINTING_TOOLS: ReadonlySet<ConnectorToolName> = new Set<ConnectorToolName>(["search_email", "read_email", "list_events"]);

/**
 * A Google Calendar event id, as Google forms one (review round 1 of Phase
 * 3): base32hex letters and digits (lower case), with Google's underscores
 * (a leading one, and before a repeating event's instance suffix, a day
 * "_20261013" or a moment "_20261013T100000Z"). A hyphen is let through too,
 * since the test stand-in names its events with one (scripts/google-stand-in.mjs);
 * it can never form a path segment of its own. Never a dot: an id of "." or
 * ".." is a path segment fetch resolves, so an id the model wrote from a
 * planted email could reach another Google address, and a 403 there marked
 * the person's whole connection broken. At most 1024 characters.
 *
 * A SPLIT SERIES TOO (review round 2 of Phase 3). Editing "this and
 * following events" of a repeating event gives the new series an id with
 * "_R" and the moment it starts ("<base>_R20261013T150000"), and its single
 * times that id with their own suffix; list_events hands those back, and
 * refusing them made the teammate unable to change an event it had just
 * listed. The segment is held to its exact shape, still with no dot.
 *
 * AN ALL-DAY SPLIT TOO (review round 3 of Phase 3). The instance suffix
 * already comes as a day alone for an all-day event; a split of an all-day
 * series names its start as a day alone the same way ("<base>_R20261013"),
 * and a moment may end in a Z. Both are taken, so the teammate can change,
 * cancel or answer an all-day event it just listed. Still no dot, and an R
 * segment is still only digits in Google's two shapes.
 */
export const EVENT_ID_PATTERN = /^[a-z0-9_-]+(?:_R\d{8}(?:T\d{6}Z?)?)?(?:_\d{8}(?:T\d{6}Z)?)?$/;

/** Whether a text is an event id Google could have given (EVENT_ID_PATTERN), checked before any URL is built. */
export function isEventId(id: unknown): id is string {
  return typeof id === "string" && id.length <= 1024 && EVENT_ID_PATTERN.test(id);
}
