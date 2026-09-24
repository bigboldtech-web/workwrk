// The form's own settings bucket, as the responder, the embed and the submit
// route read it (spec-tables-forms section 2 /forms/[id], "Where every value on
// this tab lives").
//
// The store is the additive FormDefinition.settings column (build step 6). Until
// that column exists, and for one release after it lands, a form has NO bucket
// at all: every reader goes through readFormSettings, which turns a missing or
// malformed bucket into the defaults. The defaults are chosen so that no live
// form changes behaviour on the day the column lands (section 4, data
// migration b): a form keeps accepting responses, never closes on its own, and
// keeps offering "Submit another response", which the responder always offered.
//
// The writer is `formSettingsPatchSchema`: ONE strict zod schema, so
// PATCH /api/forms/[id] { settings } answers 400 naming an unknown key instead
// of silently dropping it (settings-architecture 9.1: if it renders, it
// persists, and something reads it). A patch is PARTIAL: `mergeFormSettings`
// lays it over what is stored and writes the whole normalised bucket back.
//
// Pure apart from zod, so vitest loads it in node.

import { z } from "zod";

export const DEFAULT_CONFIRMATION_MESSAGE = "Thanks, your response has been recorded.";
export const DEFAULT_CLOSED_MESSAGE = "This form is no longer accepting responses.";

export interface FormSettings {
  acceptingResponses: boolean;
  closesAt: string | null;
  oneResponsePerPerson: boolean;
  collectEmail: boolean;
  confirmationMessage: string;
  redirectUrl: string | null;
  allowAnother: boolean;
  /** People told about each new response (one notification each). */
  notifyUserIds: string[];
  /** Tell them once a day instead (the form-daily-summary cron, scripts/CRON-SETUP.md). */
  dailySummary: boolean;
  closedMessage: string;
  /** "Accept responses from people without an account" (founder decision
   *  D16): with the form's public link live, someone who is not signed in
   *  (or is signed in to another workspace) may send it. Grants exactly one
   *  thing, appending a response to this form; never a view of the
   *  destination or of any answer already in it. Default off. */
  acceptAnonymous: boolean;
}

/** At most this many people are told about each response. */
export const MAX_NOTIFY_USERS = 50;

export const DEFAULT_FORM_SETTINGS: FormSettings = {
  acceptingResponses: true,
  closesAt: null,
  oneResponsePerPerson: false,
  collectEmail: false,
  confirmationMessage: DEFAULT_CONFIRMATION_MESSAGE,
  redirectUrl: null,
  // The responder has always offered "Submit another response" and there is
  // no settings tab yet to turn it back on, so the legacy default is on.
  allowAnother: true,
  notifyUserIds: [],
  dailySummary: false,
  closedMessage: DEFAULT_CLOSED_MESSAGE,
  // Off for every form, including the ones that were public before this
  // switch existed: turning it on for them is the founder's call, not a
  // silent backfill.
  acceptAnonymous: false,
};

function str(v: unknown, max: number): string | null {
  return typeof v === "string" && v.trim() ? v.trim().slice(0, max) : null;
}

/** Only http(s) redirects; anything else (javascript:, data:) is dropped. */
function safeUrl(v: unknown): string | null {
  const s = str(v, 2000);
  if (!s) return null;
  try {
    const u = new URL(s);
    return u.protocol === "https:" || u.protocol === "http:" ? u.toString() : null;
  } catch {
    return null;
  }
}

function isoOrNull(v: unknown): string | null {
  if (typeof v !== "string" || !v) return null;
  const t = Date.parse(v);
  return Number.isFinite(t) ? new Date(t).toISOString() : null;
}

/** Tolerant reader: an absent column, null, an array or junk all read as the defaults. */
export function readFormSettings(raw: unknown): FormSettings {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return { ...DEFAULT_FORM_SETTINGS };
  const r = raw as Record<string, unknown>;
  const bool = (k: keyof FormSettings) => (typeof r[k] === "boolean" ? (r[k] as boolean) : (DEFAULT_FORM_SETTINGS[k] as boolean));
  return {
    acceptingResponses: bool("acceptingResponses"),
    closesAt: isoOrNull(r.closesAt),
    oneResponsePerPerson: bool("oneResponsePerPerson"),
    collectEmail: bool("collectEmail"),
    confirmationMessage: str(r.confirmationMessage, 1000) ?? DEFAULT_CONFIRMATION_MESSAGE,
    redirectUrl: safeUrl(r.redirectUrl),
    allowAnother: bool("allowAnother"),
    notifyUserIds: Array.isArray(r.notifyUserIds)
      ? [...new Set(r.notifyUserIds.filter((x): x is string => typeof x === "string" && x.length > 0 && x.length <= 64))].slice(0, MAX_NOTIFY_USERS)
      : [],
    dailySummary: bool("dailySummary"),
    closedMessage: str(r.closedMessage, 1000) ?? DEFAULT_CLOSED_MESSAGE,
    acceptAnonymous: bool("acceptAnonymous"),
  };
}

/** A person may send without an account only while BOTH hold: the form's
 *  public link is live (isPublic, and the org's public links are not off)
 *  and the form's own switch is on. The one rule the public read and the
 *  submit route share. */
export function acceptsAnonymousResponses(settings: FormSettings, publicLinkLive: boolean): boolean {
  return publicLinkLive && settings.acceptAnonymous;
}

/** What the Settings tab's Link box saves for what was typed: the link as a
 *  URL string, or null when it is not a web address. A bare host with a dot
 *  ("example.com/thanks", the way most people type a link) gets https://
 *  in front, so the commonest entry saves instead of being refused. Anything
 *  with a scheme must already be http or https; "mailto:", "javascript:" and
 *  the like are never rewritten into something else. */
export function normalizeRedirectInput(raw: string): string | null {
  const s = raw.trim();
  if (!s || s.length > 2000) return null;
  const web = (v: string): string | null => {
    try {
      const u = new URL(v);
      return u.protocol === "https:" || u.protocol === "http:" ? u.toString() : null;
    } catch {
      return null;
    }
  };
  if (/^[a-z][a-z0-9+.-]*:\/\//i.test(s)) return web(s);
  if (/^[^\s/:@?#]+\.[^\s/:@?#]+(:\d+)?([/?#]|$)/.test(s) && !/\s/.test(s)) return web(`https://${s}`);
  return web(s);
}

/* ───────────────────────────── the writer ───────────────────────────── */

const message = z.string().max(1000);
const httpUrl = z
  .string()
  .max(2000)
  .refine((v) => {
    try {
      const u = new URL(v);
      return u.protocol === "https:" || u.protocol === "http:";
    } catch {
      return false;
    }
  }, "Use a link that starts with https://");

/** The one writer. Every key optional (a patch), none unknown. */
export const formSettingsPatchSchema = z.strictObject({
  acceptingResponses: z.boolean().optional(),
  closesAt: z.union([z.iso.datetime({ offset: true }), z.null()]).optional(),
  oneResponsePerPerson: z.boolean().optional(),
  collectEmail: z.boolean().optional(),
  confirmationMessage: message.optional(),
  redirectUrl: z.union([httpUrl, z.null()]).optional(),
  allowAnother: z.boolean().optional(),
  notifyUserIds: z.array(z.string().min(1).max(64)).max(MAX_NOTIFY_USERS).optional(),
  dailySummary: z.boolean().optional(),
  closedMessage: message.optional(),
  acceptAnonymous: z.boolean().optional(),
});

export type FormSettingsPatch = z.infer<typeof formSettingsPatchSchema>;

/** A 400's sentence for a rejected patch: names the key, never a zod dump. */
export function describeSettingsError(err: z.ZodError): string {
  const issue = err.issues[0];
  if (!issue) return "Those settings could not be saved";
  if (issue.code === "unrecognized_keys") return `Unknown form setting: ${issue.keys.join(", ")}`;
  const key = issue.path.join(".") || "settings";
  return `${key}: ${issue.message}`;
}

/** The stored bucket after a patch: the old values, the patch on top, then
 *  read back through readFormSettings so what is written is always normal
 *  (an empty message falls back to the canon one, a redirect is re-checked). */
export function mergeFormSettings(stored: unknown, patch: FormSettingsPatch): FormSettings {
  const base = readFormSettings(stored);
  const next: Record<string, unknown> = { ...base };
  for (const [k, v] of Object.entries(patch)) if (v !== undefined) next[k] = v;
  return readFormSettings(next);
}

/** Closed = the switch is off, or the close date has passed. Compared with an
 *  injected clock so the submit route and the tests agree on the instant. */
export function isFormClosed(settings: FormSettings, now: Date = new Date()): boolean {
  if (!settings.acceptingResponses) return true;
  if (settings.closesAt && Date.parse(settings.closesAt) <= now.getTime()) return true;
  return false;
}
