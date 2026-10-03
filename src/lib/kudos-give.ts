// Giving a kudos, the one way every surface does it.
//
// Before this there were three, and each did a different part of the job.
// The kudos wall's form (POST /api/kudos) told the person thanked, emailed
// them, logged it and posted to Slack, but never fired "someone gives
// kudos", so no automation or webhook on that trigger ran for a kudos given
// in the app. The public API (POST /api/v1/kudos) and integrations fired it
// but never told the person thanked. Ask AI's send_kudos wrote the row and
// nothing else, for a Guest too, and to thank yourself. And integrations
// took both people's ids on trust, another workspace's included.
//
// giveKudos is the wall's rules and is used by the wall and by Ask AI;
// kudosAftermath is everything that follows a kudos, used by all four. Only
// a teammate who can open the wall (a Member who can sign in) is told and
// emailed; the wall and Ask AI thank no one else.

import { prisma } from "@/lib/prisma";
import { logActivity } from "@/lib/activity";
import { triggerRecalculation } from "@/services/performanceScoreService";
import { sendEmail } from "@/lib/email";
import { kudosTemplate } from "@/lib/email-templates";
import { notifyKudosPosted } from "@/services/slackNotifier";
import { dispatchEvent } from "@/services/webhookDispatcher";
import { shouldNotify, shouldEmail } from "@/lib/notify-prefs";
import { viewerForUser } from "@/lib/access/viewer";

const PERSON = { select: { id: true, firstName: true, lastName: true, avatar: true } } as const;

type Person = { id: string; firstName: string | null; lastName: string | null };

function nameOf(p: { firstName: string | null; lastName: string | null }): string {
  return `${p.firstName ?? ""} ${p.lastName ?? ""}`.trim();
}

/**
 * Everything that follows a kudos, whichever surface made it: the person
 * thanked is told (their inbox toggle) and emailed (their email toggle),
 * it is logged, their score is recalculated, it is posted to Slack, and
 * "kudos.created" fires for automations and webhooks. Never throws: a kudos
 * that was saved stays saved whatever a side effect does.
 */
export async function kudosAftermath(input: {
  organizationId: string;
  kudos: { id: string; message: string; companyValue: string | null; giverId: string; receiverId: string; createdAt: Date };
  giver: Person;
  receiver: Person & { email: string | null };
  /** Already known by the caller (giveKudos checked it): saves a second look. */
  receiverReachable?: boolean;
}): Promise<void> {
  const { organizationId: orgId, kudos, giver, receiver } = input;
  const giverName = nameOf(giver) || "Someone";
  // Told and emailed only when they can open the wall the link leads to: a
  // Member who can sign in. A Guest, or someone deactivated, is not. A failed
  // check tells no one, and everything below still runs.
  let reachable = input.receiverReachable ?? false;
  if (input.receiverReachable === undefined) {
    try {
      reachable = await canReadTheWall(orgId, receiver.id);
    } catch (err) {
      console.error("[Kudos] Could not check the receiver:", err);
    }
  }
  try {
    if (reachable && (await shouldNotify(receiver.id, "kudos"))) {
      await prisma.notification.create({
        data: {
          // spec-teams-performance /kudos: "{name} thanked you".
          title: `${giverName} thanked you`,
          message: `"${kudos.message.slice(0, 80)}"`,
          type: "kudos_received",
          // Their Received view (spec-teams-performance /kudos Realtime).
          link: "/kudos?view=received",
          userId: receiver.id,
        },
      });
    }
  } catch (err) {
    console.error("[Kudos] Notification failed:", err);
  }

  // Gated by both the /settings/notifications email toggle and the legacy
  // EmailPreference kudos category (checked inside sendEmail).
  try {
    if (reachable && receiver.email && (await shouldEmail(receiver.id, "kudos"))) {
      const baseUrl = process.env.NEXTAUTH_URL || "http://localhost:3000";
      const senderName = nameOf(giver);
      const { subject, html } = kudosTemplate({ senderName, message: kudos.message, dashboardLink: `${baseUrl}/kudos?view=received` });
      await sendEmail({
        to: receiver.email,
        subject,
        html,
        template: "kudos",
        variables: { senderName, message: kudos.message },
        organizationId: orgId,
        userId: receiver.id,
        category: "kudos",
      });
    }
  } catch (emailErr) {
    console.error("[Kudos] Email send failed:", emailErr);
  }

  logActivity({
    type: "kudos_given",
    actorId: giver.id,
    organizationId: orgId,
    description: `Gave kudos to ${nameOf(receiver)}${kudos.companyValue ? ` for ${kudos.companyValue}` : ""}`,
    targetId: receiver.id,
    targetType: "user",
  });

  // Recalculate the receiver's performance score (kudos bonus).
  triggerRecalculation(receiver.id, orgId);

  // Slack, when the org has a webhook configured; a hiccup never breaks the kudos.
  notifyKudosPosted({
    organizationId: orgId,
    giverName: nameOf(giver),
    receiverName: nameOf(receiver),
    value: kudos.companyValue,
    message: kudos.message,
  }).catch(() => {});

  // "Someone gives kudos": automations and webhooks.
  dispatchEvent({
    organizationId: orgId,
    event: "kudos.created",
    payload: { id: kudos.id, message: kudos.message, companyValue: kudos.companyValue, giverId: kudos.giverId, receiverId: kudos.receiverId, createdAt: kudos.createdAt },
  }).catch(() => {});
}

/** May this person open the kudos wall: a Member (never a Guest) who can sign in. */
async function canReadTheWall(orgId: string, userId: string): Promise<boolean> {
  const viewer = await viewerForUser(orgId, userId);
  return !!viewer && viewer.orgRole !== "GUEST" && viewer.status !== "INACTIVE";
}

export type GiveKudosResult =
  | { ok: true; duplicate: boolean; kudos: Awaited<ReturnType<typeof createWithPeople>> }
  | { ok: false; status: 400 | 404; error: string };

function createWithPeople(data: { organizationId: string; giverId: string; receiverId: string; message: string; companyValue: string | null }) {
  return prisma.kudos.create({ data, include: { giver: PERSON, receiver: PERSON } });
}

/**
 * The kudos wall's rules (access 3.3 Kudos: every Member, never a Guest):
 * a message of up to 500 characters, never to yourself, to someone in this
 * workspace who has not been removed. A resend of the SAME kudos (a retry
 * after a response was lost: the first request may already have created it)
 * answers with the one that exists and never thanks, emails or posts twice:
 * same giver, receiver, message and value inside two minutes. Then
 * everything that follows a kudos (kudosAftermath).
 */
export async function giveKudos(input: {
  organizationId: string;
  giverId: string;
  receiverId: string;
  message: string;
  companyValue?: string | null;
}): Promise<GiveKudosResult> {
  const orgId = input.organizationId;
  const message = input.message.trim();
  const companyValue = input.companyValue?.trim() ? input.companyValue.trim().slice(0, 80) : null;
  if (!input.receiverId || !message) return { ok: false, status: 400, error: "Choose who to thank and write a message" };
  if (message.length > 500) return { ok: false, status: 400, error: "A kudos message is up to 500 characters" };
  if (input.receiverId === input.giverId) return { ok: false, status: 400, error: "You cannot give kudos to yourself" };

  // The giver as the engine sees them now: a Guest never gives kudos, and
  // neither does someone no longer in this workspace.
  const giver = await viewerForUser(orgId, input.giverId);
  if (!giver || giver.orgRole === "GUEST") return { ok: false, status: 404, error: "Not found" };

  const receiver = await prisma.user.findFirst({
    where: { id: input.receiverId, organizationId: orgId, deletedAt: null },
    select: { id: true, firstName: true, lastName: true, email: true },
  });
  if (!receiver) return { ok: false, status: 404, error: "User not found" };
  // Thanks go to a teammate who can see them: never a Guest, never someone deactivated.
  if (!(await canReadTheWall(orgId, receiver.id))) return { ok: false, status: 400, error: "You can only thank a teammate who can sign in." };

  const dupe = await prisma.kudos.findFirst({
    where: {
      organizationId: orgId, giverId: input.giverId, receiverId: receiver.id, message, companyValue,
      createdAt: { gte: new Date(Date.now() - 2 * 60_000) },
    },
    orderBy: { createdAt: "desc" },
    include: { giver: PERSON, receiver: PERSON },
  });
  if (dupe) return { ok: true, duplicate: true, kudos: dupe };

  const kudos = await createWithPeople({ organizationId: orgId, giverId: input.giverId, receiverId: receiver.id, message, companyValue });
  await kudosAftermath({ organizationId: orgId, kudos, giver: kudos.giver, receiver: { ...kudos.receiver, email: receiver.email }, receiverReachable: true });
  return { ok: true, duplicate: false, kudos };
}
