"use client";

/* Public table embed — standalone, no auth, read-only.
 * Renders only when DataTable.isPublic is true (enforced server-side
 * by /api/public/tables/[id]).
 */

import { useCallback, useEffect, useState } from "react";
import { Table as TableIcon, Loader2 } from "lucide-react";

type Column = { id: string; type: string; label: string; options?: string[] };
type Row = { id: string; values: Record<string, unknown>; position: number };
type ApiTable = { id: string; name: string; description?: string | null; columns: Column[]; rows: Row[] };

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
                {table.columns.map((c) => {
                  const v = r.values[c.id];
                  const display = v === undefined || v === null ? "" : Array.isArray(v) ? v.join(", ") : c.type === "checkbox" ? (v ? "✓" : "") : String(v);
                  return <td key={c.id} style={S.td}>{display}</td>;
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Wrap>
  );
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
