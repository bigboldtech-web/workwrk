import { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSessionOrFail, getOrgId, jsonError, jsonSuccess } from "@/lib/api-helpers";
import { writeFile, mkdir } from "fs/promises";
import path from "path";

const MAX_SIZE = 2 * 1024 * 1024; // 2MB
const ALLOWED_TYPES = ["image/png", "image/jpeg", "image/webp", "image/svg+xml"];

export async function POST(req: NextRequest) {
  const { error, session } = await getSessionOrFail();
  if (error) return error;

  const accessLevel = (session as any).user.accessLevel;
  if (!["COMPANY_ADMIN", "SUPER_ADMIN", "C_LEVEL"].includes(accessLevel)) {
    return jsonError("Insufficient permissions", 403);
  }

  const orgId = getOrgId(session);

  const formData = await req.formData();
  const file = formData.get("logo") as File | null;

  if (!file) return jsonError("No file provided");
  if (!ALLOWED_TYPES.includes(file.type)) {
    return jsonError("Invalid file type. Allowed: PNG, JPEG, WebP, SVG");
  }
  if (file.size > MAX_SIZE) {
    return jsonError("File too large. Maximum 2MB");
  }

  const mimeToExt: Record<string, string> = { png: "png", jpeg: "jpg", webp: "webp", "svg+xml": "svg" };
  const ext = mimeToExt[file.type.split("/")[1]] || "png";
  const filename = `logo-${orgId}-${Date.now()}.${ext}`;
  const uploadDir = path.join(process.cwd(), "public", "uploads");
  const filePath = path.join(uploadDir, filename);

  await mkdir(uploadDir, { recursive: true });

  const bytes = await file.arrayBuffer();
  await writeFile(filePath, Buffer.from(bytes));

  const logoUrl = `/api/uploads/${filename}`;

  await prisma.organization.update({
    where: { id: orgId },
    data: { logo: logoUrl },
  });

  return jsonSuccess({ logo: logoUrl });
}

export async function DELETE(req: NextRequest) {
  const { error, session } = await getSessionOrFail();
  if (error) return error;

  const accessLevel = (session as any).user.accessLevel;
  if (!["COMPANY_ADMIN", "SUPER_ADMIN", "C_LEVEL"].includes(accessLevel)) {
    return jsonError("Insufficient permissions", 403);
  }

  const orgId = getOrgId(session);

  await prisma.organization.update({
    where: { id: orgId },
    data: { logo: null },
  });

  return jsonSuccess({ logo: null });
}
