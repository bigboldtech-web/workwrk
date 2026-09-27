// POST /api/tools/bulk { op: "category" | "delete" | "share", ids[], value? }
// (spec-tools-misc 2.1): the bulk bar's one request. Each id must be a tool
// in this org the caller may manage (a tool admin, or the person who added
// it); the rest are counted as failed, never touched. A delete moves each
// tool to Trash with its shares; a share is Can view for one person (value
// is their id) with the same notification the single share sends; a
// category change takes a name, or null for "No category".

import { NextRequest } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { jsonError, jsonSuccess } from "@/lib/api-helpers";
import { moveToTrash } from "@/lib/trash";
import { canManageTool } from "@/lib/tools/tool-access";
import { requireTools } from "@/lib/tools/tool-server";

const schema = z.object({
  op: z.enum(["category", "delete", "share"]),
  ids: z.array(z.string().min(1)).min(1).max(200),
  value: z.string().max(80).nullable().optional(),
});

export async function POST(req: NextRequest) {
  const v = await requireTools();
  if ("error" in v) return v.error;
  const parsed = schema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return jsonError("Send op, ids and a value", 400);
  const { op, value } = parsed.data;
  const ids = [...new Set(parsed.data.ids)];

  const tools = await prisma.tool.findMany({ where: { id: { in: ids }, organizationId: v.orgId }, select: { id: true, name: true, addedBy: true } });
  const mine = tools.filter((t) => canManageTool(v, t));
  const mineIds = mine.map((t) => t.id);
  let done = 0;

  if (op === "category") {
    const category = value && value.trim() ? value.trim().slice(0, 60) : null;
    const r = await prisma.tool.updateMany({ where: { id: { in: mineIds } }, data: { category } });
    done = r.count;
  } else if (op === "share") {
    if (!value) return jsonError("Pick a person", 400);
    const person = await prisma.user.findFirst({ where: { id: value, organizationId: v.orgId, deletedAt: null }, select: { id: true } });
    if (!person) return jsonError("That person is not in your organization", 400);
    const existing = await prisma.toolShare.findMany({ where: { toolId: { in: mineIds }, userId: value }, select: { toolId: true } });
    const have = new Set(existing.map((e) => e.toolId));
    const fresh = mine.filter((t) => !have.has(t.id));
    if (fresh.length > 0) {
      await prisma.toolShare.createMany({ data: fresh.map((t) => ({ toolId: t.id, userId: value, sharedBy: v.userId })), skipDuplicates: true });
      await prisma.notification.createMany({
        data: fresh.map((t) => ({
          userId: value,
          type: "tool_shared",
          title: `Tool shared: ${t.name}`,
          message: `You can now see ${t.name} and its saved login in Tools.`,
          link: `/tools?tool=${t.id}`,
        })),
      });
    }
    // Already shared counts as done: the person has it either way.
    done = mine.length;
  } else {
    for (const t of mine) {
      try {
        await moveToTrash("tool", t.id, { organizationId: v.orgId, userId: v.userId, userName: v.name });
        done++;
      } catch { /* counted below */ }
    }
  }
  return jsonSuccess({ done, failed: ids.length - done });
}
