"use client";

/* Tables · grid editor — Airtable-style spreadsheet view.
 *
 * Inline cell edits PATCH on blur. Column header click renames the
 * column; the "+" header adds a column. Row-end "+" adds a row.
 * Right-click a row or column to delete. Lightweight: no formulas,
 * no views, no filtering for v1 — just rows + cells + types.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import {
  Table as TableIcon, ArrowLeft, Plus, Trash2, Loader2, Type, Hash,
  Calendar as CalIcon, CheckSquare, List, Link as LinkIcon, AtSign, AlignLeft,
  LayoutGrid, Columns, ChevronLeft, ChevronRight, Upload, Download, Search, Filter,
  Globe, Lock, Sigma, DollarSign, Percent, Star, Link2, Check, Paperclip, Users,
} from "lucide-react";
import { useOsToast } from "@/components/layout/os/toast";
import { makeFormulaEngine, columnLetter } from "@/lib/sheet-formula";
import { RelationConfigModal } from "@/components/tables/relation-config-modal";
import { TableFavoriteButton } from "@/components/board-view/table-favorite-button";

type ColType = "short_text" | "long_text" | "number" | "currency" | "percent" | "rating" | "select" | "multi_select" | "date" | "checkbox" | "url" | "email" | "formula" | "link" | "lookup" | "rollup" | "attachment" | "person";

type RollupFn = "SUM" | "COUNT" | "AVG" | "MIN" | "MAX" | "CONCAT";

type Column = {
  id: string; type: ColType; label: string; options?: string[]; formula?: string; width?: number;
  // Relational (Stackby-style)
  linkTableId?: string;   // link → target DataTable
  linkColumnId?: string;  // lookup/rollup → which link column on THIS table to follow
  lookupColumnId?: string;// lookup → which column in the target table to pull
  rollupColumnId?: string;// rollup → which target column to aggregate
  rollupFn?: RollupFn;    // rollup aggregate
};

type LinkedTable = { id: string; name: string; columns: Column[]; titleColId: string; rows: ApiRow[] };
type ViewType = "grid" | "kanban" | "calendar" | "gallery";
type SavedView = { id: string; name: string; type: ViewType; config?: { kanbanCol?: string; calCol?: string } };
type ApiTable = { id: string; name: string; description?: string | null; columns: Column[]; views?: SavedView[]; rowCount: number; isPublic?: boolean };
type ApiRow = { id: string; values: Record<string, unknown>; position: number };

const COL_LABEL: Record<ColType, string> = {
  short_text: "Short text", long_text: "Long text", number: "Number",
  currency: "Currency", percent: "Percent", rating: "Rating",
  select: "Single choice", multi_select: "Multiple choice", date: "Date",
  checkbox: "Checkbox", url: "URL", email: "Email", formula: "Formula",
  link: "Link to table", lookup: "Lookup", rollup: "Rollup",
  attachment: "Attachment", person: "Person",
};

const COL_ICON: Record<ColType, React.ReactNode> = {
  short_text: <Type />, long_text: <AlignLeft />, number: <Hash />,
  currency: <DollarSign />, percent: <Percent />, rating: <Star />,
  select: <List />, multi_select: <List />, date: <CalIcon />,
  checkbox: <CheckSquare />, url: <LinkIcon />, email: <AtSign />, formula: <Sigma />,
  link: <Link2 />, lookup: <Search />, rollup: <Sigma />,
  attachment: <Paperclip />, person: <Users />,
};

type OrgUser = { id: string; firstName?: string | null; lastName?: string | null; avatar?: string | null };
function userName(u: OrgUser | undefined): string {
  if (!u) return "—";
  return `${u.firstName ?? ""} ${u.lastName ?? ""}`.trim() || "Unnamed";
}
function userInitials(u: OrgUser | undefined): string {
  if (!u) return "?";
  return `${(u.firstName ?? "")[0] ?? ""}${(u.lastName ?? "")[0] ?? ""}`.toUpperCase() || "?";
}

/** The display/title column of a table — first short_text, else first column. */
function titleColumnId(columns: Column[]): string {
  return (columns.find((c) => c.type === "short_text") ?? columns[0])?.id ?? "";
}

/** Pull a single linked row's display title. */
function rowTitle(row: ApiRow | undefined, titleColId: string): string {
  if (!row) return "—";
  const v = row.values[titleColId];
  return v == null || v === "" ? "Untitled" : String(v);
}

function newId() { return Math.random().toString(36).slice(2, 10); }

// Sticky header cells stay pinned while the grid body scrolls.
const STICKY_TH: React.CSSProperties = { position: "sticky", top: 0, zIndex: 3, background: "#fff" };

export default function TableEditorPage({ params }: { params: Promise<{ id: string }> }) {
  const router = useRouter();
  const { toast } = useOsToast();
  const [tableId, setTableId] = useState<string | null>(null);
  const [table, setTable] = useState<ApiTable | null>(null);
  const [rows, setRows] = useState<ApiRow[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [savingCols, setSavingCols] = useState(false);
  const [view, setView] = useState<ViewType>("grid");
  const [kanbanCol, setKanbanCol] = useState<string>("");
  const [calCol, setCalCol] = useState<string>("");
  // Saved named views (Stackby-style). Persisted in DataTable.views.
  const [views, setViews] = useState<SavedView[]>([]);
  const [activeViewId, setActiveViewId] = useState<string>("");
  const [calMonth, setCalMonth] = useState<Date>(() => { const d = new Date(); return new Date(d.getFullYear(), d.getMonth(), 1); });
  const [search, setSearch] = useState("");
  const [filterCol, setFilterCol] = useState<string>("");
  const [filterValue, setFilterValue] = useState<string>("");
  const [activeRowId, setActiveRowId] = useState<string | null>(null);
  // Relational: rows of every table this one links to (for pickers + lookup/rollup).
  const [linkedTables, setLinkedTables] = useState<Record<string, LinkedTable>>({});
  // All org tables (for the link-target picker in the relation config modal).
  const [allTables, setAllTables] = useState<{ id: string; name: string }[]>([]);
  // Column currently being configured in the relation modal (link/lookup/rollup).
  const [configColId, setConfigColId] = useState<string | null>(null);
  // Org users (for Person columns), lazy-loaded when one exists.
  const [orgUsers, setOrgUsers] = useState<OrgUser[]>([]);
  // Column drag-reorder + resize.
  const [dragColId, setDragColId] = useState<string | null>(null);
  const resizeRef = useRef<{ colId: string; startX: number; startW: number } | null>(null);

  useEffect(() => { void params.then((p) => setTableId(p.id)); }, [params]);

  const load = useCallback(async () => {
    if (!tableId) return;
    try {
      const [tRes, rRes] = await Promise.all([
        fetch(`/api/tables/${tableId}`),
        fetch(`/api/tables/${tableId}/rows`),
      ]);
      if (!tRes.ok) throw new Error(`HTTP ${tRes.status}`);
      const td = await tRes.json();
      const rd = await rRes.json();
      const t: ApiTable = td.data ?? td;
      t.columns = Array.isArray(t.columns) ? t.columns : [];
      setTable(t);
      setRows(rd.data ?? (Array.isArray(rd) ? rd : []));
      const savedViews: SavedView[] = Array.isArray(t.views) && t.views.length ? t.views : [{ id: "default", name: "Grid", type: "grid" }];
      setViews(savedViews);
      setActiveViewId((cur) => (savedViews.some((v) => v.id === cur) ? cur : savedViews[0].id));
    } catch (e) {
      setLoadError(e instanceof Error ? e.message : "load failed");
    }
  }, [tableId]);
  useEffect(() => { void load(); }, [load]);

  // Resolve which other tables this one references (link columns directly;
  // lookup/rollup indirectly via their link column) and fetch their rows so
  // pickers, lookups and rollups can render/compute client-side.
  const referencedTableIds = useMemo(() => {
    const cols = table?.columns ?? [];
    const ids = new Set<string>();
    const byId = new Map(cols.map((c) => [c.id, c]));
    for (const c of cols) {
      if (c.type === "link" && c.linkTableId) ids.add(c.linkTableId);
      if ((c.type === "lookup" || c.type === "rollup") && c.linkColumnId) {
        const link = byId.get(c.linkColumnId);
        if (link?.type === "link" && link.linkTableId) ids.add(link.linkTableId);
      }
    }
    return [...ids];
  }, [table?.columns]);

  useEffect(() => {
    let active = true;
    const missing = referencedTableIds.filter((id) => !linkedTables[id]);
    if (missing.length === 0) return;
    void Promise.all(missing.map(async (id) => {
      try {
        const [tRes, rRes] = await Promise.all([fetch(`/api/tables/${id}`), fetch(`/api/tables/${id}/rows`)]);
        if (!tRes.ok) return null;
        const td = await tRes.json();
        const rd = await rRes.json();
        const t = td.data ?? td;
        const columns: Column[] = Array.isArray(t.columns) ? t.columns : [];
        const rs: ApiRow[] = rd.data ?? (Array.isArray(rd) ? rd : []);
        return { id, name: t.name as string, columns, titleColId: titleColumnId(columns), rows: rs } as LinkedTable;
      } catch { return null; }
    })).then((results) => {
      if (!active) return;
      const next: Record<string, LinkedTable> = {};
      for (const r of results) if (r) next[r.id] = r;
      if (Object.keys(next).length) setLinkedTables((prev) => ({ ...prev, ...next }));
    });
    return () => { active = false; };
  }, [referencedTableIds, linkedTables]);

  // Lazy-load org users once a Person column exists.
  const hasPersonCol = (table?.columns ?? []).some((c) => c.type === "person");
  useEffect(() => {
    if (!hasPersonCol || orgUsers.length > 0) return;
    void fetch("/api/users?scope=all&limit=200").then((r) => (r.ok ? r.json() : { data: [] }))
      .then((d) => setOrgUsers(Array.isArray(d?.data) ? d.data : []))
      .catch(() => {});
  }, [hasPersonCol, orgUsers.length]);

  // Lazy-load the org table list the first time the relation config opens.
  useEffect(() => {
    if (!configColId || allTables.length > 0) return;
    void fetch("/api/tables").then((r) => (r.ok ? r.json() : [])).then((d) => {
      const list = Array.isArray(d) ? d : (d.data ?? []);
      setAllTables(list.map((t: { id: string; name: string }) => ({ id: t.id, name: t.name })));
    }).catch(() => {});
  }, [configColId, allTables.length]);

  async function patchTable(patch: Partial<ApiTable>) {
    if (!tableId) return;
    await fetch(`/api/tables/${tableId}`, {
      method: "PATCH", headers: { "Content-Type": "application/json" },
      body: JSON.stringify(patch),
    });
  }

  async function persistColumns(cols: Column[]) {
    setSavingCols(true);
    await patchTable({ columns: cols });
    setSavingCols(false);
  }

  // ── Saved views ──
  const persistViews = useCallback((next: SavedView[]) => { setViews(next); void patchTable({ views: next }); }, [tableId]); // eslint-disable-line react-hooks/exhaustive-deps
  const updateActiveView = useCallback((patch: Partial<SavedView>) => {
    persistViews(views.map((v) => v.id === activeViewId ? { ...v, ...patch, config: { ...v.config, ...patch.config } } : v));
  }, [views, activeViewId, persistViews]);
  const addView = () => {
    const name = window.prompt("View name:", "New view")?.trim();
    if (!name) return;
    const id = Math.random().toString(36).slice(2, 9);
    persistViews([...views, { id, name, type: "grid" }]);
    setActiveViewId(id);
  };
  const renameView = (id: string) => {
    const cur = views.find((v) => v.id === id);
    const name = window.prompt("Rename view:", cur?.name ?? "")?.trim();
    if (!name) return;
    persistViews(views.map((v) => v.id === id ? { ...v, name } : v));
  };
  const deleteView = (id: string) => {
    if (views.length <= 1) { toast("A table needs at least one view"); return; }
    if (!window.confirm("Delete this view?")) return;
    const next = views.filter((v) => v.id !== id);
    persistViews(next);
    if (activeViewId === id) setActiveViewId(next[0].id);
  };

  // Sync the working view state from the active saved view on switch.
  useEffect(() => {
    const v = views.find((x) => x.id === activeViewId);
    if (!v) return;
    setView(v.type);
    setKanbanCol(v.config?.kanbanCol ?? "");
    setCalCol(v.config?.calCol ?? "");
  }, [activeViewId, views]);

  function addColumn(type: ColType) {
    if (!table) return;
    let formula: string | undefined;
    if (type === "formula") {
      const f = window.prompt("Formula (e.g. =A+B, =SUM(C), =A1+B2):", "=");
      if (f == null) return; // cancelled
      formula = f.trim();
    }
    const id = newId();
    const cols = [...table.columns, {
      id, type, label: COL_LABEL[type],
      ...(type === "select" || type === "multi_select" ? { options: ["Option 1"] } : {}),
      ...(formula !== undefined ? { formula } : {}),
    }];
    setTable({ ...table, columns: cols });
    void persistColumns(cols);
    // Relational columns need a target/config before they do anything.
    if (type === "link" || type === "lookup" || type === "rollup") setConfigColId(id);
  }

  function saveColumnConfig(colId: string, patch: Partial<Column>) {
    if (!table) return;
    const cols = table.columns.map((c) => c.id === colId ? { ...c, ...patch } : c);
    setTable({ ...table, columns: cols });
    void persistColumns(cols);
    setConfigColId(null);
  }

  function editFormula(colId: string) {
    if (!table) return;
    const col = table.columns.find((c) => c.id === colId);
    if (!col) return;
    const f = window.prompt("Edit formula:", col.formula ?? "=");
    if (f == null) return;
    const cols = table.columns.map((c) => c.id === colId ? { ...c, formula: f.trim() } : c);
    setTable({ ...table, columns: cols });
    void persistColumns(cols);
  }

  function renameColumn(colId: string, label: string) {
    if (!table) return;
    const cols = table.columns.map((c) => c.id === colId ? { ...c, label } : c);
    setTable({ ...table, columns: cols });
    void persistColumns(cols);
  }

  function deleteColumn(colId: string) {
    if (!table) return;
    if (!confirm("Delete this column? Existing cell values for it will be lost.")) return;
    const cols = table.columns.filter((c) => c.id !== colId);
    setTable({ ...table, columns: cols });
    void persistColumns(cols);
  }

  // Drag-to-reorder columns (handle = the column-type icon).
  function moveColumn(fromId: string, toId: string) {
    if (!table || fromId === toId) return;
    const cols = [...table.columns];
    const from = cols.findIndex((c) => c.id === fromId);
    const to = cols.findIndex((c) => c.id === toId);
    if (from < 0 || to < 0) return;
    const [moved] = cols.splice(from, 1);
    cols.splice(to, 0, moved);
    setTable({ ...table, columns: cols });
    void persistColumns(cols);
  }

  // Column resize — width persisted on the column (optimistic update while
  // dragging; persist once on release).
  function setColumnWidthLocal(colId: string, width: number) {
    setTable((prev) => prev ? { ...prev, columns: prev.columns.map((c) => c.id === colId ? { ...c, width } : c) } : prev);
  }
  function startResize(e: React.MouseEvent, colId: string) {
    e.preventDefault();
    const col = table?.columns.find((c) => c.id === colId);
    resizeRef.current = { colId, startX: e.clientX, startW: col?.width ?? 160 };
    const onMove = (ev: MouseEvent) => {
      const st = resizeRef.current;
      if (!st) return;
      setColumnWidthLocal(st.colId, Math.max(80, st.startW + (ev.clientX - st.startX)));
    };
    const onUp = () => {
      document.removeEventListener("mousemove", onMove);
      document.removeEventListener("mouseup", onUp);
      resizeRef.current = null;
      setTable((prev) => { if (prev) void persistColumns(prev.columns); return prev; });
    };
    document.addEventListener("mousemove", onMove);
    document.addEventListener("mouseup", onUp);
  }

  async function addRow() {
    if (!tableId) return;
    try {
      const res = await fetch(`/api/tables/${tableId}/rows`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ values: {} }),
      });
      if (!res.ok) throw new Error(`POST ${res.status}`);
      const d = await res.json();
      const row = d.data ?? d;
      setRows((prev) => [...(prev ?? []), row]);
    } catch { toast("Couldn't add row"); }
  }

  async function patchRow(rowId: string, values: Record<string, unknown>) {
    if (!tableId) return;
    setRows((prev) => prev ? prev.map((r) => r.id === rowId ? { ...r, values: { ...r.values, ...values } } : r) : prev);
    try {
      await fetch(`/api/tables/${tableId}/rows`, {
        method: "PATCH", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: rowId, values }),
      });
    } catch { toast("Cell didn't save"); }
  }

  async function deleteRow(rowId: string) {
    if (!tableId) return;
    if (!confirm("Delete this row?")) return;
    setRows((prev) => prev ? prev.filter((r) => r.id !== rowId) : prev);
    try {
      await fetch(`/api/tables/${tableId}/rows`, {
        method: "DELETE", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: rowId }),
      });
    } catch { toast("Couldn't delete row"); void load(); }
  }

  async function importCsv(file: File) {
    if (!tableId) return;
    try {
      const csv = await file.text();
      const res = await fetch(`/api/tables/${tableId}/import`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ csv }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({ error: `HTTP ${res.status}` }));
        toast(`Import failed: ${err.error}`);
        return;
      }
      const d = await res.json();
      const r = d.data ?? d;
      toast(`Imported ${r.rowsCreated} row${r.rowsCreated === 1 ? "" : "s"}${r.columnsAdded ? `, added ${r.columnsAdded} column${r.columnsAdded === 1 ? "" : "s"}` : ""}`);
      void load();
    } catch { toast("Couldn't import CSV"); }
  }

  function exportCsv() {
    if (!table || rows === null) return;
    const headers = table.columns.map((c) => csvEscape(c.label)).join(",");
    const bodyRows = rows.map((r) =>
      table.columns.map((c) => {
        const v = r.values[c.id];
        const str = v === undefined || v === null ? "" : Array.isArray(v) ? v.join("; ") : String(v);
        return csvEscape(str);
      }).join(","),
    );
    const csv = [headers, ...bodyRows].join("\n");
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${table.name.replace(/[^a-z0-9_-]+/gi, "_").toLowerCase() || "table"}.csv`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  }

  const columnTypes = useMemo(() => Object.keys(COL_LABEL) as ColType[], []);

  // Formula engine over the current grid + stable row-index lookup.
  const formulaEngine = useMemo(() => makeFormulaEngine(table?.columns ?? [], rows ?? []), [table?.columns, rows]);
  const rowIndexById = useMemo(() => {
    const m = new Map<string, number>();
    (rows ?? []).forEach((r, i) => m.set(r.id, i));
    return m;
  }, [rows]);

  // Lookup/rollup compute: follow the column's link → gather linked rows →
  // pull a field (lookup) or aggregate it (rollup). Returns a display value.
  const relationalValue = useCallback((col: Column, row: ApiRow): string | number => {
    const cols = table?.columns ?? [];
    const linkCol = cols.find((c) => c.id === col.linkColumnId);
    if (!linkCol || linkCol.type !== "link" || !linkCol.linkTableId) return "";
    const lt = linkedTables[linkCol.linkTableId];
    if (!lt) return "…";
    const ids = Array.isArray(row.values[linkCol.id]) ? (row.values[linkCol.id] as string[]) : [];
    const linkedRows = ids.map((id) => lt.rows.find((r) => r.id === id)).filter((r): r is ApiRow => !!r);
    const fmt = (v: unknown) => (v == null || v === "" ? "" : String(v));
    if (col.type === "lookup") {
      if (!col.lookupColumnId) return "";
      return linkedRows.map((r) => fmt(r.values[col.lookupColumnId!])).filter(Boolean).join(", ");
    }
    // rollup
    if (col.rollupFn === "COUNT") return linkedRows.length;
    const targetVals = linkedRows.map((r) => r.values[col.rollupColumnId ?? ""]);
    if (col.rollupFn === "CONCAT") return targetVals.map(fmt).filter(Boolean).join(", ");
    const nums = targetVals.map((v) => (typeof v === "number" ? v : parseFloat(String(v)))).filter((n) => Number.isFinite(n));
    switch (col.rollupFn) {
      case "SUM": return nums.reduce((a, b) => a + b, 0);
      case "AVG": return nums.length ? Math.round((nums.reduce((a, b) => a + b, 0) / nums.length) * 1e6) / 1e6 : 0;
      case "MIN": return nums.length ? Math.min(...nums) : 0;
      case "MAX": return nums.length ? Math.max(...nums) : 0;
      default: return linkedRows.length;
    }
  }, [table?.columns, linkedTables]);

  // target-table-id → its columns (for the relation config modal's field pickers).
  const columnsByTable = useMemo(() => {
    const out: Record<string, { id: string; label: string; type: string }[]> = {};
    for (const [id, lt] of Object.entries(linkedTables)) out[id] = lt.columns.map((c) => ({ id: c.id, label: c.label, type: c.type }));
    return out;
  }, [linkedTables]);

  const configColumn = configColId ? (table?.columns ?? []).find((c) => c.id === configColId) ?? null : null;

  const kanbanColumns = useMemo(() => (table?.columns ?? []).filter((c) => c.type === "select"), [table?.columns]);
  const dateColumns = useMemo(() => (table?.columns ?? []).filter((c) => c.type === "date"), [table?.columns]);

  // Auto-pick the first select column for kanban when switching to that view.
  useEffect(() => {
    if (view !== "kanban") return;
    if (kanbanCol && kanbanColumns.find((c) => c.id === kanbanCol)) return;
    setKanbanCol(kanbanColumns[0]?.id ?? "");
  }, [view, kanbanCol, kanbanColumns]);
  useEffect(() => {
    if (view !== "calendar") return;
    if (calCol && dateColumns.find((c) => c.id === calCol)) return;
    setCalCol(dateColumns[0]?.id ?? "");
  }, [view, calCol, dateColumns]);

  if (loadError) return <div className="frmb__error">Couldn&apos;t load table: {loadError}</div>;
  if (!table || rows === null) return <div className="frmb__loading"><Loader2 className="frmb__spin" /> Loading…</div>;

  const activeCol = kanbanColumns.find((c) => c.id === kanbanCol);
  const activeDateCol = dateColumns.find((c) => c.id === calCol);
  const titleCol = table.columns.find((c) => c.type === "short_text") ?? table.columns[0];

  const filteredRows = (() => {
    let list = rows;
    if (search.trim()) {
      const q = search.trim().toLowerCase();
      list = list.filter((r) =>
        table.columns.some((c) => {
          const v = r.values[c.id];
          if (v === undefined || v === null) return false;
          return String(Array.isArray(v) ? v.join(" ") : v).toLowerCase().includes(q);
        }),
      );
    }
    if (filterCol && filterValue) {
      list = list.filter((r) => {
        const v = r.values[filterCol];
        if (Array.isArray(v)) return v.includes(filterValue);
        return String(v ?? "") === filterValue;
      });
    }
    return list;
  })();

  const filterColDef = table.columns.find((c) => c.id === filterCol);
  const activeRow = activeRowId ? rows.find((r) => r.id === activeRowId) : null;

  return (
    <div className="dtbl">
      <header className="dtbl__head">
        <button type="button" className="frmb__back" onClick={() => router.push("/tables")} aria-label="Back"><ArrowLeft /></button>
        <div className="dtbl__title-wrap">
          <TableIcon />
          <input
            type="text"
            value={table.name}
            onChange={(e) => setTable({ ...table, name: e.target.value })}
            onBlur={(e) => void patchTable({ name: e.target.value.trim() || "Untitled table" })}
            placeholder="Untitled table"
          />
        </div>
        <div className="dtbl__meta">{rows.length} row{rows.length === 1 ? "" : "s"} · {table.columns.length} column{table.columns.length === 1 ? "" : "s"} {savingCols && <em>· saving…</em>}</div>
        <div className="dtbl__head-actions">
          {tableId ? <TableFavoriteButton tableId={tableId} /> : null}
          <button
            type="button"
            className={`dtbl__head-btn ${table.isPublic ? "is-on" : ""}`}
            onClick={() => { const next = !table.isPublic; setTable({ ...table, isPublic: next }); void patchTable({ isPublic: next }); }}
            title={table.isPublic ? "Public — anyone with the link can view" : "Private — toggle to share publicly"}
          >
            {table.isPublic ? <Globe /> : <Lock />}
          </button>
          {table.isPublic && (
            <button
              type="button"
              className="dtbl__head-btn"
              onClick={() => {
                const url = `${window.location.origin}/embed/tables/${tableId}`;
                const snippet = `<iframe src="${url}" width="100%" height="500" frameborder="0" style="border:1px solid #e5e7eb;border-radius:8px"></iframe>`;
                navigator.clipboard.writeText(snippet).then(() => toast("Embed snippet copied"));
              }}
              title="Copy public embed snippet"
            >
              <LinkIcon />
            </button>
          )}
          <label className="dtbl__head-btn" title="Import CSV">
            <Upload />
            <input type="file" accept=".csv,text/csv" style={{ display: "none" }} onChange={(e) => { const f = e.target.files?.[0]; if (f) void importCsv(f); e.target.value = ""; }} />
          </label>
          <button type="button" className="dtbl__head-btn" onClick={exportCsv} title="Export CSV"><Download /></button>
        </div>
      </header>

      {/* Saved views — switch / add / rename / delete. */}
      <nav className="dtbl__viewtabs" style={{ gap: 4, flexWrap: "wrap" }}>
        {views.map((v) => (
          <button
            key={v.id}
            type="button"
            className={v.id === activeViewId ? "is-active" : ""}
            onClick={() => setActiveViewId(v.id)}
            onDoubleClick={() => renameView(v.id)}
            title="Double-click to rename"
            style={{ display: "inline-flex", alignItems: "center", gap: 4 }}
          >
            {v.type === "kanban" ? <Columns /> : v.type === "calendar" ? <CalIcon /> : v.type === "gallery" ? <LayoutGrid /> : <TableIcon />}
            {v.name}
            {views.length > 1 ? <span role="button" tabIndex={0} onClick={(e) => { e.stopPropagation(); deleteView(v.id); }} style={{ marginLeft: 2, opacity: 0.5, cursor: "pointer" }}>×</span> : null}
          </button>
        ))}
        <button type="button" onClick={addView} title="Add view"><Plus /></button>
      </nav>

      {/* Active view's display type + grouping. */}
      <nav className="dtbl__viewtabs">
        <button type="button" className={view === "grid" ? "is-active" : ""} onClick={() => updateActiveView({ type: "grid" })}><LayoutGrid /> Grid</button>
        <button type="button" className={view === "kanban" ? "is-active" : ""} onClick={() => updateActiveView({ type: "kanban" })} disabled={kanbanColumns.length === 0} title={kanbanColumns.length === 0 ? "Add a Single-choice column to enable Kanban" : ""}><Columns /> Kanban</button>
        <button type="button" className={view === "calendar" ? "is-active" : ""} onClick={() => updateActiveView({ type: "calendar" })} disabled={dateColumns.length === 0} title={dateColumns.length === 0 ? "Add a Date column to enable Calendar" : ""}><CalIcon /> Calendar</button>
        <button type="button" className={view === "gallery" ? "is-active" : ""} onClick={() => updateActiveView({ type: "gallery" })}><LayoutGrid /> Gallery</button>
        {view === "kanban" && kanbanColumns.length > 1 && (
          <select className="dtbl__viewgroup" value={kanbanCol} onChange={(e) => updateActiveView({ config: { kanbanCol: e.target.value } })}>
            {kanbanColumns.map((c) => <option key={c.id} value={c.id}>Group by: {c.label}</option>)}
          </select>
        )}
        {view === "calendar" && dateColumns.length > 1 && (
          <select className="dtbl__viewgroup" value={calCol} onChange={(e) => updateActiveView({ config: { calCol: e.target.value } })}>
            {dateColumns.map((c) => <option key={c.id} value={c.id}>By: {c.label}</option>)}
          </select>
        )}
        <div className="dtbl__filterbar">
          <div className="dtbl__searchwrap">
            <Search />
            <input type="search" placeholder="Search rows…" value={search} onChange={(e) => setSearch(e.target.value)} />
          </div>
          <div className="dtbl__filterwrap">
            <Filter />
            <select value={filterCol} onChange={(e) => { setFilterCol(e.target.value); setFilterValue(""); }}>
              <option value="">No filter</option>
              {table.columns.filter((c) => c.type === "select" || c.type === "multi_select").map((c) => (
                <option key={c.id} value={c.id}>{c.label}</option>
              ))}
            </select>
            {filterColDef && (
              <select value={filterValue} onChange={(e) => setFilterValue(e.target.value)}>
                <option value="">Any value</option>
                {(filterColDef.options ?? []).map((o) => <option key={o} value={o}>{o}</option>)}
              </select>
            )}
          </div>
          {(search || filterValue) && (
            <span className="dtbl__filterhint">{filteredRows.length} of {rows.length}</span>
          )}
        </div>
      </nav>

      {view === "kanban" && activeCol ? (
        <KanbanView
          table={table}
          rows={filteredRows}
          groupCol={activeCol}
          titleCol={titleCol}
          onCardClick={(rowId) => setActiveRowId(rowId)}
          onAddRow={async (groupValue: string) => {
            if (!tableId) return;
            try {
              const res = await fetch(`/api/tables/${tableId}/rows`, {
                method: "POST", headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ values: { [activeCol.id]: groupValue } }),
              });
              if (!res.ok) throw new Error();
              const d = await res.json();
              setRows((prev) => [...(prev ?? []), d.data ?? d]);
            } catch { toast("Couldn't add card"); }
          }}
          onMove={(rowId, newGroup) => void patchRow(rowId, { [activeCol.id]: newGroup })}
        />
      ) : view === "calendar" && activeDateCol ? (
        <CalendarView
          rows={filteredRows}
          dateCol={activeDateCol}
          titleCol={titleCol}
          onCardClick={(rowId) => setActiveRowId(rowId)}
          month={calMonth}
          onPrev={() => setCalMonth(new Date(calMonth.getFullYear(), calMonth.getMonth() - 1, 1))}
          onNext={() => setCalMonth(new Date(calMonth.getFullYear(), calMonth.getMonth() + 1, 1))}
          onToday={() => { const d = new Date(); setCalMonth(new Date(d.getFullYear(), d.getMonth(), 1)); }}
          onMove={(rowId, isoDate) => void patchRow(rowId, { [activeDateCol.id]: isoDate })}
          onAddRow={async (isoDate) => {
            if (!tableId) return;
            try {
              const res = await fetch(`/api/tables/${tableId}/rows`, {
                method: "POST", headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ values: { [activeDateCol.id]: isoDate } }),
              });
              if (!res.ok) throw new Error();
              const d = await res.json();
              setRows((prev) => [...(prev ?? []), d.data ?? d]);
            } catch { toast("Couldn't add card"); }
          }}
        />
      ) : view === "gallery" ? (
        <GalleryView rows={filteredRows} columns={table.columns} titleCol={titleCol} onCardClick={(rowId) => setActiveRowId(rowId)} />
      ) : (
      <>
      <div className="dtbl__scroll">
        <table className="dtbl__grid">
          <thead>
            <tr>
              <th className="dtbl__rowhandle" style={STICKY_TH} />
              <th className="dtbl__rowexpand" style={STICKY_TH} />
              {table.columns.map((c, colIndex) => (
                <th
                  key={c.id}
                  className="dtbl__col"
                  style={{ ...STICKY_TH, ...(c.width ? { width: c.width, minWidth: c.width } : {}), position: "sticky", opacity: dragColId === c.id ? 0.5 : 1 }}
                  onDragOver={(e) => { if (dragColId) e.preventDefault(); }}
                  onDrop={(e) => { e.preventDefault(); if (dragColId) moveColumn(dragColId, c.id); setDragColId(null); }}
                >
                  <div className="dtbl__col-head" style={{ position: "relative" }}>
                    <span
                      className="dtbl__col-icon"
                      title={`Column ${columnLetter(colIndex)} · drag to reorder`}
                      draggable
                      onDragStart={() => setDragColId(c.id)}
                      onDragEnd={() => setDragColId(null)}
                      style={{ cursor: "grab" }}
                    >{COL_ICON[c.type]}</span>
                    <input
                      type="text"
                      value={c.label}
                      onChange={(e) => setTable({ ...table, columns: table.columns.map((x) => x.id === c.id ? { ...x, label: e.target.value } : x) })}
                      onBlur={(e) => renameColumn(c.id, e.target.value.trim() || COL_LABEL[c.type])}
                    />
                    {c.type === "formula" ? (
                      <button type="button" className="dtbl__col-del" onClick={() => editFormula(c.id)} title={`Edit formula (${c.formula || "none"})`}><Sigma /></button>
                    ) : null}
                    {c.type === "link" || c.type === "lookup" || c.type === "rollup" ? (
                      <button type="button" className="dtbl__col-del" onClick={() => setConfigColId(c.id)} title="Configure relation"><Link2 /></button>
                    ) : null}
                    <button type="button" className="dtbl__col-del" onClick={() => deleteColumn(c.id)} title="Delete column"><Trash2 /></button>
                    {/* Resize handle */}
                    <span
                      onMouseDown={(e) => startResize(e, c.id)}
                      title="Drag to resize"
                      style={{ position: "absolute", right: -4, top: 0, bottom: 0, width: 8, cursor: "col-resize" }}
                    />
                  </div>
                </th>
              ))}
              <th className="dtbl__addcol">
                <details>
                  <summary><Plus /></summary>
                  <div className="dtbl__addcol-menu">
                    {columnTypes.map((t) => (
                      <button key={t} type="button" onClick={() => addColumn(t)}>
                        <span>{COL_ICON[t]}</span> {COL_LABEL[t]}
                      </button>
                    ))}
                  </div>
                </details>
              </th>
            </tr>
          </thead>
          <tbody>
            {filteredRows.length === 0 ? (
              <tr><td colSpan={table.columns.length + 3} className="dtbl__empty">{rows.length === 0 ? "No rows yet. Add one below." : "No rows match the current search/filter."}</td></tr>
            ) : filteredRows.map((r) => (
              <tr key={r.id}>
                <td className="dtbl__rowhandle">
                  <button type="button" onClick={() => deleteRow(r.id)} title="Delete row"><Trash2 /></button>
                </td>
                <td className="dtbl__rowexpand">
                  <button type="button" onClick={() => setActiveRowId(r.id)} title="Open row"><ChevronRight /></button>
                </td>
                {table.columns.map((c, colIndex) => (
                  <td key={c.id} className="dtbl__cell" style={c.width ? { width: c.width, minWidth: c.width, maxWidth: c.width } : undefined}>
                    {c.type === "formula" ? (
                      <FormulaCell value={formulaEngine.cellValue(colIndex, rowIndexById.get(r.id) ?? 0)} />
                    ) : c.type === "link" ? (
                      <LinkCell value={r.values[c.id]} linked={c.linkTableId ? linkedTables[c.linkTableId] : undefined} onChange={(v) => void patchRow(r.id, { [c.id]: v })} />
                    ) : c.type === "lookup" || c.type === "rollup" ? (
                      <FormulaCell value={relationalValue(c, r)} />
                    ) : c.type === "attachment" ? (
                      <AttachmentCell value={r.values[c.id]} onChange={(v) => void patchRow(r.id, { [c.id]: v })} />
                    ) : c.type === "person" ? (
                      <PersonCell value={r.values[c.id]} users={orgUsers} onChange={(v) => void patchRow(r.id, { [c.id]: v })} />
                    ) : (
                      <CellEditor column={c} value={r.values[c.id]} onChange={(v) => void patchRow(r.id, { [c.id]: v })} />
                    )}
                  </td>
                ))}
                <td />
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <button type="button" className="dtbl__addrow" onClick={addRow}><Plus /> New row</button>
      </>)}

      {activeRow && (
        <RowDetailModal
          table={table}
          row={activeRow}
          onClose={() => setActiveRowId(null)}
          onChange={(values) => void patchRow(activeRow.id, values)}
          onDelete={() => { void deleteRow(activeRow.id); setActiveRowId(null); }}
        />
      )}

      {configColumn && (
        <RelationConfigModal
          column={configColumn}
          tableColumns={table.columns}
          allTables={allTables.filter((t) => t.id !== tableId)}
          columnsByTable={columnsByTable}
          onSave={(patch) => saveColumnConfig(configColumn.id, patch as Partial<Column>)}
          onClose={() => setConfigColId(null)}
        />
      )}
    </div>
  );
}

function GalleryView({ rows, columns, titleCol, onCardClick }: {
  rows: ApiRow[]; columns: Column[]; titleCol: Column | undefined; onCardClick: (rowId: string) => void;
}) {
  const fieldCols = columns.filter((c) => c.id !== titleCol?.id).slice(0, 5);
  const fmt = (v: unknown): string => {
    if (v == null || v === "") return "";
    if (Array.isArray(v)) return `${v.length}`;
    if (typeof v === "boolean") return v ? "Yes" : "No";
    return String(v);
  };
  if (rows.length === 0) return <div className="dtbl__empty" style={{ padding: 24 }}>No rows yet.</div>;
  return (
    <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(220px, 1fr))", gap: 12, padding: 12 }}>
      {rows.map((r) => (
        <button key={r.id} type="button" onClick={() => onCardClick(r.id)} style={{ textAlign: "left", background: "white", border: "1px solid #e4e4e7", borderRadius: 10, padding: 12, cursor: "pointer" }}>
          <div style={{ fontSize: 13.5, fontWeight: 600, color: "#18181b", marginBottom: 6 }}>{rowTitle(r, titleCol?.id ?? "")}</div>
          <div style={{ display: "flex", flexDirection: "column", gap: 3 }}>
            {fieldCols.map((c) => {
              const s = fmt(r.values[c.id]);
              if (!s) return null;
              return <div key={c.id} style={{ fontSize: 11.5, color: "#71717a", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}><span style={{ color: "#a1a1aa" }}>{c.label}:</span> {s}</div>;
            })}
          </div>
        </button>
      ))}
    </div>
  );
}

function RowDetailModal({ table, row, onClose, onChange, onDelete }: {
  table: ApiTable; row: ApiRow;
  onClose: () => void;
  onChange: (values: Record<string, unknown>) => void;
  onDelete: () => void;
}) {
  const titleCol = table.columns.find((c) => c.type === "short_text") ?? table.columns[0];
  const title = titleCol ? String(row.values[titleCol.id] ?? "Untitled") : "Untitled";

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <div className="dtbl__modal-back" onClick={onClose}>
      <aside className="dtbl__modal" onClick={(e) => e.stopPropagation()}>
        <header>
          <h2>{title}</h2>
          <div>
            <button type="button" onClick={onDelete} className="dtbl__modal-del" title="Delete row"><Trash2 /></button>
            <button type="button" onClick={onClose}>×</button>
          </div>
        </header>
        <div className="dtbl__modal-body">
          {table.columns.map((c) => (
            <div key={c.id} className="dtbl__modal-field">
              <label>{c.label}</label>
              <CellEditor column={c} value={row.values[c.id]} onChange={(v) => onChange({ [c.id]: v })} />
            </div>
          ))}
        </div>
      </aside>
    </div>
  );
}

function KanbanView({ table, rows, groupCol, titleCol, onAddRow, onMove, onCardClick }: {
  table: ApiTable; rows: ApiRow[]; groupCol: Column; titleCol: Column | undefined;
  onAddRow: (groupValue: string) => Promise<void>;
  onMove: (rowId: string, newGroup: string) => void;
  onCardClick: (rowId: string) => void;
}) {
  const options = groupCol.options ?? [];
  const lanes = [...options, "—"]; // trailing "—" lane for rows with no value
  const grouped = useMemo(() => {
    const m = new Map<string, ApiRow[]>();
    for (const lane of lanes) m.set(lane, []);
    for (const r of rows) {
      const v = String(r.values[groupCol.id] ?? "—");
      const lane = lanes.includes(v) ? v : "—";
      m.get(lane)!.push(r);
    }
    return m;
  }, [rows, groupCol.id, lanes]);

  return (
    <div className="dtbl__kanban">
      {lanes.map((lane) => (
        <section key={lane} className="dtbl__lane">
          <header className="dtbl__lane-head">
            <h3>{lane}</h3>
            <span>{grouped.get(lane)?.length ?? 0}</span>
          </header>
          <div className="dtbl__lane-body"
            onDragOver={(e) => e.preventDefault()}
            onDrop={(e) => {
              const rowId = e.dataTransfer.getData("text/plain");
              if (rowId && lane !== "—") onMove(rowId, lane);
              else if (rowId && lane === "—") onMove(rowId, "");
            }}
          >
            {(grouped.get(lane) ?? []).map((r) => (
              <article key={r.id} className="dtbl__card" draggable onDragStart={(e) => e.dataTransfer.setData("text/plain", r.id)} onClick={() => onCardClick(r.id)}>
                <div className="dtbl__card-title">{titleCol ? String(r.values[titleCol.id] ?? "Untitled") : "Untitled"}</div>
                <div className="dtbl__card-meta">
                  {table.columns
                    .filter((c) => c.id !== titleCol?.id && c.id !== groupCol.id)
                    .slice(0, 3)
                    .map((c) => {
                      const v = r.values[c.id];
                      if (v === undefined || v === null || v === "") return null;
                      return <span key={c.id} className="dtbl__card-chip"><em>{c.label}:</em> {String(Array.isArray(v) ? v.join(", ") : v)}</span>;
                    })}
                </div>
              </article>
            ))}
            {lane !== "—" && (
              <button type="button" className="dtbl__lane-add" onClick={() => void onAddRow(lane)}><Plus /> Add card</button>
            )}
          </div>
        </section>
      ))}
    </div>
  );
}

function LinkCell({ value, linked, onChange }: { value: unknown; linked: LinkedTable | undefined; onChange: (v: string[]) => void }) {
  const ids = Array.isArray(value) ? (value as string[]) : [];
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  if (!linked) {
    return <span className="dtbl__input" style={{ display: "inline-block", opacity: 0.5 }}>{ids.length ? `${ids.length} linked` : "Set target →"}</span>;
  }
  const chosen = ids.map((id) => linked.rows.find((r) => r.id === id)).filter((r): r is ApiRow => !!r);
  const candidates = q.trim()
    ? linked.rows.filter((r) => rowTitle(r, linked.titleColId).toLowerCase().includes(q.trim().toLowerCase()))
    : linked.rows;
  const toggle = (id: string) => onChange(ids.includes(id) ? ids.filter((x) => x !== id) : [...ids, id]);
  return (
    <span style={{ position: "relative", display: "inline-flex", flexWrap: "wrap", gap: 4, alignItems: "center" }}>
      {chosen.map((r) => (
        <span key={r.id} style={{ display: "inline-flex", alignItems: "center", gap: 3, background: "#eef2ff", color: "#4f46e5", borderRadius: 4, padding: "1px 6px", fontSize: 11, fontWeight: 500 }}>
          {rowTitle(r, linked.titleColId)}
          <button type="button" onClick={() => toggle(r.id)} style={{ background: "none", border: 0, cursor: "pointer", color: "#6366f1", lineHeight: 0, padding: 0 }}>×</button>
        </span>
      ))}
      <button type="button" onClick={() => setOpen((o) => !o)} style={{ background: "none", border: "1px dashed #c7d2fe", borderRadius: 4, color: "#6366f1", cursor: "pointer", fontSize: 11, padding: "1px 6px" }}>+ link</button>
      {open ? (
        <div style={{ position: "absolute", top: "100%", left: 0, marginTop: 4, zIndex: 20, minWidth: 240, maxHeight: 280, overflowY: "auto", background: "white", border: "1px solid #e4e4e7", borderRadius: 8, boxShadow: "0 8px 24px rgba(0,0,0,0.12)", padding: 4 }} onMouseLeave={() => setOpen(false)}>
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder={`Search ${linked.name}…`} autoFocus style={{ width: "100%", height: 28, padding: "0 8px", border: "1px solid #e4e4e7", borderRadius: 6, fontSize: 12, marginBottom: 4 }} />
          {candidates.length === 0 ? <div style={{ padding: 8, fontSize: 12, color: "#a1a1aa" }}>No records.</div> : candidates.slice(0, 100).map((r) => (
            <button key={r.id} type="button" onClick={() => toggle(r.id)} style={{ display: "flex", alignItems: "center", gap: 8, width: "100%", textAlign: "left", padding: "6px 8px", border: 0, background: "none", cursor: "pointer", fontSize: 13, borderRadius: 6 }} onMouseEnter={(e) => (e.currentTarget.style.background = "#f4f4f5")} onMouseLeave={(e) => (e.currentTarget.style.background = "none")}>
              <span style={{ flex: 1 }}>{rowTitle(r, linked.titleColId)}</span>
              {ids.includes(r.id) ? <Check style={{ width: 14, height: 14, color: "#6366f1" }} /> : null}
            </button>
          ))}
        </div>
      ) : null}
    </span>
  );
}

type Attachment = { name: string; url: string; mimeType?: string };
function AttachmentCell({ value, onChange }: { value: unknown; onChange: (v: Attachment[]) => void }) {
  const files: Attachment[] = Array.isArray(value) ? (value as Attachment[]).filter((f) => f && typeof f.url === "string") : [];
  const inputRef = useRef<HTMLInputElement | null>(null);
  const [busy, setBusy] = useState(false);
  const upload = async (list: FileList | null) => {
    if (!list || list.length === 0) return;
    setBusy(true);
    const added: Attachment[] = [];
    await Promise.all(Array.from(list).map(async (file) => {
      try {
        const fd = new FormData(); fd.append("file", file);
        const up = await fetch("/api/upload", { method: "POST", body: fd }).then((r) => r.json());
        if (up?.url) added.push({ name: up.name ?? file.name, url: up.url, mimeType: file.type || "application/octet-stream" });
      } catch { /* skip */ }
    }));
    if (added.length) onChange([...files, ...added]);
    setBusy(false);
  };
  return (
    <span style={{ display: "inline-flex", flexWrap: "wrap", gap: 4, alignItems: "center" }}>
      <input ref={inputRef} type="file" multiple style={{ display: "none" }} onChange={(e) => { void upload(e.target.files); e.target.value = ""; }} />
      {files.map((f, i) => (
        <span key={i} style={{ display: "inline-flex", alignItems: "center", gap: 3, background: "#f4f4f5", borderRadius: 4, padding: "1px 6px", fontSize: 11 }}>
          <a href={f.url} target="_blank" rel="noopener noreferrer" style={{ color: "#3f3f46", textDecoration: "none", maxWidth: 120, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{f.name}</a>
          <button type="button" onClick={() => onChange(files.filter((_, n) => n !== i))} style={{ background: "none", border: 0, cursor: "pointer", color: "#a1a1aa", lineHeight: 0, padding: 0 }}>×</button>
        </span>
      ))}
      <button type="button" onClick={() => inputRef.current?.click()} disabled={busy} style={{ background: "none", border: "1px dashed #d4d4d8", borderRadius: 4, color: "#71717a", cursor: "pointer", fontSize: 11, padding: "1px 6px" }}>{busy ? "…" : "+ file"}</button>
    </span>
  );
}

function PersonCell({ value, users, onChange }: { value: unknown; users: OrgUser[]; onChange: (v: string[]) => void }) {
  const ids = Array.isArray(value) ? (value as string[]) : [];
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const chosen = ids.map((id) => users.find((u) => u.id === id)).filter((u): u is OrgUser => !!u);
  const candidates = q.trim() ? users.filter((u) => userName(u).toLowerCase().includes(q.trim().toLowerCase())) : users;
  const toggle = (id: string) => onChange(ids.includes(id) ? ids.filter((x) => x !== id) : [...ids, id]);
  return (
    <span style={{ position: "relative", display: "inline-flex", flexWrap: "wrap", gap: 4, alignItems: "center" }}>
      {chosen.map((u) => (
        <span key={u.id} style={{ display: "inline-flex", alignItems: "center", gap: 4, background: "#f4f4f5", borderRadius: 999, padding: "1px 8px 1px 2px", fontSize: 11 }}>
          <span style={{ width: 16, height: 16, borderRadius: 999, background: "#e4e4e7", color: "#52525b", fontSize: 8, fontWeight: 600, display: "inline-flex", alignItems: "center", justifyContent: "center", overflow: "hidden" }}>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            {u.avatar ? <img src={u.avatar} alt="" style={{ width: "100%", height: "100%", objectFit: "cover" }} /> : userInitials(u)}
          </span>
          {userName(u)}
          <button type="button" onClick={() => toggle(u.id)} style={{ background: "none", border: 0, cursor: "pointer", color: "#a1a1aa", lineHeight: 0, padding: 0 }}>×</button>
        </span>
      ))}
      <button type="button" onClick={() => setOpen((o) => !o)} style={{ background: "none", border: "1px dashed #d4d4d8", borderRadius: 999, color: "#71717a", cursor: "pointer", fontSize: 11, padding: "1px 8px" }}>+ person</button>
      {open ? (
        <div style={{ position: "absolute", top: "100%", left: 0, marginTop: 4, zIndex: 20, minWidth: 220, maxHeight: 260, overflowY: "auto", background: "white", border: "1px solid #e4e4e7", borderRadius: 8, boxShadow: "0 8px 24px rgba(0,0,0,0.12)", padding: 4 }} onMouseLeave={() => setOpen(false)}>
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search people…" autoFocus style={{ width: "100%", height: 28, padding: "0 8px", border: "1px solid #e4e4e7", borderRadius: 6, fontSize: 12, marginBottom: 4 }} />
          {candidates.length === 0 ? <div style={{ padding: 8, fontSize: 12, color: "#a1a1aa" }}>No people.</div> : candidates.slice(0, 100).map((u) => (
            <button key={u.id} type="button" onClick={() => toggle(u.id)} style={{ display: "flex", alignItems: "center", gap: 8, width: "100%", textAlign: "left", padding: "6px 8px", border: 0, background: "none", cursor: "pointer", fontSize: 13, borderRadius: 6 }}>
              <span style={{ flex: 1 }}>{userName(u)}</span>
              {ids.includes(u.id) ? <Check style={{ width: 14, height: 14, color: "#6366f1" }} /> : null}
            </button>
          ))}
        </div>
      ) : null}
    </span>
  );
}

function FormulaCell({ value }: { value: number | string }) {
  const isErr = typeof value === "string" && value.startsWith("#");
  return (
    <span className="dtbl__input" style={{ display: "inline-block", color: isErr ? "#dc2626" : "#3f3f46", opacity: value === "" ? 0.4 : 1 }} title="Computed (read-only)">
      {value === "" ? "—" : String(value)}
    </span>
  );
}

function CellEditor({ column, value, onChange }: { column: Column; value: unknown; onChange: (v: unknown) => void }) {
  const t = column.type;
  if (t === "short_text" || t === "email" || t === "url") {
    return (
      <input
        type={t === "short_text" ? "text" : t}
        defaultValue={(value as string) ?? ""}
        onBlur={(e) => { if (e.target.value !== (value ?? "")) onChange(e.target.value); }}
        className="dtbl__input"
      />
    );
  }
  if (t === "long_text") {
    return (
      <textarea
        rows={1}
        defaultValue={(value as string) ?? ""}
        onBlur={(e) => { if (e.target.value !== (value ?? "")) onChange(e.target.value); }}
        className="dtbl__input dtbl__input--area"
      />
    );
  }
  if (t === "number") {
    return (
      <input
        type="number"
        defaultValue={(value as number | "") ?? ""}
        onBlur={(e) => { const n = e.target.value === "" ? null : Number(e.target.value); if (n !== (value ?? null)) onChange(n); }}
        className="dtbl__input"
      />
    );
  }
  if (t === "currency" || t === "percent") {
    return (
      <span style={{ display: "inline-flex", alignItems: "center", gap: 2 }}>
        {t === "currency" ? <span style={{ opacity: 0.5 }}>$</span> : null}
        <input
          type="number"
          step="any"
          defaultValue={(value as number | "") ?? ""}
          onBlur={(e) => { const n = e.target.value === "" ? null : Number(e.target.value); if (n !== (value ?? null)) onChange(n); }}
          className="dtbl__input"
        />
        {t === "percent" ? <span style={{ opacity: 0.5 }}>%</span> : null}
      </span>
    );
  }
  if (t === "rating") {
    const n = typeof value === "number" ? value : 0;
    return (
      <span style={{ display: "inline-flex", gap: 1 }}>
        {[1, 2, 3, 4, 5].map((i) => (
          <button key={i} type="button" onClick={() => onChange(i === n ? null : i)} style={{ background: "none", border: 0, cursor: "pointer", padding: 0, lineHeight: 0 }} aria-label={`Rate ${i}`}>
            <Star style={{ width: 15, height: 15, fill: i <= n ? "#f59e0b" : "none", color: i <= n ? "#f59e0b" : "#d4d4d8" }} />
          </button>
        ))}
      </span>
    );
  }
  if (t === "date") {
    return (
      <input
        type="date"
        defaultValue={(value as string) ?? ""}
        onBlur={(e) => { if (e.target.value !== (value ?? "")) onChange(e.target.value); }}
        className="dtbl__input"
      />
    );
  }
  if (t === "checkbox") {
    return (
      <input
        type="checkbox"
        checked={Boolean(value)}
        onChange={(e) => onChange(e.target.checked)}
      />
    );
  }
  if (t === "select") {
    return (
      <select value={(value as string) ?? ""} onChange={(e) => onChange(e.target.value || null)} className="dtbl__input">
        <option value="">—</option>
        {(column.options ?? []).map((o) => <option key={o} value={o}>{o}</option>)}
      </select>
    );
  }
  if (t === "multi_select") {
    const arr = Array.isArray(value) ? (value as string[]) : [];
    return (
      <div className="dtbl__multi">
        {(column.options ?? []).map((o) => (
          <label key={o}>
            <input
              type="checkbox"
              checked={arr.includes(o)}
              onChange={(e) => onChange(e.target.checked ? [...arr, o] : arr.filter((x) => x !== o))}
            /> {o}
          </label>
        ))}
      </div>
    );
  }
  if (t === "formula" || t === "lookup" || t === "rollup") {
    return <span className="dtbl__input" style={{ display: "inline-block", opacity: 0.5 }} title={column.formula}>computed (grid view)</span>;
  }
  if (t === "link" || t === "attachment" || t === "person") {
    const n = Array.isArray(value) ? value.length : 0;
    return <span className="dtbl__input" style={{ display: "inline-block", opacity: 0.5 }}>{n ? `${n} item${n === 1 ? "" : "s"} (edit in grid)` : "edit in grid"}</span>;
  }
  return null;
}

function CalendarView({ rows, dateCol, titleCol, month, onPrev, onNext, onToday, onMove, onAddRow, onCardClick }: {
  rows: ApiRow[];
  dateCol: Column;
  titleCol: Column | undefined;
  month: Date;
  onPrev: () => void;
  onNext: () => void;
  onToday: () => void;
  onMove: (rowId: string, isoDate: string) => void;
  onAddRow: (isoDate: string) => Promise<void>;
  onCardClick: (rowId: string) => void;
}) {
  const year = month.getFullYear();
  const m = month.getMonth();
  const first = new Date(year, m, 1);
  const last = new Date(year, m + 1, 0);
  const startWeekday = first.getDay(); // 0 = Sunday
  const totalDays = last.getDate();
  const cells: Array<{ date: Date | null; iso: string }> = [];
  for (let i = 0; i < startWeekday; i++) cells.push({ date: null, iso: "" });
  for (let d = 1; d <= totalDays; d++) {
    const dt = new Date(year, m, d);
    const iso = `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, "0")}-${String(dt.getDate()).padStart(2, "0")}`;
    cells.push({ date: dt, iso });
  }
  while (cells.length % 7 !== 0) cells.push({ date: null, iso: "" });

  const byDate = useMemo(() => {
    const m = new Map<string, ApiRow[]>();
    for (const r of rows) {
      const v = r.values[dateCol.id];
      if (typeof v !== "string" || !v) continue;
      const iso = v.slice(0, 10);
      if (!m.has(iso)) m.set(iso, []);
      m.get(iso)!.push(r);
    }
    return m;
  }, [rows, dateCol.id]);

  const todayIso = (() => { const t = new Date(); return `${t.getFullYear()}-${String(t.getMonth() + 1).padStart(2, "0")}-${String(t.getDate()).padStart(2, "0")}`; })();
  const monthLabel = month.toLocaleDateString("en-US", { month: "long", year: "numeric" });

  return (
    <div className="dtbl__cal">
      <header className="dtbl__cal-head">
        <button type="button" onClick={onPrev}><ChevronLeft /></button>
        <h3>{monthLabel}</h3>
        <button type="button" onClick={onNext}><ChevronRight /></button>
        <button type="button" className="dtbl__cal-today" onClick={onToday}>Today</button>
      </header>
      <div className="dtbl__cal-weekdays">
        {["Sun","Mon","Tue","Wed","Thu","Fri","Sat"].map((d) => <div key={d}>{d}</div>)}
      </div>
      <div className="dtbl__cal-grid">
        {cells.map((cell, i) => {
          const isToday = cell.iso === todayIso;
          const dayRows = cell.iso ? byDate.get(cell.iso) ?? [] : [];
          return (
            <div
              key={i}
              className={`dtbl__cal-cell ${cell.date ? "" : "is-empty"} ${isToday ? "is-today" : ""}`}
              onDragOver={(e) => { if (cell.iso) e.preventDefault(); }}
              onDrop={(e) => {
                const rowId = e.dataTransfer.getData("text/plain");
                if (rowId && cell.iso) onMove(rowId, cell.iso);
              }}
            >
              {cell.date && (
                <>
                  <header>
                    <span>{cell.date.getDate()}</span>
                    <button type="button" onClick={() => void onAddRow(cell.iso)} title="Add card"><Plus /></button>
                  </header>
                  <div className="dtbl__cal-cards">
                    {dayRows.map((r) => (
                      <div key={r.id} className="dtbl__cal-card" draggable onDragStart={(e) => e.dataTransfer.setData("text/plain", r.id)} onClick={() => onCardClick(r.id)}>
                        {titleCol ? String(r.values[titleCol.id] ?? "Untitled") : "Untitled"}
                      </div>
                    ))}
                  </div>
                </>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

function csvEscape(v: string): string {
  if (v.includes(",") || v.includes('"') || v.includes("\n")) {
    return `"${v.replace(/"/g, '""')}"`;
  }
  return v;
}
