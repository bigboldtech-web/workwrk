"use client";

// Settings · Notifications — per-user notification preferences, split into
// "Inbox" (in-app rows in /inbox + the bell) and "Email" sections.
//
// Storage: UserPreference.home.notifications via GET/PATCH /api/preferences
// ({ home: { notifications: { inbox, email } } }) — no schema migration.
// Enforcement lives in src/lib/notify-prefs.ts (shouldNotify/shouldEmail),
// wired into the task-assigned / comment / kudos / due-today creation sites,
// and — for the real Board-Item task pipeline — src/lib/notify-item.ts, the
// single door every item notification passes through.
//
// Honest-Soon: rows whose notification type isn't produced anywhere yet
// (@mentions, status changes; and most email types) render disabled with a
// "Soon" chip instead of a live toggle that would do nothing.

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { Loader2 } from "lucide-react";
import { Switch } from "@/components/ui/switch";
import { useOsToast } from "@/components/layout/os/toast";

// Keys match NotifyType in src/lib/notify-prefs.ts — keep in sync.
type NotifKey = "task_assigned" | "mentions" | "comments" | "status_changes" | "due_reminders" | "kudos";

interface NotifPrefs {
  inbox: Record<string, boolean>;
  email: Record<string, boolean>; // includes the "master" switch key
}

const DEFAULT_PREFS: NotifPrefs = { inbox: {}, email: {} };

// `live: false` → the platform doesn't produce this notification type yet;
// rendered as a disabled row with a "Soon" chip (Honest-Soon).
type Row = { key: NotifKey; label: string; sub: string; live: boolean };

const INBOX_ROWS: Row[] = [
  { key: "task_assigned", label: "Task assigned to me", sub: "When a task is created for you or reassigned to you", live: true },
  // Live since the comment @mention build — the updates route filters
  // recipients through this toggle (filterNotifyUsers "mentions").
  { key: "mentions", label: "@Mentions", sub: "When someone mentions you in a comment or doc", live: true },
  { key: "comments", label: "Comments on my tasks", sub: "When someone comments on a task assigned to you", live: true },
  // Live since the item-pipeline build — PATCH /api/items/[id] emits through
  // src/lib/notify-item.ts (owner + comment-thread participants, actor excluded).
  { key: "status_changes", label: "Status changes on my tasks", sub: "When a task you're assigned changes status", live: true },
  { key: "due_reminders", label: "Due-date reminders", sub: "When a task assigned to you is due today", live: true },
  { key: "kudos", label: "Kudos & recognition", sub: "When a teammate recognizes you", live: true },
];

// Email rows are live only where WorkwrK actually sends that email today
// (task-assigned + kudos). The rest are Soon until sending is wired.
const EMAIL_ROWS: Row[] = [
  { key: "task_assigned", label: "Task assigned to me", sub: "Email when a task is assigned to you", live: true },
  { key: "mentions", label: "@Mentions", sub: "Email when someone mentions you", live: false },
  { key: "comments", label: "Comments on my tasks", sub: "Email when someone comments on your task", live: false },
  { key: "status_changes", label: "Status changes on my tasks", sub: "Email when your task changes status", live: false },
  { key: "due_reminders", label: "Due-date reminders", sub: "Email when a task is due", live: false },
  { key: "kudos", label: "Kudos & recognition", sub: "Email when a teammate recognizes you", live: true },
];

function SoonChip() {
  return (
    <span className="rounded bg-zinc-100 px-1.5 py-0.5 text-[10px] font-medium text-zinc-400">Soon</span>
  );
}

function PrefRow({
  row,
  checked,
  disabled,
  onChange,
}: {
  row: Row;
  checked: boolean;
  disabled?: boolean;
  onChange: (next: boolean) => void;
}) {
  const dimmed = !row.live || disabled;
  return (
    <div className="flex items-center justify-between gap-4 border-b border-zinc-100 px-4 py-3 last:border-0">
      <div className={`min-w-0 ${dimmed ? "opacity-60" : ""}`}>
        <div className="text-[13px] font-medium text-zinc-900">{row.label}</div>
        <div className="text-[12px] text-zinc-500">{row.sub}</div>
      </div>
      {row.live ? (
        <Switch checked={checked} disabled={disabled} onChange={onChange} aria-label={row.label} />
      ) : (
        <SoonChip />
      )}
    </div>
  );
}

export default function NotificationSettingsPage() {
  const { toast } = useOsToast();
  const [prefs, setPrefs] = useState<NotifPrefs | null>(null);

  useEffect(() => {
    let alive = true;
    fetch("/api/preferences")
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        if (!alive) return;
        const n = d?.effective?.home?.notifications;
        setPrefs({
          inbox: { ...(n?.inbox ?? {}) },
          email: { ...(n?.email ?? {}) },
        });
      })
      .catch(() => {
        if (alive) {
          setPrefs(DEFAULT_PREFS);
          toast("Couldn't load notification settings");
        }
      });
    return () => { alive = false; };
  }, [toast]);

  // Optimistic save of the whole notifications object; revert + toast on failure.
  const save = useCallback(
    (next: NotifPrefs, prev: NotifPrefs) => {
      setPrefs(next);
      fetch("/api/preferences", {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ home: { notifications: next } }),
      })
        .then((res) => {
          if (!res.ok) throw new Error(`status ${res.status}`);
        })
        .catch(() => {
          setPrefs(prev);
          toast("Couldn't save — try again");
        });
    },
    [toast],
  );

  const setInbox = (key: NotifKey, value: boolean) => {
    if (!prefs) return;
    save({ ...prefs, inbox: { ...prefs.inbox, [key]: value } }, prefs);
  };
  const setEmail = (key: string, value: boolean) => {
    if (!prefs) return;
    save({ ...prefs, email: { ...prefs.email, [key]: value } }, prefs);
  };

  const emailMaster = prefs ? prefs.email.master !== false : true;

  return (
    <div className="px-6 pt-6">
      <header className="mb-1">
        <h1 className="text-[16px] font-bold text-zinc-900">Notifications</h1>
      </header>
      <p className="mb-5 text-[12px] text-zinc-500">
        Choose what lands in your Inbox and what WorkwrK emails you. Changes save automatically.
      </p>

      {prefs === null ? (
        <div className="flex items-center gap-2 text-[13px] text-zinc-400">
          <Loader2 className="h-4 w-4 animate-spin" /> Loading…
        </div>
      ) : (
        <div className="max-w-2xl">
          <h2 className="mb-2 text-[13px] font-semibold text-zinc-900">Inbox</h2>
          <div className="mb-6 overflow-hidden rounded-xl border border-zinc-200 bg-white">
            {INBOX_ROWS.map((row) => (
              <PrefRow
                key={row.key}
                row={row}
                checked={prefs.inbox[row.key] !== false}
                onChange={(v) => setInbox(row.key, v)}
              />
            ))}
          </div>

          <h2 className="mb-2 text-[13px] font-semibold text-zinc-900">Email</h2>
          <div className="mb-3 overflow-hidden rounded-xl border border-zinc-200 bg-white">
            <div className="flex items-center justify-between gap-4 border-b border-zinc-100 px-4 py-3">
              <div className="min-w-0">
                <div className="text-[13px] font-medium text-zinc-900">Email notifications</div>
                <div className="text-[12px] text-zinc-500">Master switch for the notification emails below</div>
              </div>
              <Switch
                checked={emailMaster}
                onChange={(v) => setEmail("master", v)}
                aria-label="Email notifications"
              />
            </div>
            {EMAIL_ROWS.map((row) => (
              <PrefRow
                key={row.key}
                row={row}
                checked={prefs.email[row.key] !== false}
                disabled={!emailMaster}
                onChange={(v) => setEmail(row.key, v)}
              />
            ))}
          </div>
          <p className="mb-6 text-[12px] text-zinc-500">
            Looking for KRA, review, SOP and digest emails?{" "}
            <Link href="/account/notifications" className="font-medium text-[var(--os-brand-ink)] hover:underline">
              Manage email categories
            </Link>
          </p>
        </div>
      )}
      <div className="h-10" />
    </div>
  );
}
