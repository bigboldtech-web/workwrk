import "server-only";
import { sessionOnLegacyManagerTier } from "@/lib/page-gates";
import { viewerFromSession } from "@/lib/access/viewer";
import { prisma } from "@/lib/prisma";
import { jobTitleWriterByFacts } from "./job-title-access";

/** May this session create, rename or delete a job title? The legacy tier or the facts. */
export async function mayWriteJobTitles(session: unknown): Promise<boolean> {
  if (await sessionOnLegacyManagerTier(session)) return true;
  const v = await viewerFromSession();
  if (!v || v.orgRole === "GUEST") return false;
  return jobTitleWriterByFacts(v);
}

/**
 * The job title of this workspace already called `title` (any case,
 * trimmed), other than `exceptId` (final Settings review, M2). Role holds a
 * unique (title, organizationId), but only an exact one: "Designer" beside
 * "designer" was accepted, and an exact copy was an unhandled 500.
 */
export async function jobTitleNamed(organizationId: string, title: string, exceptId?: string): Promise<{ id: string; title: string } | null> {
  return prisma.role.findFirst({
    where: { organizationId, title: { equals: title.trim(), mode: "insensitive" }, ...(exceptId ? { id: { not: exceptId } } : {}) },
    select: { id: true, title: true },
  });
}

/** What a refused name says. */
export const jobTitleNameTaken = (title: string) => `A job title called ${title} already exists.`;

/** The unique (title, organizationId) refusing a write that raced the check above. */
export function isUniqueViolation(err: unknown): boolean {
  return typeof err === "object" && err !== null && (err as { code?: unknown }).code === "P2002";
}
