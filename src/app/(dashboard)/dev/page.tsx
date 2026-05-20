"use client";

// WorkwrK Dev — Phase E5 showcase product.
// Sprints + Releases + Roadmap. Engineering team's command center.

import { useCallback, useEffect, useState } from "react";
import {
  Code,
  Rocket,
  Map as MapIcon,
  Plus,
  X,
  Zap,
  Calendar,
} from "lucide-react";
import { BoardView, type BoardField } from "@/components/board-view/board-view";

const ROADMAP_FIELDS: BoardField[] = [
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

type Sprint = {
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

type Release = {
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

type RoadmapItem = {
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

type Tab = "sprints" | "releases" | "roadmap";

const SPRINT_TONES: Record<string, string> = {
  PLANNED: "bg-zinc-100 text-zinc-600",
  ACTIVE: "bg-violet-100 text-violet-700",
  REVIEW: "bg-amber-100 text-amber-700",
  COMPLETED: "bg-emerald-100 text-emerald-700",
  CANCELLED: "bg-rose-100 text-rose-700",
};

const RELEASE_TONES: Record<string, string> = {
  PLANNED: "bg-zinc-100 text-zinc-600",
  IN_DEVELOPMENT: "bg-blue-100 text-blue-700",
  READY: "bg-violet-100 text-violet-700",
  ROLLING_OUT: "bg-amber-100 text-amber-700",
  SHIPPED: "bg-emerald-100 text-emerald-700",
  ROLLED_BACK: "bg-rose-100 text-rose-700",
  CANCELLED: "bg-zinc-100 text-zinc-500",
};

const ROADMAP_TONES: Record<string, string> = {
  EXPLORING: "bg-zinc-100 text-zinc-600",
  COMMITTED: "bg-blue-100 text-blue-700",
  IN_PROGRESS: "bg-violet-100 text-violet-700",
  BETA: "bg-amber-100 text-amber-700",
  SHIPPED: "bg-emerald-100 text-emerald-700",
  PAUSED: "bg-zinc-100 text-zinc-500",
  CANCELLED: "bg-rose-100 text-rose-700",
};

const PRIORITY_TONES: Record<string, string> = {
  P0: "bg-rose-100 text-rose-700",
  P1: "bg-amber-100 text-amber-700",
  P2: "bg-blue-100 text-blue-700",
  P3: "bg-zinc-100 text-zinc-600",
};

export default function DevPage() {
  const [tab, setTab] = useState<Tab>("sprints");
  const [sprints, setSprints] = useState<Sprint[]>([]);
  const [releases, setReleases] = useState<Release[]>([]);
  const [roadmap, setRoadmap] = useState<RoadmapItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [showNew, setShowNew] = useState<Tab | null>(null);

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const [s, r, rm] = await Promise.all([
        fetch("/api/dev/sprints").then((x) => (x.ok ? x.json() : { sprints: [] })),
        fetch("/api/dev/releases").then((x) => (x.ok ? x.json() : { releases: [] })),
        fetch("/api/dev/roadmap").then((x) => (x.ok ? x.json() : { items: [] })),
      ]);
      setSprints(s.sprints || []);
      setReleases(r.releases || []);
      setRoadmap(rm.items || []);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { refresh(); }, [refresh]);

  const activeSprint = sprints.find((s) => s.status === "ACTIVE");
  const inDevReleases = releases.filter((r) => r.status === "IN_DEVELOPMENT" || r.status === "READY").length;
  const inProgressItems = roadmap.filter((r) => r.status === "IN_PROGRESS").length;
  const sprintProgress = activeSprint && activeSprint.committedPoints
    ? Math.round(((activeSprint.completedPoints ?? 0) / activeSprint.committedPoints) * 100)
    : null;

  return (
    <div className="p-6 max-w-[1800px] mx-auto">
      <div className="flex items-start justify-between mb-6">
        <div>
          <div className="inline-flex items-center gap-2 px-2 py-0.5 rounded-full bg-violet-100 dark:bg-violet-900/40 text-violet-700 dark:text-violet-300 text-xs font-medium mb-3">
            <Code size={12} />
            WorkwrK Dev
          </div>
          <h1 className="text-2xl font-semibold mb-1">Engineering workspace</h1>
          <p className="text-sm text-muted">Sprints · Releases · Roadmap — your eng team&apos;s shipping rhythm</p>
        </div>
        <button
          type="button"
          onClick={() => setShowNew(tab)}
          className="inline-flex items-center gap-2 px-4 py-2 rounded-xl bg-violet-600 hover:bg-violet-700 text-white text-sm font-medium"
        >
          <Plus size={14} />
          New {tab === "sprints" ? "sprint" : tab === "releases" ? "release" : "roadmap item"}
        </button>
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-6">
        <Kpi label="Active sprint" value={activeSprint?.name ?? "—"} />
        <Kpi label="Sprint progress" value={sprintProgress !== null ? sprintProgress + "%" : "—"} tone={sprintProgress !== null && sprintProgress < 50 ? "amber" : undefined} />
        <Kpi label="In development" value={inDevReleases.toString()} />
        <Kpi label="Roadmap in progress" value={inProgressItems.toString()} />
      </div>

      <div className="flex items-center gap-1 mb-6 border-b border-border">
        {([
          { id: "sprints", label: "Sprints", Icon: Code, count: sprints.length },
          { id: "releases", label: "Releases", Icon: Rocket, count: releases.length },
          { id: "roadmap", label: "Roadmap", Icon: MapIcon, count: roadmap.length },
        ] as { id: Tab; label: string; Icon: typeof Code; count: number }[]).map(({ id, label, Icon, count }) => (
          <button
            key={id}
            type="button"
            onClick={() => setTab(id)}
            className={"inline-flex items-center gap-2 px-4 py-2 -mb-px text-sm font-medium border-b-2 transition-colors " + (tab === id ? "border-violet-600 text-violet-700 dark:text-violet-400" : "border-transparent text-muted hover:text-foreground")}
          >
            <Icon size={14} />
            {label}
            <span className={tab === id ? "ml-1 text-xs px-1.5 py-0.5 rounded bg-violet-100 dark:bg-violet-900/40" : "ml-1 text-xs text-muted-2"}>{count}</span>
          </button>
        ))}
      </div>

      {tab === "sprints" && (
        <div className="rounded-xl border border-border bg-surface overflow-hidden">
          {loading ? <Loading /> : sprints.length === 0 ? <Empty Icon={Code} title="No sprints planned" hint="Define a sprint with goal + duration. Track committed vs completed points." onAction={() => setShowNew("sprints")} actionLabel="Plan first sprint" /> : (
            <div className="divide-y divide-border">
              {sprints.map((s) => {
                const progress = s.committedPoints ? Math.round(((s.completedPoints ?? 0) / s.committedPoints) * 100) : null;
                return (
                  <div key={s.id} className="px-4 py-3 hover:bg-surface-2">
                    <div className="flex items-start gap-4">
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 mb-1">
                          <span className={`text-[10px] font-medium px-1.5 py-0.5 rounded uppercase tracking-wider ${SPRINT_TONES[s.status]}`}>{s.status}</span>
                          <span className="font-semibold text-sm">{s.name}</span>
                        </div>
                        {s.goal && <p className="text-xs text-muted mb-2">{s.goal}</p>}
                        <div className="flex items-center gap-3 text-[11px] text-muted-2">
                          <span><Calendar size={11} className="inline mr-1" />{new Date(s.startDate).toLocaleDateString("en-US", { month: "short", day: "numeric" })} – {new Date(s.endDate).toLocaleDateString("en-US", { month: "short", day: "numeric" })}</span>
                          {s.committedPoints !== null && <span>· {s.completedPoints ?? 0}/{s.committedPoints} pts</span>}
                        </div>
                      </div>
                      {progress !== null && (
                        <div className="w-24 flex-shrink-0">
                          <div className="text-xs font-medium mb-1 text-right">{progress}%</div>
                          <div className="h-1.5 rounded-full bg-surface-2 overflow-hidden"><div className="h-full bg-violet-500" style={{ width: progress + "%" }} /></div>
                        </div>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}

      {tab === "releases" && (
        <div className="rounded-xl border border-border bg-surface overflow-hidden">
          {loading ? <Loading /> : releases.length === 0 ? <Empty Icon={Rocket} title="No releases tracked" hint="Track each version from In Development → Ready → Shipped, with public changelog." onAction={() => setShowNew("releases")} actionLabel="Track a release" /> : (
            <table className="w-full text-sm">
              <thead className="bg-surface-2 text-xs uppercase tracking-wider text-muted-2"><tr><th className="text-left px-4 py-2.5">Version</th><th className="text-left px-4 py-2.5">Name</th><th className="text-left px-4 py-2.5">Status</th><th className="text-left px-4 py-2.5">Type</th><th className="text-left px-4 py-2.5">Date</th><th className="text-left px-4 py-2.5">Public</th></tr></thead>
              <tbody>{releases.map((r) => (<tr key={r.id} className="border-t border-border hover:bg-surface-2"><td className="px-4 py-2.5 font-mono text-xs">{r.version}</td><td className="px-4 py-2.5 font-medium">{r.name ?? "—"}</td><td className="px-4 py-2.5"><span className={`text-[10px] font-medium px-2 py-0.5 rounded-full uppercase tracking-wider ${RELEASE_TONES[r.status]}`}>{r.status.replace(/_/g, " ")}</span></td><td className="px-4 py-2.5 text-xs text-muted-2">{r.releaseType ?? "—"}</td><td className="px-4 py-2.5 text-xs text-muted-2">{r.shippedAt ? new Date(r.shippedAt).toLocaleDateString() : r.scheduledFor ? new Date(r.scheduledFor).toLocaleDateString() : "—"}</td><td className="px-4 py-2.5 text-xs">{r.isPublic ? "✓" : "—"}</td></tr>))}</tbody>
            </table>
          )}
        </div>
      )}

      {tab === "roadmap" && (
        loading ? <div className="rounded-xl border border-border bg-surface"><Loading /></div>
        : roadmap.length === 0 ? <div className="rounded-xl border border-border bg-surface"><Empty Icon={MapIcon} title="Empty roadmap" hint="Themes → initiatives → outcomes. Tied to OKRs + Releases." onAction={() => setShowNew("roadmap")} actionLabel="Add first item" /></div>
        : (
          <BoardView
            boardKey="dev:roadmap"
            items={roadmap}
            fields={ROADMAP_FIELDS}
            getId={(r) => r.id}
            getTitle={(r) => r.title}
            getValue={(r, key) => (r as unknown as Record<string, unknown>)[key]}
            editableFields={["status", "priority", "quarter", "impactScore", "effortPoints"]}
            selectable
            onChangeField={async (id, key, value) => {
              await fetch("/api/dev/roadmap", {
                method: "PATCH",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ id, [key]: value }),
              });
              await refresh();
            }}
            onBulkChange={async (ids, key, value) => {
              await Promise.all(ids.map((id) => fetch("/api/dev/roadmap", {
                method: "PATCH",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ id, [key]: value }),
              })));
              await refresh();
            }}
          />
        )
      )}

      {showNew === "sprints" && <SprintModal onClose={() => setShowNew(null)} onCreated={() => { setShowNew(null); refresh(); }} />}
      {showNew === "releases" && <ReleaseModal onClose={() => setShowNew(null)} onCreated={() => { setShowNew(null); refresh(); }} />}
      {showNew === "roadmap" && <RoadmapModal onClose={() => setShowNew(null)} onCreated={() => { setShowNew(null); refresh(); }} />}
    </div>
  );
}

function Kpi({ label, value, tone }: { label: string; value: string; tone?: "amber" | "rose" }) {
  const bg = tone === "rose" ? "bg-rose-50 dark:bg-rose-950/30" : tone === "amber" ? "bg-amber-50 dark:bg-amber-950/30" : "bg-surface";
  return <div className={`rounded-xl border border-border p-3 ${bg}`}><div className="text-[11px] uppercase tracking-wider text-muted-2 mb-1">{label}</div><div className="text-lg font-semibold truncate">{value}</div></div>;
}

function Loading() { return <div className="text-sm text-muted py-20 text-center">Loading…</div>; }

function Empty({ Icon, title, hint, onAction, actionLabel }: { Icon: typeof Code; title: string; hint: string; onAction: () => void; actionLabel: string }) {
  return (
    <div className="text-center py-20">
      <Icon size={40} className="mx-auto mb-3 text-muted-2" />
      <p className="font-medium mb-1">{title}</p>
      <p className="text-sm text-muted mb-4 max-w-sm mx-auto">{hint}</p>
      <button type="button" onClick={onAction} className="inline-flex items-center gap-2 px-4 py-2 rounded-xl bg-violet-600 hover:bg-violet-700 text-white text-sm font-medium"><Plus size={14} /> {actionLabel}</button>
    </div>
  );
}

function SprintModal({ onClose, onCreated }: { onClose: () => void; onCreated: () => void }) {
  const [name, setName] = useState(""); const [goal, setGoal] = useState(""); const [startDate, setStartDate] = useState(""); const [endDate, setEndDate] = useState(""); const [capacityPoints, setCapacityPoints] = useState(""); const [saving, setSaving] = useState(false);
  async function submit() {
    if (!name.trim() || !startDate || !endDate) return; setSaving(true);
    try {
      await fetch("/api/dev/sprints", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name, goal, startDate, endDate, capacityPoints: capacityPoints ? parseInt(capacityPoints) : undefined }) });
      onCreated();
    } finally { setSaving(false); }
  }
  return <Modal title="New sprint" onClose={onClose}><Row label="Sprint name"><input autoFocus value={name} onChange={(e) => setName(e.target.value)} placeholder="Sprint 24 · payments rollup" className="i" /></Row><Row label="Goal"><textarea value={goal} onChange={(e) => setGoal(e.target.value)} rows={3} className="i" /></Row><div className="grid grid-cols-2 gap-3"><Row label="Start"><input type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} className="i" /></Row><Row label="End"><input type="date" value={endDate} onChange={(e) => setEndDate(e.target.value)} className="i" /></Row></div><Row label="Capacity (points)"><input type="number" value={capacityPoints} onChange={(e) => setCapacityPoints(e.target.value)} className="i" /></Row><Actions onClose={onClose} onSubmit={submit} saving={saving} disabled={!name.trim() || !startDate || !endDate} /></Modal>;
}

function ReleaseModal({ onClose, onCreated }: { onClose: () => void; onCreated: () => void }) {
  const [version, setVersion] = useState(""); const [name, setName] = useState(""); const [releaseType, setReleaseType] = useState("Minor"); const [scheduledFor, setScheduledFor] = useState(""); const [isPublic, setIsPublic] = useState(false); const [saving, setSaving] = useState(false); const [error, setError] = useState<string | null>(null);
  async function submit() {
    if (!version.trim()) return; setSaving(true); setError(null);
    try {
      const res = await fetch("/api/dev/releases", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ version, name, releaseType, scheduledFor: scheduledFor || undefined, isPublic }) });
      if (!res.ok) { const d = await res.json().catch(() => ({})); setError(d.error || "Failed"); return; }
      onCreated();
    } finally { setSaving(false); }
  }
  return <Modal title="New release" onClose={onClose}><Row label="Version"><input autoFocus value={version} onChange={(e) => setVersion(e.target.value)} placeholder="v2024.11.3" className="i font-mono text-xs" /></Row><Row label="Name"><input value={name} onChange={(e) => setName(e.target.value)} placeholder="Payments rollup" className="i" /></Row><div className="grid grid-cols-2 gap-3"><Row label="Type"><select value={releaseType} onChange={(e) => setReleaseType(e.target.value)} className="i"><option>Major</option><option>Minor</option><option>Patch</option><option>Hotfix</option></select></Row><Row label="Scheduled for"><input type="date" value={scheduledFor} onChange={(e) => setScheduledFor(e.target.value)} className="i" /></Row></div><label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={isPublic} onChange={(e) => setIsPublic(e.target.checked)} /> Show on public changelog</label>{error && <p className="text-xs text-rose-600">{error}</p>}<Actions onClose={onClose} onSubmit={submit} saving={saving} disabled={!version.trim()} /></Modal>;
}

function RoadmapModal({ onClose, onCreated }: { onClose: () => void; onCreated: () => void }) {
  const [title, setTitle] = useState(""); const [description, setDescription] = useState(""); const [theme, setTheme] = useState(""); const [priority, setPriority] = useState("P2"); const [quarter, setQuarter] = useState(""); const [impactScore, setImpactScore] = useState(""); const [effortPoints, setEffortPoints] = useState(""); const [publicVisible, setPublicVisible] = useState(false); const [saving, setSaving] = useState(false);
  async function submit() {
    if (!title.trim()) return; setSaving(true);
    try {
      await fetch("/api/dev/roadmap", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ title, description, theme, priority, quarter, impactScore: impactScore ? parseInt(impactScore) : undefined, effortPoints: effortPoints ? parseInt(effortPoints) : undefined, publicVisible }) });
      onCreated();
    } finally { setSaving(false); }
  }
  return <Modal title="New roadmap item" onClose={onClose}><Row label="Title"><input autoFocus value={title} onChange={(e) => setTitle(e.target.value)} className="i" /></Row><Row label="Description"><textarea value={description} onChange={(e) => setDescription(e.target.value)} rows={3} className="i" /></Row><div className="grid grid-cols-2 gap-3"><Row label="Theme"><input value={theme} onChange={(e) => setTheme(e.target.value)} placeholder="AI, Performance..." className="i" /></Row><Row label="Quarter"><input value={quarter} onChange={(e) => setQuarter(e.target.value)} placeholder="2025-Q1" className="i" /></Row></div><div className="grid grid-cols-3 gap-3"><Row label="Priority"><select value={priority} onChange={(e) => setPriority(e.target.value)} className="i"><option>P0</option><option>P1</option><option>P2</option><option>P3</option></select></Row><Row label="Impact (1-10)"><input type="number" min="1" max="10" value={impactScore} onChange={(e) => setImpactScore(e.target.value)} className="i" /></Row><Row label="Effort (pts)"><input type="number" value={effortPoints} onChange={(e) => setEffortPoints(e.target.value)} className="i" /></Row></div><label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={publicVisible} onChange={(e) => setPublicVisible(e.target.checked)} /> Visible on public roadmap</label><Actions onClose={onClose} onSubmit={submit} saving={saving} disabled={!title.trim()} /></Modal>;
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
      <button type="button" onClick={onSubmit} disabled={saving || disabled} className="px-4 py-2 rounded-lg text-sm font-medium bg-violet-600 hover:bg-violet-700 text-white disabled:opacity-50 inline-flex items-center gap-1.5">{saving ? "Saving…" : (<><Zap size={12} /> Create</>)}</button>
    </div>
  );
}
