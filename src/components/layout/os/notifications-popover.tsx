"use client";

import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import Link from "next/link";
import {
  Bell, X, MessageCircle, CheckSquare, Megaphone, Heart, Award,
  Calendar as CalendarIcon, Inbox, Star, ShieldCheck, Sparkles,
  AlertTriangle, FileText, type LucideIcon,
} from "lucide-react";
import { C } from "./catalog";

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

export function OsNotificationsPopover({ onClose }: { onClose: () => void }) {
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
    setData((d) => d ? {
      ...d,
      notifications: d.notifications.map((n) => n.id === id ? { ...n, read: true } : n),
      unreadCount: Math.max(0, d.unreadCount - 1),
    } : d);
    fetch("/api/notifications", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id }),
    }).catch(() => {});
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
    }).catch(() => {});
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
              <strong style={{ color: "var(--os-ink-2)", display: "block", marginBottom: 4 }}>You're all caught up</strong>
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
          <Link href="/inbox" onClick={onClose}>Open Inbox →</Link>
        </div>
      </div>
    </>,
    document.body,
  );
}
