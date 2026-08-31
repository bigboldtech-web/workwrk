"use client";

// IncomingCallWatcher — makes an incoming call RING in real time (a few
// seconds), instead of waiting on the 15s notification poll. Mounted once at
// shell level; polls /api/calls/incoming every 5s while the tab is focused and
// you're NOT already on a call. Each fresh call rings ONCE (top-right toast
// with Join / Dismiss); the ring auto-clears when the call ends. Backgrounded
// tabs fall back to the bell's OS notification, so this stays paused when
// hidden to keep the poll cheap.

import { useEffect, useRef } from "react";
import { Phone } from "lucide-react";
import { useSession } from "next-auth/react";
import { useOsShell } from "@/components/layout/os/shell-context";
import { useToast } from "@/components/ui/toast";

const POLL_MS = 5000;

type IncomingCall = {
  conversationId: string;
  roomName: string;
  callerName: string;
  label: string;
  isDM: boolean;
};

export function IncomingCallWatcher() {
  const { activeCall, startCall } = useOsShell();
  const { toast, dismissKey } = useToast();
  const { data: session } = useSession();

  // Refs keep the single poll loop stable while reading live values.
  const rung = useRef<Set<string>>(new Set());
  const inCall = useRef(false);
  const startCallRef = useRef(startCall);
  const toastRef = useRef(toast);
  const dismissRef = useRef(dismissKey);
  const myNameRef = useRef<string | null>(null);
  useEffect(() => { inCall.current = !!activeCall; }, [activeCall]);
  useEffect(() => { startCallRef.current = startCall; }, [startCall]);
  useEffect(() => { toastRef.current = toast; }, [toast]);
  useEffect(() => { dismissRef.current = dismissKey; }, [dismissKey]);
  useEffect(() => { myNameRef.current = session?.user?.name ?? null; }, [session]);

  useEffect(() => {
    let alive = true;
    const tick = async () => {
      // Ring only when you're looking and free to answer.
      if (typeof document !== "undefined" && document.hidden) return;
      if (inCall.current) return;
      try {
        const r = await fetch("/api/calls/incoming", { cache: "no-store" });
        if (!r.ok || !alive) return;
        const d = await r.json();
        const calls: IncomingCall[] = Array.isArray(d?.calls) ? d.calls : [];
        const activeIds = new Set(calls.map((c) => c.conversationId));

        // Stop ringing a call that has ended (or that everyone left).
        for (const id of [...rung.current]) {
          if (!activeIds.has(id)) {
            dismissRef.current(`ring:${id}`);
            rung.current.delete(id);
          }
        }
        // Ring each new call exactly once.
        for (const call of calls) {
          if (rung.current.has(call.conversationId)) continue;
          rung.current.add(call.conversationId);
          toastRef.current({
            type: "neutral",
            icon: <Phone className="h-4 w-4 text-emerald-500" />,
            title: call.isDM
              ? `${call.callerName} is calling`
              : `${call.callerName} started a call in ${call.label}`,
            description: "Incoming call",
            durationMs: 45_000,
            dedupeKey: `ring:${call.conversationId}`,
            actions: [
              {
                label: "Join",
                primary: true,
                onClick: () =>
                  startCallRef.current({
                    conversationId: call.conversationId,
                    room: call.roomName,
                    subject: call.label,
                    displayName: myNameRef.current,
                    audioOnly: true, // answer camera-off; toggle on in-call
                    href: `/tlk/${call.conversationId}`,
                  }),
              },
              { label: "Dismiss", onClick: () => {} },
            ],
          });
        }
      } catch {
        /* ignore — the bell's poll is the backstop */
      }
    };
    void tick();
    const iv = setInterval(() => void tick(), POLL_MS);
    return () => { alive = false; clearInterval(iv); };
  }, []);

  return null;
}
