"use client";

// ListDefaultsPanel: a List's Default values (gap 14, List comfort), opened
// from the List's "…" menu.
//
// What a NEW task in this List starts with, for any value the person did not
// set when they created it: a status, a priority, assignees, tags, and any of
// the List's own fields that can hold a plain value. Defaults apply at
// creation only (POST /api/boards/[id]/items, list-comfort.ts
// planCreateDefaults); existing tasks are never changed, and the panel says
// so. The defaults it loads are the server's PRUNED set (GET
// /api/boards/[id]/settings): anything whose field, status, person or tag has
// gone is already out of it, and a line counts what a Save will drop.
//
// Save builds the object from exactly the rows on screen, so a row the panel
// did not render can never be written. A refused Save keeps every value,
// shows each problem beside its row, and offers Retry; a saved one tells any
// open List page to re-read its settings.

import { useCallback, useEffect, useMemo, useState } from "react";
import { X } from "lucide-react";
import { Dots } from "@/components/ui/dots";
import { accessMessage } from "@/lib/access-message";
import { PRIORITY_OPTIONS, type ItemTag, type StatusOption } from "@/lib/board-items-shared";
import { parseBoardSchema, type FieldDef } from "@/lib/field-catalog";
import { isValidDefaultFieldValue, type ListDefaults } from "@/lib/list-comfort";
import { LIST_SETTINGS_CHANGED } from "@/lib/table-comfort";
import { FieldValue } from "../field-value";
import { MultiAssigneePicker, type PersonRef } from "../assignee-picker";
import { TagPicker } from "../tag-picker";

/** Field types a default can hold: a plain value that is still true at creation. */
const DEFAULTABLE_TYPES: ReadonlySet<string> = new Set([
  "TEXT", "LONG_TEXT", "URL", "EMAIL", "PHONE", "CUSTOM_TEXT", "LOCATION",
  "NUMBER", "MONEY", "PERCENT", "RATING", "PROGRESS_MANUAL",
  "CHECKBOX", "DROPDOWN", "CUSTOM_DROPDOWN", "TSHIRT_SIZE", "MULTI_SELECT", "LABELS",
  "DATE", "DATETIME", "USER", "PEOPLE",
]);

type Issues = { rows: Record<string, string>; general: string | null };

/** invalid_defaults issues, placed beside the rows they are about. */
function placeIssues(issues: unknown, rendered: ReadonlySet<string>): Issues {
  const rows: Record<string, string> = {};
  const general: string[] = [];
  for (const raw of Array.isArray(issues) ? issues : []) {
    const issue = typeof raw === "string" ? raw : "";
    const [code, key] = issue.split(":");
    let row: string | null = null;
    let text = "That value no longer fits this List.";
    if (code === "status_not_in_list") { row = "status"; text = "That status isn't on this List any more."; }
    else if (code === "duplicate_assignee" || code === "unknown_person") { row = code === "unknown_person" ? null : "assignees"; text = "One of those people is no longer in this workspace."; }
    else if (code === "duplicate_tag" || code === "unknown_tag") { row = "tags"; text = "One of those tags was archived or removed."; }
    else if (code === "unknown_field") { row = key ? `field:${key}` : null; text = "That field no longer exists."; }
    else if (code === "invalid_value") { row = key ? `field:${key}` : null; text = "That value doesn't fit this field."; }
    if (row && rendered.has(row)) rows[row] = text;
    else general.push(text);
  }
  return { rows, general: general.length ? Array.from(new Set(general)).join(" ") : null };
}

export function ListDefaultsPanel({
  boardId,
  onDone,
  onDirtyChange,
}: {
  boardId: string;
  onDone: () => void;
  /** Unsaved changes, so the host never closes the panel over them in silence. */
  onDirtyChange?: (dirty: boolean) => void;
}) {
  const [state, setState] = useState<"loading" | "ready" | "failed">("loading");
  const [statuses, setStatuses] = useState<StatusOption[]>([]);
  const [fields, setFields] = useState<FieldDef[]>([]);
  const [stale, setStale] = useState(0);
  const [status, setStatus] = useState<string>("");
  const [priority, setPriority] = useState<string>("");
  const [people, setPeople] = useState<PersonRef[]>([]);
  const [tags, setTags] = useState<ItemTag[]>([]);
  const [values, setValues] = useState<Record<string, unknown>>({});
  const [busy, setBusy] = useState(false);
  const [issues, setIssues] = useState<Issues>({ rows: {}, general: null });
  const [saved, setSaved] = useState(false);
  const [dirty, setDirty] = useState(false);
  useEffect(() => { onDirtyChange?.(dirty); }, [dirty, onDirtyChange]);
  // Every edit goes through here, so "unsaved" is exact.
  const edit = <T,>(set: (v: T) => void) => (v: T) => { set(v); setDirty(true); setSaved(false); };

  const load = useCallback(async () => {
    setState("loading");
    try {
      const [settingsRes, fieldsRes] = await Promise.all([
        fetch(`/api/boards/${boardId}/settings`, { cache: "no-store" }),
        fetch(`/api/boards/${boardId}/fields`, { cache: "no-store" }),
      ]);
      if (!settingsRes.ok || !fieldsRes.ok) { setState("failed"); return; }
      const settings = (await settingsRes.json()) as { defaults?: ListDefaults; statuses?: StatusOption[]; staleDefaults?: number };
      const f = parseBoardSchema(await fieldsRes.json()).fields;
      const d = settings.defaults ?? {};
      setStatuses(Array.isArray(settings.statuses) ? settings.statuses : []);
      setFields(f);
      setStale(typeof settings.staleDefaults === "number" ? settings.staleDefaults : 0);
      setStatus(d.status ?? "");
      setPriority(d.priority ?? "");
      setValues({ ...(d.fields ?? {}) });
      // People and tags are stored by id; read who and what they are so the
      // pickers can draw them.
      const wantPeople = d.assigneeIds ?? [];
      const wantTags = d.tagIds ?? [];
      const [assignable, allTags] = await Promise.all([
        wantPeople.length ? fetch(`/api/boards/${encodeURIComponent(boardId)}/assignable?limit=200`, { cache: "no-store" }).then((r) => (r.ok ? r.json() : null)).catch(() => null) : Promise.resolve(null),
        wantTags.length ? fetch("/api/tags", { cache: "no-store" }).then((r) => (r.ok ? r.json() : null)).catch(() => null) : Promise.resolve(null),
      ]);
      const roster: PersonRef[] = Array.isArray(assignable?.data) ? assignable.data : [];
      setPeople(wantPeople.map((id) => roster.find((p) => p.id === id) ?? { id, firstName: "", lastName: "", email: null, avatar: null }));
      const tagRows: ItemTag[] = Array.isArray(allTags) ? allTags : Array.isArray(allTags?.tags) ? allTags.tags : [];
      setTags(wantTags.map((id) => tagRows.find((t) => t.id === id) ?? { id, name: "Tag", color: null }));
      setState("ready");
    } catch {
      setState("failed");
    }
  }, [boardId]);
  useEffect(() => { void load(); }, [load]);

  const defaultable = useMemo(() => fields.filter((f) => DEFAULTABLE_TYPES.has(f.type)), [fields]);
  const rendered = useMemo(() => new Set(["status", "priority", "assignees", "tags", ...defaultable.map((f) => `field:${f.key}`)]), [defaultable]);

  const save = async () => {
    if (busy) return;
    const out: ListDefaults = {};
    if (status) out.status = status;
    if (priority) out.priority = priority as ListDefaults["priority"];
    if (people.length) out.assigneeIds = people.map((p) => p.id);
    if (tags.length) out.tagIds = tags.map((t) => t.id);
    const fieldValues: Record<string, unknown> = {};
    const local: Record<string, string> = {};
    for (const f of defaultable) {
      const v = values[f.key];
      if (v === undefined || v === null || v === "" || (Array.isArray(v) && v.length === 0)) continue;
      if (!isValidDefaultFieldValue(f, v)) { local[`field:${f.key}`] = "That value doesn't fit this field."; continue; }
      fieldValues[f.key] = v;
    }
    if (Object.keys(local).length) { setIssues({ rows: local, general: null }); return; }
    if (Object.keys(fieldValues).length) out.fields = fieldValues;
    setBusy(true);
    setIssues({ rows: {}, general: null });
    setSaved(false);
    try {
      const res = await fetch(`/api/boards/${boardId}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ defaults: Object.keys(out).length ? out : null }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => null);
        if (data?.error === "invalid_defaults") setIssues(placeIssues(data.issues, rendered));
        else setIssues({ rows: {}, general: accessMessage(data, "Couldn't save the default values. Your changes are kept; try again.") });
        return;
      }
      setStale(0);
      setSaved(true);
      setDirty(false);
      try { window.dispatchEvent(new CustomEvent(LIST_SETTINGS_CHANGED, { detail: { boardId } })); } catch { /* nothing to tell */ }
      onDone();
    } catch {
      setIssues({ rows: {}, general: "Couldn't reach the server. Your changes are kept; try again." });
    } finally {
      setBusy(false);
    }
  };

  if (state === "loading") return <div className="px-5 py-6"><Dots variant="pending" label="Loading" className="text-ink-3" /></div>;
  if (state === "failed") {
    return (
      <div className="px-5 py-6 text-center">
        <p className="text-sm text-ink-2">Couldn&apos;t load this List&apos;s settings.</p>
        <button type="button" onClick={() => void load()} className="mt-2 text-base font-medium text-brand-deep hover:underline">Retry</button>
      </div>
    );
  }

  const row = (key: string, label: string, control: React.ReactNode, onClear: (() => void) | null) => (
    <div key={key} className="py-1.5">
      <div className="flex min-h-9 items-center gap-3">
        <span className="w-[120px] shrink-0 truncate text-sm font-medium text-ink-2">{label}</span>
        <div className="flex min-w-0 flex-1 items-center rounded-md px-2 py-1 hover:bg-hover">{control}</div>
        {onClear ? (
          <button type="button" onClick={onClear} aria-label={`Clear the default ${label}`} title="Clear" className="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-ink-3 hover:bg-hover hover:text-ink">
            <X className="h-3.5 w-3.5" strokeWidth={1.5} />
          </button>
        ) : <span className="w-7 shrink-0" aria-hidden />}
      </div>
      {issues.rows[key] ? <p className="ms-[132px] text-xs text-danger-text">{issues.rows[key]}</p> : null}
    </div>
  );

  return (
    <div className="flex flex-col gap-3 px-5 py-4">
      <p className="text-sm text-ink-2">Applied to new tasks only. Existing tasks are not changed.</p>
      {stale > 0 ? (
        <p className="rounded-md bg-warning-bg px-3 py-2 text-sm text-warning-text">
          {stale} default{stale === 1 ? "" : "s"} no longer applied because {stale === 1 ? "its" : "their"} field, status, person or tag was removed. Saving removes {stale === 1 ? "it" : "them"}.
        </p>
      ) : null}

      <div className="divide-y divide-line-soft">
        {row(
          "status",
          "Status",
          <select value={status} onChange={(e) => edit(setStatus)(e.target.value)} aria-label="Default status" className="h-8 w-full rounded-md border border-line bg-raised px-2 text-base text-ink outline-none focus:border-brand">
            <option value="">No default</option>
            {statuses.map((s) => <option key={s.value} value={s.value}>{s.label}</option>)}
          </select>,
          status ? () => edit(setStatus)("") : null,
        )}
        {row(
          "priority",
          "Priority",
          <select value={priority} onChange={(e) => edit(setPriority)(e.target.value)} aria-label="Default priority" className="h-8 w-full rounded-md border border-line bg-raised px-2 text-base text-ink outline-none focus:border-brand">
            <option value="">No default</option>
            {PRIORITY_OPTIONS.map((p) => <option key={p.value} value={p.value}>{p.label}</option>)}
          </select>,
          priority ? () => edit(setPriority)("") : null,
        )}
        {row(
          "assignees",
          "Assignees",
          // A block wrapper: the pickers are inline boxes sized to fit, and
          // inside a flex row their negative margin left them a few pixels
          // short, so "No tags" broke over two lines.
          <div className="min-w-0 flex-1"><MultiAssigneePicker value={people} canEdit boardId={boardId} onChange={(next) => edit(setPeople)(next.slice(0, 20))} /></div>,
          people.length ? () => edit(setPeople)([]) : null,
        )}
        {row(
          "tags",
          "Tags",
          <div className="min-w-0 flex-1 whitespace-nowrap"><TagPicker value={tags} canEdit onChange={(next) => edit(setTags)(next.slice(0, 20))} /></div>,
          tags.length ? () => edit(setTags)([]) : null,
        )}
        {defaultable.map((f) =>
          row(
            `field:${f.key}`,
            f.label,
            <FieldValue
              field={f}
              value={values[f.key]}
              mode="edit"
              boardId={boardId}
              popover="absolute"
              onChange={(next) => { setValues((prev) => ({ ...prev, [f.key]: next })); setDirty(true); setSaved(false); }}
            />,
            values[f.key] !== undefined && values[f.key] !== null && values[f.key] !== "" ? () => { setValues((prev) => { const n = { ...prev }; delete n[f.key]; return n; }); setDirty(true); } : null,
          ),
        )}
      </div>

      {issues.general ? (
        <div className="flex items-start gap-2 rounded-md bg-danger-bg px-3 py-2" role="alert">
          <span className="min-w-0 flex-1 text-sm text-danger-text">{issues.general}</span>
          <button type="button" onClick={() => void save()} disabled={busy} className="shrink-0 text-sm font-medium text-danger-text underline-offset-2 hover:underline disabled:opacity-50">Retry</button>
        </div>
      ) : null}
      {saved ? <p className="text-sm text-success-text">Default values saved.</p> : null}

      <div className="flex items-center justify-end gap-2 pt-1">
        <button type="button" onClick={onDone} className="h-8 rounded-md px-3 text-sm text-ink-2 hover:bg-hover">Cancel</button>
        <button
          type="button"
          onClick={() => void save()}
          disabled={busy}
          className="inline-flex h-8 items-center gap-1.5 rounded-md bg-brand px-3 text-sm font-medium text-ink-inv hover:bg-brand-hover disabled:opacity-50"
        >
          {busy ? <Dots variant="pending" /> : null}
          Save
        </button>
      </div>
    </div>
  );
}
