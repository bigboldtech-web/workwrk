"use client";

// BellPopover (spec-shell 2.11): the one bell. A 400px popover with two
// text-tab pills, Inbox (things people did that involve you) and Reminders
// (the ones you set). The bell carries a 6px attention dot, never a count;
// counts live inside on the tabs. Rows are 44px; hover reveals Mark read /
// Snooze on Inbox rows and Done / Snooze on reminder rows. Footer: "Open
// Inbox" or "New reminder". Counts come from boot and the SSE events
// (spec-shell 1.11), refreshed after every write here.
//
// The three bells and the inbox glyph this replaces polled on their own; the
// desktop alert on a new item survives, because it is the one thing a
// backgrounded tab cannot learn any other way.

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { AlarmClock, Bell, Check, CheckSquare, Clock, Settings2 } from "lucide-react";
import { apiFetch } from "@/lib/api-fetch";
import { SETTINGS_PAGES, settingsHrefToday } from "@/lib/settings-registry";
import { SHELL_LABELS } from "@/lib/nav/labels";
import { WINDOW_EVENTS } from "@/lib/realtime-events";
import { useDesktopNotifications } from "@/hooks/use-desktop-notifications";
import { cn } from "@/lib/utils";
import { ChromeIconButton, ChromePopover } from "./chrome-popover";
import { useBoot } from "./boot-context";
import { useOsShell } from "./shell-context";
import { useOsToast } from "./toast";
import { useSettingsNav } from "@/hooks/use-settings-nav";
import { KindIcon } from "@/components/inbox/inbox-row";

type Notification = {
  id: string;
  title: string;
  message: string;
  type: string;
  read: boolean;
  link?: string | null;
  createdAt: string;
  /** From src/lib/inbox-kinds.ts, so the bell and the Inbox say one thing. */
  kind?: { label: string; icon: string };
  /** The server's answer about whether this can still be opened. */
  target?: { href: string | null; readable: boolean };
};
type NotifResponse = { notifications: Notification[]; unreadCount: number };

type Reminder = {
  id: string;
  title: string;
  remindAt: string;
  firedAt?: string | null;
  entityType: string | null;
  entityId: string | null;
};

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

function fmtDue(iso: string): string {
  const d = new Date(iso);
  const today = new Date(); today.setHours(0, 0, 0, 0);
  const sameDay = d >= today && d.getTime() < today.getTime() + 86_400_000;
  const time = d.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" });
  return sameDay ? `Due ${time}` : `Due ${d.toLocaleDateString("en-US", { month: "short", day: "numeric" })} · ${time}`;
}

function tomorrow9amMinutes(): number {
  const d = new Date();
  d.setDate(d.getDate() + 1);
  d.setHours(9, 0, 0, 0);
  return Math.max(1, Math.round((d.getTime() - Date.now()) / 60_000));
}

type Tab = "inbox" | "reminders";

export function BellPopover() {
  const [open, setOpen] = useState(false);
  const [tab, setTab] = useState<Tab>("inbox");
  const { counts, refreshCounts } = useBoot();
  const { mutedNotifications } = useOsShell();
  const { openSettings } = useSettingsNav();
  const dot = counts.inboxUnread > 0 || counts.remindersDue > 0;
  const notificationsHref = settingsHrefToday(SETTINGS_PAGES["account/notifications"]) ?? "/settings/notifications";

  useNewItemAlerts(mutedNotifications);

  return (
    <ChromePopover
      open={open}
      onOpenChange={setOpen}
      width={400}
      layerId="bell"
      ariaLabel={SHELL_LABELS.notifications}
      trigger={
        <ChromeIconButton label={SHELL_LABELS.notifications} aria-haspopup="dialog" aria-expanded={open} active={open}>
          <Bell className="h-5 w-5" strokeWidth={1.5} aria-hidden />
          {dot ? <span className="absolute end-1.5 top-1.5 h-1.5 w-1.5 rounded-full bg-chrome-attention ring-2 ring-chrome" aria-hidden /> : null}
        </ChromeIconButton>
      }
    >
      <div className="flex max-h-[70vh] flex-col">
        <div className="flex h-11 shrink-0 items-center gap-2 px-4">
          <span className="text-lg font-semibold text-ink">{SHELL_LABELS.notifications}</span>
          <span className="flex-1" />
          <button
            type="button"
            onClick={() => { setOpen(false); openSettings(notificationsHref); }}
            aria-label="Notification settings"
            title="Notification settings"
            className="inline-flex h-8 w-8 items-center justify-center rounded-md text-ink-2 hover:bg-hover hover:text-ink"
          >
            <Settings2 className="h-4 w-4" strokeWidth={1.5} />
          </button>
        </div>
        <div className="flex items-center gap-1 px-3 pb-2" role="tablist" aria-label="Notification tabs">
          <TabPill active={tab === "inbox"} onClick={() => setTab("inbox")} count={counts.inboxUnread}>{SHELL_LABELS.inbox}</TabPill>
          <TabPill active={tab === "reminders"} onClick={() => setTab("reminders")} count={counts.remindersDue}>{SHELL_LABELS.reminders}</TabPill>
        </div>
        {tab === "inbox" ? (
          <InboxTab open={open} onClose={() => setOpen(false)} onMutated={() => { void refreshCounts(); }} />
        ) : (
          <RemindersTab open={open} onClose={() => setOpen(false)} onMutated={() => { void refreshCounts(); }} />
        )}
      </div>
    </ChromePopover>
  );
}

function TabPill({ active, onClick, count, children }: { active: boolean; onClick: () => void; count: number; children: React.ReactNode }) {
  return (
    <button
      type="button"
      role="tab"
      aria-selected={active}
      onClick={onClick}
      className={cn(
        "inline-flex h-8 items-center gap-1.5 rounded-md px-3 text-base transition-colors",
        active ? "bg-active font-medium text-ink" : "text-ink-2 hover:bg-hover hover:text-ink",
      )}
    >
      {children}
      {count > 0 ? <span className={cn("text-xs font-medium tabular-nums", active ? "text-ink-strong" : "text-ink-2")}>{count > 99 ? "99+" : count}</span> : null}
    </button>
  );
}

function SkeletonRows() {
  return (
    <ul className="px-2 py-1" aria-hidden>
      {["60%", "40%", "80%"].map((w, i) => (
        <li key={i} className="flex h-11 items-center gap-3 px-2">
          <span className="h-6 w-6 shrink-0 rounded-full bg-skeleton os-skeleton-pulse" />
          <span className="h-3.5 rounded bg-skeleton os-skeleton-pulse" style={{ width: w }} />
        </li>
      ))}
    </ul>
  );
}

function StateLine({ children }: { children: React.ReactNode }) {
  return <div className="px-4 py-8 text-center text-base text-ink-2">{children}</div>;
}

function ErrorLine({ what, onRetry }: { what: string; onRetry: () => void }) {
  return (
    <div className="px-4 py-8 text-center text-base text-ink-2">
      Couldn&apos;t load {what} ·{" "}
      <button type="button" onClick={onRetry} className="font-medium text-brand-deep hover:underline">Try again</button>
    </div>
  );
}

function RowAction({ label, icon: Icon, onClick, className }: { label: string; icon: typeof Check; onClick: (e: React.MouseEvent) => void; className?: string }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={label}
      title={label}
      className={cn("inline-flex h-7 w-7 items-center justify-center rounded-md text-ink-2 hover:bg-hover hover:text-ink", className)}
    >
      <Icon className="h-4 w-4" strokeWidth={1.5} />
    </button>
  );
}

function InboxTab({ open, onClose, onMutated }: { open: boolean; onClose: () => void; onMutated: () => void }) {
  const [data, setData] = useState<NotifResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const router = useRouter();

  const load = useCallback(async () => {
    // THE BELL LIST AND THE BELL BADGE ANSWER THE SAME QUESTION. The badge
    // counts `unreadWhere` = Primary + Other unread; narrowing the list to
    // `tab=primary` made a viewer with unread Other rows (kudos, announcements,
    // SOP published, status changes, automations) see a number the popover
    // could not account for, and took the bell away as those rows' entry point.
    // `tab=other&all=1&unread=1` IS every unread row, which is the badge's own
    // clause, newest first.
    const r = await apiFetch<NotifResponse>("/api/notifications?tab=other&all=1&unread=1&limit=20", { cache: "no-store" });
    if (!r.ok) { if (r.status !== 401) setError(r.error); return; }
    setError(null);
    setData(r.data);
  }, []);
  useEffect(() => {
    if (!open) return;
    const t = window.setTimeout(() => { void load(); }, 0);
    return () => window.clearTimeout(t);
  }, [open, load]);

  const markOne = async (id: string) => {
    const wasUnread = data?.notifications.some((n) => n.id === id && !n.read) ?? false;
    setData((d) => d ? { ...d, notifications: d.notifications.map((n) => (n.id === id ? { ...n, read: true } : n)), unreadCount: Math.max(0, d.unreadCount - (wasUnread ? 1 : 0)) } : d);
    const r = await apiFetch("/api/notifications", { method: "PATCH", json: { id } });
    if (r.ok) { onMutated(); window.dispatchEvent(new CustomEvent(WINDOW_EVENTS.notifChanged)); }
  };
  const markAll = async () => {
    if (!data || data.unreadCount === 0) return;
    setData((d) => d ? { ...d, notifications: d.notifications.map((n) => ({ ...n, read: true })), unreadCount: 0 } : d);
    const r = await apiFetch("/api/notifications", { method: "PATCH", json: { markAllRead: true } });
    if (r.ok) { onMutated(); window.dispatchEvent(new CustomEvent(WINDOW_EVENTS.notifChanged)); }
  };

  const list = (data?.notifications ?? []).slice(0, 20);
  return (
    <>
      <div className="min-h-0 flex-1 overflow-y-auto">
        {error ? (
          <ErrorLine what="notifications" onRetry={() => { void load(); }} />
        ) : data === null ? (
          <SkeletonRows />
        ) : list.length === 0 ? (
          <StateLine>You&apos;re all caught up</StateLine>
        ) : (
          <ul className="px-2 py-1">
            {list.map((n) => (
              <li key={n.id} className="group/n relative">
                <button
                  type="button"
                  onClick={() => {
                    void markOne(n.id);
                    // The server decides whether the target is still openable;
                    // a row whose task was deleted opens the Inbox, where the
                    // pane says so, rather than a 404.
                    const href = n.target?.readable === false ? `/inbox?n=${n.id}` : n.target?.href ?? n.link;
                    if (href) { onClose(); router.push(href); }
                  }}
                  className="flex h-11 w-full items-center gap-3 rounded-lg px-2 text-start hover:bg-hover"
                >
                  <span className="flex w-2 shrink-0 justify-center">
                    {!n.read ? <span className="h-1.5 w-1.5 rounded-full bg-attention" aria-label="Unread" /> : null}
                  </span>
                  {n.kind ? (
                    <KindIcon name={n.kind.icon} className="h-4 w-4 shrink-0 text-ink-2" label={n.kind.label} />
                  ) : null}
                  <span className="min-w-0 flex-1">
                    <span className={cn("block truncate text-base", n.read ? "text-ink" : "font-medium text-ink")}>{n.title}</span>
                    <span className="block truncate text-xs text-ink-2">
                      {n.message ? `${n.message} · ` : ""}{fmtRelative(n.createdAt)}
                    </span>
                  </span>
                </button>
                {!n.read ? (
                  <span className="absolute end-2 top-1/2 -translate-y-1/2 opacity-0 group-hover/n:opacity-100 focus-within:opacity-100">
                    <RowAction label="Mark read" icon={Check} onClick={(e) => { e.stopPropagation(); void markOne(n.id); }} />
                  </span>
                ) : null}
              </li>
            ))}
          </ul>
        )}
      </div>
      <div className="flex h-9 shrink-0 items-center justify-between border-t border-line px-4">
        <Link href="/inbox" onClick={onClose} className="text-sm font-medium text-brand-deep hover:underline">Open Inbox</Link>
        {data && data.unreadCount > 0 ? (
          <button type="button" onClick={() => { void markAll(); }} className="text-sm font-medium text-ink-2 hover:text-ink">Mark all read</button>
        ) : null}
      </div>
    </>
  );
}

function RemindersTab({ open, onClose, onMutated }: { open: boolean; onClose: () => void; onMutated: () => void }) {
  const [pending, setPending] = useState<Reminder[] | null>(null);
  const [fired, setFired] = useState<Reminder[]>([]);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    const [p, f] = await Promise.all([
      apiFetch<{ reminders: Reminder[] }>("/api/reminders", { cache: "no-store" }),
      apiFetch<{ reminders: Reminder[] }>("/api/reminders?status=FIRED", { cache: "no-store" }),
    ]);
    if (!p.ok) { if (p.status !== 401) setError(p.error); return; }
    setError(null);
    setPending(Array.isArray(p.data?.reminders) ? p.data.reminders : []);
    setFired(f.ok && Array.isArray(f.data?.reminders) ? f.data.reminders : []);
  }, []);
  useEffect(() => {
    if (!open) return;
    const t = window.setTimeout(() => { void load(); }, 0);
    return () => window.clearTimeout(t);
  }, [open, load]);
  useEffect(() => {
    if (!open) return;
    const onChanged = () => { void load(); };
    window.addEventListener(WINDOW_EVENTS.remindersChanged, onChanged);
    return () => window.removeEventListener(WINDOW_EVENTS.remindersChanged, onChanged);
  }, [open, load]);

  const act = async (id: string, body: Record<string, unknown>) => {
    setPending((prev) => (prev ? prev.filter((r) => r.id !== id) : prev));
    setFired((prev) => prev.filter((r) => r.id !== id));
    await apiFetch(`/api/reminders/${id}`, { method: "PATCH", json: body });
    window.dispatchEvent(new CustomEvent(WINDOW_EVENTS.remindersChanged));
    onMutated();
  };

  const rows = [...fired, ...(pending ?? [])].slice(0, 20);
  return (
    <>
      <div className="min-h-0 flex-1 overflow-y-auto">
        {error ? (
          <ErrorLine what="reminders" onRetry={() => { void load(); }} />
        ) : pending === null ? (
          <SkeletonRows />
        ) : rows.length === 0 ? (
          <StateLine>You&apos;re all caught up</StateLine>
        ) : (
          <ul className="px-2 py-1">
            {rows.map((r) => {
              const isTask = r.entityType === "BOARD_ITEM" && r.entityId;
              const Icon = isTask ? CheckSquare : AlarmClock;
              const body = (
                <>
                  <Icon className="h-5 w-5 shrink-0 text-ink-2" strokeWidth={1.5} aria-hidden />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-base text-ink">{r.title}</span>
                    <span className="block truncate text-xs text-ink-2">{fmtDue(r.remindAt)}</span>
                  </span>
                </>
              );
              return (
                <li key={r.id} className="group/r relative">
                  {isTask ? (
                    <Link href={`/item/${r.entityId}`} onClick={onClose} className="flex h-11 items-center gap-3 rounded-lg px-2 hover:bg-hover">{body}</Link>
                  ) : (
                    <div className="flex h-11 items-center gap-3 rounded-lg px-2 hover:bg-hover">{body}</div>
                  )}
                  <span className="absolute end-2 top-1/2 flex -translate-y-1/2 items-center gap-0.5 opacity-0 group-hover/r:opacity-100 focus-within:opacity-100">
                    <RowAction label="Snooze 1 hour" icon={Clock} onClick={(e) => { e.preventDefault(); e.stopPropagation(); void act(r.id, { snoozeMinutes: 60 }); }} />
                    <RowAction label="Snooze until tomorrow 9am" icon={AlarmClock} onClick={(e) => { e.preventDefault(); e.stopPropagation(); void act(r.id, { snoozeMinutes: tomorrow9amMinutes() }); }} />
                    <RowAction label="Done" icon={Check} onClick={(e) => { e.preventDefault(); e.stopPropagation(); void act(r.id, {}); }} />
                  </span>
                </li>
              );
            })}
          </ul>
        )}
      </div>
      <div className="flex h-9 shrink-0 items-center border-t border-line px-4">
        <button
          type="button"
          onClick={() => { onClose(); window.setTimeout(() => window.dispatchEvent(new CustomEvent("workwrk:tool", { detail: "reminder" })), 0); }}
          className="text-sm font-medium text-brand-deep hover:underline"
        >
          New reminder
        </button>
      </div>
    </>
  );
}

/**
 * The desktop alert and the in-app toast for a NEW inbox item, driven by the
 * boot count climbing (SSE or the fallback poll). Muted (home.notifications
 * .mutedUntil) silences the alert and the toast; the dot is unaffected.
 */
function useNewItemAlerts(muted: boolean) {
  const { counts } = useBoot();
  const desktop = useDesktopNotifications();
  const { toast } = useOsToast();
  const router = useRouter();
  const prev = useRef<number | null>(null);
  const lastNotified = useRef<string | null>(null);
  const mutedRef = useRef(muted);
  useEffect(() => { mutedRef.current = muted; }, [muted]);
  const enabledRef = useRef(desktop.enabled);
  const notifyRef = useRef(desktop.notify);
  useEffect(() => { enabledRef.current = desktop.enabled; notifyRef.current = desktop.notify; }, [desktop.enabled, desktop.notify]);

  useEffect(() => {
    const next = counts.inboxUnread;
    const before = prev.current;
    prev.current = next;
    if (before === null || next <= before || mutedRef.current) return;
    let alive = true;
    void (async () => {
      // THE BELL LIST AND THE BELL BADGE ANSWER THE SAME QUESTION. The badge
    // counts `unreadWhere` = Primary + Other unread; narrowing the list to
    // `tab=primary` made a viewer with unread Other rows (kudos, announcements,
    // SOP published, status changes, automations) see a number the popover
    // could not account for, and took the bell away as those rows' entry point.
    // `tab=other&all=1&unread=1` IS every unread row, which is the badge's own
    // clause, newest first.
    const r = await apiFetch<NotifResponse>("/api/notifications?tab=other&all=1&unread=1&limit=20", { cache: "no-store" });
      if (!alive || !r.ok) return;
      const newest = r.data.notifications?.find((n) => !n.read);
      if (!newest || newest.id === lastNotified.current) return;
      lastNotified.current = newest.id;
      const link = newest.link || "/inbox";
      const base = link.split("?")[0];
      if (newest.type === "call_incoming") return;
      if (base.startsWith("/tlk/") && window.location.pathname === base) return;
      if (document.hidden) {
        if (enabledRef.current) notifyRef.current({ title: newest.title || "New notification", body: newest.message || undefined, url: link, tag: "workwrk-notification" });
        return;
      }
      toast(newest.title || "New notification", { onUndo: undefined, action: { label: "Open", onClick: () => router.push(link) } });
    })();
    return () => { alive = false; };
  }, [counts.inboxUnread, toast, router]);
}
