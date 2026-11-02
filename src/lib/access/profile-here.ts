// A person's profile as one workspace shows it (docs/plans/workspace-status.md
// D18, the step 3 review H2): a department, job role or office only when it
// is THIS workspace's own, and a manager only while that manager holds a
// seat here. Since D18 a move swaps the profile with the level, so an
// account's department is the workspace it is anchored to; this is the
// defence in depth for rows written before (or by a path that forgot), so no
// surface ever names another company's department, title, office or people.
// Every surface that shows those fields reads them through here: Members,
// the person's record, the Directory, the Org chart and the export.

import type { Prisma, PrismaClient } from "@/generated/prisma";
import { prisma } from "@/lib/prisma";
import { levelsHeldIn } from "./acting-workspace";

type Db = PrismaClient | Prisma.TransactionClient;

/**
 * The row (a Department, Role or Office, read with its organizationId) when
 * it belongs to this workspace, without the organizationId; null otherwise.
 */
export function ownHere<T extends { organizationId: string }>(row: T | null | undefined, organizationId: string): Omit<T, "organizationId"> | null {
  if (!row || row.organizationId !== organizationId) return null;
  const { organizationId: _own, ...rest } = row;
  void _own;
  return rest;
}

/**
 * Of these managers, the ones who hold a seat here, deactivated or not (kept
 * seats, as a record names them): anchored here, or a membership here not
 * removed. Anyone else is never named here.
 */
export async function managersWithSeatHere(organizationId: string, ids: ReadonlyArray<string | null | undefined>, db: Db = prisma): Promise<Set<string>> {
  const want = [...new Set(ids.filter((x): x is string => !!x))];
  if (want.length === 0) return new Set();
  return new Set((await levelsHeldIn(organizationId, want, db, { keptSeats: true })).keys());
}
