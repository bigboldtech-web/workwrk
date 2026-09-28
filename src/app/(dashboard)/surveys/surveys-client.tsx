"use client";

// Surveys (spec-teams-performance /surveys): answer the surveys you have been
// sent, and, if you run them, write and watch them.
//
//   To answer    (every viewer, the default) a 720 column of the Open
//                surveys you are in the audience of: Answer, or "Answered"
//                with "Change my answers" while it is open. No Launch, no
//                Close, no response rate, no KPI strip: an employee's surveys
//                page holds only surveys and the word Answer.
//   All surveys  (people who run surveys) Draft and Open, a TableCard with no
//                checkbox column; everything else is in the row "...": Edit
//                (Draft), Change close date (Open), Launch, Send a reminder,
//                Close, Duplicate, Export CSV, Delete (Draft)
//   Closed       the same, closed, with Reopen
// A targeted Member holds one view: no views row and no toolbar. Typing
// ?view=all without running surveys shows To answer and one notice line.

import { useCallback, useEffect, useMemo, useRef, useState, type RefObject } from "react";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { Ban, Bell, CalendarClock, Check, Copy, Download, ExternalLink, Link2, Pencil, Play, Plus, RotateCcw, Trash2 } from "lucide-react";
import { Breadcrumb } from "@/components/layout/os/top-bar/breadcrumb";
import { OsPageHeader } from "@/components/layout/os/page-header";
import { OsEmptyView } from "@/components/layout/os/empty-view";
import { MorePortal } from "@/components/layout/os/more-portal";
import { useOsShell } from "@/components/layout/os/shell-context";
import { useOsToast } from "@/components/layout/os/toast";
import { useBoot } from "@/components/layout/os/boot-context";
import { MenuItem, MenuList, MenuSeparator } from "@/components/ui/menu";
import { ViewTab } from "@/components/ui/view-tabs";
import { Picker } from "@/components/ui/picker";
import { Skeleton } from "@/components/ui/skeleton";
import { TableCard, RowMoreButton, type TableColumn } from "@/components/ui/table-card";
import { useConfirm } from "@/components/ui/dialog-provider";
import { FilterGroup, FilterPanel, FilterRow } from "@/components/ui/filter-panel";
import { ToneChip } from "@/components/people/person-bits";
import { apiFetch } from "@/lib/api-fetch";
import { formatDate } from "@/lib/format/date";
import { useDatePrefs } from "@/lib/format/use-date-prefs";
import { surveyStatusOf } from "@/lib/performance/survey";
import { SurveyBuilder, type EditableSurvey } from "./_components/survey-builder";
import { ChangeCloseDateDialog } from "./_components/change-close-date-dialog";

type Row = {
  id: string;
  title: string;
  status: "DRAFT" | "ACTIVE" | "CLOSED";
  anonymous: boolean;
  questionCount: number;
  closesAt: string | null;
  closedAt: string | null;
  createdAt: string;
  hasResponded: boolean;
  audienceType?: string;
  audience?: string;
  audienceSize?: number;
  totalResponses?: number;
  responseRate?: number;
};
type ListResponse = { data: Row[]; view: "answer" | "all" | "closed"; downgraded: boolean; canRun: boolean; pagination: { total: number; page: number; limit: number; hasMore: boolean } };
type OptionalCol = "audience" | "questions" | "responses" | "opened";
const OPTIONAL_COLS: Array<{ key: OptionalCol; label: string }> = [
  { key: "audience", label: "Audience" },
  { key: "questions", label: "Questions" },
  { key: "responses", label: "Responses" },
  { key: "opened", label: "Opened" },
];
const PAGE = 40;

export default function SurveysClient({ canCreate }: { canCreate: boolean }) {
  const router = useRouter();
  const pathname = usePathname();
  const sp = useSearchParams();
  const { toast } = useOsToast();
  const { prefs, patchPrefs } = useOsShell();
  const { boot } = useBoot();
  const confirm = useConfirm();
  const datePrefs = useDatePrefs();
  const isAgent = !!(boot.viewer as { isAgent?: boolean }).isAgent;

  const asked = sp?.get("view");
  const view: "answer" | "all" | "closed" = canCreate && (asked === "all" || asked === "closed") ? asked : "answer";
  const q = sp?.get("q") ?? "";
  const statusF = sp?.get("status") ?? "";
  const anonF = sp?.get("anonymous") ?? "";
  const sort = sp?.get("sort") ?? "newest";
  const page = Math.max(1, Number(sp?.get("page") ?? "1") || 1);
  const filters = [q, statusF, anonF].filter(Boolean).length;

  const setParams = useCallback((patch: Record<string, string | null>) => {
    const next = new URLSearchParams(sp?.toString() ?? "");
    for (const [k, v] of Object.entries(patch)) { if (v) next.set(k, v); else next.delete(k); }
    if (!("page" in patch)) next.delete("page");
    const s = next.toString();
    router.replace(s ? `${pathname}?${s}` : pathname, { scroll: false });
  }, [sp, router, pathname]);

  // The notice is decided once, from the URL the page opened with, so
  // stripping the parameter does not take the line away with it.
  const [notice] = useState<string | null>(() => (!canCreate && (asked === "all" || asked === "closed") ? "Only the People team and Admins can see all surveys." : null));
  const stripped = useRef(false);
  useEffect(() => {
    if (stripped.current || canCreate || !(asked === "all" || asked === "closed")) return;
    stripped.current = true;
    setParams({ view: null });
  }, [asked, canCreate, setParams]);

  const [list, setList] = useState<ListResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const load = useCallback(async () => {
    const r = await apiFetch<ListResponse>(`/api/pulse-surveys?view=${view}&page=${page}&limit=${PAGE}`, { cache: "no-store" });
    if (!r.ok) { setError(r.error || "Couldn't load surveys"); toast(r.error || "Couldn't load surveys", { tone: "danger" }); return; }
    setError(null);
    setList(r.data);
  }, [view, page, toast]);
  useEffect(() => { const t = setTimeout(() => { void load(); }, 0); return () => clearTimeout(t); }, [load]);
  useEffect(() => { const again = () => void load(); window.addEventListener("focus", again); return () => window.removeEventListener("focus", again); }, [load]);
  const loading = !list || list.view !== view;

  const stored = ((prefs.home as { teams?: { surface?: Record<string, { viewOptions?: { columns?: Record<string, boolean> } }> } } | undefined)
    ?.teams?.surface?.surveys?.viewOptions?.columns) ?? {};
  const [colsLocal, setColsLocal] = useState<Partial<Record<OptionalCol, boolean>>>({});
  const cols = Object.fromEntries(OPTIONAL_COLS.map((c) => [c.key, colsLocal[c.key] ?? stored[c.key] ?? true])) as Record<OptionalCol, boolean>;
  const setCol = (k: OptionalCol, on: boolean) => {
    setColsLocal((c) => ({ ...c, [k]: on }));
    void patchPrefs({ home: { teams: { surface: { surveys: { viewOptions: { columns: { [k]: on } } } } } } }).then((ok) => { if (!ok) toast("Couldn't save that setting", { tone: "danger" }); });
  };

  const [filterOpen, setFilterOpen] = useState(false);
  const [sortOpen, setSortOpen] = useState(false);
  const [draftQ, setDraftQ] = useState(q);
  useEffect(() => {
    if (draftQ === q) return;
    const t = setTimeout(() => setParams({ q: draftQ.trim() || null }), 250);
    return () => clearTimeout(t);
  }, [draftQ, q, setParams]);
  const clearFilters = () => { setDraftQ(""); setParams({ q: null, status: null, anonymous: null }); };

  const rows = useMemo(() => {
    let r = list?.data ?? [];
    if (q) r = r.filter((x) => x.title.toLowerCase().includes(q.toLowerCase()));
    if (statusF) r = r.filter((x) => x.status === statusF);
    if (anonF) r = r.filter((x) => (anonF === "yes" ? x.anonymous : !x.anonymous));
    if (sort === "closing") r = [...r].sort((a, b) => (a.closesAt ? new Date(a.closesAt).getTime() : Infinity) - (b.closesAt ? new Date(b.closesAt).getTime() : Infinity));
    if (sort === "rate") r = [...r].sort((a, b) => (a.responseRate ?? 0) - (b.responseRate ?? 0));
    return r;
  }, [list, q, statusF, anonF, sort]);

  // ── Builder and row actions ───────────────────────────────────────
  const [builder, setBuilder] = useState<null | { mode: "create" | "edit"; survey?: EditableSurvey | null }>(null);
  const [closeDate, setCloseDate] = useState<Row | null>(null);
  const [menu, setMenu] = useState<{ row: Row; anchor: RefObject<HTMLElement | null> } | null>(null);
  const wantsNew = sp?.get("new") === "1";
  useEffect(() => {
    if (!wantsNew || !canCreate) return;
    const t = setTimeout(() => setBuilder({ mode: "create" }), 0);
    setParams({ new: null });
    return () => clearTimeout(t);
  }, [wantsNew, canCreate, setParams]);

  const openEdit = async (row: Row) => {
    const r = await apiFetch<{ survey: EditableSurvey & { questions: EditableSurvey["questions"] } }>(`/api/pulse-surveys/${row.id}`, { cache: "no-store" });
    if (!r.ok) { toast(r.error || "Couldn't open the survey", { tone: "danger" }); return; }
    setBuilder({ mode: "edit", survey: r.data.survey });
  };
  const patch = async (row: Row, body: Record<string, unknown>, ok: string) => {
    const r = await apiFetch(`/api/pulse-surveys/${row.id}`, { method: "PATCH", json: body });
    if (!r.ok) { toast(r.error || "Couldn't change the survey", { tone: "danger" }); return false; }
    toast(ok);
    void load();
    return true;
  };
  const launch = async (row: Row) => {
    if (!(await confirm({ title: `Send ${row.title} now?`, description: `It goes to ${row.audience?.toLowerCase() ?? "its audience"}${row.audienceSize != null ? ` (${row.audienceSize} ${row.audienceSize === 1 ? "person" : "people"})` : ""}, and each of them is told.`, confirmLabel: "Launch", destructive: false }))) return;
    await patch(row, { status: "ACTIVE" }, "Survey launched");
  };
  const close = async (row: Row) => {
    if (!(await confirm({ title: `Close ${row.title}?`, description: "Nobody can answer after this. You can reopen it later.", confirmLabel: "Close", destructive: false }))) return;
    await patch(row, { status: "CLOSED" }, "Survey closed");
  };
  const reopen = async (row: Row) => {
    if (!(await confirm({ title: `Reopen ${row.title}?`, description: "People in the audience can answer again until its close date.", confirmLabel: "Reopen", destructive: false }))) return;
    await patch(row, { status: "ACTIVE", ...(row.closesAt && new Date(row.closesAt).getTime() <= Date.now() ? { closesAt: null } : {}) }, "Survey reopened");
  };
  const remind = async (row: Row) => {
    const r = await apiFetch<{ notified: number }>(`/api/pulse-surveys/${row.id}/reminders`, { method: "POST" });
    if (!r.ok) { toast(r.error || "Couldn't send a reminder", { tone: "danger" }); return; }
    toast(r.data.notified ? `Reminded ${r.data.notified} ${r.data.notified === 1 ? "person" : "people"}` : "Everyone has answered or was reminded today");
  };
  const duplicate = async (row: Row) => {
    const r = await apiFetch<{ id: string }>(`/api/pulse-surveys/${row.id}/duplicate`, { method: "POST" });
    if (!r.ok) { toast(r.error || "Couldn't duplicate it", { tone: "danger" }); return; }
    toast("Duplicated as a draft");
    if (view !== "all") setParams({ view: "all" }); else void load();
  };
  const remove = async (row: Row) => {
    if (!(await confirm({ title: `Delete ${row.title}?`, description: "Nobody has answered it. This cannot be undone.", confirmLabel: "Delete", destructive: true }))) return;
    const r = await apiFetch(`/api/pulse-surveys/${row.id}`, { method: "DELETE" });
    if (!r.ok) { toast(r.error || "Couldn't delete it", { tone: "danger" }); return; }
    toast("Survey deleted");
    void load();
  };
  const copyLink = (id: string) => {
    void navigator.clipboard.writeText(`${window.location.origin}/surveys/${id}`).then(() => toast("Link copied"), () => toast("Couldn't copy the link", { tone: "danger" }));
  };

  const columns: TableColumn<Row>[] = [
    {
      key: "title", label: "Survey", title: true, width: "minmax(240px,2fr)",
      render: (r) => (
        <span className="flex min-w-0 items-center gap-2">
          <span className="min-w-0 truncate">{r.title}</span>
          <ToneChip tone={surveyStatusOf(r.status).tone} label={surveyStatusOf(r.status).label} />
          {r.anonymous ? <span className="inline-flex h-6 shrink-0 items-center rounded-md border border-line bg-subtle px-2 text-xs font-medium text-ink-2">Anonymous</span> : null}
        </span>
      ),
    },
    ...(cols.audience ? [{ key: "audience", label: "Audience", width: "minmax(130px,1fr)", hideBelow: 880, render: (r: Row) => <span className="truncate text-ink-2">{r.audience ?? ""}</span> }] : []),
    ...(cols.questions ? [{ key: "questions", label: "Questions", width: "96px", numeric: true, hideBelow: 760, render: (r: Row) => <span>{r.questionCount}</span> }] : []),
    ...(cols.responses ? [{
      key: "responses", label: "Responses", width: "170px",
      render: (r: Row) => r.status === "DRAFT" ? <span className="text-ink-3">Not sent</span> : (
        <span className="flex items-center gap-2">
          <span className="tabular-nums">{r.totalResponses ?? 0} of {r.audienceSize ?? 0}</span>
          <span className="h-1 w-20 overflow-hidden rounded-full bg-subtle" aria-hidden><span className="block h-full rounded-full bg-brand" style={{ width: `${Math.min(100, r.responseRate ?? 0)}%` }} /></span>
        </span>
      ),
    }] : []),
    ...(cols.opened ? [{ key: "opened", label: view === "closed" ? "Closed on" : "Opened", width: "120px", hideBelow: 1000, render: (r: Row) => (view !== "closed" && r.status === "DRAFT"
      // A draft was never opened: a dash, never its creation date.
      ? <span className="text-ink-3" aria-label="Not opened">-</span>
      : <span className="tabular-nums text-ink-2">{formatDate(view === "closed" ? r.closedAt : r.createdAt, datePrefs, "date")}</span>) }] : []),
    { key: "closes", label: "Closes", width: "120px", render: (r) => <span className="tabular-nums text-ink-2">{r.closesAt ? formatDate(r.closesAt, datePrefs, "date") : ""}</span> },
  ];

  const tableView = view === "all" || view === "closed";
  const total = list?.pagination.total ?? 0;
  return (
    <>
      <Breadcrumb items={[{ label: "Surveys" }]} />
      <OsPageHeader
        title="Surveys"
        askAi
        views={canCreate ? (
          <>
            <ViewTab label="To answer" active={view === "answer"} onClick={() => setParams({ view: null, status: null })} />
            <ViewTab label="All surveys" active={view === "all"} onClick={() => setParams({ view: "all", status: null })} />
            <ViewTab label="Closed" active={view === "closed"} onClick={() => setParams({ view: "closed", status: null })} />
          </>
        ) : undefined}
        toolbar={canCreate ? {
          ...(tableView ? {
            filter: { open: filterOpen, onToggle: () => setFilterOpen((v) => !v), count: filters },
            sort: { onClick: () => setSortOpen((v) => !v), label: sort === "closing" ? "Closing soonest" : sort === "rate" ? "Lowest response rate" : "Sort", active: sort !== "newest" },
          } : {}),
          ...(builder || closeDate ? {} : { primary: { label: "New survey", icon: Plus, onClick: () => setBuilder({ mode: "create" }) } }),
          ...(tableView ? { menu: OPTIONAL_COLS.map((c) => ({ label: `Show ${c.label}`, checked: cols[c.key], keepOpen: true, onClick: () => setCol(c.key, !cols[c.key]) })) } : {}),
        } : undefined}
      />
      {notice ? <p className="m-0 px-6 pt-2 text-sm text-ink-2">{notice}</p> : null}
      <div className="relative">
        {sortOpen ? (
          <div className="absolute start-[110px] top-0 z-40">
            <Picker open onClose={() => setSortOpen(false)} ariaLabel="Sort surveys" selected={sort}
              sections={[{ options: [{ value: "newest", label: "Newest first" }, { value: "closing", label: "Closing soonest" }, { value: "rate", label: "Lowest response rate" }] }]}
              onSelect={(v) => { setSortOpen(false); setParams({ sort: v === "newest" ? null : v }); }} />
          </div>
        ) : null}
      </div>
      <div className="os-chrome flex min-h-0 flex-1 gap-4 overflow-y-auto px-6 pb-8 pt-2">
        {tableView ? (
          <FilterPanel open={filterOpen} onClose={() => setFilterOpen(false)} objects="surveys" activeCount={filters} onClearAll={clearFilters}
            search={{ value: draftQ, onChange: setDraftQ, placeholder: "Search surveys" }}>
            {view === "all" ? (
              <FilterGroup label="Status">
                <FilterRow label="Draft" checked={statusF === "DRAFT"} onCheckedChange={(on) => setParams({ status: on ? "DRAFT" : null })} />
                <FilterRow label="Open" checked={statusF === "ACTIVE"} onCheckedChange={(on) => setParams({ status: on ? "ACTIVE" : null })} />
              </FilterGroup>
            ) : null}
            <FilterGroup label="Anonymous">
              <FilterRow label="Anonymous" checked={anonF === "yes"} onCheckedChange={(on) => setParams({ anonymous: on ? "yes" : null })} />
              <FilterRow label="Attributed" checked={anonF === "no"} onCheckedChange={(on) => setParams({ anonymous: on ? "no" : null })} />
            </FilterGroup>
          </FilterPanel>
        ) : null}
        <div className="min-w-0 flex-1">
          {error && !list ? (
            <OsEmptyView variant="error" title="Couldn't load surveys" hint={error} action={{ label: "Try again", onClick: () => void load() }} />
          ) : tableView ? (
            <TableCard
              ariaLabel={view === "closed" ? "Closed surveys" : "All surveys"}
              columns={columns}
              rows={loading ? null : rows}
              rowKey={(r) => r.id}
              rowHref={(r) => `/surveys/${r.id}${r.status === "DRAFT" ? "" : "?tab=results"}`}
              rowMenu={(r) => <RowMoreButton label={`Actions for ${r.title}`} open={menu?.row.id === r.id} onClick={(e) => setMenu({ row: r, anchor: { current: e.currentTarget } })} />}
              empty={filters ? (
                <span className="text-row text-ink-2">No surveys match · <button type="button" className="text-brand-deep hover:underline" onClick={clearFilters}>Clear filters</button></span>
              ) : view === "closed" ? <span className="text-row text-ink-2">No closed surveys yet</span> : (
                <span className="text-row text-ink-2">No surveys yet · <button type="button" className="text-brand-deep hover:underline" onClick={() => setBuilder({ mode: "create" })}>Write your first survey</button></span>
              )}
              footer={loading ? undefined : {
                total, noun: "surveys", from: total ? (page - 1) * PAGE + 1 : 0, to: Math.min(total, page * PAGE),
                onPrev: page > 1 ? () => setParams({ page: String(page - 1) }) : undefined,
                onNext: list?.pagination.hasMore ? () => setParams({ page: String(page + 1) }) : undefined,
              }}
            />
          ) : (
            <div className="mx-auto flex w-full max-w-[720px] flex-col gap-3">
              {loading ? (
                Array.from({ length: 3 }, (_, i) => <Skeleton key={i} className="h-[96px] w-full rounded-lg" />)
              ) : rows.length === 0 ? (
                <OsEmptyView title="Nothing to answer right now" />
              ) : rows.map((r) => r.hasResponded ? (
                <div key={r.id} className="flex h-11 items-center gap-2 rounded-lg border border-line bg-raised px-4 text-row text-ink-2">
                  <Check className="h-4 w-4 text-success-text" aria-hidden />
                  <span className="min-w-0 flex-1 truncate">{r.title}</span>
                  <span className="text-sm">Answered</span>
                  <Link href={`/surveys/${r.id}?tab=respond`} className="text-sm font-medium text-brand-deep hover:underline">Change my answers</Link>
                </div>
              ) : (
                <article key={r.id} className="flex items-start gap-4 rounded-lg border border-line bg-raised p-4">
                  <div className="min-w-0 flex-1">
                    <h2 className="m-0 truncate text-lg font-semibold text-ink">{r.title}</h2>
                    <p className="m-0 mt-1 flex flex-wrap items-center gap-2 text-sm text-ink-2">
                      <span>{r.questionCount} {r.questionCount === 1 ? "question" : "questions"}{r.closesAt ? ` · Closes ${formatDate(r.closesAt, datePrefs, "date")}` : ""}</span>
                      <span className="inline-flex h-6 items-center rounded-md border border-line bg-subtle px-2 text-xs font-medium text-ink">{r.anonymous ? "Anonymous" : "Attributed"}</span>
                    </p>
                  </div>
                  <Link href={`/surveys/${r.id}`} className="inline-flex h-9 shrink-0 items-center rounded-md border border-line bg-raised px-4 text-sm font-medium text-ink hover:bg-hover">Answer</Link>
                </article>
              ))}
              {!loading && rows.length > 0 ? (
                <p className="m-0 px-1 text-sm tabular-nums text-ink-2">
                  {`${total || rows.length} ${(total || rows.length) === 1 ? "survey" : "surveys"} · ${rows.filter((r) => !r.hasResponded).length} to answer`}
                </p>
              ) : null}
            </div>
          )}
        </div>
      </div>

      {menu ? (
        <MorePortal anchorRef={menu.anchor} width={220} open placement="below" onClose={() => setMenu(null)}>
          <MenuList aria-label="Survey actions">
            <MenuItem icon={ExternalLink} label="Open" onClick={() => { const r = menu.row; setMenu(null); router.push(`/surveys/${r.id}`); }} />
            <MenuItem icon={Link2} label="Copy link" onClick={() => { const id = menu.row.id; setMenu(null); copyLink(id); }} />
            {menu.row.status === "DRAFT" ? <MenuItem icon={Pencil} label="Edit" onClick={() => { const r = menu.row; setMenu(null); void openEdit(r); }} /> : null}
            {menu.row.status === "ACTIVE" ? <MenuItem icon={CalendarClock} label="Change close date" onClick={() => { const r = menu.row; setMenu(null); setCloseDate(r); }} /> : null}
            <MenuSeparator />
            {menu.row.status === "DRAFT" ? <MenuItem icon={Play} label="Launch" onClick={() => { const r = menu.row; setMenu(null); void launch(r); }} /> : null}
            {menu.row.status === "ACTIVE" ? <MenuItem icon={Bell} label="Send a reminder" onClick={() => { const r = menu.row; setMenu(null); void remind(r); }} /> : null}
            {menu.row.status === "ACTIVE" ? <MenuItem icon={Ban} label="Close" onClick={() => { const r = menu.row; setMenu(null); void close(r); }} /> : null}
            {menu.row.status === "CLOSED" ? <MenuItem icon={RotateCcw} label="Reopen" onClick={() => { const r = menu.row; setMenu(null); void reopen(r); }} /> : null}
            <MenuItem icon={Copy} label="Duplicate" onClick={() => { const r = menu.row; setMenu(null); void duplicate(r); }} />
            {!isAgent && (menu.row.totalResponses ?? 0) > 0 ? <MenuItem icon={Download} label="Export CSV" onClick={() => { const id = menu.row.id; setMenu(null); window.location.href = `/api/pulse-surveys/${id}/responses/export`; }} /> : null}
            {!isAgent && (menu.row.totalResponses ?? 0) === 0 && menu.row.status !== "ACTIVE" ? <><MenuSeparator /><MenuItem icon={Trash2} label="Delete" destructive onClick={() => { const r = menu.row; setMenu(null); void remove(r); }} /></> : null}
          </MenuList>
        </MorePortal>
      ) : null}

      {builder ? (
        <SurveyBuilder
          open
          mode={builder.mode}
          survey={builder.survey ?? null}
          onOpenChange={(v) => { if (!v) setBuilder(null); }}
          onSaved={(s) => { toast(s.status === "DRAFT" ? "Saved as a draft" : "Survey published"); if (view !== "all") setParams({ view: "all" }); else void load(); }}
        />
      ) : null}
      {closeDate ? (
        <ChangeCloseDateDialog surveyId={closeDate.id} title={closeDate.title} closesAt={closeDate.closesAt} onClose={() => setCloseDate(null)} onSaved={() => { setCloseDate(null); void load(); }} />
      ) : null}
    </>
  );
}
