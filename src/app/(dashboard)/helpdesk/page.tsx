"use client";

// WorkwrK Helpdesk — Phase E7. External customer support distinct
// from ITSM (internal IT). Three tabs: Tickets · Customers · Macros.
// Buyer story: Customer Support Manager.

import { useCallback, useEffect, useState } from "react";
import {
  Headphones,
  Users as UsersIcon,
  MessageSquareQuote,
  Plus,
  X,
  Zap,
  Clock,
  AlertTriangle,
} from "lucide-react";
import { BoardView, type BoardField } from "@/components/board-view/board-view";

const SUPPORT_TICKET_FIELDS: BoardField[] = [
  { key: "subject", label: "Subject", fieldType: "TEXT" },
  {
    key: "status", label: "Status", fieldType: "SELECT",
    options: { choices: [
      { value: "NEW", label: "New", color: "#60a5fa" },
      { value: "OPEN", label: "Open", color: "#a78bfa" },
      { value: "PENDING_CUSTOMER", label: "Pending customer", color: "#f59e0b" },
      { value: "PENDING_INTERNAL", label: "Pending internal", color: "#f59e0b" },
      { value: "RESOLVED", label: "Resolved", color: "#10b981" },
      { value: "CLOSED", label: "Closed", color: "#a1a1aa" },
      { value: "SPAM", label: "Spam", color: "#ef4444" },
    ] },
  },
  {
    key: "priority", label: "Priority", fieldType: "SELECT",
    options: { choices: [
      { value: "LOW", label: "Low", color: "#a1a1aa" },
      { value: "NORMAL", label: "Normal", color: "#60a5fa" },
      { value: "HIGH", label: "High", color: "#f59e0b" },
      { value: "URGENT", label: "Urgent", color: "#ef4444" },
    ] },
  },
  {
    key: "channel", label: "Channel", fieldType: "SELECT",
    options: { choices: [
      { value: "EMAIL", label: "Email" }, { value: "CHAT", label: "Chat" },
      { value: "PHONE", label: "Phone" }, { value: "PORTAL", label: "Portal" },
      { value: "SOCIAL", label: "Social" }, { value: "IN_APP", label: "In-app" },
    ] },
  },
  { key: "category", label: "Category", fieldType: "TEXT" },
  { key: "slaTier", label: "SLA", fieldType: "TEXT" },
  { key: "firstResponseDueAt", label: "First response due", fieldType: "DATE" },
];

type Customer = { id: string; name: string | null; email: string; companyName: string | null; createdAt: string; _count: { tickets: number } };
type Ticket = {
  id: string;
  subject: string;
  body: string | null;
  status: string;
  priority: string;
  channel: string;
  category: string | null;
  slaTier: string | null;
  firstResponseDueAt: string | null;
  firstResponseAt: string | null;
  resolvedAt: string | null;
  csatScore: number | null;
  customer: { id: string; name: string | null; email: string; companyName: string | null };
  createdAt: string;
};
type Macro = { id: string; slug: string; title: string; body: string; category: string | null; resolves: boolean; usageCount: number };

type Tab = "tickets" | "customers" | "macros";

const STATUS_TONES: Record<string, string> = {
  NEW: "bg-blue-100 text-blue-700",
  OPEN: "bg-violet-100 text-violet-700",
  PENDING_CUSTOMER: "bg-amber-100 text-amber-700",
  PENDING_INTERNAL: "bg-amber-100 text-amber-700",
  RESOLVED: "bg-emerald-100 text-emerald-700",
  CLOSED: "bg-zinc-100 text-zinc-500",
  SPAM: "bg-rose-100 text-rose-700",
};
const PRIORITY_TONES: Record<string, string> = {
  LOW: "text-zinc-500",
  NORMAL: "text-blue-600",
  HIGH: "text-amber-600",
  URGENT: "text-rose-600 font-bold",
};
const CHANNEL_LABEL: Record<string, string> = {
  EMAIL: "Email",
  CHAT: "Chat",
  PHONE: "Phone",
  PORTAL: "Portal",
  SOCIAL: "Social",
  IN_APP: "In-app",
};

function timeAgo(iso: string | null) {
  if (!iso) return "—";
  const diff = Date.now() - new Date(iso).getTime();
  const m = Math.floor(diff / 60000);
  if (m < 1) return "just now";
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.floor(h / 24)}d ago`;
}

function hoursUntil(iso: string | null) {
  if (!iso) return null;
  return Math.round((new Date(iso).getTime() - Date.now()) / (60 * 60 * 1000));
}

export default function HelpdeskPage() {
  const [tab, setTab] = useState<Tab>("tickets");
  const [tickets, setTickets] = useState<Ticket[]>([]);
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [macros, setMacros] = useState<Macro[]>([]);
  const [loading, setLoading] = useState(true);
  const [showNew, setShowNew] = useState<Tab | null>(null);

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const [t, c, m] = await Promise.all([
        fetch("/api/helpdesk/tickets").then((r) => (r.ok ? r.json() : { tickets: [] })),
        fetch("/api/helpdesk/customers").then((r) => (r.ok ? r.json() : { customers: [] })),
        fetch("/api/helpdesk/macros").then((r) => (r.ok ? r.json() : { macros: [] })),
      ]);
      setTickets(t.tickets || []);
      setCustomers(c.customers || []);
      setMacros(m.macros || []);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { refresh(); }, [refresh]);

  const openTickets = tickets.filter((t) => !["RESOLVED", "CLOSED", "SPAM"].includes(t.status));
  const slaBreached = tickets.filter((t) => {
    if (t.firstResponseAt || !t.firstResponseDueAt) return false;
    return new Date(t.firstResponseDueAt) < new Date();
  });
  const avgCsat = (() => {
    const scored = tickets.filter((t) => t.csatScore !== null).map((t) => t.csatScore!);
    if (scored.length === 0) return null;
    return (scored.reduce((s, x) => s + x, 0) / scored.length).toFixed(1);
  })();
  const urgentOpen = openTickets.filter((t) => t.priority === "URGENT").length;

  return (
    <div className="p-6 max-w-[1800px] mx-auto">
      <div className="flex items-start justify-between mb-6">
        <div>
          <div className="inline-flex items-center gap-2 px-2 py-0.5 rounded-full bg-teal-100 dark:bg-teal-900/40 text-teal-700 dark:text-teal-300 text-xs font-medium mb-3">
            <Headphones size={12} />
            WorkwrK Helpdesk
          </div>
          <h1 className="text-2xl font-semibold mb-1">Customer support</h1>
          <p className="text-sm text-muted">Tickets · Customers · Canned responses — your team&apos;s customer-facing inbox</p>
        </div>
        <button
          type="button"
          onClick={() => setShowNew(tab)}
          className="inline-flex items-center gap-2 px-4 py-2 rounded-xl bg-teal-600 hover:bg-teal-700 text-white text-sm font-medium"
        >
          <Plus size={14} />
          {tab === "tickets" ? "New ticket" : tab === "customers" ? "Add customer" : "New macro"}
        </button>
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-6">
        <Kpi label="Open tickets" value={openTickets.length.toString()} />
        <Kpi label="Urgent open" value={urgentOpen.toString()} tone={urgentOpen > 0 ? "rose" : undefined} />
        <Kpi label="SLA breached" value={slaBreached.length.toString()} tone={slaBreached.length > 0 ? "rose" : undefined} />
        <Kpi label="Avg CSAT" value={avgCsat ? `${avgCsat} / 5` : "—"} tone={avgCsat && parseFloat(avgCsat) < 3.5 ? "amber" : undefined} />
      </div>

      <div className="flex items-center gap-1 mb-6 border-b border-border">
        {([
          { id: "tickets", label: "Tickets", Icon: Headphones, count: tickets.length },
          { id: "customers", label: "Customers", Icon: UsersIcon, count: customers.length },
          { id: "macros", label: "Macros", Icon: MessageSquareQuote, count: macros.length },
        ] as { id: Tab; label: string; Icon: typeof Headphones; count: number }[]).map(({ id, label, Icon, count }) => (
          <button
            key={id}
            type="button"
            onClick={() => setTab(id)}
            className={"inline-flex items-center gap-2 px-4 py-2 -mb-px text-sm font-medium border-b-2 transition-colors " + (tab === id ? "border-teal-600 text-teal-700 dark:text-teal-400" : "border-transparent text-muted hover:text-foreground")}
          >
            <Icon size={14} />
            {label}
            <span className={tab === id ? "ml-1 text-xs px-1.5 py-0.5 rounded bg-teal-100 dark:bg-teal-900/40" : "ml-1 text-xs text-muted-2"}>{count}</span>
          </button>
        ))}
      </div>

      {tab === "tickets" && (
        loading ? <div className="rounded-xl border border-border bg-surface"><Loading /></div>
        : tickets.length === 0 ? (
          <div className="rounded-xl border border-border bg-surface"><Empty Icon={Headphones} title="No tickets yet" hint="When a customer emails support or files a request, the ticket lands here." onAction={() => setShowNew("tickets")} actionLabel="Log first ticket" /></div>
        ) : (
          <BoardView
            boardKey="helpdesk:tickets"
            items={tickets}
            fields={SUPPORT_TICKET_FIELDS}
            getId={(t) => t.id}
            getTitle={(t) => t.subject}
            getValue={(t, key) => {
              if (key === "subject") return t.subject;
              return (t as unknown as Record<string, unknown>)[key];
            }}
            onChangeField={async (id, key, value) => {
              if (key !== "status" && key !== "priority") return;
              await fetch("/api/helpdesk/tickets", {
                method: "PATCH",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ id, [key]: value }),
              });
              await refresh();
            }}
          />
        )
      )}
      {tab === "customers" && (
        <div className="rounded-xl border border-border bg-surface overflow-hidden">
          {loading ? <Loading /> : customers.length === 0 ? (
            <Empty Icon={UsersIcon} title="No customers" hint="Customers get auto-created when they file a ticket. You can also add them manually." onAction={() => setShowNew("customers")} actionLabel="Add customer" />
          ) : (
            <table className="w-full text-sm">
              <thead className="bg-surface-2 text-xs uppercase tracking-wider text-muted-2"><tr>
                <th className="text-left px-4 py-2.5">Name</th>
                <th className="text-left px-4 py-2.5">Email</th>
                <th className="text-left px-4 py-2.5">Company</th>
                <th className="text-left px-4 py-2.5">Tickets</th>
                <th className="text-left px-4 py-2.5">Added</th>
              </tr></thead>
              <tbody>{customers.map((c) => (
                <tr key={c.id} className="border-t border-border hover:bg-surface-2">
                  <td className="px-4 py-2.5 font-medium">{c.name ?? "—"}</td>
                  <td className="px-4 py-2.5 text-muted text-xs">{c.email}</td>
                  <td className="px-4 py-2.5 text-muted">{c.companyName ?? "—"}</td>
                  <td className="px-4 py-2.5 text-muted">{c._count.tickets}</td>
                  <td className="px-4 py-2.5 text-xs text-muted-2">{timeAgo(c.createdAt)}</td>
                </tr>
              ))}</tbody>
            </table>
          )}
        </div>
      )}

      {tab === "macros" && (
        <div>
          {loading ? <Loading /> : macros.length === 0 ? (
            <div className="rounded-xl border border-border bg-surface">
              <Empty Icon={MessageSquareQuote} title="No canned responses" hint="Macros are reusable replies your team types once and applies to many tickets. Refund policy, password reset, escalation message." onAction={() => setShowNew("macros")} actionLabel="Write first macro" />
            </div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">{macros.map((m) => (
              <article key={m.id} className="rounded-xl border border-border bg-surface p-4 hover:border-teal-300">
                <div className="flex items-center gap-2 mb-2">
                  <span className="font-mono text-[10px] text-muted-2 truncate">/{m.slug}</span>
                  {m.category && <span className="text-[10px] uppercase tracking-wider text-teal-700 dark:text-teal-400 ml-auto">{m.category}</span>}
                </div>
                <h3 className="font-semibold text-sm mb-1.5">{m.title}</h3>
                <p className="text-xs text-muted line-clamp-3 mb-2">{m.body}</p>
                <div className="flex items-center justify-between text-[11px] text-muted-2">
                  <span>{m.usageCount} use{m.usageCount === 1 ? "" : "s"}</span>
                  {m.resolves && <span className="text-emerald-600">auto-resolves</span>}
                </div>
              </article>
            ))}</div>
          )}
        </div>
      )}

      {showNew === "tickets" && <TicketModal onClose={() => setShowNew(null)} onCreated={() => { setShowNew(null); refresh(); }} />}
      {showNew === "customers" && <CustomerModal onClose={() => setShowNew(null)} onCreated={() => { setShowNew(null); refresh(); }} />}
      {showNew === "macros" && <MacroModal onClose={() => setShowNew(null)} onCreated={() => { setShowNew(null); refresh(); }} />}
    </div>
  );
}

function Kpi({ label, value, tone }: { label: string; value: string; tone?: "amber" | "rose" }) {
  const bg = tone === "rose" ? "bg-rose-50 dark:bg-rose-950/30" : tone === "amber" ? "bg-amber-50 dark:bg-amber-950/30" : "bg-surface";
  return <div className={`rounded-xl border border-border p-3 ${bg}`}><div className="text-[11px] uppercase tracking-wider text-muted-2 mb-1">{label}</div><div className="text-lg font-semibold">{value}</div></div>;
}

function Loading() { return <div className="text-sm text-muted py-20 text-center">Loading…</div>; }

function Empty({ Icon, title, hint, onAction, actionLabel }: { Icon: typeof Headphones; title: string; hint: string; onAction: () => void; actionLabel: string }) {
  return (
    <div className="text-center py-20">
      <Icon size={40} className="mx-auto mb-3 text-muted-2" />
      <p className="font-medium mb-1">{title}</p>
      <p className="text-sm text-muted mb-4 max-w-sm mx-auto">{hint}</p>
      <button type="button" onClick={onAction} className="inline-flex items-center gap-2 px-4 py-2 rounded-xl bg-teal-600 hover:bg-teal-700 text-white text-sm font-medium"><Plus size={14} /> {actionLabel}</button>
    </div>
  );
}

function TicketModal({ onClose, onCreated }: { onClose: () => void; onCreated: () => void }) {
  const [subject, setSubject] = useState(""); const [body, setBody] = useState(""); const [customerEmail, setCustomerEmail] = useState(""); const [customerName, setCustomerName] = useState(""); const [customerCompany, setCustomerCompany] = useState(""); const [channel, setChannel] = useState("EMAIL"); const [priority, setPriority] = useState("NORMAL"); const [category, setCategory] = useState(""); const [slaTier, setSlaTier] = useState("Standard"); const [saving, setSaving] = useState(false);
  async function submit() {
    if (!subject.trim() || !customerEmail.trim()) return; setSaving(true);
    try {
      await fetch("/api/helpdesk/tickets", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ subject, body, customerEmail, customerName, customerCompany, channel, priority, category, slaTier }) });
      onCreated();
    } finally { setSaving(false); }
  }
  return <Modal title="New ticket" onClose={onClose}><Row label="Subject"><input autoFocus value={subject} onChange={(e) => setSubject(e.target.value)} placeholder="Customer can't log in" className="i" /></Row><Row label="Description"><textarea value={body} onChange={(e) => setBody(e.target.value)} rows={4} className="i" /></Row><div className="grid grid-cols-2 gap-3"><Row label="Customer email"><input type="email" value={customerEmail} onChange={(e) => setCustomerEmail(e.target.value)} className="i" /></Row><Row label="Customer name"><input value={customerName} onChange={(e) => setCustomerName(e.target.value)} className="i" /></Row></div><Row label="Company"><input value={customerCompany} onChange={(e) => setCustomerCompany(e.target.value)} className="i" /></Row><div className="grid grid-cols-3 gap-3"><Row label="Channel"><select value={channel} onChange={(e) => setChannel(e.target.value)} className="i"><option>EMAIL</option><option>CHAT</option><option>PHONE</option><option>PORTAL</option><option>SOCIAL</option><option>IN_APP</option></select></Row><Row label="Priority"><select value={priority} onChange={(e) => setPriority(e.target.value)} className="i"><option>LOW</option><option>NORMAL</option><option>HIGH</option><option>URGENT</option></select></Row><Row label="SLA tier"><select value={slaTier} onChange={(e) => setSlaTier(e.target.value)} className="i"><option>Free</option><option>Standard</option><option>Premium</option><option>Enterprise</option></select></Row></div><Row label="Category"><input value={category} onChange={(e) => setCategory(e.target.value)} placeholder="Billing, Product, Bug…" className="i" /></Row><Actions onClose={onClose} onSubmit={submit} saving={saving} disabled={!subject.trim() || !customerEmail.trim()} /></Modal>;
}

function CustomerModal({ onClose, onCreated }: { onClose: () => void; onCreated: () => void }) {
  const [email, setEmail] = useState(""); const [name, setName] = useState(""); const [companyName, setCompanyName] = useState(""); const [phone, setPhone] = useState(""); const [notes, setNotes] = useState(""); const [saving, setSaving] = useState(false);
  async function submit() {
    if (!email.trim()) return; setSaving(true);
    try {
      await fetch("/api/helpdesk/customers", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ email, name, companyName, phone, notes }) });
      onCreated();
    } finally { setSaving(false); }
  }
  return <Modal title="Add customer" onClose={onClose}><Row label="Email"><input autoFocus type="email" value={email} onChange={(e) => setEmail(e.target.value)} className="i" /></Row><div className="grid grid-cols-2 gap-3"><Row label="Name"><input value={name} onChange={(e) => setName(e.target.value)} className="i" /></Row><Row label="Phone"><input value={phone} onChange={(e) => setPhone(e.target.value)} className="i" /></Row></div><Row label="Company"><input value={companyName} onChange={(e) => setCompanyName(e.target.value)} className="i" /></Row><Row label="Notes"><textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={3} className="i" /></Row><Actions onClose={onClose} onSubmit={submit} saving={saving} disabled={!email.trim()} /></Modal>;
}

function MacroModal({ onClose, onCreated }: { onClose: () => void; onCreated: () => void }) {
  const [title, setTitle] = useState(""); const [slug, setSlug] = useState(""); const [bodyText, setBodyText] = useState(""); const [category, setCategory] = useState(""); const [resolves, setResolves] = useState(false); const [saving, setSaving] = useState(false); const [error, setError] = useState<string | null>(null);
  function onTitleChange(t: string) {
    setTitle(t);
    if (!slug) setSlug(t.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 60));
  }
  async function submit() {
    if (!title.trim() || !slug.trim() || !bodyText.trim()) return; setSaving(true); setError(null);
    try {
      const res = await fetch("/api/helpdesk/macros", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ slug, title, body: bodyText, category, resolves }) });
      if (!res.ok) { const d = await res.json().catch(() => ({})); setError(d.error || "Failed"); return; }
      onCreated();
    } finally { setSaving(false); }
  }
  return <Modal title="New macro" onClose={onClose}><Row label="Title"><input autoFocus value={title} onChange={(e) => onTitleChange(e.target.value)} placeholder="How to reset your password" className="i" /></Row><Row label="Slug (used as /trigger)"><input value={slug} onChange={(e) => setSlug(e.target.value)} className="i font-mono text-xs" /></Row><Row label="Body"><textarea value={bodyText} onChange={(e) => setBodyText(e.target.value)} rows={6} className="i" placeholder="The canned response text. Use {{customer_name}} for variables." /></Row><div className="grid grid-cols-2 gap-3 items-end"><Row label="Category"><input value={category} onChange={(e) => setCategory(e.target.value)} placeholder="Billing, Product…" className="i" /></Row><label className="flex items-center gap-2 pb-2 text-sm"><input type="checkbox" checked={resolves} onChange={(e) => setResolves(e.target.checked)} /> Auto-resolve ticket</label></div>{error && <p className="text-xs text-rose-600">{error}</p>}<Actions onClose={onClose} onSubmit={submit} saving={saving} disabled={!title.trim() || !slug.trim() || !bodyText.trim()} /></Modal>;
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

function Actions({ onClose, onSubmit, saving, disabled }: { onClose: () => void; onSubmit: () => void; saving: boolean; disabled: boolean }) {
  return (
    <div className="flex items-center justify-end gap-2 pt-3">
      <button type="button" onClick={onClose} className="px-3 py-2 rounded-lg text-sm text-muted hover:bg-surface-2">Cancel</button>
      <button type="button" onClick={onSubmit} disabled={saving || disabled} className="px-4 py-2 rounded-lg text-sm font-medium bg-teal-600 hover:bg-teal-700 text-white disabled:opacity-50 inline-flex items-center gap-1.5">{saving ? "Saving…" : (<><Zap size={12} /> Create</>)}</button>
    </div>
  );
}
