import { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSessionOrFail, getOrgId, jsonError, jsonSuccess } from "@/lib/api-helpers";

export async function POST(req: NextRequest) {
  const { error, session } = await getSessionOrFail();
  if (error) return error;

  const accessLevel = (session as any).user.accessLevel;
  if (!["COMPANY_ADMIN", "SUPER_ADMIN"].includes(accessLevel)) {
    return jsonError("Only company admins can delete the organization", 403);
  }

  const orgId = getOrgId(session);
  const body = await req.json();
  const { confirmName } = body;

  const org = await prisma.organization.findUnique({
    where: { id: orgId },
    select: { name: true },
  });

  if (!org) return jsonError("Organization not found", 404);

  // Require typing the exact org name to confirm
  if (confirmName !== org.name) {
    return jsonError("Organization name does not match. Please type the exact name to confirm deletion.");
  }

  // Delete everything (cascades handle most relations)
  await prisma.organization.delete({ where: { id: orgId } });

  return jsonSuccess({ message: "Organization and all data permanently deleted" });
}
