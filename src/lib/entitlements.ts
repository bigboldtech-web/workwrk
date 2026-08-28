// Which premium modules an org has turned on. The ONE server-side resolver
// that reads ProductInstallation and answers "is this module active for this
// org". Used by:
//   - getEffectivePreferences (folds the active app keys into /api/preferences
//     so the client rail hides a disabled module), and
//   - the /tlk and /tables server route-gates (a bookmarked URL can't bypass
//     the toggle).
//
// "Active" means an ACTIVE ProductInstallation row. PAUSED, REMOVED, and a
// missing row all read as OFF — never widen the gate to `status != REMOVED`,
// which would let PAUSED through.
//
// Server-only: imports prisma. Never import from a client component.

import { prisma } from "@/lib/prisma";
import { MODULE_BY_SLUG, MODULE_SLUGS } from "@/lib/modules";

/**
 * The rail app keys of every module the org has ACTIVE. Core apps are not
 * modules and never appear here. Returned as an array (JSON-friendly) for the
 * preferences payload; callers that need membership tests wrap it in a Set.
 */
export async function getActiveModuleAppKeys(organizationId: string): Promise<string[]> {
  if (MODULE_SLUGS.length === 0) return [];
  const rows = await prisma.productInstallation.findMany({
    where: {
      organizationId,
      status: "ACTIVE",
      product: { slug: { in: [...MODULE_SLUGS] } },
    },
    select: { product: { select: { slug: true } } },
  });
  const keys: string[] = [];
  for (const row of rows) {
    const mod = MODULE_BY_SLUG[row.product.slug];
    if (mod) keys.push(mod.appKey);
  }
  return keys;
}

/**
 * Route-gate check: is the module backed by `productSlug` ACTIVE for the org.
 * A single indexed count on [organizationId, status].
 */
export async function isModuleActive(organizationId: string, productSlug: string): Promise<boolean> {
  const count = await prisma.productInstallation.count({
    where: { organizationId, status: "ACTIVE", product: { slug: productSlug } },
  });
  return count > 0;
}
