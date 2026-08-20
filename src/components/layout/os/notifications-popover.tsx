"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import Link from "next/link";
import {
  Bell, X, MessageCircle, CheckSquare, Megaphone, Heart, Award,
  Calendar as CalendarIcon, Inbox, Star, ShieldCheck, Sparkles,
  AlertTriangle, FileText, type LucideIcon,
} from "lucide-react";
import { C } from "./catalog";
import { useDesktopNotifications } from "@/hooks/use-desktop-notifications";

type Notification = {
  id: string;
  title: string;
  message: string;
  type: string;
  read: boolean;
  link?: string | null;
  createdAt: string;
};

type NotifResponse = {
  notifications: Notification[];
  unreadCount: number;
  unreadByType: Record<string, number>;
};

// Map notification.type → { icon, color } so the popover looks rich
// without us having to enumerate every backend type.
function metaFor(type: string): { Icon: LucideIcon; color: string } {
  const t = type.toLowerCase();
  if (t.includes("task") || t.includes("todo"))          return { Icon: CheckSquare, color: C.blue };
  if (t.includes("comment") || t.includes("mention"))    return { Icon: MessageCircle, color: C.purple };
  if (t.includes("announce") || t.includes("broadcast")) return { Icon: Megaphone, color: C.orange };
  if (t.includes("kudo"))                                return { Icon: Heart, color: C.pink };
  if (t.includes("review") || t.includes("perform"))     return { Icon: Award, color: C.indigo };
  if (t.includes("meeting") || t.includes("event"))      return { Icon: CalendarIcon, color: C.teal };
  if (t.includes("inbox"))                               return { Icon: Inbox, color: C.blue };
  if (t.includes("ack") || t.includes("policy"))         return { Icon: ShieldCheck, color: C.brown };
  if (t.includes("ai") || t.includes("sidekick") || t.includes("draft")) return { Icon: Sparkles, color: C.purple };
  if (t.includes("incident") || t.includes("alert") || t.includes("sla")) return { Icon: AlertTriangle, color: C.red };
  if (t.includes("doc") || t.includes("sop"))            return { Icon: FileText, color: C.teal };
  return { Icon: Star, color: C.indigo };
}

function fmtRelative(iso: string) {
  const d = new Date(iso);
  const diff = Date.now() - d.getTime();
  const m = Math.floor(diff / 60000);
  if (m < 1) return "just now";
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h`;
  const days = Math.floor(h / 24);
  if (days < 7) return `${days}d`;
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

/** Desktop-notification controls surfaced in the popover footer so the
 *  user can grant/see browser-notification permission from a real gesture
 *  (permission can only be requested inside a click handler). */
type DesktopControls = {
  permission: "granted" | "denied" | "default" | "unsupported";
  enabled: boolean;
  onEnable: () => void | Promise<unknown>;
};

export function OsNotificationsPopover({
  onClose,
  onMutated,
  desktop,
}: {
  onClose: () => void;
  /** Called after a read/unread mutation so the topbar badge can re-sync. */
  onMutated?: () => void;
  desktop?: DesktopControls;
}) {
  const [data, setData] = useState<NotifResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [mounted, setMounted] = useState(false);

  useEffect(() => setMounted(true), []);

  async function load() {
    setLoading(true);
    try {
      const res = await fetch("/api/notifications");
      if (!res.ok) throw new Error(String(res.status));
      const json = await res.json();
      setData(json);
    } catch {
      setData({ notifications: [], unreadCount: 0, unreadByType: {} });
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { void load(); }, []);

  async function markOne(id: string) {
    const wasUnread = data?.notifications.some((n) => n.id === id && !n.read) ?? false;
    setData((d) => d ? {
      ...d,
      notifications: d.notifications.map((n) => n.id === id ? { ...n, read: true } : n),
      unreadCount: Math.max(0, d.unreadCount - 1),
    } : d);
    fetch("/api/notifications", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id }),
    })
      .then(() => { if (wasUnread) onMutated?.(); })
      .catch(() => {});
  }

  async function markAll() {
    const wasUnread = data?.notifications.filter((n) => !n.read) ?? [];
    if (wasUnread.length === 0) return;
    setData((d) => d ? {
      ...d,
      notifications: d.notifications.map((n) => ({ ...n, read: true })),
      unreadCount: 0,
    } : d);
    fetch("/api/notifications", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ markAllRead: true }),
    })
      .then(() => onMutated?.())
      .catch(() => {});
  }

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);

  if (!mounted) return null;

  const unread = data?.unreadCount ?? 0;
  const list = data?.notifications ?? [];

  return createPortal(
    <>
      <button
        type="button"
        className="os-notif-bd"
        onClick={onClose}
        aria-label="Close notifications"
      />
      <div className="os-notif workwrk-os" role="dialog" aria-label="Notifications">
        <div className="os-notif__head">
          <span className="os-notif__title">Notifications</span>
          {unread > 0 ? <span className="os-notif__count">{unread}</span> : null}
          <div className="os-notif__head-actions">
            {unread > 0 ? (
              <button type="button" className="os-notif__head-action" onClick={markAll}>
                Mark all read
              </button>
            ) : null}
            <button type="button" className="os-notif__head-close" onClick={onClose} aria-label="Close">
              <X />
            </button>
          </div>
        </div>

        <div className="os-notif__list">
          {loading ? (
            <div className="os-notif__empty">
              <div className="os-notif__empty-icon"><Bell /></div>
              Loading…
            </div>
          ) : list.length === 0 ? (
            <div className="os-notif__empty">
              <div className="os-notif__empty-icon"><Bell /></div>
              <strong style={{ color: "var(--os-ink-2)", display: "block", marginBottom: 4 }}>You&apos;re all caught up</strong>
              No new notifications.
            </div>
          ) : (
            list.map((n) => {
              const { Icon, color } = metaFor(n.type);
              const inner = (
                <>
                  <span className="os-notif__item-icon" style={{ background: color }}>
                    <Icon />
                  </span>
                  <span className="os-notif__item-body">
                    <span className="os-notif__item-title">{n.title}</span>
                    <span className="os-notif__item-msg">{n.message}</span>
                    <span className="os-notif__item-time">{fmtRelative(n.createdAt)}</span>
                  </span>
                </>
              );
              if (n.link) {
                return (
                  <Link
                    key={n.id}
                    href={n.link}
                    className={`os-notif__item ${n.read ? "" : "is-unread"}`}
                    onClick={() => { void markOne(n.id); onClose(); }}
                  >
                    {inner}
                  </Link>
                );
              }
              return (
                <button
                  key={n.id}
                  type="button"
                  className={`os-notif__item ${n.read ? "" : "is-unread"}`}
                  onClick={() => void markOne(n.id)}
                >
                  {inner}
                </button>
              );
            })
          )}
        </div>

        <div className="os-notif__foot">
          {desktop && desktop.permission !== "unsupported" ? (
            desktop.enabled ? (
              <span style={{ fontSize: 12, color: "var(--os-ink-3)", padding: "4px 8px", display: "inline-flex", alignItems: "center", gap: 6 }}>
                <Bell style={{ width: 12, height: 12 }} /> Desktop alerts on
              </span>
            ) : desktop.permission === "denied" ? (
              <span style={{ fontSize: 12, color: "var(--os-ink-3)", padding: "4px 8px" }} title="Re-enable notifications for this site in your browser settings.">
                Desktop alerts blocked
              </span>
            ) : (
              <button
                type="button"
                onClick={() => { void desktop.onEnable(); }}
                style={{ fontSize: 12, fontWeight: 600, color: "var(--os-ink-2)", padding: "4px 8px", borderRadius: 4, display: "inline-flex", alignItems: "center", gap: 6, cursor: "pointer" }}
              >
                <Bell style={{ width: 12, height: 12 }} /> Enable desktop alerts
              </button>
            )
          ) : null}
          <Link href="/inbox" onClick={onClose}>Open Inbox →</Link>
        </div>
      </div>
    </>,
    document.body,
  );
}

/**
 * NotificationsBell — the topbar bell button that owns the unread-count
 * badge and opens the popover above.
 *
 *  - Polls the lightweight /api/inbox/count every 25s for the unread count,
 *    and refreshes on window focus / tab becoming visible.
 *  - When the count climbs while the tab is backgrounded, fires a browser
 *    desktop notification + chime for the newest unread item (via the
 *    useDesktopNotifications hook). Permission is only ever requested from
 *    a real click — the "Enable desktop alerts" button inside the popover —
 *    never on page load.
 *  - Respects the caller's mute flag: muting silences the desktop popup +
 *    chime but never hides the badge.
 */
export function NotificationsBell({ muted = false }: { muted?: boolean }) {
  const [open, setOpen] = useState(false);
  const [unread, setUnread] = useState(0);
  const desktop = useDesktopNotifications();

  // Refs keep the polling closure stable while reading live values.
  const prevUnread = useRef<number | null>(null);
  const lastNotifiedId = useRef<string | null>(null);
  const mutedRef = useRef(muted);
  const enabledRef = useRef(desktop.enabled);
  const notifyRef = useRef(desktop.notify);
  useEffect(() => { mutedRef.current = muted; }, [muted]);
  useEffect(() => { enabledRef.current = desktop.enabled; }, [desktop.enabled]);
  useEffect(() => { notifyRef.current = desktop.notify; }, [desktop.notify]);

  const refresh = useCallback(async () => {
    try {
      const res = await fetch("/api/inbox/count", { cache: "no-store" });
      if (!res.ok) return;
      const j = await res.json();
      const next = typeof j.total === "number" ? j.total : 0;
      setUnread(next);

      // New-item detection: only when the unread count climbs, the tab is
      // backgrounded, desktop alerts are enabled, and we're not muted. We
      // fetch the newest unread row to title the popup, de-duped by id.
      if (
        prevUnread.current !== null &&
        next > prevUnread.current &&
        enabledRef.current &&
        !mutedRef.current &&
        typeof document !== "undefined" &&
        document.hidden
      ) {
        try {
          const nr = await fetch("/api/notifications", { cache: "no-store" });
          if (nr.ok) {
            const payload = (await nr.json()) as NotifResponse;
            const newest = payload.notifications?.find((n) => !n.read);
            if (newest && newest.id !== lastNotifiedId.current) {
              lastNotifiedId.current = newest.id;
              notifyRef.current({
                title: newest.title || "New notification",
                body: newest.message || undefined,
                url: newest.link || "/inbox",
                tag: "workwrk-notification",
              });
            }
          }
        } catch { /* ignore */ }
      }
      prevUnread.current = next;
    } catch { /* ignore */ }
  }, []);

  // Poll on mount + every 25s. The initial fetch runs through an inline
  // async wrapper so the count only settles after the network await —
  // never a synchronous setState in the effect body.
  useEffect(() => {
    const tick = async () => { await refresh(); };
    void tick();
    const iv = setInterval(() => { void refresh(); }, 25_000);
    return () => clearInterval(iv);
  }, [refresh]);

  // Re-check the count when the user returns to the tab.
  useEffect(() => {
    const onFocus = () => { void refresh(); };
    const onVis = () => { if (!document.hidden) void refresh(); };
    window.addEventListener("focus", onFocus);
    document.addEventListener("visibilitychange", onVis);
    return () => {
      window.removeEventListener("focus", onFocus);
      document.removeEventListener("visibilitychange", onVis);
    };
  }, [refresh]);

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="relative p-1 rounded-md hover:bg-zinc-100 inline-flex items-center justify-center text-zinc-500 hover:text-zinc-800"
        aria-label={unread > 0 ? `Notifications, ${unread} unread` : "Notifications"}
        title="Notifications"
        aria-haspopup="dialog"
        aria-expanded={open}
      >
        <Bell className="w-[15px] h-[15px]" />
        {unread > 0 ? (
          <span className="absolute -top-0.5 -right-0.5 min-w-[14px] h-[14px] px-0.5 rounded-full bg-[#FB5A6F] text-white text-[10px] font-bold leading-[14px] text-center">
            {unread > 99 ? "99+" : unread}
          </span>
        ) : null}
      </button>

      {open ? (
        <OsNotificationsPopover
          onClose={() => { setOpen(false); void refresh(); }}
          onMutated={() => { void refresh(); }}
          desktop={{
            permission: desktop.permission,
            enabled: desktop.enabled,
            onEnable: desktop.requestPermission,
          }}
        />
      ) : null}
    </>
  );
}
