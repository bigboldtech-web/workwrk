"use client";

// NotificationBanner — slim banner that sits under the topbar.
// Initial use case: prompt the user to grant browser notification
// permission so the system can deliver real-time alerts.
// Dismissals are remembered in localStorage so we don't nag.

import { useEffect, useState } from "react";
import { Bell, X } from "lucide-react";

const DISMISS_KEY = "workwrk:notif-banner:dismissed-v1";

type Permission = "default" | "granted" | "denied" | "unsupported";

function readPermission(): Permission {
  if (typeof window === "undefined" || !("Notification" in window)) return "unsupported";
  return (Notification.permission as Permission) ?? "default";
}

export function NotificationBanner() {
  const [permission, setPermission] = useState<Permission>("default");
  const [dismissed, setDismissed] = useState<boolean>(true);

  useEffect(() => {
    setPermission(readPermission());
    try {
      setDismissed(window.localStorage.getItem(DISMISS_KEY) === "1");
    } catch {
      setDismissed(false);
    }
  }, []);

  // Only show when the browser supports notifications, the user hasn't
  // made a decision yet, and they haven't dismissed the banner.
  if (permission !== "default" || dismissed) return null;

  const enable = async () => {
    try {
      const result = await Notification.requestPermission();
      setPermission(result as Permission);
      if (result !== "default") {
        // Either granted or denied — banner goes away either way.
        try { window.localStorage.setItem(DISMISS_KEY, "1"); } catch {}
      }
    } catch {
      // ignore — Safari may throw on cross-origin contexts
    }
  };

  const remind = () => {
    setDismissed(true);
    try { window.localStorage.setItem(DISMISS_KEY, "1"); } catch {}
  };

  return (
    <div
      className="flex-shrink-0 h-10 flex items-center px-4 gap-3 text-[13px]"
      style={{
        background: "color-mix(in srgb, var(--os-brand-rail) 14%, white)",
        color: "var(--os-brand-rail)",
        borderBottom: "1px solid color-mix(in srgb, var(--os-brand-rail) 20%, transparent)",
      }}
      role="region"
      aria-label="System notification"
    >
      <Bell className="w-4 h-4 flex-shrink-0 opacity-75" />
      <span className="flex-1 truncate">
        WorkwrK needs your permission to send notifications
      </span>
      <button
        type="button"
        onClick={enable}
        className="px-3 py-1 rounded-md text-[12px] font-medium hover:opacity-90 transition-opacity"
        style={{ background: "var(--os-brand-rail)", color: "white" }}
      >
        Enable
      </button>
      <button
        type="button"
        onClick={remind}
        className="px-3 py-1 rounded-md text-[12px] font-medium hover:bg-black/5 transition-colors"
        style={{ color: "var(--os-brand-rail)" }}
      >
        Remind me
      </button>
      <button
        type="button"
        onClick={remind}
        className="p-1 rounded hover:bg-black/5"
        aria-label="Dismiss"
      >
        <X className="w-3.5 h-3.5 opacity-70" />
      </button>
    </div>
  );
}
