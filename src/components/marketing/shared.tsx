"use client";

// Shared Marketing (WorkwrK Marketing → /marketing) helpers — extracted
// from the original `/marketing/page.tsx` so the per-board routes
// (`/marketing/campaigns`, `/marketing/content`, `/marketing/events`)
// can each own their data fetch without duplicating modals + tones.

import { useState } from "react";
import { X, Plus, Zap, Megaphone } from "lucide-react";
import type { BoardField } from "@/components/board-view/board-view";

export type Campaign = {
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

export type ContentItem = {
  id: string;
  title: string;
  type: string;
  status: string;
  channel: string | null;
  scheduledFor: string | null;
  publishedAt: string | null;
  createdAt: string;
};

export type EventBrief = {
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

export const CAMPAIGN_FIELDS: BoardField[] = [
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

export const CONTENT_FIELDS: BoardField[] = [
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

export const EVENT_TONES: Record<string, string> = {
  PLANNING: "bg-zinc-100 text-zinc-600",
  PROMOTING: "bg-violet-100 text-violet-700",
  REGISTERING: "bg-blue-100 text-blue-700",
  LIVE: "bg-emerald-100 text-emerald-700",
  COMPLETED: "bg-zinc-100 text-zinc-500",
  CANCELLED: "bg-rose-100 text-rose-700",
};

export function money(amount: string | number | null) {
  if (amount === null || amount === undefined) return "—";
  const n = typeof amount === "string" ? parseFloat(amount) : amount;
  if (Number.isNaN(n)) return "—";
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 }).format(n);
}

export function dateRange(s: string | null, e: string | null) {
  if (!s) return "—";
  const start = new Date(s);
  if (!e) return start.toLocaleDateString("en-US", { month: "short", day: "numeric" });
  const end = new Date(e);
  return `${start.toLocaleDateString("en-US", { month: "short", day: "numeric" })} – ${end.toLocaleDateString("en-US", { month: "short", day: "numeric" })}`;
}

export function Loading() {
  return <div className="text-sm text-muted py-20 text-center">Loading…</div>;
}

export function Empty({
  Icon, title, hint, onAction, actionLabel,
}: {
  Icon: typeof Megaphone;
  title: string;
  hint: string;
  onAction: () => void;
  actionLabel: string;
}) {
  return (
    <div className="text-center py-20">
      <Icon size={40} className="mx-auto mb-3 text-muted-2" />
      <p className="font-medium mb-1">{title}</p>
      <p className="text-sm text-muted mb-4 max-w-sm mx-auto">{hint}</p>
      <button
        type="button"
        onClick={onAction}
        className="inline-flex items-center gap-2 px-4 py-2 rounded-xl text-white text-sm font-medium bg-amber-600 hover:bg-amber-700"
      >
        <Plus size={14} /> {actionLabel}
      </button>
    </div>
  );
}

function MktgModal({ title, onClose, children }: { title: string; onClose: () => void; children: React.ReactNode }) {
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

function MktgRow({ label, children }: { label: string; children: React.ReactNode }) {
  return <div><label className="block text-xs font-medium text-muted-2 mb-1">{label}</label>{children}</div>;
}

function MktgActions({ onClose, onSubmit, saving, disabled }: { onClose: () => void; onSubmit: () => void; saving: boolean; disabled: boolean }) {
  return (
    <div className="flex items-center justify-end gap-2 pt-3">
      <button type="button" onClick={onClose} className="px-3 py-2 rounded-lg text-sm text-muted hover:bg-surface-2">Cancel</button>
      <button
        type="button"
        onClick={onSubmit}
        disabled={saving || disabled}
        className="px-4 py-2 rounded-lg text-sm font-medium text-white disabled:opacity-50 inline-flex items-center gap-1.5 bg-amber-600 hover:bg-amber-700"
      >
        {saving ? "Saving…" : (<><Zap size={12} /> Create</>)}
      </button>
    </div>
  );
}

export function CampaignModal({ onClose, onCreated, workspaceId }: { onClose: () => void; onCreated: () => void; workspaceId?: string | null }) {
  const [name, setName] = useState("");
  const [channel, setChannel] = useState("");
  const [budget, setBudget] = useState("");
  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate] = useState("");
  const [saving, setSaving] = useState(false);
  async function submit() {
    if (!name.trim()) return;
    setSaving(true);
    try {
      await fetch("/api/marketing/campaigns", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, channel, budget: budget ? parseFloat(budget) : undefined, startDate: startDate || undefined, endDate: endDate || undefined, workspaceId: workspaceId ?? undefined }),
      });
      onCreated();
    } finally { setSaving(false); }
  }
  return (
    <MktgModal title="New campaign" onClose={onClose}>
      <MktgRow label="Name"><input autoFocus value={name} onChange={(e) => setName(e.target.value)} className="i" /></MktgRow>
      <div className="grid grid-cols-2 gap-3">
        <MktgRow label="Channel"><input value={channel} onChange={(e) => setChannel(e.target.value)} placeholder="Email, Paid Search, Social" className="i" /></MktgRow>
        <MktgRow label="Budget USD"><input type="number" value={budget} onChange={(e) => setBudget(e.target.value)} className="i" /></MktgRow>
      </div>
      <div className="grid grid-cols-2 gap-3">
        <MktgRow label="Start"><input type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} className="i" /></MktgRow>
        <MktgRow label="End"><input type="date" value={endDate} onChange={(e) => setEndDate(e.target.value)} className="i" /></MktgRow>
      </div>
      <MktgActions onClose={onClose} onSubmit={submit} saving={saving} disabled={!name.trim()} />
    </MktgModal>
  );
}

export function ContentModal({ onClose, onCreated, workspaceId }: { onClose: () => void; onCreated: () => void; workspaceId?: string | null }) {
  const [title, setTitle] = useState("");
  const [type, setType] = useState("BLOG_POST");
  const [channel, setChannel] = useState("");
  const [scheduledFor, setScheduledFor] = useState("");
  const [saving, setSaving] = useState(false);
  async function submit() {
    if (!title.trim()) return;
    setSaving(true);
    try {
      await fetch("/api/marketing/content", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title, type, channel, scheduledFor: scheduledFor || undefined, workspaceId: workspaceId ?? undefined }),
      });
      onCreated();
    } finally { setSaving(false); }
  }
  return (
    <MktgModal title="New content" onClose={onClose}>
      <MktgRow label="Title"><input autoFocus value={title} onChange={(e) => setTitle(e.target.value)} className="i" /></MktgRow>
      <div className="grid grid-cols-2 gap-3">
        <MktgRow label="Type">
          <select value={type} onChange={(e) => setType(e.target.value)} className="i">
            <option value="BLOG_POST">Blog post</option>
            <option value="EMAIL">Email</option>
            <option value="SOCIAL_POST">Social post</option>
            <option value="VIDEO">Video</option>
            <option value="WEBINAR">Webinar</option>
            <option value="CASE_STUDY">Case study</option>
            <option value="WHITEPAPER">Whitepaper</option>
            <option value="EBOOK">Ebook</option>
            <option value="PODCAST">Podcast</option>
            <option value="ONE_PAGER">One-pager</option>
            <option value="PRESS_RELEASE">Press release</option>
          </select>
        </MktgRow>
        <MktgRow label="Channel"><input value={channel} onChange={(e) => setChannel(e.target.value)} placeholder="Blog, LinkedIn..." className="i" /></MktgRow>
      </div>
      <MktgRow label="Scheduled for"><input type="date" value={scheduledFor} onChange={(e) => setScheduledFor(e.target.value)} className="i" /></MktgRow>
      <MktgActions onClose={onClose} onSubmit={submit} saving={saving} disabled={!title.trim()} />
    </MktgModal>
  );
}

export function EventModal({ onClose, onCreated, workspaceId }: { onClose: () => void; onCreated: () => void; workspaceId?: string | null }) {
  const [name, setName] = useState("");
  const [type, setType] = useState("");
  const [format, setFormat] = useState("In-person");
  const [startDate, setStartDate] = useState("");
  const [location, setLocation] = useState("");
  const [capacity, setCapacity] = useState("");
  const [saving, setSaving] = useState(false);
  async function submit() {
    if (!name.trim()) return;
    setSaving(true);
    try {
      await fetch("/api/marketing/events", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, type, format, startDate: startDate || undefined, location, capacity: capacity ? parseInt(capacity) : undefined, workspaceId: workspaceId ?? undefined }),
      });
      onCreated();
    } finally { setSaving(false); }
  }
  return (
    <MktgModal title="New event" onClose={onClose}>
      <MktgRow label="Name"><input autoFocus value={name} onChange={(e) => setName(e.target.value)} className="i" /></MktgRow>
      <div className="grid grid-cols-2 gap-3">
        <MktgRow label="Type"><input value={type} onChange={(e) => setType(e.target.value)} placeholder="Conference, Trade show..." className="i" /></MktgRow>
        <MktgRow label="Format">
          <select value={format} onChange={(e) => setFormat(e.target.value)} className="i">
            <option>In-person</option><option>Virtual</option><option>Hybrid</option>
          </select>
        </MktgRow>
      </div>
      <div className="grid grid-cols-2 gap-3">
        <MktgRow label="Start date"><input type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} className="i" /></MktgRow>
        <MktgRow label="Capacity"><input type="number" value={capacity} onChange={(e) => setCapacity(e.target.value)} className="i" /></MktgRow>
      </div>
      <MktgRow label="Location"><input value={location} onChange={(e) => setLocation(e.target.value)} className="i" /></MktgRow>
      <MktgActions onClose={onClose} onSubmit={submit} saving={saving} disabled={!name.trim()} />
    </MktgModal>
  );
}
