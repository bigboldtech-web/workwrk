import { prisma } from "@/lib/prisma";
import { getSessionOrFail, getOrgId, jsonSuccess, LOOKUP_CACHE_HEADERS } from "@/lib/api-helpers";

/**
 * GET /api/organization/features — Enterprise feature flags for the
 * caller's org. Used by the customer-side Settings page to decide
 * whether to render the AI / Branding tabs.
 *
 * Plan + flags are not secrets, but the response is org-scoped: any
 * authenticated member can read their own org's flags.
 */
export async function GET() {
  const { error, session } = await getSessionOrFail();
  if (error) return error;
  const orgId = getOrgId(session);

  const org = await prisma.organization.findUnique({
    where: { id: orgId },
    select: { plan: true, settings: true },
  });
  if (!org) return jsonSuccess({ plan: "STARTER", features: {} });

  const settings = (org.settings ?? {}) as Record<string, unknown>;
  const features = (settings.features ?? {}) as Record<string, boolean>;

  return jsonSuccess({
    plan: org.plan,
    features: {
      byok: !!features.byok,
      whiteLabel: !!features.whiteLabel,
      customDomain: !!features.customDomain,
    },
  }, 200, LOOKUP_CACHE_HEADERS);
}
