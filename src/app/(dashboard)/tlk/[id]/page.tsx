// One conversation. A SERVER page now, and that is the point of the rewrite:
// the decision about whether this person may read this conversation is taken
// before a byte of it is sent, rather than by a client component discovering a
// 404 after it has already rendered a header with the channel's name in it.
//
// Three outcomes, and they are the access model's, not Talk's own:
//
//   1. A member (or an Owner or Admin on a public channel) gets the
//      conversation.
//   2. A Member standing on a FINDABLE PUBLIC channel they have not joined
//      gets LockedPage with the Join variant. Self-join replaces Request
//      access here because there is nobody to ask: the answer is already yes.
//   3. Everything else is the in-shell 404. A private channel, a group or a
//      direct message must never confirm to an outsider that it exists, so a
//      wrong id and a real-but-private id answer identically.
//
// The module gate is the layout's (src/app/(dashboard)/tlk/layout.tsx), so
// this file never asks about it.

import { notFound } from "next/navigation";
import { LockedPage } from "@/components/access";
import { Breadcrumb } from "@/components/layout/os/top-bar/breadcrumb";
import { ConversationView } from "@/components/talk/conversation-view";
import { conversationNotFound, loadConversationRole, talkGate } from "@/lib/talk-gate";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";

/** ?call=video | audio, with ?call=1 honoured for links minted before the
 *  rename (spec-talk section 0 keeps the old spelling working). */
function callKind(raw: string | string[] | undefined): "video" | "audio" | null {
  const v = Array.isArray(raw) ? raw[0] : raw;
  if (v === "audio") return "audio";
  if (v === "video" || v === "1") return "video";
  return null;
}

function one(raw: string | string[] | undefined): string | null {
  const v = Array.isArray(raw) ? raw[0] : raw;
  return v && v.length > 0 ? v : null;
}

export default async function ConversationPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { id } = await params;
  const sp = await searchParams;

  const { error, gate } = await talkGate();
  // The layout has already rendered ModuleOff for a module-off workspace, so
  // reaching here with an error means a signed-out or org-less session; the
  // shell's own 404 is the honest answer rather than a raw API body.
  if (error || !gate) { void conversationNotFound(); notFound(); }

  const ctx = await loadConversationRole(id, gate);
  if (!ctx) notFound();

  if (ctx.role === "none") {
    if (!ctx.joinable) notFound();
    const owner = ctx.conversation.createdById
      ? await prisma.user.findFirst({
          where: { id: ctx.conversation.createdById, organizationId: gate.organizationId },
          select: { id: true, firstName: true, lastName: true, avatar: true },
        })
      : null;
    const name = `#${ctx.conversation.name ?? "channel"}`;
    return (
      <>
        <Breadcrumb items={[{ label: name }]} />
        <LockedPage
          name={name}
          // A findable PUBLIC channel: the hash, not the padlock the rest of
          // the product reserves for private ones.
          glyph="hash"
          sentence="This channel is open to everyone at this company. Join it to read and post."
          owner={owner ? { id: owner.id, name: `${owner.firstName} ${owner.lastName}`.trim() } : null}
          ownerAvatar={owner?.avatar ?? null}
          joinChannelId={id}
          back={{ fallbackHref: "/tlk", label: "Talk" }}
        />
      </>
    );
  }

  // THE CRUMB NAMES THE OBJECT, including a direct message's. A DM has no
  // stored name, and the fallback printed "Talk", so the bar read "Talk >
  // Talk". A comment here used to claim the view filled it in once the
  // roster loaded; the view renders no Breadcrumb at all, so nothing ever
  // did. The roster is one indexed read and the page is already a server
  // component, so the right name is in hand before anything is sent.
  let title: string;
  if (ctx.conversation.type === "CHANNEL") {
    title = `#${ctx.conversation.name ?? "channel"}`;
  } else if (ctx.conversation.name) {
    title = ctx.conversation.name;
  } else {
    const others = await prisma.conversationMember.findMany({
      where: { conversationId: id, userId: { not: gate.userId } },
      take: 4,
      select: { user: { select: { firstName: true, lastName: true } } },
    });
    const names = others.map((m) => `${m.user.firstName ?? ""} ${m.user.lastName ?? ""}`.trim()).filter(Boolean);
    title = names.length > 0 ? names.join(", ") : "Just you";
  }

  return (
    <>
      {/* The top bar names the object (spec-shell 2.1 rule 2): "Talk > #sales"
          or "Talk > Priya Nair", not "Talk" alone. The bar prepends the hub
          crumb itself, so this declares only the conversation, and the last
          crumb carries no href because it reads as where you are rather than
          a link back to here. */}
      <Breadcrumb items={[{ label: title }]} />
      <ConversationView
        id={id}
        initialThread={one(sp.thread)}
        initialMessage={one(sp.m)}
        initialCall={callKind(sp.call)}
      />
    </>
  );
}
