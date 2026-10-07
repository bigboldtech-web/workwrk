// POST /api/teammate-groups/[id]/read: the person has read the group chat
// to now (its unread dot). Only their own live group; else 404.

import { NextResponse } from "next/server";
import { requireApp } from "@/lib/app-gate";
import { prisma } from "@/lib/prisma";
import { GROUP_SESSION_WHERE } from "@/lib/agents/group-server";
import { GROUP_COPY } from "@/lib/agents/teammate-copy";
import { teammateError } from "@/lib/agents/teammate-server";

type Params = { params: Promise<{ id: string }> };

export async function POST(_req: Request, { params }: Params) {
  const gate = await requireApp("ai");
  if ("error" in gate) return gate.error;
  const { id } = await params;
  const done = await prisma.chatSession.updateMany({ where: GROUP_SESSION_WHERE(gate.viewer, id), data: { lastReadAt: new Date() } });
  if (done.count === 0) return teammateError(404, "not_found", GROUP_COPY.notFound);
  return NextResponse.json({ ok: true });
}
