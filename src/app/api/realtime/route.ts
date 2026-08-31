// GET /api/realtime — one Server-Sent-Events stream per browser tab, opened
// once at shell level. Pushes TRIGGER-ONLY events ("a message landed in
// conversation X", "you have a new notification", "a call started in X") so
// the client can refetch instantly instead of waiting on its slow polls.
//
// EventSource can only GET and can't set headers, so we authenticate off the
// session cookie and derive the subscription set (the user's conversations)
// SERVER-side — never from client input. Node runtime so it shares the
// in-process bus and can read Prisma. Long-lived: heartbeats keep proxies from
// dropping it, and we clean up the bus registration on disconnect.

import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { subscribe, type RealtimeEvent } from "@/lib/realtime-bus";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const HEARTBEAT_MS = 20_000;

export async function GET(req: Request) {
  const session = await getServerSession(authOptions);
  const u = session?.user as { id?: string; organizationId?: string } | undefined;
  if (!u?.id || !u.organizationId) {
    return new Response("Unauthorized", { status: 401 });
  }
  const userId = u.id;
  const organizationId = u.organizationId;

  // Subscription scope, derived from the session only: the user's own
  // (non-hidden) conversations in their org, plus their personal user topic.
  const memberships = await prisma.conversationMember.findMany({
    where: { userId, hidden: false, conversation: { organizationId } },
    select: { conversationId: true },
  });
  const conversationIds = new Set(memberships.map((m) => m.conversationId));

  const encoder = new TextEncoder();
  let heartbeat: ReturnType<typeof setInterval> | null = null;
  let unsubscribe: (() => void) | null = null;

  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      // Returns false when the underlying socket is gone.
      const write = (chunk: string): boolean => {
        try { controller.enqueue(encoder.encode(chunk)); return true; } catch { return false; }
      };
      const close = () => {
        if (heartbeat) { clearInterval(heartbeat); heartbeat = null; }
        if (unsubscribe) { unsubscribe(); unsubscribe = null; }
        try { controller.close(); } catch { /* already closed */ }
      };
      // If the client already bailed before start ran, abort never fires — bail now.
      if (req.signal.aborted) { close(); return; }

      const send = (event: RealtimeEvent) => { if (!write(`data: ${JSON.stringify(event)}\n\n`)) close(); };

      write(": connected\n\n"); // open the stream immediately (flush past buffers)
      unsubscribe = subscribe({ userId, conversationIds, send });
      // Heartbeat also acts as a liveness probe: a failed write (half-open
      // socket that never sent FIN/RST) tears the connection down.
      heartbeat = setInterval(() => { if (!write(": ping\n\n")) close(); }, HEARTBEAT_MS);

      req.signal.addEventListener("abort", close);
    },
    cancel() {
      if (heartbeat) { clearInterval(heartbeat); heartbeat = null; }
      if (unsubscribe) { unsubscribe(); unsubscribe = null; }
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no", // tell nginx not to buffer the stream
    },
  });
}
