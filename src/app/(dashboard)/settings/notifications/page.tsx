"use client";

// Settings · Notifications — the ONE per-user notification page (Wave 2b
// merge). It folds in what used to be a second page at /account/notifications
// (now a redirect here). Two sections:
//
//   Inbox   — in-app rows in /inbox + the bell.  Store: UserPreference.home
//             .notifications.inbox  via GET/PATCH /api/preferences.
//   Email   — what WorkwrK emails you.  Reconciles TWO historical stores:
//               • Task & activity emails → UserPreference.home.notifications
//                 .email (the same JSON store as Inbox, master switch + per
//                 type), enforced by src/lib/notify-prefs.ts shouldEmail.
//               • Workflow & HR emails (KRA / Review / SOP / Daily digest) →
//                 the EmailPreference model via GET/PATCH /api/email-preferences,
//                 enforced by shouldSendEmail() inside src/lib/email.ts.
//
// Why two stores remain: the send-time gates live in server code we don't own
// here (notify-prefs.ts checks the JSON store; email.ts checks EmailPreference).
// So the page reads/writes both and presents them as one coherent surface.
//
// KUDOS de-duplication: a kudos email is gated by BOTH stores at once
// (shouldEmail("kudos") on the JSON store AND category:"kudos" →
// kudosNotifications on EmailPreference — see src/app/api/kudos/route.ts). It
// therefore renders as a SINGLE row whose one switch writes BOTH stores in
// lockstep, so the visible state always matches whether an email will send.
//
// Honest-Soon: a row whose producer doesn't exist yet renders disabled with a
// "Soon" chip instead of a live toggle that would do nothing. Wave 1 made the
// item producers real, so the Inbox rows (incl. task_assigned + status_changes,
// via src/lib/notify-item.ts) are all live and NOT marked Soon.

import { useCallback, useEffect, useState } from "react";
import { Loader2 } from "lucide-react";
import { Switch } from "@/components/ui/switch";
import { useOsToast } from "@/components/layout/os/toast";

// ── Store 1: UserPreference.home.notifications (/api/preferences) ──────
// Keys match NotifyType in src/lib/notify-prefs.ts — keep in sync.
type NotifKey = "task_assigned" | "mentions" | "comments" | "status_changes" | "due_reminders" | "kudos";

interface JsonPrefs {
  inbox: Record<string, boolean>;
  email: Record<string, boolean>; // includes the "master" switch key
}

// ── Store 2: EmailPreference model (/api/email-preferences) ───────────
type EmailCatKey = "kraNotifications" | "reviewNotifications" | "sopNotifications" | "kudosNotifications" | "dailyDigest";
type EmailCats = Record<EmailCatKey, boolean>;

const DEFAULT_JSON: JsonPrefs = { inbox: {}, email: {} };
const DEFAULT_CATS: EmailCats = {
  kraNotifications: false,
  reviewNotifications: false,
  sopNotifications: false,
  kudosNotifications: false,
  dailyDigest: false,
};

// `live: false` → the platform doesn't produce this notification yet;
// rendered as a disabled row with a "Soon" chip (Honest-Soon).
type Row = { key: NotifKey; label: string; sub: string; live: boolean };

const INBOX_ROWS: Row[] = [
  { key: "task_assigned", label: "Task assigned to me", sub: "When a task is created for you or reassigned to you", live: true },
  { key: "mentions", label: "@Mentions", sub: "When someone mentions you in a comment or doc", live: true },
  { key: "comments", label: "Comments on my tasks", sub: "When someone comments on a task assigned to you", live: true },
  // Live since the item-pipeline build — PATCH /api/items/[id] emits through
  // src/lib/notify-item.ts (owner + comment-thread participants, actor excluded).
  { key: "status_changes", label: "Status changes on my tasks", sub: "When a task you're assigned changes status", live: true },
  { key: "due_reminders", label: "Due-date reminders", sub: "When a task assigned to you is due today", live: true },
  { key: "kudos", label: "Kudos & recognition", sub: "When a teammate recognizes you", live: true },
];

// Task & activity email rows (store 1). Live only where WorkwrK actually sends
// that email today (task-assigned + kudos). The rest are Soon until wired.
// `kudos` carries sync:true — its switch writes BOTH stores (see header note).
type EmailRow = Row & { sync?: boolean };
const EMAIL_ACTIVITY_ROWS: EmailRow[] = [
  { key: "task_assigned", label: "Task assigned to me", sub: "Email when a task is assigned to you", live: true },
  { key: "mentions", label: "@Mentions", sub: "Email when someone mentions you", live: false },
  { key: "comments", label: "Comments on my tasks", sub: "Email when someone comments on your task", live: false },
  { key: "status_changes", label: "Status changes on my tasks", sub: "Email when your task changes status", live: false },
  { key: "due_reminders", label: "Due-date reminders", sub: "Email when a task is due", live: false },
  { key: "kudos", label: "Kudos & recognition", sub: "Email when a teammate recognizes you", live: true, sync: true },
];

// Workflow & HR email rows (store 2 — EmailPreference). NOT governed by the
// store-1 master switch (shouldSendEmail never consults it).
const EMAIL_CATEGORY_ROWS: Array<{ key: EmailCatKey; label: string; sub: string; live: boolean }> = [
  { key: "kraNotifications", label: "KRA & KPI updates", sub: "Email on assignments and score activity", live: true },
  { key: "reviewNotifications", label: "Review reminders", sub: "Email for weekly & cycle reviews", live: true },
  { key: "sopNotifications", label: "SOP updates", sub: "Email for new & changed procedures you're assigned", live: true },
  { key: "dailyDigest", label: "Daily digest", sub: "One summary email each morning", live: false },
];

function SoonChip() {
  return (
    <span className="rounded bg-zinc-100 px-1.5 py-0.5 text-[11px] font-medium text-zinc-400">Soon</span>
  );
}

function PrefRow({
  label,
  sub,
  live,
  checked,
  disabled,
  onChange,
}: {
  label: string;
  sub: string;
  live: boolean;
  checked: boolean;
  disabled?: boolean;
  onChange: (next: boolean) => void;
}) {
  const dimmed = !live || disabled;
  return (
    <div className="flex items-center justify-between gap-4 border-b border-zinc-100 px-4 py-3 last:border-0">
      <div className={`min-w-0 ${dimmed ? "opacity-60" : ""}`}>
        <div className="text-[14px] font-medium text-zinc-900">{label}</div>
        <div className="text-[13px] text-zinc-500">{sub}</div>
      </div>
      {live ? (
        <Switch checked={checked} disabled={disabled} onChange={onChange} aria-label={label} />
      ) : (
        <SoonChip />
      )}
    </div>
  );
}

export default function NotificationSettingsPage() {
  const { toast } = useOsToast();
  const [json, setJson] = useState<JsonPrefs | null>(null);
  const [cats, setCats] = useState<EmailCats | null>(null);

  useEffect(() => {
    let alive = true;
    // Store 1 — UserPreference.home.notifications.
    fetch("/api/preferences")
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        if (!alive) return;
        const n = d?.effective?.home?.notifications;
        setJson({ inbox: { ...(n?.inbox ?? {}) }, email: { ...(n?.email ?? {}) } });
      })
      .catch(() => {
        if (alive) {
          setJson(DEFAULT_JSON);
          toast("Couldn't load notification settings");
        }
      });
    // Store 2 — EmailPreference categories.
    fetch("/api/email-preferences", { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        if (!alive) return;
        setCats({
          kraNotifications: !!d?.kraNotifications,
          reviewNotifications: !!d?.reviewNotifications,
          sopNotifications: !!d?.sopNotifications,
          kudosNotifications: !!d?.kudosNotifications,
          dailyDigest: !!d?.dailyDigest,
        });
      })
      .catch(() => {
        if (alive) setCats(DEFAULT_CATS);
      });
    return () => { alive = false; };
  }, [toast]);

  // Optimistic PATCH of the whole store-1 notifications object; revert on fail.
  const saveJson = useCallback(
    (next: JsonPrefs, prev: JsonPrefs) => {
      setJson(next);
      return fetch("/api/preferences", {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ home: { notifications: next } }),
      }).then((res) => {
        if (!res.ok) throw new Error(`status ${res.status}`);
      }).catch((err) => {
        setJson(prev);
        throw err;
      });
    },
    [],
  );

  // Optimistic PATCH of one store-2 category; revert on fail.
  const saveCat = useCallback(
    (next: EmailCats, prev: EmailCats, key: EmailCatKey) => {
      setCats(next);
      return fetch("/api/email-preferences", {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ [key]: next[key] }),
      }).then((res) => {
        if (!res.ok) throw new Error(`status ${res.status}`);
      }).catch((err) => {
        setCats(prev);
        throw err;
      });
    },
    [],
  );

  const setInbox = (key: NotifKey, value: boolean) => {
    if (!json) return;
    saveJson({ ...json, inbox: { ...json.inbox, [key]: value } }, json).catch(() =>
      toast("Couldn't save — try again"),
    );
  };
  const setEmail = (key: string, value: boolean) => {
    if (!json) return;
    saveJson({ ...json, email: { ...json.email, [key]: value } }, json).catch(() =>
      toast("Couldn't save — try again"),
    );
  };
  const setCat = (key: EmailCatKey, value: boolean) => {
    if (!cats) return;
    saveCat({ ...cats, [key]: value }, cats, key).catch(() => toast("Couldn't save — try again"));
  };
  // Kudos email is double-gated — one switch, both stores, both must succeed.
  const setKudosEmail = (value: boolean) => {
    if (!json || !cats) return;
    Promise.all([
      saveJson({ ...json, email: { ...json.email, kudos: value } }, json),
      saveCat({ ...cats, kudosNotifications: value }, cats, "kudosNotifications"),
    ]).catch(() => toast("Couldn't save — try again"));
  };

  const loading = json === null || cats === null;
  const emailMaster = json ? json.email.master !== false : true;

  return (
    <div className="px-6 pt-6">
      <header className="mb-1">
        <h1 className="text-[16px] font-bold text-zinc-900">Notifications</h1>
      </header>
      <p className="mb-5 text-[13px] text-zinc-500">
        Choose what lands in your Inbox and what WorkwrK emails you. Changes save automatically.
      </p>

      {loading ? (
        <div className="flex items-center gap-2 text-[14px] text-zinc-400">
          <Loader2 className="h-4 w-4 animate-spin" /> Loading…
        </div>
      ) : (
        <div className="max-w-2xl">
          {/* ── Inbox (in-app) ─────────────────────────────────────── */}
          <h2 className="mb-2 text-[14px] font-semibold text-zinc-900">Inbox</h2>
          <div className="mb-6 overflow-hidden rounded-xl border border-zinc-200 bg-white">
            {INBOX_ROWS.map((row) => (
              <PrefRow
                key={row.key}
                label={row.label}
                sub={row.sub}
                live={row.live}
                checked={json!.inbox[row.key] !== false}
                onChange={(v) => setInbox(row.key, v)}
              />
            ))}
          </div>

          {/* ── Email · Task & activity (store 1, master-governed) ──── */}
          <h2 className="mb-2 text-[14px] font-semibold text-zinc-900">Email</h2>
          <div className="mb-1.5 text-[13px] font-medium uppercase tracking-wide text-zinc-400">Task &amp; activity</div>
          <div className="mb-5 overflow-hidden rounded-xl border border-zinc-200 bg-white">
            <div className="flex items-center justify-between gap-4 border-b border-zinc-100 px-4 py-3">
              <div className="min-w-0">
                <div className="text-[14px] font-medium text-zinc-900">Email notifications</div>
                <div className="text-[13px] text-zinc-500">Master switch for the task &amp; activity emails below</div>
              </div>
              <Switch
                checked={emailMaster}
                onChange={(v) => setEmail("master", v)}
                aria-label="Email notifications"
              />
            </div>
            {EMAIL_ACTIVITY_ROWS.map((row) => {
              const checked = row.sync
                ? json!.email.kudos !== false && cats!.kudosNotifications
                : json!.email[row.key] !== false;
              return (
                <PrefRow
                  key={row.key}
                  label={row.label}
                  sub={row.sub}
                  live={row.live}
                  checked={checked}
                  disabled={!emailMaster}
                  onChange={(v) => (row.sync ? setKudosEmail(v) : setEmail(row.key, v))}
                />
              );
            })}
          </div>

          {/* ── Email · Workflow & HR (store 2, independent of master) ─ */}
          <div className="mb-1.5 text-[13px] font-medium uppercase tracking-wide text-zinc-400">Workflow &amp; HR</div>
          <div className="mb-3 overflow-hidden rounded-xl border border-zinc-200 bg-white">
            {EMAIL_CATEGORY_ROWS.map((row) => (
              <PrefRow
                key={row.key}
                label={row.label}
                sub={row.sub}
                live={row.live}
                checked={cats![row.key]}
                onChange={(v) => setCat(row.key, v)}
              />
            ))}
          </div>
          <p className="mb-6 text-[13px] text-zinc-500">
            Workflow &amp; HR emails send independently of the master switch above.
          </p>
        </div>
      )}
      <div className="h-10" />
    </div>
  );
}
