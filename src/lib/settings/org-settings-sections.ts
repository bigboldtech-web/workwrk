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
 * The org password policy (read by src/lib/password-policy.ts at signup,
 * accept-invite, reset and change-password). The length floor is 8 here AND
 * in validatePassword, so no write can make passwords weaker than the
 * built-in rule. `sessionTimeout` and `twoFactorEnabled` are accepted so an
 * older stored shape still round-trips, but nothing enforces them (the real
 * idle window and the MFA gate live in src/lib/auth.ts and the env flags);
 * the pages that displayed them as live policy no longer do.
 */
export const securitySectionSchema = z.strictObject({
  minPasswordLength: z.number().int().min(8).max(128).optional(),
  requireUppercase: z.boolean().optional(),
  requireNumbers: z.boolean().optional(),
  sessionTimeout: z.number().int().min(1).max(100000).optional(),
  twoFactorEnabled: z.boolean().optional(),
});

export const RETIRED_SETTINGS_SECTIONS = ["notifications", "modules"] as const;

export const LIVE_SETTINGS_SECTIONS = ["general", "culture", "scoring", "security", "access", "process"] as const;
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
