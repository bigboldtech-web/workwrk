"use client";

// BoardWorkloadView — WORKLOAD renderer, two variants driven by
// View.config.variant:
//   "workload" (default) — per-person capacity rows: open/done counts,
//     overdue badge, and a status-colored stacked bar (mirrors the
//     Space-level Workload card from Phases 52–55, board-scoped).
//   "team" — per-person kanban: one column per assignee, cards open
//     the task drawer (the Space Team tab pattern, board-scoped).

import { useMemo } from "react";
import { AlertTriangle, Users } from "lucide-react";
import {
  isDoneStatus,
  type BoardItemRow,
  type StatusOption,
} from "@/lib/board-items-shared";
import { PersonAvatar } from "./assignee-picker";
import { PriorityFlag } from "./priority-picker";

interface BoardWorkloadViewProps {
  initialItems: BoardItemRow[];
  statuses: StatusOption[];
  variant?: "workload" | "team";
  onOpenItem?: (itemId: string) => void;
}

interface PersonBucket {
  key: string;
  owner: NonNullable<BoardItemRow["owner"]> | null;
  rows: BoardItemRow[];
}

export function BoardWorkloadView({ initialItems, statuses, variant = "workload", onOpenItem }: BoardWorkloadViewProps) {
  const buckets = useMemo<PersonBucket[]>(() => {
    const map = new Map<string, PersonBucket>();
    for (const it of initialItems) {
      const key = it.ownerId ?? "__unassigned__";
      const entry = map.get(key) ?? { key, owner: it.owner ?? null, rows: [] };
      if (!entry.owner && it.owner) entry.owner = it.owner;
      entry.rows.push(it);
      map.set(key, entry);
    }
    const list = Array.from(map.values());
    // Most-loaded first; Unassigned always last.
    list.sort((a, b) => {
      if (a.key === "__unassigned__") return 1;
      if (b.key === "__unassigned__") return -1;
      return b.rows.length - a.rows.length;
    });
    return list;
  }, [initialItems]);

  if (initialItems.length === 0) {
    return (
      <div className="rounded-lg border border-zinc-200 bg-white px-8 py-14 text-center">
        <Users className="w-8 h-8 mx-auto text-zinc-300 mb-3" />
        <p className="text-[12.5px] text-zinc-500">No items yet — assign work to see {variant === "team" ? "the team board" : "workload"}.</p>
      </div>
    );
  }

  if (variant === "team") {
    return (
      <div className="flex gap-3 overflow-x-auto pb-2">
        {buckets.map((b) => (
          <div key={b.key} className="flex flex-col w-[280px] flex-shrink-0 rounded-lg bg-zinc-50/80 p-2">
            <PersonHeader bucket={b} statuses={statuses} />
            <div className="flex-1 space-y-2 min-h-[40px] mt-2">
              {b.rows.map((it) => {
                const opt = it.status ? statuses.find((o) => o.value === it.status) : null;
                const overdue = !!it.dueAt && new Date(it.dueAt) < new Date() && !isDoneStatus(statuses, it.status);
                return (
                  <button
                    key={it.id}
                    type="button"
                    onClick={() => onOpenItem?.(it.id)}
                    className="block w-full text-left rounded-md border border-zinc-200 bg-white px-3 py-2 text-sm hover:shadow-sm transition-shadow"
                  >
                    <div className="break-words">{it.title}</div>
                    <div className="mt-1.5 flex items-center gap-1.5 flex-wrap">
                      {opt ? (
                        <span
                          className="inline-flex items-center px-1.5 py-0.5 rounded text-[10.5px] font-medium"
                          style={{ background: `${opt.color}22`, color: opt.color }}
                        >
                          {opt.label}
                        </span>
                      ) : null}
                      {it.priority ? <PriorityFlag value={it.priority} /> : null}
                      {overdue ? (
                        <span className="inline-flex items-center gap-0.5 text-[10.5px] font-medium text-red-600">
                          <AlertTriangle className="w-3 h-3" /> overdue
                        </span>
                      ) : null}
                    </div>
                  </button>
                );
              })}
            </div>
          </div>
        ))}
      </div>
    );
  }

  return (
    <div className="rounded-lg border border-zinc-200 bg-white divide-y divide-zinc-100">
      {buckets.map((b) => {
        const open = b.rows.filter((r) => !isDoneStatus(statuses, r.status)).length;
        const done = b.rows.length - open;
        const overdue = b.rows.filter(
          (r) => r.dueAt && new Date(r.dueAt) < new Date() && !isDoneStatus(statuses, r.status),
        ).length;
        return (
          <div key={b.key} className="px-4 py-3 flex items-center gap-3">
            <PersonLabel bucket={b} />
            <div className="flex-1 min-w-0">
              <StatusBar rows={b.rows} statuses={statuses} />
            </div>
            <span className="text-[12px] tabular-nums text-zinc-700 w-16 text-right">{open} open</span>
            <span className="text-[12px] tabular-nums text-emerald-600 w-16 text-right">{done} done</span>
            <span className={`inline-flex items-center gap-1 text-[12px] tabular-nums w-20 justify-end ${overdue ? "text-red-600" : "text-zinc-300"}`}>
              <AlertTriangle className="w-3 h-3" />
              {overdue} late
            </span>
          </div>
        );
      })}
    </div>
  );
}

function PersonLabel({ bucket }: { bucket: PersonBucket }) {
  if (!bucket.owner) {
    return (
      <span className="inline-flex items-center gap-2 w-44 shrink-0 text-[12.5px] text-zinc-500">
        <span className="inline-flex items-center justify-center h-6 w-6 rounded-full bg-zinc-100 text-zinc-400">
          <Users className="w-3 h-3" />
        </span>
        Unassigned
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-2 w-44 shrink-0 text-[12.5px] font-medium text-zinc-800 min-w-0">
      <PersonAvatar person={{ ...bucket.owner, email: null }} size={24} />
      <span className="truncate">{`${bucket.owner.firstName ?? ""} ${bucket.owner.lastName ?? ""}`.trim()}</span>
    </span>
  );
}

function PersonHeader({ bucket, statuses }: { bucket: PersonBucket; statuses: StatusOption[] }) {
  return (
    <div className="px-1">
      <div className="flex items-center gap-2">
        {bucket.owner ? (
          <>
            <PersonAvatar person={{ ...bucket.owner, email: null }} size={22} />
            <span className="text-[12.5px] font-medium text-zinc-800 truncate">
              {`${bucket.owner.firstName ?? ""} ${bucket.owner.lastName ?? ""}`.trim()}
            </span>
          </>
        ) : (
          <span className="text-[12.5px] text-zinc-500">Unassigned</span>
        )}
        <span className="text-[11px] text-zinc-400 tabular-nums">{bucket.rows.length}</span>
      </div>
      <div className="mt-1.5">
        <StatusBar rows={bucket.rows} statuses={statuses} />
      </div>
    </div>
  );
}

function StatusBar({ rows, statuses }: { rows: BoardItemRow[]; statuses: StatusOption[] }) {
  const segs = useMemo(() => {
    const counts = new Map<string, number>();
    for (const r of rows) counts.set(r.status ?? "__unset__", (counts.get(r.status ?? "__unset__") ?? 0) + 1);
    const out: { key: string; label: string; color: string; count: number }[] = [];
    for (const o of statuses) {
      const n = counts.get(o.value);
      if (n) { out.push({ key: o.value, label: o.label, color: o.color, count: n }); counts.delete(o.value); }
    }
    for (const [k, n] of counts) out.push({ key: k, label: k === "__unset__" ? "Unset" : k, color: "#A1A1AA", count: n });
    return out;
  }, [rows, statuses]);
  const total = rows.length;
  if (total === 0) return <span className="text-[11px] text-zinc-300">—</span>;
  return (
    <div
      className="flex h-3 w-full max-w-[420px] rounded-sm overflow-hidden ring-1 ring-black/5"
      title={segs.map((s) => `${s.label}: ${s.count}`).join("  ·  ")}
    >
      {segs.map((s) => (
        <span key={s.key} style={{ width: `${(s.count / total) * 100}%`, background: s.color }} aria-hidden />
      ))}
    </div>
  );
}
