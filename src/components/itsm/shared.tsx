"use client";

// Shared ITSM helpers — extracted from the original `/itsm/page.tsx`
// so the per-board routes (`/itsm/tickets`, `/itsm/incidents`,
// `/itsm/kb`) can each own their data fetch without duplicating modal
// UI, tone maps, and field configs.

import { useState } from "react";
import { X, Plus, Zap, Headphones } from "lucide-react";
import type { BoardField } from "@/components/board-view/board-view";

export type Ticket = {
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

export type Incident = {
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

export type KbArticle = {
  id: string;
  slug: string;
  title: string;
  excerpt: string | null;
  category: string | null;
  publishedAt: string | null;
  viewCount: number;
  updatedAt: string;
};

export const TICKET_FIELDS: BoardField[] = [
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

export const SEVERITY_TONES: Record<string, string> = {
  SEV1: "bg-rose-100 text-rose-700",
  SEV2: "bg-orange-100 text-orange-700",
  SEV3: "bg-amber-100 text-amber-700",
  SEV4: "bg-blue-100 text-blue-700",
  SEV5: "bg-zinc-100 text-zinc-600",
};

export const INC_STATUS_TONES: Record<string, string> = {
  DETECTED: "bg-rose-100 text-rose-700",
  ACKNOWLEDGED: "bg-amber-100 text-amber-700",
  INVESTIGATING: "bg-violet-100 text-violet-700",
  MITIGATING: "bg-blue-100 text-blue-700",
  RESOLVED: "bg-emerald-100 text-emerald-700",
  POSTMORTEM: "bg-teal-100 text-teal-700",
  CLOSED: "bg-zinc-100 text-zinc-500",
};

export function timeAgo(iso: string) {
  const diff = Date.now() - new Date(iso).getTime();
  const m = Math.floor(diff / 60000);
  if (m < 1) return "now";
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h`;
  return `${Math.floor(h / 24)}d`;
}

export function Loading() {
  return <div className="text-sm text-muted py-20 text-center">Loading…</div>;
}

export function EmptyState({
  Icon, title, hint, action,
}: {
  Icon: typeof Headphones;
  title: string;
  hint: string;
  action: { label: string; onClick: () => void };
}) {
  return (
    <div className="text-center py-20">
      <Icon size={40} className="mx-auto mb-3 text-muted-2" />
      <p className="font-medium mb-1">{title}</p>
      <p className="text-sm text-muted mb-4 max-w-sm mx-auto">{hint}</p>
      <button
        type="button"
        onClick={action.onClick}
        className="inline-flex items-center gap-2 px-4 py-2 rounded-xl bg-blue-600 hover:bg-blue-700 text-white text-sm font-medium"
      >
        <Plus size={14} /> {action.label}
      </button>
    </div>
  );
}

function ItsmModalShell({ title, onClose, children }: { title: string; onClose: () => void; children: React.ReactNode }) {
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

function ItsmRow({ label, children }: { label: string; children: React.ReactNode }) {
  return <div><label className="block text-xs font-medium text-muted-2 mb-1">{label}</label>{children}</div>;
}

function ItsmActions({ onClose, onSubmit, saving, disabled, submitLabel = "Create" }: { onClose: () => void; onSubmit: () => void; saving: boolean; disabled: boolean; submitLabel?: string }) {
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

export function NewTicketModal({ onClose, onCreated }: { onClose: () => void; onCreated: () => void }) {
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
    <ItsmModalShell title="New ticket" onClose={onClose}>
      <ItsmRow label="Title">
        <input autoFocus value={title} onChange={(e) => setTitle(e.target.value)} className="w-full px-3 py-2 rounded-lg border border-border bg-surface text-sm" placeholder="Laptop won't connect to VPN" />
      </ItsmRow>
      <ItsmRow label="Description">
        <textarea value={description} onChange={(e) => setDescription(e.target.value)} rows={4} className="w-full px-3 py-2 rounded-lg border border-border bg-surface text-sm resize-none" />
      </ItsmRow>
      <div className="grid grid-cols-2 gap-3">
        <ItsmRow label="Priority">
          <select value={priority} onChange={(e) => setPriority(e.target.value)} className="w-full px-3 py-2 rounded-lg border border-border bg-surface text-sm">
            <option value="LOW">Low</option>
            <option value="NORMAL">Normal</option>
            <option value="HIGH">High</option>
            <option value="URGENT">Urgent</option>
            <option value="CRITICAL">Critical</option>
          </select>
        </ItsmRow>
        <ItsmRow label="Category">
          <input value={category} onChange={(e) => setCategory(e.target.value)} placeholder="Hardware, Access, ..." className="w-full px-3 py-2 rounded-lg border border-border bg-surface text-sm" />
        </ItsmRow>
      </div>
      <ItsmActions onClose={onClose} onSubmit={submit} saving={saving} disabled={!title.trim()} />
    </ItsmModalShell>
  );
}

export function NewIncidentModal({ onClose, onCreated }: { onClose: () => void; onCreated: () => void }) {
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
    <ItsmModalShell title="Declare incident" onClose={onClose}>
      <ItsmRow label="Title">
        <input autoFocus value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Production database degraded" className="w-full px-3 py-2 rounded-lg border border-border bg-surface text-sm" />
      </ItsmRow>
      <ItsmRow label="Summary">
        <textarea value={summary} onChange={(e) => setSummary(e.target.value)} rows={4} className="w-full px-3 py-2 rounded-lg border border-border bg-surface text-sm resize-none" placeholder="What is happening, what's affected, current impact" />
      </ItsmRow>
      <div className="grid grid-cols-2 gap-3">
        <ItsmRow label="Severity">
          <select value={severity} onChange={(e) => setSeverity(e.target.value)} className="w-full px-3 py-2 rounded-lg border border-border bg-surface text-sm">
            <option value="SEV1">SEV1 — complete outage</option>
            <option value="SEV2">SEV2 — major degradation</option>
            <option value="SEV3">SEV3 — degraded</option>
            <option value="SEV4">SEV4 — minor</option>
            <option value="SEV5">SEV5 — informational</option>
          </select>
        </ItsmRow>
        <ItsmRow label="Affected services">
          <input value={services} onChange={(e) => setServices(e.target.value)} placeholder="api, web, db" className="w-full px-3 py-2 rounded-lg border border-border bg-surface text-sm" />
        </ItsmRow>
      </div>
      <ItsmActions onClose={onClose} onSubmit={submit} saving={saving} disabled={!title.trim()} submitLabel="Declare" />
    </ItsmModalShell>
  );
}

export function NewArticleModal({ onClose, onCreated }: { onClose: () => void; onCreated: () => void }) {
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
    <ItsmModalShell title="New KB article" onClose={onClose}>
      <ItsmRow label="Title">
        <input autoFocus value={title} onChange={(e) => onTitleChange(e.target.value)} className="w-full px-3 py-2 rounded-lg border border-border bg-surface text-sm" placeholder="How to reset your password" />
      </ItsmRow>
      <ItsmRow label="Slug">
        <input value={slug} onChange={(e) => setSlug(e.target.value)} className="w-full px-3 py-2 rounded-lg border border-border bg-surface text-sm font-mono text-xs" />
      </ItsmRow>
      <ItsmRow label="Excerpt">
        <input value={excerpt} onChange={(e) => setExcerpt(e.target.value)} className="w-full px-3 py-2 rounded-lg border border-border bg-surface text-sm" />
      </ItsmRow>
      <ItsmRow label="Body (markdown)">
        <textarea value={bodyText} onChange={(e) => setBodyText(e.target.value)} rows={6} className="w-full px-3 py-2 rounded-lg border border-border bg-surface text-sm resize-none font-mono text-xs" />
      </ItsmRow>
      <div className="grid grid-cols-2 gap-3 items-end">
        <ItsmRow label="Category">
          <input value={category} onChange={(e) => setCategory(e.target.value)} placeholder="Onboarding, Networking, ..." className="w-full px-3 py-2 rounded-lg border border-border bg-surface text-sm" />
        </ItsmRow>
        <label className="flex items-center gap-2 pb-2 text-sm">
          <input type="checkbox" checked={publish} onChange={(e) => setPublish(e.target.checked)} />
          Publish immediately
        </label>
      </div>
      {error && <p className="text-xs text-rose-600 mt-2">{error}</p>}
      <ItsmActions onClose={onClose} onSubmit={submit} saving={saving} disabled={!title.trim() || !slug.trim() || !bodyText.trim()} submitLabel={publish ? "Publish" : "Save draft"} />
    </ItsmModalShell>
  );
}
