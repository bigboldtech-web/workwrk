"use client";

/* /sops (spec-process section 2): the library of every SOP I can see, on
 * the header stack and TableCard.
 *
 *   header   "SOPs" · views All · Published · Drafts · In review (hides at
 *            zero) · Archived · toolbar Filter (the panel holds the search
 *            field and the Folder / Kind / Status / Tags / Owner / Linked KRA
 *            / Updated / Assigned to me rows), Sort, Group, list | cards, the
 *            one blue "New SOP" (opens SopKindChooser) fused to a chevron
 *            listing the kinds, the bordered "…" (Display, Organize, Export)
 *   body     TableCard grouped by Folder (Unfiled last): checkbox · Name ·
 *            Kind · Folder · Status · Owner · Assigned · Updated · row "…";
 *            cards view; bulk bar; footer with the real total and pages
 *
 *   GET /api/sops?view=&q=&kind=&folderId=&status=&tags=&ownerId=&kraId=
 *       &assignedToMe=1&updatedFrom=&updatedTo=&sort=&dir=&page=&pageSize=
 *
 * Every view, filter, sort and page is in the URL, so a filtered list is a
 * link. `/` and Cmd-F open the Filter panel with its search field focused.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import {
  Archive, ChevronDown, ChevronRight, Copy, Download, Edit3, FileText, FolderInput, FolderTree, LayoutGrid, Link2, List as ListIcon, ListChecks, ListOrdered, MousePointerClick, SlidersHorizontal, Trash2, UserPlus,
} from "lucide-react";
import { Breadcrumb } from "@/components/layout/os/top-bar/breadcrumb";
import { OsPageHeader } from "@/components/layout/os/page-header";
import { OsEmptyView } from "@/components/layout/os/empty-view";
import { useOsShell } from "@/components/layout/os/shell-context";
import { useOsToast } from "@/components/layout/os/toast";
import { useBoot } from "@/components/layout/os/boot-context";
import { useConfirm } from "@/components/ui/dialog-provider";
import { ViewTab } from "@/components/ui/view-tabs";
import { FilterGroup, FilterPanel, FilterRow } from "@/components/ui/filter-panel";
import { Picker, type PickerOption } from "@/components/ui/picker";
import { MenuItem, MenuList, MenuSeparator } from "@/components/ui/menu";
import { MorePortal } from "@/components/layout/os/more-portal";
import { BulkAction, RowMoreButton, TableCard, type TableColumn } from "@/components/ui/table-card";
import { SplitPrimary } from "@/components/ui/split-primary";
import { StatusChip } from "@/components/ui/chip";
import { DateField } from "@/components/ui/date-field";
import { PersonAvatar, type PersonRef } from "@/components/board-view/assignee-picker";
import { SopKindChooser, sopKinds } from "@/components/sops/sop-kind-chooser";
import { AssignDialog } from "@/components/process/assign-dialog";
import { useRole } from "@/hooks/use-role";
import { apiFetch } from "@/lib/api-fetch";
import { useFormat } from "@/lib/format/use-date-prefs";
import { SOP_KIND_LABEL, SOP_STATUS_COLOR, SOP_STATUS_LABEL, type SopKind, type SopStatus } from "@/lib/sop-kind";
import {
  SOPS_GROUPS, SOPS_PAGE_SIZES, SOPS_SORTS, SOPS_VIEW_LABEL, SOPS_VIEWS, activeSopsFilterCount, parseSopsGroup, parseSopsQuery, type SopsGroup, type SopsView,
} from "@/lib/sop-list";
import { cn } from "@/lib/utils";

/* ───────────────────────────── types ───────────────────────────── */

type SopRow = {
  id: string;
  title: string;
  description: string | null;
  kind: SopKind;
  status: SopStatus;
  version: number;
  tags: string[];
  folderId: string | null;
  folder: { id: string; name: string; color: string | null } | null;
  owner: PersonRef | null;
  createdById: string | null;
  assignedCount: number;
  updatedAt: string;
  shareToken: string | null;
  kra: { id: string; name: string } | null;
};
type ListResponse = { data: SopRow[]; pagination: { total: number; totalPages: number }; counts: Record<SopsView, number> };
type FolderNode = { id: string; name: string; parentId: string | null; color?: string | null };

const KIND_ICON: Record<SopKind, typeof FileText> = { written: FileText, steps: ListOrdered, checklist: ListChecks, recording: MousePointerClick };
const COLUMN_KEYS = ["folder", "tags", "owner", "assigned"] as const;
type ColumnKey = (typeof COLUMN_KEYS)[number];
const COLUMN_LABEL: Record<ColumnKey, string> = { folder: "Show folder path", tags: "Show tags", owner: "Show owner", assigned: "Show assigned count" };

function personName(p: PersonRef | null | undefined): string {
  if (!p) return "";
  return `${p.firstName ?? ""} ${p.lastName ?? ""}`.trim() || p.email || "";
}

/** The spot a picker opened from a row menu pins to: under the "…" button, or at the right-click point. */
function pointFromMenu(menu: { anchor: React.RefObject<HTMLElement | null>; point?: { x: number; y: number } } | null): { top: number; left: number } | null {
  if (!menu) return null;
  if (menu.point) return { top: menu.point.y + 4, left: menu.point.x };
  const rect = menu.anchor.current?.getBoundingClientRect();
  if (!rect) return null;
  return { top: rect.bottom + 4, left: Math.max(8, rect.right - 300) };
}

/* ───────────────────────────── page ───────────────────────────── */

export default function SopsPage() {
  const router = useRouter();
  const params = useSearchParams();
  const { rowVersion, bumpRowVersion, prefs, patchPrefs } = useOsShell();
  const { boot } = useBoot();
  const { toast } = useOsToast();
  const confirm = useConfirm();
  const fmt = useFormat();
  const { canManageSOPs, canEditSOPs, isManager, isAdmin } = useRole();

  /* ── URL state ── */
  const query = useMemo(() => parseSopsQuery(new URLSearchParams(params.toString())), [params]);
  const group: SopsGroup = parseSopsGroup(params.get("group"));
  const viewType: "list" | "cards" = params.get("display") === "cards" ? "cards" : "list";
  const focusId = params.get("focus");
  const setParams = useCallback((patch: Record<string, string | null>, opts?: { keepPage?: boolean }) => {
    const next = new URLSearchParams(params.toString());
    for (const [k, v] of Object.entries(patch)) { if (v === null || v === "") next.delete(k); else next.set(k, v); }
    if (!opts?.keepPage) next.delete("page");
    const s = next.toString();
    router.push(s ? `/sops?${s}` : "/sops");
  }, [params, router]);
  const activeFilters = activeSopsFilterCount(query);

  /* ── data ── */
  const [rows, setRows] = useState<SopRow[] | null>(null);
  const [total, setTotal] = useState(0);
  const [counts, setCounts] = useState<Record<SopsView, number> | null>(null);
  const [loadError, setLoadError] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const queryString = useMemo(() => {
    const qs = new URLSearchParams({ view: query.view, sort: query.sort, dir: query.dir, page: String(query.page), pageSize: String(query.pageSize) });
    if (query.q) qs.set("q", query.q);
    if (query.kind) qs.set("kind", query.kind);
    if (query.folderId) qs.set("folderId", query.folderId);
    if (query.status) qs.set("status", query.status);
    if (query.tags.length) qs.set("tags", query.tags.join(","));
    if (query.ownerId) qs.set("ownerId", query.ownerId);
    if (query.kraId) qs.set("kraId", query.kraId);
    if (query.assignedToMe) qs.set("assignedToMe", "1");
    if (query.updatedFrom) qs.set("updatedFrom", query.updatedFrom);
    if (query.updatedTo) qs.set("updatedTo", query.updatedTo);
    return qs.toString();
  }, [query]);

  const load = useCallback(async () => {
    const r = await apiFetch<ListResponse>(`/api/sops?${queryString}`, { cache: "no-store" });
    if (!r.ok) { setLoadError(true); return; }
    setLoadError(false);
    setRows(r.data.data);
    setTotal(r.data.pagination.total);
    setCounts(r.data.counts);
    setSelected(new Set());
  }, [queryString]);
  useEffect(() => { const t = setTimeout(() => void load(), 0); return () => clearTimeout(t); }, [load]);
  const rv = rowVersion("sops");
  useEffect(() => { if (rv <= 0) return; const t = setTimeout(() => void load(), 0); return () => clearTimeout(t); }, [rv, load]);
  useEffect(() => {
    const onFocus = () => { void load(); };
    window.addEventListener("focus", onFocus);
    return () => window.removeEventListener("focus", onFocus);
  }, [load]);

  /* ── pagination ── */
  const from = total === 0 ? 0 : (query.page - 1) * query.pageSize + 1;
  const to = Math.min(total, (query.page - 1) * query.pageSize + (rows?.length ?? 0));
  const goNext = to < total ? () => setParams({ page: String(query.page + 1) }, { keepPage: true }) : undefined;
  const goPrev = query.page > 1 ? () => setParams({ page: query.page > 2 ? String(query.page - 1) : null }, { keepPage: true }) : undefined;

  /* ── filter panel, sort, group, display ── */
  const [filterOpen, setFilterOpen] = useState(false);
  const [sortOpen, setSortOpen] = useState(false);
  const [groupOpen, setGroupOpen] = useState(false);
  const [displayOpen, setDisplayOpen] = useState(false);
  const [ownerOpen, setOwnerOpen] = useState(false);
  const [folders, setFolders] = useState<FolderNode[] | null>(null);
  const [people, setPeople] = useState<PersonRef[]>([]);
  const [tagList, setTagList] = useState<Array<{ name: string; count: number }>>([]);
  const [kras, setKras] = useState<Array<{ id: string; name: string }>>([]);
  useEffect(() => {
    if (!filterOpen || folders !== null) return;
    let live = true;
    void (async () => {
      const [f, p, t, k] = await Promise.all([
        apiFetch<FolderNode[] | { data?: FolderNode[] }>("/api/sop-folders", { cache: "no-store" }),
        apiFetch<{ data?: PersonRef[] } | PersonRef[]>("/api/users?scope=all&limit=200", { cache: "no-store" }),
        apiFetch<Array<{ name: string; count: number }> | { data?: Array<{ name: string; count: number }> }>("/api/sop-tags", { cache: "no-store" }),
        apiFetch<{ data?: Array<{ id: string; name: string }> } | Array<{ id: string; name: string }>>("/api/kras?limit=200", { cache: "no-store" }),
      ]);
      if (!live) return;
      setFolders(f.ok ? (Array.isArray(f.data) ? f.data : f.data?.data ?? []) : []);
      setPeople(p.ok ? (Array.isArray(p.data) ? p.data : p.data?.data ?? []) : []);
      setTagList(t.ok ? (Array.isArray(t.data) ? t.data : t.data?.data ?? []) : []);
      setKras(k.ok ? (Array.isArray(k.data) ? k.data : k.data?.data ?? []) : []);
    })();
    return () => { live = false; };
  }, [filterOpen, folders]);
  /* ── create ── */
  const [chooserOpen, setChooserOpen] = useState(false);

  const searchRef = useRef<HTMLInputElement | null>(null);
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      const el = document.activeElement as HTMLElement | null;
      const typing = !!el && (el.tagName === "INPUT" || el.tagName === "TEXTAREA" || el.isContentEditable);
      if ((e.key === "/" && !typing && !e.metaKey && !e.ctrlKey) || ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "f" && !typing)) {
        e.preventDefault();
        setFilterOpen(true);
        setTimeout(() => searchRef.current?.focus(), 50);
      }
      if (e.key === "n" && !typing && !e.metaKey && !e.ctrlKey && !e.altKey && canManageSOPs) { e.preventDefault(); setChooserOpen(true); }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [canManageSOPs]);

  /* ── columns (Display) ── */
  const colsPref = prefs.home.sops?.columns ?? {};
  const cols: Record<ColumnKey, boolean> = { folder: colsPref.folder ?? true, tags: colsPref.tags ?? false, owner: colsPref.owner ?? true, assigned: colsPref.assigned ?? true };
  const toggleColumn = (key: string) => {
    const next = { ...cols, [key]: !cols[key as ColumnKey] };
    void patchPrefs({ home: { sops: { columns: next } } });
  };

  /* ── row menu ── */
  const [menu, setMenu] = useState<{ row: SopRow; anchor: React.RefObject<HTMLElement | null>; point?: { x: number; y: number } } | null>(null);
  const [assignFor, setAssignFor] = useState<SopRow | null>(null);
  const [moveFor, setMoveFor] = useState<SopRow[] | null>(null);
  /** Where the Move picker pins: under the row's "…" or the context-menu point; null = the bulk bar. */
  const [movePoint, setMovePoint] = useState<{ top: number; left: number } | null>(null);
  const meId = boot.viewer.id;
  const canDeleteRow = (r: SopRow) => isAdmin || (r.createdById === meId && r.status === "DRAFT");

  const copyLink = (r: SopRow) => {
    void navigator.clipboard.writeText(`${window.location.origin}/sops/${r.id}`).then(() => toast("Link copied"), () => toast("Couldn't copy the link", { tone: "danger" }));
  };
  const duplicate = async (r: SopRow) => {
    const res = await apiFetch<{ id: string }>("/api/sops", { method: "POST", json: { duplicateOf: r.id } });
    if (!res.ok) { toast(res.error || "Couldn't duplicate", { tone: "danger" }); return; }
    toast("Duplicated");
    router.push(`/sops/${res.data.id}?edit=1`);
  };
  const archiveRows = async (list: SopRow[]) => {
    const ids = list.filter((r) => r.status !== "ARCHIVED").map((r) => r.id);
    if (!ids.length) return;
    const ok = await confirm({ title: ids.length === 1 ? "Archive this SOP?" : `Archive ${ids.length} SOPs?`, description: "People assigned keep their history. Archived SOPs stay in the Archived view.", confirmLabel: "Archive" });
    if (!ok) return;
    const results = await Promise.allSettled(ids.map((id) => apiFetch(`/api/sops/${id}`, { method: "PATCH", json: { status: "ARCHIVED" } })));
    const failed = results.filter((x) => x.status === "rejected" || !x.value.ok).length;
    toast(failed ? `Archived ${ids.length - failed}, ${failed} failed` : ids.length === 1 ? "Archived" : `Archived ${ids.length} SOPs`, failed ? { tone: "danger" } : undefined);
    setSelected(new Set());
    void load();
  };
  const deleteRows = async (list: SopRow[]) => {
    const ids = list.filter(canDeleteRow).map((r) => r.id);
    if (!ids.length) { toast("You cannot delete these SOPs"); return; }
    const ok = await confirm({ title: ids.length === 1 ? `Move "${list[0].title || "Untitled SOP"}" to Trash?` : `Move ${ids.length} SOPs to Trash?`, description: `You can restore them for ${boot.org.trashDays} days.`, confirmLabel: "Move to Trash", destructive: true });
    if (!ok) return;
    const results = await Promise.allSettled(ids.map((id) => apiFetch(`/api/sops/${id}`, { method: "DELETE" })));
    const failed = results.filter((x) => x.status === "rejected" || !x.value.ok).length;
    toast(failed ? `Moved ${ids.length - failed}, ${failed} failed` : "Moved to Trash", failed ? { tone: "danger" } : { action: { label: "View Trash", onClick: () => router.push("/trash?type=sop") } });
    setSelected(new Set());
    bumpRowVersion("sops");
    void load();
  };
  const moveRows = async (list: SopRow[], folderId: string | null) => {
    setMoveFor(null);
    const results = await Promise.allSettled(list.map((r) => apiFetch(`/api/sops/${r.id}`, { method: "PATCH", json: { folderId } })));
    const failed = results.filter((x) => x.status === "rejected" || !x.value.ok).length;
    toast(failed ? `Moved ${list.length - failed}, ${failed} failed` : list.length === 1 ? "Moved" : `Moved ${list.length} SOPs`, failed ? { tone: "danger" } : undefined);
    setSelected(new Set());
    void load();
  };
  const exportCsv = () => {
    const header = ["Title", "Kind", "Folder", "Status", "Owner", "Assigned", "Updated", "Tags"];
    const lines = (rows ?? []).map((r) => [r.title, SOP_KIND_LABEL[r.kind], r.folder?.name ?? "Unfiled", SOP_STATUS_LABEL[r.status], personName(r.owner), String(r.assignedCount), r.updatedAt, r.tags.join("; ")]);
    const csv = [header, ...lines].map((l) => l.map((c) => `"${String(c ?? "").replace(/"/g, '""')}"`).join(",")).join("\n");
    const url = URL.createObjectURL(new Blob([csv], { type: "text/csv" }));
    const a = document.createElement("a"); a.href = url; a.download = "sops.csv"; a.click(); URL.revokeObjectURL(url);
  };

  /* ── folder options ── */
  useEffect(() => {
    if (!moveFor || folders !== null) return;
    void apiFetch<FolderNode[] | { data?: FolderNode[] }>("/api/sop-folders", { cache: "no-store" }).then((f) => setFolders(f.ok ? (Array.isArray(f.data) ? f.data : f.data?.data ?? []) : []));
  }, [moveFor, folders]);
  const folderOptions: PickerOption[] = useMemo(() => {
    const list = folders ?? [];
    const byParent = new Map<string | null, FolderNode[]>();
    for (const f of list) { const arr = byParent.get(f.parentId) ?? []; arr.push(f); byParent.set(f.parentId, arr); }
    const out: PickerOption[] = [];
    const walk = (parentId: string | null, depth: number) => {
      for (const f of (byParent.get(parentId) ?? []).sort((a, b) => a.name.localeCompare(b.name))) {
        out.push({ value: f.id, label: `${"  ".repeat(depth)}${f.name}` });
        walk(f.id, depth + 1);
      }
    };
    walk(null, 0);
    return out;
  }, [folders]);
  const folderName = (id: string | null) => (id ? folders?.find((f) => f.id === id)?.name ?? "1" : null);

  /* ── columns ── */
  const columns = useMemo<TableColumn<SopRow>[]>(() => {
    const out: TableColumn<SopRow>[] = [
      {
        key: "name", label: "Name", title: true, sortable: true, width: "minmax(240px,2fr)",
        render: (r) => {
          const Icon = KIND_ICON[r.kind];
          return (
            <span className="flex min-w-0 items-center gap-2">
              <Icon className="h-4 w-4 shrink-0 text-ink-2" strokeWidth={1.5} aria-hidden />
              <span className="truncate">{r.title || "Untitled SOP"}</span>
              {cols.tags && r.tags.length ? <span className="ms-1 flex shrink-0 gap-1">{r.tags.slice(0, 3).map((t) => <span key={t} className="inline-flex h-5 items-center rounded bg-active px-1.5 text-xs font-normal text-ink-2">{t}</span>)}</span> : null}
            </span>
          );
        },
      },
      { key: "kind", label: "Kind", sortable: true, width: "120px", render: (r) => <span className="text-ink-2">{SOP_KIND_LABEL[r.kind]}</span> },
    ];
    if (cols.folder) out.push({ key: "folder", label: "Folder", width: "minmax(120px,1fr)", render: (r) => r.folder ? <span className="truncate">{r.folder.name}</span> : <span className="text-ink-3">Unfiled</span> });
    out.push({ key: "status", label: "Status", sortable: true, width: "130px", render: (r) => <StatusChip color={SOP_STATUS_COLOR[r.status]} label={SOP_STATUS_LABEL[r.status]} disabled /> });
    if (cols.owner) out.push({ key: "owner", label: "Owner", sortable: true, width: "minmax(140px,1fr)", render: (r) => r.owner ? <span className="inline-flex min-w-0 items-center gap-2"><PersonAvatar person={r.owner} size={24} /><span className="truncate">{personName(r.owner)}</span></span> : <span className="text-ink-3">Nobody</span> });
    if (cols.assigned) out.push({ key: "assigned", label: "Assigned", width: "100px", numeric: true, render: (r) => <span className="text-ink-2">{r.assignedCount}</span> });
    out.push({ key: "updated", label: "Updated", sortable: true, width: "120px", render: (r) => <span className="tabular-nums text-ink-2" title={fmt.title(r.updatedAt)}>{fmt.date(r.updatedAt)}</span> });
    return out;
  }, [cols, fmt]);

  const sortKeyMap: Record<string, string> = { name: "name", kind: "kind", status: "status", owner: "owner", updated: "updated" };
  const onSort = (key: string) => { const s = sortKeyMap[key]; if (!s) return; setParams(s === query.sort ? { dir: query.dir === "asc" ? "desc" : "asc" } : { sort: s, dir: null }); };

  /* ── grouping (within the page) ── */
  const groups = useMemo(() => {
    if (!rows) return null;
    // No rows means no groups, and a list of zero groups rendered nothing:
    // no card, no "No results · Clear filters" row, no footer. An empty
    // result is one card with its empty row, whatever the grouping.
    if (group === "none" || rows.length === 0) return [{ key: "all", label: null as string | null, rows }];
    const m = new Map<string, { label: string; rows: SopRow[]; order: number }>();
    for (const r of rows) {
      const key = group === "folder" ? (r.folder?.id ?? "__unfiled") : group === "kind" ? r.kind : r.status;
      const label = group === "folder" ? (r.folder?.name ?? "Unfiled") : group === "kind" ? SOP_KIND_LABEL[r.kind] : SOP_STATUS_LABEL[r.status];
      const order = group === "folder" && !r.folder ? 1 : 0;
      if (!m.has(key)) m.set(key, { label, rows: [], order });
      m.get(key)!.rows.push(r);
    }
    return Array.from(m.entries()).sort(([, a], [, b]) => a.order - b.order || a.label.localeCompare(b.label)).map(([key, g]) => ({ key, label: g.label, rows: g.rows }));
  }, [rows, group]);
  const [collapsedGroups, setCollapsedGroups] = useState<Set<string>>(new Set());

  const selectedRows = useMemo(() => (rows ?? []).filter((r) => selected.has(r.id)), [rows, selected]);
  const filteredEmpty = !!(query.q || activeFilters);
  const emptyNode = filteredEmpty ? (
    <span className="inline-flex items-center gap-2">No results · <button type="button" onClick={() => setParams({ q: null, kind: null, folderId: null, status: null, tags: null, ownerId: null, kraId: null, assignedToMe: null, updatedFrom: null, updatedTo: null })} className="font-medium text-brand-deep hover:underline">Clear filters</button></span>
  ) : query.view === "archived" ? "Nothing archived" : query.view === "drafts" ? "No drafts" : query.view === "published" ? "Nothing published yet" : query.view === "review" ? "Nothing in review" : null;
  const showQuietEmpty = rows !== null && rows.length === 0 && query.view === "all" && !filteredEmpty;

  const rowMenuFor = (r: SopRow) => (
    <MenuList onClick={() => setMenu(null)}>
      <MenuItem icon={FileText} label="Open" href={`/sops/${r.id}`} />
      {canEditSOPs ? <MenuItem icon={Edit3} label="Edit" href={`/sops/${r.id}?edit=1`} /> : null}
      {isManager ? <MenuItem icon={UserPlus} label="Assign…" onClick={() => setAssignFor(r)} /> : null}
      {canManageSOPs ? <MenuItem icon={Copy} label="Duplicate" onClick={() => void duplicate(r)} /> : null}
      {canEditSOPs ? <MenuItem icon={FolderInput} label="Move to folder…" onClick={() => { setMovePoint(pointFromMenu(menu)); setMoveFor([r]); }} /> : null}
      <MenuItem icon={Link2} label="Copy link" onClick={() => copyLink(r)} />
      {canEditSOPs && r.status !== "ARCHIVED" ? <MenuItem icon={Archive} label="Archive" onClick={() => void archiveRows([r])} /> : null}
      {canDeleteRow(r) ? <><MenuSeparator /><MenuItem icon={Trash2} label="Delete" destructive onClick={() => void deleteRows([r])} /></> : null}
    </MenuList>
  );

  const chooserMenu = sopKinds().map((k) => <MenuItem key={k.href} icon={k.icon} label={k.label} href={k.href} />);

  return (
    <>
      <Breadcrumb items={[{ label: "SOPs" }]} />
      <OsPageHeader
        title="SOPs"
        views={SOPS_VIEWS.filter((v) => v !== "review" || (counts?.review ?? 0) > 0).map((v) => (
          <ViewTab
            key={v}
            label={SOPS_VIEW_LABEL[v]}
            active={query.view === v}
            href={v === "all" ? "/sops" : `/sops?view=${v}`}
            trailing={counts ? <span className={cn("text-xs font-medium tabular-nums", query.view === v ? "text-ink-strong" : "text-ink-2")}>{fmt.count(counts[v])}</span> : undefined}
          />
        ))}
        toolbar={{
          filter: { open: filterOpen, onToggle: () => setFilterOpen((o) => !o), count: activeFilters },
          sort: { onClick: () => setSortOpen((o) => !o), label: SOPS_SORTS.find((s) => s.key === query.sort)?.label, active: true },
          group: { onClick: () => setGroupOpen((o) => !o), label: SOPS_GROUPS.find((g) => g.key === group)?.label, active: group !== "none" },
          switcher: { value: viewType, options: [{ key: "list", label: "List", icon: ListIcon }, { key: "cards", label: "Cards", icon: LayoutGrid }], onChange: (k) => setParams({ display: k === "list" ? null : k }) },
          left: (
            <>
              <span className="relative">
                <Picker open={sortOpen} onClose={() => setSortOpen(false)} ariaLabel="Sort SOPs" selected={query.sort} onSelect={(v) => { setSortOpen(false); setParams(v === query.sort ? { dir: query.dir === "asc" ? "desc" : "asc" } : { sort: v, dir: null }); }}
                  sections={[{ options: SOPS_SORTS.map((s) => ({ value: s.key, label: s.label, hint: s.key === query.sort ? (query.dir === "asc" ? "Ascending" : "Descending") : undefined })) }]} width={220} />
              </span>
              <span className="relative">
                <Picker open={groupOpen} onClose={() => setGroupOpen(false)} ariaLabel="Group SOPs" selected={group} onSelect={(v) => { setGroupOpen(false); setParams({ group: v === "folder" ? null : v }); }}
                  sections={[{ options: SOPS_GROUPS.map((g) => ({ value: g.key, label: g.label })) }]} width={200} />
              </span>
            </>
          ),
          right: (
            <>
              <span className="relative">
                <Picker open={displayOpen} onClose={() => setDisplayOpen(false)} ariaLabel="Display" multi selected={COLUMN_KEYS.filter((k) => cols[k])} onSelect={toggleColumn} align="end" width={240}
                  sections={[{ label: "Display", options: COLUMN_KEYS.map((k) => ({ value: k, label: COLUMN_LABEL[k] })) }]} />
              </span>
              {canManageSOPs ? (
                <SplitPrimary label="New SOP" onClick={() => setChooserOpen(true)} menuLabel="Pick a kind">
                  {chooserMenu}
                </SplitPrimary>
              ) : null}
            </>
          ),
          menu: [
            { label: "Display", icon: SlidersHorizontal, onClick: () => setDisplayOpen(true) },
            ...(canManageSOPs ? [{ label: "Organize", icon: FolderTree, href: "/sops/manage" }] : []),
            ...(!boot.viewer.isAgent ? [{ label: "Export CSV", icon: Download, onClick: exportCsv }] : []),
            { label: "Trash", icon: Trash2, href: "/trash?type=sop" },
          ],
        }}
      />

      <div className="os-chrome flex min-h-0 flex-1 gap-4 px-6 pb-6 pt-2">
        <FilterPanel
          open={filterOpen}
          onClose={() => setFilterOpen(false)}
          objects="SOPs"
          activeCount={activeFilters}
          onClearAll={() => setParams({ q: null, kind: null, folderId: null, status: null, tags: null, ownerId: null, kraId: null, assignedToMe: null, updatedFrom: null, updatedTo: null })}
        >
          <li className="pb-2">
            <SearchField inputRef={searchRef} value={query.q} onChange={(v) => setParams({ q: v || null })} placeholder="Search SOPs" />
          </li>
          <FilterGroup label="Folder">
            <FilterRow label="Unfiled" checked={query.folderId === "none"} onCheckedChange={(on) => setParams({ folderId: on ? "none" : null })} />
            {folderOptions.map((f) => (
              <FilterRow key={f.value} label={<span className="whitespace-pre">{f.label}</span>} checked={query.folderId === f.value} onCheckedChange={(on) => setParams({ folderId: on ? f.value : null })} />
            ))}
          </FilterGroup>
          <FilterGroup label="Kind">
            {(["written", "steps", "checklist", "recording"] as SopKind[]).map((k) => (
              <FilterRow key={k} label={SOP_KIND_LABEL[k]} checked={query.kind === k} onCheckedChange={(on) => setParams({ kind: on ? k : null })} />
            ))}
          </FilterGroup>
          <FilterGroup label="Status">
            {(["DRAFT", "IN_REVIEW", "APPROVED", "PUBLISHED", "ARCHIVED"] as SopStatus[]).map((s) => (
              <FilterRow key={s} label={SOP_STATUS_LABEL[s]} checked={query.status === s} onCheckedChange={(on) => setParams({ status: on ? s : null })} />
            ))}
          </FilterGroup>
          {tagList.length > 0 ? (
            <FilterGroup label="Tags">
              {tagList.slice(0, 20).map((t) => (
                <FilterRow key={t.name} label={t.name} count={t.count} checked={query.tags.includes(t.name)} onCheckedChange={(on) => { const next = on ? [...query.tags, t.name] : query.tags.filter((x) => x !== t.name); setParams({ tags: next.length ? next.join(",") : null }); }} />
              ))}
            </FilterGroup>
          ) : null}
          <FilterGroup label="Owner">
            <FilterRow label="Filter by owner" checked={!!query.ownerId} onCheckedChange={(on) => { if (!on) setParams({ ownerId: null }); else setOwnerOpen(true); }}>
              <span className="relative block">
                <button type="button" onClick={() => setOwnerOpen((o) => !o)} className="inline-flex h-8 items-center gap-2 rounded-md border border-line-strong bg-raised px-2 text-sm text-ink">
                  {query.ownerId ? personName(people.find((p) => p.id === query.ownerId)) || "1 person" : <span className="text-ink-3">Choose a person</span>}
                </button>
                <Picker open={ownerOpen} onClose={() => setOwnerOpen(false)} ariaLabel="Owner" searchPlaceholder="Find a person" selected={query.ownerId} onSelect={(v) => { setParams({ ownerId: v }); setOwnerOpen(false); }}
                  sections={[{ options: people.map((p) => ({ value: p.id, label: personName(p), description: p.email ?? undefined, glyph: <PersonAvatar person={p} size={20} /> })) }]} />
              </span>
            </FilterRow>
          </FilterGroup>
          {kras.length > 0 ? (
            <FilterGroup label="Linked KRA">
              {kras.slice(0, 20).map((k) => <FilterRow key={k.id} label={k.name} checked={query.kraId === k.id} onCheckedChange={(on) => setParams({ kraId: on ? k.id : null })} />)}
            </FilterGroup>
          ) : null}
          <FilterGroup label="Updated">
            <FilterRow label="Date range" checked={!!(query.updatedFrom || query.updatedTo)} onCheckedChange={(on) => { if (!on) setParams({ updatedFrom: null, updatedTo: null }); else setParams({ updatedFrom: new Date(Date.now() - 30 * 86_400_000).toISOString().slice(0, 10) }); }}>
              <div className="flex flex-col gap-1.5">
                <span className="flex items-center gap-2 text-sm text-ink-2"><span className="w-9 shrink-0">From</span><DateField size="sm" value={query.updatedFrom ? query.updatedFrom.slice(0, 10) : null} onChange={(v) => setParams({ updatedFrom: v })} placeholder="Any" ariaLabel="From" className="min-w-0 flex-1" /></span>
                <span className="flex items-center gap-2 text-sm text-ink-2"><span className="w-9 shrink-0">To</span><DateField size="sm" value={query.updatedTo ? query.updatedTo.slice(0, 10) : null} onChange={(v) => setParams({ updatedTo: v ? `${v}T23:59:59` : null })} placeholder="Any" ariaLabel="To" className="min-w-0 flex-1" /></span>
              </div>
            </FilterRow>
          </FilterGroup>
          <FilterGroup label="Assigned">
            <FilterRow label="Assigned to me" checked={query.assignedToMe} onCheckedChange={(on) => setParams({ assignedToMe: on ? "1" : null })} />
          </FilterGroup>
        </FilterPanel>

        <div className="flex min-w-0 flex-1 flex-col gap-3">
          {loadError ? (
            <OsEmptyView variant="error" context="docs" title="Couldn't load SOPs" action={{ label: "Retry", onClick: () => void load() }} />
          ) : showQuietEmpty ? (
            <OsEmptyView context="docs" title="No SOPs yet" hint={canManageSOPs ? "Document a process once and assign it to teammates." : "Procedures your team documents show up here."} action={canManageSOPs ? { label: "Create your first SOP", onClick: () => setChooserOpen(true) } : undefined} />
          ) : viewType === "cards" && rows ? (
            <CardsView rows={rows} groups={groups} onMenu={(r, e) => { e.preventDefault(); setMenu({ row: r, anchor: { current: e.currentTarget as HTMLElement }, point: { x: e.clientX, y: e.clientY } }); }} />
          ) : (
            /* One bordered card. Group headers (design-system 5.1) are 44px
               --os-surface-1 rows inside it with a Lucide chevron, the name
               15/500 and the count; each group's rows follow with their own
               column header (the Monday grouping), the footer and the bulk
               bar belong to the card once. */
            <div className="overflow-hidden rounded-lg border border-line bg-raised">
              {(groups ?? [{ key: "all", label: null, rows: null as SopRow[] | null }]).map((g, i, all) => {
                const collapsed = collapsedGroups.has(g.key);
                const last = i === all.length - 1;
                // The bulk bar is drawn by ONE TableCard: the last one that is
                // open, so collapsing the final group never hides it.
                const openGroups = all.filter((x) => !collapsedGroups.has(x.key));
                const bulkHostKey = openGroups[openGroups.length - 1]?.key ?? g.key;
                return (
                  <div key={g.key} className={cn("flex flex-col", i > 0 ? "border-t border-line" : "")}>
                    {g.label ? (
                      <button type="button" onClick={() => setCollapsedGroups((s) => { const n = new Set(s); if (n.has(g.key)) n.delete(g.key); else n.add(g.key); return n; })} aria-expanded={!collapsed} className="flex h-11 w-full items-center gap-2 bg-subtle px-3 text-start hover:bg-hover">
                        {collapsed ? <ChevronRight className="h-4 w-4 shrink-0 text-ink-2 rtl:rotate-180" strokeWidth={1.5} aria-hidden /> : <ChevronDown className="h-4 w-4 shrink-0 text-ink-2" strokeWidth={1.5} aria-hidden />}
                        <span className="min-w-0 truncate text-row font-medium text-ink">{g.label}</span>
                        <span className="text-xs font-medium tabular-nums text-ink-2">{g.rows?.length ?? 0}</span>
                      </button>
                    ) : null}
                    {collapsed ? null : (
                      <TableCard<SopRow>
                        className={cn("rounded-none border-0", g.label ? "border-t border-line" : "")}
                        ariaLabel={g.label ?? SOPS_VIEW_LABEL[query.view]}
                        columns={columns}
                        rows={g.rows}
                        rowKey={(r) => r.id}
                        rowHref={(r) => `/sops/${r.id}`}
                        selectable
                        selected={selected}
                        onSelectedChange={setSelected}
                        sort={{ key: query.sort, dir: query.dir }}
                        onSort={onSort}
                        highlightKey={focusId}
                        onRowContextMenu={(r, e) => { e.preventDefault(); setMenu({ row: r, anchor: { current: e.currentTarget as HTMLElement }, point: { x: e.clientX, y: e.clientY } }); }}
                        rowMenu={(r) => <RowMenuTrigger open={menu?.row.id === r.id} onOpen={(ref) => setMenu({ row: r, anchor: ref })} />}
                        empty={emptyNode}
                        footer={last ? { total, noun: "SOPs", from, to, onPrev: goPrev, onNext: goNext, pageSize: query.pageSize, pageSizes: [...SOPS_PAGE_SIZES], onPageSize: (n) => setParams({ pageSize: n === SOPS_PAGE_SIZES[0] ? null : String(n) }) } : undefined}
                        bulkActions={g.key === bulkHostKey ? (
                          <>
                            {isManager && selectedRows.length === 1 ? <BulkAction icon={UserPlus} label="Assign…" onClick={() => setAssignFor(selectedRows[0])} /> : null}
                            {canEditSOPs ? <BulkAction icon={FolderInput} label="Move to folder…" onClick={() => { setMovePoint(null); setMoveFor(selectedRows); }} /> : null}
                            {canEditSOPs ? <BulkAction icon={Archive} label="Archive" onClick={() => void archiveRows(selectedRows)} /> : null}
                            {!boot.viewer.isAgent ? <BulkAction icon={Download} label="Export" onClick={exportCsv} /> : null}
                            {selectedRows.every(canDeleteRow) ? <BulkAction icon={Trash2} label="Delete" destructive onClick={() => void deleteRows(selectedRows)} /> : null}
                          </>
                        ) : undefined}
                      />
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>

      {menu ? (
        <MorePortal anchorRef={menu.anchor} width={220} open onClose={() => setMenu(null)} placement="below" point={menu.point ?? null}>
          {rowMenuFor(menu.row)}
        </MorePortal>
      ) : null}
      {moveFor ? (
        movePoint ? (
          /* From a row menu: pinned just under the row's "…" (or the click
             point of a context menu), never floating at the screen's foot. */
          <Picker open onClose={() => setMoveFor(null)} ariaLabel="Move to folder" searchPlaceholder="Find a folder" anchorPoint={movePoint} onSelect={(v) => void moveRows(moveFor, v === "__unfiled" ? null : v)}
            sections={[{ options: [{ value: "__unfiled", label: "Unfiled" }] }, { label: "Folders", options: folderOptions.length ? folderOptions : [{ value: "__none", label: "No folders yet", disabled: true }] }]} width={300} />
        ) : (
          /* From the bulk bar, which floats bottom-centre: the picker opens
             above it, attached to the bar that asked for it. */
          <span className="fixed inset-x-0 bottom-20 z-40 flex justify-center">
            <span className="relative">
              <Picker open onClose={() => setMoveFor(null)} ariaLabel="Move to folder" searchPlaceholder="Find a folder" side="top" onSelect={(v) => void moveRows(moveFor, v === "__unfiled" ? null : v)}
                sections={[{ options: [{ value: "__unfiled", label: "Unfiled" }] }, { label: "Folders", options: folderOptions.length ? folderOptions : [{ value: "__none", label: "No folders yet", disabled: true }] }]} width={300} />
            </span>
          </span>
        )
      ) : null}
      {assignFor ? <AssignDialog open onClose={() => setAssignFor(null)} object={{ type: "sop", id: assignFor.id, title: assignFor.title }} onAssigned={() => void load()} /> : null}
      <SopKindChooser open={chooserOpen} onClose={() => setChooserOpen(false)} />
      <span className="sr-only">{folderName(query.folderId)}</span>
    </>
  );
}

/* ───────────────────────────── bits ───────────────────────────── */

function CardsView({ rows, groups, onMenu }: { rows: SopRow[]; groups: Array<{ key: string; label: string | null; rows: SopRow[] }> | null; onMenu: (r: SopRow, e: React.MouseEvent) => void }) {
  const list = groups ?? [{ key: "all", label: null, rows }];
  return (
    <div className="flex flex-col gap-4">
      {list.map((g) => (
        <section key={g.key} className="flex flex-col gap-2">
          {g.label ? <h2 className="text-row font-medium text-ink">{g.label} <span className="text-xs font-medium text-ink-2">{g.rows.length}</span></h2> : null}
          <div className="grid gap-3" style={{ gridTemplateColumns: "repeat(auto-fill, minmax(280px, 1fr))" }}>
            {g.rows.map((r) => {
              const Icon = KIND_ICON[r.kind];
              return (
                <Link key={r.id} href={`/sops/${r.id}`} onContextMenu={(e) => onMenu(r, e)} className="group flex min-h-[120px] flex-col gap-2 rounded-lg border border-line bg-raised p-3 hover:bg-hover">
                  <span className="flex items-start gap-2">
                    <Icon className="mt-0.5 h-4 w-4 shrink-0 text-ink-2" strokeWidth={1.5} aria-hidden />
                    <span className="line-clamp-2 min-w-0 flex-1 text-row font-medium text-ink">{r.title || "Untitled SOP"}</span>
                    <RowMoreButton onClick={(e) => onMenu(r, e)} label="SOP actions" />
                  </span>
                  <span className="text-sm text-ink-2">{r.folder?.name ?? "Unfiled"}</span>
                  <span className="mt-auto flex items-center justify-between">
                    <StatusChip color={SOP_STATUS_COLOR[r.status]} label={SOP_STATUS_LABEL[r.status]} disabled />
                    {r.owner ? <PersonAvatar person={r.owner} size={24} /> : null}
                  </span>
                </Link>
              );
            })}
            {g.rows.length === 0 ? <p className="text-row text-ink-2">Nothing here yet</p> : null}
          </div>
        </section>
      ))}
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
  return (
    <input
      ref={inputRef}
      type="search"
      value={draft}
      onChange={(e) => setDraft(e.target.value)}
      onKeyDown={(e) => { if (e.key === "Escape") { e.stopPropagation(); (e.currentTarget as HTMLInputElement).blur(); } }}
      placeholder={placeholder}
      aria-label={placeholder}
      className="h-9 w-full rounded-md border border-line-strong bg-raised px-3 text-base text-ink placeholder:text-ink-3 focus:outline-none focus-visible:border-brand"
    />
  );
}

function RowMenuTrigger({ onOpen, open }: { onOpen: (ref: React.RefObject<HTMLButtonElement | null>) => void; open?: boolean }) {
  const ref = useRef<HTMLButtonElement>(null);
  return <RowMoreButton buttonRef={ref} open={open} onClick={() => onOpen(ref)} label="SOP actions" />;
}
