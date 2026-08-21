"use client";

// MeetingCall — the embedded Jitsi room. Loads meet.jit.si's IFrame API on
// demand (script cached after first use) and mounts a full conference:
// camera/mic prejoin, screen share, chat, tile view — the whole Meet-grade
// surface — inside WorkwrK. External guests and AI notetaker bots join the
// SAME room via the public guest link, so everyone lands together.

import { useEffect, useRef, useState } from "react";
import { Loader2 } from "lucide-react";

declare global {
  interface Window {
    JitsiMeetExternalAPI?: new (domain: string, options: Record<string, unknown>) => {
      dispose: () => void;
      addListener: (event: string, cb: () => void) => void;
    };
  }
}

let scriptPromise: Promise<void> | null = null;
function loadJitsiScript(): Promise<void> {
  if (window.JitsiMeetExternalAPI) return Promise.resolve();
  if (!scriptPromise) {
    scriptPromise = new Promise((resolve, reject) => {
      const s = document.createElement("script");
      s.src = "https://meet.jit.si/external_api.js";
      s.async = true;
      s.onload = () => resolve();
      s.onerror = () => { scriptPromise = null; reject(new Error("Couldn't load the call engine")); };
      document.head.appendChild(s);
    });
  }
  return scriptPromise;
}

export function MeetingCall({ room, subject, displayName, audioOnly, onLeave }: {
  room: string;
  subject?: string;
  displayName?: string | null;
  /** Start with camera off — audio-call mode. The user can still turn video on in-call. */
  audioOnly?: boolean;
  onLeave?: () => void;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let api: { dispose: () => void; addListener: (e: string, cb: () => void) => void } | null = null;
    let cancelled = false;
    loadJitsiScript()
      .then(() => {
        if (cancelled || !containerRef.current || !window.JitsiMeetExternalAPI) return;
        api = new window.JitsiMeetExternalAPI("meet.jit.si", {
          roomName: room,
          parentNode: containerRef.current,
          width: "100%",
          height: "100%",
          userInfo: displayName ? { displayName } : undefined,
          configOverwrite: {
            prejoinConfig: { enabled: true },
            subject: subject ?? "WorkwrK meeting",
            disableDeepLinking: true,
            ...(audioOnly ? { startWithVideoMuted: true } : {}),
          },
          interfaceConfigOverwrite: {
            SHOW_JITSI_WATERMARK: false,
            MOBILE_APP_PROMO: false,
          },
        });
        api.addListener("readyToClose", () => onLeave?.());
        setLoading(false);
      })
      .catch((e) => { if (!cancelled) { setError(e instanceof Error ? e.message : "Call failed to load"); setLoading(false); } });
    return () => { cancelled = true; api?.dispose(); };
    // Recreating the conference on prop churn would drop the user mid-call —
    // the room is fixed for the lifetime of the panel.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [room]);

  if (error) {
    return (
      <div className="flex h-full items-center justify-center rounded-xl border border-zinc-200 bg-zinc-50 p-8 text-center">
        <p className="text-[14px] text-zinc-600">{error}. Check your connection and try again.</p>
      </div>
    );
  }

  return (
    <div className="relative h-full w-full overflow-hidden rounded-xl border border-zinc-200 bg-zinc-900">
      {loading ? (
        <div className="absolute inset-0 z-10 flex items-center justify-center text-zinc-400">
          <Loader2 className="mr-2 h-5 w-5 animate-spin" /> Starting the call…
        </div>
      ) : null}
      <div ref={containerRef} className="h-full w-full" />
    </div>
  );
}
