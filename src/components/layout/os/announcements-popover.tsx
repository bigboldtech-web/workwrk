"use client";

/* Topbar Announcements popover.
 * Shows the latest org announcements with priority/type pills and the
 * user's ack state. Pinned + mustAcknowledge announcements bubble to top.
 *
 * GET /api/announcements   (decorated with `acknowledged: boolean`)
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { Megaphone, X, Pin, AlertTriangle, PartyPopper, Info, CalendarDays } from "lucide-react";

type ApiAnnouncement = {
  id: string;
  title: string;
  body?: string | null;
  type: "INFO" | "WARNING" | "CELEBRATION" | "POLICY" | "EVENT";
  priority?: "LOW" | "NORMAL" | "HIGH" | "URGENT";
  pinned?: boolean;
  mustAcknowledge?: boolean;
  acknowledged?: boolean;
  publishedAt?: string | null;
  createdAt: string;
};

const TYPE_ICON: Record<ApiAnnouncement["type"], React.ComponentType<{ className?: string }>> = {
  INFO: Info, WARNING: AlertTriangle, CELEBRATION: PartyPopper, POLICY: Info, EVENT: CalendarDays,
};
const TYPE_HUE: Record<ApiAnnouncement["type"], string> = {
  INFO: "var(--os-c-blue)", WARNING: "var(--os-c-orange)",
  CELEBRATION: "var(--os-c-pink)", POLICY: "var(--os-c-purple)", EVENT: "var(--os-c-teal)",
};

function timeAgo(iso: string): string {
  const s = Math.floor((Date.now() - new Date(iso).getTime()) / 1000);
  if (s < 60) return "just now";
  const m = Math.floor(s / 60); if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60); if (h < 24) return `${h}h ago`;
  const d = Math.floor(h / 24); if (d < 30) return `${d}d ago`;
  return new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

export function OsAnnouncementsPopover({ onClose }: { onClose: () => void }) {
  const [items, setItems] = useState<ApiAnnouncement[] | null>(null);

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/announcements");
      if (!res.ok) return setItems([]);
      const data = await res.json();
      setItems(data.data ?? (Array.isArray(data) ? data : []));
    } catch { setItems([]); }
  }, []);
  useEffect(() => { void load(); }, [load]);

  const sorted = useMemo(() => {
    return [...(items ?? [])].sort((a, b) => {
      const ap = a.pinned ? 1 : 0;
      const bp = b.pinned ? 1 : 0;
      if (ap !== bp) return bp - ap;
      const aa = a.mustAcknowledge && !a.acknowledged ? 1 : 0;
      const bb = b.mustAcknowledge && !b.acknowledged ? 1 : 0;
      if (aa !== bb) return bb - aa;
      return new Date(b.publishedAt ?? b.createdAt).getTime() - new Date(a.publishedAt ?? a.createdAt).getTime();
    }).slice(0, 8);
  }, [items]);

  const ackPending = (items ?? []).filter((a) => a.mustAcknowledge && !a.acknowledged).length;

  async function ack(id: string) {
    try {
      await fetch(`/api/announcements/${id}/ack`, { method: "POST" });
      void load();
    } catch { /* ignore */ }
  }

  return (
    <div className="ann-pop" role="dialog" aria-label="Announcements">
      <header className="ann-pop__head">
        <span><Megaphone /> Announcements{ackPending > 0 ? ` · ${ackPending} need ack` : ""}</span>
        <button type="button" onClick={onClose} aria-label="Close"><X /></button>
      </header>

      <div className="ann-pop__list">
        {items === null ? (
          <div className="ann-pop__empty">Loading…</div>
        ) : sorted.length === 0 ? (
          <div className="ann-pop__empty">
            <p>Nothing new from the team.</p>
            <small>Company posts, policy updates, events, and celebrations show up here.</small>
          </div>
        ) : sorted.map((a) => {
          const Icon = TYPE_ICON[a.type];
          const hue = TYPE_HUE[a.type];
          const needsAck = a.mustAcknowledge && !a.acknowledged;
          return (
            <Link key={a.id} href="/announcements" className={`ann-pop__item ${needsAck ? "needs-ack" : ""}`} onClick={onClose}>
              <span className="ann-pop__item-icon" style={{ background: hue }}><Icon /></span>
              <div className="ann-pop__item-main">
                <div className="ann-pop__item-title">
                  {a.pinned && <Pin className="ann-pop__pin" aria-label="Pinned" />}
                  <span>{a.title}</span>
                </div>
                {a.body ? <p className="ann-pop__item-body">{a.body.slice(0, 110)}{a.body.length > 110 ? "…" : ""}</p> : null}
                <div className="ann-pop__item-meta">
                  <span>{timeAgo(a.publishedAt ?? a.createdAt)}</span>
                  {a.priority && a.priority !== "NORMAL" && <span className={`ann-pop__prio ann-pop__prio--${a.priority.toLowerCase()}`}>{a.priority}</span>}
                </div>
              </div>
              {needsAck ? (
                <button type="button" className="ann-pop__ack" onClick={(e) => { e.preventDefault(); e.stopPropagation(); void ack(a.id); }}>
                  Acknowledge
                </button>
              ) : null}
            </Link>
          );
        })}
      </div>

      <footer className="ann-pop__foot">
        <Link href="/announcements" className="ann-pop__link" onClick={onClose}>Open announcements →</Link>
      </footer>
    </div>
  );
}
