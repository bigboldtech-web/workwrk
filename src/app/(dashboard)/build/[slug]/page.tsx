"use client";

// Generated Build app — Phase D4 render. Loads the App + its rows
// from /api/build/apps/[slug], renders a table with the generated
// fields as columns, and lets the user add/edit/delete rows inline.

import { useCallback, useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import Link from "next/link";
import {
  ArrowLeft,
  Plus,
  Loader2,
  Trash2,
  Wand2,
  X,
  Zap,
} from "lucide-react";
import { BoardView, type BoardField } from "@/components/board-view/board-view";
import { useConfirm } from "@/components/ui/dialog-provider";

type FieldType = "TEXT" | "TEXTAREA" | "NUMBER" | "DATE" | "CHECKBOX" | "SELECT" | "MULTI_SELECT" | "URL" | "EMAIL";

interface AppField {
  key: string;
  label: string;
  fieldType: FieldType;
  options?: { choices?: { value: string; label?: string }[] };
}

interface AppRow {
  [key: string]: unknown;
  __createdAt?: string;
  __createdById?: string;
}

interface AppRecord {
  id: string;
  slug: string;
  name: string;
  description: string | null;
  iconKey: string | null;
  hue: string | null;
  schema: { fields?: AppField[] };
  ui: { rows?: AppRow[] };
}

export default function BuildAppPage() {
  const params = useParams<{ slug: string }>();
  const router = useRouter();
  const confirm = useConfirm();
  const [app, setApp] = useState<AppRecord | null>(null);
  const [loading, setLoading] = useState(true);
  const [showNewRow, setShowNewRow] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!params?.slug) return;
    setLoading(true);
    try {
      const res = await fetch(`/api/build/apps/${params.slug}`);
      if (!res.ok) {
        if (res.status === 404) router.push("/build");
        return;
      }
      const data = await res.json();
      setApp(data.app);
    } finally {
      setLoading(false);
    }
  }, [params?.slug, router]);

  useEffect(() => { load(); }, [load]);

  async function appendRow(row: Record<string, unknown>) {
    if (!app) return;
    setError(null);
    const res = await fetch(`/api/build/apps/${app.slug}/rows`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ row }),
    });
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      setError(data.error ?? "Add failed");
      return;
    }
    setShowNewRow(false);
    await load();
  }

  async function deleteRow(index: number) {
    if (!app) return;
    if (!(await confirm({ title: "Delete row", description: "Delete this row?", destructive: true, confirmLabel: "Delete" }))) return;
    const res = await fetch(`/api/build/apps/${app.slug}/rows`, {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ index }),
    });
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      setError(data.error ?? "Delete failed");
      return;
    }
    await load();
  }

  async function deleteApp() {
    if (!app) return;
    if (!(await confirm({ title: "Archive app", description: `Archive "${app.name}"? Rows will be preserved but the app will be hidden.`, destructive: true, confirmLabel: "Archive" }))) return;
    const res = await fetch(`/api/build/apps/${app.slug}`, { method: "DELETE" });
    if (res.ok) router.push("/build");
  }

  if (loading) {
    return (
      <div className="p-6 text-center text-sm text-zinc-500">
        <Loader2 size={20} className="mx-auto mb-2 animate-spin" />
        Loading app…
      </div>
    );
  }
  if (!app) return null;

  const fields = app.schema.fields ?? [];
  const rows = app.ui.rows ?? [];

  return (
    <div className="bldd p-6 max-w-[1600px] mx-auto">
      <Link href="/build" className="inline-flex items-center gap-1 text-xs text-zinc-500 hover:text-zinc-900 mb-3">
        <ArrowLeft size={12} /> All apps
      </Link>

      <div className="flex items-start justify-between mb-6">
        <div className="flex items-start gap-4">
          <div className={`w-14 h-14 rounded-2xl bg-${app.hue ?? "violet"}-100 text-${app.hue ?? "violet"}-600 flex items-center justify-center font-bold text-xl flex-shrink-0`}>
            {app.name.charAt(0).toUpperCase()}
          </div>
          <div>
            <div className="inline-flex items-center gap-2 px-2 py-0.5 rounded-full bg-violet-100 dark:bg-violet-900/40 text-violet-700 dark:text-violet-300 text-[10px] font-medium mb-1">
              <Wand2 size={10} /> Built with Vibe
            </div>
            <h1 className="text-2xl font-semibold mb-0.5">{app.name}</h1>
            {app.description && <p className="text-sm text-zinc-500">{app.description}</p>}
            <p className="text-[10px] text-zinc-500-2 font-mono mt-1">/build/{app.slug} · {rows.length} row{rows.length === 1 ? "" : "s"}</p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => setShowNewRow(true)}
            className="inline-flex items-center gap-2 px-4 py-2 rounded-xl bg-violet-600 hover:bg-violet-700 text-white text-sm font-medium"
          >
            <Plus size={14} /> New row
          </button>
          <button
            type="button"
            onClick={deleteApp}
            className="p-2 rounded-lg text-zinc-500-2 hover:text-rose-600 hover:bg-rose-50 dark:hover:bg-rose-950/40"
            aria-label="Archive app"
            title="Archive app"
          >
            <Trash2 size={14} />
          </button>
        </div>
      </div>

      {error && (
        <div className="mb-4 rounded-lg border border-rose-200 bg-rose-50 dark:bg-rose-950/30 px-3 py-2 text-xs text-rose-700">
          {error}
        </div>
      )}

      {/* Multi-view rendering — Table / Kanban / Calendar / Gallery */}
      {rows.length === 0 ? (
        <div className="rounded-xl border border-zinc-200 bg-white text-center py-16">
          <Wand2 size={32} className="mx-auto mb-2 text-zinc-500-2" />
          <p className="font-medium text-sm mb-1">No rows yet</p>
          <p className="text-xs text-zinc-500 mb-4">Add the first row to populate your app.</p>
          <button
            type="button"
            onClick={() => setShowNewRow(true)}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-violet-600 hover:bg-violet-700 text-white text-xs font-medium"
          >
            <Plus size={11} /> Add first row
          </button>
        </div>
      ) : (
        <BoardView
          boardKey={`build-app:${app.slug}`}
          items={rows.map((row, idx) => ({ ...row, __idx: idx }))}
          fields={fields as BoardField[]}
          getId={(r) => String((r as { __idx: number }).__idx)}
          getTitle={(r) => {
            const firstText = fields.find((f) => f.fieldType === "TEXT");
            return String((r as Record<string, unknown>)[firstText?.key ?? fields[0]?.key ?? ""] ?? "Untitled");
          }}
          getValue={(r, key) => (r as Record<string, unknown>)[key]}
          selectable
          onChangeField={async (id, fieldKey, value) => {
            const idx = Number(id);
            const res = await fetch(`/api/build/apps/${app.slug}/rows`, {
              method: "PATCH",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ index: idx, row: { [fieldKey]: value } }),
            });
            if (res.ok) await load();
          }}
          onBulkChange={async (ids, fieldKey, value) => {
            // Patch each row by index. Indexes are stable for a single
            // load (we re-render after each batch).
            await Promise.all(ids.map((id) => fetch(`/api/build/apps/${app.slug}/rows`, {
              method: "PATCH",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ index: Number(id), row: { [fieldKey]: value } }),
            })));
            await load();
          }}
          onBulkDelete={async (ids) => {
            // Delete in DESC order so prior deletes don't shift later
            // indexes. The rows API deletes by index against the live
            // app.ui.rows array.
            const desc = [...ids].map(Number).sort((a, b) => b - a);
            for (const idx of desc) {
              await fetch(`/api/build/apps/${app.slug}/rows`, {
                method: "DELETE",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ index: idx }),
              });
            }
            await load();
          }}
        />
      )}

      {showNewRow && (
        <NewRowModal
          fields={fields}
          onClose={() => setShowNewRow(false)}
          onSave={appendRow}
        />
      )}
    </div>
  );
}

function CellValue({ field, value }: { field: AppField; value: unknown }) {
  if (value == null) return <span className="text-zinc-500-2">—</span>;
  switch (field.fieldType) {
    case "CHECKBOX":
      return <span className={value ? "text-emerald-600" : "text-zinc-500-2"}>{value ? "✓" : "—"}</span>;
    case "DATE":
      return <span>{typeof value === "string" ? new Date(value).toLocaleDateString() : String(value)}</span>;
    case "MULTI_SELECT": {
      const arr = Array.isArray(value) ? (value as string[]) : [];
      return (
        <div className="flex flex-wrap gap-1">
          {arr.map((v) => (
            <span key={v} className="text-[10px] px-1.5 py-0.5 rounded bg-violet-100 dark:bg-violet-950/40 text-violet-700">{v}</span>
          ))}
        </div>
      );
    }
    case "SELECT": {
      const label = field.options?.choices?.find((c) => c.value === value)?.label ?? String(value);
      return <span className="text-[10px] px-2 py-0.5 rounded-full bg-zinc-100 dark:bg-zinc-800">{label}</span>;
    }
    case "URL":
      return <a href={String(value)} target="_blank" rel="noopener noreferrer" className="text-xs text-violet-600 hover:underline">{String(value)}</a>;
    case "EMAIL":
      return <a href={`mailto:${String(value)}`} className="text-xs text-violet-600 hover:underline">{String(value)}</a>;
    case "TEXTAREA":
      return <span className="line-clamp-2 text-xs text-zinc-500">{String(value)}</span>;
    default:
      return <span>{String(value)}</span>;
  }
}

function NewRowModal({
  fields,
  onClose,
  onSave,
}: {
  fields: AppField[];
  onClose: () => void;
  onSave: (row: Record<string, unknown>) => Promise<void>;
}) {
  const [values, setValues] = useState<Record<string, unknown>>({});
  const [saving, setSaving] = useState(false);

  function update(key: string, v: unknown) {
    setValues((prev) => ({ ...prev, [key]: v }));
  }
  function toggleMulti(key: string, val: string) {
    setValues((prev) => {
      const arr = Array.isArray(prev[key]) ? [...(prev[key] as string[])] : [];
      const idx = arr.indexOf(val);
      if (idx >= 0) arr.splice(idx, 1); else arr.push(val);
      return { ...prev, [key]: arr };
    });
  }

  async function submit() {
    setSaving(true);
    try { await onSave(values); }
    finally { setSaving(false); }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40" onClick={onClose}>
      <div className="w-full max-w-lg rounded-2xl bg-white border border-zinc-200 shadow-xl p-6 space-y-3 max-h-[90vh] overflow-y-auto" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between mb-2">
          <h2 className="text-lg font-semibold">New row</h2>
          <button type="button" onClick={onClose} className="p-1 rounded hover:bg-zinc-50 text-zinc-500"><X size={16} /></button>
        </div>
        {fields.map((f) => (
          <div key={f.key}>
            <label className="block text-xs font-medium text-zinc-500-2 mb-1">{f.label}</label>
            {f.fieldType === "TEXTAREA" ? (
              <textarea
                value={String(values[f.key] ?? "")}
                onChange={(e) => update(f.key, e.target.value)}
                rows={3}
                className="w-full px-3 py-2 rounded-lg border border-zinc-200 bg-white text-sm resize-none"
              />
            ) : f.fieldType === "NUMBER" ? (
              <input type="number" value={String(values[f.key] ?? "")} onChange={(e) => update(f.key, e.target.value === "" ? null : Number(e.target.value))} className="w-full px-3 py-2 rounded-lg border border-zinc-200 bg-white text-sm" />
            ) : f.fieldType === "DATE" ? (
              <input type="date" value={String(values[f.key] ?? "")} onChange={(e) => update(f.key, e.target.value || null)} className="w-full px-3 py-2 rounded-lg border border-zinc-200 bg-white text-sm" />
            ) : f.fieldType === "CHECKBOX" ? (
              <label className="inline-flex items-center gap-2 text-sm">
                <input type="checkbox" checked={!!values[f.key]} onChange={(e) => update(f.key, e.target.checked)} />
                {f.label}
              </label>
            ) : f.fieldType === "SELECT" ? (
              <select value={String(values[f.key] ?? "")} onChange={(e) => update(f.key, e.target.value || null)} className="w-full px-3 py-2 rounded-lg border border-zinc-200 bg-white text-sm">
                <option value="">— None —</option>
                {(f.options?.choices ?? []).map((c) => <option key={c.value} value={c.value}>{c.label ?? c.value}</option>)}
              </select>
            ) : f.fieldType === "MULTI_SELECT" ? (
              <div className="flex flex-wrap gap-1.5">
                {(f.options?.choices ?? []).map((c) => {
                  const arr = Array.isArray(values[f.key]) ? (values[f.key] as string[]) : [];
                  const sel = arr.includes(c.value);
                  return (
                    <button
                      key={c.value}
                      type="button"
                      onClick={() => toggleMulti(f.key, c.value)}
                      className={"text-xs px-2 py-1 rounded-md border transition-colors " + (sel ? "bg-violet-100 dark:bg-violet-950/40 border-violet-300 text-violet-700" : "bg-white border-zinc-200 text-zinc-500 hover:border-muted-2")}
                    >
                      {c.label ?? c.value}
                    </button>
                  );
                })}
              </div>
            ) : (
              <input
                type={f.fieldType === "EMAIL" ? "email" : f.fieldType === "URL" ? "url" : "text"}
                value={String(values[f.key] ?? "")}
                onChange={(e) => update(f.key, e.target.value || null)}
                className="w-full px-3 py-2 rounded-lg border border-zinc-200 bg-white text-sm"
              />
            )}
          </div>
        ))}
        <div className="flex items-center justify-end gap-2 pt-2 border-t border-zinc-200">
          <button type="button" onClick={onClose} className="px-3 py-2 rounded-lg text-sm text-zinc-500 hover:bg-zinc-50">Cancel</button>
          <button
            type="button"
            onClick={submit}
            disabled={saving}
            className="px-4 py-2 rounded-lg text-sm font-medium bg-violet-600 hover:bg-violet-700 text-white disabled:opacity-50 inline-flex items-center gap-1.5"
          >
            {saving ? <Loader2 size={12} className="animate-spin" /> : <Zap size={12} />}
            {saving ? "Saving…" : "Save row"}
          </button>
        </div>
      </div>
    </div>
  );
}
