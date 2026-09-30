// GET /api/settings/access-model (Phase 8 stage E): what the Access page
// needs to show the ten switches honestly. The flag state (which decides
// which switches the product reads today), the stored toggles, each toggle's
// status (live, where it is read, or why not yet), and whether the old
// permission grid still decides. Readers of the Access page only (Owners,
// Admins, and the people who open it read-only today). Writes go through
// PATCH /api/settings { section: "access" }, the strict section.

import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { accessV2Resolver, accessV2Tables, settingsGateLogOnly } from "@/lib/access/flags";
import { parseAccessSettings } from "@/lib/access/settings";
import { toggleStatuses } from "@/lib/access/toggle-status";
import { hasStoredMatrix } from "@/lib/access/matrix-retire";
import { ownerSplitOn, sessionIsSettingsReader, sessionIsWorkspaceAdmin } from "@/lib/access/workspace-admin";

export async function GET() {
  const session = await getServerSession(authOptions);
  const orgId = (session?.user as { organizationId?: string } | undefined)?.organizationId;
  if (!orgId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!sessionIsSettingsReader(session)) return NextResponse.json({ error: "no_access", page: "access" }, { status: 403 });
  const org = await prisma.organization.findUnique({ where: { id: orgId }, select: { settings: true } });
  const settings = (org?.settings as Record<string, unknown> | null) ?? {};
  const flags = { resolver: accessV2Resolver(), tables: accessV2Tables(), logOnly: settingsGateLogOnly(), ownerSplit: ownerSplitOn() };
  return NextResponse.json(
    {
      flags,
      canEdit: sessionIsWorkspaceAdmin(session),
      stored: !!settings.access && typeof settings.access === "object",
      toggles: parseAccessSettings(settings.access),
      statuses: toggleStatuses(flags),
      matrixDecides: !flags.resolver,
      matrixStored: hasStoredMatrix(settings),
    },
    { headers: { "Cache-Control": "no-store" } },
  );
}
