"use client";

// Alignment (spec-goals /team/alignment) and the shared row table the
// Sub-teams view reuses for its "Direct reports without a team" group.
//
// One line per person: Person · Job title · Report type · KRAs · Weights ·
// KPI compliance · SOP read-rate · This week's review (the row's one chip) ·
// Actions (Approve and Request changes on a submitted review). Row click opens
// the person's KRAs & KPIs (/people/[id]?tab=kras). Row "...": Open profile ·
// Open weekly review · Open KPI reviews for {first name} · Message (Talk on).
// Approve needs no dialog and offers Undo (REOPEN on the same route);
// Request changes asks for the note first (RequestChangesPopover). Both
// write PATCH /api/weekly-reviews/[id]/manager-review, the one route.
//
// Filter (Report type, Weekly review, KPI compliance, SOP read-rate,
// Mandatory SOPs pending, KRA weights not 100%, Direct reports only) and Sort
// (review status, most urgent first; Name; KPI compliance; SOP read-rate)
// are local to the page; Display > Show KRA names persists to
// home.alignment.showKraNames.

import { useCallback, useEffect, useMemo, useRef, useState, type RefObject } from "react";
import { useRouter } from "next/navigation";
import { ClipboardCheck, ExternalLink, Gauge, MessageCircle, MoreHorizontal } from "lucide-react";
import { OsPageHeader } from "@/components/layout/os/page-header";
import { OsEmptyView } from "@/components/layout/os/empty-view";
import { MorePortal } from "@/components/layout/os/more-portal";
import { useOsShell } from "@/components/layout/os/shell-context";
import { useOsToast } from "@/components/layout/os/toast";
import { useBoot } from "@/components/layout/os/boot-context";
import { MenuItem, MenuList } from "@/components/ui/menu";
import { TableCard, type TableColumn } from "@/components/ui/table-card";
import { ViewTab } from "@/components/ui/view-tabs";
import { Picker } from "@/components/ui/picker";
import { FilterGroup, FilterPanel, FilterRow } from "@/components/ui/filter-panel";
import { Avatar } from "@/components/ui/avatar-stack";
import { ToneChip } from "@/components/people/person-bits";
import { RequestChangesPopover } from "@/components/team/request-changes-popover";
import { apiFetch } from "@/lib/api-fetch";
import { complianceTextClass, complianceWord, type ComplianceBand } from "@/lib/alignment-tone";
import { alignmentSurfacePrefs, type AlignmentSurfacePrefs } from "@/lib/people-prefs";
import {
  EMPTY_ALIGNMENT_FILTER, alignmentFilterCount, kraWeightTotal, matchesAlignmentFilter, reviewUrgency, weeklyReviewChip,
  type AlignmentFilter, type WeeklyKey, type WeeklyManagerStatus, type WeeklyStatus,
} from "@/lib/people/alignment-rows";

export interface AlignmentPerson {
  id: string;
  firstName: string;
  lastName: string;
  email: string;
  avatar: string | null;
  via: "solid" | "dotted";
  jobTitle: string | null;
  direct: boolean;
  activeKras: Array<{ id: string; name: string; weightage: number }>;
  kpis: { compliancePct: number | null; total: number; submitted: number; approved: number };
  sops: { readRatePct: number | null; mandatoryPending: number; total: number; completed: number };
  weeklyReview: { id: string | null; status: WeeklyStatus; managerStatus: WeeklyManagerStatus };
}

export type AlignmentSort = "urgency" | "name" | "kpi" | "sop";
export const ALIGNMENT_SORTS: Array<{ value: AlignmentSort; label: string }> = [
  { value: "urgency", label: "Review status" },
  { value: "name", label: "Name" },
  { value: "kpi", label: "KPI compliance" },
  { value: "sop", label: "SOP read-rate" },
];

const BANDS: Array<{ value: ComplianceBand; label: string }> = [
  { value: "low", label: "Below 50%" },
  { value: "mid", label: "50 to 79%" },
  { value: "high", label: "80% and up" },
  { value: "none", label: "Not measured" },
];
const WEEKLY: Array<{ value: WeeklyKey; label: string }> = [
  { value: "not_started", label: "Not started" },
  { value: "draft", label: "Draft" },
  { value: "submitted", label: "Submitted, awaiting you" },
  { value: "approved", label: "Approved" },
  { value: "changes", label: "Changes requested" },
];

const fullName = (p: { firstName: string; lastName: string; email: string }) => `${p.firstName ?? ""} ${p.lastName ?? ""}`.trim() || p.email;

export function useAlignmentPrefs() {
  const { prefs, patchPrefs } = useOsShell();
  const { toast } = useOsToast();
  const stored = alignmentSurfacePrefs(prefs.home);
  const [local, setLocal] = useState<Partial<AlignmentSurfacePrefs>>({});
  const set = useCallback((patch: Partial<AlignmentSurfacePrefs>) => {
    setLocal((l) => ({ ...l, ...patch }));
    void patchPrefs({ home: { alignment: patch } }).then((ok) => { if (!ok) toast("Couldn't save that setting. It applies until you leave.", { tone: "danger" }); });
  }, [patchPrefs, toast]);
  return [{ ...stored, ...local }, set] as const;
}

export function sortAlignment<T extends AlignmentPerson>(rows: readonly T[], sort: AlignmentSort): T[] {
  const out = [...rows];
  const pct = (v: number | null) => (v == null ? Infinity : v);
  out.sort((a, b) =>
    sort === "name" ? fullName(a).localeCompare(fullName(b))
      : sort === "kpi" ? pct(a.kpis.compliancePct) - pct(b.kpis.compliancePct) || fullName(a).localeCompare(fullName(b))
        : sort === "sop" ? pct(a.sops.readRatePct) - pct(b.sops.readRatePct) || fullName(a).localeCompare(fullName(b))
          : reviewUrgency(a.weeklyReview) - reviewUrgency(b.weeklyReview) || fullName(a).localeCompare(fullName(b)));
  return out;
}

/** The Filter panel groups shared by Alignment and Sub-teams. */
export function AlignmentFilterGroups({ filter, setFilter, withWeights = true, withDirect = true }: {
  filter: AlignmentFilter;
  setFilter: (f: AlignmentFilter) => void;
  withWeights?: boolean;
  withDirect?: boolean;
}) {
  const tog = <K extends keyof AlignmentFilter>(key: K, val: AlignmentFilter[K] extends Array<infer V> ? V : never, on: boolean) => {
    const list = filter[key] as unknown as unknown[];
    setFilter({ ...filter, [key]: on ? [...list, val] : list.filter((x) => x !== val) });
  };
  return (
    <>
      <FilterGroup label="Report type">
        <FilterRow label="Solid" checked={filter.via.includes("solid")} onCheckedChange={(on) => tog("via", "solid", on)} />
        <FilterRow label="Dotted" checked={filter.via.includes("dotted")} onCheckedChange={(on) => tog("via", "dotted", on)} />
        {withDirect ? <FilterRow label="Direct reports only" checked={filter.directOnly} onCheckedChange={(on) => setFilter({ ...filter, directOnly: on })} /> : null}
      </FilterGroup>
      <FilterGroup label="Weekly review">
        {WEEKLY.map((w) => <FilterRow key={w.value} label={w.label} checked={filter.weekly.includes(w.value)} onCheckedChange={(on) => tog("weekly", w.value, on)} />)}
      </FilterGroup>
      <FilterGroup label="KPI compliance">
        {BANDS.map((b) => <FilterRow key={b.value} label={b.label} checked={filter.kpiBands.includes(b.value)} onCheckedChange={(on) => tog("kpiBands", b.value, on)} />)}
      </FilterGroup>
      <FilterGroup label="SOP read-rate">
        {BANDS.map((b) => <FilterRow key={b.value} label={b.label} checked={filter.sopBands.includes(b.value)} onCheckedChange={(on) => tog("sopBands", b.value, on)} />)}
        <FilterRow label="Mandatory SOPs pending" checked={filter.mandatoryPending} onCheckedChange={(on) => setFilter({ ...filter, mandatoryPending: on })} />
      </FilterGroup>
      {withWeights ? (
        <FilterGroup label="KRAs">
          <FilterRow label="KRA weights not 100%" checked={filter.weightsOff} onCheckedChange={(on) => setFilter({ ...filter, weightsOff: on })} />
        </FilterGroup>
      ) : null}
    </>
  );
}

export function PctCell({ pct, of, pending }: { pct: number | null; of?: string; pending?: number }) {
  if (pct == null) return <span className="text-ink-2">Not measured</span>;
  return (
    <span className="tabular-nums" title={`${complianceWord(pct)}${of ? ` · ${of}` : ""}`}>
      <span className={complianceTextClass(pct)}>{pct}%</span>
      {pending ? <> · <span className="text-danger-text">{pending} pending</span></> : null}
    </span>
  );
}

/** Approve / Request changes on a submitted weekly review, with Undo. */
function WeeklyActions({ person, onChanged }: { person: AlignmentPerson; onChanged: (patch: Partial<AlignmentPerson["weeklyReview"]>) => void }) {
  const { toast } = useOsToast();
  const [asking, setAsking] = useState(false);
  const [busy, setBusy] = useState(false);
  const id = person.weeklyReview.id;
  if (!id || person.weeklyReview.status !== "SUBMITTED") return null;
  const decide = async (decision: "APPROVED" | "CHANGES_REQUESTED" | "REOPEN", notes?: string) => {
    const r = await apiFetch(`/api/weekly-reviews/${id}/manager-review`, { method: "PATCH", json: { decision, notes } });
    if (!r.ok) toast(r.error || "Couldn't save the decision", { tone: "danger" });
    return r.ok;
  };
  const first = person.firstName || fullName(person);
  return (
    <span className="relative flex items-center gap-1" onClick={(e) => { e.preventDefault(); e.stopPropagation(); }}>
      <button type="button" disabled={busy}
        onClick={async () => {
          setBusy(true);
          const ok = await decide("APPROVED");
          setBusy(false);
          if (!ok) return;
          onChanged({ status: "ACKNOWLEDGED", managerStatus: "APPROVED" });
          toast(`Approved ${first}'s review`, {
            onUndo: () => { void decide("REOPEN").then((undone) => { if (undone) onChanged({ status: "SUBMITTED", managerStatus: "PENDING" }); }); },
          });
        }}
        className="inline-flex h-7 shrink-0 items-center whitespace-nowrap rounded-md border border-line bg-raised px-2 text-sm font-medium text-ink hover:bg-hover disabled:opacity-50">
        Approve
      </button>
      <button type="button" disabled={busy} onClick={() => setAsking(true)}
        className="inline-flex h-7 shrink-0 items-center whitespace-nowrap rounded-md px-1.5 text-sm font-medium text-ink-2 hover:bg-hover hover:text-ink disabled:opacity-50">
        Request changes
      </button>
      {asking ? (
        <div className="absolute end-0 top-8 z-50">
          <RequestChangesPopover personFirstName={first} align="end" busy={busy}
            onCancel={() => setAsking(false)}
            onSend={async (note) => {
              setBusy(true);
              const ok = await decide("CHANGES_REQUESTED", note);
              setBusy(false);
              if (ok) { setAsking(false); onChanged({ status: "ACKNOWLEDGED", managerStatus: "CHANGES_REQUESTED" }); toast(`Sent ${first} your note`); }
              return ok;
            }} />
        </div>
      ) : null}
    </span>
  );
}

/** The one-line-per-person table (Alignment, and Sub-teams' direct ICs). */
export function AlignmentTable({ people, showKraNames, ariaLabel, empty, className }: {
  people: AlignmentPerson[] | null;
  showKraNames: boolean;
  ariaLabel: string;
  empty?: React.ReactNode;
  className?: string;
}) {
  const router = useRouter();
  const { boot } = useBoot();
  const talkOn = boot.launcherApps.includes("chat");
  const { toast } = useOsToast();
  const [overrides, setOverrides] = useState<Record<string, Partial<AlignmentPerson["weeklyReview"]>>>({});
  const [menu, setMenu] = useState<{ row: AlignmentPerson; anchor: RefObject<HTMLElement | null> } | null>(null);
  const rows = useMemo(() => people?.map((p) => (overrides[p.id] ? { ...p, weeklyReview: { ...p.weeklyReview, ...overrides[p.id] } } : p)) ?? null, [people, overrides]);

  const columns = useMemo<TableColumn<AlignmentPerson>[]>(() => [
    { key: "person", label: "Person", title: true, width: "minmax(200px,1.4fr)", render: (p) => (
      <span className="flex min-w-0 items-center gap-2"><Avatar person={p} size={24} /><span className="truncate">{fullName(p)}</span></span>
    ) },
    { key: "title", label: "Job title", width: "minmax(120px,1fr)", hideBelow: 1280, render: (p) => <span className="truncate text-sm text-ink-2">{p.jobTitle ?? "No job title"}</span> },
    { key: "via", label: "Report type", width: "100px", hideBelow: 1280, render: (p) => <span className="text-sm text-ink-2">{p.via === "dotted" ? "Dotted" : "Solid"}</span> },
    { key: "kras", label: "KRAs", width: showKraNames ? "minmax(160px,1.2fr)" : "70px", render: (p) => (
      <span className="truncate tabular-nums" title={p.activeKras.map((k) => `${k.name} ${Math.round(k.weightage)}%`).join(", ")}>
        {p.activeKras.length}{showKraNames && p.activeKras.length ? ` · ${p.activeKras.map((k) => `${k.name} ${Math.round(k.weightage)}%`).join(", ")}` : ""}
      </span>
    ) },
    { key: "weights", label: "Weights", width: "130px", hideBelow: 1280, render: (p) => {
      if (!p.activeKras.length) return <span className="text-ink-2">None</span>;
      const w = kraWeightTotal(p.activeKras);
      return w === 100 ? <span className="tabular-nums">100%</span> : <span className="tabular-nums text-warning-text">{w}% not 100%</span>;
    } },
    { key: "kpi", label: "KPI compliance", width: "130px", render: (p) => <PctCell pct={p.kpis.compliancePct} of={`${p.kpis.submitted + p.kpis.approved} of ${p.kpis.total} on time`} /> },
    { key: "sop", label: "SOP read-rate", width: "150px", hideBelow: 900, render: (p) => <PctCell pct={p.sops.readRatePct} of={`${p.sops.completed} of ${p.sops.total} read`} pending={p.sops.mandatoryPending} /> },
    { key: "review", label: "This week's review", width: "160px", render: (p) => { const c = weeklyReviewChip(p.weeklyReview); return <ToneChip tone={c.tone} label={c.label} />; } },
    { key: "actions", label: "", width: "220px", render: (p) => <WeeklyActions person={p} onChanged={(patch) => setOverrides((o) => ({ ...o, [p.id]: { ...o[p.id], ...patch } }))} /> },
  ], [showKraNames]);

  const message = async (id: string) => {
    const r = await apiFetch<{ id?: string; data?: { id?: string } }>("/api/conversations", { method: "POST", json: { type: "DM", memberIds: [id] } });
    const cid = r.ok ? r.data.id ?? r.data.data?.id : null;
    if (cid) router.push(`/tlk/${cid}`);
    else toast(r.ok ? "Couldn't open the conversation" : r.error || "Couldn't open the conversation", { tone: "danger" });
  };

  return (
    <>
      <TableCard
        className={className}
        ariaLabel={ariaLabel}
        columns={columns}
        rows={rows}
        rowKey={(p) => p.id}
        rowHref={(p) => `/people/${p.id}?tab=kras`}
        rowMenu={(p) => (
          <button type="button" aria-label={`Actions for ${fullName(p)}`} aria-haspopup="menu"
            onClick={(e) => { e.preventDefault(); e.stopPropagation(); setMenu({ row: p, anchor: { current: e.currentTarget } }); }}
            className="inline-flex h-8 w-8 items-center justify-center rounded-md text-ink-2 hover:bg-hover hover:text-ink">
            <MoreHorizontal className="h-4 w-4" />
          </button>
        )}
        empty={empty}
        footer={rows ? { total: rows.length, noun: "people", from: rows.length ? 1 : 0, to: rows.length } : undefined}
      />
      {menu ? (
        <MorePortal anchorRef={menu.anchor} width={240} open placement="below" onClose={() => setMenu(null)}>
          <MenuList aria-label={`Actions for ${fullName(menu.row)}`}>
            <MenuItem icon={ExternalLink} label="Open profile" onClick={() => { const id = menu.row.id; setMenu(null); router.push(`/people/${id}?tab=kras`); }} />
            <MenuItem icon={ClipboardCheck} label="Open weekly review" onClick={() => { const id = menu.row.id; setMenu(null); router.push(`/team/reviews?person=${id}`); }} />
            <MenuItem icon={Gauge} label={`Open KPI reviews for ${menu.row.firstName || fullName(menu.row)}`} onClick={() => { const id = menu.row.id; setMenu(null); router.push(`/team/kpi-reviews?person=${id}`); }} />
            {talkOn ? <MenuItem icon={MessageCircle} label="Message" onClick={() => { const id = menu.row.id; setMenu(null); void message(id); }} /> : null}
          </MenuList>
        </MorePortal>
      ) : null}
    </>
  );
}

/** The whole /team/alignment page (header, filter, table). */
export function AlignmentView({ people, hasSubTeams, drill }: {
  people: AlignmentPerson[];
  hasSubTeams: boolean;
  /** ?manager= drill-down: that manager's name (the views row does not render). */
  drill?: { name: string } | null;
}) {
  const router = useRouter();
  const [display, setDisplay] = useAlignmentPrefs();
  const [filter, setFilter] = useState<AlignmentFilter>(EMPTY_ALIGNMENT_FILTER);
  const [sort, setSort] = useState<AlignmentSort>("urgency");
  const [sortOpen, setSortOpen] = useState(false);
  const [filterOpen, setFilterOpen] = useState(false);
  const refreshed = useRef(0);
  // Decisions made elsewhere (the weekly queue, another tab) show on return.
  useEffect(() => {
    const onFocus = () => { if (Date.now() - refreshed.current > 5000) { refreshed.current = Date.now(); router.refresh(); } };
    window.addEventListener("focus", onFocus);
    return () => window.removeEventListener("focus", onFocus);
  }, [router]);

  const shown = useMemo(() => sortAlignment(people.filter((p) => matchesAlignmentFilter({
    via: p.via, direct: p.direct, activeKras: p.activeKras, kpiPct: p.kpis.compliancePct, sopPct: p.sops.readRatePct,
    mandatoryPending: p.sops.mandatoryPending, weekly: p.weeklyReview,
  }, filter)), sort), [people, filter, sort]);
  const count = alignmentFilterCount(filter);

  return (
    <>
      <OsPageHeader
        title={drill ? `${drill.name}'s team` : "Alignment"}
        back={drill ? { fallbackHref: "/team/rollup", label: "Sub-teams" } : undefined}
        views={!drill && hasSubTeams ? (
          <>
            <ViewTab label="My reports" active href="/team/alignment" />
            <ViewTab label="Sub-teams" href="/team/rollup" />
          </>
        ) : undefined}
        toolbar={{
          filter: { open: filterOpen, onToggle: () => setFilterOpen((x) => !x), count },
          sort: { onClick: () => setSortOpen((x) => !x), label: sort === "urgency" ? "Sort" : ALIGNMENT_SORTS.find((s) => s.value === sort)?.label, active: sort !== "urgency" },
          menu: [{ label: "Show KRA names", checked: display.showKraNames, keepOpen: true, onClick: () => setDisplay({ showKraNames: !display.showKraNames }) }],
        }}
      />
      <div className="relative">
        {sortOpen ? (
          <div className="absolute start-[110px] top-0 z-40">
            <Picker open onClose={() => setSortOpen(false)} ariaLabel="Sort people" selected={sort}
              sections={[{ options: ALIGNMENT_SORTS.map((s) => ({ value: s.value, label: s.label })) }]}
              onSelect={(v) => { setSortOpen(false); setSort(v as AlignmentSort); }} />
          </div>
        ) : null}
      </div>
      <div className="os-chrome flex min-h-0 flex-1 gap-4 px-6 pb-8 pt-2">
        <FilterPanel open={filterOpen} onClose={() => setFilterOpen(false)} objects="people" activeCount={count} onClearAll={() => setFilter(EMPTY_ALIGNMENT_FILTER)}>
          <AlignmentFilterGroups filter={filter} setFilter={setFilter} />
        </FilterPanel>
        <div className="flex min-w-0 flex-1 flex-col gap-3">
          {people.length === 0 ? (
            <OsEmptyView context="goals" title="Nobody has a manager yet" action={{ label: "See the org chart", href: "/organization" }} />
          ) : (
            <AlignmentTable people={shown} showKraNames={display.showKraNames} ariaLabel="Your reports"
              empty={<span className="text-row text-ink-2">Nobody matches · <button type="button" className="text-brand-deep hover:underline" onClick={() => setFilter(EMPTY_ALIGNMENT_FILTER)}>Clear filters</button></span>} />
          )}
        </div>
      </div>
    </>
  );
}
