"use client";

/* /forms (spec-tables-forms section 2): every form I can open, what each one
 * collects into, and how many people have answered.
 *
 *   header   title "Forms" · views All · Mine · Shared with me · Favorites
 *            (the deleted FormsSidebar's dead "My Forms" ?mine=1 row is the
 *            "Mine" view, which this page actually reads) · toolbar Filter,
 *            Sort, search, the one blue "New form" split (Blank form, From a
 *            List..., Describe it with AI... when the AI hub is entitled), the
 *            bordered "..." (Display, Export list as CSV, Trash)
 *   body     FilterPanel (Goes to, Owner, Status, Updated, Public link) +
 *            TableCard: checkbox · Name · Goes to · Responses · Status ·
 *            Owner · Last updated · row "..." (FormRowMenu); bulk bar; footer
 *
 *   GET  /api/forms?view=&q=&goesTo=&owner=&status=&public=&updatedFrom=
 *        &updatedTo=&sort=&dir=&cursor=&limit=
 *   POST /api/forms { name: "Untitled form" }, then /forms/[id]?new=1
 *
 * Creation is promptless (the "Form name?" prompt dialog is gone): the name
 * is edited inline in the builder. `/forms?new=1` is not read.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import {
  ClipboardList, Download, Globe, LayoutGrid, ListChecks, Search, SlidersHorizontal, Sparkles, Star, Table2, Trash2, User, Users,
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
import { MenuItem } from "@/components/ui/menu";
import { BulkAction, RowMoreButton, TableCard, type TableColumn } from "@/components/ui/table-card";
import { SplitPrimary } from "@/components/ui/split-primary";
import { EntityTile, NEUTRAL_TILE } from "@/components/ui/entity-tile";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { Dots } from "@/components/ui/dots";
import { PersonAvatar, type PersonRef } from "@/components/board-view/assignee-picker";
import { FormRowMenuHost, dispatchFormsChanged, useFormRowMenu, type FormMenuTarget } from "@/components/forms/form-row-menu";
import { apiFetch } from "@/lib/api-fetch";
import { useFormat } from "@/lib/format/use-date-prefs";
import { readFormsColumns, FORMS_LIST_COLUMNS, type FormsListColumn } from "@/lib/tables-prefs";
import { toCsvMatrix } from "@/lib/csv";
import { fieldFromDestination, questionTypeForListField } from "@/lib/forms/builder";
import { downloadUrl } from "@/lib/download";
import type { FormStatus, FormsSort, ObjectListView } from "@/lib/tables-forms-list";
import { cn } from "@/lib/utils";
import { useRetiredView } from "@/components/layout/os/use-retired-view";

/* ───────────────────────────── types ───────────────────────────── */

type Owner = (PersonRef & { name: string | null }) | null;
/** href null: a List or table the viewer cannot open, named "A private List"
 *  by the server (lib/forms/destination-reach), shown without a link. */
type Destination = { kind: "list" | "table"; id: string; name: string; href: string | null } | null;
type FormRow = {
  id: string;
  name: string;
  description: string | null;
  destination: Destination;
  createdById: string | null;
  owner: Owner;
  status: FormStatus;
  responseCount: number;
  hasPublicLink: boolean;
  isFavorite: boolean;
  canManage: boolean;
  updatedAt: string;
};
type ListResponse = { data: FormRow[]; total: number; nextCursor: string | null; counts?: Record<ObjectListView, number> };
type ListPick = { id: string; name: string; spaceName?: string | null };

const VIEW_LABEL: Record<ObjectListView, string> = { all: "All", mine: "Mine", shared: "Shared with me", favorites: "Favorites" };
const VIEWS: Array<{ key: ObjectListView; Icon: typeof ClipboardList }> = [
  { key: "all", Icon: LayoutGrid },
  { key: "mine", Icon: User },
  { key: "shared", Icon: Users },
  { key: "favorites", Icon: Star },
];
const SORTS: Array<{ key: FormsSort; label: string }> = [
  { key: "updated", label: "Last updated" },
  { key: "name", label: "Name" },
  { key: "responses", label: "Responses" },
  { key: "owner", label: "Owner" },
];
const STATUS_LABEL: Record<FormStatus, string> = { open: "Open", closed: "Closed", "needs-destination": "Needs a destination" };
// A pale status label (design-system 5.9: a tinted fill, never a faded one)
// on the semantic tokens: success, neutral, warning. A label, not a control,
// so it is a span with no handler (the StatusChip primitive is a button).
const STATUS_TONE: Record<FormStatus, string> = {
  open: "bg-success-bg text-success-text",
  closed: "bg-subtle text-ink-2",
  "needs-destination": "bg-warning-bg text-warning-text",
};
const STATUS_DOT: Record<FormStatus, string> = { open: "bg-success-solid", closed: "bg-[var(--os-ink-3)]", "needs-destination": "bg-warning-solid" };
const COLUMN_LABEL: Record<FormsListColumn, string> = { goesTo: "Goes to", responses: "Responses", status: "Status", owner: "Owner", updated: "Last updated" };
const PAGE_SIZES = [40, 100];

const isView = (v: string | null): v is ObjectListView => !!v && v in VIEW_LABEL;
const isSort = (v: string | null): v is FormsSort => !!v && SORTS.some((s) => s.key === v);
function personName(p: PersonRef | null | undefined): string {
  if (!p) return "";
  return `${p.firstName ?? ""} ${p.lastName ?? ""}`.trim() || p.email || "";
}
function newFieldId() { return Math.random().toString(36).slice(2, 10); }

export default function FormsPage() {
  const router = useRouter();
  const params = useSearchParams();
  const { rowVersion, prefs, patchPrefs, railApps } = useOsShell();
  const { boot } = useBoot();
  const { toast } = useOsToast();
  const confirm = useConfirm();
  const fmt = useFormat();
  const isAgent = boot.viewer.isAgent;
  const aiEntitled = railApps.some((a) => a.key === "ai");
  const tablesOn = Array.isArray(prefs.modules?.activeAppKeys) && prefs.modules.activeAppKeys.includes("tables");

  // /forms?mine=1 (the deleted FormsSidebar "My Forms" row) becomes ?view=mine.
  useRetiredView();

  /* ── URL state ── */
  const view: ObjectListView = isView(params.get("view")) ? (params.get("view") as ObjectListView) : "all";
  const q = params.get("q") ?? "";
  const sort: FormsSort = isSort(params.get("sort")) ? (params.get("sort") as FormsSort) : "updated";
  const dir: "asc" | "desc" = params.get("dir") === "asc" || params.get("dir") === "desc" ? (params.get("dir") as "asc" | "desc") : (sort === "name" || sort === "owner" ? "asc" : "desc");
  const goesTo = params.get("goesTo");
  const owner = params.get("owner");
  const status = params.get("status");
  const publicLink = params.get("public");
  const updatedFrom = params.get("updatedFrom");
  const updatedTo = params.get("updatedTo");
  const cursor = params.get("cursor");
  const limitRaw = Number(params.get("limit"));
  const limit = PAGE_SIZES.includes(limitRaw) ? limitRaw : PAGE_SIZES[0];

  const [cursorStack, setCursorStack] = useState<string[]>([]);
  const pageIndex = cursorStack.length;
  const setParams = useCallback((patch: Record<string, string | null>, opts?: { keepCursor?: boolean }) => {
    const next = new URLSearchParams(params.toString());
    for (const [k, v] of Object.entries(patch)) {
      if (v === null || v === "") next.delete(k);
      else next.set(k, v);
    }
    if (!opts?.keepCursor) { next.delete("cursor"); setCursorStack([]); }
    const s = next.toString();
    router.push(s ? `/forms?${s}` : "/forms");
  }, [params, router]);
  const activeFilters = [goesTo, owner, status, publicLink, updatedFrom || updatedTo ? "updated" : null].filter(Boolean).length;

  /* ── data ── */
  const [rows, setRows] = useState<FormRow[] | null>(null);
  const [total, setTotal] = useState(0);
  const [counts, setCounts] = useState<Record<ObjectListView, number> | null>(null);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [loadError, setLoadError] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());

  const queryString = useMemo(() => {
    const qs = new URLSearchParams({ view, sort, dir, limit: String(limit) });
    if (q) qs.set("q", q);
    if (goesTo) qs.set("goesTo", goesTo);
    if (owner) qs.set("owner", owner);
    if (status) qs.set("status", status);
    if (publicLink) qs.set("public", publicLink);
    if (updatedFrom) qs.set("updatedFrom", updatedFrom);
    if (updatedTo) qs.set("updatedTo", updatedTo);
    if (cursor) qs.set("cursor", cursor);
    return qs.toString();
  }, [view, sort, dir, limit, q, goesTo, owner, status, publicLink, updatedFrom, updatedTo, cursor]);

  const load = useCallback(async () => {
    const r = await apiFetch<ListResponse>(`/api/forms?${queryString}`, { cache: "no-store" });
    if (!r.ok) { setLoadError(true); console.warn(`GET /api/forms: ${r.status} ${r.error}`); return; }
    setLoadError(false);
    setRows(r.data.data);
    setTotal(r.data.total);
    setNextCursor(r.data.nextCursor);
    if (r.data.counts) setCounts(r.data.counts);
    setSelected(new Set());
  }, [queryString]);
  useEffect(() => { const t = setTimeout(() => void load(), 0); return () => clearTimeout(t); }, [load]);
  const rv = rowVersion("forms");
  useEffect(() => { if (rv <= 0) return; const t = setTimeout(() => void load(), 0); return () => clearTimeout(t); }, [rv, load]);
  useEffect(() => {
    const onChange = () => { void load(); };
    window.addEventListener("workwrk:forms-changed", onChange);
    window.addEventListener("workwrk:favs-changed", onChange);
    window.addEventListener("focus", onChange);
    return () => {
      window.removeEventListener("workwrk:forms-changed", onChange);
      window.removeEventListener("workwrk:favs-changed", onChange);
      window.removeEventListener("focus", onChange);
    };
  }, [load]);

  const from = total === 0 ? 0 : pageIndex * limit + 1;
  const to = Math.min(total, pageIndex * limit + (rows?.length ?? 0));
  const goNext = nextCursor ? () => { setCursorStack((st) => [...st, cursor ?? ""]); setParams({ cursor: nextCursor }, { keepCursor: true }); } : undefined;
  const goPrev = cursor ? () => { const prev = cursorStack[cursorStack.length - 1] ?? ""; setCursorStack((st) => st.slice(0, -1)); setParams({ cursor: prev || null }, { keepCursor: true }); } : undefined;

  /* ── filter options ── */
  const [filterOpen, setFilterOpen] = useState(false);
  const [filterSearch, setFilterSearch] = useState("");
  const [sortOpen, setSortOpen] = useState(false);
  const [ownerPickOpen, setOwnerPickOpen] = useState(false);
  const [goesToOpen, setGoesToOpen] = useState(false);
  const [people, setPeople] = useState<PersonRef[] | null>(null);
  const [lists, setLists] = useState<ListPick[] | null>(null);
  const [tables, setTables] = useState<{ id: string; name: string }[]>([]);
  const [fromListOpen, setFromListOpen] = useState(false);
  useEffect(() => {
    if ((!filterOpen && !fromListOpen) || lists !== null) return;
    let live = true;
    void (async () => {
      const [l, t, p] = await Promise.all([
        apiFetch<{ data: ListPick[] }>("/api/lists/pick?limit=100", { cache: "no-store" }),
        tablesOn ? apiFetch<{ id: string; name: string }[]>("/api/tables", { cache: "no-store" }) : Promise.resolve(null),
        apiFetch<{ data: PersonRef[] }>("/api/users?scope=all&limit=200", { cache: "no-store" }),
      ]);
      if (!live) return;
      setLists(l.ok ? l.data.data ?? [] : []);
      setTables(t && t.ok && Array.isArray(t.data) ? t.data.map((x) => ({ id: x.id, name: x.name })) : []);
      setPeople(p.ok && Array.isArray(p.data?.data) ? p.data.data : []);
    })();
    return () => { live = false; };
  }, [filterOpen, fromListOpen, lists, tablesOn]);

  /* ── create ── */
  const [creating, setCreating] = useState(false);
  const createForm = useCallback(async (body: Record<string, unknown> = {}) => {
    if (creating) return;
    setCreating(true);
    const r = await apiFetch<{ id: string }>("/api/forms", { method: "POST", json: { name: "Untitled form", fields: [], ...body } });
    setCreating(false);
    if (!r.ok) { toast(r.error || "Couldn't create the form", { tone: "danger" }); return; }
    dispatchFormsChanged();
    router.push(`/forms/${r.data.id}?new=1`);
  }, [creating, router, toast]);

  // "From a List...": a form whose fields mirror that List's own fields
  // (spec /forms), each mapped to the field it came from, after a required
  // Title (the task's name). A field type a form cannot ask (a formula, a
  // relation, a status) is left out. A List with no askable fields keeps the
  // old pair, Title and Details, so the form is never empty.
  const createFromList = async (list: ListPick) => {
    setFromListOpen(false);
    const r = await apiFetch<{ fields?: Array<{ key: string; label: string; type: string; options?: { choices?: Array<{ label: string }> } }> }>(`/api/boards/${list.id}/fields`, { cache: "no-store" });
    const title = { id: newFieldId(), type: "short_text", label: "Title", required: true };
    const board: Record<string, string> = {};
    const mirrored: Array<Record<string, unknown>> = [];
    for (const lf of r.ok ? r.data.fields ?? [] : []) {
      const t = questionTypeForListField(lf.type);
      if (!t || !lf.label?.trim() || lf.label.trim().toLowerCase() === "title") continue;
      const f = fieldFromDestination({ label: lf.label, type: t, options: lf.options?.choices?.map((c) => c.label) }, newFieldId());
      mirrored.push({ ...f });
      board[f.id] = lf.key;
    }
    void createForm({
      name: `${list.name} intake`,
      targetBoardId: list.id,
      fields: mirrored.length
        ? [title, ...mirrored]
        : [title, { id: newFieldId(), type: "long_text", label: "Details", required: false }],
      ...(mirrored.length ? { fieldMappings: { board } } : {}),
    });
  };

  /* ── Describe it with AI ── */
  const [aiOpen, setAiOpen] = useState(false);
  const [aiPrompt, setAiPrompt] = useState("");
  const [aiBusy, setAiBusy] = useState(false);
  const [aiError, setAiError] = useState<string | null>(null);
  async function generate() {
    if (aiBusy || !aiPrompt.trim()) return;
    setAiBusy(true);
    setAiError(null);
    const gen = await apiFetch<{ name?: string; description?: string; fields?: Record<string, unknown>[] }>("/api/forms/generate", { method: "POST", json: { prompt: aiPrompt.trim() } });
    if (!gen.ok) { setAiBusy(false); setAiError(gen.error || "We could not generate that form."); return; }
    const fields = (gen.data.fields ?? []).map((f) => ({ ...f, id: newFieldId() }));
    const r = await apiFetch<{ id: string }>("/api/forms", { method: "POST", json: { name: gen.data.name || "Untitled form", description: gen.data.description ?? null, fields } });
    setAiBusy(false);
    if (!r.ok) { setAiError(r.error || "We could not create the form."); return; }
    setAiOpen(false);
    setAiPrompt("");
    dispatchFormsChanged();
    router.push(`/forms/${r.data.id}?new=1`);
  }

  /* ── row menu ── */
  const menu = useFormRowMenu();
  const toTarget = (f: FormRow): FormMenuTarget => ({
    id: f.id, name: f.name, isFavorite: f.isFavorite, isPublic: f.hasPublicLink, canManage: f.canManage,
    responseCount: f.responseCount, destinationName: f.destination?.name ?? null,
    ownerName: f.owner ? f.owner.name ?? personName(f.owner) : null,
  });
  const toggleFav = useCallback(async (f: FormRow) => {
    const next = !f.isFavorite;
    setRows((prev) => prev?.map((r) => (r.id === f.id ? { ...r, isFavorite: next } : r)) ?? prev);
    const r = await apiFetch("/api/me/favorites/forms", { method: "POST", json: { formId: f.id, on: next } });
    if (!r.ok) { setRows((prev) => prev?.map((x) => (x.id === f.id ? { ...x, isFavorite: !next } : x)) ?? prev); toast("Couldn't update favorites", { tone: "danger" }); return; }
    window.dispatchEvent(new CustomEvent("workwrk:favs-changed"));
  }, [toast]);

  /* ── bulk ── */
  const selectedRows = useMemo(() => (rows ?? []).filter((r) => selected.has(r.id)), [rows, selected]);
  async function bulkFavorite() {
    const ids = [...selected];
    await Promise.allSettled(ids.map((id) => apiFetch("/api/me/favorites/forms", { method: "POST", json: { formId: id, on: true } })));
    window.dispatchEvent(new CustomEvent("workwrk:favs-changed"));
    toast(`Added ${ids.length} form${ids.length === 1 ? "" : "s"} to favorites`);
    setSelected(new Set());
    void load();
  }
  // `only` is the one focused row (Cmd+Backspace on the list), else the selection.
  async function bulkTrash(only?: FormRow[]) {
    const pick = (only ?? selectedRows).filter((r) => r.canManage);
    if (pick.length === 0) { toast("Only the person who made a form, or an admin, can move it to Trash"); return; }
    const responses = pick.reduce((n, r) => n + r.responseCount, 0);
    const ok = await confirm({
      title: `Move ${pick.length} form${pick.length === 1 ? "" : "s"} to Trash?`,
      description: `${responses ? `Their ${responses.toLocaleString()} response${responses === 1 ? "" : "s"} go with them. ` : ""}You can restore them for ${boot.org.trashDays} days.`,
      destructive: true,
      confirmLabel: "Move to Trash",
    });
    if (!ok) return;
    const results = await Promise.allSettled(pick.map((r) => apiFetch(`/api/forms/${r.id}`, { method: "DELETE" })));
    const failed = results.filter((r) => r.status === "rejected" || !r.value.ok).length;
    toast(failed ? `Moved ${pick.length - failed}, ${failed} failed` : "Moved to Trash", failed ? { tone: "danger" } : { action: { label: "View Trash", onClick: () => router.push("/trash?type=form") } });
    setSelected(new Set());
    dispatchFormsChanged();
    void load();
  }
  function bulkExport() {
    for (const r of selectedRows) downloadUrl(`/api/forms/${r.id}/responses/export.csv`);
  }
  async function exportList() {
    const out: FormRow[] = [];
    let c: string | null = null;
    for (let guard = 0; guard < 100; guard++) {
      const qs = new URLSearchParams(queryString);
      qs.set("limit", "100");
      if (c) qs.set("cursor", c); else qs.delete("cursor");
      const r = await apiFetch<ListResponse>(`/api/forms?${qs.toString()}`, { cache: "no-store" });
      if (!r.ok) { toast("Couldn't export the list", { tone: "danger" }); return; }
      out.push(...r.data.data);
      c = r.data.nextCursor;
      if (!c) break;
    }
    const csv = toCsvMatrix([
      ["Name", "Goes to", "Responses", "Status", "Owner", "Last updated"],
      ...out.map((f) => [f.name, f.destination?.name ?? "Nowhere yet", f.responseCount, STATUS_LABEL[f.status], f.owner ? f.owner.name ?? personName(f.owner) : "", f.updatedAt]),
    ]);
    const url = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8" }));
    const a = document.createElement("a");
    a.href = url;
    a.download = `forms-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  /* ── columns (Display) ── */
  const cols = readFormsColumns(prefs.home);
  const [displayOpen, setDisplayOpen] = useState(false);
  const toggleColumn = (key: string) => {
    const next = { ...cols, [key]: !cols[key as FormsListColumn] };
    void patchPrefs({ home: { forms: { columns: next } } });
  };

  const columns = useMemo<TableColumn<FormRow>[]>(() => {
    const out: TableColumn<FormRow>[] = [
      {
        key: "name", label: "Name", title: true, sortable: true, width: "minmax(240px,2fr)",
        render: (f) => (
          <span className="group/name flex min-w-0 flex-1 items-center gap-2">
            <EntityTile size="sm" name={f.name} fallback="form" {...NEUTRAL_TILE} />
            <span className="truncate">{f.name || "Untitled form"}</span>
            {f.hasPublicLink ? <span title="Public link is on" className="inline-flex shrink-0"><Globe className="h-3 w-3 text-ink-2" strokeWidth={1.5} aria-label="Public link is on" /></span> : null}
            <button
              type="button"
              onClick={(e) => { e.preventDefault(); e.stopPropagation(); void toggleFav(f); }}
              aria-label={f.isFavorite ? "Remove from favorites" : "Add to favorites"}
              aria-pressed={f.isFavorite}
              title={f.isFavorite ? "Remove from favorites" : "Add to favorites"}
              className={cn("ms-auto inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-md hover:bg-active", f.isFavorite ? "text-ink" : "text-ink-3 opacity-0 group-hover/row:opacity-100 focus-visible:opacity-100")}
            >
              <Star className="h-4 w-4" strokeWidth={1.5} style={f.isFavorite ? { fill: "currentColor" } : undefined} aria-hidden />
            </button>
          </span>
        ),
      },
    ];
    if (cols.goesTo) out.push({
      key: "goesTo", label: "Goes to", width: "220px",
      headerFilter: (
        <button type="button" onClick={(e) => { e.stopPropagation(); setFilterOpen(true); }} className="text-sm font-normal text-ink-2 hover:text-ink">{goesTo ? "1 ▾" : "All ▾"}</button>
      ),
      render: (f) => f.destination && !f.destination.href ? (
        <span className="inline-flex min-w-0 items-center gap-1.5 text-ink-2" title={f.destination.name}>
          {f.destination.kind === "list" ? <ListChecks className="h-3 w-3 shrink-0 text-ink-2" strokeWidth={1.5} aria-hidden /> : <Table2 className="h-3 w-3 shrink-0 text-ink-2" strokeWidth={1.5} aria-hidden />}
          <span className="truncate">{f.destination.name}</span>
        </span>
      ) : f.destination?.href ? (
        // The row itself is already an <a> to the form, and an <a> inside an
        // <a> is invalid HTML that React flags as a hydration error. So the
        // destination is a button that behaves like a link: Tab reaches it,
        // Enter or a click opens it here, and a middle, Cmd or Ctrl click
        // opens it in a new tab. Every handler stops the event and cancels the
        // default, or the row's own link would open the form as well.
        <button
          type="button"
          role="link"
          onClick={(e) => {
            e.preventDefault(); e.stopPropagation();
            const href = f.destination!.href!;
            if (e.metaKey || e.ctrlKey || e.shiftKey) window.open(href, "_blank", "noopener");
            else router.push(href);
          }}
          onMouseDown={(e) => { if (e.button === 1) { e.preventDefault(); e.stopPropagation(); } }}
          onAuxClick={(e) => {
            if (e.button !== 1) return;
            e.preventDefault(); e.stopPropagation();
            window.open(f.destination!.href!, "_blank", "noopener");
          }}
          onKeyDown={(e) => e.stopPropagation()}
          className="inline-flex min-w-0 items-center gap-1.5 rounded-sm text-start text-ink hover:underline focus:outline-none focus-visible:ring-2 focus-visible:ring-focus"
          title={f.destination.name}
        >
          {f.destination.kind === "list" ? <ListChecks className="h-3 w-3 shrink-0 text-ink-2" strokeWidth={1.5} aria-hidden /> : <Table2 className="h-3 w-3 shrink-0 text-ink-2" strokeWidth={1.5} aria-hidden />}
          <span className="truncate">{f.destination.name}</span>
        </button>
      ) : <span className="text-ink-2">Nowhere yet</span>,
    });
    if (cols.responses) out.push({ key: "responses", label: "Responses", sortable: true, numeric: true, width: "110px", render: (f) => <span className="tabular-nums">{fmt.count(f.responseCount)}</span> });
    if (cols.status) out.push({ key: "status", label: "Status", width: "180px", render: (f) => (
      <span className={cn("inline-flex h-[26px] items-center gap-1.5 whitespace-nowrap rounded-md px-2 text-xs font-medium", STATUS_TONE[f.status])}>
        <span className={cn("h-1.5 w-1.5 shrink-0 rounded-full", STATUS_DOT[f.status])} aria-hidden />
        {STATUS_LABEL[f.status]}
      </span>
    ) });
    if (cols.owner) out.push({
      key: "owner", label: "Owner", sortable: true, width: "160px",
      render: (f) => f.owner ? (
        <span className="inline-flex min-w-0 items-center gap-2"><PersonAvatar person={f.owner} size={24} /><span className="truncate">{f.owner.name ?? personName(f.owner)}</span></span>
      ) : <span className="text-ink-3">Nobody</span>,
    });
    if (cols.updated) out.push({ key: "updated", label: "Last updated", sortable: true, width: "140px", render: (f) => <span className="tabular-nums text-ink-2" title={fmt.title(f.updatedAt)}>{fmt.date(f.updatedAt)}</span> });
    return out;
  }, [cols, goesTo, fmt, toggleFav, router]);

  const filteredEmpty = !!(q || activeFilters);
  const emptyNode = filteredEmpty ? (
    <span className="inline-flex items-center gap-2">No results · <button type="button" onClick={() => setParams({ q: null, goesTo: null, owner: null, status: null, public: null, updatedFrom: null, updatedTo: null })} className="font-medium text-brand-deep hover:underline">Clear filters</button></span>
  ) : view === "shared" ? "Nothing has been shared with you yet"
    : view === "favorites" ? "Star a form and it shows up here"
    : view === "mine" ? "You have not made a form yet"
    : null;
  const showQuietEmpty = rows !== null && rows.length === 0 && view === "all" && !filteredEmpty;

  const goesToOptions: PickerOption[] = [
    { value: "none", label: "Nowhere yet" },
    ...(lists ?? []).map((l) => ({ value: `list:${l.id}`, label: l.name, description: l.spaceName ?? undefined, glyph: <ListChecks className="h-4 w-4 text-ink-2" strokeWidth={1.5} /> })),
    ...tables.map((t) => ({ value: `table:${t.id}`, label: t.name || "Untitled table", glyph: <Table2 className="h-4 w-4 text-ink-2" strokeWidth={1.5} /> })),
  ];

  return (
    <>
      {/* "Tables › Forms": the bar prepends the hub label. */}
      <Breadcrumb items={[{ label: "Forms" }]} />
      <OsPageHeader
        title="Forms"
        views={VIEWS.map((v) => (
          <ViewTab
            key={v.key}
            icon={v.Icon}
            label={VIEW_LABEL[v.key]}
            active={view === v.key}
            href={v.key === "all" ? "/forms" : `/forms?view=${v.key}`}
            trailing={counts ? <span className={cn("text-xs font-medium tabular-nums", view === v.key ? "text-ink-strong" : "text-ink-2")}>{fmt.count(counts[v.key])}</span> : undefined}
          />
        ))}
        toolbar={{
          filter: { open: filterOpen, onToggle: () => setFilterOpen((o) => !o), count: activeFilters },
          sort: { onClick: () => setSortOpen((o) => !o), label: SORTS.find((s) => s.key === sort)?.label, active: true },
          left: (
            <div className="relative">
              <Picker
                open={sortOpen}
                onClose={() => setSortOpen(false)}
                ariaLabel="Sort forms"
                selected={sort}
                onSelect={(v) => { setSortOpen(false); setParams(v === sort ? { dir: dir === "asc" ? "desc" : "asc" } : { sort: v, dir: null }); }}
                sections={[{ options: SORTS.map((s) => ({ value: s.key, label: s.label, hint: s.key === sort ? (dir === "asc" ? "Ascending" : "Descending") : undefined })) }]}
                width={240}
              />
            </div>
          ),
          right: (
            <>
              <SearchField value={q} onChange={(v) => setParams({ q: v || null })} placeholder="Search forms" />
              <span className="relative">
                <Picker open={displayOpen} onClose={() => setDisplayOpen(false)} ariaLabel="Columns shown" multi selected={FORMS_LIST_COLUMNS.filter((k) => cols[k])} onSelect={toggleColumn} align="end" width={240}
                  sections={[{ label: "Columns shown", options: FORMS_LIST_COLUMNS.map((k) => ({ value: k, label: COLUMN_LABEL[k] })) }]} />
              </span>
              <span className="relative">
                <SplitPrimary label="New form" onClick={() => void createForm()} busy={creating} menuLabel="More ways to make a form">
                  <MenuItem icon={ClipboardList} label="Blank form" onClick={() => void createForm()} />
                  <MenuItem icon={ListChecks} label="From a List…" onClick={() => setFromListOpen(true)} />
                  {aiEntitled ? <MenuItem icon={Sparkles} label="Describe it with AI…" onClick={() => setAiOpen(true)} /> : null}
                </SplitPrimary>
                <Picker
                  open={fromListOpen}
                  onClose={() => setFromListOpen(false)}
                  ariaLabel="Make a form for a List"
                  searchPlaceholder="Find a List"
                  align="end"
                  width={280}
                  loading={lists === null}
                  emptyLabel="No Lists you can add tasks to"
                  onSelect={(v) => { const l = (lists ?? []).find((x) => x.id === v); if (l) void createFromList(l); }}
                  sections={[{ label: "Lists", options: (lists ?? []).map((l) => ({ value: l.id, label: l.name, description: l.spaceName ?? undefined })) }]}
                />
              </span>
            </>
          ),
          menu: [
            { label: "Display", icon: SlidersHorizontal, onClick: () => setDisplayOpen(true) },
            ...(!isAgent ? [{ label: "Export list as CSV", icon: Download, onClick: () => void exportList() }] : []),
            { label: "Trash", icon: Trash2, href: "/trash?type=form" },
          ],
        }}
      />

      <div className="os-chrome flex min-h-0 flex-1 gap-4 px-6 pb-6 pt-2">
        <FilterPanel
          open={filterOpen}
          onClose={() => setFilterOpen(false)}
          objects="forms"
          activeCount={activeFilters}
          onClearAll={() => setParams({ goesTo: null, owner: null, status: null, public: null, updatedFrom: null, updatedTo: null })}
          search={{ value: filterSearch, onChange: setFilterSearch, placeholder: "Search fields" }}
        >
          {"goes to".includes(filterSearch.toLowerCase()) ? (
            <FilterGroup label="Goes to">
              <FilterRow label="Where answers go" checked={!!goesTo} onCheckedChange={(on) => { if (!on) setParams({ goesTo: null }); else setGoesToOpen(true); }}>
                <span className="relative block">
                  <button type="button" onClick={() => setGoesToOpen((o) => !o)} className="inline-flex h-8 max-w-full items-center gap-2 rounded-md border border-line-strong bg-raised px-2 text-sm text-ink">
                    <span className="truncate">{goesTo ? goesToOptions.find((o) => o.value === goesTo)?.label ?? "Chosen" : <span className="text-ink-3">Choose a List or Table</span>}</span>
                  </button>
                  <Picker open={goesToOpen} onClose={() => setGoesToOpen(false)} ariaLabel="Goes to" searchPlaceholder="Find a List or Table" selected={goesTo} onSelect={(v) => { setGoesToOpen(false); setParams({ goesTo: v }); }} sections={[{ options: goesToOptions }]} />
                </span>
              </FilterRow>
            </FilterGroup>
          ) : null}
          {"owner".includes(filterSearch.toLowerCase()) ? (
            <FilterGroup label="Owner">
              <FilterRow label="Filter by owner" checked={!!owner} onCheckedChange={(on) => { if (!on) setParams({ owner: null }); else setOwnerPickOpen(true); }}>
                <OwnerPick people={people ?? []} value={owner} onChange={(id) => setParams({ owner: id })} open={ownerPickOpen} setOpen={setOwnerPickOpen} />
              </FilterRow>
            </FilterGroup>
          ) : null}
          {"status".includes(filterSearch.toLowerCase()) ? (
            <FilterGroup label="Status">
              {(["open", "closed", "needs-destination"] as FormStatus[]).map((s) => (
                <FilterRow key={s} label={STATUS_LABEL[s]} checked={status === s} onCheckedChange={(on) => setParams({ status: on ? s : null })} />
              ))}
            </FilterGroup>
          ) : null}
          {"updated".includes(filterSearch.toLowerCase()) ? (
            <FilterGroup label="Updated">
              <FilterRow label="Date range" checked={!!(updatedFrom || updatedTo)} onCheckedChange={(on) => { if (!on) setParams({ updatedFrom: null, updatedTo: null }); else setParams({ updatedFrom: new Date(Date.now() - 7 * 86_400_000).toISOString().slice(0, 10) }); }}>
                <div className="flex flex-col gap-1.5">
                  <label className="flex items-center gap-2 text-sm text-ink-2">From <input type="date" value={(updatedFrom ?? "").slice(0, 10)} onChange={(e) => setParams({ updatedFrom: e.target.value || null })} className="h-8 rounded-md border border-line-strong bg-raised px-2 text-sm text-ink" /></label>
                  <label className="flex items-center gap-2 text-sm text-ink-2">To <input type="date" value={(updatedTo ?? "").slice(0, 10)} onChange={(e) => setParams({ updatedTo: e.target.value || null })} className="h-8 rounded-md border border-line-strong bg-raised px-2 text-sm text-ink" /></label>
                </div>
              </FilterRow>
            </FilterGroup>
          ) : null}
          {"public link".includes(filterSearch.toLowerCase()) ? (
            <FilterGroup label="Public link">
              <FilterRow label="On" checked={publicLink === "on"} onCheckedChange={(on) => setParams({ public: on ? "on" : null })} />
              <FilterRow label="Off" checked={publicLink === "off"} onCheckedChange={(on) => setParams({ public: on ? "off" : null })} />
            </FilterGroup>
          ) : null}
        </FilterPanel>

        <div className="flex min-w-0 flex-1 flex-col">
          {loadError ? (
            <OsEmptyView variant="error" context="list" title="We could not load your forms." action={{ label: "Retry", onClick: () => void load() }} />
          ) : showQuietEmpty ? (
            <OsEmptyView context="list" title="No forms yet" action={{ label: "Make one from a List", onClick: () => setFromListOpen(true) }} />
          ) : (
            <TableCard<FormRow>
              ariaLabel={VIEW_LABEL[view]}
              columns={columns}
              rows={rows}
              rowKey={(f) => f.id}
              rowHref={(f) => `/forms/${f.id}`}
              selectable
              selected={selected}
              onSelectedChange={setSelected}
              sort={{ key: sort, dir }}
              onSort={(key) => setParams(key === sort ? { dir: dir === "asc" ? "desc" : "asc" } : { sort: key, dir: null })}
              onRowContextMenu={(f, e) => menu.open(e, toTarget(f))}
              onRowDeleteKey={isAgent ? undefined : (f) => void bulkTrash([f])}
              rowMenu={(f) => <RowMenuTrigger onOpen={(ref) => menu.openFrom(ref, toTarget(f))} open={menu.state?.form.id === f.id} />}
              empty={emptyNode}
              footer={{ total, noun: "records", from, to, onPrev: goPrev, onNext: goNext, pageSize: limit, pageSizes: PAGE_SIZES, onPageSize: (n) => setParams({ limit: n === PAGE_SIZES[0] ? null : String(n) }) }}
              bulkActions={
                <>
                  <BulkAction icon={Star} label="Add to favorites" onClick={() => void bulkFavorite()} />
                  {!isAgent ? <BulkAction icon={Download} label="Export responses" onClick={bulkExport} /> : null}
                  {!isAgent ? <BulkAction icon={Trash2} label="Move to Trash" destructive onClick={() => void bulkTrash()} /> : null}
                </>
              }
            />
          )}
        </div>
      </div>

      <FormRowMenuHost
        menu={menu}
        context="table"
        onChanged={(kind, f, next) => {
          if (next) setRows((prev) => prev?.map((r) => (r.id === f.id ? { ...r, ...(next.name !== undefined ? { name: next.name } : {}), ...(next.isFavorite !== undefined ? { isFavorite: next.isFavorite } : {}), ...(next.isPublic !== undefined ? { hasPublicLink: next.isPublic } : {}) } : r)) ?? prev);
          if (kind === "trashed" || kind === "duplicated") void load();
        }}
      />

      {aiEntitled ? (
        <Dialog open={aiOpen} onOpenChange={(o) => { if (!o && !aiBusy) { setAiOpen(false); setAiError(null); } }}>
          <DialogContent className="os-chrome max-w-[560px] border-line bg-raised p-0 gap-0">
            <div className="flex h-14 items-center border-b border-line px-5">
              <DialogTitle className="text-lg font-semibold text-ink">Describe a form</DialogTitle>
            </div>
            <DialogDescription className="sr-only">Describe the form and AI drafts its fields.</DialogDescription>
            <div className="flex flex-col gap-2 px-5 py-4">
              <label htmlFor="form-ai-prompt" className="text-sm font-medium text-ink-2">What should it collect?</label>
              <textarea
                id="form-ai-prompt"
                rows={4}
                value={aiPrompt}
                onChange={(e) => setAiPrompt(e.target.value)}
                onKeyDown={(e) => { if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) { e.preventDefault(); void generate(); } }}
                className="rounded-md border border-line-strong bg-raised px-3 py-2 text-base text-ink focus:outline-none focus-visible:border-brand"
              />
              <p className="m-0 text-sm text-ink-2">For example: a vendor onboarding form with company, tax id, contact email and payment terms.</p>
              {aiError ? <p className="m-0 text-sm text-danger-text" role="alert">{aiError}</p> : null}
            </div>
            <div className="flex justify-end gap-2 border-t border-line px-5 py-3">
              <button type="button" onClick={() => setAiOpen(false)} disabled={aiBusy} className="h-9 rounded-md px-3 text-base font-medium text-ink-2 hover:bg-hover">Cancel</button>
              <button type="button" onClick={() => void generate()} disabled={aiBusy || !aiPrompt.trim()} className="inline-flex h-9 items-center gap-2 rounded-md bg-brand px-3 text-base font-medium text-ink-inv hover:bg-brand-hover disabled:cursor-not-allowed disabled:bg-active disabled:text-ink-4">
                {aiBusy ? <Dots variant="pending" /> : <Sparkles className="h-4 w-4" strokeWidth={1.5} aria-hidden />}
                Generate
              </button>
            </div>
          </DialogContent>
        </Dialog>
      ) : null}
    </>
  );
}

/* ───────────────────────────── bits ───────────────────────────── */

function SearchField({ value, onChange, placeholder }: { value: string; onChange: (v: string) => void; placeholder: string }) {
  const [draft, setDraft] = useState(value);
  const [seen, setSeen] = useState(value);
  if (seen !== value) { setSeen(value); setDraft(value); }
  useEffect(() => {
    if (draft === value) return;
    const t = setTimeout(() => onChange(draft.trim()), 350);
    return () => clearTimeout(t);
  }, [draft, value, onChange]);
  return (
    <label className="relative block">
      <Search className="pointer-events-none absolute start-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-ink-3" strokeWidth={1.5} aria-hidden />
      <input type="search" value={draft} onChange={(e) => setDraft(e.target.value)} placeholder={placeholder} aria-label={placeholder}
        className="h-9 w-[200px] max-md:w-36 rounded-md border border-line-strong bg-raised ps-8 pe-2 text-base text-ink placeholder:text-ink-3 focus:outline-none focus-visible:border-brand" />
    </label>
  );
}

function RowMenuTrigger({ onOpen, open }: { onOpen: (ref: React.RefObject<HTMLButtonElement | null>) => void; open?: boolean }) {
  const ref = useRef<HTMLButtonElement>(null);
  return <RowMoreButton buttonRef={ref} open={open} onClick={() => onOpen(ref)} label="Form actions" />;
}

function OwnerPick({ people, value, onChange, open, setOpen }: { people: PersonRef[]; value: string | null; onChange: (id: string) => void; open: boolean; setOpen: (v: boolean) => void }) {
  const current = people.find((p) => p.id === value) ?? null;
  const options: PickerOption[] = people.map((p) => ({ value: p.id, label: personName(p), description: p.email ?? undefined, glyph: <PersonAvatar person={p} size={20} /> }));
  return (
    <span className="relative block">
      <button type="button" onClick={() => setOpen(!open)} className="inline-flex h-8 items-center gap-2 rounded-md border border-line-strong bg-raised px-2 text-sm text-ink">
        {current ? <><PersonAvatar person={current} size={20} />{personName(current)}</> : <span className="text-ink-3">Choose a person</span>}
      </button>
      <Picker open={open} onClose={() => setOpen(false)} ariaLabel="Owner" searchPlaceholder="Find a person" selected={value} onSelect={(v) => { onChange(v); setOpen(false); }} sections={[{ options }]} />
    </span>
  );
}
