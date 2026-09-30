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
//              symbol off, no expiry, 12h idle (NextAuth's maxAge ceiling),
//              30 days absolute, two-factor "off" (enrolled people are still
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
  // 12 hours is NextAuth's session.maxAge ceiling (src/lib/auth.ts): the org
  // value can only narrow it.
  sessionIdleMinutes: { min: 30, max: 720 },
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
  sessionIdleMinutes: 720,
  sessionMaxDays: 30,
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
    sessionIdleMinutes: intIn(s.sessionIdleMinutes, b.sessionIdleMinutes.min, b.sessionIdleMinutes.max, d.sessionIdleMinutes),
    sessionMaxDays: intIn(s.sessionMaxDays, b.sessionMaxDays.min, b.sessionMaxDays.max, d.sessionMaxDays),
    mfaRequired: mfaRequirementOf(settings),
    lockoutThreshold: intIn(s.lockoutThreshold, b.lockoutThreshold.min, b.lockoutThreshold.max, d.lockoutThreshold),
    lockoutMinutes: intIn(s.lockoutMinutes, b.lockoutMinutes.min, b.lockoutMinutes.max, d.lockoutMinutes),
  };
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
}

export function dataSettingsOf(settings: unknown): DataSettings {
  const d = rec(rec(settings).data);
  return { selfExport: d.selfExport !== false, aiEnabled: d.aiEnabled !== false };
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
  // A five-key legacy blob with no behavioural weight: fill it so the four
  // add up to 100 when the other three leave room, rather than showing a
  // total the engine never meant.
  if (typeof stored.behavioral !== "number") {
    const rest = out.kpi + out.sopCompliance + out.peer;
    out.behavioral = rest <= 100 ? 100 - rest : 0;
  }
  return out;
}

export function weightsTotal(w: Record<string, number>): number {
  return Object.values(w).reduce((a, b) => a + (Number.isFinite(b) ? b : 0), 0);
}
