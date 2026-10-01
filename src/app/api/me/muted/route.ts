// GET /api/me/muted: what the signed-in person has muted, for My settings >
// Notifications > Muted items (spec-account-auth `/account/notifications`
// card 5). Two stores, one list:
//
//   home.notifications.muted[]   "space:<id>" / "folder:<id>" / "list:<id>",
//                                written by the "..." menu on each; read by
//                                notify-item.ts (filterUnmutedUsers)
//   ConversationMember.notifyLevel = "mute"   a Talk channel or chat
//
// A place the person can no longer open is listed WITHOUT its name ("A place
// you can no longer open"), so a lowered access never leaks a private name;
// it can still be unmuted. Nothing else about the object is returned.

import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { nodeCtxFromSession, idsWithRole } from "@/lib/access/node-access";
import { mutedObjectKeys } from "@/lib/notify-prefs";

type Kind = "space" | "folder" | "list";

export async function GET() {
  const ctx = await nodeCtxFromSession();
  if (!ctx) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const userId = ctx.userId;
  const orgId = ctx.organizationId;

  const pref = await prisma.userPreference.findUnique({ where: { userId }, select: { home: true } });
  const keys = mutedObjectKeys(pref?.home);
  const parsed = keys
    .map((k) => {
      const [kind, ...rest] = k.split(":");
      const id = rest.join(":");
      const norm: Kind | null = kind === "space" ? "space" : kind === "folder" ? "folder" : kind === "list" || kind === "board" ? "list" : null;
      return norm && id ? { key: k, kind: norm, id } : null;
    })
    .filter((x): x is { key: string; kind: Kind; id: string } => !!x);

  const idsOf = (k: Kind) => parsed.filter((p) => p.kind === k).map((p) => p.id);
  const [spaces, folders, boards, readableSpaces, readableFolders, readableLists, convs] = await Promise.all([
    idsOf("space").length ? prisma.space.findMany({ where: { id: { in: idsOf("space") }, organizationId: orgId }, select: { id: true, name: true, slug: true } }) : [],
    idsOf("folder").length ? prisma.folder.findMany({ where: { id: { in: idsOf("folder") } }, select: { id: true, name: true } }) : [],
    idsOf("list").length ? prisma.board.findMany({ where: { id: { in: idsOf("list") }, organizationId: orgId }, select: { id: true, name: true, slug: true } }) : [],
    idsWithRole(ctx, "space", idsOf("space")).catch(() => new Set<string>()),
    idsWithRole(ctx, "folder", idsOf("folder")).catch(() => new Set<string>()),
    idsWithRole(ctx, "list", idsOf("list")).catch(() => new Set<string>()),
    prisma.conversationMember
      .findMany({
        where: { userId, notifyLevel: "mute", conversation: { organizationId: orgId } },
        select: { conversation: { select: { id: true, name: true, type: true } } },
        take: 200,
      })
      .catch(() => []),
  ]);

  const nameOf = new Map<string, { name: string; href: string | null }>();
  for (const s of spaces) nameOf.set(`space:${s.id}`, { name: s.name, href: `/spaces/${s.slug ?? s.id}` });
  for (const f of folders) nameOf.set(`folder:${f.id}`, { name: f.name, href: `/folders/${f.id}` });
  for (const b of boards) nameOf.set(`list:${b.id}`, { name: b.name, href: `/boards/${b.slug ?? b.id}` });
  const readable = (p: { kind: Kind; id: string }) =>
    p.kind === "space" ? readableSpaces.has(p.id) : p.kind === "folder" ? readableFolders.has(p.id) : readableLists.has(p.id);

  const KIND_LABEL: Record<Kind, string> = { space: "Space", folder: "Folder", list: "List" };
  const items = [
    ...parsed.map((p) => {
      const found = nameOf.get(`${p.kind}:${p.id}`);
      const open = !!found && readable(p);
      return {
        key: p.key,
        store: "pref" as const,
        kind: KIND_LABEL[p.kind],
        name: open ? found!.name : "A place you can no longer open",
        href: open ? found!.href : null,
      };
    }),
    ...convs.map((c) => ({
      key: `conversation:${c.conversation.id}`,
      store: "conversation" as const,
      kind: c.conversation.type === "CHANNEL" ? "Channel" : "Chat",
      name: c.conversation.name || (c.conversation.type === "CHANNEL" ? "Channel" : "Direct message"),
      href: `/tlk/${c.conversation.id}`,
    })),
  ];
  return NextResponse.json({ items }, { headers: { "Cache-Control": "no-store" } });
}
