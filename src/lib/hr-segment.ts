// HR segments — which slice of the org an HR user owns. Large companies
// have HR people who own specific business units, regions, role tiers,
// or departments rather than the whole org. The Phase 6 access resolver
// uses these to scope HR's read access at query time.
//
// Scope schema (JSON, all optional):
//   { departmentIds?: string[], businessUnitIds?: string[],
//     regionIds?: string[], roleLevels?: string[], officeIds?: string[] }
// Empty scope = unscoped HR (sees everyone in the org).

import { prisma } from "@/lib/prisma";

export interface HRScope {
  departmentIds?: string[];
  businessUnitIds?: string[];
  regionIds?: string[];
  roleLevels?: string[];
  officeIds?: string[];
}

export interface HRSegmentSummary {
  id: string;
  name: string;
  ownerId: string;
  scope: HRScope;
  isActive: boolean;
}

export async function listHRSegmentsForOrg(organizationId: string, opts: { includeInactive?: boolean } = {}): Promise<HRSegmentSummary[]> {
  const rows = await prisma.hRSegment.findMany({
    where: {
      organizationId,
      ...(opts.includeInactive ? {} : { isActive: true }),
    },
    orderBy: { createdAt: "asc" },
  });
  return rows.map((r) => ({
    id: r.id,
    name: r.name,
    ownerId: r.ownerId,
    scope: (r.scope as HRScope) ?? {},
    isActive: r.isActive,
  }));
}

export async function listHRSegmentsForUser(userId: string): Promise<HRSegmentSummary[]> {
  const rows = await prisma.hRSegment.findMany({
    where: { ownerId: userId, isActive: true },
    orderBy: { createdAt: "asc" },
  });
  return rows.map((r) => ({
    id: r.id,
    name: r.name,
    ownerId: r.ownerId,
    scope: (r.scope as HRScope) ?? {},
    isActive: r.isActive,
  }));
}

export interface CreateHRSegmentInput {
  organizationId: string;
  ownerId: string;
  name: string;
  scope?: HRScope;
}

export async function createHRSegment(input: CreateHRSegmentInput) {
  const trimmed = input.name.trim();
  if (!trimmed) throw new Error("Segment name is required");
  return prisma.hRSegment.create({
    data: {
      organizationId: input.organizationId,
      ownerId: input.ownerId,
      name: trimmed,
      scope: (input.scope ?? {}) as unknown as object,
    },
  });
}

export interface UpdateHRSegmentInput {
  name?: string;
  scope?: HRScope;
  isActive?: boolean;
}

export async function updateHRSegment(segmentId: string, patch: UpdateHRSegmentInput) {
  const data: Record<string, unknown> = {};
  if (patch.name !== undefined) {
    const trimmed = patch.name.trim();
    if (!trimmed) throw new Error("Segment name cannot be empty");
    data.name = trimmed;
  }
  if (patch.scope !== undefined) data.scope = patch.scope as unknown as object;
  if (patch.isActive !== undefined) data.isActive = patch.isActive;
  return prisma.hRSegment.update({ where: { id: segmentId }, data });
}

export async function deleteHRSegment(segmentId: string) {
  return prisma.hRSegment.delete({ where: { id: segmentId } });
}

/**
 * Resolve: does this target user fall inside any of the HR user's
 * segments? Used by the access resolver to decide whether the HR user
 * can read the target's row. An HR user with zero segments has no
 * implicit scope — they see nothing until a segment is granted.
 *
 * Matching logic per segment (any-of):
 *   - empty scope ⇒ unscoped (matches everyone in the org)
 *   - departmentIds matches if target's departmentId is included
 *   - officeIds matches if target's officeId is included
 *   - roleLevels matches if target's accessLevel is included
 *   - businessUnitIds / regionIds — placeholder until we wire those
 *     dimensions onto User (Phase 7 cohesion pass).
 */
export async function hrCanReadUser(hrUserId: string, targetUserId: string): Promise<boolean> {
  const [segments, target] = await Promise.all([
    listHRSegmentsForUser(hrUserId),
    prisma.user.findUnique({
      where: { id: targetUserId },
      select: { departmentId: true, officeId: true, accessLevel: true, organizationId: true },
    }),
  ]);
  if (!target) return false;
  if (segments.length === 0) return false;

  for (const seg of segments) {
    const sc = seg.scope;
    const isEmpty =
      !sc ||
      ((!sc.departmentIds || sc.departmentIds.length === 0) &&
        (!sc.officeIds || sc.officeIds.length === 0) &&
        (!sc.roleLevels || sc.roleLevels.length === 0) &&
        (!sc.businessUnitIds || sc.businessUnitIds.length === 0) &&
        (!sc.regionIds || sc.regionIds.length === 0));
    if (isEmpty) return true;
    if (sc.departmentIds?.length && target.departmentId && sc.departmentIds.includes(target.departmentId)) return true;
    if (sc.officeIds?.length && target.officeId && sc.officeIds.includes(target.officeId)) return true;
    if (sc.roleLevels?.length && sc.roleLevels.includes(target.accessLevel)) return true;
    // businessUnitIds / regionIds — wired in Phase 7 once those FKs land on User.
  }
  return false;
}
