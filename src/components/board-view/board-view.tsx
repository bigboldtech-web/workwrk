"use client";

// Reusable BoardView — Phase C2. Drop into any board-like page and get
// Table / Kanban / Calendar / Gallery views with a switcher tab bar.
//
// Each consuming page passes:
//   - items: any[] (whatever shape)
//   - fields: BoardField[] describing the columns
//   - boardKey: string (used for localStorage view-pref + as a cache key)
//   - getId / getTitle (functions for row identity + title display)
//   - onRowClick? (optional row-click handler)
//   - extraToolbar? (optional React node — "+ New" button slot)
//
// View choice persists per-board in localStorage.
//
// Kanban: groups by the first SELECT field. Click "Move to X" from the
// row menu to change the group (consumer handles via onChangeField).
// Calendar: groups by the first DATE field, week-view-ish list.
// Gallery: card grid for visual scanning.

import { useEffect, useMemo, useState, useCallback } from "react";
import {
  LayoutGrid,
  List,
  CalendarDays,
  LayoutPanelLeft,
  MoreVertical,
  ChevronDown,
  Clock,
} from "lucide-react";

export type BoardFieldType =
  | "TEXT" | "TEXTAREA" | "NUMBER" | "DATE" | "CHECKBOX"
  | "SELECT" | "MULTI_SELECT" | "URL" | "EMAIL";

export interface BoardField {
  key: string;
  label: string;
  fieldType: BoardFieldType;
  options?: { choices?: { value: string; label?: string; color?: string }[] };
}

export type BoardViewType = "table" | "kanban" | "calendar" | "gallery";

interface Props<T> {
  boardKey: string;
  items: T[];
  fields: BoardField[];
  getId: (item: T) => string;
  getTitle: (item: T) => string;
  getValue: (item: T, fieldKey: string) => unknown;
  /** Called when a row's value is changed inline (Kanban drag-to-stage style). */
  onChangeField?: (id: string, fieldKey: string, value: unknown) => void;
  /** Called when a row is clicked (open detail). */
  onRowClick?: (item: T) => void;
  /** Optional toolbar slot rendered to the right of the view switcher. */
  extraToolbar?: React.ReactNode;
  /** Default view if no localStorage pref exists. */
  defaultView?: BoardViewType;
}

const VIEW_OPTIONS: { id: BoardViewType; label: string; Icon: typeof List }[] = [
  { id: "table", label: "Table", Icon: List },
  { id: "kanban", label: "Kanban", Icon: LayoutGrid },
  { id: "calendar", label: "Calendar", Icon: CalendarDays },
  { id: "gallery", label: "Gallery", Icon: LayoutPanelLeft },
];

export function BoardView<T>(props: Props<T>) {
  const storageKey = `boardview:${props.boardKey}`;
  const [view, setView] = useState<BoardViewType>(props.defaultView ?? "table");

  // Hydrate view choice from localStorage post-mount (avoid SSR mismatch).
  const [hydrated, setHydrated] = useState(false);
  useEffect(() => {
    if (typeof window === "undefined") return;
    const stored = window.localStorage.getItem(storageKey);
    if (stored === "table" || stored === "kanban" || stored === "calendar" || stored === "gallery") {
      setView(stored);
    }
    setHydrated(true);
  }, [storageKey]);

  const persistView = useCallback((v: BoardViewType) => {
    setView(v);
    if (typeof window !== "undefined") window.localStorage.setItem(storageKey, v);
  }, [storageKey]);

  // Pick the first SELECT field for Kanban grouping, first DATE for Calendar.
  const kanbanField = useMemo(() => props.fields.find((f) => f.fieldType === "SELECT"), [props.fields]);
  const calendarField = useMemo(() => props.fields.find((f) => f.fieldType === "DATE"), [props.fields]);

  return (
    <div>
      {/* View switcher + extra toolbar */}
      <div className="flex items-center justify-between mb-3 gap-2">
        <div className="inline-flex rounded-lg border border-border bg-surface p-0.5">
          {VIEW_OPTIONS.map(({ id, label, Icon }) => {
            const disabled = (id === "kanban" && !kanbanField) || (id === "calendar" && !calendarField);
            return (
              <button
                key={id}
                type="button"
                onClick={() => persistView(id)}
                disabled={disabled}
                title={disabled ? `${label} view needs a ${id === "kanban" ? "SELECT" : "DATE"} field` : label}
                className={
                  "inline-flex items-center gap-1.5 px-3 py-1 rounded-md text-xs font-medium transition-colors " +
                  (view === id
                    ? "bg-violet-100 dark:bg-violet-950/40 text-violet-700 dark:text-violet-300"
                    : "text-muted hover:text-foreground hover:bg-surface-2 disabled:opacity-30 disabled:hover:bg-transparent disabled:cursor-not-allowed")
                }
              >
                <Icon size={12} /> {label}
              </button>
            );
          })}
        </div>
        {props.extraToolbar}
      </div>

      {/* Force a stable wrapper before hydration so layout doesn't jump */}
      {!hydrated ? (
        <TableView {...props} />
      ) : view === "table" ? (
        <TableView {...props} />
      ) : view === "kanban" && kanbanField ? (
        <KanbanView {...props} groupBy={kanbanField} />
      ) : view === "calendar" && calendarField ? (
        <CalendarView {...props} dateField={calendarField} />
      ) : view === "gallery" ? (
        <GalleryView {...props} />
      ) : (
        <TableView {...props} />
      )}
    </div>
  );
}

// ─────────────────────────────────────────────────────────
// Table view
// ─────────────────────────────────────────────────────────

function TableView<T>({ items, fields, getId, getTitle, getValue, onRowClick }: Props<T>) {
  if (items.length === 0) {
    return <EmptyView label="No rows" />;
  }
  return (
    <div className="rounded-xl border border-border bg-surface overflow-hidden">
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="bg-surface-2 text-xs uppercase tracking-wider text-muted-2">
            <tr>
              {fields.map((f) => (
                <th key={f.key} className="text-left px-4 py-2.5 font-medium">{f.label}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {items.map((item) => (
              <tr
                key={getId(item)}
                onClick={() => onRowClick?.(item)}
                className={"border-t border-border hover:bg-surface-2 " + (onRowClick ? "cursor-pointer" : "")}
              >
                {fields.map((f) => (
                  <td key={f.key} className="px-4 py-2.5 text-sm">
                    <CellValue field={f} value={getValue(item, f.key)} />
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────
// Kanban view
// ─────────────────────────────────────────────────────────

function KanbanView<T>({
  items, fields, getId, getTitle, getValue, onChangeField, onRowClick,
  groupBy,
}: Props<T> & { groupBy: BoardField }) {
  const choices = groupBy.options?.choices ?? [];
  const noneBucket = "__none__";
  const columns = [
    ...choices.map((c) => ({ value: c.value, label: c.label ?? c.value, color: c.color })),
    { value: noneBucket, label: "Unassigned", color: undefined },
  ];

  const byCol = useMemo(() => {
    const m = new Map<string, T[]>();
    for (const col of columns) m.set(col.value, []);
    for (const item of items) {
      const v = getValue(item, groupBy.key);
      const k = typeof v === "string" && v ? v : noneBucket;
      const arr = m.get(k) ?? m.get(noneBucket)!;
      arr.push(item);
    }
    return m;
  }, [items, getValue, groupBy.key, columns]);

  return (
    <div className="flex gap-3 overflow-x-auto pb-2" style={{ minHeight: 420 }}>
      {columns.map((col) => {
        const colItems = byCol.get(col.value) ?? [];
        return (
          <div key={col.value} className="flex-shrink-0 w-[260px] rounded-xl bg-surface-2 p-3">
            <div className="flex items-center justify-between mb-3">
              <div className="flex items-center gap-2">
                <span className="w-2 h-2 rounded-full" style={{ background: col.color ?? "#94a3b8" }} aria-hidden />
                <span className="text-sm font-semibold">{col.label}</span>
              </div>
              <span className="text-xs text-muted-2">{colItems.length}</span>
            </div>
            <div className="space-y-2">
              {colItems.length === 0 ? (
                <div className="text-xs text-muted-2 italic py-3 text-center border border-dashed border-border rounded-lg">Empty</div>
              ) : (
                colItems.map((item) => (
                  <KanbanCard
                    key={getId(item)}
                    item={item}
                    fields={fields}
                    groupBy={groupBy}
                    columns={columns}
                    getId={getId}
                    getTitle={getTitle}
                    getValue={getValue}
                    onMove={onChangeField ? (toValue) => onChangeField(getId(item), groupBy.key, toValue === noneBucket ? null : toValue) : undefined}
                    onClick={onRowClick ? () => onRowClick(item) : undefined}
                  />
                ))
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}

function KanbanCard<T>({
  item, fields, groupBy, columns, getId, getTitle, getValue, onMove, onClick,
}: {
  item: T;
  fields: BoardField[];
  groupBy: BoardField;
  columns: { value: string; label: string }[];
  getId: (item: T) => string;
  getTitle: (item: T) => string;
  getValue: (item: T, fieldKey: string) => unknown;
  onMove?: (toValue: string) => void;
  onClick?: () => void;
}) {
  const [menuOpen, setMenuOpen] = useState(false);
  // Render the title + up to 2 non-grouping non-title fields
  const detailFields = fields.filter((f) => f.key !== groupBy.key).slice(0, 3);
  const currentValue = getValue(item, groupBy.key);

  return (
    <div className="rounded-lg bg-surface border border-border p-3 relative">
      <div className="flex items-start justify-between mb-1.5">
        <div
          className={"font-medium text-sm leading-tight pr-6 " + (onClick ? "cursor-pointer hover:text-violet-600" : "")}
          onClick={onClick}
        >
          {getTitle(item)}
        </div>
        {onMove && (
          <button
            type="button"
            onClick={() => setMenuOpen((v) => !v)}
            className="absolute top-2 right-2 p-1 rounded hover:bg-surface-2 text-muted-2"
            aria-label="Move"
          >
            <MoreVertical size={11} />
          </button>
        )}
        {menuOpen && onMove && (
          <div className="absolute top-7 right-2 z-10 w-40 rounded-lg bg-surface border border-border shadow-lg py-1">
            <div className="px-3 py-1 text-[10px] uppercase tracking-wider text-muted-2">Move to</div>
            {columns.map((c) => (
              <button
                key={c.value}
                type="button"
                onClick={() => { setMenuOpen(false); onMove(c.value); }}
                disabled={c.value === currentValue || (currentValue == null && c.value === "__none__")}
                className="w-full text-left px-3 py-1.5 text-xs hover:bg-surface-2 disabled:opacity-40"
              >
                {c.label}
              </button>
            ))}
          </div>
        )}
      </div>
      {detailFields.length > 0 && (
        <div className="flex flex-wrap gap-2 text-[11px] text-muted-2 mt-1">
          {detailFields.map((f) => {
            const v = getValue(item, f.key);
            if (v == null || v === "") return null;
            return (
              <span key={f.key} className="inline-flex items-center gap-1">
                <span className="text-muted-2 opacity-60">{f.label}:</span>
                <CellValue field={f} value={v} compact />
              </span>
            );
          })}
        </div>
      )}
    </div>
  );
}

// ─────────────────────────────────────────────────────────
// Calendar view (list grouped by week, ordered by date)
// ─────────────────────────────────────────────────────────

function CalendarView<T>({ items, getId, getTitle, getValue, dateField, onRowClick }: Props<T> & { dateField: BoardField }) {
  // Group by year-week. We sort by date asc, group by ISO week label.
  const buckets = useMemo(() => {
    const map = new Map<string, T[]>();
    const dated = items
      .map((item) => {
        const v = getValue(item, dateField.key);
        const d = typeof v === "string" ? new Date(v) : null;
        return { item, date: d && !Number.isNaN(d.getTime()) ? d : null };
      })
      .filter((x) => x.date !== null) as { item: T; date: Date }[];

    dated.sort((a, b) => a.date.getTime() - b.date.getTime());

    for (const { item, date } of dated) {
      const monday = startOfWeek(date);
      const label = monday.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
      const arr = map.get(label) ?? [];
      arr.push(item);
      map.set(label, arr);
    }
    return Array.from(map.entries());
  }, [items, getValue, dateField.key]);

  const undated = items.filter((i) => {
    const v = getValue(i, dateField.key);
    if (!v || typeof v !== "string") return true;
    const d = new Date(v);
    return Number.isNaN(d.getTime());
  });

  if (buckets.length === 0 && undated.length === 0) {
    return <EmptyView label="No rows" />;
  }

  return (
    <div className="rounded-xl border border-border bg-surface divide-y divide-border">
      {buckets.map(([label, rows]) => (
        <div key={label} className="px-4 py-3">
          <div className="text-[11px] uppercase tracking-wider text-muted-2 font-semibold mb-2 inline-flex items-center gap-1.5">
            <Clock size={11} /> Week of {label}
          </div>
          <div className="space-y-1.5">
            {rows.map((item) => (
              <div
                key={getId(item)}
                onClick={() => onRowClick?.(item)}
                className={"rounded-md border border-border bg-surface-2 px-3 py-2 text-sm " + (onRowClick ? "cursor-pointer hover:border-violet-300" : "")}
              >
                <div className="font-medium">{getTitle(item)}</div>
                <div className="text-[11px] text-muted-2 mt-0.5">
                  {(() => {
                    const v = getValue(item, dateField.key);
                    return typeof v === "string" ? new Date(v).toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" }) : "—";
                  })()}
                </div>
              </div>
            ))}
          </div>
        </div>
      ))}
      {undated.length > 0 && (
        <div className="px-4 py-3">
          <div className="text-[11px] uppercase tracking-wider text-muted-2 font-semibold mb-2">No date</div>
          <div className="space-y-1.5">
            {undated.map((item) => (
              <div
                key={getId(item)}
                onClick={() => onRowClick?.(item)}
                className={"rounded-md border border-border bg-surface-2 px-3 py-2 text-sm " + (onRowClick ? "cursor-pointer hover:border-violet-300" : "")}
              >
                <div className="font-medium">{getTitle(item)}</div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function startOfWeek(d: Date) {
  const day = d.getDay();
  const diff = day === 0 ? -6 : 1 - day;       // Monday-anchored
  const monday = new Date(d);
  monday.setDate(d.getDate() + diff);
  monday.setHours(0, 0, 0, 0);
  return monday;
}

// ─────────────────────────────────────────────────────────
// Gallery view (card grid)
// ─────────────────────────────────────────────────────────

function GalleryView<T>({ items, fields, getId, getTitle, getValue, onRowClick }: Props<T>) {
  if (items.length === 0) {
    return <EmptyView label="No rows" />;
  }
  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-3">
      {items.map((item) => {
        const detailFields = fields.slice(0, 4);
        return (
          <article
            key={getId(item)}
            onClick={() => onRowClick?.(item)}
            className={"rounded-xl border border-border bg-surface p-4 transition-colors " + (onRowClick ? "cursor-pointer hover:border-violet-300" : "")}
          >
            <div className="font-semibold text-sm mb-2 line-clamp-2">{getTitle(item)}</div>
            <div className="space-y-1 text-xs">
              {detailFields.map((f) => {
                const v = getValue(item, f.key);
                if (v == null || v === "" || (Array.isArray(v) && v.length === 0)) return null;
                return (
                  <div key={f.key} className="flex items-center gap-2 min-w-0">
                    <span className="text-muted-2 text-[10px] uppercase tracking-wider flex-shrink-0">{f.label}</span>
                    <span className="text-muted truncate">
                      <CellValue field={f} value={v} compact />
                    </span>
                  </div>
                );
              })}
            </div>
          </article>
        );
      })}
    </div>
  );
}

// ─────────────────────────────────────────────────────────
// Shared cell renderer + empty state
// ─────────────────────────────────────────────────────────

function CellValue({ field, value, compact = false }: { field: BoardField; value: unknown; compact?: boolean }) {
  if (value == null || value === "") return <span className="text-muted-2">—</span>;
  switch (field.fieldType) {
    case "CHECKBOX":
      return <span className={value ? "text-emerald-600" : "text-muted-2"}>{value ? "✓" : "—"}</span>;
    case "DATE":
      return <span>{typeof value === "string" ? new Date(value).toLocaleDateString() : String(value)}</span>;
    case "MULTI_SELECT": {
      const arr = Array.isArray(value) ? (value as string[]) : [];
      return (
        <div className="inline-flex flex-wrap gap-1">
          {arr.slice(0, compact ? 2 : 6).map((v) => (
            <span key={v} className="text-[10px] px-1.5 py-0.5 rounded bg-violet-100 dark:bg-violet-950/40 text-violet-700">{v}</span>
          ))}
          {arr.length > (compact ? 2 : 6) && <span className="text-[10px] text-muted-2">+{arr.length - (compact ? 2 : 6)}</span>}
        </div>
      );
    }
    case "SELECT": {
      const label = field.options?.choices?.find((c) => c.value === value)?.label ?? String(value);
      return <span className="text-[10px] px-2 py-0.5 rounded-full bg-zinc-100 dark:bg-zinc-800">{label}</span>;
    }
    case "URL":
      return <a href={String(value)} target="_blank" rel="noopener noreferrer" onClick={(e) => e.stopPropagation()} className="text-xs text-violet-600 hover:underline truncate inline-block max-w-[160px]">{String(value)}</a>;
    case "EMAIL":
      return <a href={`mailto:${String(value)}`} onClick={(e) => e.stopPropagation()} className="text-xs text-violet-600 hover:underline">{String(value)}</a>;
    case "TEXTAREA":
      return <span className="line-clamp-2 text-xs text-muted">{String(value)}</span>;
    default:
      return <span className="truncate inline-block max-w-[280px]">{String(value)}</span>;
  }
}

function EmptyView({ label }: { label: string }) {
  return (
    <div className="rounded-xl border border-dashed border-border bg-surface text-center py-16">
      <ChevronDown size={28} className="mx-auto mb-2 text-muted-2 rotate-180" />
      <p className="text-sm text-muted">{label}</p>
    </div>
  );
}
