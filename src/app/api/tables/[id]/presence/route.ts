// POST   /api/tables/[id]/presence   heartbeat; answers { others: [{ userId, name, avatar, at }] }
// DELETE /api/tables/[id]/presence   leave (the sheet unmounting)
//
// The co-presence chip on the sheet's title row ("Priya is editing"), from the
// Tables Phase 5 backlog: a 20 second poll, in-process state (lib/table-presence),
// no socket and no schema. Gate: the module and the table's reader gate, like
// every table route; a table the viewer cannot open is a 404.

import { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSessionAndModule, getOrgId, getUserId, jsonError, jsonSuccess } from "@/lib/api-helpers";
import { readableTable } from "@/lib/table-gate";
import { tablePresence } from "@/lib/table-presence";

async function gate(id: string) {
  const { error, session } = await getSessionAndModule("workwrk-tables");
  if (error) return { error } as const;
  const orgId = getOrgId(session);
  const userId = getUserId(session);
  const table = await readableTable(id, orgId, userId, session);
  if (!table) return { error: jsonError("not found", 404) } as const;
  return { userId, session } as const;
}

export async function POST(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const g = await gate(id);
  if ("error" in g) return g.error;
  const user = await prisma.user.findUnique({ where: { id: g.userId }, select: { firstName: true, lastName: true, avatar: true, email: true } });
  const name = `${user?.firstName ?? ""} ${user?.lastName ?? ""}`.trim() || user?.email || "Someone";
  const now = Date.now();
  tablePresence.beat(id, { userId: g.userId, name, avatar: user?.avatar ?? null, at: now });
  return jsonSuccess({ others: tablePresence.others(id, g.userId, now) });
}

export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const g = await gate(id);
  if ("error" in g) return g.error;
  tablePresence.leave(id, g.userId);
  return jsonSuccess({ left: true });
}
