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
import { Switch } from "@/components/ui/switch";
import {
  Inbox as InboxIcon, Heart, AtSign, CheckSquare, Clock, MessageCircle,
  ClipboardCheck, BookOpen, ShieldAlert, Bell, ChevronRight, Check,
  ArrowDownWideNarrow, Eye, Keyboard, Layers, ListFilter, MailOpen,
  Maximize2, Settings, Settings2, UserRound, X, type LucideIcon,
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
type FilterType = "Mentions" | "Assigned to me" | "Unread" | "Reminders" | null;

interface InboxPrefs {
  showAll: boolean;
  groupByDate: boolean;
  sortNewest: boolean;
  mode: "fullscreen" | "inline";
}

const DEFAULT_PREFS: InboxPrefs = {
  showAll: false,
  groupByDate: true,
  sortNewest: true,
  mode: "fullscreen",
};

export default function InboxPage() {
  const [rows, setRows] = useState<ApiNotification[] | null>(null);
  const [tab, setTab] = useState<Tab>("primary");
  const [filterType, setFilterType] = useState<FilterType>(null);
  const [prefs, setPrefs] = useState<InboxPrefs>(DEFAULT_PREFS);
  const [filterOpen, setFilterOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
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
  
  const loadPrefs = useCallback(async () => {
    try {
      const res = await fetch("/api/preferences");
      if (!res.ok) return;
      const data = await res.json();
      const p = data?.effective?.inbox;
      if (p) {
        setPrefs({ ...DEFAULT_PREFS, ...p });
      }
    } catch {}
  }, []);

  useEffect(() => { void load(); void loadPrefs(); }, [load, loadPrefs]);

  const savePref = useCallback((partial: Partial<InboxPrefs>) => {
    setPrefs((prev) => {
      const next = { ...prev, ...partial };
      void fetch("/api/preferences", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ inbox: next }),
      });
      return next;
    });
  }, []);

  const filteredRows = useMemo(() => {
    if (rows === null) return null;
    const now = Date.now();
    let result = rows.filter((n) => {
      const isSnoozed = n.snoozedUntil && new Date(n.snoozedUntil).getTime() > now;
      if (tab === "cleared") return n.read;
      if (tab === "later") return !n.read && isSnoozed;
      const v = visualFor(n.type);
      if (tab === "primary") return !n.read && !isSnoozed && v.bucket === "primary";
      return !n.read && !isSnoozed && (prefs.showAll || v.bucket === "other");
    });
    
    if (filterType) {
      result = result.filter(n => {
        if (filterType === "Unread") return !n.read;
        if (filterType === "Mentions") return n.type === "mention";
        if (filterType === "Assigned to me") return n.type === "task_assigned";
        if (filterType === "Reminders") return n.type === "reminder"; // assuming type reminder
        return true;
      });
    }

    result.sort((a, b) => {
      const ta = new Date(a.createdAt).getTime();
      const tb = new Date(b.createdAt).getTime();
      return prefs.sortNewest ? tb - ta : ta - tb;
    });

    return result;
  }, [rows, tab, filterType, prefs]);

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
    <div className="flex h-full bg-white">
      <div className="flex min-w-0 flex-1 flex-col bg-white">
        <div className="border-b border-zinc-200">
          <h1 className="sr-only">Inbox</h1>
          <div className="grid grid-cols-4 h-[68px]">
            <InboxTab active={tab === "primary"} onClick={() => setTab("primary")} Icon={InboxIcon} label="Primary" />
            <InboxTab active={tab === "other"}   onClick={() => setTab("other")}   Icon={ListFilter} label="Other" divided />
            <InboxTab active={tab === "later"}   onClick={() => setTab("later")}   Icon={Clock} label="Later" divided />
            <InboxTab active={tab === "cleared"} onClick={() => setTab("cleared")} Icon={Check} label="Cleared" divided />
          </div>
        </div>

        <div className="px-7 py-4 flex items-center gap-1">
          <div className="relative">
            <button
              type="button"
              onClick={() => setFilterOpen((v) => !v)}
              aria-expanded={filterOpen}
              aria-haspopup="menu"
              className={`inline-flex items-center gap-1.5 h-7 !px-3 rounded-full text-[13px] border hover:bg-zinc-50 transition-colors ${
                filterOpen || filterType
                  ? "bg-zinc-100 border-[var(--os-brand-rail)] text-[var(--os-brand-rail)] font-medium"
                  : "bg-white border-zinc-200 text-zinc-600"
              }`}
            >
              <ListFilter className="w-3.5 h-3.5" />
              {filterType ? filterType : "Filter"}
            </button>
            {filterOpen ? (
              <InboxFilterMenu
                onClose={() => setFilterOpen(false)}
                filterType={filterType}
                setFilterType={setFilterType}
              />
            ) : null}
          </div>
          {filterType ? (
            <button
              type="button"
              onClick={() => setFilterType(null)}
              className="text-[12px] text-zinc-500 hover:text-zinc-700 ml-2 hover:underline"
            >
              Clear filter
            </button>
          ) : null}
          <div className="flex-1" />
          <button
            type="button"
            onClick={() => setSettingsOpen(true)}
            aria-label="Inbox settings"
            title="Inbox settings"
            className="inline-flex items-center justify-center w-8 h-8 rounded-md text-zinc-500 hover:bg-zinc-100"
          >
            <Settings className="w-3.5 h-3.5" />
          </button>
          <button
            type="button"
            onClick={clearAll}
            disabled={rows === null || rows.every((n) => n.read)}
            className="inline-flex items-center gap-1.5 h-8 !px-2.5 rounded-md text-[13px] text-zinc-500 hover:bg-zinc-100 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            <Check className="w-3.5 h-3.5" />
            Clear all
          </button>
        </div>

        <div className="flex-1 overflow-y-auto px-7 pb-6">
          {filteredRows === null ? (
            <div className="text-sm text-zinc-500 py-8 text-center">Loading inbox…</div>
          ) : filteredRows.length === 0 ? (
            <InboxEmpty tab={tab} />
          ) : (
            <div className="max-w-[860px] mx-auto">
              {prefs.groupByDate ? (
                // Group by date logic
                (() => {
                  const today = new Date();
                  const yesterday = new Date(today);
                  yesterday.setDate(yesterday.getDate() - 1);
                  
                  const todayStr = today.toDateString();
                  const yesterdayStr = yesterday.toDateString();

                  const groups = {
                    "Today": [] as ApiNotification[],
                    "Yesterday": [] as ApiNotification[],
                    "Older": [] as ApiNotification[],
                  };

                  filteredRows.forEach(n => {
                    const d = new Date(n.createdAt).toDateString();
                    if (d === todayStr) groups["Today"].push(n);
                    else if (d === yesterdayStr) groups["Yesterday"].push(n);
                    else groups["Older"].push(n);
                  });

                  return Object.entries(groups).map(([label, items]) => {
                    if (items.length === 0) return null;
                    return (
                      <div key={label} className="mb-6">
                        <h3 className="text-[13px] font-semibold text-zinc-900 mb-2 px-1 sticky top-0 bg-white z-10 py-1">{label}</h3>
                        <ul className="divide-y divide-zinc-100">
                          {items.map(n => (
                            <NotifEntry key={n.id} n={n} onMarkRead={markRead} cleared={tab === "cleared"} mode={prefs.mode} />
                          ))}
                        </ul>
                      </div>
                    );
                  });
                })()
              ) : (
                <ul className="divide-y divide-zinc-100">
                  {filteredRows.map((n) => (
                    <NotifEntry key={n.id} n={n} onMarkRead={markRead} cleared={tab === "cleared"} mode={prefs.mode} />
                  ))}
                </ul>
              )}
            </div>
          )}
        </div>
      </div>
      {settingsOpen ? (
        <InboxSettingsPanel
          onClose={() => setSettingsOpen(false)}
          prefs={prefs}
          savePref={savePref}
        />
      ) : null}
    </div>
  );
}

function InboxFilterMenu({
  onClose,
  filterType,
  setFilterType,
}: {
  onClose: () => void;
  filterType: FilterType;
  setFilterType: (v: FilterType) => void;
}) {
  const items: Array<{ label: FilterType; Icon: LucideIcon; shortcut: string }> = [
    { label: "Mentions", Icon: AtSign, shortcut: "1" },
    { label: "Assigned to me", Icon: UserRound, shortcut: "2" },
    { label: "Unread", Icon: MailOpen, shortcut: "3" },
    { label: "Reminders", Icon: Bell, shortcut: "4" },
  ];
  return (
    <>
      <div className="fixed inset-0 z-30" onClick={onClose} aria-hidden />
      <div
        role="menu"
        className="absolute left-0 top-full z-40 mt-2 w-64 rounded-xl border border-zinc-200 bg-white py-2 shadow-lg"
      >
        {items.map(({ label, Icon, shortcut }) => (
          <button
            key={label}
            type="button"
            role="menuitem"
            onClick={() => {
              setFilterType(label === filterType ? null : label);
              onClose();
            }}
            className={`flex w-full items-center gap-3 !px-4 py-2 text-left text-[13px] hover:bg-zinc-50 ${
              label === filterType ? "text-[var(--os-brand-rail)] font-medium bg-zinc-50" : "text-zinc-800"
            }`}
          >
            <Icon className={`h-4 w-4 ${label === filterType ? "text-[var(--os-brand-rail)]" : "text-zinc-500"}`} />
            <span className="flex-1">{label}</span>
            <span className="text-[11px] text-zinc-400">⇧{shortcut}</span>
          </button>
        ))}
      </div>
    </>
  );
}

function InboxSettingsPanel({
  onClose,
  prefs,
  savePref,
}: {
  onClose: () => void;
  prefs: InboxPrefs;
  savePref: (partial: Partial<InboxPrefs>) => void;
}) {
  return (
    <aside className="w-[370px] shrink-0 border-l border-zinc-200 bg-white shadow-[-10px_0_30px_rgba(0,0,0,0.03)] z-20">
      <div className="flex h-12 items-center gap-3 border-b border-zinc-100 !px-5">
        <h2 className="flex-1 text-[15px] font-semibold text-zinc-900">Customize Inbox</h2>
        <button
          type="button"
          onClick={onClose}
          aria-label="Close customize inbox"
          className="inline-flex h-7 w-7 items-center justify-center rounded-full bg-zinc-100 text-zinc-500 hover:bg-zinc-200 hover:text-zinc-800"
        >
          <X className="h-4 w-4" />
        </button>
      </div>

      <div className="border-b border-zinc-100 py-2">
        <SettingsRow Icon={Eye} label="Show All tab" control={<Switch checked={prefs.showAll} onChange={(v) => savePref({ showAll: v })} />} />
        <SettingsRow Icon={Layers} label="Group by date" active control={<Switch checked={prefs.groupByDate} onChange={(v) => savePref({ groupByDate: v })} />} />
        <SettingsRow Icon={ArrowDownWideNarrow} label="Sort by newest first" control={<Switch checked={prefs.sortNewest} onChange={(v) => savePref({ sortNewest: v })} />} />
      </div>

      <div className="border-b border-zinc-100 py-4">
        <p className="!px-5 text-[12px] font-medium text-zinc-500">Important notifications</p>
        <button
          type="button"
          className="mt-3 flex w-full items-center gap-3 !px-5 py-2 text-left text-[13px] text-zinc-800 hover:bg-zinc-50"
        >
          <Settings2 className="h-4 w-4 text-zinc-500" />
          <span className="flex-1">Customize importance</span>
          <span className="text-[12px] text-zinc-400">11/42</span>
          <ChevronRight className="h-4 w-4 text-zinc-400" />
        </button>
      </div>

      <div className="border-b border-zinc-100 py-4">
        <p className="!px-5 text-[12px] font-medium text-zinc-500">Display mode</p>
        <div className="mt-4 grid grid-cols-2 gap-4 !px-5">
          <DisplayModeCard
            active={prefs.mode === "fullscreen"}
            label="Fullscreen"
            Icon={FullscreenSvg}
            onClick={() => savePref({ mode: "fullscreen" })}
          />
          <DisplayModeCard
            active={prefs.mode === "inline"}
            label="Inline"
            Icon={InlineSvg}
            onClick={() => savePref({ mode: "inline" })}
          />
        </div>
      </div>

      <div className="py-3">
        <SettingsRow Icon={Settings} label="Notification settings" />
        <SettingsRow Icon={Keyboard} label="Keyboard shortcuts" />
      </div>
    </aside>
  );
}

function SettingsRow({
  Icon,
  label,
  active,
  control,
}: {
  Icon: LucideIcon;
  label: string;
  active?: boolean;
  control?: React.ReactNode;
}) {
  return (
    <div className={`flex items-center gap-3 !px-5 py-2 text-[13px] ${active ? "bg-zinc-100" : ""}`}>
      <Icon className="h-4 w-4 text-zinc-500" />
      <span className="flex-1 text-zinc-800">{label}</span>
      {control}
    </div>
  );
}

const FullscreenSvg = ({ className }: { className?: string }) => (
  <svg viewBox="0 0 48 48" fill="none" xmlns="http://www.w3.org/2000/svg" className={className}>
    <rect x="9" y="11" width="30" height="26" rx="4" stroke="currentColor" strokeWidth="2.5" />
    <path d="M15 18h8" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" />
    <rect x="30" y="16.5" width="4" height="4" rx="1" fill="currentColor" />
    <path d="M15 25h18" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" />
    <path d="M15 31h12" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" />
  </svg>
);

const InlineSvg = ({ className }: { className?: string }) => (
  <svg viewBox="0 0 48 48" fill="none" xmlns="http://www.w3.org/2000/svg" className={className}>
    <rect x="9" y="10" width="30" height="7" rx="3" stroke="currentColor" strokeWidth="2.5" />
    <rect x="13" y="12.5" width="2" height="2" rx="1" fill="currentColor" />
    <path d="M18 13.5h12" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />

    <rect x="9" y="20.5" width="30" height="7" rx="3" stroke="currentColor" strokeWidth="2.5" />
    <rect x="13" y="23" width="2" height="2" rx="1" fill="currentColor" />
    <path d="M18 24h8" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />

    <rect x="9" y="31" width="30" height="7" rx="3" stroke="currentColor" strokeWidth="2.5" />
    <rect x="13" y="33.5" width="2" height="2" rx="1" fill="currentColor" />
    <path d="M18 34.5h16" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
  </svg>
);

function DisplayModeCard({
  active,
  label,
  Icon,
  onClick,
}: {
  active: boolean;
  label: string;
  Icon: React.ComponentType<{ className?: string }>;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`group text-left ${active ? "text-zinc-900" : "text-zinc-500"}`}
    >
      <span
        className={`relative flex h-[112px] items-center justify-center rounded-lg border ${
          active
            ? "border-[var(--os-brand-rail)] bg-[color-mix(in_srgb,var(--os-brand-rail)_6%,white)]"
            : "border-zinc-200 bg-white hover:border-zinc-300"
        }`}
      >
        <Icon className={`h-12 w-12 ${active ? "text-[var(--os-brand-rail)]" : "text-zinc-300"}`} />
        <span
          className={`absolute right-3 top-3 flex h-4 w-4 items-center justify-center rounded-full border ${
            active
              ? "border-[var(--os-brand-rail)] bg-[var(--os-brand-rail)]"
              : "border-zinc-300 bg-white"
          }`}
        >
          {active ? <Check className="h-2.5 w-2.5 text-white" strokeWidth={3} /> : null}
        </span>
      </span>
      <span className="mt-3 block text-[13px] font-medium">{label}</span>
    </button>
  );
}

function InboxTab({
  active,
  onClick,
  Icon,
  label,
  divided = false,
}: {
  active: boolean;
  onClick: () => void;
  Icon: LucideIcon;
  label: string;
  divided?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`relative inline-flex items-center justify-start gap-4 !pl-14 !pr-10 text-[15px] transition-colors ${
        divided ? "before:absolute before:left-0 before:top-4 before:bottom-4 before:w-px before:bg-zinc-300 before:content-['']" : ""
      } ${
        active
          ? "text-zinc-900 font-medium after:absolute after:left-0 after:right-0 after:bottom-[-1px] after:h-0.5 after:bg-zinc-900"
          : "text-zinc-500 hover:text-zinc-900"
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
    <div className="flex min-h-[calc(100vh-245px)] flex-col items-center text-center">
      <div className="flex flex-1 flex-col items-center justify-center pt-10">
        <span className="inline-flex items-center justify-center w-[84px] h-[62px] rounded-xl bg-violet-50 shadow-[0_12px_30px_rgba(124,58,237,0.12)] mb-7">
          <InboxIcon className="w-9 h-9 text-violet-200" />
        </span>
        <p className="text-[20px] font-semibold text-zinc-900 mb-2">Inbox Zero</p>
        <p className="text-[15px] text-zinc-500">
          Congratulations! You cleared your important notifications <span aria-hidden>🎉</span>
        </p>
      </div>
      <div className="w-full max-w-none pb-12">
        <div className="relative mx-auto max-w-[760px] border-t border-zinc-100 pt-20">
          <span className="absolute left-1/2 top-0 -translate-x-1/2 -translate-y-1/2 inline-flex h-7 items-center rounded-full border border-zinc-200 bg-white px-4 text-[13px] text-zinc-500">
            ClickTip
          </span>
          <p className="mx-auto max-w-[520px] text-[20px] font-semibold leading-snug text-zinc-900">
            Pin your Favorites bar to the top of your screen to interact with them faster than ever!
          </p>
          <button
            type="button"
            className="mt-5 text-[13px] px-3 py-1 rounded-md bg-white border border-zinc-200 text-zinc-600 hover:bg-zinc-50"
          >
            Learn more
          </button>
        </div>
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
  mode = "fullscreen",
}: {
  n: ApiNotification;
  onMarkRead: (id: string) => void;
  cleared: boolean;
  mode?: "fullscreen" | "inline";
}) {
  const v = visualFor(n.type);

  const IconCircle = (
    <span
      className="inline-flex items-center justify-center w-8 h-8 rounded-full shrink-0"
      style={{ background: `color-mix(in srgb, ${v.color} 12%, transparent)`, color: v.color }}
    >
      <v.Icon className="w-4 h-4" />
    </span>
  );

  const FullscreenBody = (
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

  const InlineBody = (
    <div className="flex-1 min-w-0 flex items-center justify-between gap-4">
      <div className="flex items-center gap-3 min-w-0 flex-1">
        <span className="text-[13px] text-zinc-900 truncate font-medium max-w-[200px] shrink-0">{n.title}</span>
        {n.message ? (
          <p className="text-[13px] text-zinc-500 truncate min-w-0">
            {n.message}
          </p>
        ) : (
          <span className="flex-1" />
        )}
      </div>
      <div className="flex items-center gap-3 shrink-0">
        {!n.read ? <span className="w-1.5 h-1.5 rounded-full bg-blue-500 shrink-0" aria-hidden /> : null}
        <time className="text-[12px] text-zinc-400 w-16 text-right" dateTime={n.createdAt}>{relTime(n.createdAt)}</time>
      </div>
    </div>
  );


  const className = `flex items-start gap-3 py-3 px-2 -mx-2 rounded hover:bg-zinc-50 transition-colors ${
    n.read ? "opacity-60" : ""
  }`;



  return (
    <li>
      {n.link ? (
        <Link href={n.link} className={className} onClick={() => { if (!n.read) onMarkRead(n.id); }}>
          {IconCircle}
          {mode === "inline" ? InlineBody : FullscreenBody}
        </Link>
      ) : (
        <div className={className}>
          {IconCircle}
          {mode === "inline" ? InlineBody : FullscreenBody}
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
