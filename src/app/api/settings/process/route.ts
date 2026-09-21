import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { parseProcessSettings } from "@/lib/process-settings";

// GET /api/settings/process (spec-process section 2 `/sops/manage`, section
// 4 step 7): the org's process taxonomies and acknowledgement defaults,
// readable by every signed-in member (the policy category picker, the
// contract folder picker and the acknowledgement card all read it), plus
// how many policies and contracts use each name (the Organize tabs show the
// usage count and refuse to delete a name in use).
//
// SEEDING HAPPENS HERE, ONCE. The two lists are seeded from the retired
// CATEGORY_OPTIONS arrays the first time an org reads the section, and the
// parsed value is written back so the seed never repeats and Organize edits
// from then on are the truth. Writes go through PATCH /api/settings
// { section: "process" }.

type SessionUser = { id: string; organizationId: string };
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type SettingsBlob = Record<string, any>;

export async function GET() {
  const session = await getServerSession(authOptions);
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const orgId = (session.user as SessionUser).organizationId;

  const org = await prisma.organization.findUnique({ where: { id: orgId }, select: { settings: true } });
  if (!org) return NextResponse.json({ error: "Organization not found" }, { status: 404 });
  const settings = (org.settings as SettingsBlob | null) || {};
  const { value, seeded } = parseProcessSettings(settings.process);
  if (seeded) {
    // Re-read inside the write so a concurrent settings PATCH is not clobbered.
    const fresh = await prisma.organization.findUnique({ where: { id: orgId }, select: { settings: true } });
    const current = (fresh?.settings as SettingsBlob | null) || {};
    await prisma.organization.update({ where: { id: orgId }, data: { settings: { ...current, process: value } } });
  }

  const [policyGroups, contractGroups] = await Promise.all([
    prisma.policy.groupBy({ by: ["category"], where: { organizationId: orgId, category: { not: null } }, _count: { _all: true } }),
    prisma.agreement.groupBy({ by: ["category"], where: { organizationId: orgId, category: { not: null }, archivedAt: null }, _count: { _all: true } }),
  ]);
  const policyCategoryCounts: Record<string, number> = {};
  for (const g of policyGroups) if (g.category) policyCategoryCounts[g.category] = g._count._all;
  const contractFolderCounts: Record<string, number> = {};
  for (const g of contractGroups) if (g.category) contractFolderCounts[g.category] = g._count._all;

  return NextResponse.json({ process: value, policyCategoryCounts, contractFolderCounts }, { headers: { "Cache-Control": "no-store" } });
}
