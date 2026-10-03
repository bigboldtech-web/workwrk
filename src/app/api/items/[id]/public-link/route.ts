// /api/items/[id]/public-link: a task's public, view-only link.
//
//   GET     what the share control shows: whether the workspace allows
//           public links, whether this viewer may turn this one on or off,
//           whether it is on, and its address (only for those who may share)
//   POST    turn it on (the same address if it already is)
//   DELETE  turn it off (the address stops working for good)
//
// Readable task first (gateItem "view": 404 names nothing otherwise), then
// the one rule for who may share (src/lib/task-public-link.ts). Turning it
// on also needs the workspace switch (toggle 10) and a live task; turning it
// off never does, so a link can always be withdrawn. Each change is a row in
// the task's own activity.

import { NextResponse } from "next/server";
import { gateItem, itemCtx, itemServerError } from "@/lib/item-gate";
import { prisma } from "@/lib/prisma";
import { orgPublicLinksAllowed } from "@/lib/public-links";
import { BOARD_ITEM_ENTITY_TYPE } from "@/lib/item-thread";
import { TASK_SHARE_PATH, mayShareTaskPublicly, readTaskLink, taskLinkToken, turnOffTaskLink, turnOnTaskLink } from "@/lib/task-public-link";

type Ctx = Exclude<Awaited<ReturnType<typeof itemCtx>>, { error: NextResponse }>;

const NO_STORE = { "Cache-Control": "no-store" } as const;

async function standing(id: string, c: Ctx) {
  const gate = await gateItem(id, c, "view");
  if ("error" in gate) return { error: gate.error } as const;
  const item = gate.item;
  const org = await prisma.organization.findUnique({ where: { id: c.organizationId }, select: { settings: true } });
  const allowed = orgPublicLinksAllowed(org?.settings);
  const canManage = await mayShareTaskPublicly(c, { boardId: item.boardId, organizationId: item.organizationId });
  return { item, allowed, canManage } as const;
}

function answer(on: boolean, allowed: boolean, canManage: boolean, archived: boolean, link: { secret: string; createdAt: Date } | null, itemId: string) {
  return NextResponse.json(
    {
      allowed,
      canManage,
      archived,
      on,
      // The address only for people who may share it, like a Doc's.
      url: on && canManage && link ? `${TASK_SHARE_PATH}${taskLinkToken(itemId, link.secret)}` : null,
      since: on && link ? link.createdAt.toISOString() : null,
    },
    { headers: NO_STORE },
  );
}

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const c = await itemCtx();
  if ("error" in c) return c.error;
  const { id } = await params;
  try {
    const s = await standing(id, c);
    if ("error" in s) return s.error;
    const link = await readTaskLink(s.item.id);
    return answer(!!link, s.allowed, s.canManage, !!s.item.archivedAt, link, s.item.id);
  } catch (err) {
    return itemServerError(err, `GET /api/items/${id}/public-link`);
  }
}

export async function POST(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const c = await itemCtx();
  if ("error" in c) return c.error;
  const { id } = await params;
  try {
    const s = await standing(id, c);
    if ("error" in s) return s.error;
    if (!s.canManage) return NextResponse.json({ error: "no_access", reason: "cannot_share" }, { status: 403, headers: NO_STORE });
    if (!s.allowed) {
      return NextResponse.json(
        { error: "public_links_off", message: "Public links are turned off for this workspace. A workspace admin can turn them on in Settings, Access." },
        { status: 409, headers: NO_STORE },
      );
    }
    if (s.item.archivedAt) {
      return NextResponse.json({ error: "item_archived", message: "This task is in Trash, so it can't be shared." }, { status: 409, headers: NO_STORE });
    }
    const { secret, created } = await turnOnTaskLink(s.item.id, c.organizationId, c.userId);
    if (created) {
      await prisma.itemActivity.create({
        data: { organizationId: c.organizationId, entityType: BOARD_ITEM_ENTITY_TYPE, entityId: s.item.id, actorId: c.userId, action: "PUBLIC_LINK_ON", meta: {} },
      });
    }
    return answer(true, s.allowed, true, false, { secret, createdAt: new Date() }, s.item.id);
  } catch (err) {
    return itemServerError(err, `POST /api/items/${id}/public-link`);
  }
}

export async function DELETE(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const c = await itemCtx();
  if ("error" in c) return c.error;
  const { id } = await params;
  try {
    const s = await standing(id, c);
    if ("error" in s) return s.error;
    if (!s.canManage) return NextResponse.json({ error: "no_access", reason: "cannot_share" }, { status: 403, headers: NO_STORE });
    const removed = await turnOffTaskLink(s.item.id);
    if (removed) {
      await prisma.itemActivity.create({
        data: { organizationId: c.organizationId, entityType: BOARD_ITEM_ENTITY_TYPE, entityId: s.item.id, actorId: c.userId, action: "PUBLIC_LINK_OFF", meta: {} },
      });
    }
    return answer(false, s.allowed, true, !!s.item.archivedAt, null, s.item.id);
  } catch (err) {
    return itemServerError(err, `DELETE /api/items/${id}/public-link`);
  }
}
