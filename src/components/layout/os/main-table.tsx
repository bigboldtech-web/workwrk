"use client";

import { ChevronDown, MoreHorizontal, MessageCircle, ArrowRight, Plus } from "lucide-react";
import type { Person } from "./title-bar";

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
  color: string; // CSS color value
  rows: Row[];
};

// Cell renderers ─────────────────────────────────────────────
function CellStatus({ v }: { v?: { value: StatusValue; label?: string } }) {
  if (!v) return <div className="os-cell-status s-empty">—</div>;
  const labels: Record<StatusValue, string> = {
    done: "Done", working: "Working on it", stuck: "Stuck",
    progress: "In progress", review: "Review", hold: "On hold",
    planning: "Planning", shipped: "Shipped", pending: "Pending",
    critical: "Critical", empty: "—",
  };
  return <div className={`os-cell-status s-${v.value}`}>{v.label ?? labels[v.value]}</div>;
}

function CellPrio({ v }: { v?: { value: PrioValue; label?: string } }) {
  if (!v) return <div className="os-cell-prio p-empty">—</div>;
  const labels: Record<PrioValue, string> = {
    critical: "Critical", high: "High", medium: "Medium", low: "Low", empty: "—",
  };
  return <div className={`os-cell-prio p-${v.value}`}>{v.label ?? labels[v.value]}</div>;
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

// ─────────────────────────────────────────────────────────────
export function OsMainTable({ columns, groups }: { columns: Column[]; groups: TableGroup[] }) {
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
                    <tr key={r.id}>
                      <td>
                        <div className="os-row-item">
                          <button
                            type="button"
                            className={`os-row-check ${r.done ? "is-done" : ""}`}
                            aria-label={r.done ? "Mark incomplete" : "Mark done"}
                          />
                          <span className={`os-row-text ${r.done ? "is-done" : ""}`}>{r.name}</span>
                          <button type="button" className="os-row-open">
                            Open <ArrowRight />
                          </button>
                        </div>
                      </td>
                      {columns.map((c) => (
                        <td key={c.id}>
                          {c.type === "status" && <CellStatus v={r.cells[c.id] as { value: StatusValue; label?: string }} />}
                          {c.type === "priority" && <CellPrio v={r.cells[c.id] as { value: PrioValue; label?: string }} />}
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
              <button type="button" className="os-tbl-add">
                <Plus />
                <span>Add item</span>
              </button>
            </div>
          </section>
        );
      })}
    </div>
  );
}
