// GET  /api/items/[id]/updates — list comments on a Board Item
// POST /api/items/[id]/updates — add a new comment { body, mentionedUserIds? }
//   Mentioned users (org members, minus the author) each get a "mention"
//   Inbox notification linking to /item/[id].

import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { z } from "zod";
import { canEditSpace, getSpaceForReader } from "@/lib/space";
import { createUpdate, listUpdates } from "@/lib/item-thread";
import { filterNotifyUsers } from "@/lib/notify-prefs";
import { prisma } from "@/lib/prisma";

async function ctx() {
  const session = await getServerSession(authOptions);
  if (!session?.user) {
    return { error: NextResponse.json({ error: "Unauthorized" }, { status: 401 }) };
  }
  const u = session.user as { id?: string; accessLevel?: string; organizationId?: string };
  if (!u.id || !u.organizationId) {
    return { error: NextResponse.json({ error: "Unauthorized" }, { status: 401 }) };
  }
  return { userId: u.id, accessLevel: u.accessLevel ?? "EMPLOYEE", organizationId: u.organizationId };
}

async function loadItemForRead(itemId: string, c: { userId: string; accessLevel: string; organizationId: string }) {
  const item = await prisma.item.findUnique({
    where: { id: itemId },
    include: { board: { select: { spaceId: true, organizationId: true } } },
  });
  if (!item || item.organizationId !== c.organizationId || !item.board.spaceId) {
    return { error: NextResponse.json({ error: "Not found" }, { status: 404 }) };
  }
  const space = await getSpaceForReader(item.board.spaceId, c.userId, c.accessLevel);
  if (!space) return { error: NextResponse.json({ error: "Not found" }, { status: 404 }) };
  return { item, spaceId: item.board.spaceId };
}

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const c = await ctx();
  if ("error" in c) return c.error;
  const { id } = await params;
  const gate = await loadItemForRead(id, c);
  if ("error" in gate) return gate.error;
  const updates = await listUpdates(id);
  return NextResponse.json({ updates });
}

const createSchema = z.object({
  body: z.string().min(1).max(10_000),
  // @mentions picked in the composer — fan out "mention" Inbox
  // notifications to these users (author excluded server-side).
  mentionedUserIds: z.array(z.string()).max(50).optional(),
});

/** Best-effort mention fan-out — never fails the comment post. */
async function notifyMentions(args: {
  organizationId: string;
  authorId: string;
  itemId: string;
  itemTitle: string;
  mentionedUserIds: string[];
}): Promise<void> {
  try {
    const ids = [...new Set(args.mentionedUserIds)].filter((uid) => uid !== args.authorId);
    if (ids.length === 0) return;
    // Only notify real members of the author's org — ids come from the client.
    const [members, author] = await Promise.all([
      prisma.user.findMany({
        where: { id: { in: ids }, organizationId: args.organizationId },
        select: { id: true },
      }),
      prisma.user.findUnique({
        where: { id: args.authorId },
        select: { firstName: true, lastName: true },
      }),
    ]);
    if (members.length === 0) return;
    // Honors the "Mentions" toggle in /settings/notifications.
    const wanted = await filterNotifyUsers(members.map((m) => m.id), "mentions");
    if (wanted.size === 0) return;
    const authorName = `${author?.firstName ?? ""} ${author?.lastName ?? ""}`.trim() || "Someone";
    await prisma.notification.createMany({
      data: [...wanted].map((userId) => ({
        userId,
        type: "mention",
        title: args.itemTitle,
        message: `${authorName} mentioned you in a comment`,
        link: `/item/${args.itemId}`,
      })),
    });
  } catch {
    // Swallow — notifications are best-effort; the comment already saved.
  }
}

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const c = await ctx();
  if ("error" in c) return c.error;
  const { id } = await params;
  const gate = await loadItemForRead(id, c);
  if ("error" in gate) return gate.error;
  // Posting requires edit access — keeps random readers from spraying
  // comments into Spaces they only have read on.
  const canEdit = await canEditSpace(gate.spaceId, c.userId, c.accessLevel);
  if (!canEdit) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  const body = await req.json().catch(() => null);
  const parsed = createSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid body", issues: parsed.error.issues }, { status: 400 });
  }
  try {
    const update = await createUpdate({
      organizationId: c.organizationId,
      itemId: id,
      authorId: c.userId,
      body: parsed.data.body,
    });
    if (parsed.data.mentionedUserIds?.length) {
      await notifyMentions({
        organizationId: c.organizationId,
        authorId: c.userId,
        itemId: id,
        itemTitle: gate.item.title,
        mentionedUserIds: parsed.data.mentionedUserIds,
      });
    }
    return NextResponse.json({ update }, { status: 201 });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Failed to post comment" },
      { status: 400 },
    );
  }
}
