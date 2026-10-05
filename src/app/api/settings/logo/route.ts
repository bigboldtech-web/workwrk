import { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSessionOrFail, getOrgId, getUserId, jsonError, jsonSuccess } from "@/lib/api-helpers";
import { settingsWriteGate } from "@/lib/access/settings-write";
import { logAuditEvent } from "@/lib/activity";
import { writeUpload } from "@/lib/local-uploads";

const MAX_SIZE = 2 * 1024 * 1024; // 2MB
const ALLOWED_TYPES = ["image/png", "image/jpeg", "image/webp", "image/svg+xml"];

export async function POST(req: NextRequest) {
  const { error, session } = await getSessionOrFail();
  if (error) return error;

  // Identity & culture's logo: the Identity page rule (Owner and Admin), the
  // actor re-read so a demoted Admin is refused now, and the engine's manage
  // answer on Identity once it decides the door (settings-write.ts). C-level had this write
  // through the raw API only (the Identity page never opened to them).
  const writeGate = await settingsWriteGate(session, "identity");
  if (!writeGate.ok) return writeGate.response;

  const orgId = getOrgId(session);

  // A body that is not multipart (or none at all) is a 400 naming what is
  // missing, never a 500.
  const formData = await req.formData().catch(() => null);
  if (!formData) return jsonError("No file provided");
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
  // Outside public/ (src/lib/local-uploads.ts): only the uploads route serves it.
  const bytes = await file.arrayBuffer();
  await writeUpload(filename, Buffer.from(bytes));

  const logoUrl = `/api/uploads/${filename}`;

  await prisma.organization.update({
    where: { id: orgId },
    data: { logo: logoUrl },
  });
  void logAuditEvent({ type: "settings.updated.logo", actorId: getUserId(session), organizationId: orgId, description: "Changed the workspace logo", targetType: "Organization", targetId: orgId });

  return jsonSuccess({ logo: logoUrl });
}

export async function DELETE(req: NextRequest) {
  const { error, session } = await getSessionOrFail();
  if (error) return error;

  // Identity & culture's logo: the Identity page rule (Owner and Admin), the
  // actor re-read so a demoted Admin is refused now, and the engine's manage
  // answer on Identity once it decides the door (settings-write.ts). C-level had this write
  // through the raw API only (the Identity page never opened to them).
  const writeGate = await settingsWriteGate(session, "identity");
  if (!writeGate.ok) return writeGate.response;

  const orgId = getOrgId(session);

  await prisma.organization.update({
    where: { id: orgId },
    data: { logo: null },
  });
  void logAuditEvent({ type: "settings.updated.logo", actorId: getUserId(session), organizationId: orgId, description: "Removed the workspace logo", targetType: "Organization", targetId: orgId });

  return jsonSuccess({ logo: null });
}
