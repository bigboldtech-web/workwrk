// POST /api/calls/webhook — LiveKit event sink (native-calls Phase 2).
// Maintains the live roster on CallSession rows so Room can show
// Slack-style "who's in the huddle" chips. Signature-verified with the
// same API key/secret the server trusts; anything unverifiable is
// dropped with a 401 and no side effects.

import { NextRequest } from "next/server";
import { WebhookReceiver } from "livekit-server-sdk";
import { prisma } from "@/lib/prisma";
import type { Prisma } from "@/generated/prisma";
import { jsonError, jsonSuccess } from "@/lib/api-helpers";

type RosterEntry = { identity: string; name: string; joinedAt: string };

export async function POST(req: NextRequest) {
  const key = process.env.LIVEKIT_API_KEY;
  const secret = process.env.LIVEKIT_API_SECRET;
  if (!key || !secret) return jsonError("not configured", 503);

  const body = await req.text();
  const auth = req.headers.get("authorization") ?? "";
  let event;
  try {
    const receiver = new WebhookReceiver(key, secret);
    event = await receiver.receive(body, auth);
  } catch {
    return jsonError("bad signature", 401);
  }

  const roomName = event.room?.name;
  if (!roomName) return jsonSuccess({ ok: true });

  // Roster mutation is a read-modify-write over a JSON column, and
  // LiveKit delivers events at-least-once with no ordering promise —
  // the row is locked FOR UPDATE so concurrent join/leave events can't
  // erase each other's writes. Lookup caps on the same 12h deadness
  // rule the mint uses, so a ghost row never absorbs a live call's
  // events invisibly.
  await prisma.$transaction(async (tx) => {
    const rows = await tx.$queryRaw<{ id: string; participants: unknown; startedAt: Date; conversationId: string | null }[]>`
      SELECT "id", "participants", "startedAt", "conversationId" FROM "CallSession"
      WHERE "roomName" = ${roomName} AND "endedAt" IS NULL
        AND "startedAt" > ${new Date(Date.now() - 12 * 3600_000)}
      ORDER BY "startedAt" DESC
      LIMIT 1
      FOR UPDATE`;
    // No live session (webhook raced the mint, or a stale room):
    // nothing to update; presence self-heals on the next mint.
    if (rows.length === 0) return;
    const session = rows[0];
    const roster = (Array.isArray(session.participants) ? session.participants : []) as RosterEntry[];

    if (event.event === "participant_joined" && event.participant) {
      const p: RosterEntry = {
        identity: event.participant.identity ?? "unknown",
        name: event.participant.name || event.participant.identity || "Guest",
        joinedAt: new Date().toISOString(),
      };
      const next = [...roster.filter((x) => x.identity !== p.identity), p];
      await tx.callSession.update({
        where: { id: session.id },
        data: { participants: next as unknown as Prisma.InputJsonValue, lastSeenAt: new Date() },
      });
    } else if (event.event === "participant_left" && event.participant) {
      const next = roster.filter((x) => x.identity !== event.participant!.identity);
      await tx.callSession.update({
        where: { id: session.id },
        data: { participants: next as unknown as Prisma.InputJsonValue, lastSeenAt: new Date() },
      });
    } else if (event.event === "room_finished") {
      await tx.callSession.update({
        where: { id: session.id },
        data: { endedAt: new Date(), participants: [] as unknown as Prisma.InputJsonValue, lastSeenAt: new Date() },
      });
    } else if (event.event === "room_started") {
      await tx.callSession.update({ where: { id: session.id }, data: { lastSeenAt: new Date() } });
    }
  });

  // TalkTok card lifecycle (Slack's huddle cards): joins accumulate the
  // participant roll on the conversation's latest open card; the finish
  // stamps duration so the card renders "A TalkTok happened · You and X
  // were in it for Nm". Best-effort — presence is already recorded.
  try {
    if (event.event === "participant_joined" || event.event === "room_finished") {
      const session = await prisma.callSession.findFirst({
        where: { roomName, startedAt: { gt: new Date(Date.now() - 12 * 3600_000) } },
        orderBy: { startedAt: "desc" },
        select: { conversationId: true, startedAt: true },
      });
      if (session?.conversationId) {
        // JSON-path filter finds call cards no matter how chatty the room
        // got (fleet finding: a take-15 window lost the card for good).
        const candidates = await prisma.conversationMessage.findMany({
          where: {
            conversationId: session.conversationId,
            createdAt: { gt: new Date(Date.now() - 12 * 3600_000) },
            metadata: { path: ["kind"], equals: "call" },
          },
          orderBy: { createdAt: "desc" },
          take: 5,
          select: { id: true, createdAt: true, metadata: true },
        });
        const card = candidates.find((m) => {
          const meta = m.metadata as { endedAt?: string } | null;
          if (meta?.endedAt) return false;
          // The card must belong to THIS session's time window — a late
          // room_finished for the previous call must not stamp a newer
          // call's card with a ~0m duration (fleet finding).
          return m.createdAt.getTime() >= session.startedAt.getTime() - 2 * 60_000;
        });
        if (card) {
          // Reactions share the metadata JSON — merge under the same
          // FOR UPDATE lock the react route takes, or a concurrent
          // reaction gets silently erased (fleet finding).
          await prisma.$transaction(async (tx) => {
            const locked = await tx.$queryRaw<{ metadata: unknown }[]>`
              SELECT "metadata" FROM "ConversationMessage" WHERE "id" = ${card.id} FOR UPDATE`;
            if (locked.length === 0) return;
            const meta = (locked[0].metadata && typeof locked[0].metadata === "object" ? locked[0].metadata : {}) as Record<string, unknown>;
            if (meta.endedAt) return; // another event settled it meanwhile
            if (event.event === "participant_joined" && event.participant) {
              const names = Array.isArray(meta.names) ? (meta.names as string[]) : [];
              const name = event.participant.name || event.participant.identity || "Guest";
              if (names.includes(name)) return;
              await tx.conversationMessage.update({
                where: { id: card.id },
                data: { metadata: { ...meta, names: [...names, name] } as Prisma.InputJsonValue },
              });
            } else if (event.event === "room_finished") {
              // durationMin can undercount when an abandoned-mint reuse
              // reset startedAt — accepted imprecision, the roster and
              // card stay correct.
              const durationMin = Math.max(0, Math.round((Date.now() - session.startedAt.getTime()) / 60_000));
              await tx.conversationMessage.update({
                where: { id: card.id },
                data: { metadata: { ...meta, endedAt: new Date().toISOString(), durationMin } as Prisma.InputJsonValue },
              });
            }
          });
        }
      }
    }
  } catch (e) { console.error("talktok card update failed", e); }

  return jsonSuccess({ ok: true });
}
