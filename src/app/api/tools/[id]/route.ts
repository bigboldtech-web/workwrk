// GET    /api/tools/[id]: one tool, with its saved login, for someone who can
//        see it (tool-access.ts). Another org's id is the same 404.
// PATCH  /api/tools/[id]: change the fields or the login (manage).
// DELETE /api/tools/[id]: move it to Trash (manage). It used to be a hard
//        delete with no org check; now it is restorable for the retention
//        window, with its shares.

import { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { jsonError, jsonSuccess } from "@/lib/api-helpers";
import { logAuditEvent } from "@/lib/activity";
import { moveToTrash } from "@/lib/trash";
import { canManageTool, canSeeTool, hasLogin } from "@/lib/tools/tool-access";
import { requireTools } from "@/lib/tools/tool-server";

async function load(id: string, orgId: string) {
  return prisma.tool.findFirst({
    where: { id, organizationId: orgId },
    select: { id: true, name: true, description: true, url: true, icon: true, category: true, credentials: true, addedBy: true, createdAt: true, updatedAt: true },
  });
}

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const v = await requireTools();
  if ("error" in v) return v.error;
  const { id } = await params;
  const tool = await load(id, v.orgId);
  if (!tool) return jsonError("Not found", 404);
  const share = await prisma.toolShare.findUnique({ where: { toolId_userId: { toolId: id, userId: v.userId } }, select: { id: true } });
  if (!canSeeTool(v, tool, Boolean(share))) return jsonError("Not found", 404);
  const manage = canManageTool(v, tool);
  const rows = manage ? await prisma.toolShare.findMany({ where: { toolId: id }, select: { userId: true, sharedAt: true }, orderBy: { sharedAt: "asc" } }) : [];
  const users = rows.length
    ? await prisma.user.findMany({ where: { id: { in: rows.map((r) => r.userId) }, organizationId: v.orgId }, select: { id: true, firstName: true, lastName: true, avatar: true } })
    : [];
  const byId = new Map(users.map((u) => [u.id, u]));
  // Who added it, so a Can view holder's banner can name the person to ask.
  const owner = await prisma.user.findFirst({ where: { id: tool.addedBy, organizationId: v.orgId }, select: { id: true, firstName: true, lastName: true, avatar: true } });
  const addedByPerson = owner ? { id: owner.id, name: `${owner.firstName ?? ""} ${owner.lastName ?? ""}`.trim() || "Someone", avatar: owner.avatar } : null;
  const shares = rows.map((r) => {
    const u = byId.get(r.userId);
    return { ...r, name: u ? `${u.firstName ?? ""} ${u.lastName ?? ""}`.trim() || "Someone" : "Former member", avatar: u?.avatar ?? null };
  });
  return jsonSuccess({ tool: { ...tool, hasLogin: hasLogin(tool.credentials), canManage: manage, shares, addedByPerson } });
}

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const v = await requireTools();
  if ("error" in v) return v.error;
  const { id } = await params;
  const tool = await load(id, v.orgId);
  if (!tool) return jsonError("Not found", 404);
  if (!canManageTool(v, tool)) return jsonError("You can't change this tool. Ask whoever added it.", 403);

  const body = await req.json().catch(() => null);
  if (!body || typeof body !== "object") return jsonError("Invalid body");
  const str = (x: unknown, max: number) => (typeof x === "string" && x.trim() ? x.trim().slice(0, max) : null);
  const data: Record<string, unknown> = {};
  if (body.name !== undefined) {
    const name = str(body.name, 120);
    if (!name) return jsonError("Tool name is required");
    data.name = name;
  }
  if (body.description !== undefined) data.description = str(body.description, 2000);
  if (body.url !== undefined) data.url = str(body.url, 500);
  if (body.icon !== undefined) data.icon = str(body.icon, 16);
  if (body.category !== undefined) data.category = str(body.category, 60);
  if (body.credentials !== undefined) data.credentials = body.credentials && typeof body.credentials === "object" ? body.credentials : null;

  const updated = await prisma.tool.update({ where: { id }, data, select: { id: true, name: true, description: true, url: true, icon: true, category: true, updatedAt: true } });
  if (body.credentials !== undefined) {
    logAuditEvent({
      type: "tool_credentials_changed",
      actorId: v.userId,
      organizationId: v.orgId,
      description: `Changed the saved login on "${updated.name}"`,
      targetId: id,
      targetType: "tool",
    });
  }
  return jsonSuccess(updated);
}

export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const v = await requireTools();
  if ("error" in v) return v.error;
  const { id } = await params;
  const tool = await load(id, v.orgId);
  if (!tool) return jsonError("Not found", 404);
  if (!canManageTool(v, tool)) return jsonError("You can't delete this tool. Ask whoever added it.", 403);
  const moved = await moveToTrash("tool", id, { organizationId: v.orgId, userId: v.userId, userName: v.name });
  if (!moved) return jsonError("Not found", 404);
  return jsonSuccess({ trashed: true });
}
