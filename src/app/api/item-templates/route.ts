// GET  /api/item-templates , list the org's reusable task templates
// POST /api/item-templates , save a new task template (modal config snapshot)
//
// Backed by the unified Template store (kind=TASK). The legacy `config`
// field maps to/from Template.payload so the create-task modal keeps
// working unchanged.

import { NextRequest } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { getSessionOrFail, getOrgId, getUserId, jsonError, jsonSuccess } from "@/lib/api-helpers";
import { gateItem, itemCtx, type ItemCtx } from "@/lib/item-gate";

export async function GET() {
  const { error, session } = await getSessionOrFail();
  if (error) return error;
  const rows = await prisma.template.findMany({
    where: { organizationId: getOrgId(session), kind: "TASK" },
    orderBy: { updatedAt: "desc" },
    take: 200,
    select: { id: true, name: true, payload: true },
  });
  const templates = rows.map((r) => ({ id: r.id, name: r.name, config: r.payload }));
  return jsonSuccess({ templates });
}

const createSchema = z.object({
  name: z.string().min(1).max(120),
  config: z.record(z.string(), z.unknown()).default({}),
  /**
   * Save an EXISTING task as a template. The task "…" menu sends this and no
   * `config`: it holds an id and a title, not the description, priority, tags,
   * estimate, checklist or alignment the label promises, so the snapshot is
   * taken here, from the row, behind the same gate that guards reading it.
   * Without this the row created an empty template under a toast that said
   * "Template saved".
   */
  itemId: z.string().min(1).optional(),
});

/** The create-modal's `serializeConfig()` shape, built from a stored task. */
async function configFromItem(itemId: string, c: ItemCtx): Promise<Record<string, unknown> | null> {
  const gate = await gateItem(itemId, c, "view");
  if ("error" in gate) return null;
  const item = gate.item;
  const md = (item.metadata as Record<string, unknown> | null) ?? {};
  const minutes = typeof md.timeEstimate === "number" ? md.timeEstimate : 0;
  const tags = await prisma.tagAssignment
    .findMany({
      where: { entityType: "BOARD_ITEM", entityId: item.id },
      include: { tag: { select: { id: true, name: true, color: true, archived: true } } },
      orderBy: { createdAt: "asc" },
    })
    .catch(() => []);
  const subtasks = await prisma.item
    .findMany({
      where: { parentItemId: item.id, organizationId: c.organizationId, archivedAt: null },
      select: { title: true },
      orderBy: { position: "asc" },
      take: 50,
    })
    .catch(() => []);
  return {
    itemTypeId: item.itemTypeId ?? null,
    status: item.status ?? null,
    description: typeof md.description === "string" && md.description ? md.description : undefined,
    priority: item.priority ?? null,
    tags: tags.filter((a) => !a.tag.archived).map((a) => ({ id: a.tag.id, name: a.tag.name, color: a.tag.color })),
    timeEstimate: { h: String(Math.floor(minutes / 60) || ""), m: String(minutes % 60 || "") },
    checklist: Array.isArray(md.checklist) ? md.checklist : [],
    subtasks: subtasks.map((r) => r.title),
    kraId: typeof md.kraId === "string" ? md.kraId : null,
    kpiId: typeof md.kpiId === "string" ? md.kpiId : null,
  };
}

export async function POST(req: NextRequest) {
  const { error, session } = await getSessionOrFail();
  if (error) return error;
  const body = await req.json().catch(() => null);
  const parsed = createSchema.safeParse(body);
  if (!parsed.success) return jsonError("Invalid body", 400);

  let config = parsed.data.config as Record<string, unknown>;
  if (parsed.data.itemId) {
    const c = await itemCtx();
    if ("error" in c) return c.error;
    const snapshot = await configFromItem(parsed.data.itemId, c);
    // A task the caller cannot read is the same answer a missing one gets, so
    // this confirms nothing (item-gate, rule 3).
    if (!snapshot) return jsonError("Not found", 404);
    config = snapshot;
  }

  const row = await prisma.template.create({
    data: {
      organizationId: getOrgId(session),
      createdById: getUserId(session),
      kind: "TASK",
      name: parsed.data.name.trim(),
      payload: config as object,
    },
    select: { id: true, name: true, payload: true },
  });
  return jsonSuccess({ template: { id: row.id, name: row.name, config: row.payload } }, 201);
}
