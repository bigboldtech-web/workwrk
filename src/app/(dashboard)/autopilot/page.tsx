"use client";

// Autopilot — Phase D5. Manage event-driven AUTOMATION workflows
// (distinct from approval-chain Workflows in /studio). Lists all
// active rules + recent runs + a create modal that builds a rule
// from trigger + condition + ordered actions.

import { useCallback, useEffect, useState } from "react";
import {
  Zap,
  Plus,
  X,
  ToggleLeft,
  ToggleRight,
  Trash2,
  CheckCircle2,
  AlertCircle,
  Clock,
  ChevronDown,
  ChevronRight,
} from "lucide-react";

type Workflow = {
  id: string;
  name: string;
  triggerEvent: string | null;
  active: boolean;
  conditions: Record<string, unknown>;
  steps: ActionStep[];
  createdAt: string;
  updatedAt: string;
};

type ActionStep = { type: string; config?: Record<string, unknown> };

type Run = {
  id: string;
  workflowId: string;
  entityType: string;
  entityId: string;
  status: string;
  decisions: { step: number; action: string; ok: boolean; result?: unknown; error?: string; at: string }[];
  startedAt: string;
  completedAt: string | null;
  workflow: { name: string; triggerEvent: string | null };
};

const TRIGGER_OPTIONS = [
  { value: "lead.created", label: "Lead created", domain: "CRM" },
  { value: "opportunity.stage_changed", label: "Opportunity stage changed", domain: "CRM" },
  { value: "opportunity.won", label: "Opportunity won 🎉", domain: "CRM" },
  { value: "opportunity.lost", label: "Opportunity lost", domain: "CRM" },
  { value: "ticket.created", label: "ITSM ticket created", domain: "ITSM" },
  { value: "support_ticket.created", label: "Helpdesk ticket created", domain: "Helpdesk" },
];

const ACTION_TYPES = [
  { value: "notify", label: "Notify a user", fields: ["toUserEmail", "title", "message", "link"] },
  { value: "create_task", label: "Create a task", fields: ["title", "description", "priority"] },
  { value: "log", label: "Log (no-op for debug)", fields: [] },
];

const CONDITION_OPS = [
  { value: "eq", label: "equals" },
  { value: "ne", label: "does not equal" },
  { value: "contains", label: "contains" },
  { value: "in", label: "is one of" },
  { value: "gt", label: ">" },
  { value: "lt", label: "<" },
];

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

export default function AutopilotPage() {
  const [workflows, setWorkflows] = useState<Workflow[]>([]);
  const [runs, setRuns] = useState<Run[]>([]);
  const [loading, setLoading] = useState(true);
  const [showNew, setShowNew] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/autopilot/workflows");
      if (!res.ok) return;
      const data = await res.json();
      setWorkflows(data.workflows ?? []);
      setRuns(data.recentRuns ?? []);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { refresh(); }, [refresh]);

  async function toggleActive(wf: Workflow) {
    setBusyId(wf.id);
    try {
      await fetch(`/api/autopilot/workflows/${wf.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ active: !wf.active }),
      });
      await refresh();
    } finally { setBusyId(null); }
  }

  async function deleteWf(wf: Workflow) {
    if (!confirm(`Delete "${wf.name}"? Past runs will be removed.`)) return;
    setBusyId(wf.id);
    try {
      await fetch(`/api/autopilot/workflows/${wf.id}`, { method: "DELETE" });
      await refresh();
    } finally { setBusyId(null); }
  }

  const succeeded = runs.filter((r) => r.status === "COMPLETED").length;
  const failed = runs.filter((r) => r.status === "FAILED").length;

  return (
    <div className="p-6 max-w-[1400px] mx-auto">
      <div className="flex items-start justify-between mb-6">
        <div>
          <div className="inline-flex items-center gap-2 px-2 py-0.5 rounded-full bg-amber-100 dark:bg-amber-900/40 text-amber-700 dark:text-amber-300 text-xs font-medium mb-3">
            <Zap size={12} />
            Autopilot
          </div>
          <h1 className="text-2xl font-semibold mb-1">Automation rules</h1>
          <p className="text-sm text-muted">Event → Conditions → Actions. When something happens, do something.</p>
        </div>
        <button
          type="button"
          onClick={() => setShowNew(true)}
          className="inline-flex items-center gap-2 px-4 py-2 rounded-xl bg-amber-600 hover:bg-amber-700 text-white text-sm font-medium"
        >
          <Plus size={14} />
          New rule
        </button>
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-6">
        <Kpi label="Active rules" value={workflows.filter((w) => w.active).length.toString()} />
        <Kpi label="Total rules" value={workflows.length.toString()} />
        <Kpi label="Recent runs succeeded" value={succeeded.toString()} />
        <Kpi label="Recent runs failed" value={failed.toString()} tone={failed > 0 ? "rose" : undefined} />
      </div>

      <section className="mb-10">
        <h2 className="text-sm font-semibold uppercase tracking-wider text-muted-2 mb-3">Rules</h2>
        {loading ? <Loading /> : workflows.length === 0 ? (
          <Empty Icon={Zap} title="No automation rules yet" hint="Set up a rule like 'When a lead is created with source=referral, notify our head of sales'." onAction={() => setShowNew(true)} actionLabel="Create first rule" />
        ) : (
          <div className="space-y-2">
            {workflows.map((w) => (
              <WorkflowRow key={w.id} wf={w} busy={busyId === w.id} onToggle={() => toggleActive(w)} onDelete={() => deleteWf(w)} />
            ))}
          </div>
        )}
      </section>

      <section>
        <h2 className="text-sm font-semibold uppercase tracking-wider text-muted-2 mb-3">Recent runs</h2>
        {runs.length === 0 ? (
          <div className="rounded-xl border border-border bg-surface p-6 text-center text-sm text-muted">
            No runs yet. Rules fire when their trigger events occur.
          </div>
        ) : (
          <div className="rounded-xl border border-border bg-surface overflow-hidden divide-y divide-border">
            {runs.map((r) => <RunRow key={r.id} run={r} />)}
          </div>
        )}
      </section>

      {showNew && <NewRuleModal onClose={() => setShowNew(false)} onCreated={() => { setShowNew(false); refresh(); }} />}
    </div>
  );
}

function Kpi({ label, value, tone }: { label: string; value: string; tone?: "rose" | "amber" }) {
  const bg = tone === "rose" ? "bg-rose-50 dark:bg-rose-950/30" : tone === "amber" ? "bg-amber-50 dark:bg-amber-950/30" : "bg-surface";
  return <div className={`rounded-xl border border-border p-3 ${bg}`}><div className="text-[11px] uppercase tracking-wider text-muted-2 mb-1">{label}</div><div className="text-lg font-semibold">{value}</div></div>;
}

function Loading() { return <div className="text-sm text-muted py-20 text-center">Loading…</div>; }

function Empty({ Icon, title, hint, onAction, actionLabel }: { Icon: typeof Zap; title: string; hint: string; onAction: () => void; actionLabel: string }) {
  return (
    <div className="rounded-xl border border-dashed border-border bg-surface text-center py-12">
      <Icon size={36} className="mx-auto mb-3 text-muted-2" />
      <p className="font-medium mb-1">{title}</p>
      <p className="text-sm text-muted mb-4 max-w-md mx-auto">{hint}</p>
      <button type="button" onClick={onAction} className="inline-flex items-center gap-2 px-4 py-2 rounded-xl bg-amber-600 hover:bg-amber-700 text-white text-sm font-medium"><Plus size={14} /> {actionLabel}</button>
    </div>
  );
}

function WorkflowRow({ wf, busy, onToggle, onDelete }: { wf: Workflow; busy: boolean; onToggle: () => void; onDelete: () => void }) {
  return (
    <div className="rounded-xl border border-border bg-surface p-4 flex items-center gap-3">
      <button
        type="button"
        onClick={onToggle}
        disabled={busy}
        className={"flex-shrink-0 " + (wf.active ? "text-emerald-600" : "text-muted-2 hover:text-muted")}
        title={wf.active ? "Deactivate" : "Activate"}
      >
        {wf.active ? <ToggleRight size={28} /> : <ToggleLeft size={28} />}
      </button>
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 mb-1">
          <span className="font-medium text-sm">{wf.name}</span>
          {!wf.active && <span className="text-[10px] uppercase tracking-wider text-muted-2 font-medium">paused</span>}
        </div>
        <div className="text-xs text-muted-2 inline-flex items-center gap-1.5">
          <span className="font-mono">{wf.triggerEvent}</span>
          <ChevronRight size={11} />
          <span>{wf.steps.length} action{wf.steps.length === 1 ? "" : "s"}: {wf.steps.map((s) => s.type).join(" → ")}</span>
        </div>
      </div>
      <button
        type="button"
        onClick={onDelete}
        disabled={busy}
        className="p-2 rounded text-muted-2 hover:text-rose-600 hover:bg-rose-50 dark:hover:bg-rose-950/40 disabled:opacity-50"
        aria-label="Delete"
      >
        <Trash2 size={14} />
      </button>
    </div>
  );
}

function RunRow({ run }: { run: Run }) {
  const [open, setOpen] = useState(false);
  const ok = run.status === "COMPLETED";
  return (
    <div className="px-4 py-3">
      <button type="button" onClick={() => setOpen((v) => !v)} className="w-full flex items-center gap-3 text-left">
        {ok ? <CheckCircle2 size={14} className="text-emerald-600 flex-shrink-0" /> : run.status === "FAILED" ? <AlertCircle size={14} className="text-rose-600 flex-shrink-0" /> : <Clock size={14} className="text-amber-600 flex-shrink-0" />}
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-0.5">
            <span className="font-medium text-sm">{run.workflow.name}</span>
            <span className="font-mono text-[10px] text-muted-2">{run.workflow.triggerEvent}</span>
          </div>
          <div className="text-xs text-muted-2">
            {run.entityType} {run.entityId.slice(0, 8)}… · {timeAgo(run.startedAt)} · {run.decisions.length} step{run.decisions.length === 1 ? "" : "s"}
          </div>
        </div>
        {open ? <ChevronDown size={12} className="text-muted-2" /> : <ChevronRight size={12} className="text-muted-2" />}
      </button>
      {open && (
        <div className="mt-2 pl-7 space-y-1">
          {run.decisions.map((d, i) => (
            <div key={i} className={`text-xs px-2 py-1 rounded ${d.ok ? "bg-emerald-50 dark:bg-emerald-950/30 text-emerald-700 dark:text-emerald-300" : "bg-rose-50 dark:bg-rose-950/30 text-rose-700 dark:text-rose-300"}`}>
              <span className="font-mono text-[10px] mr-2">#{d.step + 1} {d.action}</span>
              {d.ok ? <span className="text-[11px]">{JSON.stringify(d.result).slice(0, 100)}</span> : <span className="text-[11px]">{d.error}</span>}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function NewRuleModal({ onClose, onCreated }: { onClose: () => void; onCreated: () => void }) {
  const [name, setName] = useState("");
  const [triggerEvent, setTriggerEvent] = useState("lead.created");
  const [condField, setCondField] = useState("");
  const [condOp, setCondOp] = useState("eq");
  const [condValue, setCondValue] = useState("");
  const [steps, setSteps] = useState<ActionStep[]>([{ type: "notify", config: { title: "{{firstName}} just came in", message: "Lead from {{source}}" } }]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function updateStep(i: number, patch: Partial<ActionStep>) {
    setSteps((prev) => prev.map((s, idx) => idx === i ? { ...s, ...patch } : s));
  }
  function updateStepConfig(i: number, key: string, value: string) {
    setSteps((prev) => prev.map((s, idx) => idx === i ? { ...s, config: { ...(s.config ?? {}), [key]: value } } : s));
  }

  async function submit() {
    if (!name.trim() || steps.length === 0) return;
    setSaving(true); setError(null);
    try {
      const conditions = condField
        ? { field: condField, op: condOp, value: condOp === "in" ? condValue.split(",").map((s) => s.trim()) : condValue }
        : {};
      const res = await fetch("/api/autopilot/workflows", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, triggerEvent, conditions, steps }),
      });
      const data = await res.json();
      if (!res.ok) { setError(data.error ?? "Save failed"); return; }
      onCreated();
    } finally { setSaving(false); }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40" onClick={onClose}>
      <div className="w-full max-w-2xl rounded-2xl bg-surface border border-border shadow-xl p-6 space-y-4 max-h-[90vh] overflow-y-auto" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-semibold">New automation rule</h2>
          <button type="button" onClick={onClose} className="p-1 rounded hover:bg-surface-2 text-muted"><X size={16} /></button>
        </div>

        <div>
          <label className="block text-xs font-medium text-muted-2 mb-1">Rule name</label>
          <input autoFocus value={name} onChange={(e) => setName(e.target.value)} placeholder="Notify sales on referral leads" className="w-full px-3 py-2 rounded-lg border border-border bg-surface text-sm" />
        </div>

        <div>
          <label className="block text-xs font-medium text-muted-2 mb-1">When this happens</label>
          <select value={triggerEvent} onChange={(e) => setTriggerEvent(e.target.value)} className="w-full px-3 py-2 rounded-lg border border-border bg-surface text-sm">
            {TRIGGER_OPTIONS.map((t) => <option key={t.value} value={t.value}>{t.label} ({t.domain})</option>)}
          </select>
        </div>

        <div>
          <label className="block text-xs font-medium text-muted-2 mb-1">Condition <span className="text-muted-2 font-normal">(optional — leave blank to always fire)</span></label>
          <div className="grid grid-cols-[1fr_120px_1fr] gap-2">
            <input value={condField} onChange={(e) => setCondField(e.target.value)} placeholder="field (e.g. source)" className="px-3 py-2 rounded-lg border border-border bg-surface text-sm" />
            <select value={condOp} onChange={(e) => setCondOp(e.target.value)} className="px-3 py-2 rounded-lg border border-border bg-surface text-sm">
              {CONDITION_OPS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
            </select>
            <input value={condValue} onChange={(e) => setCondValue(e.target.value)} placeholder="value (comma-separated for 'is one of')" className="px-3 py-2 rounded-lg border border-border bg-surface text-sm" />
          </div>
        </div>

        <div>
          <div className="flex items-center justify-between mb-2">
            <label className="block text-xs font-medium text-muted-2">Then do these (in order)</label>
            <button type="button" onClick={() => setSteps((s) => [...s, { type: "notify", config: {} }])} className="text-xs text-amber-700 hover:text-amber-800 inline-flex items-center gap-1"><Plus size={11} /> Add action</button>
          </div>
          <div className="space-y-3">
            {steps.map((step, i) => {
              const meta = ACTION_TYPES.find((a) => a.value === step.type);
              return (
                <div key={i} className="rounded-lg border border-border bg-surface-2 p-3 space-y-2">
                  <div className="flex items-center gap-2">
                    <span className="text-[10px] font-mono text-muted-2">#{i + 1}</span>
                    <select value={step.type} onChange={(e) => updateStep(i, { type: e.target.value })} className="flex-1 px-2 py-1 rounded border border-border bg-surface text-sm">
                      {ACTION_TYPES.map((a) => <option key={a.value} value={a.value}>{a.label}</option>)}
                    </select>
                    <button type="button" onClick={() => setSteps((s) => s.filter((_, idx) => idx !== i))} className="p-1 text-muted-2 hover:text-rose-600" disabled={steps.length === 1}><X size={12} /></button>
                  </div>
                  {meta?.fields.map((field) => (
                    <input
                      key={field}
                      value={String(step.config?.[field] ?? "")}
                      onChange={(e) => updateStepConfig(i, field, e.target.value)}
                      placeholder={field}
                      className="w-full px-2 py-1 rounded border border-border bg-surface text-xs font-mono"
                    />
                  ))}
                </div>
              );
            })}
          </div>
          <p className="text-[10px] text-muted-2 mt-1">Use <code className="text-[10px]">{`{{field}}`}</code> in title/message/description to interpolate the payload.</p>
        </div>

        {error && <p className="text-xs text-rose-600">{error}</p>}

        <div className="flex items-center justify-end gap-2 pt-2 border-t border-border">
          <button type="button" onClick={onClose} className="px-3 py-2 rounded-lg text-sm text-muted hover:bg-surface-2">Cancel</button>
          <button type="button" onClick={submit} disabled={saving || !name.trim()} className="px-4 py-2 rounded-lg text-sm font-medium bg-amber-600 hover:bg-amber-700 text-white disabled:opacity-50 inline-flex items-center gap-1.5">
            {saving ? "Saving…" : (<><Zap size={12} /> Create rule</>)}
          </button>
        </div>
      </div>
    </div>
  );
}
