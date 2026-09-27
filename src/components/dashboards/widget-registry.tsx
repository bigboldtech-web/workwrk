"use client";

// The widget registry: for each card kind, its glyph, its body (how a card
// draws its data) and its settings rows (what the Add widget editor offers
// for it). The kinds, their labels, sizes and surfaces are the pure
// src/lib/dashboards/widget-kinds.ts; this is their React half.
//
// Extending it: Phase 6's people widgets (workload by person, headcount)
// add a row to WIDGET_KIND_META, an entry here, and their server shape.
// Nothing else in the canvas, the grid or the editor needs to change.

import { useEffect, useRef, useState, type ReactNode } from "react";
import { BarChart3, ChevronDown, Hash, ListChecks, Type, type LucideIcon } from "lucide-react";
import { Picker, type PickerOption, type PickerSectionDef } from "@/components/ui/picker";
import { SegmentedControl } from "@/components/ui/segmented-control";
import type { WidgetResult } from "@/lib/dashboards/widget-data";
import type { WidgetKind } from "@/lib/dashboards/widget-kinds";
import { MAX_LIST_ROWS, type WidgetInput } from "@/lib/dashboards/widgets";
import type { FieldDef } from "@/lib/field-catalog";
import { cn } from "@/lib/utils";
import { StatBody } from "./widgets/stat-widget";
import { ChartBody } from "./widgets/chart-widget";
import { ListBody } from "./widgets/list-widget";
import { NotesBody } from "./widgets/notes-widget";

// ── Small shared controls for the editor's settings column ───────────

/**
 * One settings row: a 36px line with its label and its control. `stacked`
 * puts a wide control (a three or four part segmented control) on its own
 * line under the label, where the ~300px column has room for it.
 */
export function SettingsRow({ label, children, hint, stacked }: { label: string; children: ReactNode; hint?: ReactNode; stacked?: boolean }) {
  if (stacked) {
    return (
      <div className="flex flex-col gap-1.5">
        <span className="flex min-h-6 items-center text-sm text-ink-2">{label}</span>
        <div className="flex min-w-0 flex-wrap items-center gap-2">{children}</div>
        {hint ? <div className="text-xs text-ink-2">{hint}</div> : null}
      </div>
    );
  }
  return (
    <div className="flex flex-col gap-1">
      <div className="flex min-h-9 items-center gap-3">
        <span className="w-[84px] shrink-0 text-sm text-ink-2">{label}</span>
        <div className="flex min-w-0 flex-1 items-center">{children}</div>
      </div>
      {hint ? <div className="ps-[96px] text-xs text-ink-2">{hint}</div> : null}
    </div>
  );
}

/**
 * A button that opens a Picker under it. The Picker is an absolutely
 * positioned DOM child (never portalled), which is what keeps it working
 * inside ui/dialog, whose transform would break a fixed popover.
 */
export function PickerButton({
  label,
  value,
  sections,
  onSelect,
  multi,
  selected,
  width = 260,
  disabled,
  searchPlaceholder,
  onSearchChange,
  alwaysSearch,
  loading,
  emptyLabel,
  ariaLabel,
  keepOpen,
  className,
}: {
  label: ReactNode;
  value?: string | null;
  sections: PickerSectionDef[];
  onSelect: (value: string) => void;
  multi?: boolean;
  selected?: string | string[] | null;
  width?: number;
  disabled?: boolean;
  searchPlaceholder?: string;
  onSearchChange?: (q: string) => void;
  alwaysSearch?: boolean;
  loading?: boolean;
  emptyLabel?: string;
  ariaLabel: string;
  keepOpen?: boolean;
  className?: string;
}) {
  const [open, setOpen] = useState(false);
  return (
    <span className={cn("relative inline-flex min-w-0 max-w-full", className)}>
      <button
        type="button"
        disabled={disabled}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-label={ariaLabel}
        onClick={() => setOpen((o) => !o)}
        className="inline-flex h-8 min-w-0 max-w-full items-center gap-1.5 rounded-md border border-line-strong bg-raised px-2.5 text-sm text-ink hover:bg-hover disabled:cursor-not-allowed disabled:text-ink-3"
      >
        <span className="min-w-0 truncate">{label}</span>
        <ChevronDown className="h-3.5 w-3.5 shrink-0 text-ink-2" strokeWidth={1.5} aria-hidden />
      </button>
      <Picker
        open={open}
        onClose={() => {
          setOpen(false);
          onSearchChange?.("");
        }}
        sections={sections}
        selected={selected ?? value ?? null}
        multi={multi}
        onSelect={(v) => {
          onSelect(v);
          if (!multi && !keepOpen) setOpen(false);
        }}
        width={width}
        searchPlaceholder={searchPlaceholder}
        onSearchChange={onSearchChange}
        alwaysSearch={alwaysSearch}
        loading={loading}
        emptyLabel={emptyLabel}
        ariaLabel={ariaLabel}
      />
    </span>
  );
}

// ── Settings rows per kind ───────────────────────────────────────────

export interface SettingsFieldsProps<K extends WidgetInput["kind"]> {
  input: Extract<WidgetInput, { kind: K }>;
  onChange: (next: Extract<WidgetInput, { kind: K }>) => void;
  /** The fields of the chosen Lists (Choose Lists only), deduped by key. */
  fields: FieldDef[];
  sourceKind: "all" | "space" | "lists";
}

const NUMBER_TYPES: ReadonlySet<string> = new Set(["NUMBER", "MONEY", "PERCENT"]);
const CHOICE_TYPES: ReadonlySet<string> = new Set(["DROPDOWN", "CUSTOM_DROPDOWN", "MULTI_SELECT", "LABELS", "TSHIRT_SIZE"]);

export function numberFields(fields: readonly FieldDef[]): FieldDef[] {
  return fields.filter((f) => NUMBER_TYPES.has(String(f.type)));
}
export function choiceFields(fields: readonly FieldDef[]): FieldDef[] {
  return fields.filter((f) => CHOICE_TYPES.has(String(f.type)));
}

function StatSettings({ input, onChange, fields, sourceKind }: SettingsFieldsProps<"stat">) {
  const numbers = numberFields(fields);
  const metric = input.metric ?? { op: "count" as const };
  const canSum = sourceKind === "lists" && numbers.length > 0;
  const sumField = metric.op === "sum" ? numbers.find((f) => f.key === metric.fieldKey) : undefined;
  return (
    <>
      <SettingsRow
        label="Metric"
        hint={sourceKind !== "lists" ? "Sum a number field by choosing Lists as the data source." : canSum ? undefined : metric.op === "sum" ? null : "None of the chosen Lists has a number field."}
      >
        <PickerButton
          ariaLabel="Metric"
          label={metric.op === "sum" ? `Sum of ${sumField?.label ?? "a number field"}` : "Count of tasks"}
          value={metric.op === "sum" ? `sum:${metric.fieldKey}` : "count"}
          sections={[
            { options: [{ value: "count", label: "Count of tasks" }] },
            ...(canSum ? [{ label: "Sum of", options: numbers.map((f) => ({ value: `sum:${f.key}`, label: f.label })) }] : []),
          ]}
          onSelect={(v) => onChange({ ...input, metric: v === "count" ? { op: "count" } : { op: "sum", fieldKey: v.slice(4) } })}
        />
      </SettingsRow>
      <SettingsRow label="Scope" stacked>
        <SegmentedControl
          size="sm"
          label="Scope"
          value={input.scope ?? "total"}
          onChange={(v) => onChange({ ...input, scope: v })}
          options={[
            { value: "total", label: "Total" },
            { value: "open", label: "Open" },
            { value: "completed", label: "Completed" },
            { value: "overdue", label: "Overdue" },
          ]}
        />
      </SettingsRow>
    </>
  );
}

function ChartSettings({ input, onChange, fields, sourceKind }: SettingsFieldsProps<"chart">) {
  const choices = sourceKind === "lists" ? choiceFields(fields) : [];
  const groupValue = typeof input.groupBy === "object" ? `field:${input.groupBy.field}` : input.groupBy;
  const fieldLabel = typeof input.groupBy === "object" ? fields.find((f) => f.key === (input.groupBy as { field: string }).field)?.label ?? "A field" : null;
  const LABELS: Record<string, string> = { status: "Status", assignee: "Assignee", priority: "Priority" };
  return (
    <>
      <SettingsRow label="Group by" hint={sourceKind !== "lists" ? "Group by a field by choosing Lists as the data source." : undefined}>
        <PickerButton
          ariaLabel="Group by"
          label={fieldLabel ?? LABELS[groupValue] ?? "Status"}
          value={groupValue}
          sections={[
            { options: ["status", "assignee", "priority"].map((k) => ({ value: k, label: LABELS[k] })) },
            ...(choices.length ? [{ label: "Fields", options: choices.map((f) => ({ value: `field:${f.key}`, label: f.label })) }] : []),
          ]}
          onSelect={(v) =>
            onChange({ ...input, groupBy: v.startsWith("field:") ? { field: v.slice(6) } : (v as "status" | "assignee" | "priority") })
          }
        />
      </SettingsRow>
      <SettingsRow label="Display" stacked>
        <SegmentedControl
          size="sm"
          label="Display"
          value={input.display ?? "bar"}
          onChange={(v) => onChange({ ...input, display: v })}
          options={[
            { value: "bar", label: "Bar" },
            { value: "donut", label: "Donut" },
          ]}
        />
      </SettingsRow>
    </>
  );
}

const SORT_LABEL: Record<string, string> = {
  updated: "Recently updated",
  due: "Due date",
  created: "Created",
  priority: "Priority",
  title: "Title",
};

function ListSettings({ input, onChange }: SettingsFieldsProps<"list">) {
  const sort = input.sort ?? "updated";
  const limit = input.limit ?? 10;
  const ROWS = [5, 10, 20, 50].filter((n) => n <= MAX_LIST_ROWS);
  return (
    <>
      <SettingsRow label="Sort">
        <PickerButton
          ariaLabel="Sort"
          label={SORT_LABEL[sort]}
          value={sort}
          sections={[{ options: (["updated", "due", "created", "priority", "title"] as const).map((k) => ({ value: k, label: SORT_LABEL[k] })) }]}
          onSelect={(v) => onChange({ ...input, sort: v as typeof sort })}
        />
      </SettingsRow>
      <SettingsRow label="Rows" stacked>
        <SegmentedControl
          size="sm"
          label="Rows"
          value={String(ROWS.includes(limit) ? limit : 10) as "5" | "10" | "20" | "50"}
          onChange={(v) => onChange({ ...input, limit: Number(v) })}
          options={ROWS.map((n) => ({ value: String(n) as "5" | "10" | "20" | "50", label: String(n) }))}
        />
      </SettingsRow>
    </>
  );
}

function NotesSettings({ input, onChange }: SettingsFieldsProps<"notes">) {
  const ref = useRef<HTMLTextAreaElement>(null);
  useEffect(() => {
    ref.current?.focus();
  }, []);
  return (
    <div className="flex flex-col gap-1">
      <span className="text-sm text-ink-2">Text</span>
      <textarea
        ref={ref}
        value={input.text}
        maxLength={20000}
        rows={8}
        onChange={(e) => onChange({ ...input, text: e.target.value.slice(0, 20000) })}
        placeholder="Write a heading or a note"
        className="w-full resize-y rounded-md border border-line-strong bg-raised px-2.5 py-2 text-base text-ink outline-none placeholder:text-ink-3 focus:border-[var(--os-focus)]"
      />
      <span className="self-end text-xs text-ink-3">{input.text.length.toLocaleString()} / 20,000</span>
    </div>
  );
}

// ── The registry ─────────────────────────────────────────────────────

export interface BodyProps {
  widgetId: string;
  result: WidgetResult;
  canEdit: boolean;
  /** Text cards only: the current text and its writer. */
  text?: string;
  onTextChange?: (text: string) => void;
}

export interface WidgetKindEntry {
  icon: LucideIcon;
  Body: (p: BodyProps) => ReactNode;
  SettingsFields: (p: { input: WidgetInput; onChange: (next: WidgetInput) => void; fields: FieldDef[]; sourceKind: "all" | "space" | "lists" }) => ReactNode;
}

export const WIDGET_REGISTRY: Record<WidgetKind, WidgetKindEntry> = {
  stat: {
    icon: Hash,
    Body: ({ result }) => (result.kind === "stat" ? <StatBody result={result} /> : null),
    SettingsFields: ({ input, onChange, fields, sourceKind }) =>
      input.kind === "stat" ? <StatSettings input={input} onChange={onChange} fields={fields} sourceKind={sourceKind} /> : null,
  },
  chart: {
    icon: BarChart3,
    Body: ({ result }) => (result.kind === "chart" ? <ChartBody result={result} /> : null),
    SettingsFields: ({ input, onChange, fields, sourceKind }) =>
      input.kind === "chart" ? <ChartSettings input={input} onChange={onChange} fields={fields} sourceKind={sourceKind} /> : null,
  },
  list: {
    icon: ListChecks,
    Body: ({ result }) => (result.kind === "list" ? <ListBody result={result} /> : null),
    SettingsFields: ({ input, onChange, fields, sourceKind }) =>
      input.kind === "list" ? <ListSettings input={input} onChange={onChange} fields={fields} sourceKind={sourceKind} /> : null,
  },
  notes: {
    icon: Type,
    Body: ({ canEdit, text, onTextChange }) => <NotesBody text={text ?? ""} canEdit={canEdit} onChange={(t) => onTextChange?.(t)} />,
    SettingsFields: ({ input, onChange, fields, sourceKind }) =>
      input.kind === "notes" ? <NotesSettings input={input} onChange={onChange} fields={fields} sourceKind={sourceKind} /> : null,
  },
};

export function registryFor(kind: string): WidgetKindEntry | null {
  return (WIDGET_REGISTRY as Record<string, WidgetKindEntry | undefined>)[kind] ?? null;
}

export type { PickerOption };
