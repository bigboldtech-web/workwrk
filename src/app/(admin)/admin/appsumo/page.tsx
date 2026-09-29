"use client";

// AppSumo codes (spec-admin-backoffice 2.6): the lifetime-deal codes, on the
// design system's one page pattern. The page opens on the codes; importing
// is the one primary, "Import codes", a 720 modal with the three tier
// presets and the per-line override (decided: the presets stay as code).
// Marking a code refunded is bookkeeping only (decided): the company keeps
// its plan, and the toast links to its page so the job is one move away.
//
// Where the old controls went: the "Bulk import" tab is the Import codes
// modal; the four filter buttons are the views row, with SERVER counts (the
// old tiles counted only the rows on the page and said "On the page"); the
// ?code= chip is the Filter panel's first field, shown filled and counted;
// the row's Refund button is the row menu's "Mark refunded"; Refresh is
// "..." > Refresh.

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { ChevronDown, Copy, Download, Info, KeyRound, ReceiptText, RefreshCw, Upload } from "lucide-react";
import { OsPageHeader } from "@/components/layout/os/page-header";
import { OsEmptyView } from "@/components/layout/os/empty-view";
import { MorePortal } from "@/components/layout/os/more-portal";
import { useOsToast } from "@/components/layout/os/toast";
import { ViewTab } from "@/components/ui/view-tabs";
import { FilterGroup, FilterPanel, FilterRow } from "@/components/ui/filter-panel";
import { Picker } from "@/components/ui/picker";
import { MenuItem, MenuList, MenuSeparator } from "@/components/ui/menu";
import { TableCard, type TableColumn } from "@/components/ui/table-card";
import { StatusChip } from "@/components/ui/chip";
import { DateField } from "@/components/ui/date-field";
import { useConfirm } from "@/components/ui/dialog-provider";
import { apiFetch } from "@/lib/api-fetch";
import { formatDate, formatDateTitle } from "@/lib/format/date";
import {
  CODE_SORTS,
  CODE_TIERS,
  CODE_VIEWS,
  CODE_VIEW_LABEL,
  TIER_PRESETS,
  activeCodeFilterCount,
  codeGives,
  codesQuery,
  parseCodeListParams,
  parseImport,
  type CodeListParams,
  type CodeView,
} from "@/lib/admin/codes-list";
import { importWords } from "@/lib/admin/staff-activity";
import type { CodeStatus } from "@/lib/admin/search";
import { PLAN_OPTIONS, codeStatusColor, codeStatusLabel, planLabel } from "@/lib/admin/console-labels";
import { useConsole } from "../../console-context";
import { TypedConfirmDialog } from "../../typed-confirm-dialog";
import {
  AboutDialog,
  BTN_GHOST,
  BTN_PRIMARY,
  ConsoleModal,
  FIELD,
  InlineRetry,
  LABEL,
  PendingDots,
  RowMenuTrigger,
  TEXT_LINK,
  UpdatedMeta,
  ViewCount,
  downloadHref,
  useCopy,
  rememberCompanyNames,
  useListSearchKey,
  useStaleRefetch,
} from "../../console-ui";

interface CodeRow {
  id: string;
  code: string;
  tier: number;
  plan: string;
  seats: number;
  redeemedAt: string | null;
  refundedAt: string | null;
  createdAt: string;
  status: CodeStatus;
  gives: string;
  company: { id: string; name: string } | null;
}

interface Payload {
  codes: CodeRow[];
  total: number;
  page: number;
  limit: number;
  counts: Record<CodeView, number>;
  redeemedBy: { id: string; name: string } | null;
}

export default function AppsumoCodesPage() {
  const router = useRouter();
  const { spKey, onList } = useListSearchKey("/admin/appsumo");
  const params = useMemo(() => parseCodeListParams(new URLSearchParams(spKey)), [spKey]);
  const { datePrefs } = useConsole();
  const { toast } = useOsToast();
  const copy = useCopy(toast);

  const [payload, setPayload] = useState<Payload | null>(null);
  const [failed, setFailed] = useState(false);
  const [loadedAt, setLoadedAt] = useState<number | null>(null);
  const [filterOpen, setFilterOpen] = useState(() => activeCodeFilterCount(params) > 0);
  const [sortOpen, setSortOpen] = useState(false);
  const [aboutOpen, setAboutOpen] = useState(false);
  const [importOpen, setImportOpen] = useState(false);
  const [menu, setMenu] = useState<{ row: CodeRow; anchor: React.RefObject<HTMLElement | null> } | null>(null);
  const [refunding, setRefunding] = useState<CodeRow | null>(null);
  const [refundBusy, setRefundBusy] = useState(false);
  // refundBusy is state, so two clicks in one tick both saw it false and sent
  // two refunds. The server claims the code once either way; this keeps the
  // second request (and its duplicate toast) from leaving the browser at all.
  const refundInFlight = useRef(false);
  const seq = useRef(0);
  const query = codesQuery(params);

  const load = useCallback(async () => {
    const mine = ++seq.current;
    const r = await apiFetch<Payload>(`/api/admin/appsumo${query}`);
    if (mine !== seq.current) return;
    if (r.ok) {
      setFailed(false);
      rememberCompanyNames([...r.data.codes.map((c) => c.company), r.data.redeemedBy]);
      setPayload(r.data);
      setLoadedAt(Date.now());
    } else if (r.status !== 401) setFailed(true);
  }, [query]);
  useEffect(() => { const t = setTimeout(() => void load(), 0); return () => clearTimeout(t); }, [load]);
  useStaleRefetch(() => void load(), loadedAt);

  const setParams = useCallback(
    (patch: Partial<CodeListParams>, opts: { keepPage?: boolean } = {}) => {
      const next = { ...params, ...patch, ...(opts.keepPage ? {} : { page: 1 }) };
      router.replace(`/admin/appsumo${codesQuery(next)}`, { scroll: false });
    },
    [params, router],
  );

  // A ?code= arriving from outside (the company page's "See the code",
  // Search) opens the panel, so the one-row state has a visible reason.
  const [seenCode, setSeenCode] = useState(params.code);
  if (seenCode !== params.code) {
    setSeenCode(params.code);
    if (params.code && !filterOpen) setFilterOpen(true);
  }

  const [codeText, setCodeText] = useState(params.code);
  // What this page last wrote to ?code=: its echo is not a new query.
  const [written, setWritten] = useState(params.code);
  const [seenCodeParam, setSeenCodeParam] = useState(params.code);
  if (seenCodeParam !== params.code) {
    setSeenCodeParam(params.code);
    if (params.code !== written) {
      setWritten(params.code);
      setCodeText(params.code);
    }
  }
  useEffect(() => {
    const v = codeText.trim();
    if (v === written) return;
    const t = window.setTimeout(() => {
      setWritten(v);
      setParams({ code: v });
    }, 250);
    return () => window.clearTimeout(t);
  }, [codeText, written, setParams]);

  const [codeOn, setCodeOn] = useState(params.code.length > 0);
  const [importedOn, setImportedOn] = useState(!!(params.importedFrom || params.importedTo));
  const [redeemedOn, setRedeemedOn] = useState(!!(params.redeemedFrom || params.redeemedTo));
  const [byOn, setByOn] = useState(!!params.redeemedBy);
  const [byPicker, setByPicker] = useState(false);
  const [byQuery, setByQuery] = useState("");
  const [byOptions, setByOptions] = useState<{ id: string; name: string }[] | null>(null);
  useEffect(() => {
    if (!byPicker) return;
    const t = window.setTimeout(async () => {
      if (byQuery.trim().length < 2) {
        setByOptions([]);
        return;
      }
      const r = await apiFetch<{ companies: { id: string; name: string }[] }>(
        `/api/admin/search?types=companies&limit=8&q=${encodeURIComponent(byQuery.trim())}`,
      );
      setByOptions(r.ok ? r.data.companies : []);
    }, 200);
    return () => window.clearTimeout(t);
  }, [byPicker, byQuery]);

  const activeCount = activeCodeFilterCount(params);
  /** Every filter off, plus `extra` (the empty row's view reset) in the SAME navigation. */
  const clearFilters = (extra: Partial<CodeListParams> = {}) => {
    setWritten("");
    setCodeText("");
    setCodeOn(false);
    setImportedOn(false);
    setRedeemedOn(false);
    setByOn(false);
    setParams({ code: "", tiers: [], plans: [], importedFrom: null, importedTo: null, redeemedFrom: null, redeemedTo: null, redeemedBy: null, ...extra });
  };
  const clearAll = () => clearFilters();
  const toggleIn = <T,>(list: T[], v: T, on: boolean): T[] => (on ? (list.includes(v) ? list : [...list, v]) : list.filter((x) => x !== v));

  const exportCsv = () => {
    const q = new URLSearchParams(query.replace(/^\?/, ""));
    q.delete("page");
    q.set("format", "csv");
    downloadHref(`/api/admin/appsumo?${q.toString()}`);
  };

  const refund = async (row: CodeRow) => {
    if (refundInFlight.current) return;
    refundInFlight.current = true;
    setRefundBusy(true);
    const r = await apiFetch<{ company: { id: string; name: string } | null }>("/api/admin/appsumo", {
      method: "PATCH",
      json: { code: row.code, refunded: true, confirm: row.code },
    });
    refundInFlight.current = false;
    setRefundBusy(false);
    if (!r.ok) {
      if (r.status !== 401) toast(r.error || "Couldn't mark it refunded", { tone: "danger" });
      return;
    }
    setRefunding(null);
    const company = r.data.company ?? row.company;
    toast(`Marked ${row.code} refunded`, {
      description: company ? `${company.name} keeps their plan until you change it.` : undefined,
      action: company ? { label: `Open ${company.name}`, onClick: () => router.push(`/admin/companies/${company.id}`) } : undefined,
    });
    void load();
  };

  const rows = payload?.codes ?? null;
  const total = payload?.total ?? 0;
  const lastPage = Math.max(1, Math.ceil(total / params.limit));
  // The range only counts rows that are on screen: a page past the end (a
  // bookmarked ?page=99) used to read "9801 to 10".
  const shown = rows?.length ?? 0;
  const from = shown === 0 ? 0 : (params.page - 1) * params.limit + 1;
  const to = shown === 0 ? 0 : Math.min(total, (params.page - 1) * params.limit + shown);

  // A page past the end (an old link, or codes that moved to another view
  // under a later page) jumps to the last page that has rows, the same as
  // Companies. Only on an answer for this very page and size.
  useEffect(() => {
    if (!onList || !payload || payload.codes.length > 0 || payload.total === 0) return;
    if (payload.page !== params.page || payload.limit !== params.limit) return;
    const last = Math.max(1, Math.ceil(payload.total / payload.limit));
    if (params.page > last) setParams({ page: last }, { keepPage: true });
  }, [onList, payload, params.page, params.limit, setParams]);

  const columns: TableColumn<CodeRow>[] = [
    {
      key: "code",
      label: "Code",
      title: true,
      width: "minmax(180px,1.2fr)",
      render: (r) => (
        <span className="inline-flex min-w-0 items-center gap-2 font-normal">
          <KeyRound className="h-4 w-4 shrink-0 text-ink-2" strokeWidth={1.5} aria-hidden />
          <span className="truncate font-mono text-base">{r.code}</span>
        </span>
      ),
    },
    // Never dropped: it is what a staff member arriving from a company page
    // or Search came to read, and this table has no column settings to bring
    // a dropped column back. A card narrower than every column scrolls
    // sideways inside itself instead.
    { key: "gives", label: "What it gives", width: "minmax(180px,1.2fr)", render: (r) => <span className="truncate">{r.gives}</span> },
    { key: "status", label: "Status", width: "130px", render: (r) => <StatusChip color={codeStatusColor(r.status)} label={codeStatusLabel(r.status)} /> },
    {
      key: "company",
      label: "Redeemed by",
      width: "minmax(160px,1fr)",
      render: (r) =>
        r.company ? (
          <Link href={`/admin/companies/${r.company.id}`} className="block min-w-0 truncate text-ink hover:underline">{r.company.name}</Link>
        ) : (
          // The canon's empty word (spec 2.6). A redeemed code whose company
          // was deleted since says so: "None" would read as never redeemed.
          <span className="text-ink-3">{r.redeemedAt ? "Company deleted" : "None"}</span>
        ),
    },
    {
      key: "redeemed",
      label: "Redeemed",
      width: "120px",
      align: "end",
      render: (r) =>
        r.redeemedAt ? (
          <span className="tabular-nums text-ink-2" title={formatDateTitle(r.redeemedAt, datePrefs)}>{formatDate(r.redeemedAt, datePrefs, "date")}</span>
        ) : (
          <span className="text-ink-3">None</span>
        ),
    },
  ];

  const noCodesAtAll = !!payload && payload.counts.all === 0 && activeCount === 0;
  const emptyRow = failed ? (
    <InlineRetry text="Could not load codes." onRetry={() => void load()} />
  ) : (
    <span className="inline-flex items-center gap-1">
      No codes match ·
      <button type="button" onClick={() => clearFilters(params.view !== "all" ? { view: "all" } : {})} className={TEXT_LINK}>Clear filters</button>
    </span>
  );

  return (
    <>
      <OsPageHeader
        title="AppSumo codes"
        actions={<UpdatedMeta at={loadedAt} prefs={datePrefs} failed={failed && !!payload} />}
        views={CODE_VIEWS.map((v) => (
          <ViewTab key={v} label={CODE_VIEW_LABEL[v]} active={params.view === v} href={`/admin/appsumo${codesQuery({ ...params, view: v, page: 1 })}`} trailing={<ViewCount n={payload?.counts?.[v]} />} />
        ))}
        toolbar={{
          filter: { open: filterOpen, onToggle: () => setFilterOpen((o) => !o), count: activeCount },
          sort: { onClick: () => setSortOpen((o) => !o), label: CODE_SORTS.find((s) => s.key === params.sort)?.label, active: params.sort !== "newest" },
          left: (
            <span className="relative">
              <Picker
                open={sortOpen}
                onClose={() => setSortOpen(false)}
                ariaLabel="Sort codes"
                selected={params.sort}
                onSelect={(v) => { setSortOpen(false); setParams({ sort: v as CodeListParams["sort"] }); }}
                sections={[{ options: CODE_SORTS.map((s) => ({ value: s.key, label: s.label })) }]}
                width={200}
              />
            </span>
          ),
          primary: { label: "Import codes", icon: Upload, onClick: () => setImportOpen(true) },
          menu: [
            { label: "Refresh", icon: RefreshCw, onClick: () => void load() },
            { label: "Export CSV", icon: Download, onClick: exportCsv },
            { label: "About this page", icon: Info, onClick: () => setAboutOpen(true) },
          ],
        }}
      />

      <div className="os-chrome flex min-h-0 flex-1 gap-4 px-6 pb-6 pt-2">
        <FilterPanel open={filterOpen} onClose={() => setFilterOpen(false)} objects="codes" activeCount={activeCount} onClearAll={clearAll}>
          <FilterGroup label="Code">
            <FilterRow
              label="Exact or starts with"
              checked={codeOn || params.code.length > 0}
              onCheckedChange={(on) => { setCodeOn(on); if (!on) { setWritten(""); setCodeText(""); setParams({ code: "" }); } }}
            >
              <input autoFocus={codeOn && !params.code} value={codeText} onChange={(e) => setCodeText(e.target.value)} placeholder="AS-" aria-label="Code" className={`${FIELD} h-8 font-mono text-sm`} />
            </FilterRow>
          </FilterGroup>
          <FilterGroup label="Tier">
            {CODE_TIERS.map((t) => (
              <FilterRow key={t} label={`Tier ${t}`} checked={params.tiers.includes(Number(t))} onCheckedChange={(on) => setParams({ tiers: toggleIn(params.tiers, Number(t), on) })} />
            ))}
          </FilterGroup>
          <FilterGroup label="Plan">
            {PLAN_OPTIONS.map((o) => (
              <FilterRow key={o.value} label={o.label} checked={params.plans.includes(o.value)} onCheckedChange={(on) => setParams({ plans: toggleIn(params.plans, o.value, on) })} />
            ))}
          </FilterGroup>
          <FilterGroup label="Imported">
            <FilterRow label="Date range" checked={importedOn || !!(params.importedFrom || params.importedTo)} onCheckedChange={(on) => { setImportedOn(on); if (!on) setParams({ importedFrom: null, importedTo: null }); }}>
              <DateRange from={params.importedFrom} to={params.importedTo} onFrom={(v) => setParams({ importedFrom: v })} onTo={(v) => setParams({ importedTo: v })} what="Imported" />
            </FilterRow>
          </FilterGroup>
          <FilterGroup label="Redeemed">
            <FilterRow label="Date range" checked={redeemedOn || !!(params.redeemedFrom || params.redeemedTo)} onCheckedChange={(on) => { setRedeemedOn(on); if (!on) setParams({ redeemedFrom: null, redeemedTo: null }); }}>
              <DateRange from={params.redeemedFrom} to={params.redeemedTo} onFrom={(v) => setParams({ redeemedFrom: v })} onTo={(v) => setParams({ redeemedTo: v })} what="Redeemed" />
            </FilterRow>
          </FilterGroup>
          <FilterGroup label="Redeemed by">
            <FilterRow label="A company" checked={byOn || !!params.redeemedBy} onCheckedChange={(on) => { setByOn(on); if (!on) setParams({ redeemedBy: null }); else setByPicker(true); }}>
              <span className="relative block">
                <button type="button" onClick={() => setByPicker((o) => !o)} className={`${FIELD} flex h-8 items-center gap-2 text-start text-sm`}>
                  <span className={`min-w-0 flex-1 truncate ${params.redeemedBy ? "" : "text-ink-3"}`}>
                    {payload?.redeemedBy?.name ?? (params.redeemedBy ? "A company" : "Choose a company")}
                  </span>
                  <ChevronDown className="h-4 w-4 shrink-0 text-ink-3" strokeWidth={1.5} aria-hidden />
                </button>
                <Picker
                  open={byPicker}
                  onClose={() => setByPicker(false)}
                  ariaLabel="Redeemed by"
                  alwaysSearch
                  searchPlaceholder="Type a company name"
                  onSearchChange={setByQuery}
                  emptyLabel={byQuery.trim().length < 2 ? "Type two letters of the name" : "No companies match"}
                  selected={params.redeemedBy}
                  onSelect={(v) => { setByPicker(false); setParams({ redeemedBy: v }); }}
                  sections={[{ options: (byOptions ?? []).map((c) => ({ value: c.id, label: c.name })) }]}
                  width={240}
                />
              </span>
            </FilterRow>
          </FilterGroup>
        </FilterPanel>

        <div className="flex min-w-0 flex-1 flex-col gap-4">
          {noCodesAtAll && params.view === "all" ? (
            <OsEmptyView title="No codes yet" action={{ label: "Import codes", onClick: () => setImportOpen(true) }} />
          ) : (
            <TableCard<CodeRow>
              ariaLabel="AppSumo codes"
              columns={columns}
              rows={failed && !payload ? [] : rows}
              rowKey={(r) => r.id}
              rowMenuAlwaysVisible
              rowMenu={(r) => <RowMenuTrigger open={menu?.row.id === r.id} onOpen={(ref) => setMenu({ row: r, anchor: ref })} label={`Actions for ${r.code}`} />}
              empty={emptyRow}
              footer={{
                total,
                noun: "records",
                from,
                to,
                onPrev: params.page > 1 ? () => setParams({ page: Math.min(params.page - 1, lastPage) }, { keepPage: true }) : undefined,
                onNext: to < total ? () => setParams({ page: params.page + 1 }, { keepPage: true }) : undefined,
                // Nothing loaded yet (the first load, or it failed): the count is
                // unknown, so no "Total records 0" and no "0 to 0". A failed
                // refresh keeps the real count of the rows still shown.
                hideTotal: !payload,
                hidePaging: !payload,
              }}
            />
          )}
          {failed && payload ? <InlineRetry text="Could not refresh codes." onRetry={() => void load()} /> : null}
        </div>
      </div>

      {menu ? (
        <MorePortal anchorRef={menu.anchor} width={220} open onClose={() => setMenu(null)} placement="below">
          <MenuList onClick={() => setMenu(null)}>
            <MenuItem icon={Copy} label="Copy code" onClick={() => void copy(menu.row.code, "Code")} />
            {/* Only a redeemed code that is not refunded yet (spec 2.6). A refund
                cannot be undone here and a refunded code can never be redeemed,
                so an unused code stays redeemable; the server refuses it too. */}
            {menu.row.status === "redeemed" ? (
              <>
                <MenuSeparator />
                <MenuItem icon={ReceiptText} label="Mark refunded" destructive onClick={() => setRefunding(menu.row)} />
              </>
            ) : null}
          </MenuList>
        </MorePortal>
      ) : null}

      <TypedConfirmDialog
        request={
          refunding
            ? {
                title: `Mark ${refunding.code} refunded?`,
                body: refunding.company
                  ? `This is bookkeeping. ${refunding.company.name} keeps their plan until you change it on their company page.`
                  : "This is bookkeeping. The company that redeemed it no longer exists.",
                note: "A refund cannot be undone from this console.",
                match: refunding.code,
                matchLabel: "the code",
                confirmLabel: "Mark refunded",
              }
            : null
        }
        busy={refundBusy}
        onCancel={() => setRefunding(null)}
        onConfirm={() => { if (refunding) void refund(refunding); }}
      />

      <ImportCodesDialog
        open={importOpen}
        onClose={() => setImportOpen(false)}
        onImported={(inserted, attempted, pasteDupes) => {
          setImportOpen(false);
          // The same words and total as the Staff activity row (importWords):
          // a line repeated within the paste is its own clause, never "already here".
          toast(importWords(inserted, attempted, pasteDupes).toast);
          void load();
        }}
      />

      <AboutDialog open={aboutOpen} onClose={() => setAboutOpen(false)} title="AppSumo codes">
        The lifetime-deal codes AppSumo gives us. A code works once, for one company. Marking a code refunded is
        bookkeeping: it does not change what that company can use. Settings › Plan &amp; billing has no redeem form yet,
        so today a code is redeemed only through the redeem endpoint.
      </AboutDialog>
    </>
  );
}

function DateRange({
  from,
  to,
  onFrom,
  onTo,
  what,
}: {
  from: string | null;
  to: string | null;
  onFrom: (v: string | null) => void;
  onTo: (v: string | null) => void;
  what: string;
}) {
  return (
    <div className="flex flex-col gap-1.5">
      <span className="flex items-center gap-2 text-sm text-ink-2"><span className="w-9 shrink-0">From</span><DateField size="sm" value={from} onChange={onFrom} placeholder="Any" ariaLabel={`${what} from`} className="min-w-0 flex-1" /></span>
      <span className="flex items-center gap-2 text-sm text-ink-2"><span className="w-9 shrink-0">To</span><DateField size="sm" value={to} onChange={onTo} placeholder="Any" ariaLabel={`${what} to`} className="min-w-0 flex-1" /></span>
    </div>
  );
}

function ImportCodesDialog({
  open,
  onClose,
  onImported,
}: {
  open: boolean;
  onClose: () => void;
  onImported: (inserted: number, attempted: number, pasteDupes: number) => void;
}) {
  const [tier, setTier] = useState(1);
  const [text, setText] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [tierOpen, setTierOpen] = useState(false);
  const [wasOpen, setWasOpen] = useState(open);
  const ask = useConfirm();
  const areaRef = useRef<HTMLTextAreaElement>(null);
  if (open !== wasOpen) {
    setWasOpen(open);
    if (open) setError(null);
  }
  useEffect(() => {
    if (open) requestAnimationFrame(() => areaRef.current?.focus());
  }, [open]);

  const preset = TIER_PRESETS.find((p) => p.tier === tier) ?? TIER_PRESETS[0];
  const lines = text.split(/\r?\n/).length;

  const submit = async () => {
    const parsed = parseImport(text, preset);
    if (!parsed.ok) {
      setError(parsed.error);
      return;
    }
    setBusy(true);
    setError(null);
    const r = await apiFetch<{ inserted: number; attempted: number }>("/api/admin/appsumo", {
      method: "POST",
      json: { codes: parsed.rows, repeatedInPaste: parsed.duplicatesInPaste },
    });
    setBusy(false);
    if (r.ok) {
      setText("");
      onImported(r.data.inserted, r.data.attempted, parsed.duplicatesInPaste);
    } else if (r.status !== 401) setError(r.error || "The import did not run. Try again.");
  };

  const close = async () => {
    if (busy) return;
    if (text.trim()) {
      const ok = await ask({ title: "Discard these codes?", description: "Nothing has been imported yet.", confirmLabel: "Discard", destructive: true });
      if (!ok) return;
      setText("");
    }
    onClose();
  };

  return (
    <ConsoleModal
      open={open}
      onClose={() => void close()}
      width={720}
      busy={busy}
      title="Import codes"
      onSubmit={() => void submit()}
      initialFocus={false}
      footer={
        <>
          <button type="button" onClick={() => void close()} disabled={busy} className={BTN_GHOST}>Cancel</button>
          <button type="submit" disabled={busy || !text.trim()} className={BTN_PRIMARY}>
            {busy ? <PendingDots /> : <Upload className="h-4 w-4" strokeWidth={1.5} aria-hidden />}
            Import
          </button>
        </>
      }
    >
      <div className="flex flex-col gap-1">
        <span className={LABEL}>Default tier</span>
        <span className="relative inline-block">
          <button type="button" onClick={() => setTierOpen((o) => !o)} aria-haspopup="listbox" aria-expanded={tierOpen} className={`${FIELD} flex w-80 items-center gap-2 text-start`}>
            <span className="min-w-0 flex-1 truncate">{codeGives(preset)}</span>
            <ChevronDown className="h-4 w-4 shrink-0 text-ink-3" strokeWidth={1.5} aria-hidden />
          </button>
          <Picker
            open={tierOpen}
            onClose={() => setTierOpen(false)}
            ariaLabel="Default tier"
            selected={String(tier)}
            onSelect={(v) => { setTier(Number(v)); setTierOpen(false); }}
            sections={[{ options: TIER_PRESETS.map((p) => ({ value: String(p.tier), label: codeGives(p), description: `${planLabel(p.plan)} plan` })) }]}
            width={320}
          />
        </span>
      </div>
      <label className="flex flex-col gap-1">
        <span className={LABEL}>Codes</span>
        <textarea
          ref={areaRef}
          value={text}
          onChange={(e) => { setText(e.target.value); setError(null); }}
          rows={Math.min(12, Math.max(10, lines))}
          spellCheck={false}
          placeholder={"AS-7F3K-2QXA\nAS-9P1L-8MZD\nAS-4R2T-6NBC, 2, SCALE, 30"}
          aria-invalid={error ? true : undefined}
          className="w-full resize-y rounded-md border border-line-strong bg-raised px-3 py-2 font-mono text-sm text-ink placeholder:text-ink-3 focus:outline-none focus-visible:border-brand"
        />
      </label>
      {error ? <p className="text-sm text-danger-text" role="alert">{error}</p> : null}
      <p className="text-sm text-ink-2">
        One code per line. To override a line: code, tier, plan, seats. Codes already imported are skipped, so it is safe
        to paste the whole file again. A code works once, for one company.
      </p>
    </ConsoleModal>
  );
}
