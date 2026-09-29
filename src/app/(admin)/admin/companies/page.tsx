"use client";

// Companies (spec-admin-backoffice 2.2): every company that has a WorkwrK
// workspace, on the design system's one page pattern. The views row is the
// URL's ?view=, the Filter panel's fields are the URL's filters (so a link,
// a Search result and the back arrow all restore the list exactly), and a
// row opens the company in the 520 drawer at /admin/companies/[id] over this
// list, which stays mounted, scrolled and filtered underneath.
//
// Where the old controls went:
//   - the search box above the table: the Filter panel's "Name or domain"
//     field (the same `search=` the old box wrote) and Search (Cmd+K);
//   - the plan and status selects: the Plan and Status filter fields and the
//     views row;
//   - the Eye "quick edit" dialog and the Manage button: the whole row, which
//     opens the company page (drawer), where every field the dialog had is,
//     with the confirms the dialog skipped;
//   - the slug under the name: the company page's Facts card, the row
//     menu's "Copy slug", and Search, which matches it;
//   - pagination below the card: the card's own footer;
//   - Refresh: "..." > Refresh, plus a refetch on focus after 60 seconds.

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { Building2, Copy, Download, ExternalLink, Info, RefreshCw, ScrollText } from "lucide-react";
import { OsPageHeader } from "@/components/layout/os/page-header";
import { OsEmptyView } from "@/components/layout/os/empty-view";
import { MorePortal } from "@/components/layout/os/more-portal";
import { useOsToast } from "@/components/layout/os/toast";
import { ViewTab } from "@/components/ui/view-tabs";
import { FilterGroup, FilterPanel, FilterRow } from "@/components/ui/filter-panel";
import { Picker } from "@/components/ui/picker";
import { MenuItem, MenuList } from "@/components/ui/menu";
import { TableCard, type TableColumn } from "@/components/ui/table-card";
import { StatusChip, Chip } from "@/components/ui/chip";
import { EntityTile } from "@/components/ui/entity-tile";
import { DateField } from "@/components/ui/date-field";
import { apiFetch } from "@/lib/api-fetch";
import { formatDate, formatDateTitle } from "@/lib/format/date";
import { MODULES } from "@/lib/modules";
import {
  COMPANY_SORTS,
  COMPANY_VIEWS,
  COMPANY_VIEW_LABEL,
  SUBSCRIPTION_FILTERS,
  SUBSCRIPTION_FILTER_LABEL,
  activeCompanyFilterCount,
  companyListQuery,
  parseCompanyListParams,
  type CompanyListParams,
  type CompanyView,
} from "@/lib/admin/companies-list";
import { PLAN_OPTIONS, STATUS_OPTIONS, companyStatusColor, planLabel, statusLabel } from "@/lib/admin/console-labels";
import { choiceFromStored, storedFromChoice } from "@/lib/admin/console-columns";
import { useConsole } from "../../console-context";
import {
  AboutDialog,
  FIELD,
  InlineRetry,
  RowMenuTrigger,
  TEXT_LINK,
  UpdatedMeta,
  ViewCount,
  downloadHref,
  useCopy,
  useStaleRefetch,
} from "../../console-ui";

interface CompanyRow {
  id: string;
  name: string;
  slug: string;
  domain: string | null;
  plan: string;
  status: string;
  createdAt: string;
  people: number;
  ownerCount: number;
  modules: string[];
  subscription: { source: "stripe" | "lifetime" | "none"; status: string; seats: number; trialEndsAt: string | null } | null;
  seatsLabel: string;
}

interface Payload {
  companies: CompanyRow[];
  total: number;
  page: number;
  limit: number;
  counts: Record<CompanyView, number>;
}

const COLUMN_KEYS = ["company", "domain", "plan", "status", "people", "seats", "modules", "signed"] as const;
const OFF_BY_DEFAULT = ["domain"];

export default function CompaniesPage() {
  const router = useRouter();
  const pathname = usePathname() || "/admin/companies";
  const sp = useSearchParams();
  const spKey = sp.toString();
  const params = useMemo(() => parseCompanyListParams(new URLSearchParams(spKey)), [spKey]);
  const { datePrefs, prefs, patchPrefs } = useConsole();
  const { toast } = useOsToast();
  const copy = useCopy(toast);

  const [payload, setPayload] = useState<Payload | null>(null);
  const [failed, setFailed] = useState(false);
  const [loadedAt, setLoadedAt] = useState<number | null>(null);
  const [filterOpen, setFilterOpen] = useState(() => activeCompanyFilterCount(params) > 0);
  const [sortOpen, setSortOpen] = useState(false);
  const [aboutOpen, setAboutOpen] = useState(false);
  const [menu, setMenu] = useState<{ row: CompanyRow; anchor: React.RefObject<HTMLElement | null> } | null>(null);
  // A column's inline "All ▾" filter. The Picker is anchored to a fixed point
  // under the button, because the card clips an absolutely placed popover.
  const [headerFilter, setHeaderFilter] = useState<{ key: "plan" | "status"; point: { top: number; left: number } } | null>(null);
  const openHeaderFilter = (key: "plan" | "status", e: React.MouseEvent<HTMLButtonElement>) => {
    e.preventDefault();
    e.stopPropagation();
    const r = e.currentTarget.getBoundingClientRect();
    setHeaderFilter((f) => (f?.key === key ? null : { key, point: { top: r.bottom + 4, left: r.left } }));
  };
  const seq = useRef(0);

  // The list only answers on /admin/companies itself: while the company
  // drawer is open the URL is the company's, and this page keeps showing
  // the list it had rather than refetching for a URL that is not its own.
  const onList = pathname === "/admin/companies";
  const query = companyListQuery(params);

  const load = useCallback(async () => {
    const mine = ++seq.current;
    const r = await apiFetch<Payload>(`/api/admin/companies${query}`);
    if (mine !== seq.current) return;
    if (r.ok) {
      setFailed(false);
      setPayload(r.data);
      setLoadedAt(Date.now());
    } else if (r.status !== 401) {
      // A failure says so. It never reads as an empty database.
      setFailed(true);
    }
  }, [query]);

  useEffect(() => {
    if (!onList) return;
    const t = setTimeout(() => void load(), 0);
    return () => clearTimeout(t);
  }, [load, onList]);
  useStaleRefetch(() => { if (onList) void load(); }, loadedAt);

  const setParams = useCallback(
    (patch: Partial<CompanyListParams>, opts: { keepPage?: boolean } = {}) => {
      const next = { ...params, ...patch, ...(opts.keepPage ? {} : { page: 1 }) };
      router.replace(`/admin/companies${companyListQuery(next)}`, { scroll: false });
    },
    [params, router],
  );

  // Name or domain: typed into a local field, written to ?search= after
  // 250ms. The URL's value wins when it changes from outside (Search's
  // "See all in Companies", the back arrow).
  const [searchText, setSearchText] = useState(params.search);
  // What this page last wrote to ?search=: its echo is not a new query.
  const [written, setWritten] = useState(params.search);
  const [seenSearch, setSeenSearch] = useState(params.search);
  if (seenSearch !== params.search) {
    setSeenSearch(params.search);
    if (params.search !== written) {
      setWritten(params.search);
      setSearchText(params.search);
    }
  }
  useEffect(() => {
    const v = searchText.trim();
    if (v === written) return;
    const t = window.setTimeout(() => {
      setWritten(v);
      setParams({ search: v });
    }, 250);
    return () => window.clearTimeout(t);
  }, [searchText, written, setParams]);
  const [nameOn, setNameOn] = useState(params.search.length > 0);
  const [peopleOn, setPeopleOn] = useState(params.peopleMin !== null || params.peopleMax !== null);
  const [signedOn, setSignedOn] = useState(params.signedFrom !== null || params.signedTo !== null);

  const activeCount = activeCompanyFilterCount(params);
  const clearAll = () => {
    setWritten("");
    setSearchText("");
    setNameOn(false);
    setPeopleOn(false);
    setSignedOn(false);
    setParams({
      search: "", plans: [], statuses: [], subscriptions: [], modules: [], owners: null,
      peopleMin: null, peopleMax: null, signedFrom: null, signedTo: null,
    });
  };

  const toggleIn = <T extends string>(list: T[], v: T, on: boolean): T[] =>
    on ? (list.includes(v) ? list : [...list, v]) : list.filter((x) => x !== v);

  const exportCsv = () => {
    const q = new URLSearchParams(query.replace(/^\?/, ""));
    q.delete("page");
    q.set("format", "csv");
    downloadHref(`/api/admin/companies?${q.toString()}`);
  };

  const rows = payload?.companies ?? null;
  const total = payload?.total ?? 0;
  const from = total === 0 ? 0 : (params.page - 1) * params.limit + 1;
  const to = Math.min(total, (params.page - 1) * params.limit + (rows?.length ?? 0));

  const planFilter = (
    <span className="relative inline-flex">
      <button type="button" onClick={(e) => openHeaderFilter("plan", e)} aria-haspopup="listbox" aria-expanded={headerFilter?.key === "plan"} className="inline-flex h-6 items-center rounded px-1 text-xs font-medium text-ink-2 hover:bg-hover hover:text-ink">
        {params.plans.length ? params.plans.map(planLabel).join(", ") : "All"} ▾
      </button>
      <Picker
        open={headerFilter?.key === "plan"}
        onClose={() => setHeaderFilter(null)}
        anchorPoint={headerFilter?.key === "plan" ? headerFilter.point : null}
        ariaLabel="Filter by plan"
        multi
        selected={params.plans}
        onSelect={(v) => setParams({ plans: toggleIn(params.plans, v as CompanyListParams["plans"][number], !params.plans.includes(v as never)) })}
        sections={[{ options: PLAN_OPTIONS.map((o) => ({ value: o.value, label: o.label })) }]}
        width={200}
      />
    </span>
  );
  const statusFilter = (
    <span className="relative inline-flex">
      <button type="button" onClick={(e) => openHeaderFilter("status", e)} aria-haspopup="listbox" aria-expanded={headerFilter?.key === "status"} className="inline-flex h-6 items-center rounded px-1 text-xs font-medium text-ink-2 hover:bg-hover hover:text-ink">
        {params.statuses.length ? params.statuses.map(statusLabel).join(", ") : "All"} ▾
      </button>
      <Picker
        open={headerFilter?.key === "status"}
        onClose={() => setHeaderFilter(null)}
        anchorPoint={headerFilter?.key === "status" ? headerFilter.point : null}
        ariaLabel="Filter by status"
        multi
        selected={params.statuses}
        onSelect={(v) => setParams({ statuses: toggleIn(params.statuses, v as CompanyListParams["statuses"][number], !params.statuses.includes(v as never)) })}
        sections={[{ options: STATUS_OPTIONS.map((o) => ({ value: o.value, label: o.label })) }]}
        width={200}
      />
    </span>
  );

  const columns: TableColumn<CompanyRow>[] = [
    {
      key: "company",
      label: "Company",
      title: true,
      width: "minmax(220px,2fr)",
      render: (r) => (
        <span className="inline-flex min-w-0 items-center gap-2">
          <EntityTile size="sm" fallbackIcon={Building2} name={r.name} />
          <span className="truncate" title={r.name}>{r.name}</span>
        </span>
      ),
    },
    { key: "domain", label: "Sign-in domain", width: "minmax(140px,1fr)", render: (r) => <span className={r.domain ? "truncate" : "text-ink-3"}>{r.domain ?? "None"}</span> },
    { key: "plan", label: "Plan", width: "140px", headerFilter: planFilter, render: (r) => <Chip as="span" className="h-6 border-line bg-raised px-2 text-xs text-ink-2">{planLabel(r.plan)}</Chip> },
    { key: "status", label: "Status", width: "150px", headerFilter: statusFilter, render: (r) => <StatusChip color={companyStatusColor(r.status)} label={statusLabel(r.status)} /> },
    { key: "people", label: "People", width: "90px", numeric: true, render: (r) => new Intl.NumberFormat().format(r.people) },
    { key: "seats", label: "Seats", width: "120px", render: (r) => <span className={r.seatsLabel === "None" ? "text-ink-3" : "tabular-nums"}>{r.seatsLabel}</span> },
    {
      key: "modules",
      label: "Modules",
      width: "150px",
      // Gives way first when the card is narrow (the Filter panel open, a
      // 1024 window); column settings bring it back.
      hideBelow: 1000,
      render: (r) => (
        <span className="inline-flex min-w-0 items-center gap-1">
          {MODULES.filter((m) => r.modules.includes(m.appKey)).map((m) => (
            <Chip key={m.appKey} as="span" className="h-6 border-line bg-raised px-2 text-xs text-ink-2">{m.label}</Chip>
          ))}
        </span>
      ),
    },
    {
      key: "signed",
      label: "Signed up",
      width: "120px",
      align: "end",
      render: (r) => <span className="tabular-nums text-ink-2" title={formatDateTitle(r.createdAt, datePrefs)}>{formatDate(r.createdAt, datePrefs, "date")}</span>,
    },
  ];

  const columnChoice = choiceFromStored(COLUMN_KEYS, prefs.companies.columns, OFF_BY_DEFAULT);
  const noCompaniesAtAll = !!payload && payload.counts.all === 0 && activeCount === 0;

  const emptyRow = failed ? (
    <InlineRetry text="Could not load companies." onRetry={() => void load()} />
  ) : activeCount > 0 || params.view !== "all" ? (
    <span className="inline-flex items-center gap-1">
      No companies match these filters ·
      <button type="button" onClick={() => { clearAll(); if (params.view !== "all") setParams({ view: "all" }); }} className={TEXT_LINK}>Clear filters</button>
    </span>
  ) : (
    "No companies yet"
  );

  return (
    <>
      <OsPageHeader
        title="Companies"
        actions={<UpdatedMeta at={loadedAt} prefs={datePrefs} />}
        views={COMPANY_VIEWS.map((v) => (
          <ViewTab
            key={v}
            label={COMPANY_VIEW_LABEL[v]}
            active={params.view === v}
            href={`/admin/companies${companyListQuery({ ...params, view: v, page: 1 })}`}
            trailing={<ViewCount n={payload?.counts?.[v]} />}
          />
        ))}
        toolbar={{
          filter: { open: filterOpen, onToggle: () => setFilterOpen((o) => !o), count: activeCount },
          sort: {
            onClick: () => setSortOpen((o) => !o),
            label: COMPANY_SORTS.find((s) => s.key === params.sort)?.label,
            active: params.sort !== "newest",
          },
          left: (
            <span className="relative">
              <Picker
                open={sortOpen}
                onClose={() => setSortOpen(false)}
                ariaLabel="Sort companies"
                selected={params.sort}
                onSelect={(v) => { setSortOpen(false); setParams({ sort: v as CompanyListParams["sort"] }); }}
                sections={[{ options: COMPANY_SORTS.map((s) => ({ value: s.key, label: s.label })) }]}
                width={200}
              />
            </span>
          ),
          menu: [
            { label: "Refresh", icon: RefreshCw, onClick: () => void load() },
            { label: "Export CSV", icon: Download, onClick: exportCsv },
            { label: "About this page", icon: Info, onClick: () => setAboutOpen(true) },
          ],
        }}
      />

      <div className="os-chrome flex min-h-0 flex-1 gap-4 px-6 pb-6 pt-2">
        <FilterPanel open={filterOpen} onClose={() => setFilterOpen(false)} objects="companies" activeCount={activeCount} onClearAll={clearAll}>
          <FilterGroup label="Name or domain">
            <FilterRow
              label="Contains"
              checked={nameOn || params.search.length > 0}
              onCheckedChange={(on) => {
                setNameOn(on);
                if (!on) { setWritten(""); setSearchText(""); setParams({ search: "" }); }
              }}
            >
              <input
                autoFocus={nameOn && !params.search}
                value={searchText}
                onChange={(e) => setSearchText(e.target.value)}
                placeholder="acme, acme.com"
                aria-label="Name or domain"
                className={`${FIELD} h-8 text-sm`}
              />
            </FilterRow>
          </FilterGroup>
          <FilterGroup label="Plan">
            {PLAN_OPTIONS.map((o) => (
              <FilterRow key={o.value} label={o.label} checked={params.plans.includes(o.value)} onCheckedChange={(on) => setParams({ plans: toggleIn(params.plans, o.value, on) })} />
            ))}
          </FilterGroup>
          <FilterGroup label="Status">
            {STATUS_OPTIONS.map((o) => (
              <FilterRow key={o.value} label={o.label} checked={params.statuses.includes(o.value)} onCheckedChange={(on) => setParams({ statuses: toggleIn(params.statuses, o.value, on) })} />
            ))}
          </FilterGroup>
          <FilterGroup label="Subscription">
            {SUBSCRIPTION_FILTERS.map((s) => (
              <FilterRow key={s} label={SUBSCRIPTION_FILTER_LABEL[s]} checked={params.subscriptions.includes(s)} onCheckedChange={(on) => setParams({ subscriptions: toggleIn(params.subscriptions, s, on) })} />
            ))}
          </FilterGroup>
          <FilterGroup label="Modules">
            {MODULES.map((m) => (
              <FilterRow key={m.appKey} label={`${m.label} is on`} checked={params.modules.includes(m.appKey)} onCheckedChange={(on) => setParams({ modules: toggleIn(params.modules, m.appKey, on) })} />
            ))}
          </FilterGroup>
          <FilterGroup label="Owners">
            <FilterRow label="Has an Owner" checked={params.owners === "has"} onCheckedChange={(on) => setParams({ owners: on ? "has" : null })} />
            <FilterRow label="Has nobody" checked={params.owners === "none"} onCheckedChange={(on) => setParams({ owners: on ? "none" : null })} />
          </FilterGroup>
          <FilterGroup label="People">
            <FilterRow
              label="Number of people"
              checked={peopleOn || params.peopleMin !== null || params.peopleMax !== null}
              onCheckedChange={(on) => { setPeopleOn(on); if (!on) setParams({ peopleMin: null, peopleMax: null }); }}
            >
              <div className="flex items-center gap-2 text-sm text-ink-2">
                <NumberBox value={params.peopleMin} onChange={(n) => setParams({ peopleMin: n })} label="At least" />
                <span>to</span>
                <NumberBox value={params.peopleMax} onChange={(n) => setParams({ peopleMax: n })} label="At most" />
              </div>
            </FilterRow>
          </FilterGroup>
          <FilterGroup label="Signed up">
            <FilterRow
              label="Date range"
              checked={signedOn || params.signedFrom !== null || params.signedTo !== null}
              onCheckedChange={(on) => { setSignedOn(on); if (!on) setParams({ signedFrom: null, signedTo: null }); }}
            >
              <div className="flex flex-col gap-1.5">
                <span className="flex items-center gap-2 text-sm text-ink-2"><span className="w-9 shrink-0">From</span><DateField size="sm" value={params.signedFrom} onChange={(v) => setParams({ signedFrom: v })} placeholder="Any" ariaLabel="Signed up from" className="min-w-0 flex-1" /></span>
                <span className="flex items-center gap-2 text-sm text-ink-2"><span className="w-9 shrink-0">To</span><DateField size="sm" value={params.signedTo} onChange={(v) => setParams({ signedTo: v })} placeholder="Any" ariaLabel="Signed up to" className="min-w-0 flex-1" /></span>
              </div>
            </FilterRow>
          </FilterGroup>
        </FilterPanel>

        <div className="flex min-w-0 flex-1 flex-col gap-4">
          {noCompaniesAtAll && params.view === "all" ? (
            <OsEmptyView title="No companies yet" hint="A company appears here when somebody signs up for WorkwrK." />
          ) : (
            <TableCard<CompanyRow>
              ariaLabel="Companies"
              columns={columns}
              rows={failed && !payload ? [] : rows}
              rowKey={(r) => r.id}
              rowHref={(r) => `/admin/companies/${r.id}`}
              rowMenu={(r) => (
                <RowMenuTrigger open={menu?.row.id === r.id} onOpen={(ref) => setMenu({ row: r, anchor: ref })} label={`Actions for ${r.name}`} />
              )}
              empty={emptyRow}
              columnSettings
              columnChoice={columnChoice}
              onColumnChoiceChange={(next) => patchPrefs({ companies: { columns: storedFromChoice(COLUMN_KEYS, next, OFF_BY_DEFAULT) } })}
              footer={{
                total,
                noun: "records",
                from,
                to,
                onPrev: params.page > 1 ? () => setParams({ page: params.page - 1 }, { keepPage: true }) : undefined,
                onNext: to < total ? () => setParams({ page: params.page + 1 }, { keepPage: true }) : undefined,
                pageSize: params.limit,
                pageSizes: [40, 100],
                onPageSize: (n) => setParams({ limit: n }),
              }}
            />
          )}
          {failed && payload ? <InlineRetry text="Could not refresh companies." onRetry={() => void load()} /> : null}
        </div>
      </div>

      {menu ? (
        <MorePortal anchorRef={menu.anchor} width={220} open onClose={() => setMenu(null)} placement="below">
          <MenuList onClick={() => setMenu(null)}>
            <MenuItem icon={ExternalLink} label="Open" onClick={() => router.push(`/admin/companies/${menu.row.id}`)} />
            <MenuItem icon={Copy} label="Copy company ID" onClick={() => void copy(menu.row.id, "Company ID")} />
            <MenuItem icon={Copy} label="Copy slug" onClick={() => void copy(menu.row.slug, "Slug")} />
            <MenuItem icon={ScrollText} label="Staff activity" onClick={() => router.push(`/admin/audit?company=${encodeURIComponent(menu.row.id)}`)} />
          </MenuList>
        </MorePortal>
      ) : null}

      <AboutDialog open={aboutOpen} onClose={() => setAboutOpen(false)} title="Companies">
        Every company that has a WorkwrK workspace. To find one by name, press ⌘K or open Filter and type into Name or domain.
      </AboutDialog>
    </>
  );
}

/** A small whole-number box for the People range; empty means no bound. */
function NumberBox({ value, onChange, label }: { value: number | null; onChange: (n: number | null) => void; label: string }) {
  const [text, setText] = useState(value == null ? "" : String(value));
  const [seen, setSeen] = useState(value);
  if (seen !== value) {
    setSeen(value);
    setText(value == null ? "" : String(value));
  }
  const commit = () => {
    const t = text.trim();
    if (!t) return onChange(null);
    const n = Number.parseInt(t, 10);
    if (Number.isFinite(n) && n >= 0) onChange(n);
    else setText(value == null ? "" : String(value));
  };
  return (
    <input
      inputMode="numeric"
      value={text}
      onChange={(e) => setText(e.target.value.replace(/[^\d]/g, ""))}
      onBlur={commit}
      onKeyDown={(e) => { if (e.key === "Enter") commit(); }}
      placeholder="Any"
      aria-label={label}
      className={`${FIELD} h-8 w-20 text-sm tabular-nums`}
    />
  );
}
