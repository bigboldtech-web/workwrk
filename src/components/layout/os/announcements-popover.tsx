"use client";

/* Topbar Announcements popover.
 * Shows the latest org announcements with priority/type pills and the
 * user's ack state. Pinned + mustAcknowledge announcements bubble to top.
 *
 * GET /api/announcements   (decorated with `acknowledged: boolean`)
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { Megaphone, X, Pin, AlertTriangle, PartyPopper, Info, CalendarDays, ChevronDown, ExternalLink } from "lucide-react";

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
  // Track which announcements are expanded inline. Auto-expand the
  // first must-acknowledge one so the user sees it without clicking.
  const [expanded, setExpanded] = useState<Set<string>>(new Set());

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/announcements");
      if (!res.ok) return setItems([]);
      const data = await res.json();
      const list: ApiAnnouncement[] = data.data ?? (Array.isArray(data) ? data : []);
      setItems(list);
      // Auto-open the first item that needs ack so it surfaces without
      // requiring another click.
      const firstAck = list.find((a) => a.mustAcknowledge && !a.acknowledged);
      if (firstAck) setExpanded((prev) => new Set(prev).add(firstAck.id));
    } catch { setItems([]); }
  }, []);
  useEffect(() => { void load(); }, [load]);

  function toggle(id: string) {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

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
          const isOpen = expanded.has(a.id);
          return (
            <div key={a.id} className={`ann-pop__item ${needsAck ? "needs-ack" : ""} ${isOpen ? "is-open" : ""}`}>
              <button type="button" className="ann-pop__item-summary" onClick={() => toggle(a.id)} aria-expanded={isOpen}>
                <span className="ann-pop__item-icon" style={{ background: hue }}><Icon /></span>
                <div className="ann-pop__item-main">
                  <div className="ann-pop__item-title">
                    {a.pinned && <Pin className="ann-pop__pin" aria-label="Pinned" />}
                    <span>{a.title}</span>
                  </div>
                  {a.body && !isOpen ? (
                    <p className="ann-pop__item-body">{a.body.slice(0, 110)}{a.body.length > 110 ? "…" : ""}</p>
                  ) : null}
                  <div className="ann-pop__item-meta">
                    <span>{timeAgo(a.publishedAt ?? a.createdAt)}</span>
                    {a.priority && a.priority !== "NORMAL" && <span className={`ann-pop__prio ann-pop__prio--${a.priority.toLowerCase()}`}>{a.priority}</span>}
                  </div>
                </div>
                <ChevronDown className="ann-pop__chev" data-open={isOpen} />
              </button>
              {isOpen ? (
                <div className="ann-pop__item-detail">
                  {a.body ? <p>{a.body}</p> : <p className="ann-pop__item-body">No additional details.</p>}
                  <div className="ann-pop__item-actions">
                    {needsAck ? (
                      <button type="button" className="ann-pop__ack" onClick={() => void ack(a.id)}>
                        Acknowledge
                      </button>
                    ) : null}
                    <Link href="/announcements" className="ann-pop__open" onClick={onClose}>
                      <ExternalLink /> Open in announcements
                    </Link>
                  </div>
                </div>
              ) : null}
            </div>
          );
        })}
      </div>

      <footer className="ann-pop__foot">
        <Link href="/announcements" className="ann-pop__link" onClick={onClose}>Open announcements →</Link>
      </footer>
    </div>
  );
}
