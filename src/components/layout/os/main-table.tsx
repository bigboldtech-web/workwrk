"use client";

import { useEffect, useRef, useState } from "react";
import { ChevronDown, MoreHorizontal, MessageCircle, ArrowRight, Plus } from "lucide-react";
import type { Person } from "./title-bar";
import { useOsShell } from "./shell-context";
import { OsPickerPopover, type PickerOption } from "./picker-popover";
import { useOsToast } from "./toast";
import { C } from "./catalog";

export type StatusValue =
  | "done" | "working" | "stuck" | "progress" | "review" | "hold"
  | "planning" | "shipped" | "pending" | "critical" | "empty";

export type PrioValue = "critical" | "high" | "medium" | "low" | "empty";

export type LabelColor = "green" | "orange" | "red" | "blue" | "purple" | "pink" | "indigo" | "teal" | "lime" | "brown" | "yellow" | "gray";

export type Column =
  | { id: string; label: string; type: "text"; width?: number }
  | { id: string; label: string; type: "status"; width?: number }
  | { id: string; label: string; type: "priority"; width?: number }
  | { id: string; label: string; type: "person"; width?: number }
  | { id: string; label: string; type: "date"; width?: number }
  | { id: string; label: string; type: "tags"; width?: number }
  | { id: string; label: string; type: "number"; width?: number; currency?: string }
  | { id: string; label: string; type: "progress"; width?: number }
  | { id: string; label: string; type: "updates"; width?: number };

export type Row = {
  id: string;
  name: string;
  done?: boolean;
  cells: Record<string, unknown>;
};

export type TableGroup = {
  id: string;
  title: string;
  color: string;
  rows: Row[];
};

// ─── Picker options ─────────────────────────────────────────
const DEFAULT_STATUS_OPTIONS: PickerOption[] = [
  { value: "done",     label: "Done",          color: C.green },
  { value: "working",  label: "Working on it", color: C.orange },
  { value: "stuck",    label: "Stuck",         color: C.red },
  { value: "progress", label: "In progress",   color: C.blue },
  { value: "review",   label: "Review",        color: C.purple },
  { value: "planning", label: "Planning",      color: C.indigo },
  { value: "hold",     label: "On hold",       color: C.brown },
  { value: "shipped",  label: "Shipped",       color: C.sage },
  { value: "pending",  label: "Pending",       color: C.yellow },
  { value: "critical", label: "Critical",      color: C.pink },
];

const DEFAULT_PRIO_OPTIONS: PickerOption[] = [
  { value: "critical", label: "Critical", color: C.pink },
  { value: "high",     label: "High",     color: C.red },
  { value: "medium",   label: "Medium",   color: C.yellow },
  { value: "low",      label: "Low",      color: C.teal },
];

const STATUS_LABELS: Record<StatusValue, string> = {
  done: "Done", working: "Working on it", stuck: "Stuck",
  progress: "In progress", review: "Review", hold: "On hold",
  planning: "Planning", shipped: "Shipped", pending: "Pending",
  critical: "Critical", empty: "—",
};

const PRIO_LABELS: Record<PrioValue, string> = {
  critical: "Critical", high: "High", medium: "Medium", low: "Low", empty: "—",
};

// ─── Cell renderers ─────────────────────────────────────────
function CellStatus({
  v, onPick,
}: { v?: { value: StatusValue; label?: string }; onPick: (e: React.MouseEvent) => void }) {
  if (!v || v.value === "empty") {
    return (
      <button type="button" className="os-cell-status s-empty" onClick={onPick}>—</button>
    );
  }
  return (
    <button type="button" className={`os-cell-status s-${v.value}`} onClick={onPick}>
      {v.label ?? STATUS_LABELS[v.value]}
    </button>
  );
}

function CellPrio({
  v, onPick,
}: { v?: { value: PrioValue; label?: string }; onPick: (e: React.MouseEvent) => void }) {
  if (!v || v.value === "empty") {
    return (
      <button type="button" className="os-cell-prio p-empty" onClick={onPick}>—</button>
    );
  }
  return (
    <button type="button" className={`os-cell-prio p-${v.value}`} onClick={onPick}>
      {v.label ?? PRIO_LABELS[v.value]}
    </button>
  );
}

function CellPerson({ v }: { v?: Person[] }) {
  if (!v || v.length === 0) {
    return (
      <div className="os-cell-person">
        <button type="button" className="os-av os-av--sm os-av--add" aria-label="Assign">+</button>
      </div>
    );
  }
  return (
    <div className="os-cell-person">
      {v.slice(0, 3).map((p, i) => (
        <span key={i} className="os-av os-av--sm" style={{ background: p.color }}>{p.initials}</span>
      ))}
    </div>
  );
}

function fmtDate(d: Date) {
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

function CellDate({ v }: { v?: { iso: string; state?: "today" | "overdue" | "done" | "empty" } }) {
  if (!v || v.state === "empty") return <div className="os-cell-date is-empty">—</div>;
  const d = new Date(v.iso);
  return <div className={`os-cell-date ${v.state ? `is-${v.state}` : ""}`}>{fmtDate(d)}</div>;
}

function CellTags({ v }: { v?: { label: string; color: LabelColor }[] }) {
  if (!v || v.length === 0) return <div className="os-cell-tags" />;
  return (
    <div className="os-cell-tags">
      {v.map((t, i) => (
        <span key={i} className={`os-lbl os-c-${t.color}`}>{t.label}</span>
      ))}
    </div>
  );
}

function CellNum({ v, currency }: { v?: number; currency?: string }) {
  if (v === undefined || v === null) return <div className="os-cell-num os-cell-text--muted">—</div>;
  return (
    <div className="os-cell-num">
      {currency ? <span className="os-cell-num__cur">{currency}</span> : null}
      {v.toLocaleString()}
    </div>
  );
}

function CellProgress({ v }: { v?: { pct: number; color?: "green" | "warning" | "danger" | "blue" } }) {
  if (!v) return <div className="os-cell-prog"><span className="os-cell-prog__text">—</span></div>;
  const cls = v.color && v.color !== "green" ? v.color : "";
  return (
    <div className="os-cell-prog">
      <span className="os-cell-prog__bar">
        <span className={`os-cell-prog__fill ${cls}`} style={{ width: `${v.pct}%` }} />
      </span>
      <span className="os-cell-prog__text">{v.pct}%</span>
    </div>
  );
}

function CellUpdates({ v }: { v?: { count: number; hasNew?: boolean } }) {
  if (!v) v = { count: 0 };
  return (
    <div className={`os-cell-updates ${v.hasNew ? "has-new" : ""}`}>
      <MessageCircle />
      <span className="os-cell-updates__count">{v.count}</span>
    </div>
  );
}

function CellText({ v, muted }: { v?: string; muted?: boolean }) {
  return <div className={`os-cell-text ${muted ? "os-cell-text--muted" : ""}`}>{v ?? "—"}</div>;
}

// ─── Inline-editable row name ───────────────────────────────
function RowName({
  name,
  done,
  onSave,
}: {
  name: string;
  done?: boolean;
  onSave: (next: string) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState(name);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => { setValue(name); }, [name]);

  useEffect(() => {
    if (editing && inputRef.current) {
      inputRef.current.focus();
      inputRef.current.select();
    }
  }, [editing]);

  if (editing) {
    return (
      <input
        ref={inputRef}
        className="os-row-text-edit"
        value={value}
        onChange={(e) => setValue(e.target.value)}
        onBlur={() => { setEditing(false); if (value.trim() && value !== name) onSave(value.trim()); }}
        onKeyDown={(e) => {
          if (e.key === "Enter") { e.preventDefault(); (e.target as HTMLInputElement).blur(); }
          if (e.key === "Escape") { setValue(name); setEditing(false); }
        }}
        onClick={(e) => e.stopPropagation()}
      />
    );
  }
  return (
    <span
      className={`os-row-text ${done ? "is-done" : ""}`}
      onClick={(e) => { e.stopPropagation(); setEditing(true); }}
      title="Click to edit"
    >
      {name}
    </span>
  );
}

// ─── Picker state ───────────────────────────────────────────
type PickerState = {
  rect: DOMRect;
  rowId: string;
  groupId: string;
  columnId: string;
  type: "status" | "priority";
  active?: string;
} | null;

// ─── Mutation handlers (parent-supplied, for persistence) ───
export type MainTableHandlers = {
  onStatusChange?: (rowId: string, groupId: string, value: string) => Promise<void> | void;
  onPrioChange?:   (rowId: string, groupId: string, value: string) => Promise<void> | void;
  onToggleDone?:   (rowId: string, groupId: string, done: boolean) => Promise<void> | void;
  onRename?:       (rowId: string, groupId: string, name: string)  => Promise<void> | void;
  onAdd?:          (groupId: string) => Promise<{ id: string; name?: string }> | { id: string; name?: string } | void;
};

// ─── Main table ─────────────────────────────────────────────
export function OsMainTable({
  columns,
  groups: initialGroups,
  moduleId = "tasks",
  statusOptions = DEFAULT_STATUS_OPTIONS,
  prioOptions = DEFAULT_PRIO_OPTIONS,
  handlers,
}: {
  columns: Column[];
  groups: TableGroup[];
  moduleId?: string;
  statusOptions?: PickerOption[];
  prioOptions?: PickerOption[];
  handlers?: MainTableHandlers;
}) {
  const { openItemDrawer } = useOsShell();
  const { toast } = useOsToast();
  const [groups, setGroups] = useState<TableGroup[]>(initialGroups);
  const [picker, setPicker] = useState<PickerState>(null);

  // sync if upstream changes (e.g. module switch OR parent re-fetches)
  useEffect(() => { setGroups(initialGroups); }, [initialGroups]);

  // Generic optimistic-mutate helper. Snapshots the prior state so we can
  // roll back if the parent handler rejects.
  function mutateWithSync(
    mutate: (gs: TableGroup[]) => TableGroup[],
    sync?: () => Promise<void> | void,
    onError?: () => void,
  ) {
    setGroups((prev) => {
      const next = mutate(prev);
      if (sync) {
        const result = sync();
        if (result && typeof (result as Promise<void>).then === "function") {
          (result as Promise<void>).catch(() => {
            setGroups(prev); // roll back
            onError?.();
            toast("Couldn't save — reverted");
          });
        }
      }
      return next;
    });
  }

  function rowMutator(groupId: string, rowId: string, mutate: (r: Row) => Row) {
    return (gs: TableGroup[]) => gs.map((g) =>
      g.id !== groupId ? g : { ...g, rows: g.rows.map((r) => r.id === rowId ? mutate(r) : r) },
    );
  }

  function handleStatusChange(value: string) {
    if (!picker) return;
    const col = picker.columnId;
    const { rowId, groupId } = picker;
    mutateWithSync(
      rowMutator(groupId, rowId, (r) => {
        const next: Row = { ...r, cells: { ...r.cells, [col]: { value } } };
        if (col === "status") next.done = value === "done" || value === "shipped";
        return next;
      }),
      col === "status" ? () => handlers?.onStatusChange?.(rowId, groupId, value) : undefined,
    );
    const label = statusOptions.find((o) => o.value === value)?.label ?? STATUS_LABELS[value as StatusValue] ?? value;
    toast(`Status set to "${label}"`);
  }

  function handlePrioChange(value: string) {
    if (!picker) return;
    const { rowId, groupId, columnId } = picker;
    mutateWithSync(
      rowMutator(groupId, rowId, (r) => ({
        ...r, cells: { ...r.cells, [columnId]: { value } },
      })),
      () => handlers?.onPrioChange?.(rowId, groupId, value),
    );
    const label = prioOptions.find((o) => o.value === value)?.label ?? PRIO_LABELS[value as PrioValue] ?? value;
    toast(`Priority set to "${label}"`);
  }

  function handleClear() {
    if (!picker) return;
    const { rowId, groupId, columnId } = picker;
    mutateWithSync(
      rowMutator(groupId, rowId, (r) => ({
        ...r, cells: { ...r.cells, [columnId]: { value: "empty" } },
      })),
    );
    toast("Cleared");
  }

  function handleCheckbox(groupId: string, rowId: string, r: Row, e: React.MouseEvent) {
    e.stopPropagation();
    const next = !r.done;
    mutateWithSync(
      rowMutator(groupId, rowId, (row) => ({
        ...row,
        done: next,
        cells: { ...row.cells, status: next ? { value: "done" } : { value: "working" } },
      })),
      () => handlers?.onToggleDone?.(rowId, groupId, next),
    );
    toast(next ? "Marked done" : "Reopened");
  }

  function handleNameSave(groupId: string, rowId: string, name: string) {
    mutateWithSync(
      rowMutator(groupId, rowId, (r) => ({ ...r, name })),
      () => handlers?.onRename?.(rowId, groupId, name),
    );
    toast("Renamed");
  }

  async function handleAddItem(groupId: string) {
    const tempId = `temp-${Date.now()}`;
    const placeholder: Row = {
      id: tempId,
      name: "Untitled item",
      cells: { status: { value: "working" } },
    };
    setGroups((gs) => gs.map((g) =>
      g.id !== groupId ? g : { ...g, rows: [...g.rows, placeholder] },
    ));
    toast("Item added");

    if (!handlers?.onAdd) return;
    try {
      const result = await handlers.onAdd(groupId);
      if (result && result.id) {
        // swap temp id with real id from server
        setGroups((gs) => gs.map((g) =>
          g.id !== groupId ? g : {
            ...g,
            rows: g.rows.map((r) => r.id === tempId
              ? { ...r, id: result.id, ...(result.name ? { name: result.name } : {}) }
              : r,
            ),
          },
        ));
      }
    } catch {
      // remove temp row + error toast
      setGroups((gs) => gs.map((g) =>
        g.id !== groupId ? g : { ...g, rows: g.rows.filter((r) => r.id !== tempId) },
      ));
      toast("Couldn't add item — reverted");
    }
  }

  return (
    <div className="os-maintable">
      {groups.map((g) => {
        const totalNum = columns.reduce((acc, c) => {
          if (c.type !== "number") return acc;
          const sum = g.rows.reduce((s, r) => s + ((r.cells[c.id] as number | undefined) ?? 0), 0);
          return acc + sum;
        }, 0);
        const doneCount = g.rows.filter((r) => r.done).length;

        return (
          <section key={g.id} className="os-group">
            <header className="os-group__head">
              <button type="button" className="os-group__chev" aria-label="Collapse">
                <ChevronDown />
              </button>
              <h3 className="os-group__title" style={{ color: g.color }}>{g.title}</h3>
              <span className="os-group__count">{g.rows.length} items</span>
              <span className="os-group__meta">
                {doneCount > 0 ? <span className="os-group__meta-item"><strong>{doneCount}</strong> done</span> : null}
                {totalNum > 0 ? <span className="os-group__meta-item">Total <strong>{totalNum.toLocaleString()}</strong></span> : null}
              </span>
              <button type="button" className="os-group__menu" aria-label="Group menu">
                <MoreHorizontal />
              </button>
            </header>

            <div className="os-tbl-wrap" style={{ "--group-color": g.color } as React.CSSProperties}>
              <table className="os-tbl">
                <thead>
                  <tr>
                    <th>Item</th>
                    {columns.map((c) => (
                      <th key={c.id} style={{ width: c.width }}>{c.label}</th>
                    ))}
                    <th aria-label="Add column"><span style={{ color: "var(--os-ink-3)" }}>+</span></th>
                  </tr>
                </thead>
                <tbody>
                  {g.rows.map((r) => (
                    <tr
                      key={r.id}
                      onClick={() => openItemDrawer({ moduleId, itemId: r.id, name: r.name, groupColor: g.color, payload: r.cells })}
                      style={{ cursor: "pointer" }}
                    >
                      <td onClick={(e) => e.stopPropagation()}>
                        <div className="os-row-item">
                          <button
                            type="button"
                            className={`os-row-check ${r.done ? "is-done" : ""}`}
                            aria-label={r.done ? "Mark incomplete" : "Mark done"}
                            onClick={(e) => handleCheckbox(g.id, r.id, r, e)}
                          />
                          <RowName
                            name={r.name}
                            done={r.done}
                            onSave={(name) => handleNameSave(g.id, r.id, name)}
                          />
                          <button
                            type="button"
                            className="os-row-open"
                            onClick={() => openItemDrawer({ moduleId, itemId: r.id, name: r.name, groupColor: g.color, payload: r.cells })}
                          >
                            Open <ArrowRight />
                          </button>
                        </div>
                      </td>
                      {columns.map((c) => (
                        <td
                          key={c.id}
                          onClick={(e) => {
                            if (c.type === "status" || c.type === "priority") {
                              e.stopPropagation();
                              const cur = r.cells[c.id] as { value: string } | undefined;
                              setPicker({
                                rect: (e.currentTarget as HTMLElement).getBoundingClientRect(),
                                rowId: r.id,
                                groupId: g.id,
                                columnId: c.id,
                                type: c.type,
                                active: cur?.value,
                              });
                            }
                          }}
                        >
                          {c.type === "status" && (
                            <CellStatus
                              v={r.cells[c.id] as { value: StatusValue; label?: string }}
                              onPick={() => {}}
                            />
                          )}
                          {c.type === "priority" && (
                            <CellPrio
                              v={r.cells[c.id] as { value: PrioValue; label?: string }}
                              onPick={() => {}}
                            />
                          )}
                          {c.type === "person" && <CellPerson v={r.cells[c.id] as Person[]} />}
                          {c.type === "date" && <CellDate v={r.cells[c.id] as { iso: string; state?: "today" | "overdue" | "done" | "empty" }} />}
                          {c.type === "tags" && <CellTags v={r.cells[c.id] as { label: string; color: LabelColor }[]} />}
                          {c.type === "number" && <CellNum v={r.cells[c.id] as number} currency={c.currency} />}
                          {c.type === "progress" && <CellProgress v={r.cells[c.id] as { pct: number; color?: "green" | "warning" | "danger" | "blue" }} />}
                          {c.type === "updates" && <CellUpdates v={r.cells[c.id] as { count: number; hasNew?: boolean }} />}
                          {c.type === "text" && <CellText v={r.cells[c.id] as string} />}
                        </td>
                      ))}
                      <td />
                    </tr>
                  ))}
                </tbody>
              </table>
              <button
                type="button"
                className="os-tbl-add"
                onClick={() => handleAddItem(g.id)}
              >
                <Plus />
                <span>Add item</span>
              </button>
            </div>
          </section>
        );
      })}

      {picker ? (
        <OsPickerPopover
          anchorRect={picker.rect}
          title={picker.type === "status" ? "Set status" : "Set priority"}
          options={picker.type === "status" ? statusOptions : prioOptions}
          activeValue={picker.active}
          onSelect={picker.type === "status" ? handleStatusChange : handlePrioChange}
          onClear={handleClear}
          onClose={() => setPicker(null)}
        />
      ) : null}
    </div>
  );
}
