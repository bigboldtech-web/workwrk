"use client";

// Shared Helpdesk helpers — extracted from the original
// `/helpdesk/page.tsx` for the board-route conversion. Three boards:
// tickets, customers, macros.

import { useState } from "react";
import { X, Plus, Zap, Headphones } from "lucide-react";
import type { BoardField } from "@/components/board-view/board-view";

export type Customer = {
  id: string;
  name: string | null;
  email: string;
  companyName: string | null;
  createdAt: string;
  _count: { tickets: number };
};

export type Ticket = {
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

export type Macro = {
  id: string;
  slug: string;
  title: string;
  body: string;
  category: string | null;
  resolves: boolean;
  usageCount: number;
};

export const SUPPORT_TICKET_FIELDS: BoardField[] = [
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

export function timeAgo(iso: string | null) {
  if (!iso) return "—";
  const diff = Date.now() - new Date(iso).getTime();
  const m = Math.floor(diff / 60000);
  if (m < 1) return "just now";
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.floor(h / 24)}d ago`;
}

export function Loading() { return <div className="text-sm text-muted py-20 text-center">Loading…</div>; }

export function Empty({ Icon, title, hint, onAction, actionLabel }: {
  Icon: typeof Headphones; title: string; hint: string; onAction: () => void; actionLabel: string;
}) {
  return (
    <div className="text-center py-20">
      <Icon size={40} className="mx-auto mb-3 text-muted-2" />
      <p className="font-medium mb-1">{title}</p>
      <p className="text-sm text-muted mb-4 max-w-sm mx-auto">{hint}</p>
      <button type="button" onClick={onAction} className="inline-flex items-center gap-2 px-4 py-2 rounded-xl bg-teal-600 hover:bg-teal-700 text-white text-sm font-medium">
        <Plus size={14} /> {actionLabel}
      </button>
    </div>
  );
}

function HelpModal({ title, onClose, children }: { title: string; onClose: () => void; children: React.ReactNode }) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40" onClick={onClose}>
      <div className="w-full max-w-lg rounded-2xl bg-surface border border-border shadow-xl p-6 space-y-3" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between mb-2">
          <h2 className="text-lg font-semibold">{title}</h2>
          <button type="button" onClick={onClose} className="p-1 rounded hover:bg-surface-2 text-muted"><X size={16} /></button>
        </div>
        <style>{".i{width:100%;padding:.5rem .75rem;border-radius:.5rem;border:1px solid var(--color-border, rgba(0,0,0,.1));background:var(--color-surface, #fff);font-size:.875rem;}"}</style>
        {children}
      </div>
    </div>
  );
}

function HelpRow({ label, children }: { label: string; children: React.ReactNode }) {
  return <div><label className="block text-xs font-medium text-muted-2 mb-1">{label}</label>{children}</div>;
}

function HelpActions({ onClose, onSubmit, saving, disabled }: { onClose: () => void; onSubmit: () => void; saving: boolean; disabled: boolean }) {
  return (
    <div className="flex items-center justify-end gap-2 pt-3">
      <button type="button" onClick={onClose} className="px-3 py-2 rounded-lg text-sm text-muted hover:bg-surface-2">Cancel</button>
      <button type="button" onClick={onSubmit} disabled={saving || disabled} className="px-4 py-2 rounded-lg text-sm font-medium bg-teal-600 hover:bg-teal-700 text-white disabled:opacity-50 inline-flex items-center gap-1.5">
        {saving ? "Saving…" : (<><Zap size={12} /> Create</>)}
      </button>
    </div>
  );
}

export function TicketModal({ onClose, onCreated }: { onClose: () => void; onCreated: () => void }) {
  const [subject, setSubject] = useState("");
  const [body, setBody] = useState("");
  const [customerEmail, setCustomerEmail] = useState("");
  const [customerName, setCustomerName] = useState("");
  const [customerCompany, setCustomerCompany] = useState("");
  const [channel, setChannel] = useState("EMAIL");
  const [priority, setPriority] = useState("NORMAL");
  const [category, setCategory] = useState("");
  const [slaTier, setSlaTier] = useState("Standard");
  const [saving, setSaving] = useState(false);
  async function submit() {
    if (!subject.trim() || !customerEmail.trim()) return;
    setSaving(true);
    try {
      await fetch("/api/helpdesk/tickets", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ subject, body, customerEmail, customerName, customerCompany, channel, priority, category, slaTier }),
      });
      onCreated();
    } finally { setSaving(false); }
  }
  return (
    <HelpModal title="New ticket" onClose={onClose}>
      <HelpRow label="Subject"><input autoFocus value={subject} onChange={(e) => setSubject(e.target.value)} placeholder="Customer can't log in" className="i" /></HelpRow>
      <HelpRow label="Description"><textarea value={body} onChange={(e) => setBody(e.target.value)} rows={4} className="i" /></HelpRow>
      <div className="grid grid-cols-2 gap-3">
        <HelpRow label="Customer email"><input type="email" value={customerEmail} onChange={(e) => setCustomerEmail(e.target.value)} className="i" /></HelpRow>
        <HelpRow label="Customer name"><input value={customerName} onChange={(e) => setCustomerName(e.target.value)} className="i" /></HelpRow>
      </div>
      <HelpRow label="Company"><input value={customerCompany} onChange={(e) => setCustomerCompany(e.target.value)} className="i" /></HelpRow>
      <div className="grid grid-cols-3 gap-3">
        <HelpRow label="Channel"><select value={channel} onChange={(e) => setChannel(e.target.value)} className="i"><option>EMAIL</option><option>CHAT</option><option>PHONE</option><option>PORTAL</option><option>SOCIAL</option><option>IN_APP</option></select></HelpRow>
        <HelpRow label="Priority"><select value={priority} onChange={(e) => setPriority(e.target.value)} className="i"><option>LOW</option><option>NORMAL</option><option>HIGH</option><option>URGENT</option></select></HelpRow>
        <HelpRow label="SLA tier"><select value={slaTier} onChange={(e) => setSlaTier(e.target.value)} className="i"><option>Free</option><option>Standard</option><option>Premium</option><option>Enterprise</option></select></HelpRow>
      </div>
      <HelpRow label="Category"><input value={category} onChange={(e) => setCategory(e.target.value)} placeholder="Billing, Product, Bug…" className="i" /></HelpRow>
      <HelpActions onClose={onClose} onSubmit={submit} saving={saving} disabled={!subject.trim() || !customerEmail.trim()} />
    </HelpModal>
  );
}

export function CustomerModal({ onClose, onCreated }: { onClose: () => void; onCreated: () => void }) {
  const [email, setEmail] = useState("");
  const [name, setName] = useState("");
  const [companyName, setCompanyName] = useState("");
  const [phone, setPhone] = useState("");
  const [notes, setNotes] = useState("");
  const [saving, setSaving] = useState(false);
  async function submit() {
    if (!email.trim()) return;
    setSaving(true);
    try {
      await fetch("/api/helpdesk/customers", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, name, companyName, phone, notes }),
      });
      onCreated();
    } finally { setSaving(false); }
  }
  return (
    <HelpModal title="Add customer" onClose={onClose}>
      <HelpRow label="Email"><input autoFocus type="email" value={email} onChange={(e) => setEmail(e.target.value)} className="i" /></HelpRow>
      <div className="grid grid-cols-2 gap-3">
        <HelpRow label="Name"><input value={name} onChange={(e) => setName(e.target.value)} className="i" /></HelpRow>
        <HelpRow label="Phone"><input value={phone} onChange={(e) => setPhone(e.target.value)} className="i" /></HelpRow>
      </div>
      <HelpRow label="Company"><input value={companyName} onChange={(e) => setCompanyName(e.target.value)} className="i" /></HelpRow>
      <HelpRow label="Notes"><textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={3} className="i" /></HelpRow>
      <HelpActions onClose={onClose} onSubmit={submit} saving={saving} disabled={!email.trim()} />
    </HelpModal>
  );
}

export function MacroModal({ onClose, onCreated }: { onClose: () => void; onCreated: () => void }) {
  const [title, setTitle] = useState("");
  const [slug, setSlug] = useState("");
  const [bodyText, setBodyText] = useState("");
  const [category, setCategory] = useState("");
  const [resolves, setResolves] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  function onTitleChange(t: string) {
    setTitle(t);
    if (!slug) setSlug(t.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 60));
  }
  async function submit() {
    if (!title.trim() || !slug.trim() || !bodyText.trim()) return;
    setSaving(true); setError(null);
    try {
      const res = await fetch("/api/helpdesk/macros", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ slug, title, body: bodyText, category, resolves }),
      });
      if (!res.ok) { const d = await res.json().catch(() => ({})); setError(d.error || "Failed"); return; }
      onCreated();
    } finally { setSaving(false); }
  }
  return (
    <HelpModal title="New macro" onClose={onClose}>
      <HelpRow label="Title"><input autoFocus value={title} onChange={(e) => onTitleChange(e.target.value)} placeholder="How to reset your password" className="i" /></HelpRow>
      <HelpRow label="Slug (used as /trigger)"><input value={slug} onChange={(e) => setSlug(e.target.value)} className="i font-mono text-xs" /></HelpRow>
      <HelpRow label="Body"><textarea value={bodyText} onChange={(e) => setBodyText(e.target.value)} rows={6} className="i" placeholder="The canned response text. Use {{customer_name}} for variables." /></HelpRow>
      <div className="grid grid-cols-2 gap-3 items-end">
        <HelpRow label="Category"><input value={category} onChange={(e) => setCategory(e.target.value)} placeholder="Billing, Product…" className="i" /></HelpRow>
        <label className="flex items-center gap-2 pb-2 text-sm"><input type="checkbox" checked={resolves} onChange={(e) => setResolves(e.target.checked)} /> Auto-resolve ticket</label>
      </div>
      {error && <p className="text-xs text-rose-600">{error}</p>}
      <HelpActions onClose={onClose} onSubmit={submit} saving={saving} disabled={!title.trim() || !slug.trim() || !bodyText.trim()} />
    </HelpModal>
  );
}
