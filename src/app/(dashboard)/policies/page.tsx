"use client";

/* /policies, "Policies" (spec-process section 2): the company's policies,
 * which ones I still have to acknowledge, and (for the People team and
 * admins) the drafts.
 *
 *   header   views All · Needs my acknowledgement (count) · Published ·
 *            Drafts · Archived (the last two for FULL viewers; a pasted
 *            ?view= a Member cannot hold renders All with the parameter
 *            stripped and one notice line, never a 404); toolbar Filter
 *            (search, Category, Status, Effective date, Acknowledged by me),
 *            Sort, Group (Category · None), list / cards; the one blue
 *            "New policy" (FULL) opening the New policy modal; "…" Display,
 *            Organize categories, Export CSV
 *   body     TableCard: Name · Category · Status · Effective · Acknowledged
 *            (org rate, FULL) · My acknowledgement · Updated · row "…"
 *            (Open, Edit, Assign…, Acknowledgements, Copy link, Archive,
 *            Delete); an inline "Acknowledge" on Needs-view rows
 *
 *   GET /api/policies?view=&category=&q=&sort=&dir=&page=
 *
 * Every Member reaches it; Guests get the in-shell 404.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Archive, BookOpenCheck, Download, Edit3, ExternalLink, LayoutGrid, Link2, List as ListIcon, ShieldCheck, SlidersHorizontal, Trash2, UserPlus } from "lucide-react";
import { Breadcrumb } from "@/components/layout/os/top-bar/breadcrumb";
import { OsPageHeader } from "@/components/layout/os/page-header";
import { OsEmptyView } from "@/components/layout/os/empty-view";
import { NotFoundView } from "@/components/access/not-found-view";
import { useOsShell } from "@/components/layout/os/shell-context";
import { useOsToast } from "@/components/layout/os/toast";
import { useBoot } from "@/components/layout/os/boot-context";
import { useConfirm } from "@/components/ui/dialog-provider";
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
import { AssignDialog } from "@/components/process/assign-dialog";
import { NewPolicyDialog } from "@/components/policies/new-policy-dialog";
import { useRole } from "@/hooks/use-role";
import { apiFetch } from "@/lib/api-fetch";
import { useFormat } from "@/lib/format/use-date-prefs";
import {
  POLICIES_SORTS, POLICIES_VIEW_LABEL, POLICY_STATUS_COLOR, POLICY_STATUS_LABEL, allowedPolicyViews, defaultSortDir, myAckState, parsePoliciesGroup, parsePoliciesSort, resolvePolicyView,
  type PoliciesView, type PolicyStatus,
} from "@/lib/policies-list";
import { cn } from "@/lib/utils";

type Row = {
  id: string; title: string; category: string | null; version: number; status: PolicyStatus; requiresAck: boolean;
  effectiveDate: string | null; updatedAt: string; acknowledged: boolean; needsMyAck: boolean;
  myAssignment: { id: string; status: string; dueDate: string | null; mandatory: boolean } | null;
  ackRate: number | null; totalAcks: number | null; totalUsers: number | null; assignedCount: number | null;
};
type Payload = { data: Row[]; pagination: { total: number; totalPages: number }; counts: { all: number; published: number; drafts: number; archived: number; needsAck: number }; canManage: boolean; view: PoliciesView };

export default function PoliciesPage() {
  const router = useRouter();
  const params = useSearchParams();
  const { rowVersion, bumpRowVersion, prefs, patchPrefs } = useOsShell();
  const { boot } = useBoot();
  const { toast } = useOsToast();
  const confirm = useConfirm();
  const fmt = useFormat();
  const { isManager, isAdmin, canManagePolicies } = useRole();

  const isGuest = boot.viewer.orgRole === "GUEST";
  const [payload, setPayload] = useState<Payload | null>(null);
  const canManage = payload?.canManage ?? isManager;
  const requestedView = params.get("view");
  const resolved = useMemo(() => resolvePolicyView(requestedView, canManage), [requestedView, canManage]);
  const view = resolved.view;
  const [notice, setNotice] = useState<string | null>(null);
  useEffect(() => {
    if (!resolved.strip || payload === null) return;
    const t = setTimeout(() => {
      if (resolved.notice) setNotice(resolved.notice);
      const next = new URLSearchParams(params.toString());
      next.delete("view");
      const s = next.toString();
      router.replace(s ? `/policies?${s}` : "/policies");
    }, 0);
    return () => clearTimeout(t);
  }, [resolved.strip, resolved.notice, params, router, payload]);

  const q = params.get("q") ?? "";
  const category = params.get("category");
  const status = params.get("status");
  const effFrom = params.get("effFrom"); const effTo = params.get("effTo");
  const ackedByMe = params.get("acked") === "1";
  const sort = parsePoliciesSort(params.get("sort"));
  const dir: "asc" | "desc" = params.get("dir") === "asc" || params.get("dir") === "desc" ? (params.get("dir") as "asc" | "desc") : defaultSortDir(sort);
  const group = parsePoliciesGroup(params.get("group"));
  const page = Math.max(1, Number(params.get("page")) || 1);
  const viewType = prefs.home.ui?.policiesViewType === "cards" ? "cards" : "list";
  const setParams = useCallback((patch: Record<string, string | null>, opts?: { keepPage?: boolean }) => {
    const next = new URLSearchParams(params.toString());
    for (const [k, v] of Object.entries(patch)) { if (v === null || v === "") next.delete(k); else next.set(k, v); }
    if (!opts?.keepPage) next.delete("page");
    const s = next.toString();
    router.push(s ? `/policies?${s}` : "/policies");
  }, [params, router]);
  const activeFilters = [q, category, status, effFrom || effTo ? "e" : null, ackedByMe ? "a" : null].filter(Boolean).length;

  const [loadError, setLoadError] = useState(false);
  const qs = useMemo(() => {
    const p = new URLSearchParams({ view, sort, dir, page: String(page), pageSize: "40" });
    if (q) p.set("q", q);
    if (category) p.set("category", category);
    if (status) p.set("status", status);
    if (effFrom) p.set("effFrom", effFrom);
    if (effTo) p.set("effTo", effTo);
    if (ackedByMe) p.set("acked", "1");
    return p.toString();
  }, [view, sort, dir, page, q, category, status, effFrom, effTo, ackedByMe]);
  const load = useCallback(async () => {
    const r = await apiFetch<Payload | { data: Payload }>(`/api/policies?${qs}`, { cache: "no-store" });
    if (!r.ok) { setLoadError(true); return; }
    setLoadError(false);
    const d = r.data as Payload & { data: Payload | Row[] };
    setPayload(Array.isArray(d.data) ? (d as Payload) : (d.data as Payload));
  }, [qs]);
  useEffect(() => { const t = setTimeout(() => void load(), 0); return () => clearTimeout(t); }, [load]);
  const rv = rowVersion("policies");
  useEffect(() => { if (rv <= 0) return; const t = setTimeout(() => void load(), 0); return () => clearTimeout(t); }, [rv, load]);
  useEffect(() => {
    const onFocus = () => { void load(); };
    window.addEventListener("focus", onFocus);
    return () => window.removeEventListener("focus", onFocus);
  }, [load]);

  /* New policy (?new=1 from the Docs "+" menu) */
  const [newOpen, setNewOpen] = useState(false);

  /* Filter panel, categories */
  const [filterOpen, setFilterOpen] = useState(false);
  const [sortOpen, setSortOpen] = useState(false);
  const [groupOpen, setGroupOpen] = useState(false);
  const [catOpen, setCatOpen] = useState(false);
  const [categories, setCategories] = useState<string[] | null>(null);
  const loadCategories = useCallback(async () => {
    const r = await apiFetch<{ process?: { policyCategories?: string[] } }>("/api/settings/process", { cache: "no-store" });
    setCategories(r.ok ? r.data.process?.policyCategories ?? [] : []);
  }, []);
  useEffect(() => { const t = setTimeout(() => void loadCategories(), 0); return () => clearTimeout(t); }, [loadCategories]);
  const searchRef = useRef<HTMLInputElement | null>(null);
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      const el = document.activeElement as HTMLElement | null;
      const typing = !!el && (el.tagName === "INPUT" || el.tagName === "TEXTAREA" || el.isContentEditable);
      if ((e.key === "/" && !typing && !e.metaKey && !e.ctrlKey) || ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "f" && !typing)) {
        e.preventDefault(); setFilterOpen(true); setTimeout(() => searchRef.current?.focus(), 50);
      }
      if (e.key === "n" && !typing && !e.metaKey && !e.ctrlKey && !e.altKey && canManagePolicies) { e.preventDefault(); setNewOpen(true); }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [canManagePolicies]);

  const newArmed = useRef(true);
  useEffect(() => {
    if (params.get("new") !== "1") { newArmed.current = true; return; }
    if (!newArmed.current || !canManagePolicies) return;
    newArmed.current = false;
    const next = new URLSearchParams(params.toString()); next.delete("new");
    const s = next.toString();
    const t = setTimeout(() => { router.replace(s ? `/policies?${s}` : "/policies", { scroll: false }); setNewOpen(true); }, 0);
    return () => clearTimeout(t);
  }, [params, router, canManagePolicies]);

  /* Row menu and actions */
  const [menu, setMenu] = useState<{ row: Row; anchor: React.RefObject<HTMLElement | null>; point?: { x: number; y: number } } | null>(null);
  const [assignFor, setAssignFor] = useState<Row | null>(null);
  const [display, setDisplay] = useState<{ effective: boolean; rate: boolean }>({ effective: true, rate: true });
  const copyLink = (r: Row) => { void navigator.clipboard.writeText(`${window.location.origin}/policies/${r.id}`).then(() => toast("Link copied"), () => toast("Couldn't copy the link", { tone: "danger" })); };
  const archive = async (r: Row) => {
    const ok = await confirm({ title: `Archive "${r.title}"?`, description: "It leaves the list people see. Acknowledgements are kept, and you can find it under Archived.", confirmLabel: "Archive", destructive: true });
    if (!ok) return;
    const res = await apiFetch(`/api/policies/${r.id}`, { method: "PATCH", json: { status: "ARCHIVED" } });
    if (!res.ok) { toast(res.error || "Couldn't archive", { tone: "danger" }); return; }
    toast("Policy archived"); bumpRowVersion("policies"); void load();
  };
  const remove = async (r: Row) => {
    const ok = await confirm({ title: `Delete "${r.title}"?`, description: `It moves to Trash and can be restored within ${boot.org.trashDays} days.`, confirmLabel: "Delete", destructive: true });
    if (!ok) return;
    const res = await apiFetch(`/api/policies/${r.id}`, { method: "DELETE" });
    if (!res.ok) { toast(res.error || "Couldn't delete", { tone: "danger" }); return; }
    toast("Moved to Trash"); bumpRowVersion("policies"); void load();
  };
  const exportCsv = () => {
    const header = ["Policy", "Category", "Status", "Version", "Effective", "Updated", "Acknowledged"];
    const lines = (payload?.data ?? []).map((r) => [r.title, r.category ?? "", POLICY_STATUS_LABEL[r.status], String(r.version), r.effectiveDate ?? "", r.updatedAt, r.totalAcks !== null && r.totalUsers !== null ? `${r.totalAcks} of ${r.totalUsers}` : ""]);
    const csv = [header, ...lines].map((l) => l.map((c) => `"${String(c ?? "").replace(/"/g, '""')}"`).join(",")).join("\n");
    const url = URL.createObjectURL(new Blob([csv], { type: "text/csv" }));
    const a = document.createElement("a"); a.href = url; a.download = "policies.csv"; a.click(); URL.revokeObjectURL(url);
  };

  // Every facet is server-side (spec-process section 1): the rows and the
  // footer total are the API's answer, never a client filter over one page.
  const rows = payload?.data ?? null;
  const total = payload?.pagination.total ?? 0;
  const from = total === 0 ? 0 : (page - 1) * 40 + 1;
  const to = Math.min(total, (page - 1) * 40 + (rows?.length ?? 0));
  const allowed = allowedPolicyViews(canManage);
  const countFor = (v: PoliciesView) => { const c = payload?.counts; if (!c) return null; return v === "all" ? c.all : v === "needs-ack" ? c.needsAck : v === "published" ? c.published : v === "drafts" ? c.drafts : c.archived; };

  const columns = useMemo<TableColumn<Row>[]>(() => {
    const cols: TableColumn<Row>[] = [
      { key: "name", label: "Name", title: true, width: "minmax(220px,2fr)", render: (r) => <span className="inline-flex min-w-0 items-center gap-2"><EntityTile size="sm" fallbackIcon={BookOpenCheck} name={r.title} /><span className="truncate">{r.title}</span></span> },
    ];
    if (group === "none") cols.push({ key: "category", label: "Category", width: "minmax(120px,1fr)", render: (r) => r.category ? <span className="truncate text-ink-2">{r.category}</span> : <span className="text-ink-3">None</span> });
    cols.push({ key: "status", label: "Status", width: "110px", render: (r) => <StatusChip color={POLICY_STATUS_COLOR[r.status]} label={POLICY_STATUS_LABEL[r.status]} disabled /> });
    if (display.effective) cols.push({ key: "effective", label: "Effective", sortable: true, width: "110px", render: (r) => r.effectiveDate ? <span className="tabular-nums text-ink-2" title={fmt.title(r.effectiveDate)}>{fmt.date(r.effectiveDate, "date")}</span> : <span className="text-ink-3">Not set</span> });
    if (canManage && display.rate) cols.push({ key: "acked", label: "Acknowledged", width: "120px", numeric: true, render: (r) => r.requiresAck && r.totalAcks !== null && r.totalUsers !== null && r.status === "PUBLISHED" ? <span className="tabular-nums">{r.totalAcks} of {r.totalUsers}</span> : "" });
    cols.push({
      key: "mine", label: "My acknowledgement", width: "170px",
      render: (r) => {
        const s = myAckState({ requiresAck: r.requiresAck, status: r.status, assigned: !!r.myAssignment, acknowledged: r.acknowledged });
        if (!s.required) return <span className="text-ink-3">Not required</span>;
        return <span className="inline-flex items-center gap-2"><Dots variant="quad-steps" done={s.done} total={2} label={s.done === 2 ? "Acknowledged" : s.done === 1 ? "Assigned, not acknowledged" : "Not acknowledged"} /><span className="text-sm text-ink-2">{s.done === 2 ? "Acknowledged" : s.done === 1 ? "Assigned" : "Open"}</span></span>;
      },
    });
    cols.push({ key: "updated", label: "Updated", sortable: true, width: "110px", render: (r) => <span className="tabular-nums text-ink-2" title={fmt.title(r.updatedAt)}>{fmt.date(r.updatedAt)}</span> });
    if (view === "needs-ack") cols.push({ key: "action", label: "", width: "120px", render: (r) => <button type="button" onClick={(e) => { e.preventDefault(); e.stopPropagation(); router.push(`/policies/${r.id}#acknowledge`); }} className="inline-flex h-7 items-center rounded-md border border-line bg-raised px-2.5 text-sm font-medium text-ink hover:bg-hover">Acknowledge</button> });
    return cols;
  }, [group, display, canManage, view, fmt, router]);

  const groups = useMemo(() => {
    if (!rows || group === "none") return null;
    const m = new Map<string, Row[]>();
    for (const r of rows) { const k = r.category || "Uncategorized"; (m.get(k) ?? m.set(k, []).get(k)!).push(r); }
    return Array.from(m.entries()).sort(([a], [b]) => (a === "Uncategorized" ? 1 : b === "Uncategorized" ? -1 : a.localeCompare(b)));
  }, [rows, group]);

  if (isGuest) return <NotFoundView />;

  const filteredEmpty = activeFilters > 0;
  const clearAll = () => setParams({ q: null, category: null, status: null, effFrom: null, effTo: null, acked: null });
  const emptyNode = filteredEmpty
    ? <span className="inline-flex items-center gap-2">No results · <button type="button" onClick={clearAll} className="font-medium text-brand-deep hover:underline">Clear filters</button></span>
    : view === "needs-ack" ? "You're up to date." : "No policies published yet.";
  const showQuietEmpty = rows !== null && rows.length === 0 && !filteredEmpty && view === "all";
  const menuEntries = [
    { label: display.effective ? "Hide effective date" : "Show effective date", icon: SlidersHorizontal, onClick: () => setDisplay((d) => ({ ...d, effective: !d.effective })) },
    ...(canManage ? [{ label: display.rate ? "Hide acknowledgement rate" : "Show acknowledgement rate", icon: SlidersHorizontal, onClick: () => setDisplay((d) => ({ ...d, rate: !d.rate })) }] : []),
    ...(canManage ? [{ separator: true as const }, { label: "Organize categories", icon: ShieldCheck, href: "/sops/manage?tab=policy-categories" }] : []),
    ...(!boot.viewer.isAgent ? [{ label: "Export CSV", icon: Download, onClick: exportCsv }] : []),
  ];

  // One card, whatever the grouping. Ungrouped it is a plain TableCard;
  // grouped, each group's TableCard is drawn flush (rounded-none border-0)
  // inside ONE bordered card under its own group bar, exactly as /sops does
  // it. Two list surfaces in the same hub must not answer the same question
  // with two different shapes (master plan section 2, one page pattern).
  const table = (list: Row[] | null, ariaLabel: string, withFooter: boolean, flush = false) => (
    <TableCard<Row>
      className={flush ? "rounded-none border-0" : undefined}
      ariaLabel={ariaLabel}
      columns={columns}
      rows={list}
      rowKey={(r) => r.id}
      rowHref={(r) => `/policies/${r.id}`}
      sort={{ key: sort === "effective" ? "effective" : sort === "updated" ? "updated" : sort, dir }}
      onSort={(key) => { const k = key === "effective" ? "effective" : "updated"; setParams(sort === k ? { dir: dir === "asc" ? "desc" : "asc" } : { sort: k === "updated" ? null : k, dir: null }); }}
      onRowContextMenu={(r, e) => { e.preventDefault(); setMenu({ row: r, anchor: { current: e.currentTarget as HTMLElement }, point: { x: e.clientX, y: e.clientY } }); }}
      rowMenu={(r) => <RowMenuTrigger open={menu?.row.id === r.id} onOpen={(ref) => setMenu({ row: r, anchor: ref })} />}
      empty={emptyNode}
      footer={withFooter ? { total, noun: "policies", from, to, onPrev: page > 1 ? () => setParams({ page: page > 2 ? String(page - 1) : null }, { keepPage: true }) : undefined, onNext: to < total ? () => setParams({ page: String(page + 1) }, { keepPage: true }) : undefined } : undefined}
    />
  );

  return (
    <>
      <Breadcrumb items={[{ label: "Policies" }]} />
      <OsPageHeader
        title="Policies"
        views={allowed.map((v) => (
          <ViewTab key={v} label={POLICIES_VIEW_LABEL[v]} active={view === v} onClick={() => { setNotice(null); setParams({ view: v === "all" ? null : v }); }}
            trailing={v === "needs-ack" && countFor(v) ? <span className="text-xs font-medium tabular-nums text-ink-2">{fmt.count(countFor(v))}</span> : undefined} />
        ))}
        toolbar={{
          filter: { open: filterOpen, onToggle: () => setFilterOpen((o) => !o), count: activeFilters },
          sort: { onClick: () => setSortOpen((o) => !o), label: POLICIES_SORTS.find((s) => s.key === sort)?.label, active: sort !== "updated" },
          group: { onClick: () => setGroupOpen((o) => !o), label: group === "category" ? "Category" : "None", active: group !== "none" },
          switcher: { value: viewType, options: [{ key: "list", label: "List", icon: ListIcon }, { key: "cards", label: "Cards", icon: LayoutGrid }], onChange: (k) => void patchPrefs({ home: { ui: { policiesViewType: k === "cards" ? "cards" : "list" } } }) },
          left: (
            <span className="relative">
              <Picker open={sortOpen} onClose={() => setSortOpen(false)} ariaLabel="Sort policies" selected={sort} onSelect={(v) => { setSortOpen(false); setParams(v === sort ? { dir: dir === "asc" ? "desc" : "asc" } : { sort: v === "updated" ? null : v, dir: null }); }} sections={[{ options: POLICIES_SORTS.map((s) => ({ value: s.key, label: s.label })) }]} width={200} />
              <Picker open={groupOpen} onClose={() => setGroupOpen(false)} ariaLabel="Group policies" selected={group} onSelect={(v) => { setGroupOpen(false); setParams({ group: v === "category" ? null : v }); }} sections={[{ options: [{ value: "category", label: "Category" }, { value: "none", label: "None" }] }]} width={200} />
            </span>
          ),
          primary: canManagePolicies ? { label: "New policy", onClick: () => setNewOpen(true) } : undefined,
          menu: menuEntries,
        }}
      />
      {notice ? <p className="os-chrome px-6 pt-1 text-sm text-ink-2">{notice}</p> : null}

      <div className="os-chrome flex min-h-0 flex-1 gap-4 px-6 pb-6 pt-2">
        <FilterPanel open={filterOpen} onClose={() => setFilterOpen(false)} objects="policies" activeCount={activeFilters} onClearAll={clearAll}>
          <li className="pb-2"><SearchField inputRef={searchRef} value={q} onChange={(v) => setParams({ q: v || null })} placeholder="Search policies" /></li>
          <FilterGroup label="Category">
            <FilterRow label="Filter by category" checked={!!category} onCheckedChange={(on) => { if (!on) setParams({ category: null }); else setCatOpen(true); }}>
              <span className="relative block">
                <button type="button" onClick={() => setCatOpen((o) => !o)} className="inline-flex h-8 max-w-full items-center rounded-md border border-line-strong bg-raised px-2 text-sm text-ink"><span className="truncate">{category ? (category === "__none__" ? "Uncategorized" : category) : <span className="text-ink-3">Choose a category</span>}</span></button>
                <Picker open={catOpen} onClose={() => setCatOpen(false)} ariaLabel="Category" searchPlaceholder="Find a category" selected={category} onSelect={(v) => { setParams({ category: v }); setCatOpen(false); }} sections={[{ options: [{ value: "__none__", label: "Uncategorized" }, ...(categories ?? []).map((c) => ({ value: c, label: c }))] }]} />
              </span>
            </FilterRow>
          </FilterGroup>
          {canManage ? (
            <FilterGroup label="Status">
              {(["PUBLISHED", "DRAFT", "ARCHIVED"] as PolicyStatus[]).map((s) => <FilterRow key={s} label={POLICY_STATUS_LABEL[s]} checked={status === s} onCheckedChange={(on) => setParams({ status: on ? s : null })} />)}
            </FilterGroup>
          ) : null}
          <FilterGroup label="Effective date">
            <FilterRow label="Date range" checked={!!(effFrom || effTo)} onCheckedChange={(on) => { if (!on) setParams({ effFrom: null, effTo: null }); else setParams({ effFrom: new Date().toISOString().slice(0, 10) }); }}>
              <div className="flex flex-col gap-1.5">
                <span className="flex items-center gap-2 text-sm text-ink-2"><span className="w-9 shrink-0">From</span><DateField size="sm" value={effFrom} onChange={(v) => setParams({ effFrom: v })} placeholder="Any" ariaLabel="From" className="min-w-0 flex-1" /></span>
                <span className="flex items-center gap-2 text-sm text-ink-2"><span className="w-9 shrink-0">To</span><DateField size="sm" value={effTo} onChange={(v) => setParams({ effTo: v })} placeholder="Any" ariaLabel="To" className="min-w-0 flex-1" /></span>
              </div>
            </FilterRow>
          </FilterGroup>
          <FilterGroup label="Acknowledged by me">
            <FilterRow label="Only policies I acknowledged" checked={ackedByMe} onCheckedChange={(on) => setParams({ acked: on ? "1" : null })} />
          </FilterGroup>
        </FilterPanel>

        <div className="flex min-w-0 flex-1 flex-col gap-4">
          {loadError ? (
            <OsEmptyView variant="error" context="docs" title="Couldn't load policies" action={{ label: "Retry", onClick: () => void load() }} />
          ) : showQuietEmpty ? (
            <OsEmptyView context="docs" title="No policies published yet." action={canManagePolicies ? { label: "Create a policy", onClick: () => setNewOpen(true) } : undefined} />
          ) : viewType === "cards" ? (
            <CardsGrid rows={rows} groups={groups} empty={emptyNode} onMenu={(r, ref) => setMenu({ row: r, anchor: ref })} fmt={fmt} />
          ) : groups && groups.length > 1 ? (
            <div className="overflow-hidden rounded-lg border border-line bg-raised">
              {groups.map(([name, list], i, all) => (
                <div key={name} className={cn("flex flex-col", i > 0 ? "border-t border-line" : "")}>
                  <div className="flex h-11 items-center gap-2 bg-subtle px-3">
                    <span className="min-w-0 truncate text-row font-medium text-ink">{name}</span>
                    <span className="text-xs font-medium tabular-nums text-ink-2">{list.length}</span>
                  </div>
                  {table(list, name, i === all.length - 1, true)}
                </div>
              ))}
            </div>
          ) : (
            table(rows, POLICIES_VIEW_LABEL[view], true)
          )}
        </div>
      </div>

      {menu ? (
        <MorePortal anchorRef={menu.anchor} width={240} open onClose={() => setMenu(null)} placement="below" point={menu.point ?? null}>
          <MenuList onClick={() => setMenu(null)}>
            <MenuItem icon={ExternalLink} label="Open" onClick={() => router.push(`/policies/${menu.row.id}`)} />
            {canManage ? <MenuItem icon={Edit3} label="Edit" onClick={() => router.push(`/policies/${menu.row.id}?edit=1`)} /> : null}
            {canManage ? <MenuItem icon={UserPlus} label="Assign…" onClick={() => setAssignFor(menu.row)} /> : null}
            {canManage ? <MenuItem icon={ShieldCheck} label="Acknowledgements" onClick={() => router.push(`/policies/${menu.row.id}/compliance`)} /> : null}
            <MenuItem icon={Link2} label="Copy link" onClick={() => copyLink(menu.row)} />
            {canManage && menu.row.status !== "ARCHIVED" ? <><MenuSeparator /><MenuItem icon={Archive} label="Archive" onClick={() => void archive(menu.row)} /></> : null}
            {isAdmin ? <MenuItem icon={Trash2} label="Delete" destructive onClick={() => void remove(menu.row)} /> : null}
          </MenuList>
        </MorePortal>
      ) : null}
      {assignFor ? <AssignDialog open onClose={() => setAssignFor(null)} object={{ type: "policy", id: assignFor.id, title: assignFor.title }} onAssigned={() => { bumpRowVersion("policies"); void load(); }} /> : null}
      <NewPolicyDialog open={newOpen} onClose={() => setNewOpen(false)} categories={categories ?? []} onCreated={() => bumpRowVersion("policies")} />
    </>
  );
}

function CardsGrid({ rows, groups, empty, onMenu, fmt }: { rows: Row[] | null; groups: Array<[string, Row[]]> | null; empty: React.ReactNode; onMenu: (r: Row, ref: React.RefObject<HTMLButtonElement | null>) => void; fmt: ReturnType<typeof useFormat> }) {
  if (rows === null) return <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">{Array.from({ length: 6 }).map((_, i) => <div key={i} className="h-[120px] rounded-lg border border-line bg-raised" />)}</div>;
  if (rows.length === 0) return <div className="flex h-11 items-center rounded-lg border border-line bg-raised px-4 text-row text-ink-2">{empty}</div>;
  const sections = groups ?? [["", rows] as [string, Row[]]];
  return (
    <div className="flex flex-col gap-4">
      {sections.map(([name, list]) => (
        <section key={name || "all"} className="flex flex-col gap-2">
          {name ? <h2 className="flex items-center gap-2 text-row font-medium text-ink">{name}<span className="text-xs font-medium tabular-nums text-ink-2">{list.length}</span></h2> : null}
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
            {list.map((r) => <PolicyCard key={r.id} r={r} onMenu={onMenu} fmt={fmt} />)}
          </div>
        </section>
      ))}
    </div>
  );
}

function PolicyCard({ r, onMenu, fmt }: { r: Row; onMenu: (r: Row, ref: React.RefObject<HTMLButtonElement | null>) => void; fmt: ReturnType<typeof useFormat> }) {
  const ref = useRef<HTMLButtonElement>(null);
  const s = myAckState({ requiresAck: r.requiresAck, status: r.status, assigned: !!r.myAssignment, acknowledged: r.acknowledged });
  return (
    <div className="group/card relative flex min-h-[120px] flex-col gap-2 rounded-lg border border-line bg-raised p-3 hover:bg-hover">
      <Link href={`/policies/${r.id}`} className="flex min-w-0 items-start gap-2">
        <EntityTile size="sm" fallbackIcon={BookOpenCheck} name={r.title} />
        <span className="line-clamp-2 min-w-0 flex-1 text-row font-medium text-ink">{r.title}</span>
      </Link>
      <span className="text-sm text-ink-2">{r.category ?? "Uncategorized"}{r.effectiveDate ? ` · Effective ${fmt.date(r.effectiveDate, "date")}` : ""}</span>
      <div className="mt-auto flex items-center gap-2">
        <StatusChip color={POLICY_STATUS_COLOR[r.status]} label={POLICY_STATUS_LABEL[r.status]} disabled />
        <span className="ms-auto">{s.required ? <Dots variant="quad-steps" done={s.done} total={2} label={s.done === 2 ? "Acknowledged" : "Not acknowledged"} /> : null}</span>
        <span className={cn("os-tc__more")}><RowMoreButton buttonRef={ref} onClick={() => onMenu(r, ref)} label="Policy actions" /></span>
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
  return <RowMoreButton buttonRef={ref} open={open} onClick={() => onOpen(ref)} label="Policy actions" />;
}
