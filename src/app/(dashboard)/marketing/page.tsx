"use client";

// WorkwrK Marketing — Phase E4 showcase product.
// Campaign planning + Content calendar + Event briefs. CMO/marketing
// manager surface. Distinct from /announcements (internal comms).

import { useCallback, useEffect, useState } from "react";
import {
  Megaphone,
  FileText,
  Calendar,
  Plus,
  X,
  Zap,
  TrendingUp,
  DollarSign,
} from "lucide-react";
import { BoardView, type BoardField } from "@/components/board-view/board-view";
import { ItemDetailDrawer } from "@/components/board-view/item-detail-drawer";

// Field configs for BoardView. Kanban groups by `status`, Calendar by
// `scheduledFor`. Keep these aligned with the API payload shape.
const CONTENT_FIELDS: BoardField[] = [
  { key: "title", label: "Title", fieldType: "TEXT" },
  {
    key: "status", label: "Status", fieldType: "SELECT",
    options: { choices: [
      { value: "IDEA", label: "Idea", color: "#94a3b8" },
      { value: "BRIEFED", label: "Briefed", color: "#60a5fa" },
      { value: "IN_DRAFT", label: "In draft", color: "#f59e0b" },
      { value: "IN_REVIEW", label: "In review", color: "#a78bfa" },
      { value: "APPROVED", label: "Approved", color: "#10b981" },
      { value: "SCHEDULED", label: "Scheduled", color: "#14b8a6" },
      { value: "PUBLISHED", label: "Published", color: "#059669" },
      { value: "ARCHIVED", label: "Archived", color: "#71717a" },
    ] },
  },
  {
    key: "type", label: "Type", fieldType: "SELECT",
    options: { choices: [
      { value: "BLOG_POST", label: "Blog post" }, { value: "EMAIL", label: "Email" },
      { value: "SOCIAL_POST", label: "Social" }, { value: "VIDEO", label: "Video" },
      { value: "WEBINAR", label: "Webinar" }, { value: "CASE_STUDY", label: "Case study" },
      { value: "WHITEPAPER", label: "Whitepaper" }, { value: "EBOOK", label: "Ebook" },
      { value: "PODCAST", label: "Podcast" }, { value: "ONE_PAGER", label: "One-pager" },
      { value: "PRESS_RELEASE", label: "Press release" },
    ] },
  },
  { key: "channel", label: "Channel", fieldType: "TEXT" },
  { key: "scheduledFor", label: "Scheduled", fieldType: "DATE" },
];

const CAMPAIGN_FIELDS: BoardField[] = [
  { key: "name", label: "Name", fieldType: "TEXT" },
  {
    key: "status", label: "Status", fieldType: "SELECT",
    options: { choices: [
      { value: "PLANNING", label: "Planning", color: "#94a3b8" },
      { value: "APPROVED", label: "Approved", color: "#60a5fa" },
      { value: "ACTIVE", label: "Active", color: "#10b981" },
      { value: "PAUSED", label: "Paused", color: "#f59e0b" },
      { value: "COMPLETED", label: "Completed", color: "#a78bfa" },
      { value: "CANCELLED", label: "Cancelled", color: "#ef4444" },
    ] },
  },
  { key: "channel", label: "Channel", fieldType: "TEXT" },
  { key: "startDate", label: "Start", fieldType: "DATE" },
  { key: "endDate", label: "End", fieldType: "DATE" },
];

type Campaign = {
  id: string;
  name: string;
  description: string | null;
  status: string;
  channel: string | null;
  budget: string | null;
  spent: string | null;
  startDate: string | null;
  endDate: string | null;
  goalMetric: string | null;
  goalTarget: number | null;
  goalActual: number | null;
};

type ContentItem = {
  id: string;
  title: string;
  type: string;
  status: string;
  channel: string | null;
  scheduledFor: string | null;
  publishedAt: string | null;
  createdAt: string;
};

type EventBrief = {
  id: string;
  name: string;
  type: string | null;
  format: string | null;
  startDate: string | null;
  endDate: string | null;
  location: string | null;
  capacity: number | null;
  registeredCount: number | null;
  status: string;
  url: string | null;
};

type Tab = "campaigns" | "content" | "events";

const CAMPAIGN_TONES: Record<string, string> = {
  PLANNING: "bg-zinc-100 text-zinc-600",
  APPROVED: "bg-blue-100 text-blue-700",
  ACTIVE: "bg-emerald-100 text-emerald-700",
  PAUSED: "bg-amber-100 text-amber-700",
  COMPLETED: "bg-violet-100 text-violet-700",
  CANCELLED: "bg-rose-100 text-rose-700",
};

const CONTENT_TONES: Record<string, string> = {
  IDEA: "bg-zinc-100 text-zinc-600",
  BRIEFED: "bg-blue-100 text-blue-700",
  IN_DRAFT: "bg-amber-100 text-amber-700",
  IN_REVIEW: "bg-violet-100 text-violet-700",
  APPROVED: "bg-emerald-100 text-emerald-700",
  SCHEDULED: "bg-teal-100 text-teal-700",
  PUBLISHED: "bg-emerald-200 text-emerald-800",
  ARCHIVED: "bg-zinc-100 text-zinc-500",
};

const EVENT_TONES: Record<string, string> = {
  PLANNING: "bg-zinc-100 text-zinc-600",
  PROMOTING: "bg-violet-100 text-violet-700",
  REGISTERING: "bg-blue-100 text-blue-700",
  LIVE: "bg-emerald-100 text-emerald-700",
  COMPLETED: "bg-zinc-100 text-zinc-500",
  CANCELLED: "bg-rose-100 text-rose-700",
};

function money(amount: string | null) {
  if (!amount) return "—";
  const n = parseFloat(amount);
  if (Number.isNaN(n)) return "—";
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 }).format(n);
}

function dateRange(s: string | null, e: string | null) {
  if (!s) return "—";
  const start = new Date(s);
  if (!e) return start.toLocaleDateString("en-US", { month: "short", day: "numeric" });
  const end = new Date(e);
  return `${start.toLocaleDateString("en-US", { month: "short", day: "numeric" })} – ${end.toLocaleDateString("en-US", { month: "short", day: "numeric" })}`;
}

export default function MarketingPage() {
  const [tab, setTab] = useState<Tab>("campaigns");
  const [campaigns, setCampaigns] = useState<Campaign[]>([]);
  const [content, setContent] = useState<ContentItem[]>([]);
  const [events, setEvents] = useState<EventBrief[]>([]);
  const [loading, setLoading] = useState(true);
  const [showNew, setShowNew] = useState<Tab | null>(null);
  const [openCampaign, setOpenCampaign] = useState<Campaign | null>(null);
  const [openContentItem, setOpenContentItem] = useState<ContentItem | null>(null);

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const [c, ct, e] = await Promise.all([
        fetch("/api/marketing/campaigns").then((r) => (r.ok ? r.json() : { campaigns: [] })),
        fetch("/api/marketing/content").then((r) => (r.ok ? r.json() : { items: [] })),
        fetch("/api/marketing/events").then((r) => (r.ok ? r.json() : { events: [] })),
      ]);
      setCampaigns(c.campaigns || []);
      setContent(ct.items || []);
      setEvents(e.events || []);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { refresh(); }, [refresh]);

  const activeCampaigns = campaigns.filter((c) => c.status === "ACTIVE").length;
  const totalBudget = campaigns.reduce((s, c) => s + (c.budget ? parseFloat(c.budget) : 0), 0);
  const totalSpent = campaigns.reduce((s, c) => s + (c.spent ? parseFloat(c.spent) : 0), 0);
  const upcomingEvents = events.filter((e) => e.startDate && new Date(e.startDate) > new Date()).length;

  return (
    <div className="p-6 max-w-[1800px] mx-auto">
      <div className="flex items-start justify-between mb-6">
        <div>
          <div className="inline-flex items-center gap-2 px-2 py-0.5 rounded-full bg-amber-100 dark:bg-amber-900/40 text-amber-700 dark:text-amber-300 text-xs font-medium mb-3">
            <Megaphone size={12} />
            WorkwrK Marketing
          </div>
          <h1 className="text-2xl font-semibold mb-1">Marketing operations</h1>
          <p className="text-sm text-muted">Campaigns · Content calendar · Events — your go-to-market HQ</p>
        </div>
        <button
          type="button"
          onClick={() => setShowNew(tab)}
          className="inline-flex items-center gap-2 px-4 py-2 rounded-xl bg-amber-600 hover:bg-amber-700 text-white text-sm font-medium"
        >
          <Plus size={14} />
          New {tab === "campaigns" ? "campaign" : tab === "content" ? "content" : "event"}
        </button>
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-6">
        <Kpi label="Active campaigns" value={activeCampaigns.toString()} />
        <Kpi label="Total budget" value={money(totalBudget.toString())} />
        <Kpi label="Spent" value={money(totalSpent.toString())} tone={totalSpent > totalBudget * 0.8 ? "amber" : undefined} />
        <Kpi label="Upcoming events" value={upcomingEvents.toString()} />
      </div>

      <div className="flex items-center gap-1 mb-6 border-b border-border">
        {([
          { id: "campaigns", label: "Campaigns", Icon: Megaphone, count: campaigns.length },
          { id: "content", label: "Content", Icon: FileText, count: content.length },
          { id: "events", label: "Events", Icon: Calendar, count: events.length },
        ] as { id: Tab; label: string; Icon: typeof Megaphone; count: number }[]).map(({ id, label, Icon, count }) => (
          <button
            key={id}
            type="button"
            onClick={() => setTab(id)}
            className={"inline-flex items-center gap-2 px-4 py-2 -mb-px text-sm font-medium border-b-2 transition-colors " + (tab === id ? "border-amber-600 text-amber-700 dark:text-amber-400" : "border-transparent text-muted hover:text-foreground")}
          >
            <Icon size={14} />
            {label}
            <span className={tab === id ? "ml-1 text-xs px-1.5 py-0.5 rounded bg-amber-100 dark:bg-amber-900/40" : "ml-1 text-xs text-muted-2"}>{count}</span>
          </button>
        ))}
      </div>

      {tab === "campaigns" && (
        loading ? <div className="rounded-xl border border-border bg-surface"><Loading /></div>
        : campaigns.length === 0
          ? <div className="rounded-xl border border-border bg-surface"><Empty Icon={Megaphone} title="No campaigns yet" hint="Plan your first campaign — track budget vs spend, leads vs target." onAction={() => setShowNew("campaigns")} actionLabel="Plan a campaign" tone="amber" /></div>
          : (
            <BoardView
              boardKey="marketing:campaigns"
              items={campaigns}
              fields={CAMPAIGN_FIELDS}
              getId={(c) => c.id}
              getTitle={(c) => c.name}
              getValue={(c, key) => {
                const raw = (c as unknown as Record<string, unknown>)[key];
                if (key === "budget" || key === "spent") return raw != null ? Number(raw) : null;
                return raw;
              }}
              editableFields={["status"]}
              onRowClick={(c) => setOpenCampaign(c)}
              onChangeField={async (id, key, value) => {
                await fetch("/api/marketing/campaigns", {
                  method: "PATCH",
                  headers: { "Content-Type": "application/json" },
                  body: JSON.stringify({ id, [key]: value }),
                });
                await refresh();
                setOpenCampaign((prev) => prev && prev.id === id ? { ...prev, [key]: value } as Campaign : prev);
              }}
            />
          )
      )}

      {tab === "content" && (
        loading ? <div className="rounded-xl border border-border bg-surface"><Loading /></div>
        : content.length === 0
          ? <div className="rounded-xl border border-border bg-surface"><Empty Icon={FileText} title="Empty content calendar" hint="Start planning content — briefs, drafts, schedule, publish." onAction={() => setShowNew("content")} actionLabel="Add first piece" tone="amber" /></div>
          : (
            <BoardView
              boardKey="marketing:content"
              items={content}
              fields={CONTENT_FIELDS}
              getId={(c) => c.id}
              getTitle={(c) => c.title}
              getValue={(c, key) => (c as unknown as Record<string, unknown>)[key]}
              onRowClick={(c) => setOpenContentItem(c)}
            />
          )
      )}

      {tab === "events" && (
        <div className="rounded-xl border border-border bg-surface overflow-hidden">
          {loading ? <Loading /> : events.length === 0 ? <Empty Icon={Calendar} title="No events on the calendar" hint="Conferences, webinars, customer events — plan, run, measure ROI." onAction={() => setShowNew("events")} actionLabel="Add an event" tone="amber" /> : (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3 p-3">
              {events.map((e) => (
                <article key={e.id} className="rounded-xl border border-border bg-surface p-4 hover:border-amber-300">
                  <div className="flex items-center gap-2 mb-2">
                    <span className={`text-[10px] font-medium px-2 py-0.5 rounded-full uppercase tracking-wider ${EVENT_TONES[e.status]}`}>{e.status}</span>
                    {e.format && <span className="text-[10px] text-muted-2">· {e.format}</span>}
                  </div>
                  <h3 className="font-semibold text-sm mb-1">{e.name}</h3>
                  {e.type && <p className="text-xs text-muted mb-2">{e.type}</p>}
                  <div className="flex items-center gap-3 text-[11px] text-muted-2 flex-wrap">
                    <span>{dateRange(e.startDate, e.endDate)}</span>
                    {e.location && <span>· {e.location}</span>}
                    {e.capacity !== null && <span>· {e.registeredCount ?? 0}/{e.capacity}</span>}
                  </div>
                </article>
              ))}
            </div>
          )}
        </div>
      )}

      {showNew === "campaigns" && <CampaignModal onClose={() => setShowNew(null)} onCreated={() => { setShowNew(null); refresh(); }} />}
      {showNew === "content" && <ContentModal onClose={() => setShowNew(null)} onCreated={() => { setShowNew(null); refresh(); }} />}
      {showNew === "events" && <EventModal onClose={() => setShowNew(null)} onCreated={() => { setShowNew(null); refresh(); }} />}

      <ItemDetailDrawer
        open={!!openCampaign}
        onClose={() => setOpenCampaign(null)}
        item={openCampaign}
        title={openCampaign?.name ?? ""}
        entityType="CAMPAIGN"
        fields={CAMPAIGN_FIELDS}
        editableFields={["name", "status", "channel", "budget", "startDate", "endDate"]}
        getValue={(c, k) => {
          const raw = (c as unknown as Record<string, unknown>)[k];
          if (k === "budget" || k === "spent") return raw != null ? Number(raw) : null;
          return raw;
        }}
        onChangeField={async (id, key, value) => {
          await fetch("/api/marketing/campaigns", {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ id, [key]: value }),
          }).catch(() => {});
          await refresh();
          setOpenCampaign((prev) => prev && prev.id === id ? { ...prev, [key]: value } as Campaign : prev);
        }}
      />

      <ItemDetailDrawer
        open={!!openContentItem}
        onClose={() => setOpenContentItem(null)}
        item={openContentItem}
        title={openContentItem?.title ?? ""}
        entityType="CONTENT_ITEM"
        fields={CONTENT_FIELDS}
        editableFields={["title", "type", "status", "channel", "scheduledFor"]}
        getValue={(c, k) => (c as unknown as Record<string, unknown>)[k]}
        onChangeField={async (id, key, value) => {
          await fetch("/api/marketing/content", {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ id, [key]: value }),
          }).catch(() => {});
          await refresh();
          setOpenContentItem((prev) => prev && prev.id === id ? { ...prev, [key]: value } as ContentItem : prev);
        }}
      />
    </div>
  );
}

function Kpi({ label, value, tone }: { label: string; value: string; tone?: "amber" | "rose" }) {
  const bg = tone === "rose" ? "bg-rose-50 dark:bg-rose-950/30" : tone === "amber" ? "bg-amber-50 dark:bg-amber-950/30" : "bg-surface";
  return <div className={`rounded-xl border border-border p-3 ${bg}`}><div className="text-[11px] uppercase tracking-wider text-muted-2 mb-1">{label}</div><div className="text-lg font-semibold">{value}</div></div>;
}

function Loading() { return <div className="text-sm text-muted py-20 text-center">Loading…</div>; }

function Empty({ Icon, title, hint, onAction, actionLabel, tone = "amber" }: { Icon: typeof Megaphone; title: string; hint: string; onAction: () => void; actionLabel: string; tone?: "amber" | "blue" }) {
  const bgClass = tone === "blue" ? "bg-blue-600 hover:bg-blue-700" : "bg-amber-600 hover:bg-amber-700";
  return (
    <div className="text-center py-20">
      <Icon size={40} className="mx-auto mb-3 text-muted-2" />
      <p className="font-medium mb-1">{title}</p>
      <p className="text-sm text-muted mb-4 max-w-sm mx-auto">{hint}</p>
      <button type="button" onClick={onAction} className={`inline-flex items-center gap-2 px-4 py-2 rounded-xl text-white text-sm font-medium ${bgClass}`}><Plus size={14} /> {actionLabel}</button>
    </div>
  );
}

function CampaignModal({ onClose, onCreated }: { onClose: () => void; onCreated: () => void }) {
  const [name, setName] = useState(""); const [channel, setChannel] = useState(""); const [budget, setBudget] = useState("");
  const [startDate, setStartDate] = useState(""); const [endDate, setEndDate] = useState(""); const [saving, setSaving] = useState(false);
  async function submit() {
    if (!name.trim()) return; setSaving(true);
    try {
      await fetch("/api/marketing/campaigns", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name, channel, budget: budget ? parseFloat(budget) : undefined, startDate: startDate || undefined, endDate: endDate || undefined }) });
      onCreated();
    } finally { setSaving(false); }
  }
  return <Modal title="New campaign" onClose={onClose}><Row label="Name"><input autoFocus value={name} onChange={(e) => setName(e.target.value)} className="i" /></Row><div className="grid grid-cols-2 gap-3"><Row label="Channel"><input value={channel} onChange={(e) => setChannel(e.target.value)} placeholder="Email, Paid Search, Social" className="i" /></Row><Row label="Budget USD"><input type="number" value={budget} onChange={(e) => setBudget(e.target.value)} className="i" /></Row></div><div className="grid grid-cols-2 gap-3"><Row label="Start"><input type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} className="i" /></Row><Row label="End"><input type="date" value={endDate} onChange={(e) => setEndDate(e.target.value)} className="i" /></Row></div><Actions onClose={onClose} onSubmit={submit} saving={saving} disabled={!name.trim()} tone="amber" /></Modal>;
}

function ContentModal({ onClose, onCreated }: { onClose: () => void; onCreated: () => void }) {
  const [title, setTitle] = useState(""); const [type, setType] = useState("BLOG_POST"); const [channel, setChannel] = useState(""); const [scheduledFor, setScheduledFor] = useState(""); const [saving, setSaving] = useState(false);
  async function submit() {
    if (!title.trim()) return; setSaving(true);
    try {
      await fetch("/api/marketing/content", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ title, type, channel, scheduledFor: scheduledFor || undefined }) });
      onCreated();
    } finally { setSaving(false); }
  }
  return <Modal title="New content" onClose={onClose}><Row label="Title"><input autoFocus value={title} onChange={(e) => setTitle(e.target.value)} className="i" /></Row><div className="grid grid-cols-2 gap-3"><Row label="Type"><select value={type} onChange={(e) => setType(e.target.value)} className="i"><option value="BLOG_POST">Blog post</option><option value="EMAIL">Email</option><option value="SOCIAL_POST">Social post</option><option value="VIDEO">Video</option><option value="WEBINAR">Webinar</option><option value="CASE_STUDY">Case study</option><option value="WHITEPAPER">Whitepaper</option><option value="EBOOK">Ebook</option><option value="PODCAST">Podcast</option><option value="ONE_PAGER">One-pager</option><option value="PRESS_RELEASE">Press release</option></select></Row><Row label="Channel"><input value={channel} onChange={(e) => setChannel(e.target.value)} placeholder="Blog, LinkedIn..." className="i" /></Row></div><Row label="Scheduled for"><input type="date" value={scheduledFor} onChange={(e) => setScheduledFor(e.target.value)} className="i" /></Row><Actions onClose={onClose} onSubmit={submit} saving={saving} disabled={!title.trim()} tone="amber" /></Modal>;
}

function EventModal({ onClose, onCreated }: { onClose: () => void; onCreated: () => void }) {
  const [name, setName] = useState(""); const [type, setType] = useState(""); const [format, setFormat] = useState("In-person"); const [startDate, setStartDate] = useState(""); const [location, setLocation] = useState(""); const [capacity, setCapacity] = useState(""); const [saving, setSaving] = useState(false);
  async function submit() {
    if (!name.trim()) return; setSaving(true);
    try {
      await fetch("/api/marketing/events", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name, type, format, startDate: startDate || undefined, location, capacity: capacity ? parseInt(capacity) : undefined }) });
      onCreated();
    } finally { setSaving(false); }
  }
  return <Modal title="New event" onClose={onClose}><Row label="Name"><input autoFocus value={name} onChange={(e) => setName(e.target.value)} className="i" /></Row><div className="grid grid-cols-2 gap-3"><Row label="Type"><input value={type} onChange={(e) => setType(e.target.value)} placeholder="Conference, Trade show..." className="i" /></Row><Row label="Format"><select value={format} onChange={(e) => setFormat(e.target.value)} className="i"><option>In-person</option><option>Virtual</option><option>Hybrid</option></select></Row></div><div className="grid grid-cols-2 gap-3"><Row label="Start date"><input type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} className="i" /></Row><Row label="Capacity"><input type="number" value={capacity} onChange={(e) => setCapacity(e.target.value)} className="i" /></Row></div><Row label="Location"><input value={location} onChange={(e) => setLocation(e.target.value)} className="i" /></Row><Actions onClose={onClose} onSubmit={submit} saving={saving} disabled={!name.trim()} tone="amber" /></Modal>;
}

function Modal({ title, onClose, children }: { title: string; onClose: () => void; children: React.ReactNode }) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40" onClick={onClose}>
      <div className="w-full max-w-lg rounded-2xl bg-surface border border-border shadow-xl p-6 space-y-3" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between mb-2"><h2 className="text-lg font-semibold">{title}</h2><button type="button" onClick={onClose} className="p-1 rounded hover:bg-surface-2 text-muted"><X size={16} /></button></div>
        <style>{".i{width:100%;padding:.5rem .75rem;border-radius:.5rem;border:1px solid var(--color-border, rgba(0,0,0,.1));background:var(--color-surface, #fff);font-size:.875rem;}"}</style>
        {children}
      </div>
    </div>
  );
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return <div><label className="block text-xs font-medium text-muted-2 mb-1">{label}</label>{children}</div>;
}

function Actions({ onClose, onSubmit, saving, disabled, tone = "amber" }: { onClose: () => void; onSubmit: () => void; saving: boolean; disabled: boolean; tone?: "amber" | "blue" }) {
  const bg = tone === "blue" ? "bg-blue-600 hover:bg-blue-700" : "bg-amber-600 hover:bg-amber-700";
  return (
    <div className="flex items-center justify-end gap-2 pt-3">
      <button type="button" onClick={onClose} className="px-3 py-2 rounded-lg text-sm text-muted hover:bg-surface-2">Cancel</button>
      <button type="button" onClick={onSubmit} disabled={saving || disabled} className={`px-4 py-2 rounded-lg text-sm font-medium text-white disabled:opacity-50 inline-flex items-center gap-1.5 ${bg}`}>{saving ? "Saving…" : (<><Zap size={12} /> Create</>)}</button>
    </div>
  );
}
