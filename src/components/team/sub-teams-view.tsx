"use client";

// Sub-teams (spec-goals /team/rollup): the second view of Alignment. One
// line per manager under the viewer: Manager · Job title · Report type ·
// People (their direct reports; the tooltip says so) · KRAs · KPI compliance
// · SOP read-rate · Reviews submitted ("83% · 4 of 6") · Their own review
// (the row's one chip). A row drills into that manager's team
// (/team/alignment?manager={id}). The second group, "Direct reports without a
// team", is the Alignment table itself, so Approve and Request changes work
// the same in both places. A one-line summary sits above the card; the six
// stat tiles it replaces had the same numbers.

import { useMemo, useState, type RefObject } from "react";
import { useRouter } from "next/navigation";
import { ExternalLink, Gauge, MessageCircle, MoreHorizontal, Users } from "lucide-react";
import { OsPageHeader } from "@/components/layout/os/page-header";
import { OsEmptyView } from "@/components/layout/os/empty-view";
import { MorePortal } from "@/components/layout/os/more-portal";
import { useBoot } from "@/components/layout/os/boot-context";
import { useOsToast } from "@/components/layout/os/toast";
import { MenuItem, MenuList } from "@/components/ui/menu";
import { TableCard, type TableColumn } from "@/components/ui/table-card";
import { ViewTab } from "@/components/ui/view-tabs";
import { Picker } from "@/components/ui/picker";
import { FilterPanel } from "@/components/ui/filter-panel";
import { Avatar } from "@/components/ui/avatar-stack";
import { ToneChip } from "@/components/people/person-bits";
import { apiFetch } from "@/lib/api-fetch";
import { EMPTY_ALIGNMENT_FILTER, alignmentFilterCount, matchesAlignmentFilter, reviewUrgency, weeklyReviewChip, type AlignmentFilter, type WeeklyManagerStatus, type WeeklyStatus } from "@/lib/people/alignment-rows";
import { AlignmentFilterGroups, AlignmentTable, PctCell, sortAlignment, useAlignmentPrefs, type AlignmentPerson } from "./alignment-view";

export interface SubTeamRow {
  id: string;
  firstName: string;
  lastName: string;
  email: string;
  avatar: string | null;
  via: "solid" | "dotted";
  jobTitle: string | null;
  ownReview: { status: WeeklyStatus; managerStatus: WeeklyManagerStatus };
  metrics: { reportCount: number; activeKras: number; avgKpiCompliancePct: number | null; avgSopReadRatePct: number | null; weeklyReviewSubmittedPct: number; weeklyReviewApprovedPct: number };
}

type Sort = "attention" | "name" | "people";
const SORTS: Array<{ value: Sort; label: string }> = [
  { value: "attention", label: "Needs attention first" },
  { value: "name", label: "Name" },
  { value: "people", label: "People" },
];
const nameOf = (p: { firstName: string; lastName: string; email: string }) => `${p.firstName ?? ""} ${p.lastName ?? ""}`.trim() || p.email;

export function SubTeamsView({ subTeams, directIcs, totals }: {
  subTeams: SubTeamRow[];
  directIcs: AlignmentPerson[];
  totals: { avgKpiCompliancePct: number | null; avgSopReadRatePct: number | null; weeklyReviewSubmittedPct: number; weeklyReviewApprovedPct: number; aggregateReportCount: number };
}) {
  const router = useRouter();
  const { boot } = useBoot();
  const { toast } = useOsToast();
  const talkOn = boot.launcherApps.includes("chat");
  const [display, setDisplay] = useAlignmentPrefs();
  const [filter, setFilter] = useState<AlignmentFilter>(EMPTY_ALIGNMENT_FILTER);
  const [sort, setSort] = useState<Sort>("attention");
  const [sortOpen, setSortOpen] = useState(false);
  const [filterOpen, setFilterOpen] = useState(false);
  const [menu, setMenu] = useState<{ row: SubTeamRow; anchor: RefObject<HTMLElement | null> } | null>(null);

  const shownTeams = useMemo(() => {
    const rows = subTeams.filter((t) => matchesAlignmentFilter({
      via: t.via, activeKras: [], kpiPct: t.metrics.avgKpiCompliancePct, sopPct: t.metrics.avgSopReadRatePct, mandatoryPending: 0, weekly: t.ownReview,
    }, { ...filter, weightsOff: false, mandatoryPending: false, directOnly: false }));
    const pct = (v: number | null) => (v == null ? Infinity : v);
    return rows.sort((a, b) =>
      sort === "name" ? nameOf(a).localeCompare(nameOf(b))
        : sort === "people" ? b.metrics.reportCount - a.metrics.reportCount || nameOf(a).localeCompare(nameOf(b))
          : pct(a.metrics.avgKpiCompliancePct) - pct(b.metrics.avgKpiCompliancePct)
            || a.metrics.weeklyReviewSubmittedPct - b.metrics.weeklyReviewSubmittedPct
            || reviewUrgency(a.ownReview) - reviewUrgency(b.ownReview)
            || nameOf(a).localeCompare(nameOf(b)));
  }, [subTeams, filter, sort]);
  const shownIcs = useMemo(() => sortAlignment(directIcs.filter((p) => matchesAlignmentFilter({
    via: p.via, activeKras: p.activeKras, kpiPct: p.kpis.compliancePct, sopPct: p.sops.readRatePct, mandatoryPending: p.sops.mandatoryPending, weekly: p.weeklyReview,
  }, filter)), sort === "name" ? "name" : "urgency"), [directIcs, filter, sort]);

  const columns = useMemo<TableColumn<SubTeamRow>[]>(() => [
    { key: "manager", label: "Manager", title: true, width: "minmax(200px,1.4fr)", render: (t) => (
      <span className="flex min-w-0 items-center gap-2"><Avatar person={t} size={24} /><span className="truncate">{nameOf(t)}</span></span>
    ) },
    { key: "title", label: "Job title", width: "minmax(120px,1fr)", hideBelow: 1280, render: (t) => <span className="truncate text-sm text-ink-2">{t.jobTitle ?? "No job title"}</span> },
    { key: "via", label: "Report type", width: "100px", hideBelow: 1280, render: (t) => <span className="text-sm text-ink-2">{t.via === "dotted" ? "Dotted" : "Solid"}</span> },
    { key: "people", label: "People", width: "90px", render: (t) => <span className="tabular-nums" title="Metrics cover this manager's direct reports">{t.metrics.reportCount} direct</span> },
    { key: "kras", label: "KRAs", width: "70px", numeric: true, render: (t) => <span className="tabular-nums">{t.metrics.activeKras}</span> },
    { key: "kpi", label: "KPI compliance", width: "130px", render: (t) => <PctCell pct={t.metrics.avgKpiCompliancePct} /> },
    { key: "sop", label: "SOP read-rate", width: "130px", hideBelow: 900, render: (t) => <PctCell pct={t.metrics.avgSopReadRatePct} /> },
    { key: "reviews", label: "Reviews submitted", width: "150px", render: (t) => (
      <span className="tabular-nums">{t.metrics.weeklyReviewSubmittedPct}% <span className="text-ink-2">· {Math.round((t.metrics.weeklyReviewSubmittedPct / 100) * t.metrics.reportCount)} of {t.metrics.reportCount}</span></span>
    ) },
    { key: "own", label: "Their own review", width: "160px", render: (t) => { const c = weeklyReviewChip(t.ownReview, { forManager: false }); return <ToneChip tone={c.tone} label={c.label} />; } },
  ], []);

  const message = async (id: string) => {
    const r = await apiFetch<{ id?: string; data?: { id?: string } }>("/api/conversations", { method: "POST", json: { type: "DM", memberIds: [id] } });
    const cid = r.ok ? r.data.id ?? r.data.data?.id : null;
    if (cid) router.push(`/tlk/${cid}`);
    else toast(r.ok ? "Couldn't open the conversation" : r.error || "Couldn't open the conversation", { tone: "danger" });
  };
  const count = alignmentFilterCount(filter);
  const b = (n: number | null, label: string) => <><span className="font-medium text-ink">{n == null ? "not measured" : `${n}%`}</span> {label}</>;

  return (
    <>
      <OsPageHeader
        title="Alignment"
        views={(
          <>
            <ViewTab label="My reports" href="/team/alignment" />
            <ViewTab label="Sub-teams" active href="/team/rollup" />
          </>
        )}
        toolbar={{
          filter: { open: filterOpen, onToggle: () => setFilterOpen((x) => !x), count },
          sort: { onClick: () => setSortOpen((x) => !x), label: sort === "attention" ? "Sort" : SORTS.find((s) => s.value === sort)?.label, active: sort !== "attention" },
          menu: [{ label: "Include direct reports without a team", checked: display.showDirectIcs, keepOpen: true, onClick: () => setDisplay({ showDirectIcs: !display.showDirectIcs }) }],
        }}
      />
      <div className="relative">
        {sortOpen ? (
          <div className="absolute start-[110px] top-0 z-40">
            <Picker open onClose={() => setSortOpen(false)} ariaLabel="Sort sub-teams" selected={sort}
              sections={[{ options: SORTS.map((s) => ({ value: s.value, label: s.label })) }]}
              onSelect={(v) => { setSortOpen(false); setSort(v as Sort); }} />
          </div>
        ) : null}
      </div>
      <div className="os-chrome flex min-h-0 flex-1 gap-4 px-6 pb-8 pt-2">
        <FilterPanel open={filterOpen} onClose={() => setFilterOpen(false)} objects="sub-teams" activeCount={count} onClearAll={() => setFilter(EMPTY_ALIGNMENT_FILTER)}>
          <AlignmentFilterGroups filter={filter} setFilter={setFilter} withWeights={false} withDirect={false} />
        </FilterPanel>
        <div className="flex min-h-0 min-w-0 flex-1 flex-col gap-3 overflow-y-auto">
          {subTeams.length === 0 && directIcs.length === 0 ? (
            <OsEmptyView context="goals" title="Nobody has a manager yet" action={{ label: "See the org chart", href: "/organization" }} />
          ) : (
            <>
              <p className="m-0 flex h-9 items-center text-sm text-ink-2">
                <span>Across your tree: KPI {b(totals.avgKpiCompliancePct, "")}· SOPs {b(totals.avgSopReadRatePct, "")}· reviews submitted {b(totals.weeklyReviewSubmittedPct, "")}· approved {b(totals.weeklyReviewApprovedPct, "")}</span>
              </p>
              {subTeams.length === 0 ? (
                <p className="m-0 text-row text-ink-2">None of your reports manage people yet</p>
              ) : (
                <TableCard
                  className="shrink-0"
                  ariaLabel="Sub-teams"
                  columns={columns}
                  rows={shownTeams}
                  rowKey={(t) => t.id}
                  rowHref={(t) => `/team/alignment?manager=${t.id}`}
                  rowMenu={(t) => (
                    <button type="button" aria-label={`Actions for ${nameOf(t)}`} aria-haspopup="menu"
                      onClick={(e) => { e.preventDefault(); e.stopPropagation(); setMenu({ row: t, anchor: { current: e.currentTarget } }); }}
                      className="inline-flex h-8 w-8 items-center justify-center rounded-md text-ink-2 hover:bg-hover hover:text-ink">
                      <MoreHorizontal className="h-4 w-4" />
                    </button>
                  )}
                  empty={<span className="text-row text-ink-2">No sub-teams match · <button type="button" className="text-brand-deep hover:underline" onClick={() => setFilter(EMPTY_ALIGNMENT_FILTER)}>Clear filters</button></span>}
                  footer={{ total: shownTeams.length, noun: "sub-teams", from: shownTeams.length ? 1 : 0, to: shownTeams.length }}
                />
              )}
              {display.showDirectIcs && directIcs.length > 0 ? (
                <>
                  <h2 className="m-0 mt-2 text-row font-medium text-ink">Direct reports without a team</h2>
                  <AlignmentTable className="shrink-0" people={shownIcs} showKraNames={display.showKraNames} ariaLabel="Direct reports without a team"
                    empty={<span className="text-row text-ink-2">Nobody matches</span>} />
                </>
              ) : null}
            </>
          )}
        </div>
      </div>
      {menu ? (
        <MorePortal anchorRef={menu.anchor} width={240} open placement="below" onClose={() => setMenu(null)}>
          <MenuList aria-label={`Actions for ${nameOf(menu.row)}`}>
            <MenuItem icon={Users} label="Open their team" onClick={() => { const id = menu.row.id; setMenu(null); router.push(`/team/alignment?manager=${id}`); }} />
            <MenuItem icon={ExternalLink} label="Open profile" onClick={() => { const id = menu.row.id; setMenu(null); router.push(`/people/${id}?tab=kras`); }} />
            <MenuItem icon={Gauge} label={`Open KPI reviews for ${menu.row.firstName || nameOf(menu.row)}`} onClick={() => { const id = menu.row.id; setMenu(null); router.push(`/team/kpi-reviews?person=${id}`); }} />
            {talkOn ? <MenuItem icon={MessageCircle} label="Message" onClick={() => { const id = menu.row.id; setMenu(null); void message(id); }} /> : null}
          </MenuList>
        </MorePortal>
      ) : null}
    </>
  );
}
