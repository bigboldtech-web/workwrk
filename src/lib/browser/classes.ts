// What a page's fields and buttons are, as the cards and the guards read
// them (docs/plans/ai-teammates-phase4.md Decisions 12, 18 and 22), and the
// computer's limits: per answer, per page read, per session.
//
// SENSITIVE FIELDS (Decision 18). A teammate never types into, or chooses
// in, a password, a one-time code, a card number, a card code, a card
// expiry or a bank account field: it asks the person to take over. A field
// is read as sensitive by its type, its autocomplete tokens, and its name,
// id and label, toward the safer side: a password field shown as text, a
// code field without inputmode, an expiry chosen from a list. Only fields
// are classed: a button whose words say "Verify code" is a button.
//
// CLICK WARNINGS are the card's extra lines (step 3), whole words of the
// element's own name and facts of the page. A click always waits on its own
// card whatever they say; they only say why to look twice.
//
// Pure: no imports but types.

import type { BrowserToolName } from "@/lib/agents/tool-names";
import type { ElementFingerprint, FieldKind } from "./types";

/** The input types that take no typing: their kind is what they are, never a sensitive class. */
const NON_TEXT_TYPES: Readonly<Record<string, FieldKind>> = {
  checkbox: "checkbox",
  radio: "radio",
  file: "file",
  submit: "none",
  button: "none",
  reset: "none",
  image: "none",
  hidden: "none",
  range: "none",
  color: "none",
};

/** The input types read as they are; anything else that takes text is "text". */
const TEXT_TYPES: Readonly<Record<string, FieldKind>> = {
  email: "email",
  search: "search",
  number: "number",
  tel: "tel",
  url: "url",
  date: "date",
  "datetime-local": "date",
  month: "date",
  week: "date",
  time: "date",
};

// The words a field's name, id and label are read for, whole or as part of
// a longer name ("cardNumber", "cc_num"). Every one of them gives a class a
// teammate never types into, so a false match only asks the person.
const CARD_NUMBER = /card.?(?:number|num|no\b)|cardnumber|(?:^|[^a-z])cc.?num|credit.?card|debit.?card/;
const CARD_CODE = /\bcvv2?\b|\bcvc2?\b|\bcsc\b|security.?code|card.?code|cvv|cvc/;
const CARD_EXPIRY = /expir|\bexp.?(?:date|month|year)\b|\bmm.?yy\b/;
const BANK_ACCOUNT = /\biban\b|account.?(?:number|num|no\b)|routing|sort.?code|bank.?account/;
const ONE_TIME_CODE = /\botp\b|one.?time.?(?:code|pass(?:word|code)?|pin)|passcode|verification.?code|\b2fa\b|\bmfa\b|\btotp\b|auth(?:entication)?.?code/;
const CODE_WORDS = /code|otp|passcode|verification|pin/;
const PASSWORD = /passw(?:or)?d|\bpwd\b/;

/**
 * The kind of a field: its class when it is one a teammate never types into,
 * else what its tag and type say. Not a field (a button, a link, any other
 * tag): "none".
 */
export function fieldKindOf(f: {
  tag: string;
  type: string | null;
  autocomplete: string | null;
  inputmode: string | null;
  name: string | null;
  id: string | null;
  label: string | null;
  maxLength: number | null;
}): FieldKind {
  const tag = (f.tag ?? "").toLowerCase();
  if (tag !== "input" && tag !== "textarea" && tag !== "select") return "none";
  const type = tag === "input" ? (f.type ?? "").trim().toLowerCase() || "text" : null;
  if (type !== null && Object.prototype.hasOwnProperty.call(NON_TEXT_TYPES, type)) return NON_TEXT_TYPES[type];
  if (type === "password") return "password";

  const tokens = (f.autocomplete ?? "").toLowerCase().split(/\s+/).filter(Boolean);
  if (tokens.includes("one-time-code")) return "one_time_code";
  if (tokens.includes("cc-number")) return "card_number";
  if (tokens.includes("cc-csc")) return "card_code";
  if (tokens.some((t) => t.startsWith("cc-exp"))) return "card_expiry";
  // A password field a "show password" switch turned into a text field.
  if (tokens.includes("current-password") || tokens.includes("new-password")) return "password";

  const hints = [f.name, f.id, f.label].filter((v): v is string => typeof v === "string").join(" ").toLowerCase();
  if (CARD_NUMBER.test(hints)) return "card_number";
  if (CARD_CODE.test(hints)) return "card_code";
  if (CARD_EXPIRY.test(hints)) return "card_expiry";
  if (BANK_ACCOUNT.test(hints)) return "bank_account";
  const numeric = (f.inputmode ?? "").toLowerCase() === "numeric";
  const shortCode = typeof f.maxLength === "number" && f.maxLength >= 4 && f.maxLength <= 8;
  if ((numeric && shortCode && CODE_WORDS.test(hints)) || ONE_TIME_CODE.test(hints)) return "one_time_code";
  if (PASSWORD.test(hints)) return "password";

  if (tag === "textarea") return "textarea";
  if (tag === "select") return "select";
  return (type !== null && Object.prototype.hasOwnProperty.call(TEXT_TYPES, type) ? TEXT_TYPES[type] : "text");
}

const SENSITIVE: ReadonlySet<FieldKind> = new Set<FieldKind>(["password", "one_time_code", "card_number", "card_code", "card_expiry", "bank_account"]);

/** A field a teammate never types into or chooses in (Decision 18): the person takes over. */
export function isSensitiveField(k: FieldKind): boolean {
  return SENSITIVE.has(k);
}

export type ClickWarning = "buys" | "sends" | "deletes" | "terms" | "submits" | "settings" | "download";

/** The warnings in the order a card lists them. */
export const CLICK_WARNINGS: readonly ClickWarning[] = ["buys", "sends", "deletes", "terms", "submits", "settings", "download"];

const BUYS = /\b(?:buy|pay|purchase|order|checkout|check out|place order|subscribe|donate|book|reserve)\b/;
const SENDS = /\b(?:send|post|publish|share|reply|comment|tweet|invite)\b/;
const DELETES = /\b(?:delete|remove|cancel|close account|unsubscribe)\b/;
const TERMS = /\b(?:accept|agree|consent)\b/;
const SETTINGS_PATH = /settings|account|profile|security|billing/;

/**
 * What a click on this element may do, as its card says it: by whole words
 * of its name, whether it sends a form, and the page's own facts (a path
 * like account settings, a form holding a sensitive field, a download link).
 */
export function clickWarnings(el: ElementFingerprint, page: { path: string; formHasSensitive: boolean; downloadLink: boolean }): ClickWarning[] {
  const name = (el.name ?? "").toLowerCase();
  const type = (el.type ?? "").toLowerCase();
  const tag = (el.tag ?? "").toLowerCase();
  const out = new Set<ClickWarning>();
  if (BUYS.test(name) || page.formHasSensitive) out.add("buys");
  if (SENDS.test(name)) out.add("sends");
  if (DELETES.test(name)) out.add("deletes");
  if (TERMS.test(name)) out.add("terms");
  const submitControl = type === "submit" || type === "image";
  const buttonInForm = (tag === "button" || el.role === "button") && el.formHost !== null;
  if (submitControl || buttonInForm) out.add("submits");
  if (SETTINGS_PATH.test((page.path ?? "").toLowerCase())) out.add("settings");
  if (page.downloadLink) out.add("download");
  return CLICK_WARNINGS.filter((w) => out.has(w));
}

/** The most of each browser call one answer may make (Decision 22); 40 a minute per person across answers. */
export const BROWSER_TURN_LIMITS = { calls: 20, opens: 8, reads: 6, finds: 6, scrolls: 8, shows: 3, asks: 1, takeOvers: 1, starts: 1, perPersonPerMinute: 40 } as const;

/** What one read of a page gives the model at most (Decision 17). */
export const PAGE_LIMITS = {
  partChars: 8000,
  parts: 10,
  elements: 120,
  links: 80,
  nameChars: 120,
  linkTextChars: 120,
  hrefChars: 500,
  titleChars: 150,
  options: 30,
  optionChars: 80,
  findMatches: 20,
  typeMax: 2000,
} as const;

/** How long a session waits (Decision 6): idle, a card or a take over waiting, a take over, a start, a turn that holds it. */
export const SESSION_TIMES = { idleMs: 5 * 60_000, waitingMs: 10 * 60_000, takeOverMs: 10 * 60_000, startMs: 60_000, staleRunMs: 30 * 60_000 } as const;

/** Per person and per session (Decisions 5 and 23): sessions, steps and pictures, and how long they are kept. */
export const SESSION_CAPS = { personAtOnce: 1, personPerDay: 20, stepsPerSession: 300, shotsPerSession: 20, shotHours: 24, stepDays: 30, shotMaxBytes: 600_000 } as const;

/** The web content reads: a turn that ran one asks before every write (Decision 15). */
export const WEB_READS: ReadonlySet<BrowserToolName> = new Set<BrowserToolName>(["open_page", "read_page", "find_on_page", "scroll_page", "show_page"]);
