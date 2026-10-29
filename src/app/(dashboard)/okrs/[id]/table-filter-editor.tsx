"use client";

// The target editor's "Which rows" for a table source
// (docs/plans/recurring-goals.md C5, E3): the Tables column filters, one row
// each (a column, then its value control), every one of which must hold, as
// in the grid. The kinds are the grid's own (lib/sheet-filters.ts,
// filterKindFor): a select column picks options (a row matches any chosen
// one), a number or date column takes a range (either end optional), any
// other column a "contains". Link, lookup and rollup columns are not offered
// (C5). The layout is the dashboard filter editor's (widget-filter-editor):
// a bordered row per filter with its remove button ("Remove the Stage
// filter", final review L15), "Add filter" under them, up to 20. That only
// filled rows count is said once, by the row's hint (final review L4).

import { Plus, X } from "lucide-react";
import { PickerButton } from "@/components/dashboards/widget-registry";
import { emptyFilterFor, filterKindFor, isDateFilterType, type SheetColumnFilter } from "@/lib/sheet-filters";
import { MAX_TABLE_FILTERS, offeredColumns, tableColumnName, type TableColumn } from "@/lib/goals/table-source";

// Placeholders are visible text: ink-2 (final review L22).
const input = "h-8 min-w-0 flex-1 rounded-md border border-line-strong bg-raised px-2 text-sm text-ink placeholder:text-ink-2";

/** A new filter on the first column that may be filtered, or null when the table has none. */
export function newTableFilter(columns: readonly TableColumn[], taken: readonly SheetColumnFilter[]): SheetColumnFilter | null {
  const free = offeredColumns(columns).filters.find((c) => !taken.some((f) => f.colId === c.id));
  return free ? emptyFilterFor(free.id, free.type) : null;
}

export function TableFilterEditor({ columns, filters, onChange }: {
  columns: readonly TableColumn[];
  filters: SheetColumnFilter[];
  onChange: (next: SheetColumnFilter[]) => void;
}) {
  const usable = offeredColumns(columns).filters;
  const byId = new Map(columns.map((c) => [c.id, c]));
  const set = (i: number, next: SheetColumnFilter) => onChange(filters.map((f, j) => (j === i ? next : f)));
  const remove = (i: number) => onChange(filters.filter((_, j) => j !== i));
  const add = () => {
    if (filters.length >= MAX_TABLE_FILTERS) return;
    const f = newTableFilter(columns, filters);
    if (f) onChange([...filters, f]);
  };

  const valueControl = (f: SheetColumnFilter, i: number) => {
    const col = byId.get(f.colId);
    const name = tableColumnName(columns, f.colId);
    if (f.kind === "value") {
      const options = col?.options ?? [];
      const label = f.values.length === 0 ? "Pick values" : f.values.length === 1 ? f.values[0] : `${f.values.length} values`;
      return (
        <PickerButton
          ariaLabel={`${label}, ${name}`}
          label={label}
          multi
          selected={f.values}
          emptyLabel="This column has no options yet"
          sections={[{ options: options.map((o) => ({ value: o, label: o })) }]}
          onSelect={(v) => set(i, { ...f, values: f.values.includes(v) ? f.values.filter((x) => x !== v) : [...f.values, v] })}
          width={220}
        />
      );
    }
    if (f.kind === "range") {
      const date = isDateFilterType(col?.type);
      return (
        <span className="flex min-w-0 flex-1 items-center gap-1.5">
          <input
            type={date ? "date" : "text"}
            inputMode={date ? undefined : "decimal"}
            value={f.min ?? ""}
            maxLength={40}
            onChange={(e) => set(i, { ...f, min: e.target.value || undefined })}
            placeholder="From"
            aria-label={`${name} from`}
            className={`${input} tabular-nums`}
          />
          <span className="text-sm text-ink-2">to</span>
          <input
            type={date ? "date" : "text"}
            inputMode={date ? undefined : "decimal"}
            value={f.max ?? ""}
            maxLength={40}
            onChange={(e) => set(i, { ...f, max: e.target.value || undefined })}
            placeholder="To"
            aria-label={`${name} to`}
            className={`${input} tabular-nums`}
          />
        </span>
      );
    }
    return (
      <input
        value={f.value}
        maxLength={200}
        onChange={(e) => set(i, { ...f, value: e.target.value })}
        placeholder="Contains"
        aria-label={`${name} contains`}
        className={input}
      />
    );
  };

  return (
    <div className="flex flex-col gap-2">
      {filters.map((f, i) => (
        <div key={f.colId} className="flex flex-col gap-1.5 rounded-md border border-line p-2">
          <div className="flex items-center gap-1.5">
            <PickerButton
              ariaLabel={`${tableColumnName(columns, f.colId)}, Column`}
              label={tableColumnName(columns, f.colId)}
              value={f.colId}
              searchPlaceholder="Search columns"
              sections={[{
                options: usable
                  .filter((c) => c.id === f.colId || !filters.some((x) => x.colId === c.id))
                  .map((c) => ({ value: c.id, label: tableColumnName(columns, c.id) })),
              }]}
              onSelect={(colId) => {
                if (colId === f.colId) return;
                set(i, emptyFilterFor(colId, byId.get(colId)?.type));
              }}
              width={220}
            />
            <span className="min-w-0 truncate text-xs text-ink-2">
              {filterKindFor(byId.get(f.colId)?.type) === "value" ? "is any of" : filterKindFor(byId.get(f.colId)?.type) === "range" ? "between" : "contains"}
            </span>
            <span className="flex-1" />
            <button
              type="button"
              onClick={() => remove(i)}
              aria-label={`Remove the ${tableColumnName(columns, f.colId)} filter`}
              className="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-ink-2 hover:bg-hover hover:text-ink"
            >
              <X className="h-3.5 w-3.5" strokeWidth={1.5} aria-hidden />
            </button>
          </div>
          <div className="flex items-center">{valueControl(f, i)}</div>
        </div>
      ))}
      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={add}
          disabled={filters.length >= MAX_TABLE_FILTERS || !newTableFilter(columns, filters)}
          className="inline-flex h-7 items-center gap-1 rounded-md px-2 text-sm font-medium text-ink-2 hover:bg-hover hover:text-ink disabled:text-ink-4"
        >
          <Plus className="h-3.5 w-3.5" strokeWidth={1.5} aria-hidden />
          Add filter
        </button>
      </div>
      {filters.length >= MAX_TABLE_FILTERS ? <p className="m-0 text-xs text-ink-2">A target can have up to 20 filters.</p> : null}
    </div>
  );
}
