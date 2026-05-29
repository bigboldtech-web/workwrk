"use client";

/* Inbox — notification stream tailored for the user.
 *
 *  GET    /api/notifications           list visible to me
 *  PATCH  /api/notifications           { id, markAllRead? } — mark read
 *  DELETE /api/notifications           { id?, allRead? }
 *
 * No tabs, no generic table — a focused two-column feed: Unread on top,
 * Read history below, each entry shows type icon + title + message snip
 * + relative time + a "deep link" CTA when the notification has one.
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import {
  Inbox as InboxIcon, Heart, AtSign, CheckSquare, Clock, MessageCircle,
  ClipboardCheck, BookOpen, ShieldAlert, Bell, ChevronRight, Check, CheckCheck,
  type LucideIcon,
} from "lucide-react";
import { OsTitleBar } from "@/components/layout/os/title-bar";
import { OsEmptyView } from "@/components/layout/os/empty-view";
import { C, GRAD, PEOPLE } from "@/components/layout/os/catalog";
import { useOsShell } from "@/components/layout/os/shell-context";
import { useOsToast } from "@/components/layout/os/toast";

type ApiNotification = {
  id: string;
  type: string;
  title: string;
  message?: string | null;
  link?: string | null;
  read: boolean;
  snoozedUntil?: string | null;
  createdAt: string;
};

interface TypeVisual { Icon: LucideIcon; color: string; label: string }
const TYPE_VISUAL: Record<string, TypeVisual> = {
  kudos:           { Icon: Heart,         color: C.pink,   label: "Kudo" },
  mention:         { Icon: AtSign,        color: C.purple, label: "Mention" },
  task_assigned:   { Icon: CheckSquare,   color: C.blue,   label: "Task assigned" },
  task_due:        { Icon: Clock,         color: C.orange, label: "Due" },
  candor_session:  { Icon: MessageCircle, color: C.indigo, label: "Candor" },
  survey:          { Icon: ClipboardCheck,color: C.teal,   label: "Survey" },
  approval:        { Icon: ShieldAlert,   color: C.red,    label: "Approval" },
  sop_published:   { Icon: BookOpen,      color: C.green,  label: "SOP" },
};
function visualFor(t: string): TypeVisual {
  return TYPE_VISUAL[t] ?? { Icon: Bell, color: C.gray, label: t.replace(/_/g, " ") };
}

function relTime(iso: string): string {
  const d = new Date(iso);
  const diff = Date.now() - d.getTime();
  const mins = Math.floor(diff / 60_000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  if (days < 7) return `${days}d ago`;
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

export default function InboxPage() {
  const [rows, setRows] = useState<ApiNotification[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const { rowVersion } = useOsShell();
  const { toast } = useOsToast();

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/notifications");
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      setRows(data.notifications ?? data.data ?? (Array.isArray(data) ? data : []));
    } catch (e) {
      setLoadError(e instanceof Error ? e.message : "load failed");
    }
  }, []);
  useEffect(() => { void load(); }, [load]);
  const v = rowVersion("inbox");
  useEffect(() => { if (v > 0) void load(); }, [v, load]);

  async function markRead(id: string) {
    setRows((prev) => prev?.map((n) => n.id === id ? { ...n, read: true } : n) ?? prev);
    try {
      await fetch("/api/notifications", {
        method: "PATCH", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id }),
      });
    } catch { toast("Couldn't mark read"); void load(); }
  }

  async function markAll() {
    setRows((prev) => prev?.map((n) => ({ ...n, read: true })) ?? prev);
    try {
      await fetch("/api/notifications", {
        method: "PATCH", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ markAllRead: true }),
      });
      toast("Marked all as read");
    } catch { toast("Couldn't mark all read"); void load(); }
  }

  const unread = useMemo(() => (rows ?? []).filter((n) => !n.read), [rows]);
  const read = useMemo(() => (rows ?? []).filter((n) => n.read), [rows]);

  return (
    <>
      <OsTitleBar
        title="Inbox"
        Icon={InboxIcon}
        iconGradient={GRAD.indigoBlue}
        description={rows === null ? "Loading…" : `${unread.length} unread${rows.length > 0 ? ` · ${rows.length} total` : ""}${unread.length === 0 && rows.length > 0 ? " · all caught up" : ""}`}
        people={[PEOPLE.bb]}
        morePeople={0}
      />

      {loadError ? (
        <OsEmptyView Icon={InboxIcon} iconGradient={GRAD.redPink} title="Couldn't load inbox" subtitle={`API error: ${loadError}.`} cta="Retry" />
      ) : rows === null ? (
        <div className="inbox__loading">Loading inbox…</div>
      ) : rows.length === 0 ? (
        <OsEmptyView Icon={InboxIcon} iconGradient={GRAD.indigoBlue} title="Inbox zero" subtitle="@-mentions, kudos, assignments, survey requests, and approval pings show up here. You're all clear." chips={["Mentions", "Kudos", "Assignments", "Approvals"]} cta="Explore modules" />
      ) : (
        <div className="inbox">
          {unread.length > 0 && (
            <section className="inbox__section">
              <header className="inbox__section-head">
                <div className="inbox__section-title">
                  <span className="inbox__section-dot" style={{ background: C.orange }} />
                  <h2>Unread</h2>
                  <span className="inbox__section-count">{unread.length}</span>
                </div>
                <button type="button" className="inbox__mark-all" onClick={markAll}>
                  <CheckCheck /> Mark all read
                </button>
              </header>
              <ol className="inbox__list">
                {unread.map((n) => <NotifEntry key={n.id} n={n} onMarkRead={markRead} unread />)}
              </ol>
            </section>
          )}
          {read.length > 0 && (
            <section className="inbox__section inbox__section--read">
              <header className="inbox__section-head">
                <div className="inbox__section-title">
                  <span className="inbox__section-dot" style={{ background: C.gray }} />
                  <h2>Earlier</h2>
                  <span className="inbox__section-count">{read.length}</span>
                </div>
              </header>
              <ol className="inbox__list">
                {read.slice(0, 50).map((n) => <NotifEntry key={n.id} n={n} onMarkRead={markRead} unread={false} />)}
              </ol>
            </section>
          )}
        </div>
      )}
    </>
  );
}

function NotifEntry({ n, onMarkRead, unread }: { n: ApiNotification; onMarkRead: (id: string) => void; unread: boolean }) {
  const v = visualFor(n.type);
  const Content = (
    <div className="inbox__entry-body">
      <div className="inbox__entry-line">
        <span className="inbox__entry-title">{n.title}</span>
        {unread && <span className="inbox__entry-dot" />}
      </div>
      {n.message && <p className="inbox__entry-message">{n.message}</p>}
      <div className="inbox__entry-meta">
        <span className="inbox__entry-type" style={{ color: v.color }}>{v.label}</span>
        <span className="inbox__entry-sep">·</span>
        <time dateTime={n.createdAt}>{relTime(n.createdAt)}</time>
        {n.link && <span className="inbox__entry-cta">Open <ChevronRight /></span>}
      </div>
    </div>
  );

  const className = `inbox__entry ${unread ? "is-unread" : ""}`;
  const onClick = () => { if (unread) onMarkRead(n.id); };

  return (
    <li>
      {n.link ? (
        <Link href={n.link} className={className} onClick={onClick}>
          <span className="inbox__entry-icon" style={{ background: `color-mix(in srgb, ${v.color} 12%, transparent)`, color: v.color }}>
            <v.Icon />
          </span>
          {Content}
        </Link>
      ) : (
        <div className={className} onClick={onClick} style={{ cursor: unread ? "pointer" : "default" }}>
          <span className="inbox__entry-icon" style={{ background: `color-mix(in srgb, ${v.color} 12%, transparent)`, color: v.color }}>
            <v.Icon />
          </span>
          {Content}
          {unread && (
            <button
              type="button"
              className="inbox__entry-check"
              onClick={(e) => { e.preventDefault(); e.stopPropagation(); onMarkRead(n.id); }}
              title="Mark read"
            >
              <Check />
            </button>
          )}
        </div>
      )}
    </li>
  );
}
