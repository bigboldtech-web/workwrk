"use client";

/* /automation/workflows: every automation in the workspace
 * (spec-ai-automation /automation/workflows).
 *
 *   GET  /api/automation/workflows   ?status= ?q= ?createdBy= ?trigger=
 *        ?severity= ?where= ?listId|folderId|spaceId= ?sort= ?cursor= ?take=
 *        ?includeArchived=1 -> { workflows, total, nextCursor, container,
 *        creators, paused, rights }
 *   POST /api/automation/workflows               New automation (a DRAFT)
 *   POST .../[id]/duplicate | activate | deactivate | unarchive
 *   PUT  .../[id] { name }                       Rename
 *   DELETE .../[id]                              Archive (never a delete)
 *
 * URL state: ?status= (the view pills), the filters, the container a Space,
 * Folder or List "..." menu arrived with, and ?cursor=. Per viewer, in
 * home.work.surface["automation.workflows"]: the columns, the sort, the page
 * size and Show archived. A control the viewer's role cannot use is not
 * rendered.
 */

import { Suspense, useCallback, useEffect, useMemo, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Archive, ArchiveRestore, CircleAlert, Copy, Pause, Pencil, Play, ScrollText, Type, X } from "lucide-react";
import { OsPageHeader } from "@/components/layout/os/page-header";
import { OsEmptyView } from "@/components/layout/os/empty-view";
import { MorePortal } from "@/components/layout/os/more-portal";
import { useOsToast } from "@/components/layout/os/toast";
import { useConfirm } from "@/components/ui/dialog-provider";
import { BulkAction, RowMoreButton, TableCard, type TableColumn } from "@/components/ui/table-card";
import { MenuItem, MenuList, MenuSeparator } from "@/components/ui/menu";
import { Picker } from "@/components/ui/picker";
import { ViewTab } from "@/components/ui/view-tabs";
import { FilterGroup, FilterPanel, FilterRow } from "@/components/ui/filter-panel";
import { PersonAvatar } from "@/components/board-view/assignee-picker";
import { InlineRow, NameDialog, NeutralChip, WorkflowStatusChip, useAutomationCatalog } from "@/components/automation/automation-ui";
import { apiFetch } from "@/lib/api-fetch";
import { formatDate, formatRelative } from "@/lib/format/date";
import { useDatePrefs } from "@/lib/format/use-date-prefs";
import { useSurfaceState } from "@/lib/use-surface-state";
import { pick } from "@/lib/surface-prefs";
import { notifyAiChatsChanged } from "@/lib/ai/events";
import {
  ALERT_LABEL,
  ALERT_LEVELS,
  SORT_LABEL,
  VIEW_LABEL,
  WORKFLOW_SORTS,
  WORKFLOW_VIEWS,
  parseView,
  type WorkflowView,
} from "@/lib/automation/workflow-list";

interface Row {
  id: string;
  name: string;
  description: string | null;
  status: string;
  severity: string;
  triggerEvent: string | null;
  publishedVersionId: string | null;
  lastRunAt: string | null;
  updatedAt: string;
  createdById: string | null;
  createdByName: string | null;
  createdByAvatar: string | null;
  totalRuns: number;
  successRuns: number;
  terminalRuns: number;
  successRate: number | null;
  where: { names: string[]; hidden: number; everywhere: boolean };
  can: { edit: boolean; archive: boolean };
}

interface ListResponse {
  workflows: Row[];
  total: number;
  offset: number;
  nextCursor: string | null;
  container: { kind: string; id: string; name: string | null } | null;
  creators: Array<{ id: string; name: string }>;
  paused: boolean;
  rights: { canCreate: boolean; isAdmin: boolean };
}

interface Places {
  spaces: Array<{ id: string; name: string }>;
  folders: Array<{ id: string; name: string; spaceId: string }>;
  lists: Array<{ id: string; name: string; spaceId: string | null }>;
}

const COLUMN_KEYS = ["when", "where", "lastRun", "success", "createdBy"] as const;
type ColumnKey = (typeof COLUMN_KEYS)[number];
const COLUMN_LABEL: Record<ColumnKey, string> = {
  when: "When",
  where: "Where",
  lastRun: "Last run",
  success: "Success",
  createdBy: "Created by",
};
const PAGE_SIZES = [40, 100];
const FILTER_KEYS = ["createdBy", "trigger", "where", "severity"] as const;
type FilterKey = (typeof FILTER_KEYS)[number];

function whereWords(w: Row["where"]): string {
  if (w.everywhere) return "Everywhere";
  const parts = [...w.names];
  if (w.hidden > 0) {
    // With names before it, "2 more you can't open"; alone, it has to say what.
    parts.push(parts.length
      ? `${w.hidden} more you can't open`
      : w.hidden === 1 ? "A place you can't open" : `${w.hidden} places you can't open`);
  }
  return parts.join(", ") || "Chosen Lists";
}

/** The Where filter shows this many Lists until the viewer searches. */
const WHERE_LIST_CAP = 60;

function firstName(full: string | null): string {
  if (!full) return "Former member";
  return full.split(" ")[0] || full;
}

function WorkflowsInner() {
  const router = useRouter();
  const sp = useSearchParams();
  const { toast } = useOsToast();
  const confirm = useConfirm();
  const datePrefs = useDatePrefs();
  const catalog = useAutomationCatalog();

  const view: WorkflowView = parseView(sp?.get("status"));
  const listId = sp?.get("listId") ?? null;
  const folderId = sp?.get("folderId") ?? null;
  const spaceId = sp?.get("spaceId") ?? null;
  const cursor = sp?.get("cursor") ?? null;
  const filters = useMemo(() => {
    const out: Record<FilterKey, string[]> = { createdBy: [], trigger: [], where: [], severity: [] };
    for (const k of FILTER_KEYS) out[k] = (sp?.get(k) ?? "").split(",").filter(Boolean);
    return out;
  }, [sp]);
  const activeFilters = FILTER_KEYS.filter((k) => filters[k].length > 0).length;

  const [surface, setSurface] = useSurfaceState("automation.workflows");
  const sort = pick(surface.sortKey, WORKFLOW_SORTS, "updated");
  const showArchived = surface.viewOptions?.showArchived === true;
  const pageSize = PAGE_SIZES.includes(Number(surface.viewOptions?.pageSize)) ? Number(surface.viewOptions?.pageSize) : 40;
  const columns = useMemo<ColumnKey[]>(() => {
    const stored = surface.columns?.filter((c): c is ColumnKey => (COLUMN_KEYS as readonly string[]).includes(c));
    return stored && stored.length ? stored : [...COLUMN_KEYS];
  }, [surface.columns]);

  const [data, setData] = useState<ListResponse | null>(null);
  const [rows, setRows] = useState<Row[] | null>(null);
  const [error, setError] = useState(false);
  const [filterOpen, setFilterOpen] = useState(false);
  const [filterSearch, setFilterSearch] = useState("");
  const [sortOpen, setSortOpen] = useState(false);
  const [places, setPlaces] = useState<Places | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [menu, setMenu] = useState<{ row: Row; anchor: { current: HTMLElement | null } } | null>(null);
  const [nameDialog, setNameDialog] = useState<{ mode: "create" } | { mode: "rename"; row: Row } | null>(null);
  const [nameBusy, setNameBusy] = useState(false);
  const [nameError, setNameError] = useState<string | null>(null);
  // A Space, Folder or List link that no longer resolves (deleted, or never
  // existed): the param is dropped and one line says so, so the page keeps
  // its New automation button instead of dead-ending on "Try again".
  const [placeGone, setPlaceGone] = useState(false);

  const setParams = useCallback((patch: Record<string, string | null>) => {
    const next = new URLSearchParams(sp?.toString() ?? "");
    for (const [k, v] of Object.entries(patch)) {
      if (v === null || v === "") next.delete(k);
      else next.set(k, v);
    }
    // Any change but paging starts again at page one.
    if (!("cursor" in patch)) next.delete("cursor");
    const qs = next.toString();
    router.replace(qs ? `/automation/workflows?${qs}` : "/automation/workflows", { scroll: false });
  }, [router, sp]);

  const query = useMemo(() => {
    const q = new URLSearchParams({ status: view, sort, take: String(pageSize) });
    if (showArchived && view === "all") q.set("includeArchived", "1");
    for (const k of FILTER_KEYS) if (filters[k].length) q.set(k, filters[k].join(","));
    if (listId) q.set("listId", listId);
    else if (folderId) q.set("folderId", folderId);
    else if (spaceId) q.set("spaceId", spaceId);
    if (cursor) q.set("cursor", cursor);
    return q.toString();
  }, [view, sort, pageSize, showArchived, filters, listId, folderId, spaceId, cursor]);

  const load = useCallback(async () => {
    const r = await apiFetch<ListResponse>(`/api/automation/workflows?${query}`, { cache: "no-store" });
    if (!r.ok) {
      if (r.status === 404 && (listId || folderId || spaceId)) {
        setPlaceGone(true);
        setParams({ listId: null, folderId: null, spaceId: null });
        return;
      }
      setError(true);
      setRows((prev) => prev ?? []);
      return;
    }
    setError(false);
    setData(r.data);
    setRows(r.data.workflows);
    setSelected((prev) => new Set([...prev].filter((id) => r.data.workflows.some((w) => w.id === id && w.can.edit))));
  }, [query, listId, folderId, spaceId, setParams]);

  useEffect(() => {
    const t = setTimeout(() => void load(), 0);
    const onFocus = () => void load();
    window.addEventListener("focus", onFocus);
    return () => {
      clearTimeout(t);
      window.removeEventListener("focus", onFocus);
    };
  }, [load]);

  // The "Where it runs" filter rows are the places the viewer can read,
  // loaded the first time the panel opens.
  useEffect(() => {
    if (!filterOpen || places) return;
    let alive = true;
    void apiFetch<Places>("/api/automation/places", { cache: "no-store" }).then((r) => {
      if (alive && r.ok) setPlaces(r.data);
    });
    return () => {
      alive = false;
    };
  }, [filterOpen, places]);

  const triggerByKey = useMemo(() => new Map(catalog.triggers.map((t) => [t.key, t])), [catalog.triggers]);
  const canCreate = data?.rights.canCreate === true;
  const isAdmin = data?.rights.isAdmin === true;

  const changed = useCallback(() => {
    void load();
    notifyAiChatsChanged();
  }, [load]);

  /* ── mutations ── */

  const create = useCallback(async (name: string) => {
    setNameBusy(true);
    setNameError(null);
    // Arriving from a List, Folder or Space "..." menu, the new automation
    // starts scoped there.
    const scope = listId ? { listIds: [listId] } : folderId ? { folderIds: [folderId] } : spaceId ? { spaceIds: [spaceId] } : undefined;
    const r = await apiFetch<{ workflow: { id: string } }>("/api/automation/workflows", {
      method: "POST",
      json: { name, ...(scope ? { definition: { scope } } : {}) },
    });
    setNameBusy(false);
    if (!r.ok) {
      setNameError(r.error || "Couldn't create the automation");
      return;
    }
    setNameDialog(null);
    notifyAiChatsChanged();
    router.push(`/automation/workflows/${r.data.workflow.id}`);
  }, [listId, folderId, spaceId, router]);

  const rename = useCallback(async (row: Row, name: string) => {
    setNameBusy(true);
    setNameError(null);
    const r = await apiFetch(`/api/automation/workflows/${row.id}`, { method: "PUT", json: { name } });
    setNameBusy(false);
    if (!r.ok) {
      setNameError(r.error || "Couldn't rename it");
      return;
    }
    setNameDialog(null);
    toast("Renamed");
    changed();
  }, [changed, toast]);

  const duplicate = useCallback(async (row: Row, quiet = false): Promise<boolean> => {
    const r = await apiFetch<{ id: string; name: string }>(`/api/automation/workflows/${row.id}/duplicate`, { method: "POST", json: {} });
    if (!r.ok) {
      if (!quiet) toast(r.error || "Couldn't duplicate it", { tone: "danger" });
      return false;
    }
    if (!quiet) {
      toast("Duplicated as a draft", { action: { label: "Open it", onClick: () => router.push(`/automation/workflows/${r.data.id}`) } });
      changed();
    }
    return true;
  }, [changed, router, toast]);

  const setActive = useCallback(async (row: Row, on: boolean, quiet = false): Promise<boolean> => {
    const r = await apiFetch(`/api/automation/workflows/${row.id}/${on ? "activate" : "deactivate"}`, { method: "POST" });
    if (!r.ok) {
      if (!quiet) toast(r.error || "Couldn't change it", { tone: "danger" });
      return false;
    }
    if (!quiet) {
      toast(on ? "Activated" : "Deactivated");
      changed();
    }
    return true;
  }, [changed, toast]);

  const unarchive = useCallback(async (row: Row) => {
    const r = await apiFetch(`/api/automation/workflows/${row.id}/unarchive`, { method: "POST" });
    if (!r.ok) {
      toast(r.error || "Couldn't bring it back", { tone: "danger" });
      return;
    }
    toast("Back from the archive, paused");
    changed();
  }, [changed, toast]);

  const archive = useCallback(async (row: Row, quiet = false): Promise<boolean> => {
    const r = await apiFetch(`/api/automation/workflows/${row.id}`, { method: "DELETE" });
    if (!r.ok) {
      if (!quiet) toast(r.error || "Couldn't archive it", { tone: "danger" });
      return false;
    }
    if (!quiet) {
      toast("Archived. Its run history is kept.", { action: { label: "Undo", onClick: () => void unarchive(row) } });
      changed();
    }
    return true;
  }, [changed, toast, unarchive]);

  const confirmArchive = useCallback(async (row: Row) => {
    const ok = await confirm({
      title: `Archive "${row.name}"?`,
      description: "It stops running. Its run history is kept.",
      confirmLabel: "Archive",
      destructive: true,
    });
    if (ok) void archive(row);
  }, [archive, confirm]);

  const bulk = useCallback(async (kind: "activate" | "deactivate" | "duplicate" | "archive") => {
    const picked = (rows ?? []).filter((r) => selected.has(r.id));
    if (picked.length === 0) return;
    if (kind === "archive") {
      const ok = await confirm({
        title: `Archive ${picked.length} automation${picked.length === 1 ? "" : "s"}?`,
        description: "They stop running. Their run history is kept.",
        confirmLabel: "Archive",
        destructive: true,
      });
      if (!ok) return;
    }
    let done = 0;
    let skipped = 0;
    for (const row of picked) {
      if (kind === "activate" && (!row.publishedVersionId || row.status === "ACTIVE" || row.status === "ARCHIVED")) { skipped++; continue; }
      if (kind === "deactivate" && row.status !== "ACTIVE") { skipped++; continue; }
      if (kind === "archive" && (!row.can.archive || row.status === "ARCHIVED")) { skipped++; continue; }
      const ok =
        kind === "activate" ? await setActive(row, true, true)
        : kind === "deactivate" ? await setActive(row, false, true)
        : kind === "duplicate" ? await duplicate(row, true)
        : await archive(row, true);
      if (ok) done++;
      else skipped++;
    }
    const verb = { activate: "activated", deactivate: "deactivated", duplicate: "duplicated", archive: "archived" }[kind];
    toast(`${done} ${verb}${skipped ? `, ${skipped} left as they were` : ""}`);
    setSelected(new Set());
    changed();
  }, [rows, selected, confirm, setActive, duplicate, archive, toast, changed]);

  /* ── table ── */

  const tableColumns = useMemo<TableColumn<Row>[]>(() => {
    const all: Array<TableColumn<Row> & { k?: ColumnKey }> = [
      {
        key: "name",
        label: "Name",
        title: true,
        width: "minmax(200px,2fr)",
        render: (w) => <span className="truncate" title={w.description ?? undefined}>{w.name}</span>,
      },
      { key: "status", label: "Status", width: "110px", render: (w) => <WorkflowStatusChip status={w.status} /> },
      {
        key: "when",
        k: "when",
        label: "When",
        width: "minmax(220px,1.6fr)",
        render: (w) => {
          if (!w.triggerEvent) return <span className="text-ink-3">No trigger</span>;
          const t = triggerByKey.get(w.triggerEvent);
          return (
            <span className="flex min-w-0 items-center gap-1.5">
              <span className="truncate">{t ? `When ${t.phrase}` : "A trigger that no longer exists"}</span>
              {t && !t.isEmitting ? <NeutralChip title="This trigger does not fire yet">Not live yet</NeutralChip> : null}
            </span>
          );
        },
      },
      {
        key: "where",
        k: "where",
        label: "Where",
        width: "140px",
        render: (w) => <span className="block max-w-[140px] truncate text-ink-2" title={whereWords(w.where)}>{whereWords(w.where)}</span>,
      },
      {
        key: "lastRun",
        k: "lastRun",
        label: "Last run",
        width: "110px",
        render: (w) => w.lastRunAt
          ? <span className="text-ink-2" title={formatDate(w.lastRunAt, datePrefs, "datetime")}>{formatRelative(w.lastRunAt, datePrefs)}</span>
          : <span className="text-ink-2">Never</span>,
      },
      {
        key: "success",
        k: "success",
        label: "Success",
        width: "112px",
        numeric: true,
        render: (w) => w.successRate === null
          ? <span className="whitespace-nowrap text-ink-3">No runs yet</span>
          : <span title={`${w.successRuns} of ${w.terminalRuns} runs succeeded`}>{w.successRate}%</span>,
      },
      {
        key: "createdBy",
        k: "createdBy",
        label: "Created by",
        width: "130px",
        render: (w) => (
          <span className="flex min-w-0 items-center gap-2">
            {w.createdById ? <PersonAvatar person={{ id: w.createdById, firstName: w.createdByName, lastName: null, avatar: w.createdByAvatar }} size={24} /> : null}
            <span className="truncate text-ink-2">{firstName(w.createdByName)}</span>
          </span>
        ),
      },
    ];
    return all.filter((c) => !c.k || columns.includes(c.k));
  }, [columns, triggerByKey, datePrefs]);

  const offset = data?.offset ?? 0;
  const total = data?.total ?? 0;
  const selectableAny = (rows ?? []).some((r) => r.can.edit);
  const pickedRows = (rows ?? []).filter((r) => selected.has(r.id));
  const container = data?.container ?? null;
  const hasAnyFilter = activeFilters > 0 || view !== "all" || Boolean(listId || folderId || spaceId);

  // Clears everything that narrows the list, the Space, Folder or List a
  // "..." menu arrived with included, so the link always changes something.
  const clearFilters = () => setParams({ createdBy: null, trigger: null, where: null, severity: null, status: null, listId: null, folderId: null, spaceId: null });
  const toggleFilter = (key: FilterKey, value: string, on: boolean) => {
    const next = new Set(filters[key]);
    if (on) next.add(value);
    else next.delete(value);
    setParams({ [key]: [...next].join(",") || null });
  };
  const needle = filterSearch.trim().toLowerCase();
  const fieldMatch = (label: string) => label.toLowerCase().includes(needle);
  // The Where group also answers a search for a place's own name, so every
  // Space, Folder and List the viewer can read is reachable, not only the
  // first sixty.
  const whereGroupMatch = fieldMatch("where it runs");
  const placeHit = (name: string) => whereGroupMatch || name.toLowerCase().includes(needle);
  const whereSpaces = (places?.spaces ?? []).filter((p) => placeHit(p.name) || filters.where.includes(p.id));
  const whereFolders = (places?.folders ?? []).filter((p) => placeHit(p.name) || filters.where.includes(p.id));
  const whereListsAll = (places?.lists ?? []).filter((p) => placeHit(p.name) || filters.where.includes(p.id));
  const whereLists = needle && !whereGroupMatch ? whereListsAll : whereListsAll.slice(0, WHERE_LIST_CAP);
  const whereListsHidden = whereListsAll.length - whereLists.length;
  const showWhere = whereGroupMatch || whereSpaces.length + whereFolders.length + whereListsAll.length > 0;

  const displayMenu = [
    ...COLUMN_KEYS.map((k) => ({
      label: COLUMN_LABEL[k],
      checked: columns.includes(k),
      keepOpen: true,
      onClick: () => {
        const next = columns.includes(k) ? columns.filter((c) => c !== k) : COLUMN_KEYS.filter((c) => c === k || columns.includes(c));
        setSurface({ columns: next.length ? next : [...COLUMN_KEYS] });
      },
    })),
    { separator: true as const },
    {
      label: "Show archived",
      checked: showArchived,
      keepOpen: true,
      onClick: () => {
        setSurface({ viewOptions: { showArchived: !showArchived } });
        setParams({ cursor: null });
      },
    },
  ];

  const containerKindWord = container?.kind === "folder" ? "Folder" : container?.kind === "space" ? "Space" : "List";
  const containerLabel = container ? container.name ?? `A ${containerKindWord} you can't open` : null;
  const firstLoad = rows === null;
  const empty = !firstLoad && !error && total === 0 && !hasAnyFilter && !showArchived;

  return (
    <>
      <OsPageHeader
        title="Workflows"
        titleSlot={containerLabel ? (
          <span className="flex min-w-0 items-center gap-2">
            <h1 className="m-0 truncate text-title font-semibold text-ink">Workflows</h1>
            <NeutralChip className="pe-0.5" title={`Only automations that run in this ${containerKindWord}`}>
              <span className="max-w-[200px] truncate">{containerLabel}</span>
              <button
                type="button"
                aria-label="Show every automation"
                onClick={() => setParams({ listId: null, folderId: null, spaceId: null })}
                className="inline-flex size-5 items-center justify-center rounded text-ink-2 hover:bg-hover hover:text-ink"
              >
                <X className="size-3.5" aria-hidden />
              </button>
            </NeutralChip>
          </span>
        ) : undefined}
        views={
          <>
            {WORKFLOW_VIEWS.map((v) => (
              <ViewTab key={v} label={VIEW_LABEL[v]} active={view === v} onClick={() => setParams({ status: v === "all" ? null : v })} />
            ))}
          </>
        }
        toolbar={{
          filter: { open: filterOpen, onToggle: () => setFilterOpen((o) => !o), count: activeFilters },
          sort: { onClick: () => setSortOpen((o) => !o), label: SORT_LABEL[sort], active: sort !== "updated" },
          left: (
            <div className="relative">
              <Picker
                open={sortOpen}
                onClose={() => setSortOpen(false)}
                ariaLabel="Sort automations"
                width={200}
                selected={sort}
                onSelect={(v) => {
                  setSortOpen(false);
                  setSurface({ sortKey: v });
                  setParams({ cursor: null });
                }}
                sections={[{ options: WORKFLOW_SORTS.map((s) => ({ value: s, label: SORT_LABEL[s] })) }]}
              />
            </div>
          ),
          primary: canCreate
            ? {
                label: "New automation",
                onClick: () => { setNameError(null); setNameDialog({ mode: "create" }); },
                split: { label: "From a template", onClick: () => router.push("/automation/templates") },
              }
            : undefined,
          menu: displayMenu,
        }}
      />

      <div className="px-6 pb-10 pt-2">
        <div className="os-chrome">
        {data?.paused ? (
          <div role="status" className="mb-2 flex h-11 items-center gap-2 rounded-lg bg-warning-bg px-3 text-row text-warning-text">
            <CircleAlert className="size-4 shrink-0" aria-hidden />
            <span>Automations are paused for this workspace.</span>
            {isAdmin ? <span className="text-sm">Nothing runs until you turn them back on in Settings, under Apps and modules.</span> : null}
          </div>
        ) : null}

        {empty ? (
          <OsEmptyView
            title="No automations yet"
            hint="When something happens, an automation checks a condition and does the next thing for you."
            action={{ label: "Start from a template", href: "/automation/templates" }}
          />
        ) : (
          <div className="flex min-h-0 gap-4">
            <FilterPanel
              open={filterOpen}
              onClose={() => setFilterOpen(false)}
              objects="automations"
              activeCount={activeFilters}
              onClearAll={() => setParams({ createdBy: null, trigger: null, where: null, severity: null })}
              search={{ value: filterSearch, onChange: setFilterSearch, placeholder: "Search fields" }}
            >
              {fieldMatch("created by") ? (
                <FilterGroup label="Created by">
                  {(data?.creators ?? []).length === 0 ? <span className="px-2 text-sm text-ink-3">Nobody yet</span> : (data?.creators ?? []).map((c) => (
                    <FilterRow key={c.id} label={c.name} checked={filters.createdBy.includes(c.id)} onCheckedChange={(on) => toggleFilter("createdBy", c.id, on)} />
                  ))}
                </FilterGroup>
              ) : null}
              {fieldMatch("trigger") ? (
                <FilterGroup label="Trigger">
                  {catalog.triggers.filter((t) => !t.hidden || filters.trigger.includes(t.key)).map((t) => (
                    <FilterRow key={t.key} label={t.name} checked={filters.trigger.includes(t.key)} onCheckedChange={(on) => toggleFilter("trigger", t.key, on)} />
                  ))}
                </FilterGroup>
              ) : null}
              {showWhere ? (
                <FilterGroup label="Where it runs">
                  {whereGroupMatch ? <FilterRow label="Everywhere" checked={filters.where.includes("everywhere")} onCheckedChange={(on) => toggleFilter("where", "everywhere", on)} /> : null}
                  {whereSpaces.map((s) => (
                    <FilterRow key={s.id} label={s.name} checked={filters.where.includes(s.id)} onCheckedChange={(on) => toggleFilter("where", s.id, on)} />
                  ))}
                  {whereFolders.map((f) => (
                    <FilterRow key={f.id} label={f.name} checked={filters.where.includes(f.id)} onCheckedChange={(on) => toggleFilter("where", f.id, on)} />
                  ))}
                  {whereLists.map((l) => (
                    <FilterRow key={l.id} label={l.name} checked={filters.where.includes(l.id)} onCheckedChange={(on) => toggleFilter("where", l.id, on)} />
                  ))}
                  {whereListsHidden > 0 ? (
                    <span className="block px-2 py-1 text-sm text-ink-3">{whereListsHidden} more Lists. Search by name to find one.</span>
                  ) : null}
                </FilterGroup>
              ) : null}
              {fieldMatch("alert level") ? (
                <FilterGroup label="Alert level">
                  {ALERT_LEVELS.map((a) => (
                    <FilterRow key={a} label={ALERT_LABEL[a]} checked={filters.severity.includes(a)} onCheckedChange={(on) => toggleFilter("severity", a, on)} />
                  ))}
                </FilterGroup>
              ) : null}
            </FilterPanel>

            <div className="flex min-w-0 flex-1 flex-col">
              {placeGone ? (
                <InlineRow action={{ label: "Dismiss", onClick: () => setPlaceGone(false) }}>That place no longer exists, so this is every automation</InlineRow>
              ) : null}
              {error && (rows ?? []).length === 0 ? (
                <InlineRow action={{ label: "Try again", onClick: () => void load() }}>Couldn&apos;t load automations</InlineRow>
              ) : (
                <TableCard
                  ariaLabel="Automations"
                  columns={tableColumns}
                  rows={rows}
                  rowKey={(w) => w.id}
                  rowHref={(w) => `/automation/workflows/${w.id}`}
                  selectable={selectableAny}
                  isRowSelectable={(w) => w.can.edit}
                  selected={selected}
                  onSelectedChange={setSelected}
                  rowMenu={(w) => (
                    <RowMoreButton
                      label={`Actions for ${w.name}`}
                      open={menu?.row.id === w.id}
                      onClick={(e) => setMenu({ row: w, anchor: { current: e.currentTarget } })}
                    />
                  )}
                  empty={
                    <span>
                      No automations match ·{" "}
                      <button type="button" className="text-brand-deep hover:underline" onClick={clearFilters}>
                        Clear filters
                      </button>
                    </span>
                  }
                  footer={rows && total > 0 ? {
                    total,
                    noun: "records",
                    from: offset + 1,
                    to: offset + rows.length,
                    onPrev: offset > 0 ? () => setParams({ cursor: offset - pageSize > 0 ? String(offset - pageSize) : null }) : undefined,
                    onNext: data?.nextCursor ? () => setParams({ cursor: data.nextCursor }) : undefined,
                    pageSize,
                    pageSizes: PAGE_SIZES,
                    onPageSize: (n) => { setSurface({ viewOptions: { pageSize: n } }); setParams({ cursor: null }); },
                  } : undefined}
                  bulkActions={
                    <>
                      <BulkAction icon={Play} label="Activate" onClick={() => void bulk("activate")} disabled={!pickedRows.some((r) => r.publishedVersionId && r.status !== "ACTIVE" && r.status !== "ARCHIVED")} />
                      <BulkAction icon={Pause} label="Deactivate" onClick={() => void bulk("deactivate")} disabled={!pickedRows.some((r) => r.status === "ACTIVE")} />
                      {canCreate ? <BulkAction icon={Copy} label="Duplicate" onClick={() => void bulk("duplicate")} /> : null}
                      {pickedRows.some((r) => r.can.archive && r.status !== "ARCHIVED") ? <BulkAction icon={Archive} label="Archive" destructive onClick={() => void bulk("archive")} /> : null}
                    </>
                  }
                />
              )}
            </div>
          </div>
        )}
        </div>
      </div>

      {menu ? (
        <MorePortal anchorRef={menu.anchor} width={220} open placement="below" onClose={() => setMenu(null)}>
          <MenuList aria-label={`Actions for ${menu.row.name}`}>
            {(() => {
              const w = menu.row;
              const close = () => setMenu(null);
              const archived = w.status === "ARCHIVED";
              const canActivate = w.can.edit && !archived && w.status !== "ACTIVE" && Boolean(w.publishedVersionId);
              return (
                <>
                  {w.can.edit ? <MenuItem icon={Pencil} label="Edit" href={`/automation/workflows/${w.id}`} onClick={close} /> : null}
                  {canCreate && !archived ? <MenuItem icon={Copy} label="Duplicate" onClick={() => { close(); void duplicate(w); }} /> : null}
                  {w.can.edit && w.status === "ACTIVE" ? <MenuItem icon={Pause} label="Deactivate" onClick={() => { close(); void setActive(w, false); }} /> : null}
                  {canActivate ? <MenuItem icon={Play} label="Activate" onClick={() => { close(); void setActive(w, true); }} /> : null}
                  <MenuItem icon={ScrollText} label="View logs" href={`/automation/logs?workflowId=${w.id}`} onClick={close} />
                  {w.can.edit ? <MenuItem icon={Type} label="Rename" onClick={() => { close(); setNameError(null); setNameDialog({ mode: "rename", row: w }); }} /> : null}
                  {w.can.archive && !archived ? (
                    <>
                      <MenuSeparator />
                      <MenuItem icon={Archive} label="Archive" destructive onClick={() => { close(); void confirmArchive(w); }} />
                    </>
                  ) : null}
                  {w.can.archive && archived ? <MenuItem icon={ArchiveRestore} label="Bring back" onClick={() => { close(); void unarchive(w); }} /> : null}
                </>
              );
            })()}
          </MenuList>
        </MorePortal>
      ) : null}

      <NameDialog
        open={nameDialog !== null}
        title={nameDialog?.mode === "rename" ? "Rename automation" : "New automation"}
        initial={nameDialog?.mode === "rename" ? nameDialog.row.name : ""}
        submitLabel={nameDialog?.mode === "rename" ? "Rename" : "Create"}
        busy={nameBusy}
        error={nameError}
        onClose={() => setNameDialog(null)}
        onSubmit={(name) => {
          if (nameDialog?.mode === "rename") void rename(nameDialog.row, name);
          else void create(name);
        }}
      />
    </>
  );
}

export default function AutomationWorkflowsPage() {
  return (
    <Suspense fallback={null}>
      <WorkflowsInner />
    </Suspense>
  );
}
