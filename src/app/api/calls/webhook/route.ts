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
    const rows = await tx.$queryRaw<{ id: string; participants: unknown }[]>`
      SELECT "id", "participants" FROM "CallSession"
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

  return jsonSuccess({ ok: true });
}
