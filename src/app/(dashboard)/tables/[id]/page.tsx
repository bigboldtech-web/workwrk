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
  LayoutGrid, Columns,
} from "lucide-react";
import { useOsToast } from "@/components/layout/os/toast";

type ColType = "short_text" | "long_text" | "number" | "select" | "multi_select" | "date" | "checkbox" | "url" | "email";

type Column = { id: string; type: ColType; label: string; options?: string[] };
type ApiTable = { id: string; name: string; description?: string | null; columns: Column[]; rowCount: number };
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
  const [view, setView] = useState<"grid" | "kanban">("grid");
  const [kanbanCol, setKanbanCol] = useState<string>("");

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

  const columnTypes = useMemo(() => Object.keys(COL_LABEL) as ColType[], []);

  const kanbanColumns = useMemo(() => (table?.columns ?? []).filter((c) => c.type === "select"), [table?.columns]);

  // Auto-pick the first select column for kanban when switching to that view.
  useEffect(() => {
    if (view !== "kanban") return;
    if (kanbanCol && kanbanColumns.find((c) => c.id === kanbanCol)) return;
    setKanbanCol(kanbanColumns[0]?.id ?? "");
  }, [view, kanbanCol, kanbanColumns]);

  if (loadError) return <div className="frmb__error">Couldn&apos;t load table: {loadError}</div>;
  if (!table || rows === null) return <div className="frmb__loading"><Loader2 className="frmb__spin" /> Loading…</div>;

  const activeCol = kanbanColumns.find((c) => c.id === kanbanCol);
  const titleCol = table.columns.find((c) => c.type === "short_text") ?? table.columns[0];

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
      </header>

      <nav className="dtbl__viewtabs">
        <button type="button" className={view === "grid" ? "is-active" : ""} onClick={() => setView("grid")}><LayoutGrid /> Grid</button>
        <button type="button" className={view === "kanban" ? "is-active" : ""} onClick={() => setView("kanban")} disabled={kanbanColumns.length === 0} title={kanbanColumns.length === 0 ? "Add a Single-choice column to enable Kanban" : ""}><Columns /> Kanban</button>
        {view === "kanban" && kanbanColumns.length > 1 && (
          <select className="dtbl__viewgroup" value={kanbanCol} onChange={(e) => setKanbanCol(e.target.value)}>
            {kanbanColumns.map((c) => <option key={c.id} value={c.id}>Group by: {c.label}</option>)}
          </select>
        )}
      </nav>

      {view === "kanban" && activeCol ? (
        <KanbanView
          table={table}
          rows={rows}
          groupCol={activeCol}
          titleCol={titleCol}
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
      ) : (
      <>
      <div className="dtbl__scroll">
        <table className="dtbl__grid">
          <thead>
            <tr>
              <th className="dtbl__rowhandle" />
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
            {rows.length === 0 ? (
              <tr><td colSpan={table.columns.length + 2} className="dtbl__empty">No rows yet. Add one below.</td></tr>
            ) : rows.map((r) => (
              <tr key={r.id}>
                <td className="dtbl__rowhandle">
                  <button type="button" onClick={() => deleteRow(r.id)} title="Delete row"><Trash2 /></button>
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
    </div>
  );
}

function KanbanView({ table, rows, groupCol, titleCol, onAddRow, onMove }: {
  table: ApiTable; rows: ApiRow[]; groupCol: Column; titleCol: Column | undefined;
  onAddRow: (groupValue: string) => Promise<void>;
  onMove: (rowId: string, newGroup: string) => void;
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
              <article key={r.id} className="dtbl__card" draggable onDragStart={(e) => e.dataTransfer.setData("text/plain", r.id)}>
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
