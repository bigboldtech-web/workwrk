// POST /api/docs/[id]/mention — fired when a writer @-mentions a person in a
// doc body. Creates one Inbox notification for the mentioned user, honoring
// their "Mentions" toggle (/settings/notifications). Best-effort by contract:
// the mention pill already sits in the doc regardless of this call.
//
// The mentioned person is told only when they can open the doc themselves
// (the one resolver decides, restricted docs and sub-pages included): a
// notification names the doc, so it must never reach someone the doc is
// hidden from. The link is the Work door, which places the doc under the
// recipient's own access.

import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { resolveSuiteContext } from "@/lib/suites/auth";
import { docAccessible } from "@/lib/doc-access";
import { requireDocRole } from "@/lib/doc-sharing";
import { filterNotifyUsers } from "@/lib/notify-prefs";
import { usersWhoCanRead } from "@/lib/access/node-access";
import { addressHref } from "@/lib/nav/object-href";

const bodySchema = z.object({ userId: z.string().min(1) });

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const ctx = await resolveSuiteContext();
  if ("error" in ctx) return ctx.error;
  const { id } = await params;

  const parsed = bodySchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "invalid body" }, { status: 400 });
  const targetId = parsed.data.userId;
  // Self-mentions are legal in the doc but never worth a notification.
  if (targetId === ctx.userId) return NextResponse.json({ ok: true, skipped: "self" });

  const doc = await prisma.doc.findFirst({
    where: { id, organizationId: ctx.orgId },
    select: { id: true, title: true, archivedAt: true, entityType: true, entityId: true, createdById: true },
  });
  if (!doc || doc.archivedAt) return NextResponse.json({ error: "not found" }, { status: 404 });
  if (!(await docAccessible(doc, ctx.userId, ctx.accessLevel))) {
    return NextResponse.json({ error: "not found" }, { status: 404 });
  }
  if (!(await requireDocRole(ctx, { id: doc.id, createdById: doc.createdById }))) {
    return NextResponse.json({ error: "not found" }, { status: 404 });
  }

  // The mentioned user must be a real member of this org.
  const target = await prisma.user.findFirst({
    where: { id: targetId, organizationId: ctx.orgId },
    select: { id: true },
  });
  if (!target) return NextResponse.json({ error: "unknown user" }, { status: 400 });

  const readers = await usersWhoCanRead(ctx.orgId, { kind: "doc", id: doc.id }, { among: [target.id] });
  if (!readers.has(target.id)) return NextResponse.json({ ok: true, skipped: "no_access" });

  const wanted = await filterNotifyUsers([target.id], "mentions");
  if (wanted.size === 0) return NextResponse.json({ ok: true, skipped: "muted" });

  const author = await prisma.user.findUnique({
    where: { id: ctx.userId },
    select: { firstName: true, lastName: true },
  });
  const authorName = `${author?.firstName ?? ""} ${author?.lastName ?? ""}`.trim() || "Someone";
  await prisma.notification.create({
    data: {
      userId: target.id,
      type: "mention",
      title: doc.title || "Untitled note",
      message: `${authorName} mentioned you in a doc`,
      link: addressHref("doc", doc.id, { scope: "work" }),
    },
  });
  return NextResponse.json({ ok: true });
}
