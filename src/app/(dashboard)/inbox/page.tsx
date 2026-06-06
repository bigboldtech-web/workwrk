"use client";

// Inbox — ClickUp parity (Phase A, 2026-06-05).
// Tabs: Primary · Other · Later · Cleared. Notifications route by type:
//   primary = mention, task_assigned, approval
//   other   = kudos, candor_session, survey, sop_published, task_due
//   later   = snoozed (Notification.snoozedUntil > now)
//   cleared = read
// Toolbar: Filter pill (left), Settings + Clear all (right). Empty
// state: "Inbox Zero" with ClickTip card below.

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import {
  Inbox as InboxIcon, Heart, AtSign, CheckSquare, Clock, MessageCircle,
  ClipboardCheck, BookOpen, ShieldAlert, Bell, ChevronRight, Check,
  ListFilter, Settings, type LucideIcon,
} from "lucide-react";
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

interface TypeVisual { Icon: LucideIcon; color: string; label: string; bucket: "primary" | "other" }
const TYPE_VISUAL: Record<string, TypeVisual> = {
  mention:         { Icon: AtSign,        color: "#a855f7", label: "Mention",       bucket: "primary" },
  task_assigned:   { Icon: CheckSquare,   color: "#3b82f6", label: "Task assigned", bucket: "primary" },
  approval:        { Icon: ShieldAlert,   color: "#ef4444", label: "Approval",      bucket: "primary" },
  kudos:           { Icon: Heart,         color: "#ec4899", label: "Kudo",          bucket: "other" },
  task_due:        { Icon: Clock,         color: "#f97316", label: "Due",           bucket: "other" },
  candor_session:  { Icon: MessageCircle, color: "#6366f1", label: "Candor",        bucket: "other" },
  survey:          { Icon: ClipboardCheck,color: "#14b8a6", label: "Survey",        bucket: "other" },
  sop_published:   { Icon: BookOpen,      color: "#22c55e", label: "SOP",           bucket: "other" },
};
function visualFor(t: string): TypeVisual {
  return TYPE_VISUAL[t] ?? { Icon: Bell, color: "#71717a", label: t.replace(/_/g, " "), bucket: "other" };
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

type Tab = "primary" | "other" | "later" | "cleared";

export default function InboxPage() {
  const [rows, setRows] = useState<ApiNotification[] | null>(null);
  const [tab, setTab] = useState<Tab>("primary");
  const { toast } = useOsToast();

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/notifications");
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      setRows(data.notifications ?? data.data ?? (Array.isArray(data) ? data : []));
    } catch {
      setRows([]);
    }
  }, []);
  useEffect(() => { void load(); }, [load]);

  const filteredRows = useMemo(() => {
    if (rows === null) return null;
    const now = Date.now();
    return rows.filter((n) => {
      const isSnoozed = n.snoozedUntil && new Date(n.snoozedUntil).getTime() > now;
      if (tab === "cleared") return n.read;
      if (tab === "later") return !n.read && isSnoozed;
      const v = visualFor(n.type);
      if (tab === "primary") return !n.read && !isSnoozed && v.bucket === "primary";
      return !n.read && !isSnoozed && v.bucket === "other";
    });
  }, [rows, tab]);

  async function markRead(id: string) {
    setRows((prev) => prev?.map((n) => n.id === id ? { ...n, read: true } : n) ?? prev);
    try {
      await fetch("/api/notifications", {
        method: "PATCH", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id }),
      });
    } catch { toast("Couldn't mark read"); void load(); }
  }

  async function clearAll() {
    setRows((prev) => prev?.map((n) => ({ ...n, read: true })) ?? prev);
    try {
      await fetch("/api/notifications", {
        method: "PATCH", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ markAllRead: true }),
      });
      toast("Inbox cleared");
    } catch { toast("Couldn't clear"); void load(); }
  }

  return (
    <div className="flex flex-col h-full bg-white">
      {/* Tabs */}
      <div className="px-6 pt-4 border-b border-zinc-100">
        <div className="flex items-center gap-5">
          <InboxTab active={tab === "primary"} onClick={() => setTab("primary")} Icon={InboxIcon} label="Primary" />
          <InboxTab active={tab === "other"}   onClick={() => setTab("other")}   Icon={ListFilter} label="Other" />
          <InboxTab active={tab === "later"}   onClick={() => setTab("later")}   Icon={Clock} label="Later" />
          <InboxTab active={tab === "cleared"} onClick={() => setTab("cleared")} Icon={Check} label="Cleared" />
        </div>
      </div>

      {/* Toolbar */}
      <div className="px-6 py-2 flex items-center gap-2">
        <button
          type="button"
          className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded text-[12px] text-zinc-700 hover:bg-zinc-50 border border-zinc-200"
        >
          <ListFilter className="w-3.5 h-3.5" />
          Filter
        </button>
        <div className="flex-1" />
        <button
          type="button"
          aria-label="Inbox settings"
          title="Inbox settings"
          className="p-1.5 rounded hover:bg-zinc-100 text-zinc-500"
        >
          <Settings className="w-3.5 h-3.5" />
        </button>
        <button
          type="button"
          onClick={clearAll}
          disabled={rows === null || rows.every((n) => n.read)}
          className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded text-[12px] text-zinc-700 hover:bg-zinc-50 border border-zinc-200 disabled:opacity-50 disabled:cursor-not-allowed"
        >
          <Check className="w-3.5 h-3.5" />
          Clear all
        </button>
      </div>

      {/* Body */}
      <div className="flex-1 overflow-y-auto px-6 pb-6">
        {filteredRows === null ? (
          <div className="text-sm text-zinc-500 py-8 text-center">Loading inbox…</div>
        ) : filteredRows.length === 0 ? (
          <InboxEmpty tab={tab} />
        ) : (
          <ul className="divide-y divide-zinc-100">
            {filteredRows.map((n) => (
              <NotifEntry key={n.id} n={n} onMarkRead={markRead} cleared={tab === "cleared"} />
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

function InboxTab({
  active,
  onClick,
  Icon,
  label,
}: {
  active: boolean;
  onClick: () => void;
  Icon: LucideIcon;
  label: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`inline-flex items-center gap-1.5 py-2 text-[13px] border-b-2 -mb-px transition-colors ${
        active
          ? "border-zinc-900 text-zinc-900 font-medium"
          : "border-transparent text-zinc-500 hover:text-zinc-900"
      }`}
    >
      <Icon className="w-3.5 h-3.5" />
      {label}
    </button>
  );
}

function InboxEmpty({ tab }: { tab: Tab }) {
  if (tab === "later") {
    return (
      <EmptyState
        Icon={Clock}
        title="Nothing snoozed"
        sub="Notifications you snooze land here until they return to Primary."
      />
    );
  }
  if (tab === "cleared") {
    return (
      <EmptyState
        Icon={Check}
        title="No cleared notifications"
        sub="Notifications you mark as read appear here."
      />
    );
  }
  // Primary + Other share the Inbox Zero celebration.
  return (
    <div className="flex flex-col items-center justify-center text-center py-10">
      <span className="inline-flex items-center justify-center w-14 h-14 rounded-2xl bg-zinc-100 mb-3">
        <InboxIcon className="w-7 h-7 text-zinc-500" />
      </span>
      <p className="text-base font-semibold text-zinc-900 mb-1">Inbox Zero</p>
      <p className="text-[12.5px] text-zinc-500 mb-6">
        Congratulations! You cleared your important notifications <span aria-hidden>🎉</span>
      </p>
      <div className="border border-zinc-200 rounded-lg px-5 py-4 text-center max-w-[420px]">
        <div className="text-[10px] uppercase tracking-wide text-zinc-400 mb-1.5">ClickTip</div>
        <p className="text-[12.5px] text-zinc-700 mb-3">
          Hover over a user&apos;s avatar or name to see their profile card.
        </p>
        <button
          type="button"
          className="text-[11.5px] px-2.5 py-1 rounded bg-zinc-100 text-zinc-700 hover:bg-zinc-200"
        >
          Learn more
        </button>
      </div>
    </div>
  );
}

function EmptyState({ Icon, title, sub }: { Icon: LucideIcon; title: string; sub: string }) {
  return (
    <div className="flex flex-col items-center justify-center text-center py-12">
      <span className="inline-flex items-center justify-center w-12 h-12 rounded-xl border border-zinc-200 mb-3">
        <Icon className="w-5 h-5 text-zinc-400" />
      </span>
      <p className="text-sm font-medium text-zinc-800 mb-1">{title}</p>
      <p className="text-[12px] text-zinc-500 max-w-[320px]">{sub}</p>
    </div>
  );
}

function NotifEntry({
  n,
  onMarkRead,
  cleared,
}: {
  n: ApiNotification;
  onMarkRead: (id: string) => void;
  cleared: boolean;
}) {
  const v = visualFor(n.type);
  const Body = (
    <div className="flex-1 min-w-0">
      <div className="flex items-center gap-2">
        <span className="text-[13px] text-zinc-900 truncate font-medium">{n.title}</span>
        {!n.read ? <span className="w-1.5 h-1.5 rounded-full bg-blue-500 shrink-0" aria-hidden /> : null}
      </div>
      {n.message ? (
        <p className="text-[12px] text-zinc-500 line-clamp-1 mt-0.5">{n.message}</p>
      ) : null}
      <div className="flex items-center gap-1.5 text-[11px] text-zinc-500 mt-1">
        <span style={{ color: v.color }}>{v.label}</span>
        <span>·</span>
        <time dateTime={n.createdAt}>{relTime(n.createdAt)}</time>
        {n.link ? (
          <>
            <span>·</span>
            <span className="inline-flex items-center gap-0.5">
              Open <ChevronRight className="w-3 h-3" />
            </span>
          </>
        ) : null}
      </div>
    </div>
  );

  const className = `flex items-start gap-3 py-3 px-2 -mx-2 rounded hover:bg-zinc-50 transition-colors ${
    n.read ? "opacity-60" : ""
  }`;

  const IconCircle = (
    <span
      className="inline-flex items-center justify-center w-8 h-8 rounded-full shrink-0"
      style={{ background: `color-mix(in srgb, ${v.color} 12%, transparent)`, color: v.color }}
    >
      <v.Icon className="w-4 h-4" />
    </span>
  );

  return (
    <li>
      {n.link ? (
        <Link href={n.link} className={className} onClick={() => { if (!n.read) onMarkRead(n.id); }}>
          {IconCircle}
          {Body}
        </Link>
      ) : (
        <div className={className}>
          {IconCircle}
          {Body}
          {!cleared && !n.read ? (
            <button
              type="button"
              onClick={() => onMarkRead(n.id)}
              aria-label="Mark read"
              title="Mark read"
              className="p-1 rounded text-zinc-400 hover:text-zinc-700 hover:bg-zinc-100 shrink-0"
            >
              <Check className="w-3.5 h-3.5" />
            </button>
          ) : null}
        </div>
      )}
    </li>
  );
}
