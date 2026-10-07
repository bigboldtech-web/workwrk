// GET  /api/teammate-groups: the person's group chats, as list rows.
// POST /api/teammate-groups { name?: string (0..60), agentSlugs: string[] (2..5) }
//   Make a group chat of 2 to 5 of the person's teammates
//   (docs/plans/ai-teammates-phase2.md step 3, Decision 13). A teammate the
//   person cannot use answers exactly as one that does not exist.
//
// Groups live under their own top-level path, so no agent slug can collide
// with a static segment (Decision 25). Every refusal is { error, code }.

import { NextResponse } from "next/server";
import { z } from "zod";
import { requireApp } from "@/lib/app-gate";
import { resolveActingPerson } from "@/lib/agents/acting";
import { createGroup, groupDetail, groupRows } from "@/lib/agents/group-server";
import { ACTION_ERRORS } from "@/lib/agents/teammate-copy";
import { invalidRequest, teammateError } from "@/lib/agents/teammate-server";

export async function GET() {
  const gate = await requireApp("ai");
  if ("error" in gate) return gate.error;
  return NextResponse.json({ groups: await groupRows(gate.viewer) });
}

const createSchema = z.object({
  name: z.string().max(60).optional().nullable(),
  agentSlugs: z.array(z.string().min(1).max(200)).min(1).max(20),
});

export async function POST(req: Request) {
  const gate = await requireApp("ai");
  if ("error" in gate) return gate.error;
  const parsed = createSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return invalidRequest();
  // A group is for a person its teammates can act for: never a Guest or an agent account.
  const acting = await resolveActingPerson(gate.viewer.organizationId, gate.viewer.userId);
  if (!acting.ok) return teammateError(403, "person_cannot", ACTION_ERRORS.personCannot);
  const made = await createGroup(acting.person.viewer, { name: parsed.data.name, agentSlugs: parsed.data.agentSlugs });
  if (!made.ok) return teammateError(made.status, made.code, made.error);
  return NextResponse.json({ group: await groupDetail(made.group, acting.person.viewer) }, { status: 201 });
}
