"use client";

/* /agreements, "Contracts" (spec-process section 2): the company's
 * contracts: drafts, ones out for signature, completed ones, and the
 * templates they start from.
 *
 *   header   views All · Drafts · Out for signature · Completed · Voided ·
 *            Templates (?view=); toolbar Filter (search, Folder, Status,
 *            Party, Sent, Source), Sort, Group (Folder · None), list / cards;
 *            the one blue "New contract" (split: Write from scratch, Upload
 *            a PDF, From template…), "New template" on the Templates view;
 *            "…" Organize folders, Export CSV
 *   body     TableCard: Name · Folder · Parties · Signed · Status · Updated
 *            · row "…" (Open, Rename, Move to folder…, Duplicate, Save as
 *            template, Use template, Void, Archive, Delete). Folder group
 *            headers with "…" › Rename folder (one server call).
 *
 *   GET /api/agreements?view=&status=&category=&party=&q=&sort=&dir=&page=
 *
 * Errors are errors (an OsEmptyView with Retry), never "No contracts yet".
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Archive, Copy, Download, ExternalLink, FileSignature, FolderInput, LayoutGrid, LayoutTemplate, List as ListIcon, Pencil, Trash2, XCircle } from "lucide-react";
import { Breadcrumb } from "@/components/layout/os/top-bar/breadcrumb";
import { OsPageHeader } from "@/components/layout/os/page-header";
import { OsEmptyView } from "@/components/layout/os/empty-view";
import { useOsShell } from "@/components/layout/os/shell-context";
import { useOsToast } from "@/components/layout/os/toast";
import { useBoot } from "@/components/layout/os/boot-context";
import { useConfirm, usePrompt } from "@/components/ui/dialog-provider";
import { ViewTab } from "@/components/ui/view-tabs";
import { FilterGroup, FilterPanel, FilterRow } from "@/components/ui/filter-panel";
import { Picker } from "@/components/ui/picker";
import { MenuItem, MenuList, MenuSeparator } from "@/components/ui/menu";
import { MorePortal } from "@/components/layout/os/more-portal";
import { RowMoreButton, TableCard, type TableColumn } from "@/components/ui/table-card";
import { StatusChip } from "@/components/ui/chip";
import { EntityTile } from "@/components/ui/entity-tile";
import { Dots } from "@/components/ui/dots";
import { DateField } from "@/components/ui/date-field";
import { NewContractDialog } from "@/components/agreements/new-contract-dialog";
import { useRole } from "@/hooks/use-role";
import { apiFetch } from "@/lib/api-fetch";
import { useFormat } from "@/lib/format/use-date-prefs";
import { CONTRACTS_SORTS, CONTRACTS_VIEWS, CONTRACTS_VIEW_LABEL, CONTRACT_STATUSES, CONTRACT_STATUS_COLOR, CONTRACT_STATUS_LABEL, contractsViewHref, parseContractsSort, parseContractsView, type ContractStatus, type ContractsView } from "@/lib/contracts";
import { cn } from "@/lib/utils";

type Party = { id: string; name: string; email: string; role: string; status: string; userId: string | null; order: number };
type Row = { id: string; title: string; status: ContractStatus; category: string | null; isTemplate: boolean; sourceType: string; sentAt: string | null; updatedAt: string; parties: Party[]; partyCount: number; signedCount: number; usedCount: number | null };
type Payload = { data: Row[]; pagination: { total: number; totalPages: number }; counts: Record<ContractsView, number> };

export function AgreementsClient() {
  const router = useRouter();
  const params = useSearchParams();
  const { toast } = useOsToast();
  const { boot } = useBoot();
  const { rowVersion, bumpRowVersion, prefs, patchPrefs } = useOsShell();
  const confirm = useConfirm();
  const prompt = usePrompt();
  const fmt = useFormat();
  const { isAdmin } = useRole();

  const view = parseContractsView(params.get("view"));
  const isTemplates = view === "templates";
  const q = params.get("q") ?? "";
  const category = params.get("category");
  const status = params.get("status");
  const party = params.get("party") ?? "";
  const source = params.get("source");
  const sentFrom = params.get("sentFrom"); const sentTo = params.get("sentTo");
  const sort = parseContractsSort(params.get("sort"));
  const dir: "asc" | "desc" = params.get("dir") === "asc" || params.get("dir") === "desc" ? (params.get("dir") as "asc" | "desc") : sort === "name" ? "asc" : "desc";
  const group = params.get("group") === "none" ? "none" : "folder";
  const page = Math.max(1, Number(params.get("page")) || 1);
  const viewType = prefs.home.ui?.contractsViewType === "cards" ? "cards" : "list";
  const setParams = useCallback((patch: Record<string, string | null>, opts?: { keepPage?: boolean }) => {
    const next = new URLSearchParams(params.toString());
    for (const [k, v] of Object.entries(patch)) { if (v === null || v === "") next.delete(k); else next.set(k, v); }
    if (!opts?.keepPage) next.delete("page");
    const s = next.toString();
    router.push(s ? `/agreements?${s}` : "/agreements");
  }, [params, router]);
  const activeFilters = [q, category, status, party, source, sentFrom || sentTo ? "s" : null].filter(Boolean).length;

  const [payload, setPayload] = useState<Payload | null>(null);
  const [loadError, setLoadError] = useState(false);
  const qs = useMemo(() => {
    const p = new URLSearchParams({ view, sort, dir, page: String(page), pageSize: "40" });
    if (q) p.set("q", q);
    if (category) p.set("category", category);
    if (status) p.set("status", status);
    if (party) p.set("party", party);
    if (source) p.set("source", source);
    if (sentFrom) p.set("sentFrom", sentFrom); if (sentTo) p.set("sentTo", sentTo);
    return p.toString();
  }, [view, sort, dir, page, q, category, status, party, source, sentFrom, sentTo]);
  const load = useCallback(async () => {
    const r = await apiFetch<Payload | { data: Payload }>(`/api/agreements?${qs}`, { cache: "no-store" });
    if (!r.ok) { setLoadError(true); return; }
    setLoadError(false);
    const d = r.data as Payload & { data: Payload | Row[] };
    setPayload(Array.isArray(d.data) ? (d as Payload) : (d.data as Payload));
  }, [qs]);
  useEffect(() => { const t = setTimeout(() => void load(), 0); return () => clearTimeout(t); }, [load]);
  const rv = rowVersion("agreements");
  useEffect(() => { if (rv <= 0) return; const t = setTimeout(() => void load(), 0); return () => clearTimeout(t); }, [rv, load]);
  useEffect(() => {
    const onFocus = () => { void load(); };
    window.addEventListener("focus", onFocus);
    return () => window.removeEventListener("focus", onFocus);
  }, [load]);

  /* folders (settings.process.contractFolders) */
  const [folders, setFolders] = useState<string[] | null>(null);
  const loadFolders = useCallback(async () => {
    const r = await apiFetch<{ process?: { contractFolders?: string[] } }>("/api/settings/process", { cache: "no-store" });
    setFolders(r.ok ? r.data.process?.contractFolders ?? [] : []);
  }, []);
  useEffect(() => { const t = setTimeout(() => void loadFolders(), 0); return () => clearTimeout(t); }, [loadFolders]);

  /* new contract (?new=1 from the Docs "+" menu) */
  const [newOpen, setNewOpen] = useState<{ source: "write" | "pdf" | "template" } | null>(null);

  /* filter panel */
  const [filterOpen, setFilterOpen] = useState(false);
  const [sortOpen, setSortOpen] = useState(false);
  const [groupOpen, setGroupOpen] = useState(false);
  const [folderOpen, setFolderOpen] = useState(false);
  const searchRef = useRef<HTMLInputElement | null>(null);
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      const el = document.activeElement as HTMLElement | null;
      const typing = !!el && (el.tagName === "INPUT" || el.tagName === "TEXTAREA" || el.isContentEditable);
      if ((e.key === "/" && !typing && !e.metaKey && !e.ctrlKey) || ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "f" && !typing)) {
        e.preventDefault(); setFilterOpen(true); setTimeout(() => searchRef.current?.focus(), 50);
      }
      if (e.key === "n" && !typing && !e.metaKey && !e.ctrlKey && !e.altKey) { e.preventDefault(); setNewOpen({ source: "write" }); }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const newArmed = useRef(true);
  useEffect(() => {
    if (params.get("new") !== "1") { newArmed.current = true; return; }
    if (!newArmed.current) return;
    newArmed.current = false;
    const next = new URLSearchParams(params.toString()); next.delete("new");
    const s = next.toString();
    // A tick after the effect: the open is a state change the URL asked for.
    const t = setTimeout(() => { router.replace(s ? `/agreements?${s}` : "/agreements", { scroll: false }); setNewOpen({ source: "write" }); }, 0);
    return () => clearTimeout(t);
  }, [params, router]);

  /* row actions */
  const [menu, setMenu] = useState<{ row: Row; anchor: React.RefObject<HTMLElement | null>; point?: { x: number; y: number } } | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [moveFor, setMoveFor] = useState<{ row: Row; point: { top: number; left: number } | null } | null>(null);
  const pointFromMenu = (m: typeof menu): { top: number; left: number } | null => {
    if (!m) return null;
    if (m.point) return { top: m.point.y + 4, left: m.point.x };
    const rect = m.anchor.current?.getBoundingClientRect();
    return rect ? { top: rect.bottom + 4, left: Math.max(8, rect.right - 300) } : null;
  };
  const patchRow = async (r: Row, body: Record<string, unknown>, done: string) => {
    const res = await apiFetch(`/api/agreements/${r.id}`, { method: "PATCH", json: body });
    if (!res.ok) { toast(res.error || "Couldn't update", { tone: "danger" }); return false; }
    toast(done); bumpRowVersion("agreements"); void load(); return true;
  };
  const rename = async (r: Row) => {
    const next = await prompt({ title: "Rename", defaultValue: r.title, submitLabel: "Save" });
    if (!next || next.trim() === r.title) return;
    await patchRow(r, { title: next.trim() }, "Renamed");
  };
  const moveTo = async (r: Row, folder: string | null) => { setMoveFor(null); await patchRow(r, { category: folder }, folder ? `Moved to ${folder}` : "Moved to Unfiled"); };
  const duplicate = async (r: Row) => {
    setBusyId(r.id);
    const res = await apiFetch<{ id?: string; data?: { id?: string } }>("/api/agreements", { method: "POST", json: { title: `${r.title} (copy)`, category: r.category, isTemplate: r.isTemplate, ...(r.isTemplate ? { sourceType: r.sourceType } : { fromTemplateId: r.id }) } });
    setBusyId(null);
    if (!res.ok) { toast(res.error || "Couldn't duplicate", { tone: "danger" }); return; }
    toast("Duplicated"); bumpRowVersion("agreements"); void load();
  };
  const saveAsTemplate = async (r: Row) => {
    const res = await apiFetch(`/api/agreements/${r.id}/save-as-template`, { method: "POST" });
    if (!res.ok) { toast(res.error || "Couldn't save the template", { tone: "danger" }); return; }
    toast("Saved as template", { action: { label: "Open templates", onClick: () => router.push("/agreements?view=templates") } });
  };
  const createFromTemplate = async (r: Row) => {
    const res = await apiFetch<{ id?: string; data?: { id?: string } }>("/api/agreements", { method: "POST", json: { fromTemplateId: r.id } });
    if (!res.ok) { toast(res.error || "Couldn't create the contract", { tone: "danger" }); return; }
    const id = res.data?.id ?? res.data?.data?.id;
    if (id) router.push(`/agreements/${id}`);
  };
  const voidRow = async (r: Row) => {
    const ok = await confirm({ title: `Void "${r.title}"?`, description: "Signing links stop working. Signatures already given are kept for the record.", confirmLabel: "Void", destructive: true });
    if (ok) await patchRow(r, { action: "void" }, "Voided");
  };
  const archiveRow = async (r: Row) => {
    const ok = await confirm({ title: `Move "${r.title}" to Trash?`, description: `You can restore it within ${boot.org.trashDays} days.`, confirmLabel: "Move to Trash", destructive: true });
    if (ok) await patchRow(r, { archived: true }, "Moved to Trash");
  };
  const deleteRow = async (r: Row) => {
    const ok = await confirm({ title: `Delete "${r.title}"?`, description: "This removes it for good.", confirmLabel: "Delete", destructive: true });
    if (!ok) return;
    const res = await apiFetch(`/api/agreements/${r.id}`, { method: "DELETE" });
    if (!res.ok) { toast(res.error || "Couldn't delete", { tone: "danger" }); return; }
    toast("Deleted"); bumpRowVersion("agreements"); void load();
  };
  const renameFolder = async (from: string) => {
    const to = await prompt({ title: "Rename folder", description: from ? `Every contract in "${from}" moves with it.` : "Give the unfiled contracts a folder.", defaultValue: from, submitLabel: "Save", required: false });
    if (to === null || to.trim() === from) return;
    const res = await apiFetch<{ moved?: number; data?: { moved?: number } }>("/api/agreements/rename-folder", { method: "POST", json: { from, to: to.trim() } });
    if (!res.ok) { toast(res.error || "Couldn't rename the folder", { tone: "danger" }); return; }
    toast("Folder renamed"); void loadFolders(); bumpRowVersion("agreements"); void load();
  };
  const exportCsv = () => {
    const header = ["Contract", "Folder", "Status", "Parties", "Signed", "Sent", "Updated"];
    const lines = (payload?.data ?? []).map((r) => [r.title, r.category ?? "", CONTRACT_STATUS_LABEL[r.status], String(r.partyCount), String(r.signedCount), r.sentAt ?? "", r.updatedAt]);
    const csv = [header, ...lines].map((l) => l.map((c) => `"${String(c ?? "").replace(/"/g, '""')}"`).join(",")).join("\n");
    const url = URL.createObjectURL(new Blob([csv], { type: "text/csv" }));
    const a = document.createElement("a"); a.href = url; a.download = isTemplates ? "contract-templates.csv" : "contracts.csv"; a.click(); URL.revokeObjectURL(url);
  };

  const rows = payload?.data ?? null;
  const total = payload?.pagination.total ?? 0;
  const from = total === 0 ? 0 : (page - 1) * 40 + 1;
  const to = Math.min(total, (page - 1) * 40 + (rows?.length ?? 0));
  const [folderMenu, setFolderMenu] = useState<{ name: string; anchor: React.RefObject<HTMLElement | null> } | null>(null);

  const columns = useMemo<TableColumn<Row>[]>(() => {
    const cols: TableColumn<Row>[] = [
      { key: "name", label: "Name", title: true, width: "minmax(220px,2fr)", render: (r) => <span className="inline-flex min-w-0 items-center gap-2"><EntityTile size="sm" fallbackIcon={r.isTemplate ? LayoutTemplate : FileSignature} name={r.title} /><span className="truncate">{r.title}</span></span> },
    ];
    if (group === "none") cols.push({ key: "folder", label: "Folder", width: "minmax(110px,1fr)", render: (r) => r.category ? <span className="truncate text-ink-2">{r.category}</span> : <span className="text-ink-3">Unfiled</span> });
    cols.push({ key: "parties", label: "Parties", width: "150px", render: (r) => <PartyGroup parties={r.parties} roles={r.isTemplate} /> });
    if (isTemplates) {
      cols.push({ key: "used", label: "Used", width: "80px", numeric: true, render: (r) => r.usedCount ?? 0 });
    } else {
      cols.push({ key: "signed", label: "Signed", width: "120px", render: (r) => r.partyCount === 0 ? <span className="text-ink-3">No parties</span> : r.partyCount <= 4 ? <Dots variant="quad-steps" done={r.signedCount} total={r.partyCount} label={`${r.signedCount} of ${r.partyCount} signed`} /> : <span className="tabular-nums text-ink-2">{r.signedCount} of {r.partyCount}</span> });
      cols.push({ key: "status", label: "Status", sortable: true, width: "160px", render: (r) => <StatusChip color={CONTRACT_STATUS_COLOR[r.status]} label={CONTRACT_STATUS_LABEL[r.status]} disabled className="whitespace-nowrap" /> });
    }
    cols.push({ key: "updated", label: "Updated", sortable: true, width: "110px", render: (r) => <span className="tabular-nums text-ink-2" title={fmt.title(r.updatedAt)}>{fmt.date(r.updatedAt)}</span> });
    return cols;
  }, [group, isTemplates, fmt]);

  const groups = useMemo(() => {
    if (!rows || group === "none") return null;
    const m = new Map<string, Row[]>();
    for (const r of rows) { const k = r.category || ""; (m.get(k) ?? m.set(k, []).get(k)!).push(r); }
    return Array.from(m.entries()).sort(([a], [b]) => (a === "" ? 1 : b === "" ? -1 : a.localeCompare(b)));
  }, [rows, group]);

  const clearAll = () => setParams({ q: null, category: null, status: null, party: null, source: null, sentFrom: null, sentTo: null });
  const filteredEmpty = activeFilters > 0;
  const emptyNode = filteredEmpty
    ? <span className="inline-flex items-center gap-2">No results · <button type="button" onClick={clearAll} className="font-medium text-brand-deep hover:underline">Clear filters</button></span>
    : isTemplates ? "No templates yet. Save any contract as a template from its page." : "No contracts yet.";
  const showQuietEmpty = rows !== null && rows.length === 0 && !filteredEmpty && view === "all";
  const countFor = (v: ContractsView) => payload?.counts?.[v] ?? null;

  // One card, whatever the grouping: grouped, each group's TableCard is drawn
  // flush inside ONE bordered card under its own group bar, the same shape
  // /sops uses. Two list surfaces in the same hub must not answer the same
  // question differently (master plan section 2, one page pattern).
  const table = (list: Row[] | null, ariaLabel: string, withFooter: boolean, flush = false) => (
    <TableCard<Row>
      className={flush ? "rounded-none border-0" : undefined}
      ariaLabel={ariaLabel}
      columns={columns}
      rows={list}
      rowKey={(r) => r.id}
      rowHref={(r) => `/agreements/${r.id}`}
      sort={{ key: sort === "name" ? "name" : sort, dir }}
      onSort={(key) => { const k = key === "status" ? "status" : "updated"; setParams(sort === k ? { dir: dir === "asc" ? "desc" : "asc" } : { sort: k === "updated" ? null : k, dir: null }); }}
      onRowContextMenu={(r, e) => { e.preventDefault(); setMenu({ row: r, anchor: { current: e.currentTarget as HTMLElement }, point: { x: e.clientX, y: e.clientY } }); }}
      rowMenu={(r) => <RowMenuTrigger open={menu?.row.id === r.id} onOpen={(ref) => setMenu({ row: r, anchor: ref })} />}
      empty={emptyNode}
      footer={withFooter ? { total, noun: isTemplates ? "templates" : "contracts", from, to, onPrev: page > 1 ? () => setParams({ page: page > 2 ? String(page - 1) : null }, { keepPage: true }) : undefined, onNext: to < total ? () => setParams({ page: String(page + 1) }, { keepPage: true }) : undefined } : undefined}
    />
  );

  return (
    <>
      <Breadcrumb items={isTemplates ? [{ label: "Contracts", href: "/agreements" }, { label: "Contract templates" }] : [{ label: "Contracts" }]} />
      <OsPageHeader
        title={isTemplates ? "Contract templates" : "Contracts"}
        views={CONTRACTS_VIEWS.map((v) => <ViewTab key={v} label={CONTRACTS_VIEW_LABEL[v]} active={view === v} href={contractsViewHref(v)} trailing={countFor(v) ? <span className="text-xs font-medium tabular-nums text-ink-2">{fmt.count(countFor(v))}</span> : undefined} />)}
        toolbar={{
          filter: { open: filterOpen, onToggle: () => setFilterOpen((o) => !o), count: activeFilters },
          sort: { onClick: () => setSortOpen((o) => !o), label: CONTRACTS_SORTS.find((s) => s.key === sort)?.label, active: sort !== "updated" },
          group: { onClick: () => setGroupOpen((o) => !o), label: group === "folder" ? "Folder" : "None", active: group !== "none" },
          switcher: { value: viewType, options: [{ key: "list", label: "List", icon: ListIcon }, { key: "cards", label: "Cards", icon: LayoutGrid }], onChange: (k) => void patchPrefs({ home: { ui: { contractsViewType: k === "cards" ? "cards" : "list" } } }) },
          left: (
            <span className="relative">
              <Picker open={sortOpen} onClose={() => setSortOpen(false)} ariaLabel="Sort contracts" selected={sort} onSelect={(v) => { setSortOpen(false); setParams(v === sort ? { dir: dir === "asc" ? "desc" : "asc" } : { sort: v === "updated" ? null : v, dir: null }); }} sections={[{ options: CONTRACTS_SORTS.map((s) => ({ value: s.key, label: s.label })) }]} width={200} />
              <Picker open={groupOpen} onClose={() => setGroupOpen(false)} ariaLabel="Group contracts" selected={group} onSelect={(v) => { setGroupOpen(false); setParams({ group: v === "folder" ? null : v }); }} sections={[{ options: [{ value: "folder", label: "Folder" }, { value: "none", label: "None" }] }]} width={200} />
            </span>
          ),
          primary: isTemplates
            ? { label: "New template", onClick: () => setNewOpen({ source: "write" }), split: { label: "Upload a PDF", onClick: () => setNewOpen({ source: "pdf" }) } }
            : { label: "New contract", onClick: () => setNewOpen({ source: "write" }), split: { label: "From template…", onClick: () => setNewOpen({ source: "template" }) } },
          menu: [
            { label: "Organize folders", icon: FolderInput, href: "/sops/manage?tab=contract-folders" },
            ...(!boot.viewer.isAgent ? [{ label: "Export CSV", icon: Download, onClick: exportCsv }] : []),
          ],
        }}
      />

      <div className="os-chrome flex min-h-0 flex-1 gap-4 px-6 pb-6 pt-2">
        <FilterPanel open={filterOpen} onClose={() => setFilterOpen(false)} objects="contracts" activeCount={activeFilters} onClearAll={clearAll}>
          <li className="pb-2"><SearchField inputRef={searchRef} value={q} onChange={(v) => setParams({ q: v || null })} placeholder="Search contracts" /></li>
          <FilterGroup label="Folder">
            <FilterRow label="Filter by folder" checked={!!category} onCheckedChange={(on) => { if (!on) setParams({ category: null }); else setFolderOpen(true); }}>
              <span className="relative block">
                <button type="button" onClick={() => setFolderOpen((o) => !o)} className="inline-flex h-8 max-w-full items-center rounded-md border border-line-strong bg-raised px-2 text-sm text-ink"><span className="truncate">{category ? (category === "__none__" ? "Unfiled" : category) : <span className="text-ink-3">Choose a folder</span>}</span></button>
                <Picker open={folderOpen} onClose={() => setFolderOpen(false)} ariaLabel="Folder" searchPlaceholder="Find a folder" selected={category} onSelect={(v) => { setParams({ category: v }); setFolderOpen(false); }} sections={[{ options: [{ value: "__none__", label: "Unfiled" }, ...(folders ?? []).map((f) => ({ value: f, label: f }))] }]} />
              </span>
            </FilterRow>
          </FilterGroup>
          {!isTemplates ? (
            <FilterGroup label="Status">
              {CONTRACT_STATUSES.map((s) => <FilterRow key={s} label={CONTRACT_STATUS_LABEL[s]} checked={status === s} onCheckedChange={(on) => setParams({ status: on ? s : null })} />)}
            </FilterGroup>
          ) : null}
          <FilterGroup label="Party">
            <FilterRow label="Name or email" checked={!!party} onCheckedChange={(on) => { if (!on) setParams({ party: null }); }}>
              <SearchField value={party} onChange={(v) => setParams({ party: v || null })} placeholder="Party name or email" inputRef={{ current: null }} />
            </FilterRow>
          </FilterGroup>
          {!isTemplates ? (
            <FilterGroup label="Sent">
              <FilterRow label="Date range" checked={!!(sentFrom || sentTo)} onCheckedChange={(on) => { if (!on) setParams({ sentFrom: null, sentTo: null }); else setParams({ sentFrom: new Date(Date.now() - 30 * 86_400_000).toISOString().slice(0, 10) }); }}>
                <div className="flex flex-col gap-1.5">
                  <span className="flex items-center gap-2 text-sm text-ink-2"><span className="w-9 shrink-0">From</span><DateField size="sm" value={sentFrom} onChange={(v) => setParams({ sentFrom: v })} placeholder="Any" ariaLabel="From" className="min-w-0 flex-1" /></span>
                  <span className="flex items-center gap-2 text-sm text-ink-2"><span className="w-9 shrink-0">To</span><DateField size="sm" value={sentTo ? sentTo.slice(0, 10) : null} onChange={(v) => setParams({ sentTo: v ? `${v}T23:59:59` : null })} placeholder="Any" ariaLabel="To" className="min-w-0 flex-1" /></span>
                </div>
              </FilterRow>
            </FilterGroup>
          ) : null}
          <FilterGroup label="Source">
            <FilterRow label="Written" checked={source === "blocknote"} onCheckedChange={(on) => setParams({ source: on ? "blocknote" : null })} />
            <FilterRow label="PDF" checked={source === "pdf"} onCheckedChange={(on) => setParams({ source: on ? "pdf" : null })} />
          </FilterGroup>
        </FilterPanel>

        <div className="flex min-w-0 flex-1 flex-col gap-4">
          {loadError ? (
            <OsEmptyView variant="error" context="docs" title="Couldn't load contracts" action={{ label: "Retry", onClick: () => void load() }} />
          ) : showQuietEmpty ? (
            <OsEmptyView context="docs" title="No contracts yet." action={{ label: "Create your first contract", onClick: () => setNewOpen({ source: "write" }) }} />
          ) : viewType === "cards" ? (
            <CardsGrid rows={rows} groups={groups} empty={emptyNode} onMenu={(r, ref) => setMenu({ row: r, anchor: ref })} fmt={fmt} />
          ) : groups && groups.length > 1 ? (
            <div className="overflow-hidden rounded-lg border border-line bg-raised">
              {groups.map(([name, list], i, all) => (
                <div key={name || "__unfiled"} className={cn("flex flex-col", i > 0 ? "border-t border-line" : "")}>
                  <div className="group/h flex h-11 items-center gap-2 bg-subtle px-3">
                    <span className="min-w-0 truncate text-row font-medium text-ink">{name || "Unfiled"}</span>
                    <span className="text-xs font-medium tabular-nums text-ink-2">{list.length}</span>
                    <FolderMenuTrigger open={folderMenu?.name === name} onOpen={(ref) => setFolderMenu({ name, anchor: ref })} />
                  </div>
                  {table(list, name || "Unfiled", i === all.length - 1, true)}
                </div>
              ))}
            </div>
          ) : (
            table(rows, CONTRACTS_VIEW_LABEL[view], true)
          )}
        </div>
      </div>

      {menu ? (
        <MorePortal anchorRef={menu.anchor} width={240} open onClose={() => setMenu(null)} placement="below" point={menu.point ?? null}>
          <MenuList onClick={() => setMenu(null)}>
            <MenuItem icon={ExternalLink} label="Open" onClick={() => router.push(`/agreements/${menu.row.id}`)} />
            <MenuItem icon={Pencil} label="Rename" onClick={() => void rename(menu.row)} />
            <MenuItem icon={FolderInput} label="Move to folder…" onClick={() => setMoveFor({ row: menu.row, point: pointFromMenu(menu) })} />
            <MenuItem icon={Copy} label="Duplicate" busy={busyId === menu.row.id} onClick={() => void duplicate(menu.row)} />
            {menu.row.isTemplate ? <MenuItem icon={FileSignature} label="Use template" onClick={() => void createFromTemplate(menu.row)} /> : <MenuItem icon={LayoutTemplate} label="Save as template" onClick={() => void saveAsTemplate(menu.row)} />}
            {!menu.row.isTemplate && (menu.row.status === "SENT" || menu.row.status === "PARTIALLY_SIGNED") ? <><MenuSeparator /><MenuItem icon={XCircle} label="Void" onClick={() => void voidRow(menu.row)} /></> : null}
            <MenuSeparator />
            <MenuItem icon={Archive} label="Archive" onClick={() => void archiveRow(menu.row)} />
            {isAdmin && (menu.row.isTemplate || menu.row.status === "DRAFT") ? <MenuItem icon={Trash2} label="Delete" destructive onClick={() => void deleteRow(menu.row)} /> : null}
          </MenuList>
        </MorePortal>
      ) : null}
      {folderMenu ? (
        <MorePortal anchorRef={folderMenu.anchor} width={200} open onClose={() => setFolderMenu(null)} placement="below">
          <MenuList onClick={() => setFolderMenu(null)}>
            <MenuItem icon={Pencil} label="Rename folder" onClick={() => void renameFolder(folderMenu.name)} />
          </MenuList>
        </MorePortal>
      ) : null}
      {moveFor ? (
        <Picker open onClose={() => setMoveFor(null)} ariaLabel="Move to folder" searchPlaceholder="Find a folder" anchorPoint={moveFor.point ?? { top: 80, left: 80 }} selected={moveFor.row.category ?? "__none__"} onSelect={(v) => void moveTo(moveFor.row, v === "__none__" ? null : v)} sections={[{ options: [{ value: "__none__", label: "Unfiled" }, ...(folders ?? []).map((f) => ({ value: f, label: f }))] }]} width={280} />
      ) : null}
      <NewContractDialog open={newOpen !== null} onClose={() => setNewOpen(null)} folders={folders ?? []} isTemplate={isTemplates} initialSource={newOpen?.source ?? "write"} onCreated={() => bumpRowVersion("agreements")} />
    </>
  );
}

function PartyGroup({ parties, roles }: { parties: Party[]; roles: boolean }) {
  const ordered = [...parties].sort((a, b) => a.order - b.order);
  if (ordered.length === 0) return <span className="text-ink-3">None</span>;
  if (roles) return <span className="truncate text-sm text-ink-2">{ordered.map((p) => p.role.replace("_", " ").toLowerCase()).join(", ")}</span>;
  const shown = ordered.slice(0, 3);
  return (
    <span className="inline-flex items-center">
      {shown.map((p, i) => (
        <span key={p.id} title={`${p.name}${p.email ? ` · ${p.email}` : ""}`} className={cn("inline-flex h-6 w-6 items-center justify-center rounded-full border border-raised bg-active text-xs font-medium text-ink", i > 0 ? "-ms-1.5" : "")}>{(p.name || "?").trim().slice(0, 1).toUpperCase()}</span>
      ))}
      <span className="ms-1.5 text-sm tabular-nums text-ink-2">{ordered.length}</span>
    </span>
  );
}

function CardsGrid({ rows, groups, empty, onMenu, fmt }: { rows: Row[] | null; groups: Array<[string, Row[]]> | null; empty: React.ReactNode; onMenu: (r: Row, ref: React.RefObject<HTMLButtonElement | null>) => void; fmt: ReturnType<typeof useFormat> }) {
  if (rows === null) return <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">{Array.from({ length: 6 }).map((_, i) => <div key={i} className="h-[120px] rounded-lg border border-line bg-raised" />)}</div>;
  if (rows.length === 0) return <div className="flex h-11 items-center rounded-lg border border-line bg-raised px-4 text-row text-ink-2">{empty}</div>;
  const sections = groups ?? [["", rows] as [string, Row[]]];
  return (
    <div className="flex flex-col gap-4">
      {sections.map(([name, list]) => (
        <section key={name || "__all"} className="flex flex-col gap-2">
          {groups ? <h2 className="flex items-center gap-2 text-row font-medium text-ink">{name || "Unfiled"}<span className="text-xs font-medium tabular-nums text-ink-2">{list.length}</span></h2> : null}
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
            {list.map((r) => <ContractCard key={r.id} r={r} onMenu={onMenu} fmt={fmt} />)}
          </div>
        </section>
      ))}
    </div>
  );
}

function ContractCard({ r, onMenu, fmt }: { r: Row; onMenu: (r: Row, ref: React.RefObject<HTMLButtonElement | null>) => void; fmt: ReturnType<typeof useFormat> }) {
  const ref = useRef<HTMLButtonElement>(null);
  return (
    <div className="group/card relative flex min-h-[120px] flex-col gap-2 rounded-lg border border-line bg-raised p-3 hover:bg-hover">
      <Link href={`/agreements/${r.id}`} className="flex min-w-0 items-start gap-2">
        <EntityTile size="sm" fallbackIcon={r.isTemplate ? LayoutTemplate : FileSignature} name={r.title} />
        <span className="line-clamp-2 min-w-0 flex-1 text-row font-medium text-ink">{r.title}</span>
      </Link>
      <span className="text-sm text-ink-2">{r.category ?? "Unfiled"} · {fmt.date(r.updatedAt)}</span>
      <div className="mt-auto flex items-center gap-2">
        {r.isTemplate ? <span className="text-xs text-ink-2">Used {r.usedCount ?? 0} {r.usedCount === 1 ? "time" : "times"}</span> : <StatusChip color={CONTRACT_STATUS_COLOR[r.status]} label={CONTRACT_STATUS_LABEL[r.status]} disabled />}
        <span className="ms-auto"><PartyGroup parties={r.parties} roles={r.isTemplate} /></span>
        <span className="os-tc__more"><RowMoreButton buttonRef={ref} onClick={() => onMenu(r, ref)} label="Contract actions" /></span>
      </div>
    </div>
  );
}

function SearchField({ value, onChange, placeholder, inputRef }: { value: string; onChange: (v: string) => void; placeholder: string; inputRef: React.MutableRefObject<HTMLInputElement | null> }) {
  const [draft, setDraft] = useState(value);
  const [seen, setSeen] = useState(value);
  if (seen !== value) { setSeen(value); setDraft(value); }
  useEffect(() => {
    if (draft === value) return;
    const t = setTimeout(() => onChange(draft.trim()), 300);
    return () => clearTimeout(t);
  }, [draft, value, onChange]);
  return <input ref={inputRef} type="search" value={draft} onChange={(e) => setDraft(e.target.value)} onKeyDown={(e) => { if (e.key === "Escape") { e.stopPropagation(); (e.currentTarget as HTMLInputElement).blur(); } }} placeholder={placeholder} aria-label={placeholder} className="h-9 w-full rounded-md border border-line-strong bg-raised px-3 text-base text-ink placeholder:text-ink-3 focus:outline-none focus-visible:border-brand" />;
}

function RowMenuTrigger({ onOpen, open }: { onOpen: (ref: React.RefObject<HTMLButtonElement | null>) => void; open?: boolean }) {
  const ref = useRef<HTMLButtonElement>(null);
  return <RowMoreButton buttonRef={ref} open={open} onClick={() => onOpen(ref)} label="Contract actions" />;
}
function FolderMenuTrigger({ onOpen, open }: { onOpen: (ref: React.RefObject<HTMLButtonElement | null>) => void; open?: boolean }) {
  const ref = useRef<HTMLButtonElement>(null);
  return <span className="os-tc__more"><RowMoreButton buttonRef={ref} open={open} onClick={() => onOpen(ref)} label="Folder actions" /></span>;
}
