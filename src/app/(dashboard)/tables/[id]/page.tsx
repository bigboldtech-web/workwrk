"use client";

/* Tables · grid editor — Airtable-style spreadsheet view.
 *
 * Inline cell edits PATCH on blur. Column header click renames the
 * column; the "+" header adds a column. Row-end "+" adds a row.
 * Right-click a row or column to delete. Lightweight: no formulas,
 * no views, no filtering for v1 — just rows + cells + types.
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import {
  Table as TableIcon, ArrowLeft, Plus, Trash2, Loader2, Type, Hash,
  Calendar as CalIcon, CheckSquare, List, Link as LinkIcon, AtSign, AlignLeft,
  LayoutGrid, Columns, ChevronLeft, ChevronRight, Upload, Download, Search, Filter,
  Globe, Lock,
} from "lucide-react";
import { useOsToast } from "@/components/layout/os/toast";

type ColType = "short_text" | "long_text" | "number" | "select" | "multi_select" | "date" | "checkbox" | "url" | "email";

type Column = { id: string; type: ColType; label: string; options?: string[] };
type ApiTable = { id: string; name: string; description?: string | null; columns: Column[]; rowCount: number; isPublic?: boolean };
type ApiRow = { id: string; values: Record<string, unknown>; position: number };

const COL_LABEL: Record<ColType, string> = {
  short_text: "Short text", long_text: "Long text", number: "Number",
  select: "Single choice", multi_select: "Multiple choice", date: "Date",
  checkbox: "Checkbox", url: "URL", email: "Email",
};

const COL_ICON: Record<ColType, React.ReactNode> = {
  short_text: <Type />, long_text: <AlignLeft />, number: <Hash />,
  select: <List />, multi_select: <List />, date: <CalIcon />,
  checkbox: <CheckSquare />, url: <LinkIcon />, email: <AtSign />,
};

function newId() { return Math.random().toString(36).slice(2, 10); }

export default function TableEditorPage({ params }: { params: Promise<{ id: string }> }) {
  const router = useRouter();
  const { toast } = useOsToast();
  const [tableId, setTableId] = useState<string | null>(null);
  const [table, setTable] = useState<ApiTable | null>(null);
  const [rows, setRows] = useState<ApiRow[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [savingCols, setSavingCols] = useState(false);
  const [view, setView] = useState<"grid" | "kanban" | "calendar">("grid");
  const [kanbanCol, setKanbanCol] = useState<string>("");
  const [calCol, setCalCol] = useState<string>("");
  const [calMonth, setCalMonth] = useState<Date>(() => { const d = new Date(); return new Date(d.getFullYear(), d.getMonth(), 1); });
  const [search, setSearch] = useState("");
  const [filterCol, setFilterCol] = useState<string>("");
  const [filterValue, setFilterValue] = useState<string>("");
  const [activeRowId, setActiveRowId] = useState<string | null>(null);

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
    } catch (e) {
      setLoadError(e instanceof Error ? e.message : "load failed");
    }
  }, [tableId]);
  useEffect(() => { void load(); }, [load]);

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

  function addColumn(type: ColType) {
    if (!table) return;
    const cols = [...table.columns, { id: newId(), type, label: COL_LABEL[type], ...(type === "select" || type === "multi_select" ? { options: ["Option 1"] } : {}) }];
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

      <nav className="dtbl__viewtabs">
        <button type="button" className={view === "grid" ? "is-active" : ""} onClick={() => setView("grid")}><LayoutGrid /> Grid</button>
        <button type="button" className={view === "kanban" ? "is-active" : ""} onClick={() => setView("kanban")} disabled={kanbanColumns.length === 0} title={kanbanColumns.length === 0 ? "Add a Single-choice column to enable Kanban" : ""}><Columns /> Kanban</button>
        <button type="button" className={view === "calendar" ? "is-active" : ""} onClick={() => setView("calendar")} disabled={dateColumns.length === 0} title={dateColumns.length === 0 ? "Add a Date column to enable Calendar" : ""}><CalIcon /> Calendar</button>
        {view === "kanban" && kanbanColumns.length > 1 && (
          <select className="dtbl__viewgroup" value={kanbanCol} onChange={(e) => setKanbanCol(e.target.value)}>
            {kanbanColumns.map((c) => <option key={c.id} value={c.id}>Group by: {c.label}</option>)}
          </select>
        )}
        {view === "calendar" && dateColumns.length > 1 && (
          <select className="dtbl__viewgroup" value={calCol} onChange={(e) => setCalCol(e.target.value)}>
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
      ) : (
      <>
      <div className="dtbl__scroll">
        <table className="dtbl__grid">
          <thead>
            <tr>
              <th className="dtbl__rowhandle" />
              <th className="dtbl__rowexpand" />
              {table.columns.map((c) => (
                <th key={c.id} className="dtbl__col">
                  <div className="dtbl__col-head">
                    <span className="dtbl__col-icon">{COL_ICON[c.type]}</span>
                    <input
                      type="text"
                      value={c.label}
                      onChange={(e) => setTable({ ...table, columns: table.columns.map((x) => x.id === c.id ? { ...x, label: e.target.value } : x) })}
                      onBlur={(e) => renameColumn(c.id, e.target.value.trim() || COL_LABEL[c.type])}
                    />
                    <button type="button" className="dtbl__col-del" onClick={() => deleteColumn(c.id)} title="Delete column"><Trash2 /></button>
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
                {table.columns.map((c) => (
                  <td key={c.id} className="dtbl__cell">
                    <CellEditor column={c} value={r.values[c.id]} onChange={(v) => void patchRow(r.id, { [c.id]: v })} />
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
