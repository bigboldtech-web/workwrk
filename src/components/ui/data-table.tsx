"use client";

import * as React from "react";
import { cn } from "@/lib/utils";

export type ColumnAlign = "left" | "right" | "center";

export type DataTableColumn<T> = {
  key: string;
  header: React.ReactNode;
  cell: (row: T, rowIndex: number) => React.ReactNode;
  align?: ColumnAlign;
  width?: number | string;
  sortable?: boolean;
  className?: string;
};

export type SortState = { key: string; dir: "asc" | "desc" } | null;

export interface DataTableProps<T> {
  columns: DataTableColumn<T>[];
  rows: T[];
  rowKey: (row: T, index: number) => string;
  onRowClick?: (row: T) => void;
  selectable?: boolean;
  /** When set, only rows for which this returns true show a checkbox.
   * "Select all" toggles only the selectable subset. */
  rowSelectable?: (row: T) => boolean;
  selectedKeys?: string[];
  onSelectionChange?: (keys: string[]) => void;
  sort?: SortState;
  onSortChange?: (sort: SortState) => void;
  loading?: boolean;
  loadingRows?: number;
  empty?: React.ReactNode;
  rowAction?: (row: T) => React.ReactNode;
  className?: string;
}

export function DataTable<T>({
  columns,
  rows,
  rowKey,
  onRowClick,
  selectable,
  rowSelectable,
  selectedKeys = [],
  onSelectionChange,
  sort,
  onSortChange,
  loading,
  loadingRows = 6,
  empty,
  rowAction,
  className,
}: DataTableProps<T>) {
  const selectableKeys = React.useMemo(
    () =>
      rows
        .map((r, i) => ({ key: rowKey(r, i), ok: rowSelectable ? rowSelectable(r) : true }))
        .filter((x) => x.ok)
        .map((x) => x.key),
    [rows, rowKey, rowSelectable],
  );
  const allSelected =
    selectable && selectableKeys.length > 0 && selectableKeys.every((k) => selectedKeys.includes(k));

  function toggleAll() {
    if (!onSelectionChange) return;
    onSelectionChange(allSelected ? [] : selectableKeys);
  }
  function toggleOne(key: string) {
    if (!onSelectionChange) return;
    onSelectionChange(
      selectedKeys.includes(key) ? selectedKeys.filter((k) => k !== key) : [...selectedKeys, key],
    );
  }
  function handleSort(col: DataTableColumn<T>) {
    if (!col.sortable || !onSortChange) return;
    if (!sort || sort.key !== col.key) {
      onSortChange({ key: col.key, dir: "asc" });
      return;
    }
    onSortChange(sort.dir === "asc" ? { key: col.key, dir: "desc" } : null);
  }

  const colCount = columns.length + (selectable ? 1 : 0) + (rowAction ? 1 : 0);

  return (
    <div className={cn("dash-table-wrap", className)}>
      <table className="dash-table">
        <thead>
          <tr>
            {selectable && (
              <th className="dash-table-checkbox">
                <input
                  type="checkbox"
                  aria-label="Select all"
                  checked={!!allSelected}
                  onChange={toggleAll}
                />
              </th>
            )}
            {columns.map((col) => {
              const isSorted = sort?.key === col.key;
              const indicator = isSorted ? (sort.dir === "asc" ? "▲" : "▼") : "↕";
              return (
                <th
                  key={col.key}
                  style={col.width ? { width: col.width } : undefined}
                  className={cn(
                    col.align === "right" && "align-right",
                    col.align === "center" && "align-center",
                    col.sortable && "is-sortable",
                    isSorted && "is-sorted",
                  )}
                  onClick={() => handleSort(col)}
                >
                  {col.header}
                  {col.sortable && <span className="dash-table-sort-ind">{indicator}</span>}
                </th>
              );
            })}
            {rowAction && <th className="dash-table-row-action" aria-label="Actions" />}
          </tr>
        </thead>
        <tbody>
          {loading ? (
            Array.from({ length: loadingRows }).map((_, i) => (
              <tr key={`sk-${i}`} className="dash-table-skeleton-row">
                {selectable && <td className="dash-table-checkbox" />}
                {columns.map((col) => (
                  <td key={col.key}>
                    <div className="dash-table-skeleton-bar" />
                  </td>
                ))}
                {rowAction && <td className="dash-table-row-action" />}
              </tr>
            ))
          ) : rows.length === 0 ? (
            <tr>
              <td colSpan={colCount}>
                <div className="dash-table-empty">{empty ?? "No data"}</div>
              </td>
            </tr>
          ) : (
            rows.map((row, i) => {
              const key = rowKey(row, i);
              const selected = selectedKeys.includes(key);
              const canSelect = rowSelectable ? rowSelectable(row) : true;
              return (
                <tr
                  key={key}
                  className={cn(selected && "is-selected")}
                  onClick={onRowClick ? () => onRowClick(row) : undefined}
                  style={onRowClick ? { cursor: "pointer" } : undefined}
                >
                  {selectable && (
                    <td className="dash-table-checkbox" onClick={(e) => e.stopPropagation()}>
                      {canSelect ? (
                        <input
                          type="checkbox"
                          aria-label="Select row"
                          checked={selected}
                          onChange={() => toggleOne(key)}
                        />
                      ) : null}
                    </td>
                  )}
                  {columns.map((col) => (
                    <td
                      key={col.key}
                      className={cn(
                        col.align === "right" && "align-right",
                        col.align === "center" && "align-center",
                        col.className,
                      )}
                    >
                      {col.cell(row, i)}
                    </td>
                  ))}
                  {rowAction && (
                    <td className="dash-table-row-action" onClick={(e) => e.stopPropagation()}>
                      {rowAction(row)}
                    </td>
                  )}
                </tr>
              );
            })
          )}
        </tbody>
      </table>
    </div>
  );
}
