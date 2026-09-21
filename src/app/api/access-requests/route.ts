// POST /api/access-requests (access-model-spec 5.6, spec-shell 1.6): the
// Request access primary on a LockedPage. Until the AccessRequest table
// lands (an additive schema item owned by the access unit) a request is an
// inbox row for the object's owner, or for every Owner and Admin when the
// object has no owner, so a real person sees it and can share the object.
// One request per person per object per 24h re-notifies at most once.

import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { z } from "zod";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { listOrgAdmins } from "@/lib/access/admins";

const bodySchema = z.object({
  objectType: z.string().min(1).max(40),
  objectId: z.string().min(1).max(80),
  role: z.enum(["VIEW", "EDIT", "COMMENT"]).default("VIEW"),
  message: z.string().max(500).optional(),
});

const OWNER_FIELD: Record<string, "space" | "board" | "folder" | "sop" | "sop_folder" | "contract" | null> = {
  space: "space",
  board: "board",
  list: "board",
  folder: "folder",
  // The process unit's read-only banner (spec-process section 1): a Can
  // view / Can comment viewer of a SOP asks its author (a filed SOP asks
  // the folder's managers, who are the org admins today).
  sop: "sop",
  sop_folder: "sop_folder",
  // A Member party on /agreements/[id] asks the contract's sender.
  contract: "contract",
};

type RequestTarget = { ownerId: string | null; link: string | null };

/**
 * Who to notify and where the notification opens: the object's own page,
 * where the owner can share it (a Space or List by slug, a Folder by id).
 * An object type with no page gets no link rather than a dead one.
 */
async function targetFor(type: string, id: string, organizationId: string): Promise<RequestTarget> {
  const model = OWNER_FIELD[type] ?? null;
  if (!model) return { ownerId: null, link: null };
  const where = { id, organizationId } as const;
  try {
    if (model === "space") {
      const s = await prisma.space.findFirst({ where, select: { ownerId: true, slug: true } });
      return { ownerId: s?.ownerId ?? null, link: s ? `/spaces/${s.slug}` : null };
    }
    if (model === "board") {
      const b = await prisma.board.findFirst({ where, select: { ownerId: true, slug: true } });
      return { ownerId: b?.ownerId ?? null, link: b ? `/boards/${b.slug}` : null };
    }
    if (model === "folder") {
      const f = await prisma.folder.findFirst({ where, select: { ownerId: true } });
      return { ownerId: f?.ownerId ?? null, link: f ? `/folders/${id}` : null };
    }
    if (model === "sop") {
      const s = await prisma.sOP.findFirst({ where, select: { createdById: true } });
      return { ownerId: s?.createdById ?? null, link: s ? `/sops/${id}` : null };
    }
    if (model === "sop_folder") {
      const f = await prisma.sOPFolder.findFirst({ where, select: { id: true } });
      return { ownerId: null, link: f ? "/sops/manage?tab=sop-folders" : null };
    }
    if (model === "contract") {
      const a = await prisma.agreement.findFirst({ where, select: { createdById: true } });
      return { ownerId: a?.createdById ?? null, link: a ? `/agreements/${id}` : null };
    }
  } catch {
    // A model without ownerId, or a table this org never wrote: fall through.
  }
  return { ownerId: null, link: null };
}

export async function POST(req: Request) {
  const session = await getServerSession(authOptions);
  const u = session?.user as { id?: string; organizationId?: string; firstName?: string; lastName?: string; name?: string } | undefined;
  if (!u?.id || !u.organizationId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const parsed = bodySchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Invalid request" }, { status: 400 });
  const { objectType, objectId, role, message } = parsed.data;

  const { ownerId, link } = await targetFor(objectType, objectId, u.organizationId);
  const targets = ownerId && ownerId !== u.id
    ? [ownerId]
    : (await listOrgAdmins(u.organizationId, 10)).map((a) => a.id).filter((id) => id !== u.id);
  if (targets.length === 0) return NextResponse.json({ ok: true, notified: 0 });

  const requester = `${u.firstName ?? ""} ${u.lastName ?? ""}`.trim() || u.name || "Someone";
  const title = `${requester} asked for access`;
  const roleWord = role === "EDIT" ? "edit" : role === "COMMENT" ? "comment on" : "view";
  const text = `${requester} wants to ${roleWord} a ${objectType}.${message ? ` "${message}"` : ""}`;

  // Re-notify at most once per 24h per requester per object.
  const since = new Date(Date.now() - 24 * 60 * 60 * 1000);
  const recent = await prisma.notification.findFirst({
    where: { userId: { in: targets }, type: "access_request", link, title, createdAt: { gte: since } },
    select: { id: true },
  });
  if (recent) return NextResponse.json({ ok: true, notified: 0, throttled: true });

  await prisma.notification.createMany({
    data: targets.map((userId) => ({ userId, title, message: text, type: "access_request", link })),
  });
  return NextResponse.json({ ok: true, notified: targets.length }, { status: 201 });
}
