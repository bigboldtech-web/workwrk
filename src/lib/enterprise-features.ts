import { prisma } from "@/lib/prisma";

/**
 * Enterprise feature flags.
 *
 * These are paid add-ons that WorkwrK staff enable per-customer from
 * the /admin panel. Two gates have to be true for a feature to be on:
 *
 *   1. The org's plan is ENTERPRISE.
 *   2. The corresponding flag inside Organization.settings.features
 *      is `true` (default `false`).
 *
 * Putting the flags inside the existing Json `settings` column keeps
 * the migration story simple — no schema bump needed when we add a
 * new feature later.
 */

export type EnterpriseFeature = "byok" | "whiteLabel" | "customDomain";

interface FeatureFlags {
  byok?: boolean;
  whiteLabel?: boolean;
  customDomain?: boolean;
}

interface FeatureCheck {
  enabled: boolean;
  reason: "ok" | "not_enterprise" | "not_enabled" | "no_org";
}

function readFlags(settings: unknown): FeatureFlags {
  if (settings && typeof settings === "object" && "features" in settings) {
    const f = (settings as { features?: FeatureFlags }).features;
    return f ?? {};
  }
  return {};
}

/** Ground-truth check: does this org have access to a feature? */
export async function hasFeature(
  organizationId: string,
  feature: EnterpriseFeature,
): Promise<FeatureCheck> {
  const org = await prisma.organization.findUnique({
    where: { id: organizationId },
    select: { plan: true, settings: true },
  });
  if (!org) return { enabled: false, reason: "no_org" };
  if (org.plan !== "ENTERPRISE") return { enabled: false, reason: "not_enterprise" };
  const flags = readFlags(org.settings);
  if (!flags[feature]) return { enabled: false, reason: "not_enabled" };
  return { enabled: true, reason: "ok" };
}

/** Mutator. Used by the WorkwrK admin /admin/companies/[id] view. */
export async function setFeature(
  organizationId: string,
  feature: EnterpriseFeature,
  enabled: boolean,
): Promise<void> {
  const org = await prisma.organization.findUnique({
    where: { id: organizationId },
    select: { settings: true },
  });
  if (!org) throw new Error("Org not found");
  const current = (org.settings && typeof org.settings === "object" ? org.settings : {}) as Record<string, unknown>;
  const features = (current.features && typeof current.features === "object" ? current.features : {}) as FeatureFlags;
  features[feature] = enabled;
  await prisma.organization.update({
    where: { id: organizationId },
    data: { settings: { ...current, features: features as Record<string, boolean> } },
  });
}

/** Read all flags for an org. Used by the customer-side Settings UI
 *  to decide whether to render the Branding / AI tabs. */
export async function getFeatures(organizationId: string): Promise<FeatureFlags & { plan: string }> {
  const org = await prisma.organization.findUnique({
    where: { id: organizationId },
    select: { plan: true, settings: true },
  });
  if (!org) return { plan: "STARTER" };
  return { plan: org.plan, ...readFlags(org.settings) };
}
