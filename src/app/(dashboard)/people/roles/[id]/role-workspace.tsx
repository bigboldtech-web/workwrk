"use client";

// RoleWorkspace, the interactive body of the Role Definition page. Overview
// (identity · ownership boundary · KRAs · KPIs · SOPs · thresholds) + Instances
// (Role × Scope). All mutations hit the generic operating-core APIs and then
// router.refresh() to re-pull the server bundle (config surface, low frequency , 
// correctness over optimism). Reuses the app's design-system primitives.

import { Fragment, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Breadcrumb } from "@/components/layout/os/top-bar/breadcrumb";
import { OsPageHeader } from "@/components/layout/os/page-header";
import { useBoot } from "@/components/layout/os/boot-context";
import { NEUTRAL_TILE } from "@/components/ui/entity-tile";
import { Chip } from "@/components/ui/chip";
import { ToneChip } from "@/components/people/person-bits";
import Link from "next/link";
import {
  GitBranch, Plus, Trash2, X, Check, ShieldCheck, HandHelping, Ban,
  Target, FileText, Gauge, Users as UsersIcon, Sparkles, Link2,
  MoreHorizontal, Star, TrendingUp, TrendingDown, MoveRight, Pencil, Unlink, ChevronDown, Briefcase,
  type LucideIcon,
} from "lucide-react";
import { SENIORITY_OPTIONS, seniorityLabel } from "@/lib/people/seniority";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { SkeletonLines } from "@/components/ui/skeleton";
import { UpcomingOnly } from "@/components/ui/coming-soon-row";
import { AutosaveIndicator } from "@/components/ui/autosave-indicator";
import { Picker } from "@/components/ui/picker";
import { ViewTab } from "@/components/ui/view-tabs";
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

type RoleTab = "overview" | "people" | "instances";

export function RoleWorkspace({ bundle, canEdit, canEditIdentity = canEdit, tab }: { bundle: RoleBundle; canEdit: boolean; canEditIdentity?: boolean; tab: RoleTab }) {
  const roleId = bundle.role.id;
  const router = useRouter();
  const { toast } = useOsToast();
  const { boot } = useBoot();
  // Instances is a word a small firm should never meet: the tab renders only
  // when the org uses scopes or instances, or with Show upcoming features on.
  const showUpcoming = boot.prefs?.home?.ui?.showUpcoming === true;
  const instancesOn = bundle.instances.length > 0 || bundle.scopes.length > 0 || showUpcoming;
  const active: RoleTab = tab === "instances" && !instancesOn ? "overview" : tab;
  const deletable = bundle.people.length === 0 && bundle.kras.length === 0;

  async function copyLink() {
    try { await navigator.clipboard.writeText(`${window.location.origin}/people/roles/${roleId}`); toast("Link copied"); }
    catch { toast("Couldn't copy the link"); }
  }
  async function duplicate() {
    const res = await fetch("/api/roles", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ title: `${bundle.role.title} (copy)`, description: bundle.role.description, seniority: bundle.role.level, duplicateOf: roleId, departmentId: bundle.role.department?.id ?? null }),
    });
    const d = await res.json().catch(() => ({}));
    if (!res.ok) { toast(d?.error ?? "Couldn't duplicate the job title"); return; }
    toast("Duplicated. KRAs stay on the original; attach the ones this title needs.");
    router.push(`/people/roles/${(d?.data ?? d).id}`);
  }
  async function remove() {
    const res = await fetch(`/api/roles/${roleId}`, { method: "DELETE" });
    const d = await res.json().catch(() => ({}));
    if (!res.ok) { toast(d?.error ?? "Couldn't delete the job title"); return; }
    toast("Job title deleted");
    router.push("/people/roles");
  }
  const [confirmDelete, setConfirmDelete] = useState(false);

  return (
    <>
      <Breadcrumb items={[{ label: "Job titles", href: "/people/roles" }, { label: bundle.role.title }]} />
      <OsPageHeader
        title={bundle.role.title}
        back={{ fallbackHref: "/people/roles", label: "Job titles" }}
        tile={{ icon: Briefcase, ...NEUTRAL_TILE }}
        titleSlot={
          <div className="flex min-w-0 items-center gap-2">
            <h1 className="min-w-0 truncate text-title font-semibold text-ink" title={bundle.role.title}>{bundle.role.title}</h1>
            <Chip>{seniorityLabel(bundle.role.level)}</Chip>
          </div>
        }
        more={[
          { label: "Copy link", icon: Link2, onClick: () => void copyLink() },
          ...(canEditIdentity ? [{ label: "Duplicate as new job title", icon: Plus, onClick: () => void duplicate() }] : []),
          ...(canEditIdentity && deletable ? [{ separator: true as const }, { label: "Delete job title", icon: Trash2, destructive: true, onClick: () => setConfirmDelete(true) }] : []),
        ]}
      />
      <div className="flex-1 overflow-y-auto pb-10">
        <div className="mx-auto flex w-full max-w-[720px] flex-col gap-6 px-4 sm:px-6">
          {!canEditIdentity ? (
            <p className="flex h-9 items-center rounded-md bg-active px-3 text-sm text-ink-2">View only. Job titles are managed by Admins and the People team.</p>
          ) : null}
          <div className="flex h-9 items-center gap-1" role="tablist" aria-label="Job title sections">
            <ViewTab label="Overview" active={active === "overview"} href={`/people/roles/${roleId}`} />
            <ViewTab label="People" active={active === "people"} href={`/people/roles/${roleId}?tab=people`} trailing={<span className="text-xs font-medium text-ink-2">{bundle.people.length}</span>} />
            {instancesOn ? <ViewTab label="Instances" active={active === "instances"} href={`/people/roles/${roleId}?tab=instances`} trailing={bundle.instances.length ? <span className="text-xs font-medium text-ink-2">{bundle.instances.length}</span> : undefined} /> : null}
          </div>
          {active === "overview" ? (
            <>
              <IdentityCard bundle={bundle} canEdit={canEditIdentity} />
              <BoundaryCard bundle={bundle} canEdit={canEdit} />
              <AlignmentCard bundle={bundle} canEdit={canEdit} />
              <SopCard bundle={bundle} canEdit={canEditIdentity} />
              {/* Stored, never enforced yet (PO-11): hidden until the
                  escalation job reads them, and captioned when shown. The rows
                  are kept, never deleted. */}
              <UpcomingOnly>
                <ThresholdsCard bundle={bundle} canEdit={canEdit} />
              </UpcomingOnly>
            </>
          ) : active === "people" ? (
            <PeoplePanel bundle={bundle} canEdit={canEdit} />
          ) : (
            <>
              <p className="text-sm text-ink-2">An instance is a copy of this job title for one region, team or product, with its own KRAs and KPIs.</p>
              <InstancesPanel bundle={bundle} canEdit={canEdit} />
            </>
          )}
        </div>
      </div>
      {confirmDelete ? (
        <ConfirmDialog
          open
          onClose={() => setConfirmDelete(false)}
          onConfirm={() => { setConfirmDelete(false); void remove(); }}
          title={`Delete ${bundle.role.title}?`}
          description="Nobody holds this job title and it defines no KRAs, so nothing else changes."
          confirmLabel="Delete job title"
          destructive
        />
      ) : null}
    </>
  );
}

/** People tab: who holds the title, and who is missing some of its KRAs. */
function PeoplePanel({ bundle, canEdit }: { bundle: RoleBundle; canEdit: boolean }) {
  const router = useRouter();
  const { toast } = useOsToast();
  const [seedingId, setSeedingId] = useState<string | null>(null);
  const totalTemplates = bundle.kras.length;
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
      toast("Couldn't reach the server. Nothing changed.");
    } finally { setSeedingId(null); }
  };
  if (bundle.people.length === 0) {
    return <p className="rounded-lg border border-line bg-surface px-4 py-3 text-row text-ink-2">Nobody holds this job title yet.</p>;
  }
  return (
    <div className="flex flex-col gap-2">
      <ul className="os-chrome divide-y divide-line-soft overflow-hidden rounded-lg border border-line bg-surface">
        {bundle.people.map((p) => {
          const missing = Math.min(Math.max(p.missingKras ?? 0, 0), totalTemplates);
          return (
            <li key={p.id} className="flex min-h-11 items-center gap-3 px-3">
              <Link href={`/people/${p.id}`} className="flex min-w-0 flex-1 items-center gap-2 hover:underline">
                <Avatar className="h-7 w-7">
                  {p.avatar ? <AvatarImage src={p.avatar} alt="" /> : null}
                  <AvatarFallback className="text-micro">{initials(p)}</AvatarFallback>
                </Avatar>
                <span className="truncate text-row text-ink">{personName(p)}</span>
              </Link>
              {/* Drift is people data: the server strips it for readers. */}
              {canEdit ? (
                missing > 0 ? (
                  <>
                    <ToneChip tone="warning" label={`Missing ${missing} of ${totalTemplates} KRAs`} />
                    <button type="button" disabled={seedingId === p.id} onClick={() => void seedHolder(p)} className="inline-flex h-7 items-center rounded-md px-2 text-sm font-medium text-ink-2 hover:bg-hover hover:text-ink disabled:opacity-50">
                      {seedingId === p.id ? "Seeding" : "Seed"}
                    </button>
                  </>
                ) : totalTemplates > 0 ? <Chip>Up to date</Chip> : null
              ) : null}
            </li>
          );
        })}
      </ul>
      <p className="text-sm font-medium text-ink-2">Total people {bundle.people.length}</p>
    </div>
  );
}

// ─────────────────────────── shared bits ───────────────────────────
function Card({ title, icon: Icon, action, children }: { title: string; icon?: React.ComponentType<{ className?: string }>; action?: React.ReactNode; children: React.ReactNode }) {
  return (
    <section className="rounded-xl border border-line bg-raised p-4">
      <div className="flex items-center justify-between mb-3">
        <h2 className="text-xs font-semibold text-ink flex items-center gap-1.5">
          {Icon ? <Icon className="w-4 h-4 text-ink-2" /> : null}
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
  const [saveState, setSaveState] = useState<"idle" | "saving" | "saved" | "error">("idle");
  const [confirmDelete, setConfirmDelete] = useState(false);
  // Autosave reads refs, not state: the debounce timer holds the closure from
  // the render BEFORE the last keystroke, so state reads would save one
  // character behind ("sometimes it saves, sometimes it doesn't").
  const titleRef = useRef(bundle.role.title);
  const missionRef = useRef(bundle.role.description ?? "");
  const savedRef = useRef({ title: bundle.role.title, mission: bundle.role.description ?? "" });
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const retries = useRef(0);

  // A failed save stays visible ("Not saved, retrying") and retries with a
  // backoff; the typed text is never dropped.
  const flush = async (): Promise<void> => {
    const nextTitle = titleRef.current.trim();
    const nextMission = missionRef.current.trim();
    if (nextTitle === savedRef.current.title.trim() && nextMission === savedRef.current.mission.trim()) return;
    if (!nextTitle) return; // never save a job title into a blank name
    setSaveState("saving");
    let ok = false;
    try {
      const res = await fetch(`/api/roles/${bundle.role.id}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        keepalive: true,
        body: JSON.stringify({ title: nextTitle, description: nextMission }),
      });
      ok = res.ok;
      if (!ok && res.status >= 400 && res.status < 500) {
        const d = await res.json().catch(() => ({}));
        toast(d?.error ?? "Couldn't save the job title");
        setSaveState("error");
        return;
      }
    } catch { ok = false; }
    if (!ok) {
      setSaveState("error");
      retries.current += 1;
      if (retries.current <= 5) setTimeout(() => void flush(), Math.min(30000, 1000 * 2 ** retries.current));
      return;
    }
    retries.current = 0;
    savedRef.current = { title: nextTitle, mission: nextMission };
    setSaveState("saved");
    router.refresh();
  };
  const queueSave = () => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => void flush(), 700);
  };

  const holders = bundle.people.length;
  async function deleteRole() {
    const res = await fetch(`/api/roles/${bundle.role.id}`, { method: "DELETE" });
    if (res.ok) {
      toast("Job title deleted");
      router.push("/people/roles");
      router.refresh();
    } else {
      const d = await res.json().catch(() => ({}));
      toast(d?.error ?? "Couldn't delete the job title");
    }
    setConfirmDelete(false);
  }

  return (
    <Card
      title="Details"
      action={
        <div className="flex items-center gap-2">
          {canEdit && saveState !== "idle" ? (
            <AutosaveIndicator status={saveState} lastSavedAt={null} onRetry={() => { retries.current = 0; void flush(); }} />
          ) : null}
          {/* Delete renders only when it can succeed: nobody holds the title
              and it defines no KRAs (the route refuses anything else). */}
          {canEdit && holders === 0 && bundle.kras.length === 0 ? (
            <button
              type="button"
              onClick={() => setConfirmDelete(true)}
              className="inline-flex items-center gap-1 h-7 px-2 rounded-md text-sm text-danger-text hover:bg-danger-bg"
            >
              <Trash2 className="w-3.5 h-3.5" /> Delete job title
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
          title={`Delete ${bundle.role.title}?`}
          description="Nobody holds this job title and it defines no KRAs, so nothing else changes."
          confirmLabel="Delete job title"
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
              className="w-full text-base rounded-md border border-line px-2.5 py-1.5 focus:outline-none focus:border-[var(--os-brand)]"
            />
          ) : (
            <span className="text-base text-ink">{bundle.role.title}</span>
          )}
        </Field>
        <Field label="Description">
          {canEdit ? (
            <textarea
              value={mission}
              onChange={(e) => { setMission(e.target.value); missionRef.current = e.target.value; queueSave(); }}
              onBlur={() => void flush()}
              rows={2}
              placeholder="What this job title is for and what it must ensure"
              className="w-full text-base rounded-md border border-line px-2.5 py-1.5 resize-y focus:outline-none focus:border-[var(--os-brand)]"
            />
          ) : (
            <span className="text-base text-ink">{mission || <span className="text-ink-2">Not set</span>}</span>
          )}
        </Field>
        <Field label="Department">
          {canEdit ? (
            <FunctionPicker roleId={bundle.role.id} current={bundle.role.department} />
          ) : (
            <span className="text-base text-ink">{bundle.role.department?.name ?? <span className="text-ink-2">No department</span>}</span>
          )}
        </Field>
        <Field label="Seniority">
          {canEdit ? (
            <LevelSelect roleId={bundle.role.id} current={bundle.role.level} />
          ) : (
            <span className="text-base text-ink">{seniorityLabel(bundle.role.level)}</span>
          )}
        </Field>
        <Field label="People"><Link href={`/people/roles/${bundle.role.id}?tab=people`} className="text-base text-ink hover:underline">{bundle.people.length} {bundle.people.length === 1 ? "person holds" : "people hold"} this title</Link></Field>
      </div>
    </Card>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-baseline gap-3">
      <span className="text-xs text-ink-2 w-[88px] shrink-0">{label}</span>
      <div className="flex-1 min-w-0">{children}</div>
    </div>
  );
}

// Inline picker assigning the job title to a Department. Same source
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
        title="Pick the department this job title belongs to"
        className="inline-flex items-center gap-1 h-7 -ml-1.5 px-1.5 rounded-md text-base hover:bg-hover disabled:opacity-50"
      >
        <span className={dept ? "text-ink" : "text-ink-2"}>{dept?.name ?? "No department"}</span>
        <ChevronDown className="w-3.5 h-3.5 text-ink-2" />
      </button>
      {open ? (
        <>
          <div className="fixed inset-0 z-[70]" onClick={() => setOpen(false)} aria-hidden />
          <MorePortal anchorRef={anchorRef} width={230} open={open} placement="below">
            <MenuList>
              {depts === null ? (
                <div className="px-3 py-2"><SkeletonLines lines={2} /></div>
              ) : loadFailed ? (
                <div className="px-3 py-2 text-sm text-ink-2">Couldn&rsquo;t load departments. Reopen to retry.</div>
              ) : depts.length === 0 ? (
                <div className="px-3 py-2 text-sm leading-relaxed text-ink-2">
                  No departments yet. Create one in{" "}
                  <Link href="/people/departments" className="text-[var(--os-brand)] hover:underline" onClick={() => setOpen(false)}>
                    Teams, Departments
                  </Link>
                  , then assign it here.
                </div>
              ) : (
                <>
                  <MenuItem label={<span className="text-ink-2">No department</span>} selected={!dept} onClick={() => void pick(null)} />
                  <MenuSeparator />
                  {depts.map((d) => (
                    <MenuItem key={d.id} label={d.name} selected={dept?.id === d.id} onClick={() => void pick(d)} />
                  ))}
                  <MenuSeparator />
                  {/* Discoverability: "how do I add a department?", right here. */}
                  <Link href="/people/departments" onClick={() => setOpen(false)}>
                    <MenuItem label={<span className="text-[var(--os-brand)]">Manage departments</span>} />
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
// Seniority is display only (access 2.1): the six labels, never an access
// tier. A legacy stored value (HR, an admin tier) still shows its own label.
const ROLE_LEVEL_OPTIONS = SENIORITY_OPTIONS;

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

  // Same MenuList picker as Function above, a native <select> here rendered
  // as a visibly different control right next to it (the inconsistency the
  // user screenshotted), and its popup ignored the design system entirely.
  return (
    <div>
      <button
        ref={anchorRef}
        type="button"
        disabled={busy}
        onClick={() => setOpen((v) => !v)}
        aria-label="Seniority"
        className="inline-flex items-center gap-1 h-7 -ml-1.5 px-1.5 rounded-md text-base hover:bg-hover disabled:opacity-50"
      >
        <span className="text-ink">{seniorityLabel(level)}</span>
        <ChevronDown className="w-3.5 h-3.5 text-ink-2" />
      </button>
      {open ? (
        <>
          <div className="fixed inset-0 z-[70]" onClick={() => setOpen(false)} aria-hidden />
          <MorePortal anchorRef={anchorRef} width={250} open={open} placement="below">
            <MenuList>
              {ROLE_LEVEL_OPTIONS.map((o) => (
                <MenuItem
                  key={o.value}
                  label={o.label}
                  selected={level === o.value}
                  onClick={() => void pick(o.value)}
                />
              ))}
            </MenuList>
          </MorePortal>
        </>
      ) : null}
      <p className="text-xs text-ink-2 mt-1">
        Display only. Seniority never changes what someone can do.
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
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [renameVal, setRenameVal] = useState("");
  const [deleteArea, setDeleteArea] = useState<{ id: string; name: string } | null>(null);
  const saveRename = async (areaId: string) => {
    const name = renameVal.trim();
    if (!name) { setRenamingId(null); return; }
    if (await call(`/api/ownership-areas/${areaId}`, "PATCH", { name })) setRenamingId(null);
  };
  const [requestFor, setRequestFor] = useState<Boundary | null>(null);
  const [requestNote, setRequestNote] = useState("");
  const [sendingRequest, setSendingRequest] = useState(false);
  const raiseRequest = (b: Boundary) => { setRequestNote(""); setRequestFor(b); };
  const sendRequest = async () => {
    if (!requestFor || !requestNote.trim() || sendingRequest) return;
    setSendingRequest(true);
    try {
      const res = await fetch("/api/role-boundaries/request", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ areaId: requestFor.area.id, note: requestNote.trim() }),
      });
      const d = await res.json().catch(() => ({}));
      if (!res.ok) { toast(d?.error ?? "Couldn't send the request"); return; }
      toast(
        d.notified > 0
          ? `Request sent to ${d.notified} ${d.ownerTitle}${d.notified === 1 ? "" : " holders"}`
          : `Request logged. Nobody holds ${d.ownerTitle} yet`,
      );
      setRequestFor(null);
    } finally { setSendingRequest(false); }
  };

  return (
    <Card title="Ownership boundary" icon={GitBranch}>
      <p className="text-xs text-ink-2 mb-3 -mt-1">One concept, one owner, one place. A request is raised to the owner, never edited directly.</p>
      <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
        {/* Owns */}
        <BoundaryColumn icon={ShieldCheck} label="Owns">
          {bundle.ownedAreas.length === 0 ? <Empty>Nothing owned yet</Empty> : bundle.ownedAreas.map((a) => (
            <li key={a.id} className="group/oa flex items-center gap-1.5 px-2 py-1.5 rounded-md hover:bg-hover text-base text-ink">
              {renamingId === a.id ? (
                <input
                  autoFocus
                  value={renameVal}
                  onChange={(e) => setRenameVal(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") { e.preventDefault(); void saveRename(a.id); }
                    if (e.key === "Escape") setRenamingId(null);
                  }}
                  onBlur={() => void saveRename(a.id)}
                  className="flex-1 min-w-0 text-base bg-raised rounded border border-line px-1.5 py-0.5 outline-none focus:border-brand"
                />
              ) : (
                <span className="flex-1 truncate" title={a.name}>{a.name}</span>
              )}
              {canEdit && renamingId !== a.id ? (
                <>
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => { setRenamingId(a.id); setRenameVal(a.name); }}
                    title="Rename area"
                    aria-label={`Rename ${a.name}`}
                    className="text-ink-3 hover:text-ink"
                  >
                    <Pencil className="w-3 h-3" />
                  </button>
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => setDeleteArea({ id: a.id, name: a.name })}
                    title="Delete area"
                    aria-label={`Delete ${a.name}`}
                    className="text-ink-3 hover:text-danger-text"
                  >
                    <X className="w-3.5 h-3.5" />
                  </button>
                </>
              ) : null}
            </li>
          ))}
          {canEdit ? (
            <li className="flex items-center gap-1.5 px-1 pt-1">
              <input value={newArea} onChange={(e) => setNewArea(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); void addOwnedArea(); } }}
                placeholder="Add an owned area…" className="flex-1 text-sm bg-transparent outline-none placeholder:text-ink-2" />
              {newArea.trim() ? <button type="button" disabled={busy} onClick={addOwnedArea} className="text-[var(--os-brand)]"><Check className="w-3.5 h-3.5" /></button> : null}
            </li>
          ) : null}
        </BoundaryColumn>

        {/* Can request */}
        <BoundaryColumn icon={HandHelping} label="Can request" onAdd={canEdit ? () => setAddOpen("CAN_REQUEST") : undefined}>
          {canRequest.length === 0 ? <Empty>None yet. Link areas other roles own, so this role can raise requests to them.</Empty> : canRequest.map((b) => (
            <BoundaryRow key={b.id} b={b} canEdit={canEdit} busy={busy} onRemove={() => call(`/api/role-boundaries/${b.id}`, "DELETE")} onRequest={() => raiseRequest(b)} />
          ))}
        </BoundaryColumn>

        {/* Cannot touch */}
        <BoundaryColumn icon={Ban} label="Cannot touch" onAdd={canEdit ? () => setAddOpen("CANNOT_TOUCH") : undefined}>
          {cannotTouch.length === 0 ? <Empty>None yet. Mark areas explicitly off-limits for this role.</Empty> : cannotTouch.map((b) => (
            <BoundaryRow key={b.id} b={b} canEdit={canEdit} busy={busy} onRemove={() => call(`/api/role-boundaries/${b.id}`, "DELETE")} />
          ))}
        </BoundaryColumn>
      </div>

      {addOpen ? (
        <AddBoundary areas={assignable} roles={bundle.allRoles.filter((r) => r.id !== roleId)} relation={addOpen} busy={busy} onClose={() => setAddOpen(null)}
          onPick={async (areaId) => { if (await call("/api/role-boundaries", "POST", { roleId, areaId, relation: addOpen })) setAddOpen(null); }} />
      ) : null}

      {requestFor ? (
        <Dialog open onOpenChange={(v) => { if (!v) setRequestFor(null); }}>
          <DialogContent className="max-w-[400px]">
            <DialogHeader>
              <DialogTitle>Request: {requestFor.area.name}</DialogTitle>
            </DialogHeader>
            <p className="text-xs text-ink-2 mb-3">
              Goes to everyone currently holding <span className="font-medium text-ink">{requestFor.area.ownerRole?.title ?? "the owner role"}</span>. They decide and act; this job title never edits the area directly.
            </p>
            <textarea
              value={requestNote}
              onChange={(e) => setRequestNote(e.target.value)}
              rows={3}
              autoFocus
              placeholder="What do you need changed or decided?"
              className="w-full text-sm rounded-md border border-line px-2.5 py-1.5 resize-y focus:outline-none focus:border-[var(--os-brand)]"
            />
            <div className="mt-3 flex justify-end gap-2">
              <button type="button" onClick={() => setRequestFor(null)} className="h-8 px-3 rounded-md text-sm text-ink-2 hover:bg-hover">Cancel</button>
              <button type="button" disabled={sendingRequest || !requestNote.trim()} onClick={() => void sendRequest()} className="h-8 px-3.5 rounded-md text-sm font-medium text-white bg-[var(--os-brand)] hover:bg-[var(--os-brand-hover)] disabled:opacity-50 inline-flex items-center gap-1.5">
                {sendingRequest ? "Sending" : "Send request"}
              </button>
            </div>
          </DialogContent>
        </Dialog>
      ) : null}

      {deleteArea ? (
        <ConfirmDialog
          open
          onClose={() => setDeleteArea(null)}
          onConfirm={async () => {
            if (await call(`/api/ownership-areas/${deleteArea.id}`, "DELETE")) setDeleteArea(null);
          }}
          loading={busy}
          title={`Delete area "${deleteArea.name}"?`}
          description="The area disappears everywhere, including other roles' Can-request and Cannot-touch lists. No SOPs, KRAs or people are affected."
          confirmLabel="Delete area"
          destructive
        />
      ) : null}
    </Card>
  );
}

// Neutral columns (design-system 4: one blue, no tinted panels): the icon
// and the word carry the meaning, never a green, blue or red header.
function BoundaryColumn({ icon: Icon, label, onAdd, children }: { icon: React.ComponentType<{ className?: string }>; label: string; onAdd?: () => void; children: React.ReactNode }) {
  return (
    <div className="rounded-lg border border-line overflow-hidden">
      <div className="flex h-9 items-center justify-between px-2.5 border-b border-line-soft bg-subtle">
        <span className="inline-flex items-center gap-1.5 text-sm font-medium text-ink"><Icon className="w-3.5 h-3.5 text-ink-2" />{label}</span>
        {onAdd ? <button type="button" onClick={onAdd} aria-label={`Add to ${label}`} className="inline-flex h-7 w-7 items-center justify-center rounded-md text-ink-2 hover:bg-hover hover:text-ink"><Plus className="w-3.5 h-3.5" /></button> : null}
      </div>
      <ul className="p-1.5 space-y-0.5 min-h-[40px]">{children}</ul>
    </div>
  );
}

function BoundaryRow({ b, canEdit, busy, onRemove, onRequest }: { b: Boundary; canEdit: boolean; busy: boolean; onRemove: () => void; onRequest?: () => void }) {
  return (
    <li className="group/br flex items-center gap-1.5 px-2 py-1.5 rounded-md hover:bg-hover text-base text-ink">
      <span className="flex-1 min-w-0">
        <span className="block truncate" title={b.area.name}>{b.area.name}</span>
        {b.area.ownerRole ? <span className="block text-xs text-ink-2 truncate">owner · {b.area.ownerRole.title}</span> : <span className="block text-xs text-warning-text">No owner set</span>}
      </span>
      {onRequest ? <button type="button" onClick={onRequest} title="Raise a request to the owner" className="opacity-0 group-hover/br:opacity-100 text-xs text-[var(--os-brand)] hover:underline">Request</button> : null}
      {canEdit ? <button type="button" disabled={busy} onClick={onRemove} className="text-ink-3 hover:text-danger-text" title="Remove from this list" aria-label="Remove"><X className="w-3.5 h-3.5" /></button> : null}
    </li>
  );
}

function AddBoundary({ areas, roles, relation, busy, onClose, onPick }: { areas: Area[]; roles: { id: string; title: string }[]; relation: string; busy: boolean; onClose: () => void; onPick: (areaId: string) => void }) {
  const [q, setQ] = useState("");
  const { toast } = useOsToast();
  const [creating, setCreating] = useState(false);
  const [newName, setNewName] = useState("");
  const [newOwner, setNewOwner] = useState("");
  const [savingNew, setSavingNew] = useState(false);
  const createArea = async () => {
    const name = newName.trim();
    if (!name || !newOwner || savingNew) return;
    setSavingNew(true);
    try {
      const res = await fetch("/api/ownership-areas", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ name, ownerRoleId: newOwner }),
      });
      const d = await res.json().catch(() => ({}));
      if (!res.ok) { toast(d?.error ?? "Couldn't create the area"); return; }
      const created = d?.data ?? d;
      if (created?.id) onPick(created.id);
    } finally { setSavingNew(false); }
  };
  const filtered = areas.filter((a) => !q.trim() || a.name.toLowerCase().includes(q.trim().toLowerCase()) || (a.ownerRole?.title ?? "").toLowerCase().includes(q.trim().toLowerCase()));
  return (
    <Dialog open onOpenChange={(v) => { if (!v) onClose(); }}>
      <DialogContent className="max-w-[560px]">
        <DialogHeader>
          <DialogTitle>{relation === "CAN_REQUEST" ? "Can request" : "Cannot touch"}: pick an area</DialogTitle>
        </DialogHeader>
        <p className="text-xs text-ink-2 mb-2">
          {relation === "CAN_REQUEST"
            ? "This role will be able to raise requests to the area's owner, never edit it directly."
            : "This role is explicitly barred from the area, even requests are off the table."}
        </p>
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Search areas or owners…"
          className="mb-2 w-full h-8 px-2.5 rounded-md border border-line text-sm focus:outline-none focus:border-[var(--os-brand)]"
        />
        {areas.length === 0 ? (
          <p className="px-1 py-4 text-xs text-ink-2">
            No areas owned by other roles yet. Areas are defined on the owning role&apos;s page: open that job title and add them under <span className="font-medium text-ink-2">Owns</span>.
          </p>
        ) : filtered.length === 0 ? (
          <p className="px-1 py-4 text-xs text-ink-2">Nothing matches.</p>
        ) : null}
        <ul className="max-h-[240px] overflow-y-auto -mx-1">
          {filtered.map((a) => (
            <li key={a.id}>
              <button type="button" disabled={busy} onClick={() => onPick(a.id)} className="w-full flex items-center gap-2 px-2 py-1.5 rounded-md text-left text-base hover:bg-hover">
                <span className="flex-1 min-w-0"><span className="block truncate">{a.name}</span>{a.ownerRole ? <span className="block text-xs text-ink-2">owner · {a.ownerRole.title}</span> : null}</span>
              </button>
            </li>
          ))}
        </ul>
        <div className="mt-2 border-t border-line-soft pt-2">
          {creating ? (
            <div className="space-y-1.5">
              <input
                value={newName}
                onChange={(e) => setNewName(e.target.value)}
                autoFocus
                placeholder="New area name (e.g. Quote pricing rules)"
                className="w-full h-8 px-2.5 rounded-md border border-line text-sm focus:outline-none focus:border-[var(--os-brand)]"
              />
              <select
                value={newOwner}
                onChange={(e) => setNewOwner(e.target.value)}
                className="w-full h-8 px-2 rounded-md border border-line text-sm text-ink focus:outline-none focus:border-[var(--os-brand)]"
              >
                <option value="">Owner role…</option>
                {roles.map((r) => <option key={r.id} value={r.id}>{r.title}</option>)}
              </select>
              <div className="flex justify-end gap-2">
                <button type="button" onClick={() => setCreating(false)} className="h-7 px-2.5 rounded-md text-xs text-ink-2 hover:bg-hover">Cancel</button>
                <button type="button" disabled={savingNew || !newName.trim() || !newOwner} onClick={() => void createArea()} className="h-7 px-3 rounded-md text-xs font-medium text-white bg-[var(--os-brand)] hover:bg-[var(--os-brand-hover)] disabled:opacity-50">
                  {savingNew ? "Creating…" : "Create and add"}
                </button>
              </div>
            </div>
          ) : (
            <button type="button" onClick={() => setCreating(true)} className="w-full flex items-center gap-1.5 px-2 py-1.5 rounded-md text-left text-sm text-[var(--os-brand)] hover:bg-hover">
              <Plus className="w-3.5 h-3.5" /> New area…
            </button>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}

function Empty({ children }: { children: React.ReactNode }) {
  return <li className="px-2 py-1.5 text-xs text-ink-2">{children}</li>;
}

// ─────────────────────────── KRAs & KPIs (the role's alignment template) ───────────────────────────
//
// KRA = heading card (a container: name + description, no number, no
// progress bar). KPI = gauge row underneath: direction of good, healthy
// line (nullable, "no baseline yet", never invented), OWNED/SHARED,
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
        className="w-6 h-6 grid place-items-center rounded-md text-ink-2 hover:bg-hover hover:text-ink shrink-0"
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

/** The KPI's healthy line as copy, never invents a number. */
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
  const onSaved = (msg: string) => { toast(msg); router.refresh(); };

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
      description: "The gauge AND every recorded reading on it, for every person, are permanently deleted. Goal key results linked to it fall back to hand check-ins. This cannot be undone.",
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
            className="inline-flex items-center gap-1 h-7 px-2.5 rounded-md text-sm font-medium text-white bg-[var(--os-brand)] hover:bg-[var(--os-brand-hover)]"
          >
            <Plus className="w-3.5 h-3.5" /> Add KRA
          </button>
        </div>
      ) : undefined}
    >
      <div className="flex items-center justify-between gap-3 mb-3 -mt-1">
        <p className="text-xs text-ink-2">
          Every person with this job title inherits these. Quarterly targets live
          on each person&rsquo;s goals.
        </p>
        {bundle.kras.length > 0 ? (
          totalWeight !== 100 ? (
            <span className="shrink-0" title="Sum of this job title's KRA weights. Aim for 100%.">
              <ToneChip tone="warning" label={`Weights total ${totalWeight}%`} />
            </span>
          ) : (
            <span className="shrink-0 text-xs tabular-nums text-ink-2" title="Sum of this job title's KRA weights.">Weights total 100%</span>
          )
        ) : null}
      </div>

      {bundle.kras.length === 0 ? (
        <p className="text-base text-ink-2 py-2">
          No KRAs yet. Add the first area of responsibility this job title owns.
        </p>
      ) : (
        <div className="space-y-3">
          {bundle.kras.map((k) => (
            <section key={k.id} className="rounded-lg border border-line">
              {/* KRA heading, a container: no number, no progress bar. */}
              <header className="flex items-start gap-2.5 px-3 pt-2.5 pb-2">
                <Target className="w-4 h-4 text-ink-2 shrink-0 mt-0.5" />
                <div className="min-w-0 flex-1">
                  <h3 className="text-base font-semibold text-ink truncate" title={k.name}>{k.name}</h3>
                  {k.description ? (
                    <p className="text-sm text-ink-2 leading-snug mt-0.5">{k.description}</p>
                  ) : null}
                </div>
                <span
                  className={`text-sm font-mono tabular-nums shrink-0 mt-0.5 ${k.weight ? "text-ink" : "text-ink-2"}`}
                  title="Job title weight: every holder inherits this share as their starting weightage"
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
                <ul className="border-t border-line-soft">
                  {k.kpis.map((p) => {
                    const dir = resolvedDirection(p);
                    const DirIcon = DIRECTION_META[dir].icon;
                    const line = healthyLine(p);
                    const shared = p.ownership === "SHARED";
                    return (
                      <li key={p.id} className="flex items-start gap-2.5 px-3 py-2 border-b border-line-soft last:border-b-0">
                        {p.isNorthStar ? (
                          <Star className="w-3.5 h-3.5 mt-0.5 text-ink shrink-0" style={{ fill: "currentColor" }} aria-label="North-star gauge" />
                        ) : (
                          <Gauge className="w-3.5 h-3.5 mt-0.5 text-ink-3 shrink-0" />
                        )}
                        <span className="min-w-0 flex-1">
                          <span className="block text-base text-ink truncate" title={p.name}>{p.name}</span>
                          <span className="block text-xs text-ink-2 truncate">
                            {[
                              p.unit,
                              shared ? "influenced · reviewed, not graded" : null,
                              p.baselineValue != null ? `baseline ${p.baselineValue}` : null,
                            ].filter(Boolean).join(" · ") || " "}
                          </span>
                          {p.description ? (
                            <p className="text-xs text-ink-2 leading-snug mt-1 whitespace-pre-wrap break-words">{p.description}</p>
                          ) : null}
                        </span>
                        <DirIcon className="w-3.5 h-3.5 mt-0.5 text-ink-2 shrink-0" aria-label={DIRECTION_META[dir].hint} />
                        {line ? (
                          <span className="text-sm font-mono text-ink shrink-0" title={`Healthy line: ${DIRECTION_META[dir].hint.toLowerCase()}`}>{line}</span>
                        ) : (
                          <span className="text-xs italic text-ink-2 shrink-0">no baseline yet</span>
                        )}
                        <span className="shrink-0" title={shared ? "Influenced by this job title: reviewed, not graded" : "Controlled by this job title: graded"}>
                          <Chip>{shared ? "Shared" : "Owned"}</Chip>
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
                <p className="border-t border-line-soft px-3 py-2 text-xs text-ink-2">
                  No gauges yet. How will this area be measured?
                </p>
              )}

              {canEdit ? (
                <button
                  type="button"
                  onClick={() => setKpiDialog({ kraId: k.id, kraName: k.name })}
                  className="w-full flex items-center gap-1.5 px-3 py-1.5 border-t border-line-soft text-sm text-ink-2 hover:text-[var(--os-brand)] hover:bg-hover rounded-b-lg"
                >
                  <Plus className="w-3.5 h-3.5" /> Add KPI
                </button>
              ) : null}
            </section>
          ))}
        </div>
      )}

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
type SopOption = { id: string; title: string; kraId: string | null };

function SopCard({ bundle, canEdit }: { bundle: RoleBundle; canEdit: boolean }) {
  const router = useRouter();
  const { toast } = useOsToast();
  const sops = bundle.kras.flatMap((k) => k.sops.map((s) => ({ ...s, kraName: k.name, kraId: k.id })));
  const [step, setStep] = useState<null | "sop" | "kra">(null);
  const [options, setOptions] = useState<SopOption[] | null>(null);
  const [picked, setPicked] = useState<SopOption | null>(null);
  const [move, setMove] = useState<{ sop: SopOption; kraId: string; current: string } | null>(null);

  // The picker searches on the server as the person types (no row cap: an
  // org with thousands of SOPs finds any of them by name).
  const searchSeq = useRef(0);
  const searchTimer = useRef<number | null>(null);
  const fetchSops = async (term: string) => {
    const seq = ++searchSeq.current;
    const qs = new URLSearchParams({ status: "PUBLISHED", limit: "50" });
    if (term.trim()) qs.set("q", term.trim());
    const res = await fetch(`/api/sops?${qs.toString()}`, { cache: "no-store" }).catch(() => null);
    const d = res ? await res.json().catch(() => null) : null;
    if (seq !== searchSeq.current) return;
    const rows = (Array.isArray(d) ? d : d?.data ?? d?.sops ?? []) as Array<{ id: string; title: string; kraId?: string | null }>;
    setOptions(rows.map((r) => ({ id: r.id, title: r.title, kraId: r.kraId ?? null })));
  };
  const onSearch = (term: string) => {
    if (searchTimer.current) window.clearTimeout(searchTimer.current);
    searchTimer.current = window.setTimeout(() => { void fetchSops(term); }, 200);
  };
  const open = async () => {
    setStep("sop");
    if (options) return;
    await fetchSops("");
  };
  const link = async (sop: SopOption, kraId: string, force = false) => {
    setStep(null);
    const res = await fetch(`/api/kras/${kraId}/sops`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ sopId: sop.id, move: force }) });
    const d = await res.json().catch(() => ({}));
    if (res.status === 409 && d?.code === "linked_elsewhere") { setMove({ sop, kraId, current: d.currentKra ?? "another KRA" }); return; }
    if (!res.ok) { toast(d?.error ?? "Couldn't link the SOP"); return; }
    toast(`Linked ${sop.title}`);
    setPicked(null);
    router.refresh();
  };
  const choose = (sopId: string) => {
    const sop = options?.find((o) => o.id === sopId);
    if (!sop) return;
    // One KRA: link straight to it. Several: ask which.
    if (bundle.kras.length === 1) void link(sop, bundle.kras[0].id);
    else { setPicked(sop); setStep("kra"); }
  };
  const linked = new Set(sops.map((s) => s.id));
  return (
    <Card
      title="SOPs"
      icon={FileText}
      action={canEdit && bundle.kras.length > 0 ? (
        <div className="relative">
          <button type="button" onClick={() => void open()} className="inline-flex h-7 items-center gap-1 rounded-md px-2 text-sm font-medium text-ink-2 hover:bg-hover hover:text-ink"><Link2 className="h-3.5 w-3.5" aria-hidden />Link SOP</button>
          <Picker
            open={step === "sop"}
            onClose={() => setStep(null)}
            align="end"
            ariaLabel="Link SOP"
            searchPlaceholder="Search published SOPs"
            loading={options === null}
            onSearchChange={onSearch}
            emptyLabel="No published SOPs match"
            sections={[{ options: (options ?? []).filter((o) => !linked.has(o.id)).map((o) => ({ value: o.id, label: o.title })) }]}
            onSelect={choose}
            className="absolute end-0 top-9 z-50"
          />
          <Picker
            open={step === "kra"}
            onClose={() => { setStep(null); setPicked(null); }}
            align="end"
            ariaLabel="Which KRA?"
            searchPlaceholder="Which KRA?"
            sections={[{ label: "Which KRA?", options: bundle.kras.map((k) => ({ value: k.id, label: k.name })) }]}
            onSelect={(kraId) => { if (picked) void link(picked, kraId); }}
            className="absolute end-0 top-9 z-50"
          />
        </div>
      ) : undefined}
    >
      {sops.length === 0 ? (
        <p className="text-base text-ink-2 py-2">{bundle.kras.length === 0 ? "Add a KRA first: SOPs link to a KRA of this job title." : "No SOPs linked to this job title's KRAs."}</p>
      ) : (
        <ul className="space-y-0.5">
          {sops.map((s) => (
            <li key={s.id}>
              <Link href={`/sops/${s.id}`} className="flex min-h-11 items-center gap-2 px-2 rounded-md hover:bg-hover text-base">
                <FileText className="w-3.5 h-3.5 text-ink-2 shrink-0" />
                <span className="flex-1 min-w-0 truncate text-ink">{s.title}</span>
                <span className="text-xs text-ink-2 shrink-0">via {s.kraName}</span>
                <Chip>{s.status.charAt(0) + s.status.slice(1).toLowerCase()}</Chip>
              </Link>
            </li>
          ))}
        </ul>
      )}
      {move ? (
        <ConfirmDialog
          open
          onClose={() => setMove(null)}
          onConfirm={() => { const m = move; setMove(null); void link(m.sop, m.kraId, true); }}
          title={`Move ${move.sop.title} here?`}
          description={`It is linked to ${move.current} now. An SOP links to one KRA, so it leaves that one.`}
          confirmLabel="Move it here"
        />
      ) : null}
    </Card>
  );
}

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
    <Card title="Escalation thresholds" icon={Gauge} action={canEdit && !adding ? <button type="button" aria-label="Add threshold" onClick={() => setAdding(true)} className="text-ink-2 hover:text-ink"><Plus className="w-4 h-4" /></button> : undefined}>
      <p className="-mt-1 mb-2 text-sm text-ink-2">Not enforced yet. Nothing escalates from these until the escalation job reads them.</p>
      {bundle.thresholds.length === 0 && !adding ? (
        <p className="text-base text-ink-2 py-2">No thresholds.</p>
      ) : (
        <ul className="space-y-1">
          {bundle.thresholds.map((t) => (
            <li key={t.id} className="group/th flex items-center gap-2 px-2 py-1.5 rounded-md hover:bg-hover text-base">
              <span className="flex-1 min-w-0">
                <span className="block truncate text-ink">{t.label}</span>
                <span className="block text-xs text-ink-2 truncate">{t.trigger}</span>
              </span>
              <span className="font-mono text-ink shrink-0">{t.value}{t.unit ? ` ${t.unit}` : ""}</span>
              {canEdit ? <button type="button" disabled={busy} onClick={() => call(`/api/thresholds/${t.id}`, "DELETE")} className="opacity-0 group-hover/th:opacity-100 text-ink-2 hover:text-danger-text shrink-0"><Trash2 className="w-3.5 h-3.5" /></button> : null}
            </li>
          ))}
        </ul>
      )}
      {adding ? (
        <div className="mt-2 rounded-lg border border-line p-2.5 space-y-1.5">
          <input autoFocus value={draft.label} onChange={(e) => setDraft({ ...draft, label: e.target.value })} placeholder="Label (e.g. Unclaimed → nudge)" className="w-full text-base rounded border border-line px-2 py-1 outline-none focus:border-[var(--os-brand)]" />
          <input value={draft.trigger} onChange={(e) => setDraft({ ...draft, trigger: e.target.value })} placeholder="Trigger (e.g. order unclaimed)" className="w-full text-base rounded border border-line px-2 py-1 outline-none focus:border-[var(--os-brand)]" />
          <div className="flex items-center gap-1.5">
            <input value={draft.value} onChange={(e) => setDraft({ ...draft, value: e.target.value })} inputMode="decimal" placeholder="45" className="w-20 text-base font-mono rounded border border-line px-2 py-1 outline-none focus:border-[var(--os-brand)]" />
            <input value={draft.unit} onChange={(e) => setDraft({ ...draft, unit: e.target.value })} placeholder="min" className="w-16 text-base rounded border border-line px-2 py-1 outline-none focus:border-[var(--os-brand)]" />
            <div className="flex-1" />
            <button type="button" onClick={() => setAdding(false)} className="h-7 px-2.5 rounded-md text-sm text-ink-2 hover:bg-hover">Cancel</button>
            <button type="button" disabled={busy} onClick={submit} className="h-7 px-2.5 rounded-md text-sm font-medium text-white bg-[var(--os-brand)] hover:bg-[var(--os-brand-hover)] disabled:opacity-50">Add</button>
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
    <Card title="Instances" icon={UsersIcon} action={canEdit && !creating ? <button type="button" onClick={() => setCreating(true)} className="inline-flex items-center gap-1 h-7 px-2.5 rounded-md text-sm font-medium text-white bg-[var(--os-brand)] hover:bg-[var(--os-brand-hover)]"><Plus className="w-3.5 h-3.5" />New instance</button> : undefined}>
      <p className="text-xs text-ink-2 mb-3 -mt-1">Role × Scope, held by a person. Clone the definition per scope (Pool 1, Pool 2…) and compare.</p>

      {bundle.instances.length === 0 && !creating ? (
        <p className="text-base text-ink-2 py-2">No instances yet.</p>
      ) : (
        <ul className="space-y-1.5">
          {bundle.instances.map((i) => (
            <li key={i.id} className="group/inst flex items-center gap-3 px-3 py-2 rounded-lg border border-line hover:bg-hover">
              {i.user ? (
                <span className="w-7 h-7 rounded-full bg-line text-ink-2 text-xs font-medium inline-flex items-center justify-center shrink-0">{initials(i.user)}</span>
              ) : <span className="w-7 h-7 rounded-full bg-subtle text-ink-2 inline-flex items-center justify-center shrink-0"><UsersIcon className="w-3.5 h-3.5" /></span>}
              <span className="flex-1 min-w-0">
                <span className="block text-base text-ink truncate">{i.name || `${bundle.role.title}${i.scope ? ` · ${i.scope.name}` : ""}`}</span>
                <span className="block text-xs text-ink-2 truncate">{i.scope ? `${i.scope.dimension}: ${i.scope.name}` : "no scope"} · {personName(i.user)}</span>
              </span>
              {canEdit ? (
                <>
                  <button type="button" disabled={seedingId === i.id} onClick={() => applyDefinition(i)} className="inline-flex items-center gap-1 text-xs text-[var(--os-brand)] hover:underline shrink-0">
                    <Sparkles className="w-3 h-3" />Apply definition
                  </button>
                  <button type="button" disabled={busy} onClick={() => call(`/api/role-instances/${i.id}`, "DELETE")} className="opacity-0 group-hover/inst:opacity-100 text-ink-2 hover:text-danger-text shrink-0"><Trash2 className="w-3.5 h-3.5" /></button>
                </>
              ) : null}
            </li>
          ))}
        </ul>
      )}

      {creating ? (
        <div className="mt-3 rounded-lg border border-line p-3 space-y-2">
          <div className="flex items-center gap-2">
            <span className="text-xs text-ink-2 w-[64px]">Scope</span>
            <select value={scopeId} onChange={(e) => setScopeId(e.target.value)} className="flex-1 text-base rounded-md border border-line px-2 py-1.5 outline-none focus:border-[var(--os-brand)]">
              <option value="">No scope</option>
              {bundle.scopes.map((s) => <option key={s.id} value={s.id}>{s.dimension}: {s.name}</option>)}
              <option value="__new__">+ New scope…</option>
            </select>
          </div>
          {scopeId === "__new__" ? (
            <div className="flex items-center gap-2 pl-[72px]">
              <input value={newScope.name} onChange={(e) => setNewScope({ ...newScope, name: e.target.value })} placeholder="Scope name (e.g. Pool 1)" className="flex-1 text-base rounded-md border border-line px-2 py-1.5 outline-none focus:border-[var(--os-brand)]" />
              <input value={newScope.dimension} onChange={(e) => setNewScope({ ...newScope, dimension: e.target.value })} placeholder="dimension" className="w-28 text-base rounded-md border border-line px-2 py-1.5 outline-none focus:border-[var(--os-brand)]" />
            </div>
          ) : null}
          <div className="flex items-center gap-2">
            <span className="text-xs text-ink-2 w-[64px]">Person</span>
            <select value={userId} onChange={(e) => setUserId(e.target.value)} className="flex-1 text-base rounded-md border border-line px-2 py-1.5 outline-none focus:border-[var(--os-brand)]">
              <option value="">Unassigned</option>
              {bundle.orgUsers.map((p) => <option key={p.id} value={p.id}>{personName(p)}</option>)}
            </select>
          </div>
          <div className="flex justify-end gap-1.5">
            <button type="button" onClick={() => setCreating(false)} className="h-7 px-2.5 rounded-md text-sm text-ink-2 hover:bg-hover">Cancel</button>
            <button type="button" disabled={busy} onClick={createInstance} className="h-7 px-2.5 rounded-md text-sm font-medium text-white bg-[var(--os-brand)] hover:bg-[var(--os-brand-hover)] disabled:opacity-50">Create instance</button>
          </div>
        </div>
      ) : null}
    </Card>
  );
}
