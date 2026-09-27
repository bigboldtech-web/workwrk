"use client";

// Assets (spec-tools-misc 2.2): what kit the company owns, who has it, and
// what is about to go out of warranty. Anyone with reports sees their chain;
// the People team and Admin see the org (My team · All). A Member without
// reports never lands here (the layout's app-key gate); their own kit is the
// Assets tab of My profile.
//
// What changed: the header stack, one TableCard with a semantic StatusChip
// (no --os-c-* hue map), the FilterPanel (row search on "/", Status,
// Condition, Type, Assigned to, Warranty expiring 30 / 60 / 90), Sort and
// Group, a drawer at /assets?asset=<id>, a bulk bar, the money through
// useOrgCurrency (settings.currency, not a hard-coded USD), the four stat
// tiles gone (the total moves into the card footer, the warranty count into
// the filter row), the injected <style> block gone with the .ast__ family,
// and one toast system. A manager asking for ?scope=all gets their team and
// one notice line, never a lock (access 5.5 situation 2). Row figures are
// exact (a register is a record); only the footer total is compact. The
// list is paged (?page=, ?pageSize=) so a register past a thousand rows is
// never silently cut, and the footer's numbers are the server's.

import { useCallback, useEffect, useMemo, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { CircleAlert, Download, MoreHorizontal, Plus, Trash2, UserRound, CircleDot } from "lucide-react";
import { OsPageHeader } from "@/components/layout/os/page-header";
import { OsEmptyView } from "@/components/layout/os/empty-view";
import { useOsShell } from "@/components/layout/os/shell-context";
import { useOsToast } from "@/components/layout/os/toast";
import { useBoot } from "@/components/layout/os/boot-context";
import { StrippedViewNotice } from "@/components/access/denial-views";
import { useConfirm } from "@/components/ui/dialog-provider";
import { TableCard, type TableColumn } from "@/components/ui/table-card";
import { ViewTab } from "@/components/ui/view-tabs";
import { FilterGroup, FilterPanel, FilterRow } from "@/components/ui/filter-panel";
import { AssigneeFilterGroup } from "./assignee-filter";
import { Picker } from "@/components/ui/picker";
import { SegmentedControl } from "@/components/ui/segmented-control";
import { StatusChip } from "@/components/ui/chip";
import { EntityTile, NEUTRAL_TILE } from "@/components/ui/entity-tile";
import { Avatar } from "@/components/ui/avatar-stack";
import { MenuItem, MenuList } from "@/components/ui/menu";
import { MorePortal } from "@/components/layout/os/more-portal";
import { apiFetch } from "@/lib/api-fetch";
import { useShortcut } from "@/lib/shortcuts";
import { formatDate } from "@/lib/format/date";
import { useDatePrefs } from "@/lib/format/use-date-prefs";
import { useOrgCurrency } from "@/lib/org/use-org-currency";
import {
  ASSET_GROUPS, ASSET_PAGE_DEFAULT, ASSET_PAGE_SIZES, ASSET_SORTS, WARRANTY_WINDOWS, parseAssetGroup, parseAssetSort, parseWarrantyWindow, warrantyState,
  type AssetGroup, type AssetSort,
} from "@/lib/assets/asset-view";
import {
  ASSET_CONDITIONS, ASSET_STATUSES, ASSET_TYPES, CONDITION_LABEL, STATUS_LABEL, personName, statusColor, typeLabel,
  type ApiAsset, type AssetsResponse, type AssetStatus, type AssetRights,
} from "./types";
import { assetGlyph } from "./asset-glyph";
import { AssetFormDialog } from "./asset-form-dialog";
import { AssignDialog } from "./assign-dialog";
import { AssetRowMenu } from "./asset-row-menu";
import { AssetDrawer } from "./asset-drawer";

const NO_RIGHTS: AssetRights = { canEdit: false, canAssign: false, canDelete: false };

export default function AssetsPage() {
  const router = useRouter();
  const pathname = usePathname();
  const sp = useSearchParams();
  const { rowVersion } = useOsShell();
  const { toast } = useOsToast();
  const confirm = useConfirm();
  const { boot } = useBoot();
  const datePrefs = useDatePrefs();
  const { format: money, formatExact: exactMoney } = useOrgCurrency();

  // Everything the list depends on lives in the URL, so a link carries it.
  const openId = sp?.get("asset") ?? null;
  const scopeParam = sp?.get("scope");
  const q = sp?.get("q") ?? "";
  const status = sp?.get("status") ?? "";
  const condition = sp?.get("condition") ?? "";
  const type = sp?.get("type") ?? "";
  const assignedTo = sp?.get("assignedTo") ?? "";
  const warrantyWithin = parseWarrantyWindow(sp?.get("warrantyWithin"));
  const sort = parseAssetSort(sp?.get("sort"));
  const group = parseAssetGroup(sp?.get("group"));
  const page = Math.max(1, Number(sp?.get("page")) || 1);
  const pageSize = (ASSET_PAGE_SIZES as readonly number[]).includes(Number(sp?.get("pageSize"))) ? Number(sp?.get("pageSize")) : ASSET_PAGE_DEFAULT;

  const [data, setData] = useState<AssetsResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [filterOpen, setFilterOpen] = useState(Boolean(q || status || condition || type || assignedTo || warrantyWithin));
  const [draftQ, setDraftQ] = useState(q);
  const [sortOpen, setSortOpen] = useState(false);
  const [groupOpen, setGroupOpen] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [notice, setNotice] = useState<string | null>(null);
  const [createOpen, setCreateOpen] = useState(false);
  const [editing, setEditing] = useState<ApiAsset | null>(null);
  const [assigning, setAssigning] = useState<ApiAsset | null>(null);
  const [bulkAssign, setBulkAssign] = useState(false);
  const [bulkStatus, setBulkStatus] = useState<{ anchor: { current: HTMLElement | null } } | null>(null);

  const setParams = useCallback((patch: Record<string, string | null>) => {
    const next = new URLSearchParams(sp?.toString() ?? "");
    for (const [k, v] of Object.entries(patch)) {
      if (v === null || v === "") next.delete(k);
      else next.set(k, v);
    }
    const s = next.toString();
    router.replace(s ? `${pathname}?${s}` : pathname, { scroll: false });
  }, [sp, router, pathname]);

  useEffect(() => {
    if (draftQ === q) return;
    const t = setTimeout(() => setParams({ q: draftQ.trim() || null }), 250);
    return () => clearTimeout(t);
  }, [draftQ, q, setParams]);

  const load = useCallback(async () => {
    const params = new URLSearchParams();
    if (scopeParam) params.set("scope", scopeParam);
    if (q) params.set("q", q);
    if (status) params.set("status", status);
    if (condition) params.set("condition", condition);
    if (type) params.set("type", type);
    if (assignedTo) params.set("assignedTo", assignedTo);
    if (warrantyWithin) params.set("warrantyWithin", String(warrantyWithin));
    params.set("sort", sort);
    if (page > 1) params.set("page", String(page));
    if (pageSize !== ASSET_PAGE_DEFAULT) params.set("pageSize", String(pageSize));
    const r = await apiFetch<AssetsResponse>(`/api/assets?${params}`, { cache: "no-store" });
    if (!r.ok) { setError(r.error); return; }
    setError(null);
    setData(r.data);
    if (r.data.scopeStripped) {
      // The view they asked for is not theirs: default view, parameter
      // stripped, one notice line (access 5.5 situation 2).
      setNotice("Showing your team. The whole register is for the People team and Admins.");
      setParams({ scope: null });
    }
  }, [scopeParam, q, status, condition, type, assignedTo, warrantyWithin, sort, page, pageSize, setParams]);
  const version = rowVersion("assets");
  useEffect(() => {
    const t = setTimeout(() => { void load(); }, 0);
    const onFocus = () => { void load(); };
    window.addEventListener("focus", onFocus);
    return () => { clearTimeout(t); window.removeEventListener("focus", onFocus); };
  }, [load, version]);

  useShortcut({ id: "assets.search", keys: "/", label: "Search assets", scope: "page", group: "On this page", run: (e) => {
    e.preventDefault();
    setFilterOpen(true);
    requestAnimationFrame(() => (document.querySelector(".os-filter-panel input[type=search]") as HTMLInputElement | null)?.focus());
  } });

  const rights: AssetRights = data ? { canEdit: data.canEdit, canAssign: data.canAssign, canDelete: data.canDelete } : NO_RIGHTS;
  const canAct = rights.canEdit || rights.canAssign || rights.canDelete;
  const assets = data?.assets ?? null;
  const activeFilters = (q ? 1 : 0) + (status ? 1 : 0) + (condition ? 1 : 0) + (type ? 1 : 0) + (assignedTo ? 1 : 0) + (warrantyWithin ? 1 : 0);
  const clearFilters = () => { setDraftQ(""); setParams({ q: null, status: null, condition: null, type: null, assignedTo: null, warrantyWithin: null, page: null }); };
  // A filter change starts again from page 1.
  const setFilter = (patch: Record<string, string | null>) => setParams({ ...patch, page: null });
  const exportQuery = () => {
    const params = new URLSearchParams();
    if (scopeParam) params.set("scope", scopeParam);
    if (q) params.set("q", q);
    if (status) params.set("status", status);
    if (condition) params.set("condition", condition);
    if (type) params.set("type", type);
    if (assignedTo) params.set("assignedTo", assignedTo);
    if (warrantyWithin) params.set("warrantyWithin", String(warrantyWithin));
    params.set("sort", sort);
    return params;
  };
  const exportSelected = () => {
    const params = exportQuery();
    params.set("ids", [...selected].join(","));
    window.location.href = `/api/export/assets?${params}`;
  };

  // Warranty counts for the 30 / 60 / 90 segments, over the rows in view.
  const warrantyCounts = useMemo(() => {
    const out: Record<number, number> = { 30: 0, 60: 0, 90: 0 };
    for (const a of assets ?? []) {
      const s = warrantyState(a.warrantyExpiry);
      if (s.kind !== "soon" && s.kind !== "ok") continue;
      for (const w of WARRANTY_WINDOWS) if (s.days <= w) out[w]++;
    }
    return out;
  }, [assets]);

  // The chosen assignee's name, when a row on this page carries it.
  const assignedToName = useMemo(() => {
    const a = (assets ?? []).find((x) => x.assignedTo?.id === assignedTo);
    return a?.assignedTo ? personName(a.assignedTo) || "Someone" : null;
  }, [assets, assignedTo]);

  const groups = useMemo(() => {
    if (!assets) return null;
    if (group === "none") return [{ key: "all", label: null as string | null, status: null as AssetStatus | null, rows: assets }];
    const map = new Map<string, { label: string; status: AssetStatus | null; rows: ApiAsset[] }>();
    for (const a of assets) {
      const key = group === "status" ? a.status : group === "type" ? a.type : (a.assignedTo?.id ?? "unassigned");
      const label = group === "status" ? STATUS_LABEL[a.status] : group === "type" ? typeLabel(a.type) : (a.assignedTo ? personName(a.assignedTo) || "Someone" : "Unassigned");
      const g = map.get(key) ?? { label, status: group === "status" ? a.status : null, rows: [] };
      g.rows.push(a);
      map.set(key, g);
    }
    return [...map.entries()].map(([key, g]) => ({ key, ...g }));
  }, [assets, group]);

  // The server's numbers over the whole filtered set, never the page's length.
  const total = data?.total ?? 0;
  const totalValue = data?.totalValue ?? 0;
  const from = total === 0 ? 0 : (page - 1) * pageSize + 1;
  const to = Math.min(total, page * pageSize);

  // `ids` names the rows to act on; absent, it is the checked set. The row
  // shortcut (Cmd+Backspace) passes its own row, because setting state and
  // reading it in the same call would act on the previous selection.
  async function bulk(op: "assign" | "status" | "delete", value?: string | null, ids: string[] = [...selected]) {
    if (ids.length === 0) return;
    if (op === "delete") {
      const ok = await confirm({
        title: `Delete ${ids.length} ${ids.length === 1 ? "asset" : "assets"}?`,
        description: `They move to Trash. You can restore them from there for ${boot.org.trashDays} days.`,
        confirmLabel: "Delete",
        destructive: true,
      });
      if (!ok) return;
    }
    const r = await apiFetch<{ done: number; failed: number }>("/api/assets/bulk", { method: "POST", json: { op, ids, value } });
    if (!r.ok) { toast(r.error || "Couldn't change those assets", { tone: "danger" }); return; }
    if (r.data.failed > 0) toast(`Changed ${r.data.done} of ${ids.length}. ${r.data.failed} couldn't be changed.`, { tone: "danger" });
    else toast(op === "delete" ? `${r.data.done} moved to Trash` : op === "assign" ? (value ? "Assigned" : "Unassigned") : "Status changed");
    setSelected(new Set());
    void load();
  }

  const columns = useMemo<TableColumn<ApiAsset>[]>(() => [
    { key: "name", label: "Asset", title: true, width: "minmax(220px,1.4fr)", render: (a) => (
      <span className="flex min-w-0 items-center gap-2">
        <EntityTile size="sm" icon={assetGlyph(a.type)} {...NEUTRAL_TILE} />
        <span className="truncate">{a.name}</span>
      </span>
    ) },
    { key: "type", label: "Type", width: "130px", hideBelow: 830, render: (a) => <span className="text-row text-ink">{typeLabel(a.type)}</span> },
    { key: "assignee", label: "Assigned to", width: "minmax(160px,1fr)", render: (a) => a.assignedTo ? (
      <span className="flex min-w-0 items-center gap-2">
        <Avatar person={{ id: a.assignedTo.id, firstName: a.assignedTo.firstName, lastName: a.assignedTo.lastName, avatar: a.assignedTo.avatar }} size={24} />
        <span className="truncate text-row text-ink">{personName(a.assignedTo) || "Someone"}</span>
      </span>
    ) : <span className="text-row text-ink-2">Unassigned</span> },
    { key: "status", label: "Status", width: "120px", render: (a) => <StatusChip color={statusColor(a.status)} label={STATUS_LABEL[a.status]} /> },
    { key: "condition", label: "Condition", width: "100px", hideBelow: 1060, render: (a) => <span className="text-row text-ink">{CONDITION_LABEL[a.condition]}</span> },
    { key: "serial", label: "Serial", width: "150px", hideBelow: 1210, render: (a) => a.serialNumber
      ? <span className="truncate font-mono text-sm tabular-nums text-ink" title={a.serialNumber}>{a.serialNumber.length > 18 ? `${a.serialNumber.slice(0, 18)}…` : a.serialNumber}</span>
      : <span className="text-sm text-ink-3">None</span> },
    { key: "warranty", label: "Warranty", width: "130px", hideBelow: 960, render: (a) => {
      const s = warrantyState(a.warrantyExpiry);
      if (s.kind === "none") return <span className="text-sm text-ink-3">None</span>;
      if (s.kind === "expired") return <span className="text-sm text-danger-text">Expired</span>;
      if (s.kind === "soon") return (
        <span className="inline-flex items-center gap-1 text-sm text-danger-text" title={formatDate(a.warrantyExpiry, datePrefs)}>
          <CircleAlert className="h-3 w-3" aria-hidden />{s.days === 0 ? "Ends today" : `in ${s.days} ${s.days === 1 ? "day" : "days"}`}
        </span>
      );
      return <span className="text-sm text-ink-2">{formatDate(a.warrantyExpiry, datePrefs)}</span>;
    } },
    { key: "value", label: "Value", width: "110px", numeric: true, render: (a) => a.purchaseCost != null ? <span className="text-row text-ink">{exactMoney(a.purchaseCost)}</span> : <span className="text-sm text-ink-3">None</span> },
  ], [datePrefs, exactMoney]);

  const scopes = data?.scopes ?? [];
  const scope = data?.scope ?? "team";
  const emptyCopy = scope === "all" ? "No assets yet" : "Nobody on your team has kit assigned yet.";

  return (
    <>
      <OsPageHeader
        title="Assets"
        views={scopes.length > 1 ? (
          <>
            <ViewTab label="My team" active={scope === "team"} onClick={() => setParams({ scope: "team", page: null })} />
            <ViewTab label="All" active={scope === "all"} onClick={() => setParams({ scope: "all", page: null })} />
          </>
        ) : undefined}
        toolbar={{
          filter: { open: filterOpen, onToggle: () => setFilterOpen((v) => !v), count: activeFilters },
          sort: { onClick: () => setSortOpen((v) => !v), label: sort === "recent" ? "Sort" : ASSET_SORTS.find((s) => s.value === sort)?.label, active: sort !== "recent" },
          group: { onClick: () => setGroupOpen((v) => !v), label: group === "none" ? "Group" : ASSET_GROUPS.find((g) => g.value === group)?.label, active: group !== "none" },
          primary: data?.canAdd ? { label: "Add asset", icon: Plus, onClick: () => setCreateOpen(true) } : undefined,
          // Export CSV (the export rule, access section 9): never an Agent.
          menu: data && !boot.viewer.isAgent ? [{ label: "Export CSV", icon: Download, onClick: () => { window.location.href = `/api/export/assets?${exportQuery()}`; } }] : undefined,
        }}
      />
      {notice ? <StrippedViewNotice>{notice}</StrippedViewNotice> : null}

      <div className="relative">
        {sortOpen ? (
          <div className="absolute start-[110px] top-0 z-40">
            <Picker open onClose={() => setSortOpen(false)} ariaLabel="Sort assets" selected={sort}
              sections={[{ options: ASSET_SORTS.map((s) => ({ value: s.value, label: s.label })) }]}
              onSelect={(v) => { setSortOpen(false); setParams({ sort: v === "recent" ? null : (v as AssetSort) }); }} />
          </div>
        ) : null}
        {groupOpen ? (
          <div className="absolute start-[200px] top-0 z-40">
            <Picker open onClose={() => setGroupOpen(false)} ariaLabel="Group assets" selected={group}
              sections={[{ options: ASSET_GROUPS.map((g) => ({ value: g.value, label: g.label })) }]}
              onSelect={(v) => { setGroupOpen(false); setParams({ group: v === "none" ? null : (v as AssetGroup) }); }} />
          </div>
        ) : null}
      </div>

      <div className="os-chrome flex min-h-0 flex-1 gap-4 px-6 pb-8 pt-2">
        <FilterPanel
          open={filterOpen}
          onClose={() => setFilterOpen(false)}
          objects="assets"
          activeCount={activeFilters}
          onClearAll={clearFilters}
          search={{ value: draftQ, onChange: setDraftQ, placeholder: "Search assets" }}
        >
          <FilterGroup label="Status">
            {ASSET_STATUSES.map((s) => (
              <FilterRow key={s} label={STATUS_LABEL[s]} checked={status === s} onCheckedChange={(on) => setFilter({ status: on ? s : null })} />
            ))}
          </FilterGroup>
          <FilterGroup label="Condition">
            {ASSET_CONDITIONS.map((c) => (
              <FilterRow key={c} label={CONDITION_LABEL[c]} checked={condition === c} onCheckedChange={(on) => setFilter({ condition: on ? c : null })} />
            ))}
          </FilterGroup>
          <FilterGroup label="Type">
            {ASSET_TYPES.map((t) => (
              <FilterRow key={t} label={typeLabel(t)} checked={type === t} onCheckedChange={(on) => setFilter({ type: on ? t : null })} />
            ))}
          </FilterGroup>
          <AssigneeFilterGroup value={assignedTo} valueName={assignedToName} onChange={(v) => setFilter({ assignedTo: v })} />
          <FilterGroup label="Warranty">
            <FilterRow label="Warranty expiring" checked={Boolean(warrantyWithin)} onCheckedChange={(on) => setFilter({ warrantyWithin: on ? "60" : null })}>
              <SegmentedControl
                size="sm"
                label="Warranty window"
                value={String(warrantyWithin ?? 60)}
                options={WARRANTY_WINDOWS.map((w) => ({ value: String(w), label: `${w} days · ${warrantyCounts[w]}` }))}
                onChange={(v) => setFilter({ warrantyWithin: v })}
              />
            </FilterRow>
          </FilterGroup>
        </FilterPanel>

        <div className="min-w-0 flex-1">
          {error ? (
            <OsEmptyView variant="error" title="Couldn't load Assets" hint={error} action={{ label: "Try again", onClick: () => void load() }} />
          ) : assets && assets.length === 0 && activeFilters === 0 ? (
            <OsEmptyView title={emptyCopy} />
          ) : (
            <div className="flex flex-col gap-3">
              {(groups ?? [{ key: "loading", label: null, status: null, rows: null as ApiAsset[] | null }]).map((g, i) => (
                <div key={g.key}>
                  {g.label ? (
                    <div className="flex h-11 items-center gap-2 px-1">
                      {g.status ? <StatusChip color={statusColor(g.status)} label={g.label} /> : <span className="text-row font-medium text-ink">{g.label}</span>}
                      <span className="text-xs font-medium text-ink-2">{g.rows?.length ?? 0}</span>
                    </div>
                  ) : null}
                  <TableCard
                    ariaLabel={g.label ? `Assets · ${g.label}` : "Assets"}
                    columns={columns}
                    rows={g.rows}
                    rowKey={(a) => a.id}
                    onRowClick={(a) => setParams({ asset: a.id })}
                    highlightKey={openId}
                    selectable={canAct}
                    selected={selected}
                    onSelectedChange={setSelected}
                    onRowDeleteKey={rights.canDelete ? (a) => void bulk("delete", undefined, [a.id]) : undefined}
                    empty={<span className="text-row text-ink-2">No results · <button type="button" className="text-brand-deep hover:underline" onClick={clearFilters}>Clear filters</button></span>}
                    footer={i === (groups?.length ?? 1) - 1 && assets ? {
                      total, noun: "records", from, to,
                      onPrev: page > 1 ? () => setParams({ page: page - 1 <= 1 ? null : String(page - 1) }) : undefined,
                      onNext: to < total ? () => setParams({ page: String(page + 1) }) : undefined,
                      pageSize,
                      pageSizes: [...ASSET_PAGE_SIZES],
                      onPageSize: (n) => setParams({ pageSize: n === ASSET_PAGE_DEFAULT ? null : String(n), page: null }),
                      extra: <span className="tabular-nums" title={exactMoney(totalValue)}>· Total value {money(totalValue)}</span>,
                    } : undefined}
                    rowMenu={canAct ? (a) => (
                      <AssetRowMenu asset={a} rights={rights} onEdit={setEditing} onAssign={setAssigning} onOpen={(x) => setParams({ asset: x.id })} onChanged={() => void load()} />
                    ) : undefined}
                    bulkActions={canAct ? (
                      <>
                        {rights.canAssign ? <BulkButton icon={UserRound} label="Assign to" onClick={() => setBulkAssign(true)} /> : null}
                        {rights.canEdit ? <BulkButton icon={CircleDot} label="Change status" onClick={(e) => setBulkStatus({ anchor: { current: e.currentTarget } })} /> : null}
                        {!boot.viewer.isAgent ? <BulkButton icon={Download} label="Export" onClick={exportSelected} /> : null}
                        {rights.canDelete ? <BulkButton icon={Trash2} label="Delete" destructive onClick={() => void bulk("delete")} /> : null}
                      </>
                    ) : undefined}
                  />
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {bulkStatus ? (
        <MorePortal anchorRef={bulkStatus.anchor} width={200} open placement="below" onClose={() => setBulkStatus(null)}>
          <MenuList aria-label="Change status">
            {ASSET_STATUSES.filter((s) => s !== "ASSIGNED").map((s) => (
              <MenuItem key={s} icon={MoreHorizontal} label={STATUS_LABEL[s]} onClick={() => { setBulkStatus(null); void bulk("status", s); }} />
            ))}
          </MenuList>
        </MorePortal>
      ) : null}

      <AssetDrawer id={openId} rights={rights} onClose={() => setParams({ asset: null })} onEdit={setEditing} onAssign={setAssigning} onChanged={() => void load()} />
      <AssetFormDialog open={createOpen} onOpenChange={setCreateOpen} onSaved={() => void load()} />
      <AssetFormDialog open={editing !== null} onOpenChange={(o) => { if (!o) setEditing(null); }} asset={editing} onSaved={() => void load()} />
      <AssignDialog open={assigning !== null} onOpenChange={(o) => { if (!o) setAssigning(null); }} asset={assigning} onSaved={() => void load()} />
      <AssignDialog open={bulkAssign} onOpenChange={setBulkAssign} asset={null} count={selected.size} onPick={(id) => { setBulkAssign(false); void bulk("assign", id); }} onSaved={() => void load()} />
    </>
  );
}

function BulkButton({ icon: Icon, label, onClick, destructive }: { icon: typeof Plus; label: string; onClick: (e: React.MouseEvent<HTMLButtonElement>) => void; destructive?: boolean }) {
  return (
    <button type="button" onClick={onClick} className={`inline-flex h-8 items-center gap-1.5 rounded-md px-2.5 text-sm font-medium hover:bg-hover ${destructive ? "text-danger-text" : "text-ink"}`}>
      <Icon className="h-4 w-4" aria-hidden />{label}
    </button>
  );
}
