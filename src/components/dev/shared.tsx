"use client";

// Shared Dev (engineering workspace) helpers — extracted from the
// original `/dev/page.tsx` so the per-board routes (`/dev/sprints`,
// `/dev/releases`, `/dev/roadmap`) can each own their data fetch
// without duplicating modals, tone maps, and table helpers.

import { useState } from "react";
import { X, Plus, Zap, Code } from "lucide-react";
import type { BoardField } from "@/components/board-view/board-view";

export type Sprint = {
  id: string;
  name: string;
  goal: string | null;
  startDate: string;
  endDate: string;
  status: string;
  capacityPoints: number | null;
  committedPoints: number | null;
  completedPoints: number | null;
};

export type Release = {
  id: string;
  version: string;
  name: string | null;
  description: string | null;
  status: string;
  releaseType: string | null;
  scheduledFor: string | null;
  shippedAt: string | null;
  isPublic: boolean;
};

export type RoadmapItem = {
  id: string;
  title: string;
  description: string | null;
  theme: string | null;
  priority: string;
  status: string;
  quarter: string | null;
  parentId: string | null;
  effortPoints: number | null;
  impactScore: number | null;
  publicVisible: boolean;
};

export const SPRINT_TONES: Record<string, string> = {
  PLANNED: "bg-zinc-100 text-zinc-600",
  ACTIVE: "bg-violet-100 text-violet-700",
  REVIEW: "bg-amber-100 text-amber-700",
  COMPLETED: "bg-emerald-100 text-emerald-700",
  CANCELLED: "bg-rose-100 text-rose-700",
};

export const RELEASE_TONES: Record<string, string> = {
  PLANNED: "bg-zinc-100 text-zinc-600",
  IN_DEVELOPMENT: "bg-blue-100 text-blue-700",
  READY: "bg-violet-100 text-violet-700",
  ROLLING_OUT: "bg-amber-100 text-amber-700",
  SHIPPED: "bg-emerald-100 text-emerald-700",
  ROLLED_BACK: "bg-rose-100 text-rose-700",
  CANCELLED: "bg-zinc-100 text-zinc-500",
};

export const ROADMAP_FIELDS: BoardField[] = [
  { key: "title", label: "Title", fieldType: "TEXT" },
  {
    key: "status", label: "Status", fieldType: "SELECT",
    options: { choices: [
      { value: "EXPLORING", label: "Exploring", color: "#a1a1aa" },
      { value: "COMMITTED", label: "Committed", color: "#60a5fa" },
      { value: "IN_PROGRESS", label: "In progress", color: "#a78bfa" },
      { value: "BETA", label: "Beta", color: "#f59e0b" },
      { value: "SHIPPED", label: "Shipped", color: "#10b981" },
      { value: "PAUSED", label: "Paused", color: "#71717a" },
      { value: "CANCELLED", label: "Cancelled", color: "#ef4444" },
    ] },
  },
  {
    key: "priority", label: "Priority", fieldType: "SELECT",
    options: { choices: [
      { value: "P0", label: "P0", color: "#ef4444" },
      { value: "P1", label: "P1", color: "#f59e0b" },
      { value: "P2", label: "P2", color: "#60a5fa" },
      { value: "P3", label: "P3", color: "#a1a1aa" },
    ] },
  },
  { key: "theme", label: "Theme", fieldType: "TEXT" },
  { key: "quarter", label: "Quarter", fieldType: "TEXT" },
  { key: "impactScore", label: "Impact", fieldType: "NUMBER" },
  { key: "effortPoints", label: "Effort", fieldType: "NUMBER" },
];

export function Loading() {
  return <div className="text-sm text-muted py-20 text-center">Loading…</div>;
}

export function Empty({
  Icon, title, hint, onAction, actionLabel,
}: {
  Icon: typeof Code;
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
        className="inline-flex items-center gap-2 px-4 py-2 rounded-xl bg-violet-600 hover:bg-violet-700 text-white text-sm font-medium"
      >
        <Plus size={14} /> {actionLabel}
      </button>
    </div>
  );
}

export function DevModal({ title, onClose, children }: { title: string; onClose: () => void; children: React.ReactNode }) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40" onClick={onClose}>
      <div className="w-full max-w-lg rounded-2xl bg-surface border border-border shadow-xl p-6 space-y-3" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between mb-2">
          <h2 className="text-lg font-semibold">{title}</h2>
          <button type="button" onClick={onClose} className="p-1 rounded hover:bg-surface-2 text-muted">
            <X size={16} />
          </button>
        </div>
        <style>{".i{width:100%;padding:.5rem .75rem;border-radius:.5rem;border:1px solid var(--color-border, rgba(0,0,0,.1));background:var(--color-surface, #fff);font-size:.875rem;}"}</style>
        {children}
      </div>
    </div>
  );
}

export function DevRow({ label, children }: { label: string; children: React.ReactNode }) {
  return <div><label className="block text-xs font-medium text-muted-2 mb-1">{label}</label>{children}</div>;
}

export function DevActions({ onClose, onSubmit, saving, disabled }: { onClose: () => void; onSubmit: () => void; saving: boolean; disabled: boolean }) {
  return (
    <div className="flex items-center justify-end gap-2 pt-3">
      <button type="button" onClick={onClose} className="px-3 py-2 rounded-lg text-sm text-muted hover:bg-surface-2">Cancel</button>
      <button
        type="button"
        onClick={onSubmit}
        disabled={saving || disabled}
        className="px-4 py-2 rounded-lg text-sm font-medium bg-violet-600 hover:bg-violet-700 text-white disabled:opacity-50 inline-flex items-center gap-1.5"
      >
        {saving ? "Saving…" : (<><Zap size={12} /> Create</>)}
      </button>
    </div>
  );
}

export function SprintModal({ onClose, onCreated, workspaceId }: { onClose: () => void; onCreated: () => void; workspaceId?: string | null }) {
  const [name, setName] = useState("");
  const [goal, setGoal] = useState("");
  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate] = useState("");
  const [capacityPoints, setCapacityPoints] = useState("");
  const [saving, setSaving] = useState(false);
  async function submit() {
    if (!name.trim() || !startDate || !endDate) return;
    setSaving(true);
    try {
      await fetch("/api/dev/sprints", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name, goal, startDate, endDate,
          capacityPoints: capacityPoints ? parseInt(capacityPoints) : undefined,
          workspaceId: workspaceId ?? undefined,
        }),
      });
      onCreated();
    } finally { setSaving(false); }
  }
  return (
    <DevModal title="New sprint" onClose={onClose}>
      <DevRow label="Sprint name">
        <input autoFocus value={name} onChange={(e) => setName(e.target.value)} placeholder="Sprint 24 · payments rollup" className="i" />
      </DevRow>
      <DevRow label="Goal">
        <textarea value={goal} onChange={(e) => setGoal(e.target.value)} rows={3} className="i" />
      </DevRow>
      <div className="grid grid-cols-2 gap-3">
        <DevRow label="Start"><input type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} className="i" /></DevRow>
        <DevRow label="End"><input type="date" value={endDate} onChange={(e) => setEndDate(e.target.value)} className="i" /></DevRow>
      </div>
      <DevRow label="Capacity (points)">
        <input type="number" value={capacityPoints} onChange={(e) => setCapacityPoints(e.target.value)} className="i" />
      </DevRow>
      <DevActions onClose={onClose} onSubmit={submit} saving={saving} disabled={!name.trim() || !startDate || !endDate} />
    </DevModal>
  );
}

export function ReleaseModal({ onClose, onCreated, workspaceId }: { onClose: () => void; onCreated: () => void; workspaceId?: string | null }) {
  const [version, setVersion] = useState("");
  const [name, setName] = useState("");
  const [releaseType, setReleaseType] = useState("Minor");
  const [scheduledFor, setScheduledFor] = useState("");
  const [isPublic, setIsPublic] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  async function submit() {
    if (!version.trim()) return;
    setSaving(true);
    setError(null);
    try {
      const res = await fetch("/api/dev/releases", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ version, name, releaseType, scheduledFor: scheduledFor || undefined, isPublic, workspaceId: workspaceId ?? undefined }),
      });
      if (!res.ok) {
        const d = await res.json().catch(() => ({}));
        setError(d.error || "Failed");
        return;
      }
      onCreated();
    } finally { setSaving(false); }
  }
  return (
    <DevModal title="New release" onClose={onClose}>
      <DevRow label="Version">
        <input autoFocus value={version} onChange={(e) => setVersion(e.target.value)} placeholder="v2024.11.3" className="i font-mono text-xs" />
      </DevRow>
      <DevRow label="Name">
        <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Payments rollup" className="i" />
      </DevRow>
      <div className="grid grid-cols-2 gap-3">
        <DevRow label="Type">
          <select value={releaseType} onChange={(e) => setReleaseType(e.target.value)} className="i">
            <option>Major</option><option>Minor</option><option>Patch</option><option>Hotfix</option>
          </select>
        </DevRow>
        <DevRow label="Scheduled for">
          <input type="date" value={scheduledFor} onChange={(e) => setScheduledFor(e.target.value)} className="i" />
        </DevRow>
      </div>
      <label className="flex items-center gap-2 text-sm">
        <input type="checkbox" checked={isPublic} onChange={(e) => setIsPublic(e.target.checked)} /> Show on public changelog
      </label>
      {error && <p className="text-xs text-rose-600">{error}</p>}
      <DevActions onClose={onClose} onSubmit={submit} saving={saving} disabled={!version.trim()} />
    </DevModal>
  );
}

export function RoadmapModal({ onClose, onCreated, workspaceId }: { onClose: () => void; onCreated: () => void; workspaceId?: string | null }) {
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [theme, setTheme] = useState("");
  const [priority, setPriority] = useState("P2");
  const [quarter, setQuarter] = useState("");
  const [impactScore, setImpactScore] = useState("");
  const [effortPoints, setEffortPoints] = useState("");
  const [publicVisible, setPublicVisible] = useState(false);
  const [saving, setSaving] = useState(false);
  async function submit() {
    if (!title.trim()) return;
    setSaving(true);
    try {
      await fetch("/api/dev/roadmap", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title, description, theme, priority, quarter,
          impactScore: impactScore ? parseInt(impactScore) : undefined,
          effortPoints: effortPoints ? parseInt(effortPoints) : undefined,
          publicVisible,
          workspaceId: workspaceId ?? undefined,
        }),
      });
      onCreated();
    } finally { setSaving(false); }
  }
  return (
    <DevModal title="New roadmap item" onClose={onClose}>
      <DevRow label="Title">
        <input autoFocus value={title} onChange={(e) => setTitle(e.target.value)} className="i" />
      </DevRow>
      <DevRow label="Description">
        <textarea value={description} onChange={(e) => setDescription(e.target.value)} rows={3} className="i" />
      </DevRow>
      <div className="grid grid-cols-2 gap-3">
        <DevRow label="Theme">
          <input value={theme} onChange={(e) => setTheme(e.target.value)} placeholder="AI, Performance..." className="i" />
        </DevRow>
        <DevRow label="Quarter">
          <input value={quarter} onChange={(e) => setQuarter(e.target.value)} placeholder="2025-Q1" className="i" />
        </DevRow>
      </div>
      <div className="grid grid-cols-3 gap-3">
        <DevRow label="Priority">
          <select value={priority} onChange={(e) => setPriority(e.target.value)} className="i">
            <option>P0</option><option>P1</option><option>P2</option><option>P3</option>
          </select>
        </DevRow>
        <DevRow label="Impact (1-10)">
          <input type="number" min="1" max="10" value={impactScore} onChange={(e) => setImpactScore(e.target.value)} className="i" />
        </DevRow>
        <DevRow label="Effort (pts)">
          <input type="number" value={effortPoints} onChange={(e) => setEffortPoints(e.target.value)} className="i" />
        </DevRow>
      </div>
      <label className="flex items-center gap-2 text-sm">
        <input type="checkbox" checked={publicVisible} onChange={(e) => setPublicVisible(e.target.checked)} /> Visible on public roadmap
      </label>
      <DevActions onClose={onClose} onSubmit={submit} saving={saving} disabled={!title.trim()} />
    </DevModal>
  );
}
