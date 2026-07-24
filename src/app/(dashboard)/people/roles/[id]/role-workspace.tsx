"use client";

// RoleWorkspace — the interactive body of the Role Definition page. Overview
// (identity · ownership boundary · KRAs · KPIs · SOPs · thresholds) + Instances
// (Role × Scope). All mutations hit the generic operating-core APIs and then
// router.refresh() to re-pull the server bundle (config surface, low frequency —
// correctness over optimism). Reuses the app's design-system primitives.

import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import {
  LayoutDashboard, GitBranch, Plus, Trash2, X, Check, ShieldCheck, HandHelping, Ban,
  Target, FileText, Gauge, Users as UsersIcon, Loader2, Sparkles,
} from "lucide-react";
import { ViewTabStrip, ViewTab } from "@/components/ui/view-tabs";
import { KraPicker } from "@/components/ui/kra-picker";
import { useOsToast } from "@/components/layout/os/toast";

// ─────────────────────────── types ───────────────────────────
type Person = { id: string; firstName: string | null; lastName: string | null; email: string; avatar: string | null };
type Kpi = {
  id: string; name: string; description: string | null; unit: string | null; frequency: string; type: string;
  ownership: string; formula: string | null; baselineValue: number | null; baselineLabel: string | null;
  targetValue: number | null; targetLabel: string | null; lowerIsBetter: boolean;
};
type Kra = { id: string; name: string; category: string | null; kpis: Kpi[]; sops: { id: string; title: string; status: string }[] };
type Area = { id: string; name: string; ownerRole: { id: string; title: string } | null };
type Boundary = { id: string; relation: string; area: { id: string; name: string; ownerRole: { id: string; title: string } | null } };
type Threshold = { id: string; label: string; trigger: string; value: number; unit: string | null; businessHoursOnly: boolean };
type Instance = { id: string; name: string | null; status: string; scope: { id: string; name: string; dimension: string } | null; user: Person | null };

export interface RoleBundle {
  role: { id: string; title: string; description: string | null; level: string; department: { id: string; name: string } | null };
  kras: Kra[];
  ownedAreas: { id: string; name: string; description: string | null }[];
  boundaries: Boundary[];
  thresholds: Threshold[];
  instances: Instance[];
  people: Person[];
  allAreas: Area[];
  allRoles: { id: string; title: string }[];
  allKras: { id: string; name: string; category: string | null }[];
  scopes: { id: string; name: string; dimension: string }[];
  orgUsers: Person[];
}

const personName = (p: Person | null) => p ? ([p.firstName, p.lastName].filter(Boolean).join(" ").trim() || p.email) : "Unassigned";
const initials = (p: Person) => ([p.firstName?.[0], p.lastName?.[0]].filter(Boolean).join("") || p.email[0] || "?").toUpperCase();

export function RoleWorkspace({ bundle, canEdit, view }: { bundle: RoleBundle; canEdit: boolean; view: "overview" | "instances" }) {
  const roleId = bundle.role.id;
  return (
    <>
      <ViewTabStrip className="px-6">
        <ViewTab icon={LayoutDashboard} iconTileColor="#6366F1" label="Overview" active={view === "overview"} href={`/people/roles/${roleId}`} />
        <ViewTab icon={UsersIcon} iconTileColor="#0073EA" label="Instances" trailing={bundle.instances.length ? <span className="text-[10px] text-zinc-400">{bundle.instances.length}</span> : undefined} active={view === "instances"} href={`/people/roles/${roleId}?view=instances`} />
      </ViewTabStrip>

      <div className="flex-1 overflow-y-auto px-6 py-4">
        {view === "overview" ? (
          <div className="max-w-5xl space-y-4">
            <IdentityCard bundle={bundle} canEdit={canEdit} />
            <BoundaryCard bundle={bundle} canEdit={canEdit} />
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 items-start">
              <KraCard bundle={bundle} canEdit={canEdit} />
              <ThresholdsCard bundle={bundle} canEdit={canEdit} />
            </div>
            <KpiCard bundle={bundle} canEdit={canEdit} />
            <SopCard bundle={bundle} />
          </div>
        ) : (
          <div className="max-w-5xl">
            <InstancesPanel bundle={bundle} canEdit={canEdit} />
          </div>
        )}
      </div>
    </>
  );
}

// ─────────────────────────── shared bits ───────────────────────────
function Card({ title, icon: Icon, action, children }: { title: string; icon?: React.ComponentType<{ className?: string }>; action?: React.ReactNode; children: React.ReactNode }) {
  return (
    <section className="rounded-xl border border-zinc-200 bg-white p-4">
      <div className="flex items-center justify-between mb-3">
        <h2 className="text-sm font-semibold text-zinc-900 flex items-center gap-1.5">
          {Icon ? <Icon className="w-4 h-4 text-zinc-400" /> : null}
          {title}
        </h2>
        {action}
      </div>
      {children}
    </section>
  );
}

function useApi() {
  const router = useRouter();
  const { toast } = useOsToast();
  const [busy, setBusy] = useState(false);
  const call = async (url: string, method: string, body?: unknown): Promise<boolean> => {
    setBusy(true);
    try {
      const res = await fetch(url, { method, headers: { "content-type": "application/json" }, body: body ? JSON.stringify(body) : undefined });
      if (!res.ok) {
        const d = await res.json().catch(() => ({}));
        toast(d?.error ?? "Something went wrong");
        return false;
      }
      router.refresh();
      return true;
    } catch {
      toast("Network error");
      return false;
    } finally { setBusy(false); }
  };
  return { call, busy };
}

// ─────────────────────────── Identity ───────────────────────────
function IdentityCard({ bundle, canEdit }: { bundle: RoleBundle; canEdit: boolean }) {
  const { call, busy } = useApi();
  const [mission, setMission] = useState(bundle.role.description ?? "");
  const dirty = mission.trim() !== (bundle.role.description ?? "").trim();
  return (
    <Card title="Identity & scope">
      <div className="space-y-3">
        <Field label="Mission">
          {canEdit ? (
            <div className="flex items-start gap-2">
              <textarea
                value={mission}
                onChange={(e) => setMission(e.target.value)}
                rows={2}
                placeholder="One line: what this role must ensure…"
                className="flex-1 text-[13px] rounded-md border border-zinc-200 px-2.5 py-1.5 resize-y focus:outline-none focus:border-[var(--os-brand)]"
              />
              {dirty ? (
                <button type="button" disabled={busy} onClick={() => call(`/api/roles/${bundle.role.id}`, "PUT", { description: mission.trim() })}
                  className="h-7 px-2.5 rounded-md text-[12px] font-medium text-white bg-[var(--os-brand)] hover:bg-[var(--os-brand-hover)] disabled:opacity-50 shrink-0">Save</button>
              ) : null}
            </div>
          ) : (
            <span className="text-[13px] text-zinc-700">{mission || <span className="text-zinc-400">Not set</span>}</span>
          )}
        </Field>
        <Field label="Function"><span className="text-[13px] text-zinc-700">{bundle.role.department?.name ?? <span className="text-zinc-400">Unassigned</span>}</span></Field>
        <Field label="Level"><span className="text-[12px] font-medium text-zinc-600 px-1.5 py-0.5 rounded bg-zinc-100 uppercase tracking-wide">{bundle.role.level}</span></Field>
        <Field label="People"><span className="text-[13px] text-zinc-700">{bundle.people.length} in this role</span></Field>
      </div>
    </Card>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-baseline gap-3">
      <span className="text-xs text-zinc-500 w-[88px] shrink-0">{label}</span>
      <div className="flex-1 min-w-0">{children}</div>
    </div>
  );
}

// ─────────────────────────── Ownership Boundary ───────────────────────────
function BoundaryCard({ bundle, canEdit }: { bundle: RoleBundle; canEdit: boolean }) {
  const { call, busy } = useApi();
  const { toast } = useOsToast();
  const roleId = bundle.role.id;
  const [newArea, setNewArea] = useState("");
  const [addOpen, setAddOpen] = useState<null | "CAN_REQUEST" | "CANNOT_TOUCH">(null);

  const canRequest = bundle.boundaries.filter((b) => b.relation === "CAN_REQUEST");
  const cannotTouch = bundle.boundaries.filter((b) => b.relation === "CANNOT_TOUCH");
  const boundedAreaIds = new Set(bundle.boundaries.map((b) => b.area.id));
  const assignable = bundle.allAreas.filter((a) => a.ownerRole?.id !== roleId && !boundedAreaIds.has(a.id));

  const addOwnedArea = async () => {
    const name = newArea.trim();
    if (!name) return;
    if (await call("/api/ownership-areas", "POST", { name, ownerRoleId: roleId })) setNewArea("");
  };
  const raiseRequest = (b: Boundary) => {
    toast(`Logged: request to ${b.area.ownerRole?.title ?? "owner"} for “${b.area.name}”`);
    // Phase 2 routes this to a tracked work item; Phase 1 confirms the owner.
  };

  return (
    <Card title="Ownership boundary" icon={GitBranch}>
      <p className="text-[11.5px] text-zinc-400 mb-3 -mt-1">One concept, one owner, one place. A request is raised to the owner, never edited directly.</p>
      <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
        {/* Owns */}
        <BoundaryColumn tone="#16a34a" icon={ShieldCheck} label="Owns">
          {bundle.ownedAreas.length === 0 ? <Empty>Nothing owned yet</Empty> : bundle.ownedAreas.map((a) => (
            <li key={a.id} className="flex items-center gap-1.5 px-2 py-1.5 rounded-md bg-emerald-50/60 text-[12.5px] text-zinc-800">
              <span className="flex-1 truncate" title={a.name}>{a.name}</span>
            </li>
          ))}
          {canEdit ? (
            <li className="flex items-center gap-1.5 px-1 pt-1">
              <input value={newArea} onChange={(e) => setNewArea(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); void addOwnedArea(); } }}
                placeholder="Add an owned area…" className="flex-1 text-[12px] bg-transparent outline-none placeholder:text-zinc-400" />
              {newArea.trim() ? <button type="button" disabled={busy} onClick={addOwnedArea} className="text-[var(--os-brand)]"><Check className="w-3.5 h-3.5" /></button> : null}
            </li>
          ) : null}
        </BoundaryColumn>

        {/* Can request */}
        <BoundaryColumn tone="#0073EA" icon={HandHelping} label="Can request" onAdd={canEdit && assignable.length ? () => setAddOpen("CAN_REQUEST") : undefined}>
          {canRequest.length === 0 ? <Empty>None</Empty> : canRequest.map((b) => (
            <BoundaryRow key={b.id} b={b} canEdit={canEdit} busy={busy} onRemove={() => call(`/api/role-boundaries/${b.id}`, "DELETE")} onRequest={() => raiseRequest(b)} />
          ))}
        </BoundaryColumn>

        {/* Cannot touch */}
        <BoundaryColumn tone="#dc2626" icon={Ban} label="Cannot touch" onAdd={canEdit && assignable.length ? () => setAddOpen("CANNOT_TOUCH") : undefined}>
          {cannotTouch.length === 0 ? <Empty>None</Empty> : cannotTouch.map((b) => (
            <BoundaryRow key={b.id} b={b} canEdit={canEdit} busy={busy} onRemove={() => call(`/api/role-boundaries/${b.id}`, "DELETE")} />
          ))}
        </BoundaryColumn>
      </div>

      {addOpen ? (
        <AddBoundary areas={assignable} relation={addOpen} busy={busy} onClose={() => setAddOpen(null)}
          onPick={async (areaId) => { if (await call("/api/role-boundaries", "POST", { roleId, areaId, relation: addOpen })) setAddOpen(null); }} />
      ) : null}
    </Card>
  );
}

function BoundaryColumn({ tone, icon: Icon, label, onAdd, children }: { tone: string; icon: React.ComponentType<{ className?: string }>; label: string; onAdd?: () => void; children: React.ReactNode }) {
  return (
    <div className="rounded-lg border border-zinc-200 overflow-hidden">
      <div className="flex items-center justify-between px-2.5 py-1.5 border-b border-zinc-100" style={{ background: `${tone}0d` }}>
        <span className="inline-flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wide" style={{ color: tone }}><Icon className="w-3.5 h-3.5" />{label}</span>
        {onAdd ? <button type="button" onClick={onAdd} className="text-zinc-400 hover:text-zinc-700"><Plus className="w-3.5 h-3.5" /></button> : null}
      </div>
      <ul className="p-1.5 space-y-0.5 min-h-[40px]">{children}</ul>
    </div>
  );
}

function BoundaryRow({ b, canEdit, busy, onRemove, onRequest }: { b: Boundary; canEdit: boolean; busy: boolean; onRemove: () => void; onRequest?: () => void }) {
  return (
    <li className="group/br flex items-center gap-1.5 px-2 py-1.5 rounded-md hover:bg-zinc-50 text-[12.5px] text-zinc-800">
      <span className="flex-1 min-w-0">
        <span className="block truncate" title={b.area.name}>{b.area.name}</span>
        {b.area.ownerRole ? <span className="block text-[10.5px] text-zinc-400 truncate">owner · {b.area.ownerRole.title}</span> : <span className="block text-[10.5px] text-amber-500">no owner set</span>}
      </span>
      {onRequest ? <button type="button" onClick={onRequest} title="Raise a request to the owner" className="opacity-0 group-hover/br:opacity-100 text-[11px] text-[var(--os-brand)] hover:underline">Request</button> : null}
      {canEdit ? <button type="button" disabled={busy} onClick={onRemove} className="opacity-0 group-hover/br:opacity-100 text-zinc-400 hover:text-red-500"><X className="w-3.5 h-3.5" /></button> : null}
    </li>
  );
}

function AddBoundary({ areas, relation, busy, onClose, onPick }: { areas: Area[]; relation: string; busy: boolean; onClose: () => void; onPick: (areaId: string) => void }) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4" onClick={onClose}>
      <div className="absolute inset-0 bg-black/30" />
      <div className="relative w-full max-w-sm bg-white rounded-xl border border-zinc-200 shadow-2xl p-4" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between mb-2">
          <h3 className="text-sm font-semibold text-zinc-900">{relation === "CAN_REQUEST" ? "Can request" : "Cannot touch"} — pick an area</h3>
          <button type="button" onClick={onClose} className="text-zinc-400 hover:text-zinc-700"><X className="w-4 h-4" /></button>
        </div>
        <ul className="max-h-[280px] overflow-y-auto -mx-1">
          {areas.map((a) => (
            <li key={a.id}>
              <button type="button" disabled={busy} onClick={() => onPick(a.id)} className="w-full flex items-center gap-2 px-2 py-1.5 rounded-md text-left text-[13px] hover:bg-zinc-50">
                <span className="flex-1 min-w-0"><span className="block truncate">{a.name}</span>{a.ownerRole ? <span className="block text-[10.5px] text-zinc-400">owner · {a.ownerRole.title}</span> : null}</span>
              </button>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}

function Empty({ children }: { children: React.ReactNode }) {
  return <li className="px-2 py-1.5 text-[11.5px] text-zinc-400">{children}</li>;
}

// ─────────────────────────── KRAs ───────────────────────────
function KraCard({ bundle, canEdit }: { bundle: RoleBundle; canEdit: boolean }) {
  const { call, busy } = useApi();
  const attachedIds = bundle.kras.map((k) => k.id);
  return (
    <Card title="KRAs" icon={Target} action={canEdit ? (
      <div className="w-[180px]"><KraPicker kras={bundle.allKras.map((k) => ({ id: k.id, name: k.name, category: k.category ?? undefined }))} value={null} excludeIds={attachedIds} placeholder="Attach a KRA" onChange={(kraId) => { if (kraId) call("/api/kras", "PATCH", { id: kraId, roleId: bundle.role.id }); }} /></div>
    ) : undefined}>
      {bundle.kras.length === 0 ? (
        <p className="text-[12.5px] text-zinc-400 py-2">No KRAs on this role yet.</p>
      ) : (
        <ul className="space-y-1">
          {bundle.kras.map((k) => (
            <li key={k.id} className="group/kra flex items-center gap-2 px-2 py-1.5 rounded-md hover:bg-zinc-50 text-[13px]">
              <Target className="w-3.5 h-3.5 text-zinc-400 shrink-0" />
              <span className="flex-1 min-w-0 truncate text-zinc-800" title={k.name}>{k.name}</span>
              <span className="text-[10.5px] text-zinc-400 shrink-0">{k.kpis.length} KPI{k.kpis.length === 1 ? "" : "s"}</span>
              {canEdit ? <button type="button" disabled={busy} onClick={() => call("/api/kras", "PATCH", { id: k.id, roleId: null })} className="opacity-0 group-hover/kra:opacity-100 text-zinc-400 hover:text-red-500 shrink-0"><X className="w-3.5 h-3.5" /></button> : null}
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}

// ─────────────────────────── KPIs (owned vs shared, baseline→target) ───────────────────────────
function KpiCard({ bundle, canEdit }: { bundle: RoleBundle; canEdit: boolean }) {
  const allKpis = bundle.kras.flatMap((k) => k.kpis.map((p) => ({ ...p, kraName: k.name })));
  const owned = allKpis.filter((p) => p.ownership !== "SHARED");
  const shared = allKpis.filter((p) => p.ownership === "SHARED");
  return (
    <Card title="KPIs" icon={Gauge}>
      {allKpis.length === 0 ? (
        <p className="text-[12.5px] text-zinc-400 py-2">No KPIs yet. Add KPIs under this role&rsquo;s KRAs.</p>
      ) : (
        <div className="space-y-4">
          <KpiGroup title="Owned" hint="controlled by this role — graded" tone="#0073EA" kpis={owned} canEdit={canEdit} />
          <KpiGroup title="Shared" hint="influenced — reviewed, not solely graded" tone="#a78b6c" kpis={shared} canEdit={canEdit} />
        </div>
      )}
    </Card>
  );
}

function KpiGroup({ title, hint, tone, kpis, canEdit }: { title: string; hint: string; tone: string; kpis: (Kpi & { kraName: string })[]; canEdit: boolean }) {
  if (kpis.length === 0) return null;
  return (
    <div>
      <div className="flex items-baseline gap-2 mb-1.5">
        <span className="text-[11px] font-semibold uppercase tracking-wide" style={{ color: tone }}>{title}</span>
        <span className="text-[11px] text-zinc-400">{hint}</span>
      </div>
      <div className="rounded-lg border border-zinc-200 overflow-hidden">
        <div className="grid grid-cols-[1fr_120px_120px_92px] items-center px-3 py-1.5 border-b border-zinc-100 text-[10.5px] uppercase tracking-wide text-zinc-500">
          <span>KPI</span><span>Baseline</span><span>Target</span><span>Ownership</span>
        </div>
        <ul>
          {kpis.map((p) => <KpiRow key={p.id} p={p} canEdit={canEdit} />)}
        </ul>
      </div>
    </div>
  );
}

function KpiRow({ p, canEdit }: { p: Kpi & { kraName: string }; canEdit: boolean }) {
  const { call, busy } = useApi();
  const [baseline, setBaseline] = useState(p.baselineValue?.toString() ?? "");
  const [target, setTarget] = useState(p.targetValue?.toString() ?? "");
  const saveNum = (field: "baselineValue" | "targetValue", raw: string) => {
    const v = raw.trim() === "" ? null : Number(raw);
    if (raw.trim() !== "" && !Number.isFinite(v)) return;
    const orig = field === "baselineValue" ? p.baselineValue : p.targetValue;
    if ((v ?? null) === (orig ?? null)) return;
    call("/api/kpis", "PATCH", { id: p.id, [field]: v });
  };
  return (
    <li className="grid grid-cols-[1fr_120px_120px_92px] items-center px-3 py-2 border-b border-zinc-100 last:border-b-0 text-[12.5px]">
      <span className="min-w-0">
        <span className="block truncate text-zinc-800" title={p.name}>{p.name}</span>
        <span className="block text-[10.5px] text-zinc-400 truncate">{p.kraName}{p.unit ? ` · ${p.unit}` : ""}{p.lowerIsBetter ? " · lower is better" : ""}</span>
      </span>
      <NumCell value={baseline} onChange={setBaseline} onCommit={() => saveNum("baselineValue", baseline)} canEdit={canEdit} placeholder="—" />
      <NumCell value={target} onChange={setTarget} onCommit={() => saveNum("targetValue", target)} canEdit={canEdit} placeholder="—" />
      <span>
        <button type="button" disabled={!canEdit || busy}
          onClick={() => call("/api/kpis", "PATCH", { id: p.id, ownership: p.ownership === "SHARED" ? "OWNED" : "SHARED" })}
          className="text-[10.5px] font-semibold px-1.5 py-0.5 rounded uppercase tracking-wide disabled:opacity-60"
          style={p.ownership === "SHARED" ? { background: "#a78b6c22", color: "#8e7165" } : { background: "#0073EA1a", color: "#0073EA" }}>
          {p.ownership === "SHARED" ? "Shared" : "Owned"}
        </button>
      </span>
    </li>
  );
}

function NumCell({ value, onChange, onCommit, canEdit, placeholder }: { value: string; onChange: (v: string) => void; onCommit: () => void; canEdit: boolean; placeholder?: string }) {
  if (!canEdit) return <span className="font-mono text-zinc-700">{value || placeholder}</span>;
  return (
    <input value={value} onChange={(e) => onChange(e.target.value)} onBlur={onCommit} onKeyDown={(e) => { if (e.key === "Enter") (e.target as HTMLInputElement).blur(); }}
      inputMode="decimal" placeholder={placeholder}
      className="w-[92px] font-mono text-[12.5px] rounded border border-transparent hover:border-zinc-200 focus:border-[var(--os-brand)] px-1.5 py-0.5 outline-none" />
  );
}

// ─────────────────────────── SOPs ───────────────────────────
function SopCard({ bundle }: { bundle: RoleBundle }) {
  const sops = bundle.kras.flatMap((k) => k.sops.map((s) => ({ ...s, kraName: k.name })));
  return (
    <Card title="SOPs" icon={FileText}>
      {sops.length === 0 ? (
        <p className="text-[12.5px] text-zinc-400 py-2">No SOPs linked to this role&rsquo;s KRAs.</p>
      ) : (
        <ul className="space-y-0.5">
          {sops.map((s) => (
            <li key={s.id}>
              <Link href={`/sops/${s.id}`} className="flex items-center gap-2 px-2 py-1.5 rounded-md hover:bg-zinc-50 text-[13px]">
                <FileText className="w-3.5 h-3.5 text-blue-400 shrink-0" />
                <span className="flex-1 min-w-0 truncate text-zinc-800">{s.title}</span>
                <span className="text-[10.5px] text-zinc-400 shrink-0">{s.kraName}</span>
                <span className="text-[10px] uppercase tracking-wide text-zinc-400 shrink-0">{s.status.toLowerCase()}</span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}

// ─────────────────────────── Thresholds ───────────────────────────
function ThresholdsCard({ bundle, canEdit }: { bundle: RoleBundle; canEdit: boolean }) {
  const { call, busy } = useApi();
  const [adding, setAdding] = useState(false);
  const [draft, setDraft] = useState({ label: "", trigger: "", value: "", unit: "min" });
  const submit = async () => {
    const value = Number(draft.value);
    if (!draft.label.trim() || !draft.trigger.trim() || !Number.isFinite(value)) return;
    if (await call("/api/thresholds", "POST", { roleId: bundle.role.id, label: draft.label.trim(), trigger: draft.trigger.trim(), value, unit: draft.unit.trim() || null })) {
      setDraft({ label: "", trigger: "", value: "", unit: "min" }); setAdding(false);
    }
  };
  return (
    <Card title="Escalation thresholds" icon={Gauge} action={canEdit && !adding ? <button type="button" onClick={() => setAdding(true)} className="text-zinc-400 hover:text-zinc-700"><Plus className="w-4 h-4" /></button> : undefined}>
      {bundle.thresholds.length === 0 && !adding ? (
        <p className="text-[12.5px] text-zinc-400 py-2">No thresholds. These drive automation (e.g. unclaimed → nudge @ 45 min).</p>
      ) : (
        <ul className="space-y-1">
          {bundle.thresholds.map((t) => (
            <li key={t.id} className="group/th flex items-center gap-2 px-2 py-1.5 rounded-md hover:bg-zinc-50 text-[12.5px]">
              <span className="flex-1 min-w-0">
                <span className="block truncate text-zinc-800">{t.label}</span>
                <span className="block text-[10.5px] text-zinc-400 truncate">{t.trigger}</span>
              </span>
              <span className="font-mono text-zinc-700 shrink-0">{t.value}{t.unit ? ` ${t.unit}` : ""}</span>
              {canEdit ? <button type="button" disabled={busy} onClick={() => call(`/api/thresholds/${t.id}`, "DELETE")} className="opacity-0 group-hover/th:opacity-100 text-zinc-400 hover:text-red-500 shrink-0"><Trash2 className="w-3.5 h-3.5" /></button> : null}
            </li>
          ))}
        </ul>
      )}
      {adding ? (
        <div className="mt-2 rounded-lg border border-zinc-200 p-2.5 space-y-1.5">
          <input autoFocus value={draft.label} onChange={(e) => setDraft({ ...draft, label: e.target.value })} placeholder="Label (e.g. Unclaimed → nudge)" className="w-full text-[12.5px] rounded border border-zinc-200 px-2 py-1 outline-none focus:border-[var(--os-brand)]" />
          <input value={draft.trigger} onChange={(e) => setDraft({ ...draft, trigger: e.target.value })} placeholder="Trigger (e.g. order unclaimed)" className="w-full text-[12.5px] rounded border border-zinc-200 px-2 py-1 outline-none focus:border-[var(--os-brand)]" />
          <div className="flex items-center gap-1.5">
            <input value={draft.value} onChange={(e) => setDraft({ ...draft, value: e.target.value })} inputMode="decimal" placeholder="45" className="w-20 text-[12.5px] font-mono rounded border border-zinc-200 px-2 py-1 outline-none focus:border-[var(--os-brand)]" />
            <input value={draft.unit} onChange={(e) => setDraft({ ...draft, unit: e.target.value })} placeholder="min" className="w-16 text-[12.5px] rounded border border-zinc-200 px-2 py-1 outline-none focus:border-[var(--os-brand)]" />
            <div className="flex-1" />
            <button type="button" onClick={() => setAdding(false)} className="h-7 px-2.5 rounded-md text-[12px] text-zinc-600 hover:bg-zinc-100">Cancel</button>
            <button type="button" disabled={busy} onClick={submit} className="h-7 px-2.5 rounded-md text-[12px] font-medium text-white bg-[var(--os-brand)] hover:bg-[var(--os-brand-hover)] disabled:opacity-50">Add</button>
          </div>
        </div>
      ) : null}
    </Card>
  );
}

// ─────────────────────────── Instances (Role × Scope) ───────────────────────────
function InstancesPanel({ bundle, canEdit }: { bundle: RoleBundle; canEdit: boolean }) {
  const { call, busy } = useApi();
  const { toast } = useOsToast();
  const [creating, setCreating] = useState(false);
  const [scopeId, setScopeId] = useState("");
  const [userId, setUserId] = useState("");
  const [newScope, setNewScope] = useState({ name: "", dimension: "pool" });
  const [seedingId, setSeedingId] = useState<string | null>(null);

  const createInstance = async () => {
    let sid = scopeId;
    if (sid === "__new__") {
      if (!newScope.name.trim()) { toast("Name the new scope"); return; }
      const res = await fetch("/api/scopes", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ name: newScope.name.trim(), dimension: newScope.dimension.trim() || "pool" }) });
      if (!res.ok) { toast("Couldn't create scope"); return; }
      const d = await res.json(); sid = d?.data?.id ?? d?.id;
    }
    if (await call("/api/role-instances", "POST", { roleId: bundle.role.id, scopeId: sid || null, userId: userId || null })) {
      setCreating(false); setScopeId(""); setUserId(""); setNewScope({ name: "", dimension: "pool" });
    }
  };

  const applyDefinition = async (inst: Instance) => {
    if (!inst.user) { toast("Assign a person to this instance first"); return; }
    setSeedingId(inst.id);
    try {
      const res = await fetch(`/api/users/${inst.user.id}/seed-alignment`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ roleId: bundle.role.id }) });
      const d = await res.json().catch(() => ({}));
      if (!res.ok) { toast(d?.error ?? "Couldn't apply"); return; }
      toast(`Applied ${bundle.role.title} to ${personName(inst.user)}`);
    } finally { setSeedingId(null); }
  };

  return (
    <Card title="Instances" icon={UsersIcon} action={canEdit && !creating ? <button type="button" onClick={() => setCreating(true)} className="inline-flex items-center gap-1 h-7 px-2.5 rounded-md text-[12px] font-medium text-white bg-[var(--os-brand)] hover:bg-[var(--os-brand-hover)]"><Plus className="w-3.5 h-3.5" />New instance</button> : undefined}>
      <p className="text-[11.5px] text-zinc-400 mb-3 -mt-1">Role × Scope, held by a person. Clone the definition per scope (Pool 1, Pool 2…) and compare.</p>

      {bundle.instances.length === 0 && !creating ? (
        <p className="text-[12.5px] text-zinc-400 py-2">No instances yet.</p>
      ) : (
        <ul className="space-y-1.5">
          {bundle.instances.map((i) => (
            <li key={i.id} className="group/inst flex items-center gap-3 px-3 py-2 rounded-lg border border-zinc-200 hover:bg-zinc-50">
              {i.user ? (
                <span className="w-7 h-7 rounded-full bg-zinc-200 text-zinc-600 text-[11px] font-medium inline-flex items-center justify-center shrink-0">{initials(i.user)}</span>
              ) : <span className="w-7 h-7 rounded-full bg-zinc-100 text-zinc-400 inline-flex items-center justify-center shrink-0"><UsersIcon className="w-3.5 h-3.5" /></span>}
              <span className="flex-1 min-w-0">
                <span className="block text-[13px] text-zinc-800 truncate">{i.name || `${bundle.role.title}${i.scope ? ` — ${i.scope.name}` : ""}`}</span>
                <span className="block text-[11px] text-zinc-400 truncate">{i.scope ? `${i.scope.dimension}: ${i.scope.name}` : "no scope"} · {personName(i.user)}</span>
              </span>
              {canEdit ? (
                <>
                  <button type="button" disabled={seedingId === i.id} onClick={() => applyDefinition(i)} className="inline-flex items-center gap-1 text-[11.5px] text-[var(--os-brand)] hover:underline shrink-0">
                    {seedingId === i.id ? <Loader2 className="w-3 h-3 animate-spin" /> : <Sparkles className="w-3 h-3" />}Apply definition
                  </button>
                  <button type="button" disabled={busy} onClick={() => call(`/api/role-instances/${i.id}`, "DELETE")} className="opacity-0 group-hover/inst:opacity-100 text-zinc-400 hover:text-red-500 shrink-0"><Trash2 className="w-3.5 h-3.5" /></button>
                </>
              ) : null}
            </li>
          ))}
        </ul>
      )}

      {creating ? (
        <div className="mt-3 rounded-lg border border-zinc-200 p-3 space-y-2">
          <div className="flex items-center gap-2">
            <span className="text-xs text-zinc-500 w-[64px]">Scope</span>
            <select value={scopeId} onChange={(e) => setScopeId(e.target.value)} className="flex-1 text-[13px] rounded-md border border-zinc-200 px-2 py-1.5 outline-none focus:border-[var(--os-brand)]">
              <option value="">No scope</option>
              {bundle.scopes.map((s) => <option key={s.id} value={s.id}>{s.dimension}: {s.name}</option>)}
              <option value="__new__">+ New scope…</option>
            </select>
          </div>
          {scopeId === "__new__" ? (
            <div className="flex items-center gap-2 pl-[72px]">
              <input value={newScope.name} onChange={(e) => setNewScope({ ...newScope, name: e.target.value })} placeholder="Scope name (e.g. Pool 1)" className="flex-1 text-[13px] rounded-md border border-zinc-200 px-2 py-1.5 outline-none focus:border-[var(--os-brand)]" />
              <input value={newScope.dimension} onChange={(e) => setNewScope({ ...newScope, dimension: e.target.value })} placeholder="dimension" className="w-28 text-[13px] rounded-md border border-zinc-200 px-2 py-1.5 outline-none focus:border-[var(--os-brand)]" />
            </div>
          ) : null}
          <div className="flex items-center gap-2">
            <span className="text-xs text-zinc-500 w-[64px]">Person</span>
            <select value={userId} onChange={(e) => setUserId(e.target.value)} className="flex-1 text-[13px] rounded-md border border-zinc-200 px-2 py-1.5 outline-none focus:border-[var(--os-brand)]">
              <option value="">Unassigned</option>
              {bundle.orgUsers.map((p) => <option key={p.id} value={p.id}>{personName(p)}</option>)}
            </select>
          </div>
          <div className="flex justify-end gap-1.5">
            <button type="button" onClick={() => setCreating(false)} className="h-7 px-2.5 rounded-md text-[12px] text-zinc-600 hover:bg-zinc-100">Cancel</button>
            <button type="button" disabled={busy} onClick={createInstance} className="h-7 px-2.5 rounded-md text-[12px] font-medium text-white bg-[var(--os-brand)] hover:bg-[var(--os-brand-hover)] disabled:opacity-50">Create instance</button>
          </div>
        </div>
      ) : null}
    </Card>
  );
}
