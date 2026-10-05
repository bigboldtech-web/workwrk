// Server half of the module plan rule (src/lib/modules.ts,
// moduleNeedsUpgrade): reads the workspace's plan and whether it has EVER
// had the module (an installation row in any status: on, paused or removed).
//
// Server-only: imports prisma.

import { prisma } from "@/lib/prisma";
import { MODULE_BY_SLUG, moduleNeedsUpgrade } from "@/lib/modules";

export async function moduleNeedsUpgradeFor(organizationId: string, productSlug: string): Promise<boolean> {
  if (!MODULE_BY_SLUG[productSlug]) return false;
  const [org, ever] = await Promise.all([
    prisma.organization.findUnique({ where: { id: organizationId }, select: { plan: true } }),
    prisma.productInstallation.count({ where: { organizationId, product: { slug: productSlug } } }),
  ]);
  return moduleNeedsUpgrade(org?.plan ? String(org.plan) : null, ever > 0);
}
