"use client";

// OfflineStrip (spec-shell 1.7): a 32px warning strip under the bar while
// the browser is offline or apiFetch has seen a network failure. Not a
// layer, so Esc never touches it; it hides itself on reconnect.

import { useEffect, useState } from "react";
import { WifiOff } from "lucide-react";
import { OFFLINE_EVENT, ONLINE_EVENT } from "@/lib/session-expiry";

export function OfflineStrip() {
  const [offline, setOffline] = useState(false);
  useEffect(() => {
    const off = () => setOffline(true);
    const on = () => setOffline(false);
    // A cold load while offline: report it on the next tick.
    const t = typeof navigator !== "undefined" && navigator.onLine === false ? window.setTimeout(off, 0) : null;
    window.addEventListener(OFFLINE_EVENT, off);
    window.addEventListener(ONLINE_EVENT, on);
    window.addEventListener("offline", off);
    window.addEventListener("online", on);
    return () => {
      if (t !== null) window.clearTimeout(t);
      window.removeEventListener(OFFLINE_EVENT, off);
      window.removeEventListener(ONLINE_EVENT, on);
      window.removeEventListener("offline", off);
      window.removeEventListener("online", on);
    };
  }, []);
  if (!offline) return null;
  return (
    <div role="status" className="os-chrome flex h-8 shrink-0 items-center gap-2 bg-warning-bg px-4 text-sm text-warning-text">
      <WifiOff className="h-4 w-4" strokeWidth={1.5} aria-hidden />
      <span>You&apos;re offline. Changes will save when you reconnect.</span>
    </div>
  );
}
