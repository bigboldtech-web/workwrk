// The Workspace settings values, read from Organization.settings in ONE place
// with their defaults and their read-time migrations (settings-architecture
// sections 5, 9.3 and 11.1; spec-settings-workspace section 2). Pure: no
// prisma, no React, so the pages, the API routes, the sign-in code, the crons
// and the vitest suite agree on every default.
//
// Every reader TOLERATES a missing or malformed key and answers the default,
// which is always the behaviour the product had before the key existed, so
// shipping an editor changes nothing on day one:
//
//   security   the code's constants: 8 characters, uppercase and number on,
//              symbol off, no expiry, 30 days idle (NextAuth's maxAge
//              ceiling), 90 days absolute (both raised from 12 hours and 30
//              days on 2026-10-22), two-factor "off" (enrolled people are still
//              asked by ENFORCE_MFA_AT_LOGIN, the env floor), 8 failures
//              lock for 15 minutes (src/lib/login-throttle.ts)
//   retention  trash 60 days, audit log 365 days
//   data       self export on, AI on
//   users      the org domain, no auto join, Member, no default Spaces, 7 days
//   work       no org default task type, automations running
//   locale     Monday, DMY, 24h; fiscal month migrated from "MM-01" to 4
//   scoring    the four keys the page edits, migrated from the older
//              five-key vocabulary on read

import { mfaRequirementOf, type MfaRequirement } from "@/lib/auth/security-policy";
import { NEXTAUTH_MAX_AGE_MIN } from "@/lib/auth/session-policy";

function rec(v: unknown): Record<string, unknown> {
  return v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : {};
}

function intIn(v: unknown, min: number, max: number, dflt: number): number {
  if (typeof v !== "number" || !Number.isFinite(v)) return dflt;
  const n = Math.round(v);
  return n < min || n > max ? dflt : n;
}

function bool(v: unknown, dflt: boolean): boolean {
  return typeof v === "boolean" ? v : dflt;
}

/* ───────────────────────── Security › Sign-in policy ───────────────────────── */

export interface SignInPolicy {
  minPasswordLength: number;
  requireUppercase: boolean;
  requireNumbers: boolean;
  requireSymbol: boolean;
  /** 0 means never. */
  passwordMaxAgeDays: number;
  sessionIdleMinutes: number;
  sessionMaxDays: number;
  mfaRequired: MfaRequirement;
  lockoutThreshold: number;
  lockoutMinutes: number;
}

/** The editor's bounds (the zod schema and the inputs share them). */
export const SIGN_IN_BOUNDS = {
  minPasswordLength: { min: 8, max: 64 },
  passwordMaxAgeDays: { min: 0, max: 3650 },
  // 30 days (43,200 minutes) is NextAuth's session.maxAge ceiling
  // (src/lib/auth/session-policy.ts NEXTAUTH_MAX_AGE_MIN): the org value can
  // only narrow it.
  sessionIdleMinutes: { min: 30, max: NEXTAUTH_MAX_AGE_MIN },
  sessionMaxDays: { min: 1, max: 365 },
  // The built-in 8 failures and 15 minutes are the floor (login-throttle
  // effectiveLockout): lock sooner or longer, never later or shorter.
  lockoutThreshold: { min: 3, max: 8 },
  lockoutMinutes: { min: 15, max: 1440 },
} as const;

export const DEFAULT_SIGN_IN_POLICY: SignInPolicy = {
  minPasswordLength: 8,
  requireUppercase: true,
  requireNumbers: true,
  requireSymbol: false,
  passwordMaxAgeDays: 0,
  sessionIdleMinutes: NEXTAUTH_MAX_AGE_MIN,
  sessionMaxDays: 90,
  mfaRequired: "off",
  lockoutThreshold: 8,
  lockoutMinutes: 15,
};

/** What a brand new workspace starts with (settings-architecture 11.1: two-factor for Admins). */
export const NEW_ORG_SIGN_IN_POLICY: SignInPolicy = { ...DEFAULT_SIGN_IN_POLICY, mfaRequired: "admins" };

export function signInPolicyOf(settings: unknown): SignInPolicy {
  const s = rec(rec(settings).security);
  const b = SIGN_IN_BOUNDS;
  const d = DEFAULT_SIGN_IN_POLICY;
  return {
    minPasswordLength: intIn(s.minPasswordLength, b.minPasswordLength.min, 128, d.minPasswordLength),
    requireUppercase: bool(s.requireUppercase, d.requireUppercase),
    requireNumbers: bool(s.requireNumbers, d.requireNumbers),
    requireSymbol: bool(s.requireSymbol, d.requireSymbol),
    passwordMaxAgeDays: intIn(s.passwordMaxAgeDays, b.passwordMaxAgeDays.min, b.passwordMaxAgeDays.max, d.passwordMaxAgeDays),
    sessionIdleMinutes: idleMinutesOf(s),
    sessionMaxDays: intIn(s.sessionMaxDays, b.sessionMaxDays.min, b.sessionMaxDays.max, d.sessionMaxDays),
    mfaRequired: mfaRequirementOf(settings),
    lockoutThreshold: intIn(s.lockoutThreshold, b.lockoutThreshold.min, b.lockoutThreshold.max, d.lockoutThreshold),
    lockoutMinutes: intIn(s.lockoutMinutes, b.lockoutMinutes.min, b.lockoutMinutes.max, d.lockoutMinutes),
  };
}

/**
 * 720 minutes (12 hours) was both the old default and the old maximum of the
 * idle window, so a 720 stored before 2026-10-22 cannot mean "shorter than
 * the default": it reads as unset, the new default. A value saved since
 * carries `sessionIdleChosen` (securityWrite below), so an Admin who picks 12
 * hours now keeps 12 hours. Every other stored value is the Admin's choice
 * and is honoured as it is.
 */
export const LEGACY_IDLE_CEILING_MIN = 720;

function idleMinutesOf(s: Record<string, unknown>): number {
  const b = SIGN_IN_BOUNDS.sessionIdleMinutes;
  const v = s.sessionIdleMinutes;
  if (typeof v === "number" && Math.round(v) === LEGACY_IDLE_CEILING_MIN && s.sessionIdleChosen !== true) {
    return DEFAULT_SIGN_IN_POLICY.sessionIdleMinutes;
  }
  return intIn(v, b.min, b.max, DEFAULT_SIGN_IN_POLICY.sessionIdleMinutes);
}

/**
 * The stored `security` object after a Security save (PATCH /api/settings,
 * section "security"): the saved keys merged over what is stored, and the
 * idle window marked as chosen whenever the save carries it. Pure; tested.
 */
export function securityWrite(stored: Record<string, unknown>, saved: Record<string, unknown>): Record<string, unknown> {
  const merged: Record<string, unknown> = { ...stored, ...saved };
  if (saved.sessionIdleMinutes !== undefined) merged.sessionIdleChosen = true;
  return merged;
}

/** An AI app connection's life when the workspace stored no session lifetime. */
export const DEFAULT_GRANT_LIFETIME_DAYS = 30;

/**
 * How long an AI app's connection lasts, in days (src/lib/oauth/grants.ts
 * endsBy, recomputed at each refresh): the session lifetime the workspace
 * stored (Workspace settings > Security > Signed out after), as before
 * 2026-10-22, else 30 days. The session default moved from 30 days to 90 that
 * day so people stop being signed out; a connection that acts as a person in
 * another company's app keeps the shorter default (decided by its worst
 * case: a stolen app token that works for a quarter). The Security page saves
 * only the fields an Admin changed, so a stored value is always a choice.
 * Pure; tested.
 */
export function grantLifetimeDaysOf(settings: unknown): number {
  const s = rec(rec(settings).security);
  const b = SIGN_IN_BOUNDS.sessionMaxDays;
  return intIn(s.sessionMaxDays, b.min, b.max, DEFAULT_GRANT_LIFETIME_DAYS);
}

/** A number of minutes in plain words: "30 days", "12 hours", "1 day and 6 hours", "45 minutes". Pure; tested. */
export function minutesInWords(total: number): string {
  if (!Number.isFinite(total) || total <= 0) return "0 minutes";
  const n = Math.round(total);
  const days = Math.floor(n / 1440);
  const hours = Math.floor((n % 1440) / 60);
  const minutes = n % 60;
  const unit = (v: number, word: string) => `${v.toLocaleString("en-US")} ${word}${v === 1 ? "" : "s"}`;
  const parts = [days ? unit(days, "day") : null, hours ? unit(hours, "hour") : null, minutes ? unit(minutes, "minute") : null].filter((p): p is string => !!p);
  return parts.length > 1 ? `${parts.slice(0, -1).join(", ")} and ${parts[parts.length - 1]}` : parts[0];
}

export const MFA_AUDIENCE_LABELS: Record<MfaRequirement, string> = {
  off: "Nobody",
  admins: "Admins",
  everyone: "Everyone",
};

/* ───────────────────────── Data › Retention & privacy ───────────────────────── */

export const RETENTION_BOUNDS = { trashDays: { min: 1, max: 3650 }, auditDays: { min: 90, max: 3650 } } as const;

export interface RetentionSettings {
  trashDays: number;
  /**
   * null = keep the audit log forever. An org that never chose a window
   * keeps every row: the purge acts only on a window someone set, so
   * installing the cron can never delete years of history nobody asked to
   * lose (the smallest worst case; settings spec suggested 365 as a default).
   */
  auditDays: number | null;
}

export function retentionOf(settings: unknown): RetentionSettings {
  const r = rec(rec(settings).retention);
  const audit = r.auditDays;
  return {
    trashDays: intIn(r.trashDays, RETENTION_BOUNDS.trashDays.min, RETENTION_BOUNDS.trashDays.max, 60),
    auditDays:
      typeof audit === "number" && Number.isFinite(audit) && audit >= RETENTION_BOUNDS.auditDays.min && audit <= RETENTION_BOUNDS.auditDays.max
        ? Math.round(audit)
        : null,
  };
}

export interface DataSettings {
  selfExport: boolean;
  aiEnabled: boolean;
  /** AI fields in Lists, off unless stored as true (src/lib/ai/ai-features.ts). */
  aiFields: boolean;
  /** Scheduled AI updates in Talk, off unless stored as true. */
  aiTalkUpdates: boolean;
}

/**
 * The stored values, defaults filled in. aiFields and aiTalkUpdates are the
 * person's own choice as stored; whether the feature runs also needs
 * aiEnabled (aiFieldsOn / aiTalkUpdatesOn), so the page can show both.
 */
export function dataSettingsOf(settings: unknown): DataSettings {
  const d = rec(rec(settings).data);
  return {
    selfExport: d.selfExport !== false,
    aiEnabled: d.aiEnabled !== false,
    aiFields: d.aiFields === true,
    aiTalkUpdates: d.aiTalkUpdates === true,
  };
}

/* ───────────────────────── Members › Invite rules ───────────────────────── */

export type InviteDefaultRole = "ADMIN" | "MEMBER" | "GUEST";

export interface UsersSettings {
  allowedDomains: string[];
  autoJoin: boolean;
  inviteDefaultRole: InviteDefaultRole;
  defaultSpaceIds: string[];
  inviteExpiryDays: number;
}

const DOMAIN_RE = /^(?=.{1,253}$)([a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/;

/** A bare, lower-case hostname, or null (tested). "@Acme.com" reads as "acme.com". */
export function normalizeDomain(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const d = raw.trim().toLowerCase().replace(/^@+/, "").replace(/\.+$/, "");
  return DOMAIN_RE.test(d) ? d : null;
}

export function usersSettingsOf(settings: unknown, orgDomain: string | null | undefined): UsersSettings {
  const u = rec(rec(settings).users);
  const stored = Array.isArray(u.allowedDomains) ? u.allowedDomains.map(normalizeDomain).filter((d): d is string => !!d) : null;
  const fallback = normalizeDomain(orgDomain);
  const role = u.inviteDefaultRole;
  return {
    allowedDomains: stored ?? (fallback ? [fallback] : []),
    autoJoin: u.autoJoin === true,
    inviteDefaultRole: role === "ADMIN" || role === "GUEST" ? role : "MEMBER",
    defaultSpaceIds: Array.isArray(u.defaultSpaceIds) ? u.defaultSpaceIds.filter((x): x is string => typeof x === "string").slice(0, 50) : [],
    inviteExpiryDays: intIn(u.inviteExpiryDays, 1, 90, 7),
  };
}

/**
 * The domains an invitation (or a SCIM create) may go to: the workspace's
 * own domain (else the inviter's), ALWAYS, plus the extra domains on
 * Members > Invite rules. One answer for the invite route, SCIM, and the
 * invite dialogs (GET /api/invitations/rules), so the client never refuses
 * an address the server would take, or the reverse. Adding gmail.com to the
 * rules widens the list; it never locks the workspace out of its own domain.
 * Empty (no domain anywhere) means no lock, which is today's behaviour.
 */
export function inviteDomainsOf(settings: unknown, orgDomain: string | null | undefined, inviterEmail?: string | null): string[] {
  const u = rec(rec(settings).users);
  const stored = Array.isArray(u.allowedDomains) ? u.allowedDomains.map(normalizeDomain).filter((d): d is string => !!d) : [];
  const own = normalizeDomain(orgDomain) ?? normalizeDomain(inviterEmail?.split("@")[1] ?? null);
  return [...new Set([...(own ? [own] : []), ...stored])];
}

/* ───────────────────────── Task system / Apps › Automations ───────────────────────── */

export interface WorkSettings {
  automationsPaused: boolean;
}

export function workSettingsOf(settings: unknown): WorkSettings {
  const w = rec(rec(settings).work);
  return { automationsPaused: w.automationsPaused === true };
}

/* ───────────────────────── Locale & work week ───────────────────────── */

export type WeekStart = "MON" | "SUN";
export type DateFormat = "DMY" | "MDY" | "YMD";
export type TimeFormat = "24h" | "12h";

export interface LocaleSettings {
  timezone: string;
  currency: string;
  fiscalYearStart: number;
  language: string;
  weekStart: WeekStart;
  dateFormat: DateFormat;
  timeFormat: TimeFormat;
}

/**
 * The fiscal start month as a number (tested). The Locale page used to write
 * "MM-01" ("04-01"), the Overview and the default treat it as a number; both
 * read here as the month, and anything else is April, the stored default.
 */
export function fiscalMonthOf(raw: unknown, dflt = 4): number {
  if (typeof raw === "number" && Number.isInteger(raw) && raw >= 1 && raw <= 12) return raw;
  if (typeof raw === "string") {
    const m = /^(\d{1,2})(?:-\d{1,2})?$/.exec(raw.trim());
    if (m) {
      const n = Number(m[1]);
      if (n >= 1 && n <= 12) return n;
    }
  }
  return dflt;
}

export function localeSettingsOf(settings: unknown, currencyFallback = "USD"): LocaleSettings {
  const s = rec(settings);
  const l = rec(s.locale);
  const tz = typeof s.timezone === "string" && s.timezone ? s.timezone : "Asia/Kolkata";
  return {
    timezone: tz,
    currency: typeof s.currency === "string" && /^[A-Za-z]{3}$/.test(s.currency) ? s.currency.toUpperCase() : currencyFallback,
    fiscalYearStart: fiscalMonthOf(s.fiscalYearStart),
    language: typeof s.language === "string" && s.language ? s.language : "en",
    weekStart: l.weekStart === "SUN" ? "SUN" : "MON",
    dateFormat: l.dateFormat === "MDY" || l.dateFormat === "YMD" ? l.dateFormat : "DMY",
    timeFormat: l.timeFormat === "12h" ? "12h" : "24h",
  };
}

export const MONTH_NAMES = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
] as const;

/* ───────────────────────── Scoring & reviews ───────────────────────── */

export const SCORE_WEIGHT_KEYS = ["kpi", "sopCompliance", "behavioral", "peer"] as const;
export type ScoreWeightKey = (typeof SCORE_WEIGHT_KEYS)[number];
export const DEFAULT_FOUR_WEIGHTS: Record<ScoreWeightKey, number> = { kpi: 40, sopCompliance: 20, behavioral: 30, peer: 10 };

/**
 * The four weights the page edits and the review cycle engine reads
 * (src/lib/performance/review-cycle.server.ts orgScoring), from whatever is
 * stored (tested). The older five-key default ({kpi, manager, peer, self,
 * sopCompliance}) is the shape the API used to hand back when nothing was
 * stored; its `manager` and `self` keys were never edited here and are
 * dropped, so the total the page shows is the total that is saved.
 */
export function scoreWeightsOf(settings: unknown): Record<ScoreWeightKey, number> {
  const stored = rec(rec(settings).scoreWeights);
  const out = { ...DEFAULT_FOUR_WEIGHTS };
  const hasAny = SCORE_WEIGHT_KEYS.some((k) => typeof stored[k] === "number");
  if (!hasAny) return out;
  for (const k of SCORE_WEIGHT_KEYS) {
    const v = stored[k];
    if (typeof v === "number" && Number.isFinite(v) && v >= 0 && v <= 100) out[k] = Math.round(v);
  }
  // A five-key legacy blob with no behavioural weight shows the value the
  // review engine actually uses for it (review-cycle.server.ts orgScoring:
  // the default, 30), so the number on the page is the number that scores.
  // If that makes the total differ from 100, the page says so rather than
  // showing a figure no engine applies.
  return out;
}

export function weightsTotal(w: Record<string, number>): number {
  return Object.values(w).reduce((a, b) => a + (Number.isFinite(b) ? b : 0), 0);
}
