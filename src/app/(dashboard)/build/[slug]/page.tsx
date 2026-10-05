"use client";

// A Build app (spec-tools-misc 2.4): use the app you built. Loads the App and
// its rows from /api/build/apps/[slug], renders them through BoardView
// (table, board, calendar, gallery, inline edit, bulk change and bulk
// delete), and lets the viewer add rows. Header stack: BackButton to Build
// apps, the neutral tile, the name, and a "…" with Rename, Copy link,
// Archive or Restore, Delete. An archived app opens read only; a missing one
// is the in-shell 404 with the way back, never a silent redirect.
//
// What changed: the dynamic Tailwind classes (bg-${hue}-100) that never
// compiled, the "Built with Vibe" pill, the hand-rolled header and modal,
// the hex literals and the unused CellValue are gone. Row identity is the
// row's real id (the API stamps one on every row; a row from before has its
// index), a bulk change is one request, and Delete moves the app to Trash.

import { useCallback, useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { Archive, ArchiveRestore, Copy, Hammer, Link2, ListChecks, Pencil, Plus, Trash2 } from "lucide-react";
import { Breadcrumb } from "@/components/layout/os/top-bar/breadcrumb";
import { duplicateBuildApp } from "@/lib/build/duplicate-app";
import { EditFieldsDialog } from "../_components/edit-fields-dialog";
import { OsPageHeader } from "@/components/layout/os/page-header";
import { OsEmptyView } from "@/components/layout/os/empty-view";
import { useOsToast } from "@/components/layout/os/toast";
import { useBoot } from "@/components/layout/os/boot-context";
import { NEUTRAL_TILE } from "@/components/ui/entity-tile";
import { SkeletonRows } from "@/components/ui/skeleton";
import { Dots } from "@/components/ui/dots";
import { BoardView, type BoardField } from "@/components/board-view/board-view";
import { useConfirm, usePrompt } from "@/components/ui/dialog-provider";
import { BackButton } from "@/components/ui/back-button";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import { Switch } from "@/components/ui/switch";
import { apiFetch } from "@/lib/api-fetch";
import { trashRestoreSentence } from "@/lib/trash-view";

type FieldType = "TEXT" | "TEXTAREA" | "NUMBER" | "DATE" | "CHECKBOX" | "SELECT" | "MULTI_SELECT" | "URL" | "EMAIL";

interface AppField {
  key: string;
  label: string;
  fieldType: FieldType;
  options?: { choices?: { value: string; label?: string }[] };
}

interface AppRow {
  [key: string]: unknown;
  __id?: string;
  __createdAt?: string;
  __createdById?: string;
}

interface AppRecord {
  id: string;
  slug: string;
  name: string;
  description: string | null;
  status?: "DRAFT" | "PUBLISHED" | "ARCHIVED";
  schema: { fields?: AppField[] };
  ui: { rows?: AppRow[] };
}

/** A row's identity: its stamped id, else (a row from before ids) its index. */
const rowId = (row: AppRow, idx: number) => (typeof row.__id === "string" ? row.__id : String(idx));

export default function BuildAppPage() {
  const params = useParams<{ slug: string }>();
  const router = useRouter();
  const confirm = useConfirm();
  const promptDialog = usePrompt();
  const { toast } = useOsToast();
  const { boot } = useBoot();
  const [app, setApp] = useState<AppRecord | null>(null);
  const [showNewRow, setShowNewRow] = useState(false);
  const [editFields, setEditFields] = useState(false);
  const [loadState, setLoadState] = useState<"loading" | "ok" | "missing" | "failed">("loading");
  // Rename, Archive, Restore, Delete: Owner and Admin, or the app's creator
  // (the API's canManage). A Member using an app someone else built fills
  // its rows only.
  const [canManage, setCanManage] = useState(false);

  const load = useCallback(async () => {
    if (!params?.slug) return;
    const r = await apiFetch<{ app: AppRecord; canManage?: boolean }>(`/api/build/apps/${params.slug}`, { cache: "no-store" });
    if (!r.ok) { setLoadState(r.status === 404 ? "missing" : "failed"); return; }
    setLoadState("ok");
    setApp(r.data.app);
    setCanManage(r.data.canManage === true);
  }, [params?.slug]);
  useEffect(() => {
    const t = setTimeout(() => { void load(); }, 0);
    const onFocus = () => { void load(); };
    window.addEventListener("focus", onFocus);
    return () => { clearTimeout(t); window.removeEventListener("focus", onFocus); };
  }, [load]);

  const fail = (msg: string, retry: () => void) => toast(msg, { tone: "danger", action: { label: "Try again", onClick: retry } });

  async function appendRow(row: Record<string, unknown>): Promise<boolean> {
    if (!app) return false;
    const r = await apiFetch(`/api/build/apps/${app.slug}/rows`, { method: "POST", json: { row } });
    if (!r.ok) { fail(r.error || "Couldn't add the row", () => void appendRow(row)); return false; }
    toast("Row added");
    await load();
    return true;
  }

  async function rename() {
    if (!app) return;
    const name = await promptDialog({ title: "Rename app", defaultValue: app.name, submitLabel: "Rename", required: true });
    if (!name || name.trim() === app.name) return;
    const r = await apiFetch(`/api/build/apps/${app.slug}`, { method: "PATCH", json: { name: name.trim() } });
    if (!r.ok) { fail(r.error || "Couldn't rename the app", () => void rename()); return; }
    toast("Renamed");
    await load();
  }

  async function setStatus(status: "ARCHIVED" | "PUBLISHED") {
    if (!app) return;
    if (status === "ARCHIVED") {
      const ok = await confirm({ title: `Archive ${app.name}?`, description: "It leaves the list and its rows stop changing. Show archived on Build apps brings it back, and you can restore it.", confirmLabel: "Archive", destructive: true });
      if (!ok) return;
    }
    const r = await apiFetch(`/api/build/apps/${app.slug}`, { method: "PATCH", json: { status } });
    if (!r.ok) { fail(r.error || (status === "ARCHIVED" ? "Couldn't archive the app" : "Couldn't restore the app"), () => void setStatus(status)); return; }
    toast(status === "ARCHIVED" ? `${app.name} archived` : `${app.name} restored`);
    await load();
  }

  async function deleteApp() {
    if (!app) return;
    const ok = await confirm({
      title: `Delete ${app.name}?`,
      description: `It moves to Trash with its rows. ${trashRestoreSentence(boot.org)}`,
      confirmLabel: "Delete",
      destructive: true,
    });
    if (!ok) return;
    const r = await apiFetch(`/api/build/apps/${app.slug}`, { method: "DELETE" });
    if (!r.ok) { fail(r.error || "Couldn't delete the app", () => void deleteApp()); return; }
    toast(`${app.name} moved to Trash`);
    router.push("/build");
  }

  // Duplicate: a new app with the same fields and no rows (Owner and Admin).
  const canDuplicate = boot.viewer.orgRole === "OWNER" || boot.viewer.orgRole === "ADMIN";
  async function duplicate() {
    if (!app) return;
    const r = await duplicateBuildApp(app.slug);
    if (!r.ok) { fail(r.error, () => void duplicate()); return; }
    toast(`${r.name} created`, { action: { label: "Open", onClick: () => router.push(`/build/${r.slug}`) } });
  }

  async function copyLink() {
    if (!app) return;
    try { await navigator.clipboard.writeText(`${window.location.origin}/build/${app.slug}`); toast("Link copied"); }
    catch { toast("Couldn't copy the link", { tone: "danger" }); }
  }

  if (loadState === "loading" && !app) {
    return (
      <>
        <OsPageHeader title="Build apps" back={{ fallbackHref: "/build", label: "Build apps" }} />
        <div className="px-6 pt-2"><SkeletonRows rows={6} /></div>
      </>
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

  const more = canManage ? [
    { label: "Rename", icon: Pencil, onClick: () => void rename() },
    { label: "Edit fields", icon: ListChecks, onClick: () => setEditFields(true) },
    ...(canDuplicate ? [{ label: "Duplicate", icon: Copy, onClick: () => void duplicate() }] : []),
    { label: "Copy link", icon: Link2, onClick: () => void copyLink() },
    archived
      ? { label: "Restore", icon: ArchiveRestore, onClick: () => void setStatus("PUBLISHED") }
      : { label: "Archive", icon: Archive, onClick: () => void setStatus("ARCHIVED") },
    { label: "Delete", icon: Trash2, destructive: true, onClick: () => void deleteApp() },
  ] : [
    { label: "Copy link", icon: Link2, onClick: () => void copyLink() },
  ];

  return (
    <>
      {/* The location row: AI > Build apps > {app name} (spec 2.4). */}
      <Breadcrumb items={[{ label: "Build apps", href: "/build" }, { label: app.name }]} />
      <OsPageHeader
        title={app.name}
        back={{ fallbackHref: "/build", label: "Build apps" }}
        tile={{ icon: Hammer, ...NEUTRAL_TILE }}
        more={more}
        toolbar={{
          left: app.description ? <span className="truncate text-sm text-ink-2">{app.description}</span> : undefined,
          right: archived ? (
            <span className="inline-flex items-center gap-3 text-sm text-ink-2">
              Archived, so its rows are read only.
              {canManage ? <button type="button" onClick={() => void setStatus("PUBLISHED")} className="font-medium text-brand-deep hover:underline">Restore</button> : null}
            </span>
          ) : undefined,
          primary: archived ? undefined : { label: "New row", icon: Plus, onClick: () => setShowNewRow(true) },
        }}
      />

      <div className="px-6 pb-8 pt-2">
        {rows.length === 0 ? (
          <OsEmptyView context="board" title="No rows yet" hint={archived ? "Restore the app to add rows." : undefined} />
        ) : (
          <BoardView
            boardKey={`build-app:${app.slug}`}
            items={rows.map((row, idx) => ({ ...row, __rid: rowId(row, idx) }))}
            fields={fields as BoardField[]}
            getId={(r) => String((r as { __rid: string }).__rid)}
            getTitle={(r) => {
              const firstText = fields.find((f) => f.fieldType === "TEXT");
              return String((r as Record<string, unknown>)[firstText?.key ?? fields[0]?.key ?? ""] ?? "Untitled");
            }}
            getValue={(r, key) => (r as Record<string, unknown>)[key]}
            selectable
            editableFields={archived ? [] : undefined}
            onChangeField={async (id, fieldKey, value) => {
              if (archived) { toast("Restore the app to change its rows."); return; }
              const r = await apiFetch(`/api/build/apps/${app.slug}/rows`, { method: "PATCH", json: { id, row: { [fieldKey]: value } } });
              if (!r.ok) { fail("Couldn't save that change.", () => void load()); return; }
              await load();
            }}
            onBulkChange={async (ids, fieldKey, value) => {
              if (archived) { toast("Restore the app to change its rows."); return; }
              const r = await apiFetch<{ changed: number; failed: number }>(`/api/build/apps/${app.slug}/rows`, { method: "PATCH", json: { ids, row: { [fieldKey]: value } } });
              if (!r.ok) fail("Couldn't save those rows.", () => void load());
              else if (r.data.failed > 0) toast(`Changed ${r.data.changed} of ${ids.length} rows.`, { tone: "danger" });
              await load();
            }}
            onBulkDelete={async (ids) => {
              if (archived) { toast("Restore the app to change its rows."); return; }
              const r = await apiFetch<{ deleted: number; failed: number }>(`/api/build/apps/${app.slug}/rows`, { method: "DELETE", json: { ids } });
              if (!r.ok) fail("Couldn't delete those rows.", () => void load());
              else if (r.data.failed > 0) toast(`Deleted ${r.data.deleted} of ${ids.length} rows.`, { tone: "danger" });
              else toast(`${r.data.deleted} ${r.data.deleted === 1 ? "row" : "rows"} deleted`);
              await load();
            }}
          />
        )}
      </div>

      {showNewRow ? (
        <NewRowDialog fields={fields} onClose={() => setShowNewRow(false)} onSave={async (row) => { if (await appendRow(row)) setShowNewRow(false); }} />
      ) : null}
      {editFields ? (
        <EditFieldsDialog
          slug={app.slug}
          fields={fields}
          onClose={() => setEditFields(false)}
          onSaved={() => { setEditFields(false); toast("Fields saved"); void load(); }}
        />
      ) : null}
    </>
  );
}

/* ─────────────────────────── New row ─────────────────────────── */

const INPUT = "h-9 w-full rounded-md border border-line-strong bg-raised px-3 text-base font-normal text-ink placeholder:text-ink-3";

function NewRowDialog({ fields, onClose, onSave }: {
  fields: AppField[];
  onClose: () => void;
  onSave: (row: Record<string, unknown>) => Promise<void>;
}) {
  const confirm = useConfirm();
  const [values, setValues] = useState<Record<string, unknown>>({});
  const [saving, setSaving] = useState(false);
  const dirty = Object.values(values).some((v) => v !== null && v !== undefined && v !== "" && v !== false && !(Array.isArray(v) && v.length === 0));

  const update = (key: string, v: unknown) => setValues((prev) => ({ ...prev, [key]: v }));
  const toggleMulti = (key: string, val: string) =>
    setValues((prev) => {
      const arr = Array.isArray(prev[key]) ? [...(prev[key] as string[])] : [];
      const idx = arr.indexOf(val);
      if (idx >= 0) arr.splice(idx, 1); else arr.push(val);
      return { ...prev, [key]: arr };
    });

  async function close() {
    if (dirty && !(await confirm({ title: "Discard this row?", description: "What you typed here is not saved.", confirmLabel: "Discard", destructive: true }))) return;
    onClose();
  }

  async function submit() {
    setSaving(true);
    try { await onSave(values); } finally { setSaving(false); }
  }

  return (
    <Dialog open onOpenChange={(v) => { if (!v) void close(); }}>
      <DialogContent className="max-w-[560px]">
        <DialogHeader>
          <DialogTitle>New row</DialogTitle>
          <DialogDescription>One value per field. You can change any of them later, in the table.</DialogDescription>
        </DialogHeader>
        <div className="flex max-h-[60vh] flex-col gap-3 overflow-y-auto">
          {fields.map((f) => (
            <label key={f.key} className="flex flex-col gap-1 text-sm font-medium text-ink">
              {f.label}
              {f.fieldType === "TEXTAREA" ? (
                <textarea value={String(values[f.key] ?? "")} onChange={(e) => update(f.key, e.target.value)} rows={3} className="rounded-md border border-line-strong bg-raised px-3 py-2 text-base font-normal text-ink" />
              ) : f.fieldType === "NUMBER" ? (
                <input type="number" value={String(values[f.key] ?? "")} onChange={(e) => update(f.key, e.target.value === "" ? null : Number(e.target.value))} className={`${INPUT} tabular-nums`} />
              ) : f.fieldType === "DATE" ? (
                <input type="date" value={String(values[f.key] ?? "")} onChange={(e) => update(f.key, e.target.value || null)} className={INPUT} />
              ) : f.fieldType === "CHECKBOX" ? (
                <span className="flex h-9 items-center">
                  <Switch checked={Boolean(values[f.key])} onChange={(v) => update(f.key, v)} aria-label={f.label} />
                </span>
              ) : f.fieldType === "SELECT" ? (
                <select value={String(values[f.key] ?? "")} onChange={(e) => update(f.key, e.target.value || null)} className={`${INPUT} appearance-none`}>
                  <option value="">None</option>
                  {(f.options?.choices ?? []).map((c) => <option key={c.value} value={c.value}>{c.label ?? c.value}</option>)}
                </select>
              ) : f.fieldType === "MULTI_SELECT" ? (
                <span className="flex flex-wrap gap-1.5">
                  {(f.options?.choices ?? []).map((c) => {
                    const arr = Array.isArray(values[f.key]) ? (values[f.key] as string[]) : [];
                    const sel = arr.includes(c.value);
                    return (
                      <button
                        key={c.value}
                        type="button"
                        aria-pressed={sel}
                        onClick={() => toggleMulti(f.key, c.value)}
                        className={`inline-flex h-7 items-center rounded-md border px-2 text-sm font-normal ${sel ? "border-brand bg-brand-soft text-brand-deep" : "border-line bg-raised text-ink-2 hover:bg-hover"}`}
                      >
                        {c.label ?? c.value}
                      </button>
                    );
                  })}
                </span>
              ) : (
                <input
                  type={f.fieldType === "EMAIL" ? "email" : f.fieldType === "URL" ? "url" : "text"}
                  value={String(values[f.key] ?? "")}
                  onChange={(e) => update(f.key, e.target.value || null)}
                  className={INPUT}
                />
              )}
            </label>
          ))}
        </div>
        <DialogFooter>
          <button type="button" onClick={() => void close()} className="inline-flex h-9 items-center rounded-md px-3 text-base font-medium text-ink-2 hover:bg-hover hover:text-ink">Cancel</button>
          <button type="button" onClick={() => void submit()} disabled={saving} className="inline-flex h-9 items-center gap-2 rounded-md bg-brand px-3 text-base font-medium text-white hover:bg-brand-hover disabled:opacity-50">
            {saving ? <Dots variant="pending" /> : null} Add row
          </button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
