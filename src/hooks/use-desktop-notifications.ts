"use client";

import { useCallback, useEffect, useState } from "react";
import { playNotificationChime } from "@/lib/notification-chime";
import { sectionHrefNow } from "@/components/layout/os/use-object-href";
import { useOsShell } from "@/components/layout/os/shell-context";
import { desktopPrefOf } from "@/lib/account/desktop-pref";

type BrowserPermission = "granted" | "denied" | "default" | "unsupported";


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
 *  - the person's on/off preference, home.notifications.desktop on the
 *    server (the old localStorage "desktop-notifications-pref" is carried
 *    up once by src/lib/local-prefs-migration.ts), so every device agrees
 *  - a built-in chime so the page audibly pings on fire
 *  - click-to-focus-and-navigate behavior
 */
export function useDesktopNotifications() {
  const [permission, setPermission] = useState<BrowserPermission>("default");
  const { prefs, patchPrefs } = useOsShell();
  const pref = desktopPrefOf(prefs.home.notifications?.desktop);
  const setPref = useCallback((v: "on" | "off") => { void patchPrefs({ home: { notifications: { desktop: v === "on" } } }); }, [patchPrefs]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const t = window.setTimeout(() => {
      if (!("Notification" in window)) setPermission("unsupported");
      else setPermission(Notification.permission as BrowserPermission);
    }, 0);
    return () => window.clearTimeout(t);
  }, []);

  const requestPermission = useCallback(async (): Promise<BrowserPermission> => {
    if (typeof window === "undefined" || !("Notification" in window)) return "unsupported";
    if (Notification.permission === "granted") {
      setPermission("granted");
      setPref("on");
      return "granted";
    }
    if (Notification.permission === "denied") {
      setPermission("denied");
      return "denied";
    }
    const result = await Notification.requestPermission();
    setPermission(result as BrowserPermission);
    if (result === "granted") setPref("on");
    return result as BrowserPermission;
  }, [setPref]);

  const disable = useCallback(() => setPref("off"), [setPref]);
  const enable = useCallback(() => setPref("on"), [setPref]);

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
            // The tab's section at the moment of the click decides: a doc
            // notified while the person works in Work opens in Work.
            if (payload.url) window.location.assign(sectionHrefNow(payload.url));
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
