import { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSessionOrFail, getOrgId, getUserId, jsonError, jsonSuccess } from "@/lib/api-helpers";
import { canTouchUserAlignment } from "@/lib/alignment-scope";
import { writeUpload } from "@/lib/local-uploads";
import { ACCOUNT_ERASED, isErasedAccount } from "@/lib/compliance/erased-account";

/** Own photo always; someone else's only via the alignment ladder
 *  (org-wide levels, or a manager whose tree contains the target). */
async function canWriteAvatar(session: unknown, targetId: string): Promise<boolean> {
  if (targetId === getUserId(session)) return true;
  return canTouchUserAlignment(session, targetId);
}

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { error, session } = await getSessionOrFail();
  if (error) return error;

  const { id } = await params;
  const orgId = getOrgId(session);

  if (!(await canWriteAvatar(session, id))) return jsonError("Forbidden", 403);

  const user = await prisma.user.findFirst({
    where: { id, organizationId: orgId },
  });
  if (!user) return jsonError("User not found", 404);
  // A photo on an account its own person erased would name them again
  // (review round 8 of Phase 3). Clearing one (DELETE) stays allowed.
  if (await isErasedAccount(prisma, id)) return jsonSuccess(ACCOUNT_ERASED, 409);

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
  // Outside public/ (src/lib/local-uploads.ts): only the uploads route serves it.
  const buffer = Buffer.from(await file.arrayBuffer());
  await writeUpload(filename, buffer);

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

  if (!(await canWriteAvatar(session, id))) return jsonError("Forbidden", 403);

  // updateMany carries the org scope in the WHERE, a raw-id update would
  // let a valid session clear avatars across org boundaries.
  const result = await prisma.user.updateMany({
    where: { id, organizationId: orgId },
    data: { avatar: null },
  });
  if (result.count === 0) return jsonError("User not found", 404);

  return jsonSuccess({ avatar: null });
}
