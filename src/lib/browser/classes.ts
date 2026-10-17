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
// CODES AND BANK ACCOUNTS BY ANY PART OF A NAME (review of Phase 4 step 1).
// Whole words missed "otp_code", "mfaCode", "totp_token", "2fa_code",
// "sms_code" and "iban_number", since "_" and letters join a word. They
// are matched anywhere in the lower-cased hints now: a false match only asks
// the person to take over. A code split into one box a digit (4 to 8 boxes
// of one numeric character together) is a one-time code too, and so is any
// such box whose words name a code or a digit, when the reader cannot tell
// how many sit together.
//
// CLICK WARNINGS are the card's extra lines (step 3), from the element's own
// name and facts of the page. A click always waits on its own card whatever
// they say; they only say why to look twice. Since review of Phase 4 step 1
// the words are matched where they start a word ("Payment", "Booking") or,
// where no other word holds them, anywhere ("Proceed to checkout").
//
// THE ACTION WORDS (docs/plans/ai-teammates-phase5.md Decision 7) are Phase
// 5's own list beside the click warnings, which hold no approve, confirm,
// reject, mark or submit. They are matched as whole words only, over a
// control's words (actingWords) and over a link's address (actingAddress):
// a recorded control or link that acts is kept as a click step, never a
// choice or "go to the link", and while a skill runs open_page refuses an
// address that acts (Decision 18). Toward the safer side: a harmless
// "Mark all as read" or "/order/history" is one more card. An address is
// read more widely than a control's words (review of Phase 5 step 1): split
// at camelCase ("/Leave/ApproveLeave/5"), read for Phase 4's own verbs and
// a record's state changes too (ADDRESS_ACTION_WORDS), and read as acting
// when it cannot be read, since open_page opens a link with no card.
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
// Anywhere in the hints, never as whole words (review of Phase 4 step 1).
const BANK_ACCOUNT = /iban|account.?(?:number|num|no)|routing|sort.?code|bank.?account|swift|bic\b/;
const ONE_TIME_CODE = /otp|totp|mfa|2fa|two.?factor|one.?time|passcode|verification.?code|auth(?:entication)?.?code|sms.?code|security.?code|pin.?code/;
const CODE_WORDS = /code|otp|passcode|verification|pin/;
/** What a box of one digit says when it is part of a code ("Digit 1 of 6"). */
const CODE_BOX_WORDS = /code|otp|passcode|verification|pin|digit/;
const PASSWORD = /passw(?:or)?d|\bpwd\b/;

/**
 * What the reader tells of a field to class it (page-reader.ts; the
 * recorder's events carry the same, src/lib/skills/types.ts): never its value.
 */
export interface FieldHints {
  tag: string;
  type: string | null;
  autocomplete: string | null;
  inputmode: string | null;
  name: string | null;
  id: string | null;
  label: string | null;
  maxLength: number | null;
  /**
   * How many fields of one numeric character sit together with this one
   * (the reader counts them, in one form or one parent), or null when it
   * cannot tell (review of Phase 4 step 1).
   */
  codeBoxes?: number | null;
}

/**
 * The kind of a field: its class when it is one a teammate never types into,
 * else what its tag and type say. Not a field (a button, a link, any other
 * tag): "none".
 */
export function fieldKindOf(f: FieldHints): FieldKind {
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
  // Numbers typed: inputmode numeric or tel, or a number or tel field (review of Phase 4 step 1: tel too).
  const mode = (f.inputmode ?? "").toLowerCase();
  const numeric = mode === "numeric" || mode === "tel" || type === "number" || type === "tel";
  const shortCode = typeof f.maxLength === "number" && f.maxLength >= 4 && f.maxLength <= 8;
  if ((numeric && shortCode && CODE_WORDS.test(hints)) || ONE_TIME_CODE.test(hints)) return "one_time_code";
  // A code split into one box a digit (review of Phase 4 step 1): 4 to 8
  // such boxes together, or, when the reader cannot tell, one whose words
  // name a code or a digit.
  if (numeric && f.maxLength === 1) {
    const boxes = typeof f.codeBoxes === "number" ? f.codeBoxes : null;
    if ((boxes !== null && boxes >= 4 && boxes <= 8) || CODE_BOX_WORDS.test(hints)) return "one_time_code";
  }
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

// Review of Phase 4 step 1: words that only ever mean paying are matched
// anywhere ("Proceed to checkout", "Renewal", "Withdrawal"); the short ones
// other words hold ("display", "border", "notebook") only where they start
// a word, with their usual endings ("Payment", "Booking", "Ordering").
const BUYS =
  /\b(?:buy(?:ing|s)?|pay(?:ment|ments|ing|s)?|paypal|order(?:ing|s)?|book(?:ing|ings|s)?)\b|\bpurchas|\breserv|checkout|check out|transfer|withdraw|upgrade|renew|donat(?:e|ion|ing)|(?<!un)subscri(?:be|ption)/;
const SENDS = /\b(?:send|post|publish|share|reply|comment|tweet|invite)\b/;
// Review of Phase 4 step 1: anywhere, since no other word holds them.
const DELETES = /delet|remov|cancel|close account|unsubscribe|trash|discard|erase|deactivat|revok|revocation|disconnect/;
const TERMS = /\b(?:accept|agree|consent)\b/;
const SETTINGS_PATH = /settings|account|profile|security|billing/;

/**
 * What a click on this element may do, as its card says it: by the words of
 * its name, whether it sends a form, and the page's own facts (a path like
 * account settings, a form holding a sensitive field, a download link).
 *
 * Phase 4 step 3: a page whose path names buying ("/checkout",
 * "/buy-now", "/order") warns that it buys too, whatever the button says
 * ("Confirm", "Continue"): a planted page's buy button needs no buying word.
 *
 * Review round 1 of Phase 4: a control is named by the words a person sees
 * on it, and the words it is also called by (`alsoNamed`: its
 * aria-labelledby or aria-label words where they differ) are read for the
 * warnings too, so relabelling a button never takes a warning away.
 */
export function clickWarnings(el: ElementFingerprint, page: { path: string; formHasSensitive: boolean; downloadLink: boolean; alsoNamed?: string }): ClickWarning[] {
  const name = `${el.name ?? ""} ${page.alsoNamed ?? ""}`.trim().toLowerCase();
  const type = (el.type ?? "").toLowerCase();
  const tag = (el.tag ?? "").toLowerCase();
  const path = (page.path ?? "").toLowerCase();
  const out = new Set<ClickWarning>();
  if (BUYS.test(name) || page.formHasSensitive || BUYS.test(path)) out.add("buys");
  if (SENDS.test(name)) out.add("sends");
  if (DELETES.test(name)) out.add("deletes");
  if (TERMS.test(name)) out.add("terms");
  const submitControl = type === "submit" || type === "image";
  const buttonInForm = (tag === "button" || el.role === "button") && el.formHost !== null;
  if (submitControl || buttonInForm) out.add("submits");
  if (SETTINGS_PATH.test(path)) out.add("settings");
  if (page.downloadLink) out.add("download");
  return CLICK_WARNINGS.filter((w) => out.has(w));
}

/**
 * The words that say a control or a link acts (docs/plans/ai-teammates-phase5.md
 * Decision 7), matched as whole words, case aside.
 */
export const ACTION_WORDS: readonly string[] = [
  "approve",
  "approval",
  "confirm",
  "reject",
  "decline",
  "accept",
  "delete",
  "remove",
  "cancel",
  "void",
  "pay",
  "payment",
  "checkout",
  "order",
  "buy",
  "purchase",
  "submit",
  "send",
  "publish",
  "post",
  "unsubscribe",
  "mark",
  "release",
  "transfer",
];

/** A text's whole words, lower case: runs of letters and digits ("Doe's" gives "doe" and "s"). */
function wholeWords(text: string): string[] {
  return String(text ?? "")
    .toLowerCase()
    .split(/[^\p{L}\p{N}]+/u)
    .filter(Boolean);
}

/**
 * The first of ACTION_WORDS a control's words hold as a whole word, case
 * aside, or null: "Approve Jane Doe's leave" gives "approve", "Approvals
 * inbox" nothing ("approvals" is neither "approve" nor "approval").
 */
export function actingWords(words: string): string | null {
  const held = new Set(wholeWords(words));
  for (const w of ACTION_WORDS) if (held.has(w)) return w;
  return null;
}

/**
 * The words that say an address acts, beyond ACTION_WORDS (review of Phase 5
 * step 1): Phase 4's own buying, sending, deleting and terms verbs, which
 * its click warnings read only in a control's words and never in an
 * address, "add" (Decision 17's own `/cart/add?item=5`), and the verbs that
 * change a record's state in the systems people record (a ticket closed, a
 * request denied, a user suspended). Matched as whole pieces of an address
 * only: a control's words reach Phase 4's verbs through its click warnings.
 * Toward the safer side: a harmless "/archive" page or "?usp=share_link" is
 * one more card, and a start page holding one is the site's home.
 */
export const ADDRESS_ACTION_WORDS: readonly string[] = [
  ...ACTION_WORDS,
  // Phase 4's clickWarnings verbs (BUYS, SENDS, DELETES, TERMS).
  "book",
  "reserve",
  "withdraw",
  "upgrade",
  "renew",
  "donate",
  "subscribe",
  "share",
  "reply",
  "comment",
  "tweet",
  "invite",
  "trash",
  "discard",
  "erase",
  "deactivate",
  "revoke",
  "disconnect",
  "agree",
  "consent",
  // A record added or its state changed.
  "add",
  "archive",
  "assign",
  "unassign",
  "close",
  "reopen",
  "resolve",
  "grant",
  "deny",
  "enable",
  "disable",
  "suspend",
  "terminate",
  "restore",
  "revert",
];

const ADDRESS_ACTION_SET: ReadonlySet<string> = new Set(ADDRESS_ACTION_WORDS);

/**
 * Where an address's parts are split to be read as words (Decision 7): "/",
 * "-", "_", ".", "=" and "&", and, toward the safer side, ";", ",", ":",
 * "+" and white space too. Split before each piece is decoded, so an
 * escape a piece holds is decoded on its own.
 */
const ADDRESS_SPLIT = /[/\-_.=&;,:+\s]+/;

/**
 * One decoded piece of an address as words (review of Phase 5 step 1):
 * split where a lower case letter or a digit meets an upper case one, where
 * a run of capitals meets a capitalised word, and where letters meet digits,
 * before it is lower-cased ("ApproveLeave", "approveAll", "XMLApprove",
 * "step2approve"); then at anything that is not a letter or a digit.
 */
function addressWords(piece: string): string[] {
  return wholeWords(
    piece
      .replace(/(\p{Ll}|\p{Nd})(\p{Lu})/gu, "$1 $2")
      .replace(/(\p{Lu})(\p{Lu}\p{Ll})/gu, "$1 $2")
      .replace(/(\p{L})(\p{Nd})/gu, "$1 $2")
      .replace(/(\p{Nd})(\p{L})/gu, "$1 $2"),
  );
}

/**
 * Whether a link's address looks like an action (Decision 7): one of its
 * path parts, its query's names or values, or the parts of its fragment (a
 * single-page app's route lives there: "#/invoices/7/approve"), each split
 * at ADDRESS_SPLIT, then decoded, then split into words at camelCase and
 * digit boundaries (addressWords), holds a word of ADDRESS_ACTION_WORDS,
 * case aside. "/wf.do?method=approve&id=5", "/invoices/7/approve",
 * "/Leave/ApproveLeave/5" and "/members/5/deactivate" act; "/orders" and
 * "/reports/weekly" do not. Read only to class a link, never kept.
 *
 * FAILS CLOSED (review of Phase 5 step 1): an address it cannot read (a
 * malformed escape such as "%" or "%E9" in a piece, one that does not
 * parse, one past 8,192 characters) acts, so its link is a click card and a
 * start page holding it is the site's home. Only no address at all ("")
 * does not act.
 */
export function actingAddress(url: string): boolean {
  if (typeof url !== "string" || url.length === 0) return false;
  if (url.length > 8192) return true;
  let u: URL;
  try {
    u = new URL(url, "https://address.invalid/");
  } catch {
    return true;
  }
  const parts = [u.pathname, u.search.replace(/^\?/, ""), u.hash.replace(/^#/, "")];
  for (const part of parts) {
    for (const raw of part.split(ADDRESS_SPLIT)) {
      if (!raw) continue;
      let piece: string;
      try {
        piece = decodeURIComponent(raw);
      } catch {
        return true;
      }
      for (const w of addressWords(piece)) if (ADDRESS_ACTION_SET.has(w)) return true;
    }
  }
  return false;
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
