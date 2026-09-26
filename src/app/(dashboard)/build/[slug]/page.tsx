"use client";

// A Build app (spec-tools-misc 2.4). Loads the App and its rows from
// /api/build/apps/[slug], renders them through BoardView (table, board,
// calendar, gallery), and lets an Owner or Admin add and delete rows. An
// archived app opens read only with Restore; a missing one is the in-shell
// 404 with the way back, never a silent redirect.

import { useCallback, useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import {
  Hammer,
  Plus,
  Trash2,
  Wand2,
  X,
  Zap,
} from "lucide-react";
import { OsEmptyView } from "@/components/layout/os/empty-view";
import { EntityTile, NEUTRAL_TILE } from "@/components/ui/entity-tile";
import { SkeletonRows } from "@/components/ui/skeleton";
import { Dots } from "@/components/ui/dots";
import { BoardView, type BoardField } from "@/components/board-view/board-view";
import { useConfirm } from "@/components/ui/dialog-provider";
import { BackButton } from "@/components/ui/back-button";

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
  status?: "DRAFT" | "PUBLISHED" | "ARCHIVED";
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
  // "missing" is the in-shell 404 (spec-tools-misc 2.4: "That app does not
  // exist, or it was deleted."), "failed" a load error with Retry. Before,
  // a 404 silently pushed to /build and any other failure left a blank page.
  const [loadState, setLoadState] = useState<"ok" | "missing" | "failed">("ok");
  // Archive and Restore: Owner and Admin, or the app's creator (the API's
  // canManage). A Member using an app someone else built fills its rows only.
  const [canManage, setCanManage] = useState(false);

  const load = useCallback(async () => {
    if (!params?.slug) return;
    setLoading(true);
    try {
      const res = await fetch(`/api/build/apps/${params.slug}`);
      if (!res.ok) {
        setLoadState(res.status === 404 ? "missing" : "failed");
        return;
      }
      const data = await res.json();
      setLoadState("ok");
      setApp(data.app);
      setCanManage(data.canManage === true);
    } catch {
      setLoadState("failed");
    } finally {
      setLoading(false);
    }
  }, [params?.slug]);

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

  async function restoreApp() {
    if (!app) return;
    const res = await fetch(`/api/build/apps/${app.slug}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ status: "PUBLISHED" }) });
    if (res.ok) await load();
    else setError("Couldn't restore the app");
  }

  if (loading && !app) {
    return (
      <div className="p-6">
        <SkeletonRows rows={6} />
      </div>
    );
  }
  if (loadState === "missing") {
    return (
      <OsEmptyView title="That app does not exist, or it was deleted.">
        <BackButton fallbackHref="/build" label="Build apps" />
      </OsEmptyView>
    );
  }
  if (loadState === "failed" || !app) {
    return <OsEmptyView variant="error" title="Couldn't load this app" action={{ label: "Try again", onClick: () => void load() }} />;
  }
  const archived = app.status === "ARCHIVED";

  const fields = app.schema.fields ?? [];
  const rows = app.ui.rows ?? [];

  return (
    <div className="bldd p-6 max-w-[1600px] mx-auto">
      <div className="mb-3"><BackButton fallbackHref="/build" label="Build apps" /></div>

      <div className="flex items-start justify-between mb-6">
        <div className="flex items-start gap-4">
          <EntityTile size="lg" icon={Hammer} {...NEUTRAL_TILE} />
          <div>
            <h1 className="text-2xl font-semibold mb-0.5">{app.name}</h1>
            {app.description && <p className="text-xs text-zinc-500">{app.description}</p>}
            <p className="text-xs text-zinc-500 font-mono mt-1">/build/{app.slug} · {rows.length} row{rows.length === 1 ? "" : "s"}</p>
          </div>
        </div>
        {archived ? (
          <div className="flex items-center gap-3 text-sm text-ink-2">
            This app is archived, so its rows are read only.
            {canManage ? <button type="button" onClick={() => void restoreApp()} className="inline-flex h-9 items-center rounded-md bg-brand px-3 text-base font-medium text-white hover:bg-brand-hover">Restore</button> : null}
          </div>
        ) : (
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => setShowNewRow(true)}
            className="inline-flex items-center gap-2 px-4 py-2 rounded-xl bg-[#0073EA] hover:bg-[#0060B9] text-white text-xs font-medium"
          >
            <Plus size={14} /> New row
          </button>
          {canManage ? <button
            type="button"
            onClick={deleteApp}
            className="p-2 rounded-lg text-zinc-500 hover:text-[#E2445C] hover:bg-red-50 dark:hover:bg-red-950/40"
            aria-label="Archive app"
            title="Archive app"
          >
            <Trash2 size={14} />
          </button> : null}
        </div>
        )}
      </div>

      {error && (
        <div className="mb-4 rounded-lg border border-red-200 bg-red-50 dark:bg-red-950/30 px-3 py-2 text-xs text-red-700">
          {error}
        </div>
      )}

      {/* Multi-view rendering, Table / Kanban / Calendar / Gallery */}
      {rows.length === 0 ? (
        <div className="rounded-xl border border-zinc-200 bg-white text-center py-16">
          <Wand2 size={32} className="mx-auto mb-2 text-zinc-500" />
          <p className="font-medium text-xs mb-1">No rows yet</p>
          <p className="text-xs text-zinc-500 mb-4">{archived ? "This app is archived." : "Add the first row to populate your app."}</p>
          {archived ? null : <button
            type="button"
            onClick={() => setShowNewRow(true)}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-[#0073EA] hover:bg-[#0060B9] text-white text-xs font-medium"
          >
            <Plus size={11} /> Add first row
          </button>}
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
            if (archived) { setError("Restore the app to change its rows."); return; }
            const idx = Number(id);
            const res = await fetch(`/api/build/apps/${app.slug}/rows`, {
              method: "PATCH",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ index: idx, row: { [fieldKey]: value } }),
            });
            if (res.ok) await load();
            else setError("Couldn't save that change. Try again.");
          }}
          onBulkChange={async (ids, fieldKey, value) => {
            if (archived) { setError("Restore the app to change its rows."); return; }
            // Patch each row by index, one at a time. Indexes are stable for
            // a single load (we re-render after the batch). The route locks
            // the app row per write, so nothing is lost either way; a write
            // that fails is counted and said, never swallowed.
            let failed = 0;
            for (const id of ids) {
              const res = await fetch(`/api/build/apps/${app.slug}/rows`, {
                method: "PATCH",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ index: Number(id), row: { [fieldKey]: value } }),
              }).catch(() => null);
              if (!res?.ok) failed++;
            }
            if (failed > 0) setError(`Couldn't save ${failed} of ${ids.length} rows. Try again.`);
            await load();
          }}
          onBulkDelete={async (ids) => {
            if (archived) { setError("Restore the app to change its rows."); return; }
            // Delete in DESC order so prior deletes don't shift later
            // indexes. The rows API deletes by index against the live
            // app.ui.rows array.
            const desc = [...ids].map(Number).sort((a, b) => b - a);
            let failed = 0;
            for (const idx of desc) {
              const res = await fetch(`/api/build/apps/${app.slug}/rows`, {
                method: "DELETE",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ index: idx }),
              }).catch(() => null);
              if (!res?.ok) failed++;
            }
            if (failed > 0) setError(`Couldn't delete ${failed} of ${desc.length} rows. Try again.`);
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
            <label className="block text-xs font-medium text-zinc-500 mb-1">{f.label}</label>
            {f.fieldType === "TEXTAREA" ? (
              <textarea
                value={String(values[f.key] ?? "")}
                onChange={(e) => update(f.key, e.target.value)}
                rows={3}
                className="w-full px-3 py-2 rounded-lg border border-zinc-200 bg-white text-xs resize-none"
              />
            ) : f.fieldType === "NUMBER" ? (
              <input type="number" value={String(values[f.key] ?? "")} onChange={(e) => update(f.key, e.target.value === "" ? null : Number(e.target.value))} className="w-full px-3 py-2 rounded-lg border border-zinc-200 bg-white text-xs" />
            ) : f.fieldType === "DATE" ? (
              <input type="date" value={String(values[f.key] ?? "")} onChange={(e) => update(f.key, e.target.value || null)} className="w-full px-3 py-2 rounded-lg border border-zinc-200 bg-white text-xs" />
            ) : f.fieldType === "CHECKBOX" ? (
              <label className="inline-flex items-center gap-2 text-xs">
                <input type="checkbox" checked={!!values[f.key]} onChange={(e) => update(f.key, e.target.checked)} />
                {f.label}
              </label>
            ) : f.fieldType === "SELECT" ? (
              <select value={String(values[f.key] ?? "")} onChange={(e) => update(f.key, e.target.value || null)} className="w-full px-3 py-2 rounded-lg border border-zinc-200 bg-white text-xs">
                <option value="">None</option>
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
                      className={"text-xs px-2 py-1 rounded-md border transition-colors " + (sel ? "bg-blue-100 dark:bg-blue-500/10 border-blue-300 text-blue-700" : "bg-white border-zinc-200 text-zinc-500 hover:border-muted-2")}
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
                className="w-full px-3 py-2 rounded-lg border border-zinc-200 bg-white text-xs"
              />
            )}
          </div>
        ))}
        <div className="flex items-center justify-end gap-2 pt-2 border-t border-zinc-200">
          <button type="button" onClick={onClose} className="px-3 py-2 rounded-lg text-xs text-zinc-500 hover:bg-zinc-50">Cancel</button>
          <button
            type="button"
            onClick={submit}
            disabled={saving}
            className="px-4 py-2 rounded-lg text-xs font-medium bg-[#0073EA] hover:bg-[#0060B9] text-white disabled:opacity-50 inline-flex items-center gap-1.5"
          >
            {saving ? <Dots variant="pending" /> : <Zap size={12} />}
            {saving ? "Saving…" : "Save row"}
          </button>
        </div>
      </div>
    </div>
  );
}
