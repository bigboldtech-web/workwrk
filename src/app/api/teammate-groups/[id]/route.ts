// GET    /api/teammate-groups/[id]: the group as the page opens it.
// PATCH  /api/teammate-groups/[id] { name?: string | null, add?: string[] (1..5), remove?: string[] (1..5) }
//   Rename it, add teammates, remove some; each change is a line in it. A
//   group keeps two teammates: a removal below that answers 409 min_members.
// DELETE /api/teammate-groups/[id]: leave it. It leaves the person's list,
//   and what still waits for their approval in it is cancelled (Decision 31).
//
// Only the person's own live group: another person's, an archived one or a
// one-teammate chat answers 404, the same body.

import { NextResponse } from "next/server";
import { z } from "zod";
import { requireApp } from "@/lib/app-gate";
import { resolveActingPerson } from "@/lib/agents/acting";
import { groupDetail, leaveGroup, loadGroup, updateGroup } from "@/lib/agents/group-server";
import { ACTION_ERRORS, GROUP_COPY } from "@/lib/agents/teammate-copy";
import { invalidRequest, teammateError } from "@/lib/agents/teammate-server";

type Params = { params: Promise<{ id: string }> };

const notFound = () => teammateError(404, "not_found", GROUP_COPY.notFound);

export async function GET(_req: Request, { params }: Params) {
  const gate = await requireApp("ai");
  if ("error" in gate) return gate.error;
  const { id } = await params;
  const g = await loadGroup(id, gate.viewer);
  if (!g) return notFound();
  return NextResponse.json({ group: await groupDetail(g, gate.viewer) });
}

const patchSchema = z
  .object({
    name: z.string().max(60).optional().nullable(),
    add: z.array(z.string().min(1).max(200)).min(1).max(5).optional(),
    remove: z.array(z.string().min(1).max(200)).min(1).max(5).optional(),
  })
  .refine((b) => b.name !== undefined || b.add !== undefined || b.remove !== undefined);

export async function PATCH(req: Request, { params }: Params) {
  const gate = await requireApp("ai");
  if ("error" in gate) return gate.error;
  const parsed = patchSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return invalidRequest();
  const { id } = await params;
  const g = await loadGroup(id, gate.viewer);
  if (!g) return notFound();
  const acting = await resolveActingPerson(gate.viewer.organizationId, gate.viewer.userId);
  if (!acting.ok) return teammateError(403, "person_cannot", ACTION_ERRORS.personCannot);
  const changed = await updateGroup(g, acting.person.viewer, parsed.data);
  if (!changed.ok) return teammateError(changed.status, changed.code, changed.error);
  return NextResponse.json({ group: await groupDetail(changed.group, acting.person.viewer) });
}

export async function DELETE(_req: Request, { params }: Params) {
  const gate = await requireApp("ai");
  if ("error" in gate) return gate.error;
  const { id } = await params;
  const g = await loadGroup(id, gate.viewer);
  if (!g) return notFound();
  await leaveGroup(g, gate.viewer);
  return NextResponse.json({ ok: true });
}
