// Hybrid role-template assignment — when a user is hired into or moved to
// a Role, seed their alignment (KRAs + the SOPs that sit under those KRAs)
// from the role's templates. Everything stays editable per-person
// afterward; this only fills the defaults.
//
// No dedicated template tables: a role's KRA templates are KRAs with
// `roleId = role` (Role.kraTemplates), and a role's default SOPs are the
// PUBLISHED SOPs attached to those KRAs (SOP.kraId). Reusing the existing
// relations keeps this migration-free.
//
// Idempotent: both KRAAssignment (@@unique [userId, kraId]) and
// SOPAssignment (@@unique [sopId, userId]) dedupe via createMany
// skipDuplicates, so re-running on the same role is a no-op.

import { prisma } from "@/lib/prisma";

export interface SeedResult {
  krasSeeded: number;
  sopsSeeded: number;
}

export async function seedAlignmentForUser(args: {
  userId: string;
  roleId: string;
  organizationId: string;
  /** Who triggered the seed (recorded on SOPAssignment.assignedBy). */
  assignedBy?: string | null;
}): Promise<SeedResult> {
  const { userId, roleId, organizationId, assignedBy } = args;

  // 1. Role's KRA templates.
  const kras = await prisma.kRA.findMany({
    where: { roleId, organizationId },
    select: { id: true },
  });
  const kraIds = kras.map((k) => k.id);
  if (kraIds.length === 0) return { krasSeeded: 0, sopsSeeded: 0 };

  // 2. Seed KRA assignments (skip ones the person already has).
  const kraRes = await prisma.kRAAssignment.createMany({
    data: kraIds.map((kraId) => ({ userId, kraId })),
    skipDuplicates: true,
  });

  // 3. Published SOPs under those KRAs → seed SOP assignments.
  const sops = await prisma.sOP.findMany({
    where: { kraId: { in: kraIds }, organizationId, status: "PUBLISHED" },
    select: { id: true },
  });
  let sopsSeeded = 0;
  if (sops.length > 0) {
    const sopRes = await prisma.sOPAssignment.createMany({
      data: sops.map((s) => ({ sopId: s.id, userId, mandatory: false, assignedBy: assignedBy ?? null })),
      skipDuplicates: true,
    });
    sopsSeeded = sopRes.count;
  }

  return { krasSeeded: kraRes.count, sopsSeeded };
}


/**
 * The mirror of seedAlignmentForUser: when a KRA is added to a job title
 * (or re-homed onto one), everyone who ALREADY holds that title inherits
 * it immediately. Without this, inheritance only ran at hire/assignment
 * time, so a KRA added to a role later reached nobody — the job title
 * and its holders silently drifted apart.
 *
 * Idempotent: KRAAssignment @@unique([userId, kraId]) + skipDuplicates,
 * so re-running never duplicates and never disturbs existing weightage.
 */
export async function seedKraToRoleHolders(args: {
  kraId: string;
  roleId: string;
  organizationId: string;
}): Promise<{ peopleSeeded: number }> {
  const { kraId, roleId, organizationId } = args;
  const holders = await prisma.user.findMany({
    where: { roleId, organizationId, status: "ACTIVE" },
    select: { id: true },
  });
  if (holders.length === 0) return { peopleSeeded: 0 };
  const res = await prisma.kRAAssignment.createMany({
    data: holders.map((h) => ({ userId: h.id, kraId })),
    skipDuplicates: true,
  });
  return { peopleSeeded: res.count };
}
