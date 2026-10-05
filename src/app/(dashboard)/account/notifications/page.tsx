"use client";

// My settings > Notifications (spec-account-auth `/account/notifications`):
// what WorkwrK tells you about, where, and when it stays quiet. Autosave
// throughout, so no Save bar and no blue button.
//
//   Quiet (above the tabs)   Mute everything until: home.notifications.mutedUntil,
//                            the same key the avatar menu writes. Quiet hours
//                            has no sender that reads it yet, so it sits behind
//                            Show upcoming features.
//   Inbox    presets (Default, Focused, Custom; read back from the switches),
//            the six task and people switches (home.notifications.inbox,
//            read by notify-prefs.ts), the four Talk and announcement switches
//            (read by the message and announcement fan-outs through
//            inbox-notify-keys.ts), How the Inbox behaves (inboxView, read by
//            the Inbox and the auto-clear cron), and Muted items
//            (home.notifications.muted[] and muted Talk conversations).
//   Email    Send me email (the master for the task emails) with the two that
//            really send today; Work updates by email (EmailPreference, sent
//            whether or not the master is on, and the page says so); the
//            rest behind Show upcoming features; Reports you receive.
//   Desktop  This browser's permission in words, home.notifications.desktop
//            (read by the bell's desktop alerts) and Ring for incoming calls
//            (desktopRingCalls, read by the incoming call card).
//
// Two stores stay because the send-time gates live in two places:
// notify-prefs.ts reads the JSON store, email.ts reads EmailPreference. The
// kudos email is gated by both, so its one switch writes both.

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter, useSearchParams, usePathname } from "next/navigation";
import Link from "next/link";
import { apiFetch } from "@/lib/api-client";
import { useOsShell } from "@/components/layout/os/shell-context";
import { useOsToast } from "@/components/layout/os/toast";
import { OsEmptyView } from "@/components/layout/os/empty-view";
import { SettingsPage, type SettingsTab } from "@/components/settings/settings-page";
import { SettingsCard, SettingsCardStack } from "@/components/settings/settings-card";
import { SettingsRow } from "@/components/settings/settings-row";
import { SegmentedControl } from "@/components/ui/segmented-control";
import { Switch } from "@/components/ui/switch";
import { PickerSelect } from "@/components/settings/picker-select";
import { SkeletonRows } from "@/components/ui/skeleton";
import { ComingSoonRow, UpcomingOnly } from "@/components/ui/coming-soon-row";
import { btn } from "@/components/account/account-ui";
import { useDesktopNotifications } from "@/hooks/use-desktop-notifications";
import { useDatePrefs } from "@/lib/format/use-date-prefs";
import { formatDate } from "@/lib/format/date";
import { cadenceLabel, formatRunTime } from "@/lib/reports/schedule-form";
import type { ReportCadence } from "@/lib/reports/schedule";
import { dashboardMessage } from "@/lib/dashboards/dashboard-messages";
import { settingsTabs } from "@/lib/settings-registry";
import { TALK_INBOX_KEYS, TALK_INBOX_LABELS } from "@/lib/inbox-notify-keys";
import type { PreferencesPatch } from "@/lib/preferences-schema";
import {
  activeMute,
  isMuteForever,
  mutedUntilFor,
  inboxKeyOn,
  presetOf,
  presetValues,
  type InboxPreset,
  type MuteChoice,
  type TaskInboxKey,
} from "@/lib/account/notification-presets";
import { useBoot } from "@/components/layout/os/boot-context";

const TABS: readonly SettingsTab[] = settingsTabs("account/notifications");

// Decided addition (c): assigned, mentioned, status change and comment on
// my task and on a task I follow, due soon and overdue. "Follow" is the task's
// Watch button (and having commented on it), which is what the senders read.
const WORK_ROWS: { key: TaskInboxKey; label: string; helper: string }[] = [
  { key: "task_assigned", label: "Tasks assigned to me", helper: "When a task is created for you or handed to you" },
  { key: "status_changes", label: "Status changes on my tasks", helper: "When a task you are assigned to changes status" },
  { key: "followed_status", label: "Status changes on tasks I follow", helper: "Tasks you watch or have commented on" },
  { key: "due_reminders", label: "Due soon", helper: "On the day a task assigned to you is due" },
  { key: "overdue", label: "Overdue", helper: "Once a day while a task assigned to you is past its due date" },
];
const PEOPLE_ROWS: { key: TaskInboxKey; label: string; helper: string }[] = [
  { key: "mentions", label: "Mentions of me", helper: "When someone mentions you in a comment or doc" },
  { key: "comments", label: "Comments on my work", helper: "When someone comments on a task assigned to you" },
  { key: "followed_comments", label: "Comments on tasks I follow", helper: "Tasks you watch but are not assigned to" },
  { key: "kudos", label: "Kudos I receive", helper: "When a teammate recognises you" },
];

type EmailCatKey = "kraNotifications" | "reviewNotifications" | "sopNotifications" | "kudosNotifications" | "dailyDigest";
type EmailCats = Record<EmailCatKey, boolean>;

/** Per-row save state for the preference writes. */
function useRowWrites() {
  const { patchPrefs } = useOsShell();
  const [savedAt, setSavedAt] = useState<Record<string, number>>({});
  const [failed, setFailed] = useState<Record<string, () => void>>({});
  const runRef = useRef<(key: string, fn: () => Promise<boolean>) => Promise<boolean>>(async () => false);
  const run = useCallback(async (key: string, fn: () => Promise<boolean>) => {
    const ok = await fn();
    if (ok) {
      setSavedAt((s) => ({ ...s, [key]: Date.now() }));
      setFailed((f) => { const n = { ...f }; delete n[key]; return n; });
    } else {
      setFailed((f) => ({ ...f, [key]: () => { void runRef.current(key, fn); } }));
    }
    return ok;
  }, []);
  useEffect(() => { runRef.current = run; }, [run]);
  const write = useCallback((key: string, patch: PreferencesPatch) => run(key, () => patchPrefs(patch)), [run, patchPrefs]);
  const row = (key: string) => ({
    savedAt: savedAt[key] ?? null,
    error: failed[key] ? { message: "Couldn't save", onRetry: failed[key] } : null,
  });
  return { write, run, row };
}

export default function NotificationSettingsPage() {
  const router = useRouter();
  const pathname = usePathname() || "/account/notifications";
  const params = useSearchParams();

  // The report email's manage link is /account/notifications#reports: the
  // reports card lives on the Email tab, so land there.
  useEffect(() => {
    if (typeof window === "undefined") return;
    if (window.location.hash === "#reports" && !params?.get("tab")) {
      router.replace(`${pathname}?tab=email#reports`, { scroll: false });
    }
  }, [params, pathname, router]);

  return (
    // Quiet covers all three channels, so it sits above the tabs (spec
    // page header stack: title, subtitle, Quiet, then Inbox / Email / Desktop).
    <SettingsPage pageKey="account/notifications" tabs={TABS} subtitle="Everything here applies to you only." lead={<QuietCard />}>
      {(tab) => (
        <SettingsCardStack>
          {tab === "email" ? <EmailTab /> : tab === "desktop" ? <DesktopTab /> : <InboxTab />}
        </SettingsCardStack>
      )}
    </SettingsPage>
  );
}

function QuietCard() {
  const { prefs, setMutedUntil } = useOsShell();
  const dprefs = useDatePrefs();
  const { run, row } = useRowWrites();
  const until = activeMute(prefs.home.notifications?.mutedUntil ?? null);
  const [custom, setCustom] = useState("");
  // Whether the picked time is in the future, decided when it changes (never
  // by reading the clock during render).
  const [customValid, setCustomValid] = useState(false);
  const [showCustom, setShowCustom] = useState(false);
  const value: MuteChoice = !until ? "off" : isMuteForever(until) ? "forever" : "custom";

  const choose = (c: MuteChoice) => {
    if (c === "custom") { setShowCustom(true); return; }
    setShowCustom(false);
    void run("mute", () => setMutedUntil(c === "off" ? null : mutedUntilFor(c)));
  };

  return (
    <SettingsCard
      title="Quiet"
      id="notifications.quiet"
      actions={until ? (
        <span className="inline-flex items-center gap-2 text-sm">
          <span className="rounded-md bg-hover px-2 py-0.5 font-medium text-ink-2">
            {isMuteForever(until) ? "Muted" : `Muted until ${formatDate(until, dprefs, "datetime")}`}
          </span>
          <button type="button" className={btn.link} onClick={() => choose("off")}>Unmute</button>
        </span>
      ) : undefined}
    >
      <div>
        <SettingsRow
          id="notifications.mutedUntil"
          label="Mute everything until"
          helper="Nothing new pings you: the Inbox still collects it. The avatar menu changes the same setting."
          {...row("mute")}
          control={
            <PickerSelect
              label="Mute everything until"
              value={showCustom ? "custom" : value}
              options={[
                { value: "off", label: "Not muted" },
                { value: "1h", label: "1 hour" },
                { value: "tomorrow", label: "Until tomorrow, 9:00 am" },
                { value: "forever", label: "Until I turn it back on" },
                { value: "custom", label: value === "custom" && until ? `Until ${formatDate(until, dprefs, "datetime")}` : "Pick a time..." },
              ]}
              onChange={(v) => choose(v as MuteChoice)}
            />
          }
        />
        {showCustom ? (
          <SettingsRow
            label="Mute until"
            control={
              <span className="inline-flex items-center gap-2">
                <input type="datetime-local" aria-label="Mute until" value={custom} onChange={(e) => { setCustom(e.target.value); setCustomValid(Date.parse(e.target.value) > Date.now()); }} className="h-9 rounded-md border border-line-strong bg-raised px-2 text-base text-ink" />
                <button
                  type="button"
                  className={btn.secondary}
                  disabled={!custom || !customValid}
                  onClick={() => { const t = Date.parse(custom); if (t > Date.now()) { setShowCustom(false); void run("mute", () => setMutedUntil(new Date(t).toISOString())); } }}
                >
                  Mute
                </button>
              </span>
            }
          />
        ) : null}
        <UpcomingOnly>
          <ComingSoonRow label="Quiet hours: email and desktop notifications wait until they end" className="border-b-0" />
        </UpcomingOnly>
      </div>
    </SettingsCard>
  );
}

function InboxTab() {
  const { prefs } = useOsShell();
  const { write, row } = useRowWrites();
  const autoClears = !!useBoot().boot.org.inboxAutoClears;
  const inbox = prefs.home.notifications?.inbox ?? {};
  const view = prefs.home.notifications?.inboxView ?? {};
  const preset = presetOf(inbox);
  // The same reader the senders use (split keys follow their parent until set).
  const on = (k: string) => inboxKeyOn(inbox, k);
  const setKey = (k: string, v: boolean) => { void write(`inbox.${k}`, { home: { notifications: { inbox: { [k]: v } } } }); };
  const setView = (key: string, patch: NonNullable<NonNullable<NonNullable<PreferencesPatch["home"]>["notifications"]>["inboxView"]>) => {
    void write(`view.${key}`, { home: { notifications: { inboxView: patch } } });
  };

  return (
    <>
      <SettingsCard title="Notification preset" id="notifications.preset" description="Focused keeps only what is aimed at you: tasks assigned to you, mentions and your overdue tasks.">
        <SettingsRow
          label="Preset"
          helper={preset === "custom" ? "Custom: your own mix of the switches below" : undefined}
          {...row("preset")}
          control={
            <SegmentedControl<InboxPreset>
              label="Notification preset"
              value={preset}
              options={[{ value: "default", label: "Default" }, { value: "focused", label: "Focused" }, { value: "custom", label: "Custom" }]}
              onChange={(v) => {
                // Custom is the switches themselves: choosing it takes you to them.
                if (v === "custom") {
                  const first = document.querySelector<HTMLElement>('[id="notifications.inbox.work"] [role="switch"]');
                  first?.scrollIntoView({ block: "center", behavior: "smooth" });
                  first?.focus({ preventScroll: true });
                  return;
                }
                void write("preset", { home: { notifications: { inbox: presetValues(v) } } });
              }}
            />
          }
        />
      </SettingsCard>

      <SettingsCard title="Tell me about my work" id="notifications.inbox.work">
        <div>
          {WORK_ROWS.map((r) => (
            <SettingsRow key={r.key} id={`notifications.inbox.${r.key}`} label={r.label} helper={r.helper} {...row(`inbox.${r.key}`)} control={<Switch checked={on(r.key)} onChange={(v) => setKey(r.key, v)} aria-label={r.label} />} />
          ))}
        </div>
      </SettingsCard>

      <SettingsCard title="Tell me about people" id="notifications.inbox.people">
        <div>
          {PEOPLE_ROWS.map((r) => (
            <SettingsRow key={r.key} id={`notifications.inbox.${r.key}`} label={r.label} helper={r.helper} {...row(`inbox.${r.key}`)} control={<Switch checked={on(r.key)} onChange={(v) => setKey(r.key, v)} aria-label={r.label} />} />
          ))}
        </div>
      </SettingsCard>

      <SettingsCard title="Talk and announcements" id="notifications.inbox.talk">
        <div>
          {TALK_INBOX_KEYS.map((k) => (
            <SettingsRow key={k} id={`notifications.inbox.${k}`} label={TALK_INBOX_LABELS[k].label} helper={TALK_INBOX_LABELS[k].sub} {...row(`inbox.${k}`)} control={<Switch checked={on(k)} onChange={(v) => setKey(k, v)} aria-label={TALK_INBOX_LABELS[k].label} />} />
          ))}
        </div>
      </SettingsCard>

      <SettingsCard title="How the Inbox behaves" id="notifications.inboxView" description="The Inbox's own options menu changes the same settings.">
        <div>
          <SettingsRow label="Group by date" {...row("view.group")} control={<Switch checked={view.groupByDate !== false} onChange={(v) => setView("group", { groupByDate: v })} aria-label="Group by date" />} />
          <SettingsRow label="Show everything in Other" helper="Other also lists what is in Primary" {...row("view.all")} control={<Switch checked={view.showAll === true} onChange={(v) => setView("all", { showAll: v })} aria-label="Show everything in Other" />} />
          {/* Offered only while the auto-clear job runs (src/lib/purge-jobs.ts). */}
          {autoClears ? (
            <SettingsRow
              label="Delete cleared items after"
              helper="Notifications you have cleared are deleted for good this many days after you cleared them. Read items stay until you clear them."
              {...row("view.clear")}
              control={
                <PickerSelect
                  label="Delete cleared items after"
                  value={String(view.deleteClearedDays ?? "never")}
                  options={[
                    { value: "never", label: "Never" },
                    { value: "7", label: "7 days" },
                    { value: "14", label: "14 days" },
                    { value: "30", label: "30 days" },
                    ...(view.deleteClearedDays && ![7, 14, 30].includes(view.deleteClearedDays) ? [{ value: String(view.deleteClearedDays), label: `${view.deleteClearedDays} days` }] : []),
                  ]}
                  onChange={(v) => setView("clear", { deleteClearedDays: v === "never" ? null : Number(v) })}
                />
              }
            />
          ) : null}
          <SettingsRow
            label="Open on"
            {...row("view.tab")}
            control={
              <PickerSelect
                label="Open on"
                value={view.defaultTab ?? "primary"}
                options={[{ value: "primary", label: "Primary" }, { value: "other", label: "Other" }, { value: "mentions", label: "Mentions" }]}
                onChange={(v) => setView("tab", { defaultTab: v as "primary" | "other" | "mentions" })}
              />
            }
          />
        </div>
      </SettingsCard>

      <MutedItemsCard />
    </>
  );
}

interface MutedItem { key: string; store: "pref" | "conversation"; kind: string; name: string; href: string | null }

function MutedItemsCard() {
  const { patchPrefs } = useOsShell();
  const { toast } = useOsToast();
  const [state, setState] = useState<{ status: "loading" | "ready" | "error"; items: MutedItem[] }>({ status: "loading", items: [] });
  const [busy, setBusy] = useState<string | null>(null);
  const load = useCallback(async () => {
    const r = await apiFetch<{ items?: MutedItem[] }>("/api/me/muted", { cache: "no-store" });
    setState(r.ok ? { status: "ready", items: r.data?.items ?? [] } : { status: "error", items: [] });
  }, []);
  useEffect(() => {
    const t = window.setTimeout(() => { void load(); }, 0);
    return () => window.clearTimeout(t);
  }, [load]);

  const unmute = async (item: MutedItem) => {
    setBusy(item.key);
    let ok = false;
    if (item.store === "pref") {
      // The muted list is one array and arrays replace on write, so read the
      // server's copy first: a tab open since this morning must not undo a
      // mute made since on another tab or device.
      const fresh = await apiFetch<{ effective?: { home?: { notifications?: { muted?: string[] } } } }>("/api/preferences", { cache: "no-store" });
      if (fresh.ok) {
        const list = (fresh.data?.effective?.home?.notifications?.muted ?? []).filter((k) => k !== item.key);
        ok = await patchPrefs({ home: { notifications: { muted: list } } });
      }
    } else {
      // Back to the conversation's own default, never louder: a channel's is
      // mentions only, a chat's is every message (conversation-view.tsx).
      const id = item.key.slice("conversation:".length);
      const level = item.kind === "Channel" ? "mentions" : "all";
      const r = await apiFetch(`/api/conversations/${encodeURIComponent(id)}`, { method: "PATCH", json: { notifyLevel: level } });
      ok = r.ok;
    }
    setBusy(null);
    if (!ok) { toast("Couldn't unmute. Try again"); return; }
    setState((s) => ({ ...s, items: s.items.filter((x) => x.key !== item.key) }));
    toast(`Unmuted ${item.name}`);
  };

  return (
    <SettingsCard title="Muted items" wide="notifications.muted" id="notifications.muted" description="Muting a Space, Folder or List stops status, comment and due date updates from it. Tasks assigned to you and mentions still reach you.">
      {state.status === "loading" ? (
        <SkeletonRows rows={2} />
      ) : state.status === "error" ? (
        <p className="text-sm text-ink-2">Couldn&apos;t load what you muted. <button type="button" className={btn.link} onClick={() => { void load(); }}>Try again</button></p>
      ) : state.items.length === 0 ? (
        <div className="flex h-[var(--os-row-h,44px)] items-center text-base text-ink-2">Nothing muted · Mute a Space, List or channel from its ••• menu</div>
      ) : (
        <ul>
          {state.items.map((m) => (
            <li key={m.key} className="flex h-[var(--os-row-h,44px)] items-center gap-3 border-b border-line-soft last:border-b-0">
              <span className="min-w-0 flex-1 truncate text-base text-ink">
                {m.href ? <Link href={m.href} className="hover:underline">{m.name}</Link> : m.name}
              </span>
              <span className="text-xs font-medium text-ink-2">{m.kind}</span>
              <button type="button" className={btn.ghost} disabled={busy === m.key} onClick={() => { void unmute(m); }}>Unmute</button>
            </li>
          ))}
        </ul>
      )}
    </SettingsCard>
  );
}

function EmailTab() {
  const { prefs } = useOsShell();
  const { write, run, row } = useRowWrites();
  const { patchPrefs } = useOsShell();
  const email = prefs.home.notifications?.email ?? {};
  const master = email.master !== false;
  const [cats, setCats] = useState<EmailCats | null>(null);
  const [catsError, setCatsError] = useState(false);

  const loadCats = useCallback(async () => {
    setCatsError(false);
    const r = await apiFetch<Partial<EmailCats>>("/api/email-preferences", { cache: "no-store" });
    if (!r.ok) { setCatsError(true); return; }
    const d = r.data ?? {};
    setCats({
      kraNotifications: !!d.kraNotifications,
      reviewNotifications: !!d.reviewNotifications,
      sopNotifications: !!d.sopNotifications,
      kudosNotifications: !!d.kudosNotifications,
      dailyDigest: !!d.dailyDigest,
    });
  }, []);
  useEffect(() => {
    const t = window.setTimeout(() => { void loadCats(); }, 0);
    return () => window.clearTimeout(t);
  }, [loadCats]);

  // The closure passed to run() is also the row's Retry, so it sets the switch
  // itself on every attempt: the chosen value while it is sent, the chosen
  // value again once the server keeps it, the old value if it does not. Before,
  // only the failure path touched `cats`, so a Retry that saved left the switch
  // showing the reverted value and a second click saved the opposite. Each
  // write is functional and touches only its own key, so putting one row back
  // never undoes a row changed in the meantime.
  const setCat = (key: EmailCatKey, value: boolean) => {
    if (!cats) return;
    const before = cats[key];
    void run(`cat.${key}`, async () => {
      setCats((c) => (c ? { ...c, [key]: value } : c));
      const r = await apiFetch("/api/email-preferences", { method: "PATCH", json: { [key]: value } });
      setCats((c) => (c ? { ...c, [key]: r.ok ? value : before } : c));
      return r.ok;
    });
  };
  // The kudos email is gated by BOTH stores: one switch writes both. The
  // preferences half sets and reverts itself inside patchPrefs; this keeps the
  // email-preferences half in step the same way setCat does, Retry included.
  const setKudos = (value: boolean) => {
    if (!cats) return;
    const before = cats.kudosNotifications;
    void run("email.kudos", async () => {
      setCats((c) => (c ? { ...c, kudosNotifications: value } : c));
      const [a, b] = await Promise.all([
        patchPrefs({ home: { notifications: { email: { kudos: value } } } }),
        apiFetch("/api/email-preferences", { method: "PATCH", json: { kudosNotifications: value } }).then((r) => r.ok),
      ]);
      setCats((c) => (c ? { ...c, kudosNotifications: b ? value : before } : c));
      return a && b;
    });
  };

  if (catsError) {
    return <OsEmptyView variant="error" title="Couldn't load your email settings" action={{ label: "Try again", onClick: () => { void loadCats(); } }} />;
  }
  if (!cats) return <SettingsCard><SkeletonRows rows={4} /></SettingsCard>;

  const offText = (checked: boolean) => <span className="text-base text-ink-2">{checked ? "On" : "Off"}</span>;

  return (
    <>
      <SettingsCard title="Email" id="notifications.email">
        <div>
          <SettingsRow
            id="notifications.email.master"
            label="Send me email"
            helper={master ? "For the task emails below" : "Turn email on to change these"}
            {...row("email.master")}
            control={<Switch checked={master} onChange={(v) => { void write("email.master", { home: { notifications: { email: { master: v } } } }); }} aria-label="Send me email" />}
          />
          <SettingsRow
            id="notifications.email.task_assigned"
            label="Tasks assigned to me"
            {...row("email.task")}
            readOnlyValue={master ? undefined : offText(email.task_assigned !== false)}
            control={<Switch checked={email.task_assigned !== false} onChange={(v) => { void write("email.task", { home: { notifications: { email: { task_assigned: v } } } }); }} aria-label="Tasks assigned to me by email" />}
          />
          <SettingsRow
            id="notifications.email.kudos"
            label="Kudos I receive"
            {...row("email.kudos")}
            readOnlyValue={master ? undefined : offText(email.kudos !== false && cats.kudosNotifications)}
            control={<Switch checked={email.kudos !== false && cats.kudosNotifications} onChange={setKudos} aria-label="Kudos by email" />}
          />
        </div>
      </SettingsCard>

      <SettingsCard title="Work updates by email" id="notifications.email.work" description="These send whether or not Send me email is on.">
        <div>
          <SettingsRow label="KRA and KPI updates" helper="Assignments and score activity" {...row("cat.kraNotifications")} control={<Switch checked={cats.kraNotifications} onChange={(v) => setCat("kraNotifications", v)} aria-label="KRA and KPI updates" />} />
          <SettingsRow label="Review reminders" helper="Weekly and cycle reviews" {...row("cat.reviewNotifications")} control={<Switch checked={cats.reviewNotifications} onChange={(v) => setCat("reviewNotifications", v)} aria-label="Review reminders" />} />
          <SettingsRow label="SOP updates" helper="New and changed procedures you are assigned" {...row("cat.sopNotifications")} control={<Switch checked={cats.sopNotifications} onChange={(v) => setCat("sopNotifications", v)} aria-label="SOP updates" />} />
        </div>
      </SettingsCard>

      <UpcomingOnly>
        <SettingsCard title="Coming soon">
          <div>
            {["Mentions", "Comments", "Status changes", "Due reminders", "Daily digest"].map((l) => (
              <ComingSoonRow key={l} label={`${l} by email`} className="border-b border-line-soft last:border-b-0" />
            ))}
          </div>
        </SettingsCard>
      </UpcomingOnly>

      <ReceivedReports />
    </>
  );
}

function DesktopTab() {
  const { prefs } = useOsShell();
  const desktop = useDesktopNotifications();
  const { write, run, row } = useRowWrites();
  const { toast } = useOsToast();
  // The same value the bell's alert path reads (settings-architecture 9.1): a
  // never-set choice with permission granted means alerts fire, so it reads On.
  const on = desktop.enabled;
  const ring = prefs.home.notifications?.desktopRingCalls !== false;

  const permissionLine =
    desktop.permission === "unsupported" ? "This browser can't show desktop notifications."
    : desktop.permission === "denied" ? "Your browser is blocking notifications. Allow them in your browser settings."
    : desktop.permission === "granted" ? "Allowed"
    : "Not asked yet";

  const toggle = async (v: boolean) => {
    if (!v) { await run("desktop", () => desktop.disable()); return; }
    const result = await desktop.requestPermission();
    if (result !== "granted") { toast(result === "denied" ? "Your browser blocked notifications" : "Notifications were not allowed"); return; }
    await run("desktop", () => desktop.enable());
  };

  return (
    <SettingsCard title="This browser" id="notifications.desktop" description="Each browser and device asks for permission separately.">
      <div>
        <SettingsRow
          id="notifications.desktop.on"
          label="Desktop notifications"
          helper={permissionLine}
          {...row("desktop")}
          control={desktop.permission === "unsupported" || desktop.permission === "denied" ? undefined : <Switch checked={on} onChange={(v) => { void toggle(v); }} aria-label="Desktop notifications" />}
        />
        <SettingsRow
          id="notifications.desktop.ring"
          label="Ring for incoming calls"
          helper="Shows the ringing card when someone calls you. The call still reaches your Inbox."
          {...row("ring")}
          control={<Switch checked={ring} onChange={(v) => { void write("ring", { home: { notifications: { desktopRingCalls: v } } }); }} aria-label="Ring for incoming calls" />}
        />
        {desktop.enabled ? (
          <SettingsRow
            label="Send a test"
            helper="Switch to another tab to see it appear"
            control={
              <button
                type="button"
                className={btn.secondary}
                onClick={() => {
                  window.setTimeout(() => desktop.notify({ title: "WorkwrK", body: "Desktop notifications are working.", tag: "workwrk-test" }), 1500);
                  toast("A test notification arrives in a moment");
                }}
              >
                Send a test
              </button>
            }
          />
        ) : null}
      </div>
    </SettingsCard>
  );
}

// ── Reports you receive (/api/report-schedules?received=1) ─────────────
// targetId and targetName are null when the viewer cannot read the target
// now, so a row never names what it cannot open. The report email's manage
// link lands here (#reports).
interface ReceivedReport {
  id: string;
  targetKind: string;
  targetId: string | null;
  targetName: string | null;
  cadence: string;
  weekday: number | null;
  monthDay: number | null;
  timeOfDay: string;
  timezone: string;
  active?: boolean;
  nextRunAt: string | null;
  createdBy: { firstName: string; lastName: string } | null;
}

type ReceivedState =
  | { status: "loading" }
  | { status: "hidden" }
  | { status: "error"; message: string }
  | { status: "ready"; rows: ReceivedReport[]; cronInstalled: boolean; loadedAt: number };

function ReceivedReports() {
  const { toast } = useOsToast();
  const prefs = useDatePrefs();
  const [state, setState] = useState<ReceivedState>({ status: "loading" });
  const [busy, setBusy] = useState<ReadonlySet<string>>(() => new Set());
  const scrolledRef = useRef(false);

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/report-schedules?received=1", { cache: "no-store" });
      const body: unknown = await res.json().catch(() => null);
      // A Guest (404) or a database without the table (503): nothing true to show.
      if (res.status === 404 || res.status === 503) { setState({ status: "hidden" }); return; }
      if (!res.ok) { setState({ status: "error", message: dashboardMessage(body, "Couldn't load the reports you receive.") }); return; }
      const d = body as { schedules?: ReceivedReport[]; cronInstalled?: boolean } | null;
      setState({ status: "ready", rows: d?.schedules ?? [], cronInstalled: d?.cronInstalled !== false, loadedAt: Date.now() });
    } catch {
      setState({ status: "error", message: "Couldn't reach the server. Check your connection and try again." });
    }
  }, []);

  useEffect(() => {
    const t = window.setTimeout(() => { void load(); }, 0);
    return () => window.clearTimeout(t);
  }, [load]);

  useEffect(() => {
    if (scrolledRef.current || state.status !== "ready") return;
    if (typeof window === "undefined" || window.location.hash !== "#reports") return;
    scrolledRef.current = true;
    document.getElementById("reports")?.scrollIntoView({ block: "start" });
  }, [state.status]);

  const stopReceiving = async (r: ReceivedReport) => {
    if (busy.has(r.id)) return;
    setBusy((prev) => new Set(prev).add(r.id));
    try {
      const res = await fetch(`/api/report-schedules/${encodeURIComponent(r.id)}/recipients/me`, { method: "DELETE" });
      const body: unknown = await res.json().catch(() => null);
      if (!res.ok && res.status !== 404) {
        toast(dashboardMessage(body, "Couldn't take you off this report."), { tone: "danger", action: { label: "Try again", onClick: () => void stopReceiving(r) } });
        return;
      }
      setState((prev) => (prev.status === "ready" ? { ...prev, rows: prev.rows.filter((x) => x.id !== r.id) } : prev));
      toast("You no longer receive this report");
    } catch {
      toast("Couldn't reach the server.", { tone: "danger", action: { label: "Try again", onClick: () => void stopReceiving(r) } });
    } finally {
      setBusy((prev) => { const next = new Set(prev); next.delete(r.id); return next; });
    }
  };

  if (state.status === "hidden") return null;

  return (
    <SettingsCard title="Reports you receive" id="reports" description="Each copy is worked out under your own access, so it only shows what you can open.">
      {state.status === "loading" ? (
        <SkeletonRows rows={2} />
      ) : state.status === "error" ? (
        <p className="text-sm text-ink-2">{state.message} <button type="button" className={btn.link} onClick={() => { setState({ status: "loading" }); void load(); }}>Try again</button></p>
      ) : state.rows.length === 0 ? (
        <p className="text-base text-ink-2">You are not on any scheduled report.</p>
      ) : (
        <div>
          {state.rows.map((r) => {
            const cadence: ReportCadence = r.cadence === "daily" || r.cadence === "monthly" ? r.cadence : "weekly";
            const when = cadenceLabel({ cadence, weekday: r.weekday, monthDay: r.monthDay, timeOfDay: r.timeOfDay, timezone: r.timezone }, prefs);
            const sender = r.createdBy ? `${r.createdBy.firstName} ${r.createdBy.lastName}`.trim() : "";
            const readable = r.targetId !== null;
            const paused = r.active === false || !r.nextRunAt;
            // Never a schedule that is not true: while sending is off for the
            // workspace there is no next send, and a run time already past is
            // waiting for the sender rather than planned.
            const next = paused
              ? "Paused"
              : !state.cronInstalled
                ? "Not sending yet"
                : Date.parse(r.nextRunAt!) < state.loadedAt
                  ? "Sending soon"
                  : `Next ${formatRunTime(r.nextRunAt!, r.timezone, prefs)}`;
            return (
              <SettingsRow
                key={r.id}
                label={readable ? r.targetName ?? "Untitled report" : "A report you can no longer open"}
                helper={
                  <>
                    {[when, sender ? `from ${sender}` : "", next].filter(Boolean).join(" · ")}
                    {!readable ? <span className="block">Nothing is sent to you while you can&apos;t open it. If your access comes back, it starts again.</span> : null}
                  </>
                }
                control={<button type="button" className={btn.ghost} disabled={busy.has(r.id)} onClick={() => void stopReceiving(r)}>Stop receiving</button>}
              />
            );
          })}
          {!state.cronInstalled ? <p className="mt-2 text-sm text-ink-2">Sending is not switched on for this workspace yet. You start receiving these once it is.</p> : null}
        </div>
      )}
    </SettingsCard>
  );
}
