"use client";

// WorkwrK ITSM — Phase E3 showcase product.
// IT Service Management: ticket queue, incident timeline, knowledge base.
// Distinct from /helpdesk (external customer support, Phase E7).

import { useCallback, useEffect, useState } from "react";
import {
  Headphones,
  AlertTriangle,
  BookOpen,
  Plus,
  X,
  ChevronRight,
  Zap,
  Clock,
} from "lucide-react";
import { BoardView, type BoardField } from "@/components/board-view/board-view";

const TICKET_FIELDS: BoardField[] = [
  { key: "title", label: "Title", fieldType: "TEXT" },
  {
    key: "status", label: "Status", fieldType: "SELECT",
    options: { choices: [
      { value: "OPEN", label: "Open", color: "#60a5fa" },
      { value: "TRIAGED", label: "Triaged", color: "#f59e0b" },
      { value: "IN_PROGRESS", label: "In progress", color: "#a78bfa" },
      { value: "WAITING_ON_USER", label: "Waiting on user", color: "#71717a" },
      { value: "WAITING_ON_VENDOR", label: "Waiting on vendor", color: "#71717a" },
      { value: "RESOLVED", label: "Resolved", color: "#10b981" },
      { value: "CLOSED", label: "Closed", color: "#a1a1aa" },
      { value: "CANCELLED", label: "Cancelled", color: "#ef4444" },
    ] },
  },
  {
    key: "priority", label: "Priority", fieldType: "SELECT",
    options: { choices: [
      { value: "LOW", label: "Low", color: "#a1a1aa" },
      { value: "NORMAL", label: "Normal", color: "#60a5fa" },
      { value: "HIGH", label: "High", color: "#f59e0b" },
      { value: "URGENT", label: "Urgent", color: "#ef4444" },
      { value: "CRITICAL", label: "Critical", color: "#b91c1c" },
    ] },
  },
  { key: "category", label: "Category", fieldType: "TEXT" },
  { key: "source", label: "Source", fieldType: "TEXT" },
  { key: "dueAt", label: "Due", fieldType: "DATE" },
];

type Ticket = {
  id: string;
  title: string;
  description: string | null;
  status: string;
  priority: string;
  category: string | null;
  source: string;
  requesterId: string | null;
  assigneeId: string | null;
  dueAt: string | null;
  resolvedAt: string | null;
  createdAt: string;
};

type Incident = {
  id: string;
  title: string;
  summary: string | null;
  severity: string;
  status: string;
  commanderId: string | null;
  affectedServices: string[];
  startedAt: string;
  acknowledgedAt: string | null;
  resolvedAt: string | null;
};

type KbArticle = {
  id: string;
  slug: string;
  title: string;
  excerpt: string | null;
  category: string | null;
  publishedAt: string | null;
  viewCount: number;
  updatedAt: string;
};

type Tab = "tickets" | "incidents" | "kb";

const TICKET_STATUSES = [
  "OPEN",
  "TRIAGED",
  "IN_PROGRESS",
  "WAITING_ON_USER",
  "WAITING_ON_VENDOR",
  "RESOLVED",
  "CLOSED",
] as const;

const STATUS_TONES: Record<string, string> = {
  OPEN: "bg-blue-100 text-blue-700",
  TRIAGED: "bg-amber-100 text-amber-700",
  IN_PROGRESS: "bg-violet-100 text-violet-700",
  WAITING_ON_USER: "bg-zinc-100 text-zinc-600",
  WAITING_ON_VENDOR: "bg-zinc-100 text-zinc-600",
  RESOLVED: "bg-emerald-100 text-emerald-700",
  CLOSED: "bg-zinc-100 text-zinc-500",
  CANCELLED: "bg-rose-100 text-rose-700",
};

const PRIORITY_TONES: Record<string, string> = {
  LOW: "text-zinc-500",
  NORMAL: "text-blue-600",
  HIGH: "text-amber-600",
  URGENT: "text-rose-600",
  CRITICAL: "text-rose-700 font-bold",
};

const SEVERITY_TONES: Record<string, string> = {
  SEV1: "bg-rose-100 text-rose-700",
  SEV2: "bg-orange-100 text-orange-700",
  SEV3: "bg-amber-100 text-amber-700",
  SEV4: "bg-blue-100 text-blue-700",
  SEV5: "bg-zinc-100 text-zinc-600",
};

const INC_STATUS_TONES: Record<string, string> = {
  DETECTED: "bg-rose-100 text-rose-700",
  ACKNOWLEDGED: "bg-amber-100 text-amber-700",
  INVESTIGATING: "bg-violet-100 text-violet-700",
  MITIGATING: "bg-blue-100 text-blue-700",
  RESOLVED: "bg-emerald-100 text-emerald-700",
  POSTMORTEM: "bg-teal-100 text-teal-700",
  CLOSED: "bg-zinc-100 text-zinc-500",
};

function timeAgo(iso: string) {
  const diff = Date.now() - new Date(iso).getTime();
  const m = Math.floor(diff / 60000);
  if (m < 1) return "now";
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h`;
  return `${Math.floor(h / 24)}d`;
}

export default function ItsmPage() {
  const [tab, setTab] = useState<Tab>("tickets");
  const [tickets, setTickets] = useState<Ticket[]>([]);
  const [incidents, setIncidents] = useState<Incident[]>([]);
  const [articles, setArticles] = useState<KbArticle[]>([]);
  const [loading, setLoading] = useState(true);
  const [showNewTicket, setShowNewTicket] = useState(false);
  const [showNewIncident, setShowNewIncident] = useState(false);
  const [showNewArticle, setShowNewArticle] = useState(false);

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const [t, i, a] = await Promise.all([
        fetch("/api/itsm/tickets").then((r) => (r.ok ? r.json() : { tickets: [] })),
        fetch("/api/itsm/incidents").then((r) => (r.ok ? r.json() : { incidents: [] })),
        fetch("/api/itsm/kb-articles").then((r) => (r.ok ? r.json() : { articles: [] })),
      ]);
      setTickets(t.tickets || []);
      setIncidents(i.incidents || []);
      setArticles(a.articles || []);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { refresh(); }, [refresh]);

  async function moveTicket(id: string, newStatus: string) {
    setTickets((prev) => prev.map((t) => (t.id === id ? { ...t, status: newStatus } : t)));
    await fetch("/api/itsm/tickets", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id, status: newStatus }),
    });
  }

  // Counts for tabs + KPI cards
  const openTickets = tickets.filter((t) => !["RESOLVED", "CLOSED", "CANCELLED"].includes(t.status)).length;
  const activeIncidents = incidents.filter((i) => !["RESOLVED", "CLOSED"].includes(i.status)).length;
  const criticalIncidents = incidents.filter((i) => ["SEV1", "SEV2"].includes(i.severity) && !["RESOLVED", "CLOSED"].includes(i.status)).length;
  const overdueTickets = tickets.filter((t) => t.dueAt && new Date(t.dueAt).getTime() < Date.now() && !["RESOLVED", "CLOSED", "CANCELLED"].includes(t.status)).length;

  return (
    <div className="p-6 max-w-[1800px] mx-auto">
      <div className="flex items-start justify-between mb-6">
        <div>
          <div className="inline-flex items-center gap-2 px-2 py-0.5 rounded-full bg-blue-100 dark:bg-blue-900/40 text-blue-700 dark:text-blue-300 text-xs font-medium mb-3">
            <Headphones size={12} />
            WorkwrK ITSM
          </div>
          <h1 className="text-2xl font-semibold mb-1">IT Service Management</h1>
          <p className="text-sm text-muted">
            Tickets · Incidents · Knowledge base — your IT team&apos;s command center
          </p>
        </div>
        <button
          type="button"
          onClick={() => (tab === "tickets" ? setShowNewTicket(true) : tab === "incidents" ? setShowNewIncident(true) : setShowNewArticle(true))}
          className="inline-flex items-center gap-2 px-4 py-2 rounded-xl bg-blue-600 hover:bg-blue-700 text-white text-sm font-medium"
        >
          <Plus size={14} />
          {tab === "tickets" ? "New ticket" : tab === "incidents" ? "Declare incident" : "New article"}
        </button>
      </div>

      {/* KPI strip */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-6">
        <Kpi label="Open tickets" value={openTickets.toString()} />
        <Kpi label="Active incidents" value={activeIncidents.toString()} tone={activeIncidents > 0 ? "amber" : undefined} />
        <Kpi label="Critical (SEV1-2)" value={criticalIncidents.toString()} tone={criticalIncidents > 0 ? "rose" : undefined} />
        <Kpi label="Overdue tickets" value={overdueTickets.toString()} tone={overdueTickets > 0 ? "rose" : undefined} />
      </div>

      {/* Tabs */}
      <div className="flex items-center gap-1 mb-6 border-b border-border">
        {([
          { id: "tickets", label: "Tickets", Icon: Headphones, count: tickets.length },
          { id: "incidents", label: "Incidents", Icon: AlertTriangle, count: incidents.length },
          { id: "kb", label: "Knowledge Base", Icon: BookOpen, count: articles.length },
        ] as { id: Tab; label: string; Icon: typeof Headphones; count: number }[]).map(({ id, label, Icon, count }) => (
          <button
            key={id}
            type="button"
            onClick={() => setTab(id)}
            className={
              "inline-flex items-center gap-2 px-4 py-2 -mb-px text-sm font-medium border-b-2 transition-colors " +
              (tab === id ? "border-blue-600 text-blue-700 dark:text-blue-400" : "border-transparent text-muted hover:text-foreground")
            }
          >
            <Icon size={14} />
            {label}
            <span className={tab === id ? "ml-1 text-xs px-1.5 py-0.5 rounded bg-blue-100 dark:bg-blue-900/40" : "ml-1 text-xs text-muted-2"}>
              {count}
            </span>
          </button>
        ))}
      </div>

      {/* Tickets tab — BoardView with auto-detected Kanban by status */}
      {tab === "tickets" && (
        loading ? (
          <div className="text-sm text-muted py-20 text-center">Loading tickets…</div>
        ) : tickets.length === 0 ? (
          <EmptyState
            Icon={Headphones}
            title="No tickets yet"
            hint="Submit your first IT support ticket to start tracking employee requests."
            action={{ label: "Create first ticket", onClick: () => setShowNewTicket(true) }}
          />
        ) : (
          <BoardView
            boardKey="itsm:tickets"
            items={tickets}
            fields={TICKET_FIELDS}
            getId={(t) => t.id}
            getTitle={(t) => t.title}
            getValue={(t, key) => (t as unknown as Record<string, unknown>)[key]}
            editableFields={["status", "priority"]}
            onChangeField={async (id, key, value) => {
              await fetch("/api/itsm/tickets", {
                method: "PATCH",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ id, [key]: value }),
              });
              await refresh();
            }}
          />
        )
      )}

      {/* Incidents tab — timeline */}
      {tab === "incidents" && (
        <div className="rounded-xl border border-border bg-surface overflow-hidden">
          {loading ? (
            <div className="text-sm text-muted py-20 text-center">Loading incidents…</div>
          ) : incidents.length === 0 ? (
            <EmptyState
              Icon={AlertTriangle}
              title="No incidents declared"
              hint="When production breaks, declare an incident to coordinate response."
              action={{ label: "Declare incident", onClick: () => setShowNewIncident(true) }}
            />
          ) : (
            <div className="divide-y divide-border">
              {incidents.map((i) => (
                <div key={i.id} className="p-4 hover:bg-surface-2">
                  <div className="flex items-start justify-between gap-4">
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 mb-1.5">
                        <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded ${SEVERITY_TONES[i.severity]}`}>{i.severity}</span>
                        <span className={`text-[10px] font-medium px-2 py-0.5 rounded-full uppercase tracking-wider ${INC_STATUS_TONES[i.status]}`}>{i.status}</span>
                        <span className="text-xs text-muted-2 inline-flex items-center gap-1">
                          <Clock size={11} /> {timeAgo(i.startedAt)} ago
                        </span>
                      </div>
                      <h3 className="font-semibold text-sm mb-1">{i.title}</h3>
                      {i.summary && <p className="text-xs text-muted line-clamp-2">{i.summary}</p>}
                    </div>
                    <ChevronRight size={16} className="text-muted-2 flex-shrink-0" />
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* KB tab — list of articles */}
      {tab === "kb" && (
        <div>
          {loading ? (
            <div className="text-sm text-muted py-20 text-center">Loading articles…</div>
          ) : articles.length === 0 ? (
            <div className="rounded-xl border border-border bg-surface">
              <EmptyState
                Icon={BookOpen}
                title="Knowledge base is empty"
                hint="Write articles to deflect repeat tickets. Your agents can answer from these."
                action={{ label: "Write first article", onClick: () => setShowNewArticle(true) }}
              />
            </div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
              {articles.map((a) => (
                <article key={a.id} className="rounded-xl border border-border bg-surface p-4 hover:border-blue-300 transition-colors">
                  <div className="flex items-center gap-2 mb-2">
                    <BookOpen size={14} className="text-blue-600" />
                    {a.category && <span className="text-[10px] font-medium uppercase tracking-wider text-muted-2">{a.category}</span>}
                    {!a.publishedAt && <span className="text-[10px] font-medium px-1.5 py-0.5 rounded bg-amber-100 text-amber-700">DRAFT</span>}
                  </div>
                  <h3 className="font-semibold text-sm mb-1.5">{a.title}</h3>
                  {a.excerpt && <p className="text-xs text-muted line-clamp-3 mb-2">{a.excerpt}</p>}
                  <div className="flex items-center gap-3 text-[11px] text-muted-2">
                    <span>{a.viewCount} views</span>
                    <span>·</span>
                    <span>{timeAgo(a.updatedAt)} ago</span>
                  </div>
                </article>
              ))}
            </div>
          )}
        </div>
      )}

      {showNewTicket && <NewTicketModal onClose={() => setShowNewTicket(false)} onCreated={() => { setShowNewTicket(false); refresh(); }} />}
      {showNewIncident && <NewIncidentModal onClose={() => setShowNewIncident(false)} onCreated={() => { setShowNewIncident(false); refresh(); }} />}
      {showNewArticle && <NewArticleModal onClose={() => setShowNewArticle(false)} onCreated={() => { setShowNewArticle(false); refresh(); }} />}
    </div>
  );
}

function Kpi({ label, value, tone }: { label: string; value: string; tone?: "amber" | "rose" }) {
  const bg = tone === "rose" ? "bg-rose-50 dark:bg-rose-950/30 border-rose-200 dark:border-rose-900" : tone === "amber" ? "bg-amber-50 dark:bg-amber-950/30 border-amber-200 dark:border-amber-900" : "bg-surface";
  return (
    <div className={`rounded-xl border border-border p-3 ${bg}`}>
      <div className="text-[11px] uppercase tracking-wider text-muted-2 mb-1">{label}</div>
      <div className="text-lg font-semibold">{value}</div>
    </div>
  );
}

function TicketCard({ ticket, onMove }: { ticket: Ticket; onMove: (s: string) => void }) {
  const [menuOpen, setMenuOpen] = useState(false);
  return (
    <div className="rounded-lg bg-surface border border-border p-3 relative">
      <div className="flex items-start justify-between mb-1.5">
        <span className={`text-[10px] font-bold uppercase tracking-wider ${PRIORITY_TONES[ticket.priority]}`}>{ticket.priority}</span>
        <button type="button" onClick={() => setMenuOpen((v) => !v)} className="p-1 -mr-1 rounded hover:bg-surface-2 text-muted-2">
          <ChevronRight size={12} className={menuOpen ? "rotate-90 transition-transform" : "transition-transform"} />
        </button>
        {menuOpen && (
          <div className="absolute top-7 right-2 z-10 w-44 rounded-lg bg-surface border border-border shadow-lg py-1">
            <div className="px-3 py-1 text-[10px] uppercase tracking-wider text-muted-2">Move to</div>
            {TICKET_STATUSES.map((s) => (
              <button
                key={s}
                type="button"
                onClick={() => { setMenuOpen(false); onMove(s); }}
                disabled={s === ticket.status}
                className="w-full text-left px-3 py-1.5 text-xs hover:bg-surface-2 disabled:opacity-40"
              >
                {s.replace(/_/g, " ")}
              </button>
            ))}
          </div>
        )}
      </div>
      <div className="font-medium text-sm leading-tight mb-1.5">{ticket.title}</div>
      <div className="flex items-center gap-2 text-[11px] text-muted-2">
        {ticket.category && <span>{ticket.category}</span>}
        <span>·</span>
        <span>{timeAgo(ticket.createdAt)} ago</span>
      </div>
    </div>
  );
}

function EmptyState({ Icon, title, hint, action }: { Icon: typeof Headphones; title: string; hint: string; action: { label: string; onClick: () => void } }) {
  return (
    <div className="text-center py-20">
      <Icon size={40} className="mx-auto mb-3 text-muted-2" />
      <p className="font-medium mb-1">{title}</p>
      <p className="text-sm text-muted mb-4 max-w-sm mx-auto">{hint}</p>
      <button type="button" onClick={action.onClick} className="inline-flex items-center gap-2 px-4 py-2 rounded-xl bg-blue-600 hover:bg-blue-700 text-white text-sm font-medium">
        <Plus size={14} /> {action.label}
      </button>
    </div>
  );
}

function NewTicketModal({ onClose, onCreated }: { onClose: () => void; onCreated: () => void }) {
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [priority, setPriority] = useState("NORMAL");
  const [category, setCategory] = useState("");
  const [saving, setSaving] = useState(false);
  async function submit() {
    if (!title.trim()) return;
    setSaving(true);
    try {
      await fetch("/api/itsm/tickets", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title: title.trim(), description, priority, category }),
      });
      onCreated();
    } finally { setSaving(false); }
  }
  return (
    <ModalShell title="New ticket" onClose={onClose}>
      <Row label="Title">
        <input autoFocus value={title} onChange={(e) => setTitle(e.target.value)} className="w-full px-3 py-2 rounded-lg border border-border bg-surface text-sm" placeholder="Laptop won't connect to VPN" />
      </Row>
      <Row label="Description">
        <textarea value={description} onChange={(e) => setDescription(e.target.value)} rows={4} className="w-full px-3 py-2 rounded-lg border border-border bg-surface text-sm resize-none" />
      </Row>
      <div className="grid grid-cols-2 gap-3">
        <Row label="Priority">
          <select value={priority} onChange={(e) => setPriority(e.target.value)} className="w-full px-3 py-2 rounded-lg border border-border bg-surface text-sm">
            <option value="LOW">Low</option>
            <option value="NORMAL">Normal</option>
            <option value="HIGH">High</option>
            <option value="URGENT">Urgent</option>
            <option value="CRITICAL">Critical</option>
          </select>
        </Row>
        <Row label="Category">
          <input value={category} onChange={(e) => setCategory(e.target.value)} placeholder="Hardware, Access, ..." className="w-full px-3 py-2 rounded-lg border border-border bg-surface text-sm" />
        </Row>
      </div>
      <ModalActions onClose={onClose} onSubmit={submit} saving={saving} disabled={!title.trim()} />
    </ModalShell>
  );
}

function NewIncidentModal({ onClose, onCreated }: { onClose: () => void; onCreated: () => void }) {
  const [title, setTitle] = useState("");
  const [summary, setSummary] = useState("");
  const [severity, setSeverity] = useState("SEV3");
  const [services, setServices] = useState("");
  const [saving, setSaving] = useState(false);
  async function submit() {
    if (!title.trim()) return;
    setSaving(true);
    try {
      await fetch("/api/itsm/incidents", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title: title.trim(),
          summary,
          severity,
          affectedServices: services.split(",").map((s) => s.trim()).filter(Boolean),
        }),
      });
      onCreated();
    } finally { setSaving(false); }
  }
  return (
    <ModalShell title="Declare incident" onClose={onClose}>
      <Row label="Title">
        <input autoFocus value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Production database degraded" className="w-full px-3 py-2 rounded-lg border border-border bg-surface text-sm" />
      </Row>
      <Row label="Summary">
        <textarea value={summary} onChange={(e) => setSummary(e.target.value)} rows={4} className="w-full px-3 py-2 rounded-lg border border-border bg-surface text-sm resize-none" placeholder="What is happening, what's affected, current impact" />
      </Row>
      <div className="grid grid-cols-2 gap-3">
        <Row label="Severity">
          <select value={severity} onChange={(e) => setSeverity(e.target.value)} className="w-full px-3 py-2 rounded-lg border border-border bg-surface text-sm">
            <option value="SEV1">SEV1 — complete outage</option>
            <option value="SEV2">SEV2 — major degradation</option>
            <option value="SEV3">SEV3 — degraded</option>
            <option value="SEV4">SEV4 — minor</option>
            <option value="SEV5">SEV5 — informational</option>
          </select>
        </Row>
        <Row label="Affected services">
          <input value={services} onChange={(e) => setServices(e.target.value)} placeholder="api, web, db" className="w-full px-3 py-2 rounded-lg border border-border bg-surface text-sm" />
        </Row>
      </div>
      <ModalActions onClose={onClose} onSubmit={submit} saving={saving} disabled={!title.trim()} submitLabel="Declare" />
    </ModalShell>
  );
}

function NewArticleModal({ onClose, onCreated }: { onClose: () => void; onCreated: () => void }) {
  const [title, setTitle] = useState("");
  const [slug, setSlug] = useState("");
  const [excerpt, setExcerpt] = useState("");
  const [bodyText, setBodyText] = useState("");
  const [category, setCategory] = useState("");
  const [publish, setPublish] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function onTitleChange(t: string) {
    setTitle(t);
    if (!slug) setSlug(t.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 80));
  }

  async function submit() {
    if (!title.trim() || !slug.trim() || !bodyText.trim()) return;
    setSaving(true); setError(null);
    try {
      const res = await fetch("/api/itsm/kb-articles", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ slug: slug.trim(), title: title.trim(), body: bodyText, excerpt, category, publish }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        setError(data.error || "Failed to create");
        return;
      }
      onCreated();
    } finally { setSaving(false); }
  }
  return (
    <ModalShell title="New KB article" onClose={onClose}>
      <Row label="Title">
        <input autoFocus value={title} onChange={(e) => onTitleChange(e.target.value)} className="w-full px-3 py-2 rounded-lg border border-border bg-surface text-sm" placeholder="How to reset your password" />
      </Row>
      <Row label="Slug">
        <input value={slug} onChange={(e) => setSlug(e.target.value)} className="w-full px-3 py-2 rounded-lg border border-border bg-surface text-sm font-mono text-xs" />
      </Row>
      <Row label="Excerpt">
        <input value={excerpt} onChange={(e) => setExcerpt(e.target.value)} className="w-full px-3 py-2 rounded-lg border border-border bg-surface text-sm" />
      </Row>
      <Row label="Body (markdown)">
        <textarea value={bodyText} onChange={(e) => setBodyText(e.target.value)} rows={6} className="w-full px-3 py-2 rounded-lg border border-border bg-surface text-sm resize-none font-mono text-xs" />
      </Row>
      <div className="grid grid-cols-2 gap-3 items-end">
        <Row label="Category">
          <input value={category} onChange={(e) => setCategory(e.target.value)} placeholder="Onboarding, Networking, ..." className="w-full px-3 py-2 rounded-lg border border-border bg-surface text-sm" />
        </Row>
        <label className="flex items-center gap-2 pb-2 text-sm">
          <input type="checkbox" checked={publish} onChange={(e) => setPublish(e.target.checked)} />
          Publish immediately
        </label>
      </div>
      {error && <p className="text-xs text-rose-600 mt-2">{error}</p>}
      <ModalActions onClose={onClose} onSubmit={submit} saving={saving} disabled={!title.trim() || !slug.trim() || !bodyText.trim()} submitLabel={publish ? "Publish" : "Save draft"} />
    </ModalShell>
  );
}

function ModalShell({ title, onClose, children }: { title: string; onClose: () => void; children: React.ReactNode }) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40" onClick={onClose}>
      <div className="w-full max-w-lg rounded-2xl bg-surface border border-border shadow-xl p-6 space-y-3" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between mb-2">
          <h2 className="text-lg font-semibold">{title}</h2>
          <button type="button" onClick={onClose} className="p-1 rounded hover:bg-surface-2 text-muted"><X size={16} /></button>
        </div>
        {children}
      </div>
    </div>
  );
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <label className="block text-xs font-medium text-muted-2 mb-1">{label}</label>
      {children}
    </div>
  );
}

function ModalActions({ onClose, onSubmit, saving, disabled, submitLabel = "Create" }: { onClose: () => void; onSubmit: () => void; saving: boolean; disabled: boolean; submitLabel?: string }) {
  return (
    <div className="flex items-center justify-end gap-2 pt-3">
      <button type="button" onClick={onClose} className="px-3 py-2 rounded-lg text-sm text-muted hover:bg-surface-2">Cancel</button>
      <button
        type="button"
        onClick={onSubmit}
        disabled={saving || disabled}
        className="px-4 py-2 rounded-lg text-sm font-medium bg-blue-600 hover:bg-blue-700 text-white disabled:opacity-50 disabled:cursor-not-allowed inline-flex items-center gap-1.5"
      >
        {saving ? "Saving…" : (<><Zap size={12} /> {submitLabel}</>)}
      </button>
    </div>
  );
}
