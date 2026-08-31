"use client";

// RealtimeClient — ONE Server-Sent-Events connection per tab (browsers cap ~6
// sockets/origin, so we open exactly one and fan out via window events).
// Mounted once at shell level. It never carries message bodies — each event is
// just "something changed", and the existing consumers refetch through their
// normal (auth-scoped, redacted) endpoints. EventSource auto-reconnects, and
// the slow polls stay as a backstop, so a dropped connection self-heals.

import { useEffect } from "react";
import { useSession } from "next-auth/react";

type RealtimeEvent =
  | { type: "message"; conversationId: string }
  | { type: "notification" }
  | { type: "call"; conversationId: string };

export function RealtimeClient() {
  const { status } = useSession();

  useEffect(() => {
    if (status !== "authenticated" || typeof window === "undefined" || typeof EventSource === "undefined") return;

    const es = new EventSource("/api/realtime");
    es.onmessage = (e) => {
      let ev: RealtimeEvent;
      try { ev = JSON.parse(e.data); } catch { return; }
      if (ev.type === "message") {
        // Sidebar list + unread badges.
        window.dispatchEvent(new CustomEvent("workwrk:chat-changed"));
        // The open conversation, if it's this one.
        window.dispatchEvent(new CustomEvent(`workwrk:convo:${ev.conversationId}`));
      } else if (ev.type === "notification") {
        window.dispatchEvent(new CustomEvent("workwrk:notif-changed"));
      } else if (ev.type === "call") {
        window.dispatchEvent(new CustomEvent("workwrk:call-incoming"));
      }
    };
    // On error EventSource retries on its own; nothing to do but let the
    // backstop polls cover the gap.
    return () => es.close();
  }, [status]);

  return null;
}
