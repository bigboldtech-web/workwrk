// The PATCH /api/settings section schemas (settings-architecture 9.3). Pure:
// zod only, so the route and the vitest suite share one definition.
//
// Every section is STRICT: an unknown key is a 400 that names it, never a
// silent strip and never a silent write of arbitrary JSON into
// Organization.settings. The envelope is strict too ({ section, data }, plus
// the one legacy top-level `companyProfile` shape Identity still sends), so a
// second key cannot ride along under a section with a laxer gate (the
// `{ section: "process", companyProfile }` bypass that let the People team
// rewrite the mission).
//
// RETIRED sections answer 400 with `retired: true` and write nothing:
//   notifications  org notification defaults: no UI, no reader (settings
//                  spec open decision 6). The stored object is LEFT IN PLACE
//                  so re-adding the card later with its reader loses nothing.
//   modules        the legacy enabledModules list; ProductInstallation owns
//                  modules (POST/DELETE /api/products/installations).
//
// The `access` and `process` schemas are owned by their libraries and are
// referenced by the route, not redefined here.

import { z } from "zod";
import { normalizeDomain, RETENTION_BOUNDS, SIGN_IN_BOUNDS } from "./org-policy";

export const SPLASH_POLICIES = ["every-open", "first-open-daily", "off"] as const;

const shortText = (max: number) => z.string().max(max);

/** Org name, domain and the locale keys (the `general` section Identity and Locale send). */
export const generalSectionSchema = z.strictObject({
  name: z.string().trim().min(1, "The workspace needs a name").max(120).optional(),
  domain: z.string().trim().max(253).nullable().optional(),
  timezone: shortText(64).optional(),
  currency: z.string().trim().regex(/^[A-Za-z]{3}$/, "Use a three-letter currency code").optional(),
  // A month number, or the older "MM-01" string the Locale page wrote; both
  // are read by src/lib/fiscal-quarter.ts.
  fiscalYearStart: z.union([z.number().int().min(1).max(12), z.string().regex(/^(0[1-9]|1[0-2])-01$/)]).optional(),
  language: shortText(16).optional(),
  reviewFrequency: shortText(32).optional(),
  // The business profile the retired /setup wizard asked for. Its one
  // editor now is Workspace settings > Identity & culture (Business type and
  // Team size); Overview reads them. Free text, as the old wizard stored it.
  businessType: shortText(120).optional(),
  teamSize: shortText(40).optional(),
  // Accepted here for one release (settings spec 9.3); validated by the
  // same scoring validators as the scoring section, never written raw.
  scoreWeights: z.record(z.string(), z.number()).optional(),
  scoringBands: z.array(z.unknown()).optional(),
});

/** Mission, values and the splash policy (Organization.settings.companyProfile). */
export const cultureSectionSchema = z.strictObject({
  mission: shortText(2000).optional(),
  vision: shortText(2000).optional(),
  about: shortText(4000).optional(),
  industry: shortText(200).optional(),
  values: z.array(shortText(200)).max(20).optional(),
  splash: z.enum(SPLASH_POLICIES).optional(),
});

export const scoringSectionSchema = z.strictObject({
  reviewFrequency: shortText(32).optional(),
  scoreWeights: z.record(z.string(), z.number()).optional(),
  scoringBands: z.array(z.unknown()).optional(),
  reviewCadences: z.unknown().optional(),
  behavioralAnchors: z.array(shortText(200)).length(5, "behavioralAnchors must be 5 labels").optional(),
});

/**
 * Security > Sign-in policy (settings-architecture 5.9). Every key is read by
 * src/lib/settings/org-policy.ts signInPolicyOf at sign-in, signup, invite
 * accept, reset and change-password. The FLOORS are in the schema, so no
 * write can make sign-in weaker than the built-in rules: at least 8
 * characters, lockout at most after 20 failures, an idle window no longer
 * than NextAuth's 12h ceiling. `sessionTimeout` and `twoFactorEnabled` are
 * accepted so an older stored shape still round-trips, but nothing reads
 * them.
 */
export const securitySectionSchema = z.strictObject({
  minPasswordLength: z.number().int().min(SIGN_IN_BOUNDS.minPasswordLength.min).max(SIGN_IN_BOUNDS.minPasswordLength.max).optional(),
  requireUppercase: z.boolean().optional(),
  requireNumbers: z.boolean().optional(),
  requireSymbol: z.boolean().optional(),
  passwordMaxAgeDays: z.number().int().min(SIGN_IN_BOUNDS.passwordMaxAgeDays.min).max(SIGN_IN_BOUNDS.passwordMaxAgeDays.max).optional(),
  sessionIdleMinutes: z.number().int().min(SIGN_IN_BOUNDS.sessionIdleMinutes.min).max(SIGN_IN_BOUNDS.sessionIdleMinutes.max).optional(),
  sessionMaxDays: z.number().int().min(SIGN_IN_BOUNDS.sessionMaxDays.min).max(SIGN_IN_BOUNDS.sessionMaxDays.max).optional(),
  mfaRequired: z.enum(["off", "admins", "everyone"]).optional(),
  lockoutThreshold: z.number().int().min(SIGN_IN_BOUNDS.lockoutThreshold.min).max(SIGN_IN_BOUNDS.lockoutThreshold.max).optional(),
  lockoutMinutes: z.number().int().min(SIGN_IN_BOUNDS.lockoutMinutes.min).max(SIGN_IN_BOUNDS.lockoutMinutes.max).optional(),
  sessionTimeout: z.number().int().min(1).max(100000).optional(),
  twoFactorEnabled: z.boolean().optional(),
});

/** Identity & culture > Profile (settings-architecture 5.2, section "profile"). */
export const profileSectionSchema = z.strictObject({
  name: z.string().trim().min(1, "Workspace name is required").max(120).optional(),
  domain: z
    .string()
    .trim()
    .max(253)
    .refine((v) => v === "" || normalizeDomain(v) !== null, "Enter a domain like acme.com")
    .nullable()
    .optional(),
  industry: shortText(200).optional(),
  businessType: shortText(120).optional(),
  teamSize: shortText(40).optional(),
});

/** Locale & work week (settings-architecture 5.15, section "locale"). */
export const localeSectionSchema = z.strictObject({
  timezone: z
    .string()
    .trim()
    .max(64)
    .refine((tz) => {
      try {
        new Intl.DateTimeFormat("en-US", { timeZone: tz });
        return true;
      } catch {
        return false;
      }
    }, "Pick a time zone from the list")
    .optional(),
  currency: z.string().trim().regex(/^[A-Za-z]{3}$/, "Use a three-letter currency code").optional(),
  fiscalYearStart: z.number().int().min(1).max(12).optional(),
  language: shortText(16).optional(),
  weekStart: z.enum(["MON", "SUN"]).optional(),
  dateFormat: z.enum(["DMY", "MDY", "YMD"]).optional(),
  timeFormat: z.enum(["24h", "12h"]).optional(),
});

/**
 * Apps > Automations (section "work"). The org's default task type is NOT
 * here: it is ItemType.isDefault (PATCH /api/item-types/[id]), which the
 * create-task modal reads, so there is one store for it, not two.
 */
export const workSectionSchema = z.strictObject({
  automationsPaused: z.boolean().optional(),
});

/** Members > Pending invites > Invite rules (section "users"). */
export const usersSectionSchema = z.strictObject({
  allowedDomains: z
    .array(z.string().trim().max(253).refine((v) => normalizeDomain(v) !== null, "Enter a domain like acme.com"))
    .max(20)
    .optional(),
  autoJoin: z.boolean().optional(),
  inviteDefaultRole: z.enum(["ADMIN", "MEMBER", "GUEST"]).optional(),
  defaultSpaceIds: z.array(z.string().min(1).max(64)).max(50).optional(),
  inviteExpiryDays: z.number().int().min(1).max(90).optional(),
});

/** Data > Retention & privacy, the two retention rows (section "retention"). */
export const retentionSectionSchema = z.strictObject({
  trashDays: z.number().int().min(RETENTION_BOUNDS.trashDays.min).max(RETENTION_BOUNDS.trashDays.max).optional(),
  // null = keep forever.
  auditDays: z.number().int().min(RETENTION_BOUNDS.auditDays.min).max(RETENTION_BOUNDS.auditDays.max).nullable().optional(),
});

/** Data > Retention & privacy, the privacy rows (section "data"). */
export const dataSectionSchema = z.strictObject({
  selfExport: z.boolean().optional(),
  aiEnabled: z.boolean().optional(),
  // The two AI opt-ins (src/lib/ai/ai-features.ts), off unless true.
  aiFields: z.boolean().optional(),
  aiTalkUpdates: z.boolean().optional(),
});

/**
 * The first-run console (settings-architecture 11.2, spec-account-auth
 * `/onboard`): which wizard step to resume at, and the two one-way flags.
 * The client never sends a date: `complete` and `dismiss` are stamped by
 * the server, so a clock on someone's laptop cannot back-date setup.
 */
export const consoleSectionSchema = z.strictObject({
  setupStep: z.number().int().min(1).max(4).optional(),
  complete: z.literal(true).optional(),
  dismiss: z.literal(true).optional(),
});

export const RETIRED_SETTINGS_SECTIONS = ["notifications", "modules"] as const;

export const LIVE_SETTINGS_SECTIONS = [
  "general",
  "profile",
  "culture",
  "locale",
  "work",
  "users",
  "retention",
  "data",
  "scoring",
  "security",
  "access",
  "process",
  "console",
] as const;
export type LiveSettingsSection = (typeof LIVE_SETTINGS_SECTIONS)[number];

/** The request envelope. `companyProfile` at the top level is Identity's legacy shape for `culture`. */
export const settingsEnvelopeSchema = z.union([
  z.strictObject({ section: z.string().min(1).max(40), data: z.unknown().optional() }),
  z.strictObject({ companyProfile: z.unknown() }),
]);

export type ParsedEnvelope =
  | { kind: "section"; section: string; data: unknown }
  | { kind: "error"; status: 400; error: string; retired?: boolean };

/** Normalise the body into one `{ section, data }` (tested). */
export function parseSettingsEnvelope(body: unknown): ParsedEnvelope {
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    return { kind: "error", status: 400, error: "Send { section, data }" };
  }
  const keys = Object.keys(body as Record<string, unknown>);
  const parsed = settingsEnvelopeSchema.safeParse(body);
  if (!parsed.success) {
    const extra = keys.filter((k) => k !== "section" && k !== "data");
    return {
      kind: "error",
      status: 400,
      error: extra.length > 0 ? `Unknown key: ${extra.join(", ")}` : "Send { section, data }",
    };
  }
  const v = parsed.data as { section?: string; data?: unknown; companyProfile?: unknown };
  if ("companyProfile" in v) return { kind: "section", section: "culture", data: v.companyProfile };
  const section = v.section as string;
  if ((RETIRED_SETTINGS_SECTIONS as readonly string[]).includes(section)) {
    return { kind: "error", status: 400, error: `The ${section} section is retired`, retired: true };
  }
  if (!(LIVE_SETTINGS_SECTIONS as readonly string[]).includes(section)) {
    return { kind: "error", status: 400, error: `Unknown section: ${section}` };
  }
  return { kind: "section", section, data: v.data ?? {} };
}

/** A zod failure as one sentence that names the key (tested). */
export function describeIssue(error: z.ZodError, section: string): string {
  const first = error.issues[0];
  if (!first) return `Invalid ${section} settings`;
  const path = first.path.map(String).join(".");
  if (first.code === "unrecognized_keys") {
    const keys = (first as unknown as { keys?: string[] }).keys ?? [];
    return `Unknown ${section} setting: ${[path, keys.join(", ")].filter(Boolean).join(".")}`;
  }
  return `${section}${path ? `.${path}` : ""}: ${first.message}`;
}
