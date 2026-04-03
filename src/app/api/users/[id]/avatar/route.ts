import { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSessionOrFail, getOrgId, jsonError, jsonSuccess } from "@/lib/api-helpers";
import { writeFile, mkdir } from "fs/promises";
import path from "path";

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { error, session } = await getSessionOrFail();
  if (error) return error;

  const { id } = await params;
  const orgId = getOrgId(session);

  const user = await prisma.user.findFirst({
    where: { id, organizationId: orgId },
  });
  if (!user) return jsonError("User not found", 404);

  const formData = await req.formData();
  const file = formData.get("file") as File;
  if (!file) return jsonError("No file provided");

  // Validate
  if (file.size > 2 * 1024 * 1024) return jsonError("File too large. Max 2MB.");
  const allowedTypes = ["image/png", "image/jpeg", "image/webp"];
  if (!allowedTypes.includes(file.type)) return jsonError("Only PNG, JPEG, or WebP allowed");

  // Save file
  const ext = file.type.split("/")[1] === "jpeg" ? "jpg" : file.type.split("/")[1];
  const filename = `avatar-${id}-${Date.now()}.${ext}`;
  const uploadDir = path.join(process.cwd(), "public", "uploads");
  await mkdir(uploadDir, { recursive: true });
  const buffer = Buffer.from(await file.arrayBuffer());
  await writeFile(path.join(uploadDir, filename), buffer);

  const avatarUrl = `/api/uploads/${filename}`;

  await prisma.user.update({
    where: { id },
    data: { avatar: avatarUrl },
  });

  return jsonSuccess({ avatar: avatarUrl });
}

export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { error, session } = await getSessionOrFail();
  if (error) return error;

  const { id } = await params;
  const orgId = getOrgId(session);

  await prisma.user.update({
    where: { id },
    data: { avatar: null },
  });

  return jsonSuccess({ avatar: null });
}
