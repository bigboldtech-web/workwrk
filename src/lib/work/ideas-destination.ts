// Where the retired Ideas app's rows went.
//
// scripts/migrate-ideas.ts copies every `Idea` onto an Item on one List per
// org, and writes `Board.settings.legacyIdeasList = true` on that List as it
// creates it. The marker is what makes the destination findable later without
// guessing: matching on the NAME alone would, in a workspace where somebody
// already keeps a real list called "Ideas", point this at their board and
// call it the migration's work. The marker is checked first for that reason;
// the name is the fallback for a List the migration adopted rather than made.
//
// Server-only: it reads prisma.

import { prisma } from "@/lib/prisma";

export interface MigratedIdeasList {
  id: string;
  slug: string;
}

/**
 * The org's migrated Ideas List, or null when the migration has not run here.
 *
 * Never throws. `Board.settings` is a Json column that has always existed, so
 * the marked query is safe, but a reader of a retired app must degrade to
 * "no destination" rather than 500 a page, so the whole thing is caught.
 */
export async function findMigratedIdeasList(
  organizationId: string | null | undefined,
): Promise<MigratedIdeasList | null> {
  if (!organizationId) return null;
  try {
    const marked = await prisma.board.findFirst({
      where: {
        organizationId,
        archivedAt: null,
        settings: { path: ["legacyIdeasList"], equals: true },
      },
      select: { id: true, slug: true },
    });
    if (marked) return marked;
    return await prisma.board.findFirst({
      where: { organizationId, archivedAt: null, name: "Ideas" },
      select: { id: true, slug: true },
    });
  } catch {
    return null;
  }
}
