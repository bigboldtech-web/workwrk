"use client";

// Staff activity (spec-admin-backoffice 2.7, a new page): every change
// WorkwrK staff made from this console, who made it and for which company,
// plus the sampled "Console access refused" probes. Read only by nature:
// rows are never edited or deleted, and no route can do either.
//
// The URL carries the view and the filters (?view=, ?who=, ?company=,
// ?action=, ?from=, ?to=, ?sort=), so the company page's "See all" and a
// pasted link restore the list exactly. Paging is by cursor, so a row
// written while someone pages never shifts the page under them.

import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ChevronDown, ClipboardCopy, Download, Eye, Info, RefreshCw } from "lucide-react";
import { OsPageHeader } from "@/components/layout/os/page-header";
import { OsEmptyView } from "@/components/layout/os/empty-view";
import { MorePortal } from "@/components/layout/os/more-portal";
import { useOsToast } from "@/components/layout/os/toast";
import { ViewTab } from "@/components/ui/view-tabs";
import { FilterGroup, FilterPanel, FilterRow } from "@/components/ui/filter-panel";
import { Picker } from "@/components/ui/picker";
import { MenuItem, MenuList } from "@/components/ui/menu";
import { TableCard, type TableColumn } from "@/components/ui/table-card";
import { DateField } from "@/components/ui/date-field";
import { apiFetch } from "@/lib/api-fetch";
import { formatDate, formatDateTitle } from "@/lib/format/date";
import {
  ACTION_LABEL,
  ACTIVITY_VIEWS,
  ACTIVITY_VIEW_LABEL,
  activeActivityFilterCount,
  detailRows,
  parseActivityParams,
  type ActivityParams,
} from "@/lib/admin/staff-activity";
import { STAFF_ACTIONS, type StaffActionKey } from "@/lib/staff-audit-helpers";
import { choiceFromStored, storedFromChoice } from "@/lib/admin/console-columns";
import { useConsole } from "../../console-context";
import { AboutDialog, BTN_GHOST, ConsoleModal, FIELD, InlineRetry, RowMenuTrigger, TEXT_LINK, UpdatedMeta, downloadHref, useCopy, rememberCompanyNames, useListSearchKey, useStaleRefetch } from "../../console-ui";

interface ActivityRow {
  id: string;
  createdAt: string;
  action: string;
  actionLabel: string;
  who: string;
  email: string;
  summary: string;
  company: { id: string; name: string } | null;
  targetLabel: string | null;
  before: Record<string, unknown> | null;
  after: Record<string, unknown> | null;
  reason: string | null;
  ip: string | null;
  hits: number;
}

interface Payload {
  rows: ActivityRow[];
  total: number;
  nextCursor: string | null;
  actors: { email: string; name: string | null }[];
  company: { id: string; name: string } | null;
}

const COLUMN_KEYS = ["when", "who", "email", "what", "company", "source"] as const;
const OFF_BY_DEFAULT = ["email", "source"];
const SORTS = [
  { key: "newest", label: "Newest first" },
  { key: "oldest", label: "Oldest first" },
] as const;

function activityQuery(p: Partial<ActivityParams>): string {
  const q = new URLSearchParams();
  if (p.view && p.view !== "all") q.set("view", p.view);
  if (p.who) q.set("who", p.who);
  if (p.company) q.set("company", p.company);
  if (p.action) q.set("action", p.action);
  if (p.from) q.set("from", p.from);
  if (p.to) q.set("to", p.to);
  if (p.sort && p.sort !== "newest") q.set("sort", p.sort);
  const s = q.toString();
  return s ? `?${s}` : "";
}

export default function StaffActivityPage() {
  const router = useRouter();
  const { spKey } = useListSearchKey("/admin/audit");
  const params = useMemo(() => parseActivityParams(new URLSearchParams(spKey)), [spKey]);
  const { datePrefs, prefs, patchPrefs } = useConsole();
  const { toast } = useOsToast();
  const copy = useCopy(toast);
  const query = activityQuery(params);

  const [payload, setPayload] = useState<Payload | null>(null);
  const [failed, setFailed] = useState(false);
  const [loadedAt, setLoadedAt] = useState<number | null>(null);
  // The cursors of the pages before this one, for the footer's back arrow.
  const [cursors, setCursors] = useState<(string | null)[]>([null]);
  const [pageIndex, setPageIndex] = useState(0);
  const [filterOpen, setFilterOpen] = useState(() => activeActivityFilterCount(params) > 0);
  const [sortOpen, setSortOpen] = useState(false);
  const [aboutOpen, setAboutOpen] = useState(false);
  const [menu, setMenu] = useState<{ row: ActivityRow; anchor: React.RefObject<HTMLElement | null> } | null>(null);
  const [details, setDetails] = useState<ActivityRow | null>(null);
  const seq = useRef(0);
  const limit = 40;

  // A new filter starts from the first page.
  const [seenQuery, setSeenQuery] = useState(query);
  if (seenQuery !== query) {
    setSeenQuery(query);
    setCursors([null]);
    setPageIndex(0);
  }
  const cursor = cursors[pageIndex] ?? null;

  const load = useCallback(async () => {
    const mine = ++seq.current;
    const q = new URLSearchParams(query.replace(/^\?/, ""));
    q.set("limit", String(limit));
    if (cursor) q.set("cursor", cursor);
    const r = await apiFetch<Payload>(`/api/admin/staff-actions?${q.toString()}`);
    if (mine !== seq.current) return;
    if (r.ok) {
      setFailed(false);
      rememberCompanyNames([...r.data.rows.map((x) => x.company), r.data.company]);
      setPayload(r.data);
      setLoadedAt(Date.now());
    } else if (r.status !== 401) setFailed(true);
  }, [query, cursor]);
  useEffect(() => { const t = setTimeout(() => void load(), 0); return () => clearTimeout(t); }, [load]);
  useStaleRefetch(() => void load(), loadedAt);

  const setParams = useCallback(
    (patch: Partial<ActivityParams>) => router.replace(`/admin/audit${activityQuery({ ...params, ...patch })}`, { scroll: false }),
    [params, router],
  );

  const [whoOpen, setWhoOpen] = useState(false);
  const [companyOpen, setCompanyOpen] = useState(false);
  const [actionOpen, setActionOpen] = useState(false);
  const [whenOn, setWhenOn] = useState(!!(params.from || params.to));
  const [companyQuery, setCompanyQuery] = useState("");
  const [companyOptions, setCompanyOptions] = useState<{ id: string; name: string }[]>([]);
  useEffect(() => {
    if (!companyOpen) return;
    const t = window.setTimeout(async () => {
      if (companyQuery.trim().length < 2) return setCompanyOptions([]);
      const r = await apiFetch<{ companies: { id: string; name: string }[] }>(`/api/admin/search?types=companies&limit=8&q=${encodeURIComponent(companyQuery.trim())}`);
      setCompanyOptions(r.ok ? r.data.companies : []);
    }, 200);
    return () => window.clearTimeout(t);
  }, [companyOpen, companyQuery]);

  const activeCount = activeActivityFilterCount(params);
  /** Every filter off, plus `extra` (the empty row's view reset) in the SAME navigation. */
  const clearFilters = (extra: Partial<ActivityParams> = {}) => {
    setWhenOn(false);
    setParams({ who: null, company: null, action: null, from: null, to: null, ...extra });
  };
  const clearAll = () => clearFilters();
  const exportCsv = () => {
    const q = new URLSearchParams(query.replace(/^\?/, ""));
    q.set("format", "csv");
    downloadHref(`/api/admin/staff-actions?${q.toString()}`);
  };

  const rows = payload?.rows ?? null;
  const total = payload?.total ?? 0;
  const from = total === 0 ? 0 : pageIndex * limit + 1;
  const to = Math.min(total, pageIndex * limit + (rows?.length ?? 0));

  const detailsText = (r: ActivityRow) =>
    [
      r.summary,
      `When: ${new Date(r.createdAt).toISOString()}`,
      `Who: ${r.who} (${r.email})`,
      r.company ? `Company: ${r.company.name} (${r.company.id})` : null,
      ...detailRows(r.before, r.after).map((d) => `${d.label}: ${d.before} to ${d.after}`),
      r.reason ? `Reason: ${r.reason}` : null,
      r.ip ? `IP: ${r.ip}` : null,
      r.hits > 1 ? `Hits: ${r.hits}` : null,
    ]
      .filter(Boolean)
      .join("\n");

  const columns: TableColumn<ActivityRow>[] = [
    {
      key: "when",
      label: "When",
      width: "160px",
      align: "end",
      render: (r) => <span className="tabular-nums text-ink-2" title={formatDateTitle(r.createdAt, datePrefs)}>{formatDate(r.createdAt, datePrefs, "datetime")}</span>,
    },
    { key: "who", label: "Who", title: true, width: "minmax(150px,1fr)", render: (r) => <span className={r.who === r.email ? "truncate font-normal" : "truncate"}>{r.who}</span> },
    // Email and Source give way first on a narrow card; both are in See details.
    { key: "email", label: "Email", width: "minmax(180px,1fr)", hideBelow: 1000, render: (r) => <span className="truncate text-ink-2">{r.email}</span> },
    { key: "what", label: "What", width: "minmax(200px,2.4fr)", render: (r) => <span className="truncate" title={r.summary}>{r.summary}</span> },
    {
      key: "company",
      label: "Company",
      width: "minmax(150px,1fr)",
      render: (r) =>
        r.company ? (
          <Link href={`/admin/companies/${r.company.id}`} onClick={(e) => e.stopPropagation()} className="block min-w-0 truncate text-ink hover:underline">{r.company.name}</Link>
        ) : r.action.startsWith("admin.staff.") ? (
          // A change to the staff list is about Staff, not a company (spec 2.4 entry points).
          <Link href="/admin/staff" onClick={(e) => e.stopPropagation()} className="block min-w-0 truncate text-ink hover:underline">Staff list</Link>
        ) : (
          <span className="text-ink-3">None</span>
        ),
    },
    { key: "source", label: "Source", width: "110px", hideBelow: 1100, render: () => <span className="text-ink-2">Console</span> },
  ];
  const columnChoice = choiceFromStored(COLUMN_KEYS, prefs.audit.columns, OFF_BY_DEFAULT);
  const nothingYet = !!payload && payload.total === 0 && activeCount === 0 && params.view === "all";
  const whoLabel = params.who ? payload?.actors.find((a) => a.email === params.who)?.name ?? params.who : null;

  return (
    <>
      <OsPageHeader
        title="Staff activity"
        actions={<UpdatedMeta at={loadedAt} prefs={datePrefs} />}
        views={ACTIVITY_VIEWS.map((v) => (
          <ViewTab key={v} label={ACTIVITY_VIEW_LABEL[v]} active={params.view === v} href={`/admin/audit${activityQuery({ ...params, view: v })}`} />
        ))}
        toolbar={{
          filter: { open: filterOpen, onToggle: () => setFilterOpen((o) => !o), count: activeCount },
          sort: { onClick: () => setSortOpen((o) => !o), label: SORTS.find((s) => s.key === params.sort)?.label, active: params.sort !== "newest" },
          left: (
            <span className="relative">
              <Picker
                open={sortOpen}
                onClose={() => setSortOpen(false)}
                ariaLabel="Sort activity"
                selected={params.sort}
                onSelect={(v) => { setSortOpen(false); setParams({ sort: v === "oldest" ? "oldest" : "newest" }); }}
                sections={[{ options: SORTS.map((s) => ({ value: s.key, label: s.label })) }]}
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
        <FilterPanel open={filterOpen} onClose={() => setFilterOpen(false)} objects="activity" activeCount={activeCount} onClearAll={clearAll}>
          <FilterGroup label="Who">
            <FilterRow label="A staff member" checked={!!params.who} onCheckedChange={(on) => { if (!on) setParams({ who: null }); else setWhoOpen(true); }}>
              <PickerButton label={whoLabel ?? "Choose who"} empty={!params.who} onClick={() => setWhoOpen((o) => !o)}>
                <Picker
                  open={whoOpen}
                  onClose={() => setWhoOpen(false)}
                  ariaLabel="Who"
                  alwaysSearch
                  searchPlaceholder="Find a name or email"
                  selected={params.who}
                  onSelect={(v) => { setWhoOpen(false); setParams({ who: v }); }}
                  sections={[{ options: (payload?.actors ?? []).map((a) => ({ value: a.email, label: a.name ?? a.email, description: a.name ? a.email : undefined, keywords: a.email })) }]}
                  width={260}
                />
              </PickerButton>
            </FilterRow>
          </FilterGroup>
          <FilterGroup label="Company">
            <FilterRow label="A company" checked={!!params.company} onCheckedChange={(on) => { if (!on) setParams({ company: null }); else setCompanyOpen(true); }}>
              <PickerButton label={payload?.company?.name ?? (params.company ? "A company" : "Choose a company")} empty={!params.company} onClick={() => setCompanyOpen((o) => !o)}>
                <Picker
                  open={companyOpen}
                  onClose={() => setCompanyOpen(false)}
                  ariaLabel="Company"
                  alwaysSearch
                  searchPlaceholder="Type a company name"
                  onSearchChange={setCompanyQuery}
                  emptyLabel={companyQuery.trim().length < 2 ? "Type two letters of the name" : "No companies match"}
                  selected={params.company}
                  onSelect={(v) => { setCompanyOpen(false); setParams({ company: v }); }}
                  sections={[{ options: companyOptions.map((c) => ({ value: c.id, label: c.name })) }]}
                  width={260}
                />
              </PickerButton>
            </FilterRow>
          </FilterGroup>
          <FilterGroup label="Action">
            <FilterRow label="One kind of change" checked={!!params.action} onCheckedChange={(on) => { if (!on) setParams({ action: null }); else setActionOpen(true); }}>
              <PickerButton label={params.action ? ACTION_LABEL[params.action] : "Choose an action"} empty={!params.action} onClick={() => setActionOpen((o) => !o)}>
                <Picker
                  open={actionOpen}
                  onClose={() => setActionOpen(false)}
                  ariaLabel="Action"
                  selected={params.action}
                  onSelect={(v) => { setActionOpen(false); setParams({ action: v as StaffActionKey }); }}
                  sections={[{ options: STAFF_ACTIONS.map((k) => ({ value: k, label: ACTION_LABEL[k] })) }]}
                  width={280}
                />
              </PickerButton>
            </FilterRow>
          </FilterGroup>
          <FilterGroup label="When">
            <FilterRow label="Date range" checked={whenOn || !!(params.from || params.to)} onCheckedChange={(on) => { setWhenOn(on); if (!on) setParams({ from: null, to: null }); }}>
              <div className="flex flex-col gap-1.5">
                <span className="flex items-center gap-2 text-sm text-ink-2"><span className="w-9 shrink-0">From</span><DateField size="sm" value={params.from} onChange={(v) => setParams({ from: v })} placeholder="Any" ariaLabel="From" className="min-w-0 flex-1" /></span>
                <span className="flex items-center gap-2 text-sm text-ink-2"><span className="w-9 shrink-0">To</span><DateField size="sm" value={params.to} onChange={(v) => setParams({ to: v })} placeholder="Any" ariaLabel="To" className="min-w-0 flex-1" /></span>
              </div>
            </FilterRow>
          </FilterGroup>
        </FilterPanel>

        <div className="flex min-w-0 flex-1 flex-col gap-3">
          {nothingYet ? (
            <OsEmptyView title="No staff changes yet" />
          ) : (
            <TableCard<ActivityRow>
              ariaLabel="Staff activity"
              columns={columns}
              rows={failed && !payload ? [] : rows}
              rowKey={(r) => r.id}
              onRowClick={(r) => setDetails(r)}
              rowMenuAlwaysVisible
              rowMenu={(r) => <RowMenuTrigger open={menu?.row.id === r.id} onOpen={(ref) => setMenu({ row: r, anchor: ref })} label="Row actions" />}
              empty={
                failed ? (
                  <InlineRetry text="Could not load activity." onRetry={() => void load()} />
                ) : (
                  <span className="inline-flex items-center gap-1">
                    No activity matches ·
                    <button type="button" onClick={() => clearFilters(params.view !== "all" ? { view: "all" } : {})} className={TEXT_LINK}>Clear filters</button>
                  </span>
                )
              }
              columnSettings
              columnChoice={columnChoice}
              onColumnChoiceChange={(next) => patchPrefs({ audit: { columns: storedFromChoice(COLUMN_KEYS, next, OFF_BY_DEFAULT) } })}
              footer={{
                total,
                noun: "records",
                from,
                to,
                onPrev: pageIndex > 0 ? () => setPageIndex((i) => i - 1) : undefined,
                onNext: payload?.nextCursor
                  ? () => {
                      const next = payload.nextCursor;
                      setCursors((c) => [...c.slice(0, pageIndex + 1), next]);
                      setPageIndex((i) => i + 1);
                    }
                  : undefined,
              }}
            />
          )}
          {failed && payload ? <InlineRetry text="Could not refresh activity." onRetry={() => void load()} /> : null}
          <p className="text-sm text-ink-2">Staff activity is kept for ever.</p>
        </div>
      </div>

      {menu ? (
        <MorePortal anchorRef={menu.anchor} width={200} open onClose={() => setMenu(null)} placement="below">
          <MenuList onClick={() => setMenu(null)}>
            <MenuItem icon={Eye} label="See details" onClick={() => setDetails(menu.row)} />
            <MenuItem icon={ClipboardCopy} label="Copy details" onClick={() => void copy(detailsText(menu.row), "Details")} />
          </MenuList>
        </MorePortal>
      ) : null}

      <DetailsDialog row={details} onClose={() => setDetails(null)} datePrefs={datePrefs} />

      <AboutDialog open={aboutOpen} onClose={() => setAboutOpen(false)} title="Staff activity">
        Every change WorkwrK staff made, who made it and for which customer. A change to a customer&apos;s workspace also
        belongs in that customer&apos;s own audit log at Settings › Audit log, shown there as WorkwrK Support with no
        individual&apos;s name. Until that log can name a non-person actor, those customer rows are not written yet;
        each one is written, dated when the change was made, the first time it can be. Nothing here can be edited or
        deleted.
      </AboutDialog>
    </>
  );
}

function PickerButton({ label, empty, onClick, children }: { label: string; empty: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <span className="relative block">
      <button type="button" onClick={onClick} className={`${FIELD} flex h-8 items-center gap-2 text-start text-sm`}>
        <span className={`min-w-0 flex-1 truncate ${empty ? "text-ink-3" : ""}`}>{label}</span>
        <ChevronDown className="h-4 w-4 shrink-0 text-ink-3" strokeWidth={1.5} aria-hidden />
      </button>
      {children}
    </span>
  );
}

function DetailsDialog({ row, onClose, datePrefs }: { row: ActivityRow | null; onClose: () => void; datePrefs: ReturnType<typeof useConsole>["datePrefs"] }) {
  const all = row ? detailRows(row.before, row.after) : [];
  const rowsList = all.filter((d) => d.changed);
  const context = all.filter((d) => !d.changed);
  return (
    <ConsoleModal
      open={!!row}
      onClose={onClose}
      width={560}
      title={row?.summary ?? ""}
      footer={<button type="button" onClick={onClose} className={BTN_GHOST}>Close</button>}
    >
      {row ? (
        <>
          <p className="text-sm text-ink-2">{row.actionLabel}</p>
          {rowsList.length > 0 ? (
            <div className="overflow-hidden rounded-md border border-line">
              <div className="grid grid-cols-[110px_1fr_1fr] gap-2 border-b border-line bg-[var(--os-table-head-bg)] px-3 py-2 text-sm font-medium text-ink-2">
                <span />
                <span>Before</span>
                <span>After</span>
              </div>
              {rowsList.map((d) => (
                <div key={d.key} className="grid grid-cols-[110px_1fr_1fr] gap-2 border-b border-line-soft px-3 py-2 text-base last:border-b-0">
                  <span className="text-ink-2">{d.label}</span>
                  <span className="min-w-0 break-words text-ink">{d.before}</span>
                  <span className="min-w-0 break-words text-ink">{d.after}</span>
                </div>
              ))}
            </div>
          ) : null}
          {context.length > 0 ? (
            <div className="flex flex-col gap-1">
              <p className="text-xs font-medium text-ink-2">Unchanged</p>
              <dl className="grid grid-cols-[max-content_1fr] gap-x-4 gap-y-1 text-sm text-ink-2">
                {context.map((d) => (
                  <Fragment key={d.key}>
                    <dt>{d.label}</dt>
                    <dd className="min-w-0 break-words text-ink">{d.after}</dd>
                  </Fragment>
                ))}
              </dl>
            </div>
          ) : null}
          <dl className="grid grid-cols-[max-content_1fr] gap-x-4 gap-y-1 text-sm text-ink-2">
            <dt>Who</dt>
            <dd className="text-ink">{row.who === row.email ? row.email : `${row.who} (${row.email})`}</dd>
            <dt>When</dt>
            <dd className="text-ink" title={formatDateTitle(row.createdAt, datePrefs)}>{formatDate(row.createdAt, datePrefs, "datetime")}</dd>
            {row.company ? (
              <>
                <dt>Company</dt>
                <dd><Link href={`/admin/companies/${row.company.id}`} className={TEXT_LINK} onClick={onClose}>{row.company.name}</Link></dd>
              </>
            ) : null}
            <dt>IP</dt>
            <dd className="text-ink">{row.ip ?? "Not recorded"}</dd>
            {row.reason ? (
              <>
                <dt>Reason</dt>
                <dd className="text-ink">{row.reason}</dd>
              </>
            ) : null}
            {row.action === "admin.access.denied" ? (
              <>
                <dt>Attempts</dt>
                <dd className="text-ink">{row.hits} in the ten minutes after this row was written</dd>
              </>
            ) : null}
          </dl>
        </>
      ) : null}
    </ConsoleModal>
  );
}
