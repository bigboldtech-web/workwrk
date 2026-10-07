// PATCH  /api/agents/memories/[id] { key?, value? }: change one memory.
// DELETE /api/agents/memories/[id]: forget it.
//
// A person's own memory (scope "person"): that person alone, even after the
// teammate was removed (what it remembers about them is theirs to delete).
// A workspace teammate's shared memory (scope "agent"): its managers. Anyone
// else's memory, and any id this person cannot see, is the same 404, so an
// id never says that a memory exists. A shared memory the person can see but
// not change answers 403 not_manager.
//
// docs/plans/ai-teammates.md 3.8 and 4. Every refusal is { error, code }.

import { NextResponse } from "next/server";
import { z } from "zod";
import type { Viewer } from "@/lib/access/types";
import { requireApp } from "@/lib/app-gate";
import { prisma } from "@/lib/prisma";
import { MEMORY_LIMITS, updateMemory } from "@/lib/agents/memory";
import { canManageAgent, canUseAgent } from "@/lib/agents/teammate-access";
import { TEAMMATE_ROUTE_ERRORS, TEAMMATE_TOOL_ERRORS } from "@/lib/agents/teammate-copy";
import { invalidRequest, notManager, teammateError } from "@/lib/agents/teammate-server";

type Params = { params: Promise<{ id: string }> };

function memoryNotFound() {
  return teammateError(404, "not_found", TEAMMATE_ROUTE_ERRORS.memoryNotFound);
}

interface OwnedMemory {
  id: string;
  agentId: string;
  scope: "person" | "agent";
  scopeId: string;
  key: string;
}

/**
 * The memory, when this person may change it; else the refusal. Every query
 * names the workspace, and a row whose scope or scopeId is not one this file
 * knows is nobody's to change here.
 */
async function ownMemory(id: string, viewer: Viewer): Promise<{ ok: true; memory: OwnedMemory } | { ok: false; response: NextResponse }> {
  const row = await prisma.agentMemory.findFirst({
    where: { id, agent: { organizationId: viewer.organizationId } },
    select: {
      id: true,
      agentId: true,
      key: true,
      scope: true,
      scopeId: true,
      agent: { select: { organizationId: true, visibility: true, ownerId: true } },
    },
  });
  if (!row || !row.scopeId) return { ok: false, response: memoryNotFound() };
  const memory = { id: row.id, agentId: row.agentId, scopeId: row.scopeId, key: row.key };
  if (row.scope === "person") {
    return row.scopeId === viewer.userId ? { ok: true, memory: { ...memory, scope: "person" } } : { ok: false, response: memoryNotFound() };
  }
  if (row.scope === "agent" && row.scopeId === row.agentId && row.agent.visibility === "WORKSPACE") {
    if (!canUseAgent(row.agent, viewer)) return { ok: false, response: memoryNotFound() };
    if (!canManageAgent(row.agent, viewer)) return { ok: false, response: notManager() };
    return { ok: true, memory: { ...memory, scope: "agent" } };
  }
  return { ok: false, response: memoryNotFound() };
}

const patchSchema = z
  .object({
    key: z.string().trim().max(MEMORY_LIMITS.keyMax).optional(),
    value: z.string().trim().max(MEMORY_LIMITS.valueMax).optional(),
  })
  .refine((v) => v.key !== undefined || v.value !== undefined);

export async function PATCH(req: Request, { params }: Params) {
  const gate = await requireApp("ai");
  if ("error" in gate) return gate.error;
  const { viewer } = gate;
  const { id } = await params;
  const found = await ownMemory(id, viewer);
  if (!found.ok) return found.response;
  const parsed = patchSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return invalidRequest();
  const saved = await updateMemory(found.memory, parsed.data, viewer.userId);
  if (!saved.ok && saved.gone) return memoryNotFound();
  if (!saved.ok) return teammateError(400, saved.error === TEAMMATE_TOOL_ERRORS.memoryEmpty ? "invalid" : "limit", saved.error);
  return NextResponse.json({ memory: saved.memory });
}

export async function DELETE(_req: Request, { params }: Params) {
  const gate = await requireApp("ai");
  if ("error" in gate) return gate.error;
  const { viewer } = gate;
  const { id } = await params;
  const found = await ownMemory(id, viewer);
  if (!found.ok) return found.response;
  await prisma.agentMemory.deleteMany({ where: { id: found.memory.id, agentId: found.memory.agentId, scope: found.memory.scope, scopeId: found.memory.scopeId } });
  return NextResponse.json({ ok: true });
}
