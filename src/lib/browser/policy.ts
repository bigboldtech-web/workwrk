// A workspace's two site lists as every Google allow print reads them
// (review of Phase 4 step 1): a teammate's reach is its own sites within the
// workspace's allow list, less what its block list holds (sites.ts
// reachPrintInput), so an allow's "sites" part is worked out from both, read
// fresh wherever an allow is given, compared or shown
// (teammate-print.ts sitesPrint). No row: no lists, so every teammate's
// reach is empty, which is the print every allow kept before Phase 4 has.
//
// Server-only: imports prisma.

import type { Prisma } from "@/generated/prisma";
import { prisma } from "@/lib/prisma";
import { NO_WORKSPACE_SITES, type WorkspaceSites } from "./sites";

/**
 * The workspace's allow and block lists now, or none when it has no policy
 * row. `db` is the caller's transaction when the allow it decides is
 * written in one (the allow route), so the lists it compares are the ones
 * it stores.
 */
export async function workspaceSitesOf(organizationId: string, db: Prisma.TransactionClient = prisma): Promise<WorkspaceSites> {
  const row = await db.teammateBrowserPolicy.findUnique({ where: { organizationId }, select: { allowSites: true, blockSites: true } });
  if (!row) return NO_WORKSPACE_SITES;
  return { allow: Array.isArray(row.allowSites) ? row.allowSites : [], block: Array.isArray(row.blockSites) ? row.blockSites : [] };
}
