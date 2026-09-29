import { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { slugify } from "@/lib/utils";
import { getSessionOrFail, getUserId, jsonError, jsonSuccess } from "@/lib/api-helpers";
import { logAuditEvent } from "@/lib/activity";
import { seedOrgDefaults, seedStarterSpace } from "@/lib/org/seed-org-defaults";

// POST /api/organizations/create  { name }
// Create a brand-new workspace (Organization) and make the caller its admin
// (OrganizationMembership). The client then switches into it via
// /api/me/switch-org. Mirrors the org setup in auth/register.
export async function POST(req: NextRequest) {
  const { error, session } = await getSessionOrFail();
  if (error) return error;
  const userId = getUserId(session);

  const body = await req.json().catch(() => ({}));
  const name = typeof body.name === "string" ? body.name.trim() : "";
  if (!name) return jsonError("Workspace name is required");
  if (name.length > 80) return jsonError("Workspace name is too long");

  let slug = slugify(name);
  const existing = await prisma.organization.findUnique({ where: { slug }, select: { id: true } });
  if (existing) slug = `${slug}-${Date.now().toString(36)}`;

  const org = await prisma.$transaction(async (tx) => {
    const organization = await tx.organization.create({
      data: { name, slug, status: "TRIAL" },
    });
    // The same defaults a self-serve signup gets (settings-architecture
    // 11.1): departments, locale, password rules, access toggles, retention
    // and the setup console, so a workspace made here is complete too.
    await seedOrgDefaults(tx, { organizationId: organization.id });
    // The creator owns/admins the new workspace.
    await tx.organizationMembership.create({
      data: { userId, organizationId: organization.id, role: "COMPANY_ADMIN", isPrimary: false },
    });
    return organization;
  });

  await seedStarterSpace({ organizationId: org.id, userId });

  logAuditEvent({
    type: "organization_created",
    actorId: userId,
    organizationId: org.id,
    description: `Created workspace "${org.name}"`,
    targetId: org.id,
    targetType: "organization",
  });

  return jsonSuccess({ organization: { id: org.id, name: org.name, slug: org.slug } }, 201);
}
