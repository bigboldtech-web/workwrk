"use client";

import { useCallback, useEffect, useState } from "react";
import { playNotificationChime } from "@/lib/notification-chime";

type BrowserPermission = "granted" | "denied" | "default" | "unsupported";
type UserPref = "on" | "off" | "unset";

const PREF_KEY = "desktop-notifications-pref";

interface NotifyPayload {
  title: string;
  body?: string;
  /** Group key — subsequent notifications with the same tag replace earlier ones. */
  tag?: string;
  /** URL path to navigate to when the notification is clicked. */
  url?: string;
  /** Whether to play the ding. Default true. */
  sound?: boolean;
}

/**
 * Thin wrapper around the browser Notification API with:
 *  - permission state that the UI can render as "Enable / Enabled / Blocked"
 *  - a user-level on/off preference cached in localStorage
 *  - a built-in chime so the page audibly pings on fire
 *  - click-to-focus-and-navigate behavior
 */
export function useDesktopNotifications() {
  const [permission, setPermission] = useState<BrowserPermission>("default");
  const [pref, setPref] = useState<UserPref>("unset");

  useEffect(() => {
    if (typeof window === "undefined") return;
    if (!("Notification" in window)) {
      setPermission("unsupported");
      return;
    }
    setPermission(Notification.permission as BrowserPermission);
    try {
      const stored = window.localStorage.getItem(PREF_KEY) as UserPref | null;
      if (stored === "on" || stored === "off") setPref(stored);
    } catch { /* ignore */ }
  }, []);

  const requestPermission = useCallback(async (): Promise<BrowserPermission> => {
    if (typeof window === "undefined" || !("Notification" in window)) return "unsupported";
    if (Notification.permission === "granted") {
      setPermission("granted");
      setPref("on");
      try { window.localStorage.setItem(PREF_KEY, "on"); } catch { /* ignore */ }
      return "granted";
    }
    if (Notification.permission === "denied") {
      setPermission("denied");
      return "denied";
    }
    const result = await Notification.requestPermission();
    setPermission(result as BrowserPermission);
    if (result === "granted") {
      setPref("on");
      try { window.localStorage.setItem(PREF_KEY, "on"); } catch { /* ignore */ }
    }
    return result as BrowserPermission;
  }, []);

  const disable = useCallback(() => {
    setPref("off");
    try { window.localStorage.setItem(PREF_KEY, "off"); } catch { /* ignore */ }
  }, []);

  const enable = useCallback(() => {
    setPref("on");
    try { window.localStorage.setItem(PREF_KEY, "on"); } catch { /* ignore */ }
  }, []);

  /**
   * Fire a notification. Respects both the browser-level permission and
   * the user's on/off preference. Safe to call from any context — it
   * no-ops when it can't fire.
   */
  const notify = useCallback((payload: NotifyPayload) => {
    if (typeof window === "undefined") return;
    if (!("Notification" in window)) return;
    if (Notification.permission !== "granted") return;
    if (pref === "off") return;

    // Suppress system notifications when the tab is already focused —
    // the in-app bell and chime are enough, and a popup here would feel
    // invasive. Chime still plays below.
    const visible = document.visibilityState === "visible" && document.hasFocus();

    if (!visible) {
      try {
        const n = new Notification(payload.title, {
          body: payload.body,
          tag: payload.tag,
          icon: "/favicon.ico",
          silent: false,
        });
        n.onclick = () => {
          try {
            window.focus();
            if (payload.url) window.location.assign(payload.url);
          } finally {
            n.close();
          }
        };
      } catch {
        // Some browsers throw on malformed Notification options — ignore.
      }
    }

    if (payload.sound !== false) {
      try { playNotificationChime(); } catch { /* ignore */ }
    }
  }, [pref]);

  return {
    permission,
    pref,
    enabled: permission === "granted" && pref !== "off",
    requestPermission,
    enable,
    disable,
    notify,
  };
}
