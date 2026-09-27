"use client";

// Weekly reviews (spec-teams-performance /team/reviews): read the weekly
// reviews your people wrote and approve them or ask for changes.
//
//   views     Waiting on you (default) · Acted (last 30 days) · All  (?view=)
//   toolbar   Filter (search, Person, Week, Direct reports only, Status),
//             Sort (Oldest first, Newest first, Person A to Z), Group (None,
//             Person, Week); NO blue button (there is nothing to create, so
//             the drawer's Approve is the only blue thing on this route);
//             "..." Display, Weekly review (/me/weekly-review), Export CSV
//   body      a TableCard with the checkbox column; the bulk bar is Approve
//             (a confirm naming the count and the people), Send a reminder,
//             Export selected. Request changes is never bulk: it needs a
//             note written for one person.
//   drawer    ?review={id}: KRA progress and KPI snapshots BY NAME (PO-9),
//             Highlights, Blockers, Plan, Notes to {first name}; the footer
//             is Request changes (needs the note) and the blue Approve, the
//             same PATCH /api/weekly-reviews/[id]/manager-review the
//             Alignment board writes (PO-1). Cmd+Enter approves.
//
// Every state is in the URL (?view=&q=&person=&week=&status=&scope=&sort=
// &group=&page=&review=), so back restores it and Copy link reopens the
// drawer. The Direct reports only default is remembered per viewer at
// home.teams.surface.weekly-reviews.viewOptions.scope, and the Display
// columns at .columns. The list refetches on focus, after a decision, and
// on the `review.decided` event, so an Approve on the Alignment board moves
// the row to Acted here without a reload.

import { useCallback, useEffect, useMemo, useRef, useState, type RefObject } from "react";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { Bell, Check, Copy, Download, ExternalLink, Link2, Maximize2, Minimize2, UserRound, X } from "lucide-react";
import { Breadcrumb } from "@/components/layout/os/top-bar/breadcrumb";
import { OsPageHeader } from "@/components/layout/os/page-header";
import { OsEmptyView } from "@/components/layout/os/empty-view";
import { MorePortal } from "@/components/layout/os/more-portal";
import { useOsShell } from "@/components/layout/os/shell-context";
import { useOsToast } from "@/components/layout/os/toast";
import { MenuItem, MenuList } from "@/components/ui/menu";
import { ViewTab } from "@/components/ui/view-tabs";
import { Picker } from "@/components/ui/picker";
import { Switch } from "@/components/ui/switch";
import { SkeletonLines } from "@/components/ui/skeleton";
import { TableCard, BulkAction, RowMoreButton, type TableColumn } from "@/components/ui/table-card";
import { Drawer } from "@/components/ui/drawer";
import { useConfirm } from "@/components/ui/dialog-provider";
import { FilterGroup, FilterPanel, FilterRow } from "@/components/ui/filter-panel";
import { PeoplePickerField, PersonAvatar, ToneChip, personName, type PickPerson } from "@/components/people/person-bits";
import { apiFetch, apiFetchWithRetry } from "@/lib/api-fetch";
import { formatDate, formatRelative } from "@/lib/format/date";
import { useDatePrefs } from "@/lib/format/use-date-prefs";
import { WINDOW_EVENTS, type RealtimeEvent } from "@/lib/realtime-events";
import { recentWeekKeys } from "@/lib/people/weekly-queue";
import type { WeeklyQueueRow, WeeklyReviewDetail } from "@/lib/people/weekly-queue.server";

type View = "waiting" | "acted" | "all";
type Tone = "success" | "danger" | "warning" | "neutral" | "info";
type ListResponse = { data: WeeklyQueueRow[]; pagination: { total: number; page: number; pageSize: number }; scope: "direct" | "chain"; groups: Array<{ key: string; count: number }> };
type OptionalCol = "highlights" | "kras" | "submitted";
const OPTIONAL_COLS: Array<{ key: OptionalCol; label: string }> = [
  { key: "highlights", label: "Highlights" },
  { key: "kras", label: "KRAs" },
  { key: "submitted", label: "Submitted" },
];
const STATUS_ROWS: Array<{ key: string; label: string }> = [
  { key: "waiting", label: "Waiting on you" },
  { key: "approved", label: "Approved" },
  { key: "changes", label: "Changes requested" },
  { key: "notsubmitted", label: "Not submitted" },
];
const SORTS = [
  { value: "oldest", label: "Oldest first" },
  { value: "newest", label: "Newest first" },
  { value: "person", label: "Person A to Z" },
];
const GROUPS = [
  { value: "none", label: "None" },
  { value: "person", label: "Person" },
  { value: "week", label: "Week" },
];

/** The list request's query string, empty values left out. */
function queueQuery(parts: Record<string, string>): string {
  return new URLSearchParams(Object.entries(parts).filter(([, v]) => v !== "")).toString();
}

function readView(v: string | null | undefined): View {
  return v === "acted" || v === "all" ? v : "waiting";
}

/** "1 to 7 Sep" for the Monday a review covers. */
function weekRange(key: string): string {
  const start = new Date(`${key}T00:00:00Z`);
  const end = new Date(start);
  end.setUTCDate(end.getUTCDate() + 6);
  const month = (d: Date) => d.toLocaleString("en-US", { month: "short", timeZone: "UTC" });
  return start.getUTCMonth() === end.getUTCMonth()
    ? `${start.getUTCDate()} to ${end.getUTCDate()} ${month(end)}`
    : `${start.getUTCDate()} ${month(start)} to ${end.getUTCDate()} ${month(end)}`;
}

/**
 * The queue's list: fetched for the query on screen, refetched on focus and
 * on `review.decided` (a decision on the Alignment board, in another tab or
 * by a colleague), so this page and the board stay in step.
 */
function useWeeklyList(listQs: string) {
  const { toast } = useOsToast();
  const [list, setList] = useState<ListResponse | null>(null);
  const [listFor, setListFor] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  // The query the list shows lives in a ref, so a refetch from focus or
  // from a decision made elsewhere always asks for what is on screen.
  const qsRef = useRef(listQs);
  useEffect(() => { qsRef.current = listQs; }, [listQs]);
  const load = useCallback(async (qs?: string) => {
    const use = qs ?? qsRef.current;
    const r = await apiFetch<ListResponse>(`/api/weekly-reviews?${use}`, { cache: "no-store" });
    if (!r.ok) {
      setError(r.error || "Couldn't load weekly reviews");
      toast(r.error || "Couldn't load weekly reviews", { tone: "danger" });
      return;
    }
    setError(null);
    setList(r.data);
    setListFor(use);
  }, [toast]);
  useEffect(() => {
    const t = setTimeout(() => { void load(listQs); }, 0);
    return () => clearTimeout(t);
  }, [load, listQs]);
  // Decisions made elsewhere: another tab, the Alignment board, a colleague.
  useEffect(() => {
    let last = 0;
    const again = () => { if (Date.now() - last > 3000) { last = Date.now(); void load(); } };
    const onRealtime = (e: Event) => { const ev = (e as CustomEvent<RealtimeEvent>).detail; if (ev?.type === "review.decided") again(); };
    window.addEventListener("focus", again);
    window.addEventListener(WINDOW_EVENTS.realtime, onRealtime);
    return () => { window.removeEventListener("focus", again); window.removeEventListener(WINDOW_EVENTS.realtime, onRealtime); };
  }, [load]);
  return { list, listFor, error, load };
}

export function WeeklyReviewsView({
  viewerId,
  hasReports,
  canExportAll,
  isAgent,
}: {
  viewerId: string;
  hasReports: boolean;
  canExportAll: boolean;
  isAgent: boolean;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const sp = useSearchParams();
  const { toast } = useOsToast();
  const { prefs, patchPrefs } = useOsShell();
  const confirm = useConfirm();
  const datePrefs = useDatePrefs();

  const stored = ((prefs.home as { teams?: { surface?: Record<string, { viewOptions?: { scope?: "direct" | "chain"; columns?: Record<string, boolean> } }> } } | undefined)
    ?.teams?.surface?.["weekly-reviews"]?.viewOptions) ?? {};

  const view = readView(sp?.get("view"));
  const q = sp?.get("q") ?? "";
  const person = sp?.get("person") ?? "";
  const week = sp?.get("week") ?? "";
  const status = sp?.get("status") ?? "";
  const statuses = useMemo(() => status.split(",").filter(Boolean), [status]);
  const urlScope = sp?.get("scope");
  // No reports: the People team and Admin read the org, and "direct" would
  // always be empty, so the switch is not offered and the scope is chain.
  const scope: "direct" | "chain" = !hasReports ? "chain" : urlScope === "chain" || urlScope === "direct" ? urlScope : stored.scope ?? "direct";
  const sort = sp?.get("sort") === "newest" ? "newest" : sp?.get("sort") === "person" ? "person" : "oldest";
  const group = sp?.get("group") === "person" ? "person" : sp?.get("group") === "week" ? "week" : "none";
  const page = Math.max(1, Number(sp?.get("page") ?? "1") || 1);
  const reviewId = sp?.get("review") ?? null;
  const filters = [q, person, week, status].filter(Boolean).length + (hasReports && scope === "chain" ? 1 : 0);

  const [colsLocal, setColsLocal] = useState<Partial<Record<OptionalCol, boolean>>>({});
  const cols: Record<OptionalCol, boolean> = {
    highlights: colsLocal.highlights ?? stored.columns?.highlights ?? true,
    kras: colsLocal.kras ?? stored.columns?.kras ?? true,
    submitted: colsLocal.submitted ?? stored.columns?.submitted ?? true,
  };
  const setCol = (k: OptionalCol, on: boolean) => {
    setColsLocal((c) => ({ ...c, [k]: on }));
    void patchPrefs({ home: { teams: { surface: { "weekly-reviews": { viewOptions: { columns: { [k]: on } } } } } } }).then((ok) => {
      if (!ok) toast("Couldn't save that setting", { tone: "danger" });
    });
  };

  const setParams = useCallback((patch: Record<string, string | null>, opts: { push?: boolean } = {}) => {
    const next = new URLSearchParams(sp?.toString() ?? "");
    for (const [k, v] of Object.entries(patch)) { if (v) next.set(k, v); else next.delete(k); }
    if (!("page" in patch) && Object.keys(patch).some((k) => k !== "review")) next.delete("page");
    const s = next.toString();
    const href = s ? `${pathname}?${s}` : pathname;
    if (opts.push) router.push(href, { scroll: false });
    else router.replace(href, { scroll: false });
  }, [sp, router, pathname]);

  const setScope = (next: "direct" | "chain") => {
    setParams({ scope: next });
    void patchPrefs({ home: { teams: { surface: { "weekly-reviews": { viewOptions: { scope: next } } } } } });
  };

  // ── The list ──────────────────────────────────────────────────────
  const listQs = queueQuery({ view, scope, sort, group, page: String(page), q, person, week, status });
  const { list, listFor, error, load } = useWeeklyList(listQs);
  const rows = listFor === listQs ? list?.data ?? null : list ? list.data : null;

  // ?person= (the Alignment board's Open weekly review): open their most
  // recent waiting review once the list for that person has loaded.
  const personOpened = useRef<string | null>(null);
  useEffect(() => {
    if (!person || reviewId || personOpened.current === person || !rows || listFor !== listQs) return;
    personOpened.current = person;
    const target = rows.find((r) => r.userId === person && r.status === "SUBMITTED") ?? null;
    if (target) setParams({ review: target.id });
  }, [person, reviewId, rows, listFor, listQs, setParams]);

  // ── Selection and bulk ────────────────────────────────────────────
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [selFor, setSelFor] = useState(listQs);
  if (selFor !== listQs) { setSelFor(listQs); setSelected(new Set()); }
  const selectedRows = (rows ?? []).filter((r) => selected.has(r.id));
  const approvable = selectedRows.filter((r) => r.status === "SUBMITTED" && r.canDecide);

  const bulkApprove = async () => {
    if (!approvable.length) { toast("None of these is waiting for a decision", { tone: "danger" }); return; }
    const names = approvable.map((r) => personName(r.subject));
    const shown = names.length > 4 ? `${names.slice(0, 4).join(", ")} and ${names.length - 4} more` : names.join(", ");
    const ok = await confirm({
      title: `Approve ${approvable.length} weekly ${approvable.length === 1 ? "review" : "reviews"}?`,
      description: `${shown}. Each person is notified.`,
      confirmLabel: "Approve",
      destructive: false,
    });
    if (!ok) return;
    let done = 0;
    const failed: string[] = [];
    for (const r of approvable) {
      const res = await apiFetchWithRetry(`/api/weekly-reviews/${r.id}/manager-review`, { method: "PATCH", keepalive: true, json: { decision: "APPROVED" } }, { retryWrites: true });
      if (res.ok) done += 1; else failed.push(personName(r.subject));
    }
    setSelected(new Set());
    toast(failed.length ? `Approved ${done}. Not saved for ${failed.join(", ")}, try again.` : `Approved ${done} weekly ${done === 1 ? "review" : "reviews"}`, failed.length ? { tone: "danger" } : undefined);
    void load();
  };
  const bulkRemind = async () => {
    const res = await apiFetch<{ notified: number; skipped: number }>("/api/weekly-reviews/reminders", { method: "POST", json: { ids: [...selected] } });
    if (!res.ok) { toast(res.error || "Couldn't send the reminders", { tone: "danger" }); return; }
    toast(res.data.notified ? `Reminded ${res.data.notified} ${res.data.notified === 1 ? "person" : "people"}` : "Nobody needed a reminder");
    setSelected(new Set());
  };
  const exportHref = (ids?: string[]) => {
    const p = new URLSearchParams(listQs);
    p.delete("page");
    p.set("format", "csv");
    if (ids?.length) p.set("ids", ids.join(","));
    return `/api/weekly-reviews?${p}`;
  };

  // ── Toolbar popovers ──────────────────────────────────────────────
  const [filterOpen, setFilterOpen] = useState(filters > 0 && !!person);
  const [sortOpen, setSortOpen] = useState(false);
  const [groupOpen, setGroupOpen] = useState(false);
  const [draftQ, setDraftQ] = useState(q);
  const [personPick, setPersonPick] = useState<PickPerson | null>(null);
  useEffect(() => {
    if (draftQ === q) return;
    const t = setTimeout(() => setParams({ q: draftQ.trim() || null }), 250);
    return () => clearTimeout(t);
  }, [draftQ, q, setParams]);
  const clearFilters = () => {
    setDraftQ("");
    setPersonPick(null);
    setParams({ q: null, person: null, week: null, status: null, scope: hasReports ? "direct" : null });
  };
  const weeks = useMemo(() => recentWeekKeys(new Date(), 12), []);
  const toggleStatus = (k: string, on: boolean) => {
    const next = new Set(statuses);
    if (on) next.add(k); else next.delete(k);
    setParams({ status: [...next].join(",") || null });
  };

  const [menu, setMenu] = useState<{ row: WeeklyQueueRow; anchor: RefObject<HTMLElement | null> } | null>(null);
  const copyLink = (id: string) => {
    void navigator.clipboard.writeText(`${window.location.origin}/team/reviews?review=${encodeURIComponent(id)}`)
      .then(() => toast("Link copied"), () => toast("Couldn't copy the link", { tone: "danger" }));
  };

  const columns: TableColumn<WeeklyQueueRow>[] = [
    {
      key: "person", label: "Person", title: true, width: "minmax(200px,1.4fr)",
      render: (r) => (
        <span className="flex min-w-0 items-center gap-2">
          <PersonAvatar person={r.subject} size={28} />
          <span className="min-w-0 truncate">{personName(r.subject)}</span>
          {r.subject.jobTitle ? <span className="hidden min-w-0 truncate text-sm font-normal text-ink-2 lg:inline">· {r.subject.jobTitle}</span> : null}
        </span>
      ),
    },
    { key: "week", label: "Week", width: "130px", render: (r) => <span className="tabular-nums">{weekRange(r.week)}</span> },
    { key: "status", label: "Status", width: "170px", render: (r) => <ToneChip tone={r.statusTone as Tone} label={r.statusLabel} /> },
    ...(cols.highlights ? [{ key: "highlights", label: "Highlights", width: "minmax(180px,2fr)", hideBelow: 900, render: (r: WeeklyQueueRow) => <span className="truncate text-ink-2">{r.highlights || (r.status === "DRAFT" ? "Not submitted yet" : "")}</span> }] : []),
    ...(cols.kras ? [{ key: "kras", label: "KRAs", width: "130px", hideBelow: 760, render: (r: WeeklyQueueRow) => <span className="text-ink-2">{r.kras.total ? `${r.kras.onTrack} of ${r.kras.total} on track` : ""}</span> }] : []),
    ...(cols.submitted ? [{
      key: "submitted", label: view === "acted" ? "Decided" : "Submitted", width: "120px", hideBelow: 640,
      render: (r: WeeklyQueueRow) => {
        const at = view === "acted" ? r.reviewedAt : r.submittedAt;
        return <span className="text-ink-2" title={at ? formatDate(at, datePrefs, "datetime") : undefined}>{at ? formatRelative(at, datePrefs) : ""}</span>;
      },
    }] : []),
  ];

  const groupCount = new Map((list?.groups ?? []).map((g) => [g.key, g.count] as const));
  const groupOf = group === "none" ? undefined : (r: WeeklyQueueRow) => (group === "person"
    ? { key: r.userId, label: personName(r.subject), count: groupCount.get(r.userId) ?? null }
    : { key: r.week, label: `Week of ${weekRange(r.week)}`, count: groupCount.get(r.week) ?? null });

  const total = list?.pagination.total ?? 0;
  const pageSize = list?.pagination.pageSize ?? 40;
  const from = total ? (page - 1) * pageSize + 1 : 0;
  const to = Math.min(total, page * pageSize);

  const emptyNode = filters > 0 ? (
    <span className="text-row text-ink-2">No reviews match · <button type="button" className="text-brand-deep hover:underline" onClick={clearFilters}>Clear filters</button></span>
  ) : view === "waiting" ? (
    <span className="text-row text-ink-2">Nothing waiting on you · <button type="button" className="text-brand-deep hover:underline" onClick={() => setParams({ view: "all" })}>See everything from your team</button></span>
  ) : view === "acted" ? (
    <span className="text-row text-ink-2">You have not decided a weekly review in the last 30 days</span>
  ) : (
    <span className="text-row text-ink-2">Your team has not written a weekly review yet</span>
  );

  return (
    <>
      <Breadcrumb items={[{ label: "Weekly reviews" }]} />
      <OsPageHeader
        title="Weekly reviews"
        askAi
        views={
          <>
            <ViewTab label="Waiting on you" active={view === "waiting"} onClick={() => setParams({ view: null })} />
            <ViewTab label="Acted" active={view === "acted"} onClick={() => setParams({ view: "acted" })} />
            <ViewTab label="All" active={view === "all"} onClick={() => setParams({ view: "all" })} />
          </>
        }
        toolbar={{
          filter: { open: filterOpen, onToggle: () => setFilterOpen((v) => !v), count: filters },
          sort: { onClick: () => setSortOpen((v) => !v), label: sort === "oldest" ? "Sort" : SORTS.find((s) => s.value === sort)?.label, active: sort !== "oldest" },
          group: { onClick: () => setGroupOpen((v) => !v), label: group === "none" ? "Group" : `Group: ${GROUPS.find((g) => g.value === group)?.label}`, active: group !== "none" },
          menu: [
            ...OPTIONAL_COLS.map((c) => ({ label: `Show ${c.label}`, checked: cols[c.key], keepOpen: true, onClick: () => setCol(c.key, !cols[c.key]) })),
            { separator: true as const },
            { label: "Weekly review", icon: ExternalLink, onClick: () => router.push("/me/weekly-review") },
            ...(canExportAll && !isAgent ? [{ label: "Export CSV", icon: Download, onClick: () => { window.location.href = exportHref(); } }] : []),
          ],
        }}
      />
      <div className="relative">
        {sortOpen ? (
          <div className="absolute start-[110px] top-0 z-40">
            <Picker open onClose={() => setSortOpen(false)} ariaLabel="Sort weekly reviews" selected={sort}
              sections={[{ options: SORTS }]}
              onSelect={(v) => { setSortOpen(false); setParams({ sort: v === "oldest" ? null : v }); }} />
          </div>
        ) : null}
        {groupOpen ? (
          <div className="absolute start-[200px] top-0 z-40">
            <Picker open onClose={() => setGroupOpen(false)} ariaLabel="Group weekly reviews" selected={group}
              sections={[{ options: GROUPS }]}
              onSelect={(v) => { setGroupOpen(false); setParams({ group: v === "none" ? null : v }); }} />
          </div>
        ) : null}
      </div>
      <div className="os-chrome flex min-h-0 flex-1 gap-4 px-6 pb-8 pt-2">
        <FilterPanel
          open={filterOpen}
          onClose={() => setFilterOpen(false)}
          objects="reviews"
          activeCount={filters}
          onClearAll={clearFilters}
          search={{ value: draftQ, onChange: setDraftQ, placeholder: "Search people and highlights" }}
        >
          {hasReports ? (
            <FilterGroup label="Scope">
              <li className="flex h-9 items-center justify-between gap-2 px-2 text-sm text-ink">
                <span>Direct reports only</span>
                <Switch checked={scope === "direct"} onChange={(on) => setScope(on ? "direct" : "chain")} aria-label="Direct reports only" />
              </li>
            </FilterGroup>
          ) : null}
          <FilterGroup label="Person">
            <li className="px-1 py-1">
              <PeoplePickerField
                ariaLabel="Person"
                value={person ? [person] : []}
                people={personPick ? [personPick] : []}
                placeholder="Anyone"
                onChange={(ids, picked) => { setPersonPick(picked[0] ?? null); setParams({ person: ids[0] ?? null }); }}
              />
            </li>
          </FilterGroup>
          <FilterGroup label="Status">
            {STATUS_ROWS.map((s) => <FilterRow key={s.key} label={s.label} checked={statuses.includes(s.key)} onCheckedChange={(on) => toggleStatus(s.key, on)} />)}
          </FilterGroup>
          <FilterGroup label="Week">
            {weeks.map((w) => <FilterRow key={w} label={weekRange(w)} checked={week === w} onCheckedChange={(on) => setParams({ week: on ? w : null })} />)}
          </FilterGroup>
        </FilterPanel>
        <div className="min-w-0 flex-1">
          {person && rows && !rows.some((r) => r.userId === person) && listFor === listQs ? (
            <p className="mb-2 text-sm text-ink-2">Nothing from this person in this view. <button type="button" className="text-brand-deep hover:underline" onClick={() => setParams({ person: null })}>Show everyone</button></p>
          ) : null}
          {error && !list ? (
            <OsEmptyView variant="error" title="Couldn't load weekly reviews" hint={error} action={{ label: "Try again", onClick: () => void load() }} />
          ) : (
            <TableCard
              ariaLabel="Weekly reviews"
              columns={columns}
              rows={rows}
              rowKey={(r) => r.id}
              onRowClick={(r) => setParams({ review: r.id }, { push: true })}
              highlightKey={reviewId}
              selectable
              selected={selected}
              onSelectedChange={setSelected}
              groupOf={groupOf}
              rowMenu={(r) => (
                <RowMoreButton
                  label={`Actions for ${personName(r.subject)}`}
                  open={menu?.row.id === r.id}
                  onClick={(e) => { e.stopPropagation(); setMenu({ row: r, anchor: { current: e.currentTarget } }); }}
                />
              )}
              empty={emptyNode}
              bulkActions={
                <>
                  {approvable.length ? <BulkAction icon={Check} label={`Approve ${approvable.length}`} onClick={() => void bulkApprove()} /> : null}
                  <BulkAction icon={Bell} label="Send a reminder" onClick={() => void bulkRemind()} />
                  {!isAgent ? <BulkAction icon={Download} label="Export selected" onClick={() => { window.location.href = exportHref([...selected]); }} /> : null}
                </>
              }
              footer={list ? {
                total,
                noun: "reviews",
                from,
                to,
                onPrev: page > 1 ? () => setParams({ page: String(page - 1) }) : undefined,
                onNext: to < total ? () => setParams({ page: String(page + 1) }) : undefined,
              } : undefined}
            />
          )}
        </div>
      </div>

      {menu ? (
        <MorePortal anchorRef={menu.anchor} width={220} open placement="below" onClose={() => setMenu(null)}>
          <MenuList aria-label="Weekly review actions">
            <MenuItem icon={ExternalLink} label="Open" onClick={() => { const id = menu.row.id; setMenu(null); setParams({ review: id }, { push: true }); }} />
            <MenuItem icon={UserRound} label="Open their profile" onClick={() => { const id = menu.row.userId; setMenu(null); router.push(`/people/${id}`); }} />
            <MenuItem icon={Link2} label="Copy link" onClick={() => { const id = menu.row.id; setMenu(null); copyLink(id); }} />
          </MenuList>
        </MorePortal>
      ) : null}

      {reviewId ? (
        <WeeklyReviewDrawer
          key={reviewId}
          reviewId={reviewId}
          viewerId={viewerId}
          onClose={() => setParams({ review: null })}
          onDecided={() => void load()}
          onCopyLink={() => copyLink(reviewId)}
        />
      ) : null}
    </>
  );
}

// ── The drawer ──────────────────────────────────────────────────────

function WeeklyReviewDrawer({
  reviewId,
  viewerId,
  onClose,
  onDecided,
  onCopyLink,
}: {
  reviewId: string;
  viewerId: string;
  onClose: () => void;
  onDecided: () => void;
  onCopyLink: () => void;
}) {
  const { toast } = useOsToast();
  const confirm = useConfirm();
  const datePrefs = useDatePrefs();
  const [review, setReview] = useState<WeeklyReviewDetail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [expanded, setExpanded] = useState(false);
  const [notes, setNotes] = useState("");
  const [busy, setBusy] = useState<null | "APPROVED" | "CHANGES_REQUESTED">(null);
  const [failed, setFailed] = useState<string | null>(null);
  const notesRef = useRef<HTMLTextAreaElement>(null);

  const load = useCallback(async () => {
    const r = await apiFetch<{ review: WeeklyReviewDetail }>(`/api/weekly-reviews/${encodeURIComponent(reviewId)}`, { cache: "no-store" });
    if (!r.ok) { setError(r.status === 404 ? "This weekly review is not available to you, or it no longer exists." : r.error || "Couldn't load this weekly review"); return; }
    setError(null);
    setReview(r.data.review);
  }, [reviewId]);
  useEffect(() => {
    const t = setTimeout(() => { void load(); }, 0);
    return () => clearTimeout(t);
  }, [load]);

  const dirty = notes.trim().length > 0 && busy === null;
  // A written note is never thrown away by a slip: close asks first.
  const close = useCallback(async () => {
    if (dirty && !(await confirm({ title: "Discard your note?", description: "It has not been sent.", confirmLabel: "Discard", destructive: true }))) return;
    onClose();
  }, [dirty, confirm, onClose]);
  const canClose = useCallback(() => {
    if (!dirty) return true;
    void close();
    return false;
  }, [dirty, close]);

  const first = review?.subject.firstName || (review ? personName(review.subject) : "them");
  const waiting = review?.status === "SUBMITTED";
  const canAct = !!review && waiting && review.canDecide && review.userId !== viewerId;

  const decide = useCallback(async (decision: "APPROVED" | "CHANGES_REQUESTED") => {
    if (!review) return;
    if (decision === "CHANGES_REQUESTED" && !notes.trim()) { notesRef.current?.focus(); return; }
    setBusy(decision);
    setFailed(null);
    const res = await apiFetchWithRetry(`/api/weekly-reviews/${review.id}/manager-review`, {
      method: "PATCH",
      keepalive: true,
      json: { decision, notes: notes.trim() || undefined },
    }, { retryWrites: true });
    setBusy(null);
    if (!res.ok) {
      // The note stays in the field; nothing typed is lost.
      setFailed(res.error ? `Not saved: ${res.error}` : "Not saved, retrying did not help. Try again.");
      return;
    }
    const id = review.id;
    setNotes("");
    onDecided();
    onClose();
    toast(decision === "APPROVED" ? `Approved ${first}'s weekly review` : `Sent ${first} your note`, {
      onUndo: () => {
        void apiFetch(`/api/weekly-reviews/${id}/manager-review`, { method: "PATCH", json: { decision: "REOPEN" } }).then((r) => {
          if (!r.ok) toast(r.error || "Couldn't undo it", { tone: "danger" });
          onDecided();
        });
      },
    });
  }, [review, notes, first, onDecided, onClose, toast]);

  // Cmd+Enter approves (the destructive path has no shortcut).
  useEffect(() => {
    if (!canAct) return;
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === "Enter" && busy === null) { e.preventDefault(); void decide("APPROVED"); }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [canAct, busy, decide]);

  const section = (label: string, body: React.ReactNode) => (
    <section className="flex flex-col">
      <h3 className="m-0 flex h-9 items-center text-sm font-medium text-ink-2">{label}</h3>
      {body}
    </section>
  );
  const prose = (text: string | null | undefined) => text?.trim()
    ? <p className="m-0 whitespace-pre-wrap text-row text-ink">{text}</p>
    : <p className="m-0 text-row text-ink-3">Nothing written</p>;

  return (
    <Drawer
      open
      onClose={onClose}
      canClose={canClose}
      ariaLabel="Weekly review"
      layerId="weekly-review-drawer"
      expanded={expanded}
      header={
        <>
          <span className="min-w-0 flex-1 truncate text-sm text-ink-2">
            {review ? <>{personName(review.subject)} › <span className="text-ink">week of {weekRange(review.week)}</span></> : "Weekly review"}
          </span>
          <button type="button" aria-label={expanded ? "Collapse" : "Expand"} title={expanded ? "Collapse" : "Expand"} onClick={() => setExpanded((v) => !v)} className="inline-flex h-8 w-8 items-center justify-center rounded-md text-ink-2 hover:bg-hover hover:text-ink">
            {expanded ? <Minimize2 className="h-4 w-4" /> : <Maximize2 className="h-4 w-4" />}
          </button>
          <button type="button" aria-label="Copy link" title="Copy link" onClick={onCopyLink} className="inline-flex h-8 w-8 items-center justify-center rounded-md text-ink-2 hover:bg-hover hover:text-ink">
            <Copy className="h-4 w-4" />
          </button>
          <button type="button" aria-label="Close" onClick={() => void close()} className="inline-flex h-8 w-8 items-center justify-center rounded-md text-ink-2 hover:bg-hover hover:text-ink">
            <X className="h-4 w-4" />
          </button>
        </>
      }
      footer={canAct ? (
        <div className="flex w-full flex-col gap-1 px-5 py-3">
          {failed ? <p className="m-0 text-sm text-danger-text" role="alert">{failed}</p> : null}
          <div className="flex items-center justify-end gap-2">
            <div className="me-auto flex flex-col">
              <button type="button" disabled={busy !== null || !notes.trim()} onClick={() => void decide("CHANGES_REQUESTED")}
                className="inline-flex h-9 items-center rounded-md border border-line bg-raised px-3 text-sm font-medium text-ink hover:bg-hover disabled:cursor-not-allowed disabled:opacity-50">
                {busy === "CHANGES_REQUESTED" ? "Sending" : "Request changes"}
              </button>
            </div>
            <button type="button" disabled={busy !== null} onClick={() => void decide("APPROVED")}
              className="inline-flex h-9 items-center rounded-md bg-brand px-4 text-sm font-medium text-white hover:bg-brand-hover disabled:opacity-60">
              {busy === "APPROVED" ? "Approving" : "Approve"}
            </button>
          </div>
          {!notes.trim() ? <p className="m-0 text-xs text-ink-2">Request changes needs a note, so {first} knows what to change.</p> : null}
        </div>
      ) : undefined}
    >
      <div className="flex flex-col gap-4 px-5 py-4">
        {error ? (
          <OsEmptyView variant="error" compact title="Couldn't open this weekly review" hint={error} action={{ label: "Try again", onClick: () => void load() }} />
        ) : !review ? (
          <SkeletonLines lines={8} />
        ) : (
          <>
            <div className="flex flex-wrap items-center gap-2">
              <PersonAvatar person={review.subject} size={32} />
              <span className="min-w-0">
                <Link href={`/people/${review.subject.id}`} className="block truncate text-row font-medium text-ink hover:underline">{personName(review.subject)}</Link>
                <span className="block truncate text-sm text-ink-2">
                  {[review.subject.jobTitle, review.submittedAt ? `Submitted ${formatRelative(review.submittedAt, datePrefs)}` : null].filter(Boolean).join(" · ")}
                </span>
              </span>
              <span className="ms-auto"><ToneChip tone={review.statusTone as Tone} label={review.statusLabel} /></span>
            </div>
            {!review.body ? (
              <p className="m-0 rounded-md bg-subtle px-3 py-2 text-sm text-ink-2">{first} has not submitted this week&apos;s review yet. What they have written stays theirs until they do.</p>
            ) : (
              <>
                {section("KRA progress", review.body.kras.length ? (
                  <ul className="m-0 flex list-none flex-col gap-2 p-0">
                    {review.body.kras.map((k) => (
                      <li key={k.kraId} className="flex flex-col gap-1">
                        <span className="flex items-center gap-2 text-row text-ink">
                          <span className="min-w-0 flex-1 truncate">{k.name}</span>
                          <span className="shrink-0 tabular-nums text-ink-2">{k.progressPct == null ? "No number" : `${k.progressPct}%`}</span>
                        </span>
                        <span className="h-1 w-full overflow-hidden rounded-full bg-subtle" aria-hidden>
                          <span className="block h-full rounded-full bg-brand" style={{ width: `${k.progressPct ?? 0}%` }} />
                        </span>
                        {k.note ? <span className="text-sm text-ink-2">{k.note}</span> : null}
                      </li>
                    ))}
                  </ul>
                ) : <p className="m-0 text-row text-ink-3">No KRA progress this week</p>)}
                {section("KPI snapshots", review.body.kpis.length ? (
                  <ul className="m-0 flex list-none flex-col divide-y divide-line-soft rounded-md border border-line p-0">
                    {review.body.kpis.map((k) => (
                      <li key={k.kpiId} className="flex min-h-11 items-center gap-2 px-3 py-1.5">
                        <span className="min-w-0 flex-1">
                          <span className="block truncate text-row text-ink">{k.name}</span>
                          {k.note ? <span className="block truncate text-sm text-ink-2">{k.note}</span> : null}
                        </span>
                        <span className="shrink-0 text-sm tabular-nums text-ink-2">
                          {k.value == null ? "" : `${k.value}${k.unit ? ` ${k.unit}` : ""}`}{k.target != null ? ` of ${k.target}` : ""}
                        </span>
                        <ToneChip tone={k.tone as Tone} label={k.toneLabel} />
                      </li>
                    ))}
                  </ul>
                ) : <p className="m-0 text-row text-ink-3">No KPI numbers this week</p>)}
                {section("Highlights", prose(review.body.highlights))}
                {section("Blockers", prose(review.body.blockers))}
                {section("Plan", prose(review.body.plan))}
              </>
            )}
            {review.status === "ACKNOWLEDGED" ? section(
              review.decidedBy ? `Decided by ${review.decidedBy.name}` : "Decision",
              <>
                <p className="m-0 text-sm text-ink-2">{review.reviewedAt ? formatDate(review.reviewedAt, datePrefs, "datetime") : ""}</p>
                {prose(review.managerNotes)}
              </>,
            ) : null}
            {canAct ? section(`Notes to ${first}`, (
              <>
                {review.decidingForManager && review.manager ? (
                  <p className="m-0 mb-2 text-sm text-ink-2">{review.manager.firstName} {review.manager.lastName} is {first}&apos;s manager. Your decision is recorded as yours.</p>
                ) : null}
                <textarea
                  ref={notesRef}
                  value={notes}
                  onChange={(e) => { setNotes(e.target.value); setFailed(null); }}
                  rows={3}
                  maxLength={5000}
                  aria-label={`Notes to ${first}`}
                  placeholder={`What should ${first} know?`}
                  className="min-h-[76px] w-full resize-y rounded-md border border-line bg-raised px-3 py-2 text-row text-ink outline-none focus-visible:border-[var(--os-focus)]"
                />
              </>
            )) : waiting && !review.canDecide ? (
              <p className="m-0 text-sm text-ink-2">Only {review.manager ? `${review.manager.firstName} ${review.manager.lastName}` : "their manager"} can approve this.</p>
            ) : null}
          </>
        )}
      </div>
    </Drawer>
  );
}
