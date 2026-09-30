import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSessionOrFail, getOrgId, jsonError, jsonSuccess } from "@/lib/api-helpers";
import { writeOrgSettingsKeys } from "@/lib/org-settings-write";
import { accessV2Resolver } from "@/lib/access/flags";
import { engineMatrixCells } from "@/lib/access/matrix-engine";
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

  // ACCESS_V2_RESOLVER (default OFF): the cells the engine owns, answered for
  // this person exactly as the server gates answer them, so the client never
  // shows a control whose handler is refused (or hides one it allows).
  const cells = accessV2Resolver() ? await engineMatrixCells(session) : null;

  return NextResponse.json({ matrix, cells }, {
    headers: { "Cache-Control": cells ? "private, no-store" : "private, max-age=60, stale-while-revalidate=300" },
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

  // Only the `permissions` key of the shared settings column, in one
  // statement, so no other writer's key is lost to a concurrent save.
  await writeOrgSettingsKeys(orgId, { permissions: sanitized });

  return jsonSuccess({ matrix: sanitized });
}
