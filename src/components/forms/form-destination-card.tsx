"use client";

// The builder's "Goes to" card and the field mapping card (spec-tables-forms
// section 2 /forms/[id], Build tab items 4 and 5).
//
// Goes to: one Picker with two groups, Lists (GET /api/lists/pick, the
// canonical Board and Item model; the legacy /api/studio/boards calls that
// were always empty are gone) and Tables (GET /api/tables, absent when the
// spreadsheets module is off), plus "Nowhere yet". A form has always been
// able to feed ONE List and ONE table at once (both get a row), and that
// capability is kept: choosing a List replaces the List, choosing a table
// replaces the table, and each can be removed on its own. Under the trigger,
// one line names who the destination brings in.
//
// Mapping: rendered only when a destination is set. One row per question:
// "Form field" on the left, a column Picker per destination on the right,
// defaulting to "(match by name)", with "Don't send" to keep an answer on the
// Responses tab only. Table columns show their NAME, or their letter on a
// sheet-born table, never a blank option.

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ChevronDown, LayoutGrid, ListChecks, Table2, X } from "lucide-react";
import { Picker, type PickerSectionDef } from "@/components/ui/picker";
import { apiFetch } from "@/lib/api-fetch";
import {
  audienceLine, columnDisplayName, type ListFieldRef, type TableColumnRef,
} from "@/lib/forms/builder";
import { isQuestion, type FormField } from "@/lib/forms/fields";
import { cn } from "@/lib/utils";

/** href null: one the viewer cannot open ("A private List", no link). */
export interface Destination { kind: "list" | "table"; id: string; name: string; href: string | null }
export interface FieldMappings { board?: Record<string, string>; table?: Record<string, string> }

type ListPick = { id: string; slug: string; name: string; spaceName?: string | null; folderName?: string | null };
type TablePick = { id: string; name: string };

/** "Don't send" in a mapping row: an explicit id no column has. */
export const DONT_SEND = "-";

/** The List's fields and the table's columns, for the mapping and for
 *  "Fields on {destination}" in the Add-a-field Picker. */
export function useDestinationColumns(targetBoardId: string | null, targetTableId: string | null) {
  const [listFields, setListFields] = useState<ListFieldRef[]>([]);
  const [tableColumns, setTableColumns] = useState<TableColumnRef[]>([]);
  useEffect(() => {
    let alive = true;
    if (!targetBoardId) { const t = setTimeout(() => { if (alive) setListFields([]); }, 0); return () => { alive = false; clearTimeout(t); }; }
    void apiFetch<{ fields?: Array<{ key: string; label: string; type: string; options?: { choices?: Array<{ label: string }> } }> }>(`/api/boards/${targetBoardId}/fields`, { cache: "no-store" }).then((r) => {
      if (!alive) return;
      setListFields(r.ok ? (r.data.fields ?? []).map((f) => ({ key: f.key, label: f.label, type: f.type, choices: f.options?.choices?.map((c) => c.label) })) : []);
    });
    return () => { alive = false; };
  }, [targetBoardId]);
  useEffect(() => {
    let alive = true;
    if (!targetTableId) { const t = setTimeout(() => { if (alive) setTableColumns([]); }, 0); return () => { alive = false; clearTimeout(t); }; }
    void apiFetch<{ columns?: Array<{ id: string; label?: string; type?: string; options?: string[] }> }>(`/api/tables/${targetTableId}`, { cache: "no-store" }).then((r) => {
      if (!alive) return;
      const cols = r.ok && Array.isArray(r.data.columns) ? r.data.columns : [];
      setTableColumns(cols.map((c, i) => ({ id: c.id, label: columnDisplayName(c.label, i), type: c.type ?? "short_text", options: Array.isArray(c.options) ? c.options : undefined })));
    });
    return () => { alive = false; };
  }, [targetTableId]);
  return { listFields, tableColumns };
}

export function GoesToCard({
  listDest, tableDest, readOnly, tablesOn, onChange,
}: {
  listDest: Destination | null;
  tableDest: Destination | null;
  readOnly: boolean;
  tablesOn: boolean;
  /** One of the two changed; the page confirms when mappings would be cleared. */
  onChange: (next: { list?: Destination | null; table?: Destination | null }) => void;
}) {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const [lists, setLists] = useState<ListPick[] | null>(null);
  const [tables, setTables] = useState<TablePick[] | null>(null);

  const loadLists = useCallback(async (query: string) => {
    const params = new URLSearchParams({ limit: "40" });
    if (query.trim()) params.set("q", query.trim());
    const r = await apiFetch<{ data?: ListPick[] }>(`/api/lists/pick?${params}`, { cache: "no-store" });
    setLists(r.ok ? r.data.data ?? [] : []);
  }, []);
  useEffect(() => {
    if (!open) return;
    const t = setTimeout(() => { void loadLists(q); }, q ? 200 : 0);
    return () => clearTimeout(t);
  }, [open, q, loadLists]);
  useEffect(() => {
    if (!open || !tablesOn || tables !== null) return;
    let alive = true;
    void apiFetch<TablePick[]>("/api/tables", { cache: "no-store" }).then((r) => {
      if (alive) setTables(r.ok && Array.isArray(r.data) ? r.data.map((t) => ({ id: t.id, name: t.name })) : []);
    });
    return () => { alive = false; };
  }, [open, tablesOn, tables]);

  const sections = useMemo((): PickerSectionDef[] => {
    const needle = q.trim().toLowerCase();
    const out: PickerSectionDef[] = [
      { options: [{ value: "none", label: "Nowhere yet", description: "Answers stay on the Responses tab" }] },
      {
        label: "Lists",
        options: (lists ?? []).map((l) => ({
          value: `list:${l.id}`,
          label: l.name,
          description: [l.spaceName, l.folderName].filter(Boolean).join(" › ") || undefined,
          glyph: <ListChecks className="h-4 w-4" strokeWidth={1.5} />,
        })),
      },
    ];
    if (tablesOn) {
      out.push({
        label: "Tables",
        options: (tables ?? []).filter((t) => !needle || t.name.toLowerCase().includes(needle)).map((t) => ({
          value: `table:${t.id}`,
          label: t.name || "Untitled table",
          glyph: <Table2 className="h-4 w-4" strokeWidth={1.5} />,
        })),
      });
    }
    return out;
  }, [lists, tables, tablesOn, q]);

  const selected = [listDest ? `list:${listDest.id}` : null, tableDest ? `table:${tableDest.id}` : null].filter((x): x is string => !!x);
  const pick = (value: string) => {
    if (value === "none") { onChange({ list: null, table: null }); setOpen(false); return; }
    const [kind, id] = value.split(":");
    if (kind === "list") {
      const l = lists?.find((x) => x.id === id);
      if (!l) return;
      onChange({ list: listDest?.id === id ? null : { kind: "list", id, name: l.name, href: `/boards/${l.slug}` } });
    } else {
      const t = tables?.find((x) => x.id === id);
      if (!t) return;
      onChange({ table: tableDest?.id === id ? null : { kind: "table", id, name: t.name, href: `/tables/${t.id}` } });
    }
    setOpen(false);
  };

  const dests = [listDest, tableDest].filter((d): d is Destination => !!d);
  return (
    <section className="rounded-lg border border-line bg-raised p-5" aria-labelledby="goes-to-h">
      <h2 id="goes-to-h" className="m-0 text-base font-semibold text-ink">Goes to</h2>
      <p className="m-0 mt-1 text-sm text-ink-2">Every response also becomes a task on the List, or a row in the table, or both.</p>
      <div className="relative mt-3 flex flex-wrap items-center gap-2">
        {dests.map((d) => (
          <span key={d.kind} className="inline-flex h-9 items-center gap-2 rounded-md border border-line-strong px-3 text-base text-ink">
            {d.kind === "list" ? <LayoutGrid className="h-4 w-4 text-ink-2" strokeWidth={1.5} aria-hidden /> : <Table2 className="h-4 w-4 text-ink-2" strokeWidth={1.5} aria-hidden />}
            {d.href ? (
              <a href={d.href} className="hover:underline">{d.name || (d.kind === "list" ? "Untitled List" : "Untitled table")}</a>
            ) : (
              <span className="text-ink-2">{d.name}</span>
            )}
            {!readOnly ? (
              <button type="button" onClick={() => onChange(d.kind === "list" ? { list: null } : { table: null })} aria-label={`Stop sending to ${d.name}`} className="text-ink-3 hover:text-ink">
                <X className="h-4 w-4" aria-hidden />
              </button>
            ) : null}
          </span>
        ))}
        {!readOnly ? (
          <span className="relative">
            <button
              type="button"
              onClick={() => setOpen((o) => !o)}
              aria-haspopup="listbox"
              aria-expanded={open}
              className="inline-flex h-9 items-center gap-1.5 rounded-md border border-line-strong px-3 text-base font-medium text-ink hover:bg-hover"
            >
              {dests.length ? "Change" : "Choose where answers go"}
              <ChevronDown className="h-4 w-4 text-ink-2" aria-hidden />
            </button>
            <Picker
              open={open}
              onClose={() => setOpen(false)}
              sections={sections}
              selected={selected}
              multi
              onSelect={pick}
              alwaysSearch
              onSearchChange={setQ}
              searchPlaceholder="Search Lists and tables"
              loading={lists === null || (tablesOn && tables === null)}
              ariaLabel="Where answers go"
              width={320}
            />
          </span>
        ) : dests.length === 0 ? <span className="text-base text-ink-2">Nowhere yet</span> : null}
      </div>
      <p className="m-0 mt-2 text-sm text-ink-2">{audienceLine(listDest ?? tableDest ?? null)}</p>
    </section>
  );
}

export function MappingCard({
  fields, listDest, tableDest, listFields, tableColumns, mappings, readOnly, onChange,
}: {
  fields: FormField[];
  listDest: Destination | null;
  tableDest: Destination | null;
  listFields: ListFieldRef[];
  tableColumns: TableColumnRef[];
  mappings: FieldMappings;
  readOnly: boolean;
  onChange: (next: FieldMappings) => void;
}) {
  const questions = fields.filter(isQuestion);
  if (!listDest && !tableDest) return null;
  if (questions.length === 0) return null;
  const cols = [listDest ? "board" as const : null, tableDest ? "table" as const : null].filter((x): x is "board" | "table" => !!x);
  return (
    <section className="rounded-lg border border-line bg-raised p-5" aria-labelledby="mapping-h">
      <h2 id="mapping-h" className="m-0 text-base font-semibold text-ink">Field mapping</h2>
      <div className="mt-3 grid items-center gap-x-3 gap-y-2" style={{ gridTemplateColumns: `minmax(160px,1fr) ${cols.map(() => "minmax(180px,1fr)").join(" ")}` }}>
        <span className="text-sm font-medium text-ink-2">Form field</span>
        {cols.map((c) => (
          <span key={c} className="truncate text-sm font-medium text-ink-2">{c === "board" ? `${listDest?.name || "List"} field` : `${tableDest?.name || "Table"} column`}</span>
        ))}
        {questions.map((f) => (
          <MappingRow
            key={f.id}
            field={f}
            cols={cols}
            listFields={listFields}
            tableColumns={tableColumns}
            mappings={mappings}
            readOnly={readOnly}
            onChange={onChange}
          />
        ))}
      </div>
      <p className="m-0 mt-3 text-sm text-ink-2">Answers to unmapped fields are still saved and shown on the Responses tab.</p>
    </section>
  );
}

function MappingRow({ field, cols, listFields, tableColumns, mappings, readOnly, onChange }: {
  field: FormField;
  cols: Array<"board" | "table">;
  listFields: ListFieldRef[];
  tableColumns: TableColumnRef[];
  mappings: FieldMappings;
  readOnly: boolean;
  onChange: (next: FieldMappings) => void;
}) {
  return (
    <>
      <span className="truncate text-base text-ink">{field.label || "Untitled question"}</span>
      {cols.map((c) => (
        <MappingPicker
          key={c}
          value={mappings[c]?.[field.id] ?? ""}
          options={c === "board" ? listFields.map((f) => ({ id: f.key, label: f.label })) : tableColumns.map((t) => ({ id: t.id, label: t.label }))}
          readOnly={readOnly}
          label={`Where ${field.label || "this answer"} goes`}
          onPick={(v) => {
            const cur = { ...(mappings[c] ?? {}) };
            if (v) cur[field.id] = v; else delete cur[field.id];
            onChange({ ...mappings, [c]: cur });
          }}
        />
      ))}
    </>
  );
}

function MappingPicker({ value, options, readOnly, label, onPick }: {
  value: string;
  options: Array<{ id: string; label: string }>;
  readOnly: boolean;
  label: string;
  onPick: (v: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLSpanElement>(null);
  const current = value === DONT_SEND ? "Don't send" : value ? options.find((o) => o.id === value)?.label ?? "A column that is gone" : "(match by name)";
  const muted = !value || value === DONT_SEND;
  if (readOnly) return <span className={cn("truncate text-base", muted ? "text-ink-2" : "text-ink")}>{value === DONT_SEND ? "Not sent" : current}</span>;
  return (
    <span ref={ref} className="relative min-w-0">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-label={label}
        aria-haspopup="listbox"
        aria-expanded={open}
        className={cn("inline-flex h-9 w-full min-w-0 items-center justify-between gap-2 rounded-md border border-line-strong px-3 text-base hover:bg-hover", muted ? "text-ink-2" : "text-ink")}
      >
        <span className="truncate">{current}</span>
        <ChevronDown className="h-4 w-4 shrink-0 text-ink-2" aria-hidden />
      </button>
      <Picker
        open={open}
        onClose={() => setOpen(false)}
        sections={[
          { options: [{ value: "", label: "(match by name)" }, { value: DONT_SEND, label: "Don't send" }] },
          { label: "Columns", options: options.map((o) => ({ value: o.id, label: o.label })) },
        ]}
        selected={value}
        onSelect={(v) => { onPick(v); setOpen(false); }}
        ariaLabel={label}
        emptyLabel="No columns"
      />
    </span>
  );
}
