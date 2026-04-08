import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSessionOrFail, getOrgId, jsonError, jsonSuccess } from "@/lib/api-helpers";
import { PROTECTED_ADMIN_ROLES, PERMISSION_MODULES, type PermissionMatrix } from "@/lib/permissions";

// GET — return the full matrix (custom + defaults merged on the client)
export async function GET() {
  const { error, session } = await getSessionOrFail();
  if (error) return error;

  const orgId = getOrgId(session);
  const org = await prisma.organization.findUnique({
    where: { id: orgId },
    select: { settings: true },
  });

  const settings = (org?.settings as any) || {};
  const matrix: PermissionMatrix | null = settings.permissions || null;

  return NextResponse.json({ matrix }, {
    headers: { "Cache-Control": "private, max-age=60, stale-while-revalidate=300" },
  });
}

// PATCH — update the matrix (admin only)
export async function PATCH(req: NextRequest) {
  const { error, session } = await getSessionOrFail();
  if (error) return error;

  // Only COMPANY_ADMIN and SUPER_ADMIN can edit access control
  const accessLevel = (session.user as any).accessLevel;
  if (!PROTECTED_ADMIN_ROLES.includes(accessLevel)) {
    return jsonError("Only Company Admin can manage access control", 403);
  }

  const orgId = getOrgId(session);
  const body = await req.json();
  const { matrix } = body;

  if (!matrix || typeof matrix !== "object") {
    return jsonError("Invalid permission matrix");
  }

  // Sanitize: only allow known modules and actions
  const sanitized: any = {};
  for (const [level, modules] of Object.entries(matrix)) {
    if (!modules || typeof modules !== "object") continue;
    sanitized[level] = {};
    for (const [mod, actions] of Object.entries(modules as any)) {
      if (!(mod in PERMISSION_MODULES)) continue;
      if (!actions || typeof actions !== "object") continue;
      const knownActions = Object.keys((PERMISSION_MODULES as any)[mod].actions);
      const cleanActions: Record<string, boolean> = {};
      for (const [action, value] of Object.entries(actions as any)) {
        if (knownActions.includes(action) && typeof value === "boolean") {
          cleanActions[action] = value;
        }
      }
      sanitized[level][mod] = cleanActions;
    }
  }

  // Merge into existing settings
  const org = await prisma.organization.findUnique({
    where: { id: orgId },
    select: { settings: true },
  });
  const currentSettings = (org?.settings as any) || {};
  const newSettings = { ...currentSettings, permissions: sanitized };

  await prisma.organization.update({
    where: { id: orgId },
    data: { settings: newSettings },
  });

  return jsonSuccess({ matrix: sanitized });
}
