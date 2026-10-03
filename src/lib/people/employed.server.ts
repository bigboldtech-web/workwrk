import { prisma } from "@/lib/prisma";

/**
 * Of `ids`, the people in this workspace that work can still be given to:
 * not removed and not deactivated (on leave, on probation and serving notice
 * included). The routes that took a body's ids as given stored the row, sent
 * the notice and emailed the address for a colleague who had left, and for
 * an id from another workspace. Keeps the input's order and drops repeats.
 */
export async function employedAmong(organizationId: string, ids: readonly unknown[]): Promise<string[]> {
  const wanted = [...new Set(ids.filter((x): x is string => typeof x === "string" && x.length > 0 && x.length <= 64))];
  if (wanted.length === 0) return [];
  const rows = await prisma.user.findMany({
    where: { id: { in: wanted }, organizationId, deletedAt: null, status: { not: "INACTIVE" } },
    select: { id: true },
  });
  const ok = new Set(rows.map((r) => r.id));
  return wanted.filter((id) => ok.has(id));
}
