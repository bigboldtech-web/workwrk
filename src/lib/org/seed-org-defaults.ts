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
//     zone from the signup browser else Asia/Kolkata, currency and fiscal
//     month by that zone, language en), the sign-in password rules the code
//     enforces today (8 characters, an uppercase letter, a number), the ten
//     access toggles at their access-model section 8 defaults, trash
//     retention 60 days, and the setup console at step 1 with nothing done.
// What it does NOT write, on purpose:
//   - modules: new orgs have Talk and Tables off, which is the ABSENCE of a
//     ProductInstallation row;
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

type Tx = Prisma.TransactionClient;

export const DEFAULT_DEPARTMENTS = ["Engineering", "Sales", "Marketing", "Operations", "HR", "Finance"] as const;

export const DEFAULT_ORG_TIMEZONE = "Asia/Kolkata";

const INDIA_ZONES = new Set(["Asia/Kolkata", "Asia/Calcutta"]);

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
  const india = INDIA_ZONES.has(timezone);
  return {
    timezone,
    currency: india ? "INR" : "USD",
    fiscalYearStart: india ? 4 : 1,
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
}

export async function seedOrgDefaults(tx: Tx, input: { organizationId: string; timezone?: string | null }): Promise<SeedResult> {
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
  return { departmentsCreated: toCreate.length, settingsKeys: Object.keys(patch) };
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
