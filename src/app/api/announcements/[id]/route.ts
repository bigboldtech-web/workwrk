import { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSessionOrFail, getOrgId, isManager, jsonError, jsonSuccess } from "@/lib/api-helpers";

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { error, session } = await getSessionOrFail();
  if (error) return error;
  if (!isManager(session)) return jsonError("Forbidden", 403);
  const { id } = await params;
  const body = await req.json();
  const data: any = {};
  if (body.title !== undefined) data.title = body.title;
  if (body.content !== undefined) data.content = body.content;
  if (body.type !== undefined) data.type = body.type;
  if (body.priority !== undefined) data.priority = body.priority;
  if (body.pinned !== undefined) data.pinned = body.pinned;
  if (body.expiresAt !== undefined) {
    if (!body.expiresAt) return jsonError("Expiry date is required");
    const expiryDate = new Date(`${String(body.expiresAt).slice(0, 10)}T23:59:59.999Z`);
    if (isNaN(expiryDate.getTime())) return jsonError("Invalid expiry date");
    if (expiryDate.getTime() <= Date.now()) return jsonError("Expiry date must be in the future");
    data.expiresAt = expiryDate;
  }
  const updated = await prisma.announcement.update({ where: { id }, data });
  return jsonSuccess(updated);
}

export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { error, session } = await getSessionOrFail();
  if (error) return error;
  if (!isManager(session)) return jsonError("Forbidden", 403);
  const { id } = await params;
  await prisma.announcement.delete({ where: { id } });
  return jsonSuccess({ message: "Deleted" });
}
