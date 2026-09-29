// POST /api/invitations/request-resend { token }
//
// The recovery on /join's "This invitation expired" screen (spec-account-
// auth `/join`, B24): the invitee asks for a new link, and the person who
// sent the invitation plus the workspace's Owners and Admins get an Inbox
// row pointing at Pending invites, where Resend lives.
//
// Unauthenticated (the invitee has no account yet) and bound to the token:
// only someone holding the emailed link can ask, and they can only ask about
// that invitation. It sends no email and mints no token itself, so it cannot
// be used to mail anyone. Rate limited per IP (10 an hour) and per
// invitation (one Inbox row a day: a second ask the same day is a quiet
// success). A spent invitation answers 410; an unknown token 404.

import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { listOrgAdmins } from "@/lib/access/admins";
import { inviteSender } from "@/lib/auth/invite-facts.server";
import { ipFromRequest, rateLimit } from "@/lib/rate-limit-memory";

export const dynamic = "force-dynamic";

const DAY_MS = 24 * 60 * 60 * 1000;

export async function POST(req: Request) {
  const perIp = rateLimit(`invite-resend:ip:${ipFromRequest(req)}`, { max: 10, windowMs: 60 * 60 * 1000 });
  if (!perIp.ok) return NextResponse.json({ error: "Too many requests. Try again later.", code: "rate_limited" }, { status: 429 });

  const body = (await req.json().catch(() => null)) as { token?: unknown } | null;
  const token = typeof body?.token === "string" ? body.token.trim() : "";
  if (!token || token.length > 256) return NextResponse.json({ error: "This invitation link is not valid.", code: "invalid" }, { status: 404 });

  const inv = await prisma.invitation.findUnique({
    where: { token },
    select: { id: true, email: true, accepted: true, organizationId: true },
  });
  if (!inv) return NextResponse.json({ error: "This invitation link is not valid.", code: "invalid" }, { status: 404 });
  if (inv.accepted) return NextResponse.json({ error: "This invitation has already been used.", code: "used" }, { status: 410 });

  const sender = await inviteSender(inv);
  const perInvite = rateLimit(`invite-resend:inv:${inv.id}`, { max: 1, windowMs: DAY_MS });
  if (!perInvite.ok) return NextResponse.json({ ok: true, inviterName: sender.inviterName, already: true });

  const admins = await listOrgAdmins(inv.organizationId, 10);
  const targets = [...new Set([...(sender.inviterId ? [sender.inviterId] : []), ...admins.map((a) => a.id)])];
  const link = "/settings/members#pending-invites";
  const title = "Invitation needs resending";
  if (targets.length > 0) {
    // The same row twice in a day (another process, a restart that reset
    // the in-memory limit) is suppressed from the database as well.
    const recent = await prisma.notification.findFirst({
      where: { userId: { in: targets }, type: "invite_resend_request", link, message: { contains: inv.email }, createdAt: { gte: new Date(Date.now() - DAY_MS) } },
      select: { id: true },
    });
    if (!recent) {
      await prisma.notification.createMany({
        data: targets.map((userId) => ({
          userId,
          title,
          message: `${inv.email} opened an expired invitation and asked for a new one.`,
          type: "invite_resend_request",
          link,
        })),
      });
    }
  }

  // No ActivityLog row: its actor is required and the asker has no account,
  // so any actor named would be someone who did not do this. The Inbox rows
  // are the record.

  return NextResponse.json({ ok: true, inviterName: sender.inviterName, notified: targets.length > 0 });
}
