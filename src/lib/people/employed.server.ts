import { prisma } from "@/lib/prisma";
import { inWorkspaceWhere } from "@/lib/access/acting-workspace";

/**
 * Of `ids`, the people in this workspace that work can still be given to:
 * not removed and not deactivated (on leave, on probation and serving notice
 * included). The routes that took a body's ids as given stored the row, sent
 * the notice and emailed the address for a colleague who had left, and for
 * an id from another workspace. Keeps the input's order and drops repeats.
 * "In this workspace" is anchored here or a membership here (docs-found
 * fixes batch 5): someone who last switched to another workspace still
 * works here and can still be given work here.
 */
export async function employedAmong(organizationId: string, ids: readonly unknown[]): Promise<string[]> {
  const wanted = [...new Set(ids.filter((x): x is string => typeof x === "string" && x.length > 0 && x.length <= 64))];
  if (wanted.length === 0) return [];
  // By id first ("User_pkey"), so inWorkspaceWhere only filters the people
  // asked about (batch 6).
  const rows = await prisma.user.findMany({
    where: { id: { in: wanted }, deletedAt: null, status: { not: "INACTIVE" }, ...inWorkspaceWhere(organizationId) },
    select: { id: true },
  });
  const ok = new Set(rows.map((r) => r.id));
  return wanted.filter((id) => ok.has(id));
}
