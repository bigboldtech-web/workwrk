"use client";

// Candor (spec-teams-performance /candor): answer the anonymous questions
// your company is asking, and, if you run sessions, see how they are going.
//
//   To answer   (every viewer, the default) a 720 column of the Open sessions
//               in your scope: Answer, or "Answered" once you have. No answer
//               counts, no progress bars: a respondent must never infer who
//               answered.
//   Sessions    (people who run sessions) Draft and Open sessions, a TableCard
//               with no checkbox column; the row "..." holds Launch, Close,
//               Reopen and Delete draft, each behind a confirm
//   Closed      the same, closed
// A plain Member holds one view, so the views row and the toolbar do not
// render: the title, then the cards. Typing ?view=sessions without running
// sessions shows To answer with one notice line (a view of a page you hold,
// not a denial). "Already answered" is the server's record
// (CandorRespondent), never a browser flag.
//
// Running sessions and starting one are two facts: `organiser` holds the
// Sessions and Closed views (a session already run stays manageable), and
// `canCreate` adds a scope to ask (lib/people/culture-gate.ts
// candorMayCreate). A manager by reporting line whose chain covers no
// department sees no New session, only one quiet line saying who can run
// one. The row menu checks the scope before Launch and Reopen, and names
// the real audience (candorAudienceOf) or says why it cannot.

import { useCallback, useEffect, useMemo, useRef, useState, type RefObject } from "react";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { Check, Ban, ExternalLink, Link2, Play, Plus, RotateCcw, Trash2 } from "lucide-react";
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
import { AnonymityNote } from "@/components/culture/anonymity-note";
import { apiFetch } from "@/lib/api-fetch";
import { formatDate } from "@/lib/format/date";
import { useDatePrefs } from "@/lib/format/use-date-prefs";
import { CANDOR_NO_SCOPE_NOTE, candorAudienceOf, candorHasAnyScope, candorScopeAllowed, candorScopeRefusal, candorStatusOf, type CandorScopes } from "@/lib/performance/candor";
import { ANONYMITY_FLOOR } from "@/lib/people/anonymity";

type Row = {
  id: string;
  title: string;
  status: "DRAFT" | "ACTIVE" | "CLOSED";
  prompts: Array<{ id: string; text: string; type: string }>;
  department: { id: string; name: string } | null;
  launchedAt: string | null;
  closedAt: string | null;
  createdAt: string;
  isOwner: boolean;
  hasResponded: boolean;
  responseCount?: number;
};
type ListResponse = { data: Row[]; view: "answer" | "sessions" | "closed"; downgraded: boolean; canRun: boolean; canCreate?: boolean; scopes?: CandorScopes; total: number };
type OptionalCol = "scope" | "prompts" | "answers" | "opened";
const OPTIONAL_COLS: Array<{ key: OptionalCol; label: string }> = [
  { key: "scope", label: "Scope" },
  { key: "prompts", label: "Prompts" },
  { key: "answers", label: "Answers" },
  { key: "opened", label: "Opened" },
];

export default function CandorClient({ organiser, canCreate: canCreateAtLoad }: { organiser: boolean; canCreate: boolean }) {
  const router = useRouter();
  const pathname = usePathname();
  const sp = useSearchParams();
  const { toast } = useOsToast();
  const { prefs, patchPrefs } = useOsShell();
  const { boot } = useBoot();
  const confirm = useConfirm();
  const datePrefs = useDatePrefs();
  const isAgent = !!(boot.viewer as { isAgent?: boolean }).isAgent;
  const orgName = boot?.org?.name?.trim() || null;

  const asked = sp?.get("view");
  const view: "answer" | "sessions" | "closed" = organiser && (asked === "sessions" || asked === "closed") ? asked : "answer";
  const q = sp?.get("q") ?? "";
  const statusF = sp?.get("status") ?? "";
  const scopeF = sp?.get("scope") ?? "";
  const sort = sp?.get("sort") === "answers" ? "answers" : "newest";
  const filters = [q, statusF, scopeF].filter(Boolean).length;

  const setParams = useCallback((patch: Record<string, string | null>) => {
    const next = new URLSearchParams(sp?.toString() ?? "");
    for (const [k, v] of Object.entries(patch)) { if (v) next.set(k, v); else next.delete(k); }
    const s = next.toString();
    router.replace(s ? `${pathname}?${s}` : pathname, { scroll: false });
  }, [sp, router, pathname]);

  // A view of a page the viewer holds, asked for by URL: the default view,
  // the parameter stripped, one notice line (access 5.5 rule 4).
  // The notice is decided once, from the URL the page opened with, so
  // stripping the parameter does not take the line away with it.
  const [notice] = useState<string | null>(() => (!organiser && (asked === "sessions" || asked === "closed") ? "Only people who run candor sessions can see that view." : null));
  const stripped = useRef(false);
  useEffect(() => {
    if (stripped.current || organiser || !(asked === "sessions" || asked === "closed")) return;
    stripped.current = true;
    setParams({ view: null });
  }, [asked, organiser, setParams]);

  const [list, setList] = useState<ListResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const load = useCallback(async () => {
    const r = await apiFetch<ListResponse>(`/api/candor?view=${view}`, { cache: "no-store" });
    if (!r.ok) { setError(r.error || "Couldn't load candor sessions"); toast(r.error || "Couldn't load candor sessions", { tone: "danger" }); return; }
    setError(null);
    setList(r.data);
  }, [view, toast]);
  useEffect(() => { const t = setTimeout(() => { void load(); }, 0); return () => clearTimeout(t); }, [load]);
  useEffect(() => {
    const again = () => void load();
    window.addEventListener("focus", again);
    return () => window.removeEventListener("focus", again);
  }, [load]);
  const loading = !list || list.view !== view;
  // The server's answer once the list is in (reports can move while the page
  // is open); the page gate's until then.
  const canCreate = organiser && (list ? list.canCreate ?? canCreateAtLoad : canCreateAtLoad);
  const noScopeNote = organiser && !canCreate ? CANDOR_NO_SCOPE_NOTE : null;

  // Display columns (home.teams.surface.candor.viewOptions.columns).
  const stored = ((prefs.home as { teams?: { surface?: Record<string, { viewOptions?: { columns?: Record<string, boolean> } }> } } | undefined)
    ?.teams?.surface?.candor?.viewOptions?.columns) ?? {};
  const [colsLocal, setColsLocal] = useState<Partial<Record<OptionalCol, boolean>>>({});
  const cols = Object.fromEntries(OPTIONAL_COLS.map((c) => [c.key, colsLocal[c.key] ?? stored[c.key] ?? true])) as Record<OptionalCol, boolean>;
  const setCol = (k: OptionalCol, on: boolean) => {
    setColsLocal((c) => ({ ...c, [k]: on }));
    void patchPrefs({ home: { teams: { surface: { candor: { viewOptions: { columns: { [k]: on } } } } } } }).then((ok) => { if (!ok) toast("Couldn't save that setting", { tone: "danger" }); });
  };

  const [filterOpen, setFilterOpen] = useState(false);
  const [sortOpen, setSortOpen] = useState(false);
  const [draftQ, setDraftQ] = useState(q);
  useEffect(() => {
    if (draftQ === q) return;
    const t = setTimeout(() => setParams({ q: draftQ.trim() || null }), 250);
    return () => clearTimeout(t);
  }, [draftQ, q, setParams]);
  const clearFilters = () => { setDraftQ(""); setParams({ q: null, status: null, scope: null }); };

  const rows = useMemo(() => {
    let r = list?.data ?? [];
    if (q) r = r.filter((x) => x.title.toLowerCase().includes(q.toLowerCase()));
    if (statusF) r = r.filter((x) => x.status === statusF);
    if (scopeF) r = r.filter((x) => (scopeF === "all" ? !x.department : x.department?.id === scopeF));
    if (sort === "answers") r = [...r].sort((a, b) => (b.responseCount ?? 0) - (a.responseCount ?? 0));
    return r;
  }, [list, q, statusF, scopeF, sort]);
  const depts = useMemo(() => [...new Map((list?.data ?? []).filter((x) => x.department).map((x) => [x.department!.id, x.department!.name])).entries()], [list]);

  // ── Actions ───────────────────────────────────────────────────────
  const [creating, setCreating] = useState(false);
  const newSession = async () => {
    setCreating(true);
    const r = await apiFetch<{ id: string }>("/api/candor", { method: "POST", json: { title: "Untitled session", prompts: [] } });
    setCreating(false);
    if (!r.ok) { toast(r.error || "Couldn't start a session", { tone: "danger" }); return; }
    router.push(`/candor/${r.data.id}`);
  };
  // Launch and Reopen ask the session's scope, checked here against what
  // this person may ask before any confirm (the server checks again): the
  // confirm names the real audience, and a scope they may not ask is told
  // plainly, with the way forward (a Draft's scope is changed in its editor).
  const scopes = list?.scopes;
  const rowScopeOk = (row: Row) => !scopes || candorScopeAllowed(scopes, row.department?.id ?? null);
  const move = async (row: Row, status: "ACTIVE" | "CLOSED", reopen = false) => {
    const deptId = row.department?.id ?? null;
    if (status === "ACTIVE" && !reopen && (!rowScopeOk(row) || !row.prompts.length)) {
      const scopeBlocked = !rowScopeOk(row) && !!scopes;
      const why = scopeBlocked ? candorScopeRefusal(scopes!, deptId) : "Add at least one question before you launch.";
      // A person with no scope at all cannot fix this in the editor (no
      // scope there fits either), so the dialog only acknowledges: one OK,
      // no Open session that leads to a page with the same dead end.
      if (scopeBlocked && !candorHasAnyScope(scopes!)) {
        await confirm({ title: `${row.title} cannot launch yet`, description: why ?? "", confirmLabel: "OK", cancelLabel: "", destructive: false });
        return;
      }
      const go = await confirm({ title: `${row.title} cannot launch yet`, description: `${why} Open the session to change it.`, confirmLabel: "Open session", destructive: false });
      if (go) router.push(`/candor/${row.id}`);
      return;
    }
    if (status === "ACTIVE" && reopen && !rowScopeOk(row)) {
      toast(`Only the People team or an Admin can reopen ${row.title} now: it asks people outside your reporting line.`, { tone: "danger" });
      return;
    }
    const audience = candorAudienceOf(row.department?.name, orgName);
    const ok = await confirm(
      status === "CLOSED"
        ? { title: `Close ${row.title}?`, description: "Nobody can answer after this. You can reopen it later.", confirmLabel: "Close session", destructive: false }
        : reopen
          ? { title: `Reopen ${row.title}?`, description: `${audience} who has not answered can answer again.`, confirmLabel: "Reopen", destructive: false }
          : { title: `Launch ${row.title}?`, description: `${audience} can answer from now on, and is told so.`, confirmLabel: "Launch session", destructive: false },
    );
    if (!ok) return;
    const r = await apiFetch(`/api/candor/${row.id}`, { method: "PATCH", json: { status } });
    if (!r.ok) { toast(r.error || "Couldn't change the session", { tone: "danger" }); return; }
    toast(status === "CLOSED" ? "Session closed" : reopen ? "Session reopened" : "Session launched");
    void load();
  };
  const remove = async (row: Row) => {
    const ok = await confirm({ title: `Delete ${row.title}?`, description: "Nothing has been answered yet.", confirmLabel: "Delete draft", destructive: true });
    if (!ok) return;
    const r = await apiFetch(`/api/candor/${row.id}`, { method: "DELETE" });
    if (!r.ok) { toast(r.error || "Couldn't delete it", { tone: "danger" }); return; }
    toast("Draft deleted");
    void load();
  };
  const [menu, setMenu] = useState<{ row: Row; anchor: RefObject<HTMLElement | null> } | null>(null);
  const copyLink = (id: string) => {
    void navigator.clipboard.writeText(`${window.location.origin}/candor/${id}`).then(() => toast("Link copied"), () => toast("Couldn't copy the link", { tone: "danger" }));
  };

  const columns: TableColumn<Row>[] = [
    {
      key: "title", label: "Session", title: true, width: "minmax(240px,2fr)",
      render: (r) => (
        <span className="flex min-w-0 items-center gap-2">
          <span className="min-w-0 truncate">{r.title}</span>
          <ToneChip tone={candorStatusOf(r.status).tone} label={candorStatusOf(r.status).label} />
        </span>
      ),
    },
    ...(cols.scope ? [{ key: "scope", label: "Scope", width: "minmax(130px,1fr)", hideBelow: 820, render: (r: Row) => <span className="truncate text-ink-2">{r.department?.name ?? "Everyone"}</span> }] : []),
    ...(cols.prompts ? [{ key: "prompts", label: "Prompts", width: "90px", numeric: true, hideBelow: 700, render: (r: Row) => <span>{r.prompts.length}</span> }] : []),
    ...(cols.answers ? [{
      key: "answers", label: "Answers", width: "130px", numeric: true,
      render: (r: Row) => <span>{r.responseCount ?? 0}{(r.responseCount ?? 0) < ANONYMITY_FLOOR && r.status !== "DRAFT" ? <span className="ms-1 text-xs text-ink-2">needs {ANONYMITY_FLOOR}</span> : null}</span>,
    }] : []),
    ...(cols.opened ? [{ key: "opened", label: "Opened", width: "120px", hideBelow: 960, render: (r: Row) => <span className="tabular-nums text-ink-2">{r.launchedAt ? formatDate(r.launchedAt, datePrefs, "date") : ""}</span> }] : []),
    ...(view === "closed" ? [{ key: "closed", label: "Closed on", width: "120px", render: (r: Row) => <span className="tabular-nums text-ink-2">{r.closedAt ? formatDate(r.closedAt, datePrefs, "date") : ""}</span> }] : []),
  ];

  const tableView = view === "sessions" || view === "closed";
  return (
    <>
      <Breadcrumb items={[{ label: "Candor" }]} />
      <OsPageHeader
        title="Candor"
        askAi
        views={organiser ? (
          <>
            <ViewTab label="To answer" active={view === "answer"} onClick={() => setParams({ view: null, status: null })} />
            <ViewTab label="Sessions" active={view === "sessions"} onClick={() => setParams({ view: "sessions", status: null })} />
            <ViewTab label="Closed" active={view === "closed"} onClick={() => setParams({ view: "closed", status: null })} />
          </>
        ) : undefined}
        toolbar={organiser && (tableView || canCreate) ? {
          ...(tableView ? {
            filter: { open: filterOpen, onToggle: () => setFilterOpen((v) => !v), count: filters },
            sort: { onClick: () => setSortOpen((v) => !v), label: sort === "answers" ? "Most answers" : "Sort", active: sort === "answers" },
          } : {}),
          ...(canCreate ? { primary: { label: "New session", icon: Plus, busy: creating, onClick: () => void newSession() } } : {}),
          ...(tableView ? { menu: OPTIONAL_COLS.map((c) => ({ label: `Show ${c.label}`, checked: cols[c.key], keepOpen: true, onClick: () => setCol(c.key, !cols[c.key]) })) } : {}),
        } : undefined}
      />
      {/* The notice sits in the same column as the body under it. */}
      {notice ? <p className={`m-0 w-full px-6 pt-2 text-sm text-ink-2 ${tableView ? "" : "mx-auto max-w-[720px]"}`}>{notice}</p> : null}
      {noScopeNote ? <p className={`m-0 w-full px-6 pt-2 text-sm text-ink-2 ${tableView ? "" : "mx-auto max-w-[720px]"}`}>{noScopeNote}</p> : null}
      <div className="relative">
        {sortOpen ? (
          <div className="absolute start-[110px] top-0 z-40">
            <Picker open onClose={() => setSortOpen(false)} ariaLabel="Sort sessions" selected={sort}
              sections={[{ options: [{ value: "newest", label: "Newest first" }, { value: "answers", label: "Most answers" }] }]}
              onSelect={(v) => { setSortOpen(false); setParams({ sort: v === "answers" ? "answers" : null }); }} />
          </div>
        ) : null}
      </div>
      <div className="os-chrome flex min-h-0 flex-1 gap-4 overflow-y-auto px-6 pb-8 pt-2">
        {tableView ? (
          <FilterPanel open={filterOpen} onClose={() => setFilterOpen(false)} objects="sessions" activeCount={filters} onClearAll={clearFilters}
            search={{ value: draftQ, onChange: setDraftQ, placeholder: "Search sessions" }}>
            {view === "sessions" ? (
              <FilterGroup label="Status">
                <FilterRow label="Draft" checked={statusF === "DRAFT"} onCheckedChange={(on) => setParams({ status: on ? "DRAFT" : null })} />
                <FilterRow label="Open" checked={statusF === "ACTIVE"} onCheckedChange={(on) => setParams({ status: on ? "ACTIVE" : null })} />
              </FilterGroup>
            ) : null}
            <FilterGroup label="Scope">
              <FilterRow label="Everyone" checked={scopeF === "all"} onCheckedChange={(on) => setParams({ scope: on ? "all" : null })} />
              {depts.map(([id, name]) => <FilterRow key={id} label={name} checked={scopeF === id} onCheckedChange={(on) => setParams({ scope: on ? id : null })} />)}
            </FilterGroup>
          </FilterPanel>
        ) : null}
        <div className="min-w-0 flex-1">
          {error && !list ? (
            <OsEmptyView variant="error" title="Couldn't load candor sessions" hint={error} action={{ label: "Try again", onClick: () => void load() }} />
          ) : tableView ? (
            <TableCard
              ariaLabel={view === "closed" ? "Closed sessions" : "Sessions"}
              columns={columns}
              rows={loading ? null : rows}
              rowKey={(r) => r.id}
              rowHref={(r) => `/candor/${r.id}`}
              rowMenu={(r) => <RowMoreButton label={`Actions for ${r.title}`} open={menu?.row.id === r.id} onClick={(e) => setMenu({ row: r, anchor: { current: e.currentTarget } })} />}
              empty={filters ? (
                <span className="text-row text-ink-2">No sessions match · <button type="button" className="text-brand-deep hover:underline" onClick={clearFilters}>Clear filters</button></span>
              ) : view === "closed" ? <span className="text-row text-ink-2">No closed sessions yet</span> : !canCreate ? <span className="text-row text-ink-2">No sessions yet</span> : (
                <span className="text-row text-ink-2">No sessions yet · <button type="button" className="text-brand-deep hover:underline" onClick={() => void newSession()}>Start your first session</button></span>
              )}
              footer={loading ? undefined : { total: rows.length, noun: "sessions", from: rows.length ? 1 : 0, to: rows.length, hidePaging: true }}
            />
          ) : (
            <div className="mx-auto flex w-full max-w-[720px] flex-col gap-3">
              <AnonymityNote mode="candor" />
              {loading ? (
                Array.from({ length: 3 }, (_, i) => <Skeleton key={i} className="h-[96px] w-full rounded-lg" />)
              ) : rows.length === 0 ? (
                <OsEmptyView title="Nothing to answer right now" action={canCreate ? { label: "Start a session", onClick: () => void newSession() } : undefined} />
              ) : rows.map((r) => r.hasResponded ? (
                <div key={r.id} className="flex h-11 items-center gap-2 rounded-lg border border-line bg-raised px-4 text-row text-ink-2">
                  <Check className="h-4 w-4 text-success-text" aria-hidden />
                  <span className="min-w-0 flex-1 truncate">{r.title}</span>
                  <span className="text-sm">Answered</span>
                </div>
              ) : (
                <article key={r.id} className="flex items-start gap-4 rounded-lg border border-line bg-raised p-4">
                  <div className="min-w-0 flex-1">
                    <h2 className="m-0 truncate text-lg font-semibold text-ink">{r.title}</h2>
                    <p className="m-0 mt-1 flex flex-wrap items-center gap-2 text-sm text-ink-2">
                      <span className="inline-flex h-6 items-center rounded-md border border-line bg-subtle px-2 text-xs font-medium text-ink">{r.department?.name ?? "Everyone"}</span>
                      <span>{r.prompts.length} {r.prompts.length === 1 ? "question" : "questions"}</span>
                    </p>
                  </div>
                  <Link href={`/candor/${r.id}`} className="inline-flex h-9 shrink-0 items-center rounded-md border border-line bg-raised px-4 text-sm font-medium text-ink hover:bg-hover">Answer</Link>
                </article>
              ))}
              {!loading && rows.length > 0 ? (
                <p className="m-0 px-1 text-sm tabular-nums text-ink-2">
                  {`${rows.length} ${rows.length === 1 ? "session" : "sessions"} · ${rows.filter((r) => !r.hasResponded).length} to answer`}
                </p>
              ) : null}
            </div>
          )}
        </div>
      </div>

      {menu ? (
        <MorePortal anchorRef={menu.anchor} width={220} open placement="below" onClose={() => setMenu(null)}>
          <MenuList aria-label="Session actions">
            <MenuItem icon={ExternalLink} label="Open" onClick={() => { const id = menu.row.id; setMenu(null); router.push(`/candor/${id}`); }} />
            <MenuItem icon={Link2} label="Copy link" onClick={() => { const id = menu.row.id; setMenu(null); copyLink(id); }} />
            {menu.row.status === "DRAFT" ? <><MenuSeparator /><MenuItem icon={Play} label="Launch session" onClick={() => { const r = menu.row; setMenu(null); void move(r, "ACTIVE"); }} /></> : null}
            {menu.row.status === "ACTIVE" ? <><MenuSeparator /><MenuItem icon={Ban} label="Close session" onClick={() => { const r = menu.row; setMenu(null); void move(r, "CLOSED"); }} /></> : null}
            {menu.row.status === "CLOSED" ? (
              <><MenuSeparator />{rowScopeOk(menu.row)
                ? <MenuItem icon={RotateCcw} label="Reopen" onClick={() => { const r = menu.row; setMenu(null); void move(r, "ACTIVE", true); }} />
                : <MenuItem icon={RotateCcw} label="Reopen" disabled description="Ask the People team" />}</>
            ) : null}
            {menu.row.status === "DRAFT" && !isAgent ? <MenuItem icon={Trash2} label="Delete draft" destructive onClick={() => { const r = menu.row; setMenu(null); void remove(r); }} /> : null}
          </MenuList>
        </MorePortal>
      ) : null}
    </>
  );
}
