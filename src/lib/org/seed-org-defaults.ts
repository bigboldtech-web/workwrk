// seedOrgDefaults (settings-architecture 11.1): everything a brand new
// workspace needs to be complete the moment it exists, so first run is an
// offer and never a gate (spec-account-auth `/onboard`, access correction 2).
//
// Called from BOTH org-create paths, inside their create transaction:
// POST /api/auth/register (self-serve signup) and POST /api/organizations/
// create (Create a workspace from the workspace menu). What it writes:
//   - the six default departments (the list both routes used to inline);
//   - Organization.settings keys, each only when absent, so a retry never
//     overwrites a value someone already changed: the locale defaults (time
//     zone from the creator's browser, else the workspace they create it
//     from, else Asia/Kolkata; currency and fiscal month by that zone,
//     localeForZone; language en), the sign-in password rules the code
//     enforces today (8 characters, an uppercase letter, a number), the ten
//     access toggles at their access-model section 8 defaults, trash
//     retention 60 days, and the setup console at step 1 with nothing done;
//   - the core ProductInstallation rows (DEFAULT_INSTALLED_SLUGS: the
//     catalog's defaultEnabled products, Work and People), which the
//     retired POST /api/setup used to write, so the Store and the staff
//     console list a new workspace's installed apps as they did.
// What it does NOT write, on purpose:
//   - premium modules: new orgs have Talk and Tables off, which is the
//     ABSENCE of a ProductInstallation row (they are not defaultEnabled);
//   - org notification defaults, the legacy enabledModules list or any
//     businessType / industry / teamSize value (retired or fabricated);
//   - sessionTimeout or twoFactorEnabled: nothing enforces them, so writing
//     them would put an untrue policy in the record.
// The General Space is seeded AFTER the transaction by seedStarterSpace,
// through the same createSpace and createBoard the Spaces API uses, so it
// gets the canonical statuses and a first List; a failure there is logged
// and never undoes the new workspace.

import type { Prisma } from "@/generated/prisma";
import { prisma } from "@/lib/prisma";
import { DEFAULT_ACCESS_SETTINGS } from "@/lib/access/settings";
import { DEFAULT_PASSWORD_POLICY } from "@/lib/password-policy";
import { DEFAULT_TRASH_DAYS } from "@/lib/trash-view";
import { DEFAULT_INSTALLED_SLUGS } from "@/lib/products/catalog";
import { DEFAULT_DEPARTMENTS } from "./default-departments";

type Tx = Prisma.TransactionClient;

export { DEFAULT_DEPARTMENTS };

export const DEFAULT_ORG_TIMEZONE = "Asia/Kolkata";

const INDIA_ZONES = new Set(["Asia/Kolkata", "Asia/Calcutta"]);

// The currency and fiscal start month a workspace most likely uses, by the
// creator's time zone. A zone that is not listed falls back to USD and
// January, which Locale changes in one step. Only currencies the app
// formats (src/lib/currency.ts) are named.
const EURO_ZONES = [
  "Europe/Amsterdam", "Europe/Athens", "Europe/Berlin", "Europe/Bratislava", "Europe/Brussels", "Europe/Dublin", "Europe/Helsinki",
  "Europe/Lisbon", "Europe/Ljubljana", "Europe/Luxembourg", "Europe/Madrid", "Europe/Malta", "Europe/Paris", "Europe/Riga",
  "Europe/Rome", "Europe/Tallinn", "Europe/Vienna", "Europe/Vilnius", "Europe/Zagreb",
];
const ZONE_LOCALE: Record<string, { currency: string; fiscalYearStart: number }> = {
  ...Object.fromEntries(EURO_ZONES.map((z) => [z, { currency: "EUR", fiscalYearStart: 1 }])),
  "Europe/London": { currency: "GBP", fiscalYearStart: 4 },
  "Europe/Zurich": { currency: "CHF", fiscalYearStart: 1 },
  "Europe/Stockholm": { currency: "SEK", fiscalYearStart: 1 },
  "Europe/Oslo": { currency: "NOK", fiscalYearStart: 1 },
  "Europe/Copenhagen": { currency: "DKK", fiscalYearStart: 1 },
  "Europe/Warsaw": { currency: "PLN", fiscalYearStart: 1 },
  "America/Toronto": { currency: "CAD", fiscalYearStart: 1 },
  "America/Vancouver": { currency: "CAD", fiscalYearStart: 1 },
  "America/Edmonton": { currency: "CAD", fiscalYearStart: 1 },
  "America/Winnipeg": { currency: "CAD", fiscalYearStart: 1 },
  "America/Halifax": { currency: "CAD", fiscalYearStart: 1 },
  "America/Mexico_City": { currency: "MXN", fiscalYearStart: 1 },
  "America/Sao_Paulo": { currency: "BRL", fiscalYearStart: 1 },
  "Australia/Sydney": { currency: "AUD", fiscalYearStart: 7 },
  "Australia/Melbourne": { currency: "AUD", fiscalYearStart: 7 },
  "Australia/Brisbane": { currency: "AUD", fiscalYearStart: 7 },
  "Australia/Perth": { currency: "AUD", fiscalYearStart: 7 },
  "Australia/Adelaide": { currency: "AUD", fiscalYearStart: 7 },
  "Pacific/Auckland": { currency: "NZD", fiscalYearStart: 4 },
  "Asia/Tokyo": { currency: "JPY", fiscalYearStart: 4 },
  "Asia/Seoul": { currency: "KRW", fiscalYearStart: 1 },
  "Asia/Shanghai": { currency: "CNY", fiscalYearStart: 1 },
  "Asia/Singapore": { currency: "SGD", fiscalYearStart: 1 },
  "Asia/Dubai": { currency: "AED", fiscalYearStart: 1 },
  "Asia/Riyadh": { currency: "SAR", fiscalYearStart: 1 },
  "Asia/Jerusalem": { currency: "ILS", fiscalYearStart: 1 },
};

/** The currency and fiscal start month for a zone (pure; tested). */
export function localeForZone(timezone: string): { currency: string; fiscalYearStart: number } {
  if (INDIA_ZONES.has(timezone)) return { currency: "INR", fiscalYearStart: 4 };
  return ZONE_LOCALE[timezone] ?? { currency: "USD", fiscalYearStart: 1 };
}

/** An IANA zone the runtime knows, or null. */
export function validTimeZone(tz: unknown): string | null {
  if (typeof tz !== "string" || !tz.trim() || tz.length > 64) return null;
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: tz.trim() });
    return tz.trim();
  } catch {
    return null;
  }
}

/** The Organization.settings keys a new workspace starts with (pure; tested). */
export function orgDefaultSettings(input: { timezone?: string | null } = {}): Record<string, unknown> {
  const timezone = validTimeZone(input.timezone) ?? DEFAULT_ORG_TIMEZONE;
  const { currency, fiscalYearStart } = localeForZone(timezone);
  return {
    timezone,
    currency,
    fiscalYearStart,
    language: "en",
    security: {
      minPasswordLength: DEFAULT_PASSWORD_POLICY.minPasswordLength,
      requireUppercase: DEFAULT_PASSWORD_POLICY.requireUppercase,
      requireNumbers: DEFAULT_PASSWORD_POLICY.requireNumbers,
    },
    access: { ...DEFAULT_ACCESS_SETTINGS },
    retention: { trashDays: DEFAULT_TRASH_DAYS },
    console: { setupStep: 1, setupCompletedAt: null, setupDismissedAt: null },
  };
}

/** Only the defaults whose key the org does not hold yet (a retry never overwrites). */
export function missingDefaults(current: unknown, defaults: Record<string, unknown>): Record<string, unknown> {
  const have = current && typeof current === "object" && !Array.isArray(current) ? (current as Record<string, unknown>) : {};
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(defaults)) if (!(k in have)) out[k] = v;
  return out;
}

export interface SeedResult {
  departmentsCreated: number;
  settingsKeys: string[];
  productsInstalled: number;
}

export async function seedOrgDefaults(tx: Tx, input: { organizationId: string; timezone?: string | null; userId?: string | null }): Promise<SeedResult> {
  const org = await tx.organization.findUnique({ where: { id: input.organizationId }, select: { settings: true } });
  if (!org) throw new Error("seedOrgDefaults: organization not found");

  const existing = await tx.department.findMany({ where: { organizationId: input.organizationId }, select: { name: true } });
  const have = new Set(existing.map((d) => d.name.toLowerCase()));
  const toCreate = DEFAULT_DEPARTMENTS.filter((n) => !have.has(n.toLowerCase()));
  if (toCreate.length > 0) {
    await tx.department.createMany({ data: toCreate.map((name) => ({ name, organizationId: input.organizationId })) });
  }

  const patch = missingDefaults(org.settings, orgDefaultSettings({ timezone: input.timezone }));
  if (Object.keys(patch).length > 0) {
    const current = org.settings && typeof org.settings === "object" && !Array.isArray(org.settings) ? (org.settings as Record<string, unknown>) : {};
    await tx.organization.update({
      where: { id: input.organizationId },
      data: { settings: { ...current, ...patch } as Prisma.InputJsonValue },
    });
  }
  // Core installs, create-only (skipDuplicates on the org and product
  // pair): a retry never revives an app someone removed. A catalog row that
  // is not seeded yet (scripts/seed-products.ts runs at deploy) is skipped.
  let productsInstalled = 0;
  if (DEFAULT_INSTALLED_SLUGS.length > 0) {
    const products = await tx.product.findMany({ where: { slug: { in: DEFAULT_INSTALLED_SLUGS } }, select: { id: true } });
    if (products.length > 0) {
      const made = await tx.productInstallation.createMany({
        data: products.map((p) => ({ organizationId: input.organizationId, productId: p.id, installedById: input.userId ?? null, status: "ACTIVE" as const })),
        skipDuplicates: true,
      });
      productsInstalled = made.count;
    }
  }
  return { departmentsCreated: toCreate.length, settingsKeys: Object.keys(patch), productsInstalled };
}

/**
 * The "General" Space (settings-architecture 11.1 "First Space"): open to
 * the whole workspace (visibility ORG), the creator its Owner, with one
 * starter List. Runs only when the org has no Space yet, so a retry or a
 * second call never makes a second one. Best effort: returns null and logs
 * on failure; the workspace itself is already complete.
 */
export async function seedStarterSpace(input: { organizationId: string; userId: string }): Promise<{ spaceId: string } | null> {
  try {
    const count = await prisma.space.count({ where: { organizationId: input.organizationId } });
    if (count > 0) return null;
    const { createSpace } = await import("@/lib/space");
    const { createBoard } = await import("@/lib/board");
    const space = await createSpace({
      organizationId: input.organizationId,
      userId: input.userId,
      name: "General",
      description: "Everyone in the workspace can see this Space.",
      visibility: "ORG",
    });
    try {
      await createBoard({ organizationId: input.organizationId, userId: input.userId, spaceId: space.id, name: "Tasks" });
    } catch (err) {
      console.error("[seedStarterSpace] starter List failed", err);
    }
    return { spaceId: space.id };
  } catch (err) {
    console.error("[seedStarterSpace] General Space failed", err);
    return null;
  }
}
