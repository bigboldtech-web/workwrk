"use client";

// RoleWorkspace — the interactive body of the Role Definition page. Overview
// (identity · ownership boundary · KRAs · KPIs · SOPs · thresholds) + Instances
// (Role × Scope). All mutations hit the generic operating-core APIs and then
// router.refresh() to re-pull the server bundle (config surface, low frequency —
// correctness over optimism). Reuses the app's design-system primitives.

import { Fragment, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import {
  LayoutDashboard, GitBranch, Plus, Trash2, X, Check, ShieldCheck, HandHelping, Ban,
  Target, FileText, Gauge, Users as UsersIcon, Loader2, Sparkles,
  MoreHorizontal, Star, TrendingUp, TrendingDown, MoveRight, Pencil, Unlink, ChevronDown,
  type LucideIcon,
} from "lucide-react";
import { ACCESS_LEVELS, labelForAccessLevel } from "@/lib/access-levels";
import { ViewTabStrip, ViewTab } from "@/components/ui/view-tabs";
import { KraPicker } from "@/components/ui/kra-picker";
import { useOsToast } from "@/components/layout/os/toast";
import { MorePortal } from "@/components/layout/os/more-portal";
import { MenuList, MenuItem, MenuSeparator } from "@/components/ui/menu";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { Avatar, AvatarImage, AvatarFallback } from "@/components/ui/avatar";
import { KraDialog } from "@/components/alignment/kra-dialog";
import { KpiDialog, type KpiDialogKpi } from "@/components/alignment/kpi-dialog";

// ─────────────────────────── types ───────────────────────────
type Person = { id: string; firstName: string | null; lastName: string | null; email: string; avatar: string | null };
/** A role holder + how many of the role's template KRAs they're missing. */
type Holder = Person & { missingKras: number };
type KpiDirection = "HIGHER" | "LOWER" | "MAINTAIN";
type Kpi = {
  id: string; name: string; description: string | null; unit: string | null; frequency: string; type: string;
  ownership: string; formula: string | null; baselineValue: number | null; baselineLabel: string | null;
  targetValue: number | null; targetLabel: string | null; lowerIsBetter: boolean;
  direction: KpiDirection | null; isNorthStar: boolean;
};
type Kra = { id: string; name: string; description: string | null; category: string | null; weight: number; kpis: Kpi[]; sops: { id: string; title: string; status: string }[] };
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
  people: Holder[];
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
        <ViewTab icon={LayoutDashboard} iconTileColor="#0073EA" label="Overview" active={view === "overview"} href={`/people/roles/${roleId}`} />
        <ViewTab icon={UsersIcon} iconTileColor="#0073EA" label="Instances" trailing={bundle.instances.length ? <span className="text-[10px] text-zinc-400">{bundle.instances.length}</span> : undefined} active={view === "instances"} href={`/people/roles/${roleId}?view=instances`} />
      </ViewTabStrip>

      <div className="flex-1 overflow-y-auto px-6 py-4">
        {view === "overview" ? (
          <div className="max-w-5xl mx-auto space-y-4">
            <IdentityCard bundle={bundle} canEdit={canEdit} />
            <AlignmentCard bundle={bundle} canEdit={canEdit} />
            <BoundaryCard bundle={bundle} canEdit={canEdit} />
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 items-start">
              <ThresholdsCard bundle={bundle} canEdit={canEdit} />
              <SopCard bundle={bundle} />
            </div>
          </div>
        ) : (
          <div className="max-w-5xl mx-auto">
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
  const router = useRouter();
  const { toast } = useOsToast();
  const [title, setTitle] = useState(bundle.role.title);
  const [mission, setMission] = useState(bundle.role.description ?? "");
  const [saveState, setSaveState] = useState<"idle" | "saving" | "saved">("idle");
  const [confirmDelete, setConfirmDelete] = useState(false);
  // Autosave reads refs, not state: the debounce timer holds the closure from
  // the render BEFORE the last keystroke, so state reads would save one
  // character behind ("sometimes it saves, sometimes it doesn't").
  const titleRef = useRef(bundle.role.title);
  const missionRef = useRef(bundle.role.description ?? "");
  const savedRef = useRef({ title: bundle.role.title, mission: bundle.role.description ?? "" });
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const flush = async () => {
    const nextTitle = titleRef.current.trim();
    const nextMission = missionRef.current.trim();
    if (nextTitle === savedRef.current.title.trim() && nextMission === savedRef.current.mission.trim()) return;
    if (!nextTitle) return; // never save a role into a blank title
    setSaveState("saving");
    try {
      const res = await fetch(`/api/roles/${bundle.role.id}`, {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ title: nextTitle, description: nextMission }),
      });
      if (!res.ok) {
        const d = await res.json().catch(() => ({}));
        toast(d?.error ?? "Couldn't save the role");
        setSaveState("idle");
        return;
      }
      savedRef.current = { title: nextTitle, mission: nextMission };
      setSaveState("saved");
      router.refresh();
    } catch { toast("Network error — change not saved"); setSaveState("idle"); }
  };
  const queueSave = () => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => void flush(), 700);
  };

  const holders = bundle.people.length;
  async function deleteRole() {
    const res = await fetch(`/api/roles/${bundle.role.id}`, { method: "DELETE" });
    if (res.ok) {
      toast("Role deleted");
      router.push("/people/roles");
      router.refresh();
    } else {
      const d = await res.json().catch(() => ({}));
      toast(d?.error ?? "Couldn't delete the role");
    }
    setConfirmDelete(false);
  }

  return (
    <Card
      title="Identity & scope"
      action={
        <div className="flex items-center gap-2">
          {canEdit && saveState !== "idle" ? (
            <span className="text-[11px] text-zinc-400">{saveState === "saving" ? "Saving…" : "Saved"}</span>
          ) : null}
          {canEdit ? (
            <button
              type="button"
              onClick={() => {
                if (holders > 0) { toast(`${holders} ${holders === 1 ? "person holds" : "people hold"} this role — reassign them first.`); return; }
                setConfirmDelete(true);
              }}
              className="inline-flex items-center gap-1 h-7 px-2 rounded-md text-[12px] text-zinc-400 hover:text-red-500 hover:bg-red-50"
            >
              <Trash2 className="w-3.5 h-3.5" /> Delete role
            </button>
          ) : null}
        </div>
      }
    >
      {confirmDelete ? (
        <ConfirmDialog
          open
          onClose={() => setConfirmDelete(false)}
          onConfirm={() => void deleteRole()}
          title={`Delete role "${bundle.role.title}"?`}
          description="Its KRA templates detach and stay in the library. Nobody holds this role, so no people are affected."
          confirmLabel="Delete role"
          destructive
        />
      ) : null}
      <div className="space-y-3">
        <Field label="Title">
          {canEdit ? (
            <input
              value={title}
              onChange={(e) => { setTitle(e.target.value); titleRef.current = e.target.value; queueSave(); }}
              onBlur={() => void flush()}
              placeholder="Job title"
              className="w-full text-[13px] rounded-md border border-zinc-200 px-2.5 py-1.5 focus:outline-none focus:border-[var(--os-brand)]"
            />
          ) : (
            <span className="text-[13px] text-zinc-700">{bundle.role.title}</span>
          )}
        </Field>
        <Field label="Mission">
          {canEdit ? (
            <textarea
              value={mission}
              onChange={(e) => { setMission(e.target.value); missionRef.current = e.target.value; queueSave(); }}
              onBlur={() => void flush()}
              rows={2}
              placeholder="One line: what this role must ensure…"
              className="w-full text-[13px] rounded-md border border-zinc-200 px-2.5 py-1.5 resize-y focus:outline-none focus:border-[var(--os-brand)]"
            />
          ) : (
            <span className="text-[13px] text-zinc-700">{mission || <span className="text-zinc-400">Not set</span>}</span>
          )}
        </Field>
        <Field label="Function">
          {canEdit ? (
            <FunctionPicker roleId={bundle.role.id} current={bundle.role.department} />
          ) : (
            <span className="text-[13px] text-zinc-700">{bundle.role.department?.name ?? <span className="text-zinc-400">Unassigned</span>}</span>
          )}
        </Field>
        <Field label="Level">
          {canEdit ? (
            <LevelSelect roleId={bundle.role.id} current={bundle.role.level} />
          ) : (
            <span className="text-[12px] font-medium text-zinc-600 px-1.5 py-0.5 rounded bg-zinc-100 uppercase tracking-wide">{bundle.role.level}</span>
          )}
        </Field>
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

// Inline picker assigning the role to a Function (Department). Same source
// the rest of the app uses (GET /api/departments), fetched lazily on first
// open. PUT { departmentId } on select; optimistic + router.refresh().
type DeptOption = { id: string; name: string };

function FunctionPicker({ roleId, current }: { roleId: string; current: DeptOption | null }) {
  const { call, busy } = useApi();
  const anchorRef = useRef<HTMLButtonElement>(null);
  const [open, setOpen] = useState(false);
  const [dept, setDept] = useState<DeptOption | null>(current);
  const [depts, setDepts] = useState<DeptOption[] | null>(null); // null = not loaded yet
  const [loadFailed, setLoadFailed] = useState(false);

  const toggle = () => {
    const next = !open;
    setOpen(next);
    if (next && (depts === null || loadFailed)) {
      setLoadFailed(false);
      setDepts(null);
      fetch("/api/departments")
        .then((r) => (r.ok ? r.json() : Promise.reject(new Error("load failed"))))
        .then((d: DeptOption[]) => setDepts(Array.isArray(d) ? d.map((x) => ({ id: x.id, name: x.name })) : []))
        .catch(() => { setDepts([]); setLoadFailed(true); });
    }
  };

  const pick = async (next: DeptOption | null) => {
    setOpen(false);
    if ((next?.id ?? null) === (dept?.id ?? null)) return;
    const prev = dept;
    setDept(next); // optimistic; refresh re-pulls the server bundle
    const ok = await call(`/api/roles/${roleId}`, "PUT", { departmentId: next?.id ?? null });
    if (!ok) setDept(prev);
  };

  return (
    <>
      <button
        ref={anchorRef}
        type="button"
        disabled={busy}
        onClick={toggle}
        title="Assign this job title to a function (department)"
        className="inline-flex items-center gap-1 h-7 -ml-1.5 px-1.5 rounded-md text-[13px] hover:bg-zinc-50 disabled:opacity-50"
      >
        <span className={dept ? "text-zinc-700" : "text-zinc-400"}>{dept?.name ?? "Unassigned"}</span>
        <ChevronDown className="w-3.5 h-3.5 text-zinc-400" />
      </button>
      {open ? (
        <>
          <div className="fixed inset-0 z-[70]" onClick={() => setOpen(false)} aria-hidden />
          <MorePortal anchorRef={anchorRef} width={230} open={open} placement="below">
            <MenuList>
              {depts === null ? (
                <div className="px-3 py-2 text-[12px] text-zinc-400">Loading…</div>
              ) : loadFailed ? (
                <div className="px-3 py-2 text-[12px] text-zinc-500">Couldn&rsquo;t load departments. Reopen to retry.</div>
              ) : depts.length === 0 ? (
                <div className="px-3 py-2 text-[12px] leading-relaxed text-zinc-500">
                  No departments yet. Create one in{" "}
                  <Link href="/people/departments" className="text-[var(--os-brand)] hover:underline" onClick={() => setOpen(false)}>
                    People → Departments
                  </Link>
                  , then assign it here.
                </div>
              ) : (
                <>
                  <MenuItem label={<span className="text-zinc-500">No function</span>} selected={!dept} onClick={() => void pick(null)} />
                  <MenuSeparator />
                  {depts.map((d) => (
                    <MenuItem key={d.id} label={d.name} selected={dept?.id === d.id} onClick={() => void pick(d)} />
                  ))}
                  <MenuSeparator />
                  {/* Discoverability: "how do I add a function?" — right here. */}
                  <Link href="/people/departments" onClick={() => setOpen(false)}>
                    <MenuItem label={<span className="text-[var(--os-brand)]">Manage functions…</span>} />
                  </Link>
                </>
              )}
            </MenuList>
          </MorePortal>
        </>
      ) : null}
    </>
  );
}

// Level select over the canonical Role.level catalog (lib/access-levels).
// AGENT is excluded: the roles index groups only its nine LEVEL_ORDER tiers,
// so an AGENT-level role would vanish from that page. Admin tiers stay out
// by design (see access-levels.ts). PUT { level } on change; the refresh
// also re-renders the server header, so the title chip updates in place.
const ROLE_LEVEL_OPTIONS = ACCESS_LEVELS.filter((o) => o.value !== "AGENT");

function LevelSelect({ roleId, current }: { roleId: string; current: string }) {
  const { call, busy } = useApi();
  const anchorRef = useRef<HTMLButtonElement>(null);
  const [open, setOpen] = useState(false);
  const [level, setLevel] = useState(current);

  const pick = async (next: string) => {
    setOpen(false);
    if (next === level) return;
    const prev = level;
    setLevel(next); // optimistic; refresh re-pulls bundle + header chip
    const ok = await call(`/api/roles/${roleId}`, "PUT", { level: next });
    if (!ok) setLevel(prev);
  };

  // Same MenuList picker as Function above — a native <select> here rendered
  // as a visibly different control right next to it (the inconsistency the
  // user screenshotted), and its popup ignored the design system entirely.
  return (
    <div>
      <button
        ref={anchorRef}
        type="button"
        disabled={busy}
        onClick={() => setOpen((v) => !v)}
        aria-label="Access level"
        className="inline-flex items-center gap-1 h-7 -ml-1.5 px-1.5 rounded-md text-[13px] hover:bg-zinc-50 disabled:opacity-50"
      >
        <span className="text-zinc-700">{labelForAccessLevel(level)}</span>
        <ChevronDown className="w-3.5 h-3.5 text-zinc-400" />
      </button>
      {open ? (
        <>
          <div className="fixed inset-0 z-[70]" onClick={() => setOpen(false)} aria-hidden />
          <MorePortal anchorRef={anchorRef} width={250} open={open} placement="below">
            <MenuList>
              {ROLE_LEVEL_OPTIONS.map((o) => (
                <MenuItem
                  key={o.value}
                  label={o.hint ? `${o.label} (${o.hint})` : o.label}
                  selected={level === o.value}
                  onClick={() => void pick(o.value)}
                />
              ))}
            </MenuList>
          </MorePortal>
        </>
      ) : null}
      <p className="text-[11px] text-zinc-400 mt-1">
        Access tier: decides what holders of this title can see, from their own work up to team and org-wide surfaces.
      </p>
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

// ─────────────────────────── KRAs & KPIs (the role's alignment template) ───────────────────────────
//
// KRA = heading card (a container: name + description, no number, no
// progress bar). KPI = gauge row underneath: direction of good, healthy
// line (nullable — "no baseline yet", never invented), OWNED/SHARED,
// north-star first. OKRs never appear here: an OKR belongs to a person,
// never to a role.

/** Tiny "…" overflow trigger rendering a MorePortal menu. */
function RowMenu({ items }: { items: { icon: LucideIcon; label: string; destructive?: boolean; onClick: () => void }[] }) {
  const anchorRef = useRef<HTMLButtonElement>(null);
  const [open, setOpen] = useState(false);
  return (
    <>
      <button
        ref={anchorRef}
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-label="More actions"
        className="w-6 h-6 grid place-items-center rounded-md text-zinc-400 hover:bg-zinc-100 hover:text-zinc-700 shrink-0"
      >
        <MoreHorizontal className="w-4 h-4" />
      </button>
      {open ? (
        <>
          <div className="fixed inset-0 z-[70]" onClick={() => setOpen(false)} aria-hidden />
          <MorePortal anchorRef={anchorRef} width={210} open={open} placement="below">
            <MenuList>
              {items.map((it, i) => (
                <Fragment key={it.label}>
                  {it.destructive && i > 0 ? <MenuSeparator /> : null}
                  <MenuItem
                    icon={it.icon}
                    label={it.label}
                    destructive={it.destructive}
                    onClick={() => { setOpen(false); it.onClick(); }}
                  />
                </Fragment>
              ))}
            </MenuList>
          </MorePortal>
        </>
      ) : null}
    </>
  );
}

const DIRECTION_META: Record<KpiDirection, { icon: LucideIcon; hint: string }> = {
  HIGHER: { icon: TrendingUp, hint: "Higher is better" },
  LOWER: { icon: TrendingDown, hint: "Lower is better" },
  MAINTAIN: { icon: MoveRight, hint: "Hold the line" },
};

function resolvedDirection(p: Kpi): KpiDirection {
  return p.direction ?? (p.lowerIsBetter ? "LOWER" : "HIGHER");
}

/** The KPI's healthy line as copy — never invents a number. */
function healthyLine(p: Kpi): string | null {
  if (p.targetValue == null) return null;
  const unit = p.unit ? ` ${p.unit}` : "";
  const dir = resolvedDirection(p);
  if (dir === "MAINTAIN") return `hold at ${p.targetValue}${unit}`;
  return `${dir === "LOWER" ? "≤" : "≥"} ${p.targetValue}${unit}`;
}

type ConfirmState =
  | { kind: "detach-kra"; id: string; name: string }
  | { kind: "delete-kra"; id: string; name: string }
  | { kind: "delete-kpi"; id: string; name: string }
  | null;

function AlignmentCard({ bundle, canEdit }: { bundle: RoleBundle; canEdit: boolean }) {
  const { call, busy } = useApi();
  const router = useRouter();
  const { toast } = useOsToast();
  const attachedIds = bundle.kras.map((k) => k.id);
  // Running total of the role-level weights, so a job title can visibly be
  // made to sum to 100% (every holder inherits these shares).
  const totalWeight = Math.round(bundle.kras.reduce((s, k) => s + (k.weight || 0), 0) * 100) / 100;

  const [kraDialog, setKraDialog] = useState<{ kra?: Kra } | null>(null);
  const [kpiDialog, setKpiDialog] = useState<{ kraId: string; kraName: string; kpi?: KpiDialogKpi } | null>(null);
  const [confirm, setConfirm] = useState<ConfirmState>(null);
  const [seedingId, setSeedingId] = useState<string | null>(null);

  const onSaved = (msg: string) => { toast(msg); router.refresh(); };

  // Backfill a drifted holder's assignments from this job title's templates.
  // Same endpoint the Instances panel uses; idempotent (skipDuplicates).
  const seedHolder = async (p: Holder) => {
    setSeedingId(p.id);
    try {
      const res = await fetch(`/api/users/${p.id}/seed-alignment`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ roleId: bundle.role.id }),
      });
      const d = await res.json().catch(() => ({}));
      if (!res.ok) { toast(d?.error ?? "Couldn't seed assignments"); return; }
      toast(`Seeded ${personName(p)} from ${bundle.role.title}`);
      router.refresh();
    } catch {
      toast("Network error");
    } finally { setSeedingId(null); }
  };

  const runConfirm = async () => {
    if (!confirm) return;
    const ok =
      confirm.kind === "detach-kra"
        ? await call("/api/kras", "PATCH", { id: confirm.id, roleId: null })
        : confirm.kind === "delete-kra"
          ? await call(`/api/kras?id=${confirm.id}`, "DELETE")
          : await call(`/api/kpis?id=${confirm.id}`, "DELETE");
    if (ok) {
      toast(
        confirm.kind === "detach-kra"
          ? `"${confirm.name}" moved to Needs a job title`
          : confirm.kind === "delete-kra" ? "KRA deleted" : "KPI deleted",
      );
      setConfirm(null);
    }
  };

  const confirmCopy: Record<Exclude<ConfirmState, null>["kind"], { title: string; description: string; confirmLabel: string; destructive: boolean }> = {
    "detach-kra": {
      title: "Detach this KRA from the job title?",
      description: "It moves to the “Needs a job title” list on the KRA/KPI page. People already assigned keep their assignment and history, but new holders of this title stop inheriting it until it is re-attached.",
      confirmLabel: "Detach",
      destructive: false,
    },
    "delete-kra": {
      title: "Delete this KRA?",
      description: "Everyone's assignment to it is removed and its KPI gauges are detached from the job title. Recorded readings on those gauges survive. This cannot be undone.",
      confirmLabel: "Delete KRA",
      destructive: true,
    },
    "delete-kpi": {
      title: "Delete this KPI?",
      description: "The gauge AND every recorded reading on it — for every person — are permanently deleted. Goal key results linked to it fall back to hand check-ins. This cannot be undone.",
      confirmLabel: "Delete KPI",
      destructive: true,
    },
  };

  return (
    <Card
      title="KRAs & KPIs"
      icon={Target}
      action={canEdit ? (
        <div className="flex items-center gap-1.5">
          <div className="w-[170px]">
            <KraPicker
              kras={bundle.allKras.map((k) => ({ id: k.id, name: k.name, category: k.category ?? undefined }))}
              value=""
              excludeIds={attachedIds}
              placeholder="Attach existing"
              onChange={(kraId) => { if (kraId) void call("/api/kras", "PATCH", { id: kraId, roleId: bundle.role.id }); }}
            />
          </div>
          <button
            type="button"
            onClick={() => setKraDialog({})}
            className="inline-flex items-center gap-1 h-7 px-2.5 rounded-md text-[12px] font-medium text-white bg-[var(--os-brand)] hover:bg-[var(--os-brand-hover)]"
          >
            <Plus className="w-3.5 h-3.5" /> Add KRA
          </button>
        </div>
      ) : undefined}
    >
      <div className="flex items-center justify-between gap-3 mb-3 -mt-1">
        <p className="text-[11.5px] text-zinc-400">
          Every person with this job title inherits these. Quarterly targets live
          on each person&rsquo;s goals.
        </p>
        {bundle.kras.length > 0 ? (
          <span
            className={`text-[11px] tabular-nums shrink-0 ${totalWeight > 100 ? "text-[#E2445C]" : "text-zinc-400"}`}
            title="Sum of this job title's KRA weights. Aim for 100%."
          >
            weight {totalWeight}% of 100
          </span>
        ) : null}
      </div>

      {bundle.kras.length === 0 ? (
        <p className="text-[12.5px] text-zinc-400 py-2">
          No KRAs yet. Add the first area of responsibility this job title owns.
        </p>
      ) : (
        <div className="space-y-3">
          {bundle.kras.map((k) => (
            <section key={k.id} className="rounded-lg border border-zinc-200">
              {/* KRA heading — a container: no number, no progress bar. */}
              <header className="flex items-start gap-2.5 px-3 pt-2.5 pb-2">
                <Target className="w-4 h-4 text-zinc-400 shrink-0 mt-0.5" />
                <div className="min-w-0 flex-1">
                  <h3 className="text-[13.5px] font-semibold text-zinc-900 truncate" title={k.name}>{k.name}</h3>
                  {k.description ? (
                    <p className="text-[12px] text-zinc-500 leading-snug mt-0.5">{k.description}</p>
                  ) : null}
                </div>
                <span
                  className={`text-[12px] font-mono tabular-nums shrink-0 mt-0.5 ${k.weight ? "text-zinc-700" : "text-zinc-400"}`}
                  title="Role-level weight — every holder inherits this share as their starting weightage"
                >
                  {k.weight || 0}%
                </span>
                {canEdit ? (
                  <RowMenu
                    items={[
                      { icon: Pencil, label: "Edit KRA", onClick: () => setKraDialog({ kra: k }) },
                      { icon: Plus, label: "Add KPI", onClick: () => setKpiDialog({ kraId: k.id, kraName: k.name }) },
                      { icon: Unlink, label: "Detach from job title", onClick: () => setConfirm({ kind: "detach-kra", id: k.id, name: k.name }) },
                      { icon: Trash2, label: "Delete KRA", destructive: true, onClick: () => setConfirm({ kind: "delete-kra", id: k.id, name: k.name }) },
                    ]}
                  />
                ) : null}
              </header>

              {/* KPI gauge rows */}
              {k.kpis.length > 0 ? (
                <ul className="border-t border-zinc-100">
                  {k.kpis.map((p) => {
                    const dir = resolvedDirection(p);
                    const DirIcon = DIRECTION_META[dir].icon;
                    const line = healthyLine(p);
                    const shared = p.ownership === "SHARED";
                    return (
                      <li key={p.id} className="flex items-center gap-2.5 px-3 py-2 border-b border-zinc-100 last:border-b-0">
                        {p.isNorthStar ? (
                          <Star className="w-3.5 h-3.5 text-amber-400 shrink-0" style={{ fill: "currentColor" }} aria-label="North-star gauge" />
                        ) : (
                          <Gauge className="w-3.5 h-3.5 text-zinc-300 shrink-0" />
                        )}
                        <span className="min-w-0 flex-1">
                          <span className="block text-[12.5px] text-zinc-800 truncate" title={p.name}>{p.name}</span>
                          <span className="block text-[10.5px] text-zinc-400 truncate">
                            {[
                              p.unit,
                              shared ? "influenced · reviewed, not graded" : null,
                              p.baselineValue != null ? `baseline ${p.baselineValue}` : null,
                            ].filter(Boolean).join(" · ") || " "}
                          </span>
                        </span>
                        <DirIcon className="w-3.5 h-3.5 text-zinc-400 shrink-0" aria-label={DIRECTION_META[dir].hint} />
                        {line ? (
                          <span className="text-[12px] font-mono text-zinc-700 shrink-0" title={`Healthy line — ${DIRECTION_META[dir].hint.toLowerCase()}`}>{line}</span>
                        ) : (
                          <span className="text-[11.5px] italic text-zinc-400 shrink-0">no baseline yet</span>
                        )}
                        <span
                          className="text-[10.5px] font-semibold px-1.5 py-0.5 rounded uppercase tracking-wide shrink-0"
                          style={shared ? { background: "#a78b6c22", color: "#8e7165" } : { background: "#0073EA1a", color: "#0073EA" }}
                          title={shared ? "Influenced by this role — reviewed, not graded" : "Controlled by this role — graded"}
                        >
                          {shared ? "Shared" : "Owned"}
                        </span>
                        {canEdit ? (
                          <RowMenu
                            items={[
                              { icon: Pencil, label: "Edit KPI", onClick: () => setKpiDialog({ kraId: k.id, kraName: k.name, kpi: p }) },
                              { icon: Trash2, label: "Delete KPI", destructive: true, onClick: () => setConfirm({ kind: "delete-kpi", id: p.id, name: p.name }) },
                            ]}
                          />
                        ) : null}
                      </li>
                    );
                  })}
                </ul>
              ) : (
                <p className="border-t border-zinc-100 px-3 py-2 text-[11.5px] text-zinc-400">
                  No gauges yet — how will this area be measured?
                </p>
              )}

              {canEdit ? (
                <button
                  type="button"
                  onClick={() => setKpiDialog({ kraId: k.id, kraName: k.name })}
                  className="w-full flex items-center gap-1.5 px-3 py-1.5 border-t border-zinc-100 text-[12px] text-zinc-500 hover:text-[var(--os-brand)] hover:bg-zinc-50 rounded-b-lg"
                >
                  <Plus className="w-3.5 h-3.5" /> Add KPI
                </button>
              ) : null}
            </section>
          ))}
        </div>
      )}

      {/* People holding this job title — each inherits the template above. */}
      {bundle.people.length > 0 ? (
        <div className="mt-4">
          <div className="text-[11px] font-semibold uppercase tracking-wide text-zinc-400 mb-1.5">People with this job title</div>
          <div className="flex flex-wrap items-center gap-1.5">
            {bundle.people.map((p) => {
              const totalTemplates = bundle.kras.length;
              const missing = Math.min(Math.max(p.missingKras ?? 0, 0), totalTemplates);
              const drifted = missing > 0;
              return (
                <span
                  key={p.id}
                  className={`inline-flex items-center gap-1.5 h-7 pl-1 pr-2.5 rounded-full border ${drifted ? "border-amber-300 bg-amber-50/50" : "border-zinc-200"}`}
                >
                  <Link
                    href={`/people/${p.id}`}
                    title={personName(p)}
                    className="inline-flex items-center gap-1.5 hover:opacity-80"
                  >
                    <Avatar className="h-5 w-5">
                      {p.avatar ? <AvatarImage src={p.avatar} alt="" /> : null}
                      <AvatarFallback className="text-[9px]">{initials(p)}</AvatarFallback>
                    </Avatar>
                    <span className="text-[12px] text-zinc-700">{personName(p)}</span>
                  </Link>
                  {drifted ? (
                    <>
                      <span
                        className="text-[10.5px] font-medium text-amber-600 whitespace-nowrap"
                        title={`Missing ${missing} of this job title's ${totalTemplates} template KRA assignment${totalTemplates === 1 ? "" : "s"}`}
                      >
                        missing {missing} of {totalTemplates}
                      </span>
                      {canEdit ? (
                        <button
                          type="button"
                          disabled={seedingId === p.id}
                          onClick={() => void seedHolder(p)}
                          title="Backfill the missing KRA assignments from this job title's templates"
                          className="inline-flex items-center gap-0.5 text-[10.5px] font-medium text-[var(--os-brand)] hover:underline disabled:opacity-50"
                        >
                          {seedingId === p.id ? <Loader2 className="w-3 h-3 animate-spin" /> : null}
                          Seed
                        </button>
                      ) : null}
                    </>
                  ) : null}
                </span>
              );
            })}
          </div>
        </div>
      ) : null}

      <KraDialog
        open={kraDialog !== null}
        onOpenChange={(v) => { if (!v) setKraDialog(null); }}
        roles={bundle.allRoles}
        defaultRoleId={bundle.role.id}
        lockRole
        kra={kraDialog?.kra ? { ...kraDialog.kra, roleId: bundle.role.id } : null}
        onSaved={onSaved}
      />
      {kpiDialog ? (
        <KpiDialog
          open
          onOpenChange={(v) => { if (!v) setKpiDialog(null); }}
          kraId={kpiDialog.kraId}
          kraName={kpiDialog.kraName}
          kpi={kpiDialog.kpi ?? null}
          onSaved={onSaved}
        />
      ) : null}
      {confirm ? (
        <ConfirmDialog
          open
          onClose={() => setConfirm(null)}
          onConfirm={() => void runConfirm()}
          loading={busy}
          title={confirmCopy[confirm.kind].title}
          description={confirmCopy[confirm.kind].description}
          confirmLabel={confirmCopy[confirm.kind].confirmLabel}
          destructive={confirmCopy[confirm.kind].destructive}
        />
      ) : null}
    </Card>
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
