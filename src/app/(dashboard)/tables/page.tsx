"use client";

/* Tables — list of lightweight Airtable-style data tables in the org.
 *
 * Anyone in the org can create one. Cards show row count and last
 * edited; click a card to open the grid editor. Embed any table into
 * a doc via the data_table block.
 */

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { Table as TableIcon, Plus, Rows, ChevronRight, Sparkles, Loader2 } from "lucide-react";
import { useOsShell } from "@/components/layout/os/shell-context";
import { useOsToast } from "@/components/layout/os/toast";

type ApiTable = {
  id: string; name: string; description?: string | null;
  createdAt: string; updatedAt: string;
  rowCount: number;
};

export default function TablesPage() {
  const router = useRouter();
  const [tables, setTables] = useState<ApiTable[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const { rowVersion } = useOsShell();
  const { toast } = useOsToast();

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/tables");
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const d = await res.json();
      setTables(d.data ?? (Array.isArray(d) ? d : []));
    } catch (e) {
      setLoadError(e instanceof Error ? e.message : "load failed");
    }
  }, []);
  useEffect(() => { void load(); }, [load]);
  const v = rowVersion("tables");
  useEffect(() => { if (v > 0) void load(); }, [v, load]);

  async function quickAdd() {
    const name = window.prompt("Table name?")?.trim();
    if (!name) return;
    try {
      const res = await fetch("/api/tables", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name }),
      });
      if (!res.ok) throw new Error(`POST ${res.status}`);
      const d = await res.json();
      const t = d.data ?? d;
      router.push(`/tables/${t.id}`);
    } catch { toast("Couldn't create table"); }
  }

  const [aiImporting, setAiImporting] = useState(false);
  async function aiFromCsv() {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = ".csv,text/csv";
    input.onchange = async () => {
      const file = input.files?.[0];
      if (!file) return;
      setAiImporting(true);
      try {
        // Bootstrap a blank table from the CSV name, then import.
        const baseName = file.name.replace(/\.csv$/i, "").replace(/[_-]+/g, " ");
        const tCreate = await fetch("/api/tables", {
          method: "POST", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ name: baseName.slice(0, 80) || "Imported table" }),
        });
        if (!tCreate.ok) throw new Error();
        const t = (await tCreate.json()).data;
        const csv = await file.text();
        const imp = await fetch(`/api/tables/${t.id}/import`, {
          method: "POST", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ csv }),
        });
        if (!imp.ok) {
          const err = await imp.json().catch(() => ({ error: `HTTP ${imp.status}` }));
          toast(`Import failed: ${err.error}`);
          router.push(`/tables/${t.id}`);
          return;
        }
        const r = (await imp.json()).data;
        toast(`Imported ${r.rowsCreated} row${r.rowsCreated === 1 ? "" : "s"}`);
        router.push(`/tables/${t.id}`);
      } catch { toast("Couldn't import CSV"); }
      finally { setAiImporting(false); }
    };
    input.click();
  }

  const total = tables?.length ?? 0;
  const totalRows = (tables ?? []).reduce((acc, t) => acc + (t.rowCount ?? 0), 0);

  return (
    <div className="frmlist">
      <header className="frmlist__head">
        <div className="frmlist__head-l">
          <div className="frmlist__icon" style={{ background: "linear-gradient(135deg, var(--os-c-teal), var(--os-c-blue))" }}><TableIcon /></div>
          <div>
            <h1 className="frmlist__title">Tables</h1>
            <div className="frmlist__sub">
              {tables === null ? "Loading…" : `${total} table${total === 1 ? "" : "s"} · ${totalRows} row${totalRows === 1 ? "" : "s"}`}
            </div>
          </div>
        </div>
        <div className="frmlist__actions">
          <button type="button" className="frmlist__btn frmlist__btn--ai" onClick={aiFromCsv} disabled={aiImporting}>
            {aiImporting ? <><Loader2 className="frmlist__spin" /> Importing…</> : <><Sparkles /> Import CSV</>}
          </button>
          <button type="button" className="frmlist__new" onClick={quickAdd}><Plus /> New table</button>
        </div>
      </header>

      {loadError ? (
        <div className="frmlist__error">{loadError}</div>
      ) : tables === null ? (
        <div style={{ padding: 60, textAlign: "center", color: "var(--os-ink-3)", fontSize: 13 }}>Loading…</div>
      ) : total === 0 ? (
        <div className="frmlist__empty">
          <TableIcon />
          <div>
            <h3>No tables yet</h3>
            <p>Tables are flexible rows-and-columns — track anything from competitors to bug lists to vendor contacts. Add columns of any type. Embed into any doc.</p>
            <button type="button" className="frmlist__new" onClick={quickAdd} style={{ marginTop: 12 }}><Plus /> Create your first table</button>
          </div>
        </div>
      ) : (
        <div className="frmlist__grid">
          {tables.map((t) => (
            <Link key={t.id} href={`/tables/${t.id}`} className="frmcard">
              <header>
                <h3>{t.name}</h3>
              </header>
              {t.description && <p className="frmcard__desc">{t.description.length > 80 ? t.description.slice(0, 80) + "…" : t.description}</p>}
              <footer>
                <span className="frmcard__subs"><Rows /> {t.rowCount} row{t.rowCount === 1 ? "" : "s"}</span>
                <span className="frmcard__open">Open <ChevronRight /></span>
              </footer>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
