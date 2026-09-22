"use client";

/* Public table embed — standalone, no auth, read-only.
 * Renders only when DataTable.isPublic is true (enforced server-side
 * by /api/public/tables/[id]).
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import { Table as TableIcon, Loader2 } from "lucide-react";

import { createTableEngine, type NamedRangeDef } from "@/lib/sheet-engine-host";
import { formatCellValue, type ColumnFormat } from "@/lib/sheet-format";

type Column = {
  id: string;
  type: string;
  label: string;
  options?: string[];
  /** A whole-column formula; every cell in the column evaluates it. */
  formula?: string;
  /** Currency, percent, date and number display options. */
  format?: ColumnFormat;
};
type Row = { id: string; values: Record<string, unknown>; position: number };
type ApiTable = {
  id: string;
  name: string;
  description?: string | null;
  columns: Column[];
  rows: Row[];
  namedRanges?: NamedRangeDef[];
};

export default function TableEmbed({ params }: { params: Promise<{ id: string }> }) {
  const [id, setId] = useState<string | null>(null);
  const [table, setTable] = useState<ApiTable | null>(null);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => { void params.then((p) => setId(p.id)); }, [params]);

  const load = useCallback(async () => {
    if (!id) return;
    try {
      const res = await fetch(`/api/public/tables/${id}`);
      if (!res.ok) throw new Error(res.status === 404 ? "Table not found or not public" : `HTTP ${res.status}`);
      const d = await res.json();
      const t = d.data ?? d;
      t.columns = Array.isArray(t.columns) ? t.columns : [];
      t.rows = Array.isArray(t.rows) ? t.rows : [];
      setTable(t);
    } catch (e) {
      setErr(e instanceof Error ? e.message : "load failed");
    }
  }, [id]);
  useEffect(() => { void load(); }, [load]);

  // THE SAME ENGINE THE GRID USES, SO THE EMBED SHOWS THE SAME NUMBERS.
  //
  // A formula is stored as an object, `{ "=": "SUM(A1:A5)" }`, and nothing
  // caches its result (sheet-engine/types.ts: "extra keys are tolerated so a
  // cached computed value can be added later"). This page used to render
  // every cell with `String(v)`, so every formula cell in every public embed
  // read literally "[object Object]" while the same table in the product
  // showed the number.
  //
  // `engine.display(colId, rowId)` is the grid's own renderer: it evaluates
  // per-cell formulas AND whole-column ones, and returns real error codes
  // ("#REF!", "#DIV/0!") instead of an object or a blank.
  //
  // Rows MUST go in unsorted storage order, which is what the API returns
  // (position asc, then id). Row anchoring is the engine's law: A1 row N is
  // index N-1, so re-ordering here would silently change what every formula
  // points at.
  const engine = useMemo(() => {
    if (!table) return null;
    try {
      return createTableEngine({
        columns: table.columns.map((c) => ({ id: c.id, label: c.label, type: c.type, formula: c.formula })),
        rows: table.rows.map((r) => ({ id: r.id, values: r.values })),
        namedRanges: table.namedRanges ?? [],
      });
    } catch {
      // A malformed table must not blank a public page. Falling back to null
      // renders literals only, which is what this page did before.
      return null;
    }
  }, [table]);

  if (err) return <Wrap><div style={S.error}><TableIcon /><p>{err}</p></div></Wrap>;
  if (!table) return <Wrap><div style={S.loading}><Loader2 style={{ animation: "spin 1s linear infinite" }} /> Loading…</div></Wrap>;

  return (
    <Wrap>
      <header style={S.head}>
        <div style={S.icon}><TableIcon /></div>
        <div>
          <h1 style={S.title}>{table.name}</h1>
          {table.description && <p style={S.desc}>{table.description}</p>}
        </div>
      </header>
      <div style={S.scroll}>
        <table style={S.table}>
          <thead>
            <tr>{table.columns.map((c) => <th key={c.id} style={S.th}>{c.label}</th>)}</tr>
          </thead>
          <tbody>
            {table.rows.length === 0 ? (
              <tr><td colSpan={table.columns.length} style={S.empty}>No rows yet.</td></tr>
            ) : table.rows.map((r) => (
              <tr key={r.id}>
                {table.columns.map((c) => (
                  <td key={c.id} style={S.td}>{cellText(c, r, engine)}</td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Wrap>
  );
}

/**
 * One cell's text, by the same rules the product's grid uses.
 *
 * Order matters here:
 *   1. Checkbox first, because `false` is a real value that must render as
 *      an empty cell rather than as the word "false".
 *   2. The engine next, when there is one. It answers for formula cells and
 *      formula COLUMNS, and returns error codes as text.
 *   3. `formatCellValue` last, so a currency column reads "$1,240" and a date
 *      column reads in the table's date format, exactly as in the product.
 *      The embed used to skip this entirely and print raw stored values.
 *
 * An array (multi-select, people) still joins with commas, and anything else
 * that is somehow an object falls back to empty rather than "[object
 * Object]": on a public page a blank cell is honest and the literal string is
 * not.
 */
function cellText(
  column: Column,
  row: Row,
  engine: ReturnType<typeof createTableEngine> | null,
): string {
  const raw = row.values[column.id];

  if (column.type === "checkbox") return raw ? "✓" : "";

  if (engine) {
    try {
      return engine.display(column.id, row.id);
    } catch {
      // Fall through to the literal path rather than blanking the row.
    }
  }

  if (raw === undefined || raw === null) return "";
  if (Array.isArray(raw)) return raw.join(", ");
  if (typeof raw === "object") return "";
  return formatCellValue(raw, column.type, column.format);
}

function Wrap({ children }: { children: React.ReactNode }) {
  return (
    <div style={{ minHeight: "100vh", padding: 20, fontFamily: "-apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif", background: "#f9fafb", boxSizing: "border-box" }}>
      <div style={{ maxWidth: 1000, margin: "0 auto", background: "white", borderRadius: 10, padding: 24, boxShadow: "0 2px 12px rgba(0,0,0,.05)" }}>
        {children}
      </div>
      <style>{`@keyframes spin { from { transform: rotate(0); } to { transform: rotate(360deg); } }`}</style>
    </div>
  );
}

const S = {
  head: { display: "flex", gap: 14, alignItems: "center", marginBottom: 18, paddingBottom: 14, borderBottom: "1px solid #e5e7eb" } as React.CSSProperties,
  icon: { width: 40, height: 40, borderRadius: 10, background: "linear-gradient(135deg, #14787E, #66CCC2)", color: "white", display: "flex", alignItems: "center", justifyContent: "center", flex: "0 0 auto" } as React.CSSProperties,
  title: { margin: 0, fontSize: 20, fontWeight: 600, color: "#1f2937" } as React.CSSProperties,
  desc: { margin: "4px 0 0", fontSize: 13, color: "#6b7280" } as React.CSSProperties,
  scroll: { overflowX: "auto" as const },
  table: { width: "100%", borderCollapse: "collapse" as const, fontSize: 13 },
  th: { textAlign: "left" as const, padding: "8px 12px", borderBottom: "2px solid #e5e7eb", fontWeight: 500, color: "#374151", background: "#f9fafb" },
  td: { padding: "8px 12px", borderBottom: "1px solid #f3f4f6", color: "#1f2937", verticalAlign: "top" as const },
  empty: { padding: 30, textAlign: "center" as const, color: "#9ca3af", fontSize: 13 } as React.CSSProperties,
  loading: { padding: 30, textAlign: "center" as const, color: "#6b7280", fontSize: 13, display: "flex", alignItems: "center", justifyContent: "center", gap: 8 } as React.CSSProperties,
  error: { padding: 30, textAlign: "center" as const, color: "#dc2626", fontSize: 13 } as React.CSSProperties,
};
