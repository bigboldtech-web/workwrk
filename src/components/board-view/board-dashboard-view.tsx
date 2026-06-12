"use client";

// BoardDashboardView — DASHBOARD renderer. A board-scoped report: stat
// cards + status / priority / owner breakdowns computed from the
// board's items. v1 is a fixed widget set (no per-widget config);
// custom widget layout shares the standalone /dashboards canvas work.

import { useMemo } from "react";
import { AlertTriangle, CheckCircle2, CircleDot, Users } from "lucide-react";
import {
  PRIORITY_OPTIONS,
  isDoneStatus,
  type BoardItemRow,
  type StatusOption,
} from "@/lib/board-items-shared";
import { PersonAvatar } from "./assignee-picker";

interface BoardDashboardViewProps {
  initialItems: BoardItemRow[];
  statuses: StatusOption[];
}

interface Seg { key: string; label: string; color: string; count: number }

export function BoardDashboardView({ initialItems, statuses }: BoardDashboardViewProps) {
  const stats = useMemo(() => {
    const now = new Date();
    const weekAgo = new Date(now.getTime() - 7 * 86_400_000);
    let open = 0, done = 0, overdue = 0, unassigned = 0, doneThisWeek = 0;
    for (const it of initialItems) {
      const closed = isDoneStatus(statuses, it.status);
      if (closed) done += 1; else open += 1;
      if (!closed && it.dueAt && new Date(it.dueAt) < now) overdue += 1;
      if (!it.ownerId) unassigned += 1;
      if (closed && new Date(it.updatedAt) >= weekAgo) doneThisWeek += 1;
    }
    return { total: initialItems.length, open, done, overdue, unassigned, doneThisWeek };
  }, [initialItems, statuses]);

  const statusSegs = useMemo<Seg[]>(() => {
    const counts = new Map<string, number>();
    for (const it of initialItems) counts.set(it.status ?? "__unset__", (counts.get(it.status ?? "__unset__") ?? 0) + 1);
    const segs: Seg[] = [];
    for (const o of statuses) {
      const n = counts.get(o.value);
      if (n) { segs.push({ key: o.value, label: o.label, color: o.color, count: n }); counts.delete(o.value); }
    }
    for (const [k, n] of counts) segs.push({ key: k, label: k === "__unset__" ? "Unset" : k, color: "#A1A1AA", count: n });
    return segs;
  }, [initialItems, statuses]);

  const prioritySegs = useMemo<Seg[]>(() => {
    const counts = new Map<string, number>();
    for (const it of initialItems) if (it.priority) counts.set(it.priority, (counts.get(it.priority) ?? 0) + 1);
    const segs: Seg[] = [];
    for (const p of PRIORITY_OPTIONS) {
      const n = counts.get(p.value);
      if (n) segs.push({ key: p.value, label: p.label, color: p.color, count: n });
    }
    return segs;
  }, [initialItems]);

  const owners = useMemo(() => {
    const map = new Map<string, { owner: NonNullable<BoardItemRow["owner"]>; open: number; done: number }>();
    for (const it of initialItems) {
      if (!it.owner) continue;
      const entry = map.get(it.owner.id) ?? { owner: it.owner, open: 0, done: 0 };
      if (isDoneStatus(statuses, it.status)) entry.done += 1; else entry.open += 1;
      map.set(it.owner.id, entry);
    }
    return Array.from(map.values()).sort((a, b) => b.open + b.done - (a.open + a.done));
  }, [initialItems, statuses]);

  return (
    <div className="space-y-3">
      {/* Stat cards */}
      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-2">
        <StatCard label="Total items" value={stats.total} Icon={CircleDot} tint="#6366F1" />
        <StatCard label="Open" value={stats.open} Icon={CircleDot} tint="#71717A" />
        <StatCard label="Done / Closed" value={stats.done} Icon={CheckCircle2} tint="#10B981" />
        <StatCard label="Overdue" value={stats.overdue} Icon={AlertTriangle} tint="#EF4444" />
        <StatCard label="Unassigned" value={stats.unassigned} Icon={Users} tint="#F59E0B" />
        <StatCard label="Closed this week" value={stats.doneThisWeek} Icon={CheckCircle2} tint="#06B6D4" />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-3">
        <BreakdownCard title="By status" segs={statusSegs} total={stats.total} />
        <BreakdownCard title="By priority" segs={prioritySegs} total={prioritySegs.reduce((a, s) => a + s.count, 0)} emptyHint="No priorities set yet." />
        <div className="rounded-lg border border-zinc-200 bg-white p-4">
          <div className="text-[12.5px] font-semibold text-zinc-900 mb-3">By person</div>
          {owners.length === 0 ? (
            <p className="text-[12px] text-zinc-400">No assigned items yet.</p>
          ) : (
            <ul className="space-y-2">
              {owners.slice(0, 8).map(({ owner, open, done }) => (
                <li key={owner.id} className="flex items-center gap-2 text-[12.5px]">
                  <PersonAvatar person={{ ...owner, email: null }} size={20} />
                  <span className="flex-1 min-w-0 truncate text-zinc-700">
                    {`${owner.firstName ?? ""} ${owner.lastName ?? ""}`.trim()}
                  </span>
                  <span className="text-zinc-500 tabular-nums">{open} open</span>
                  <span className="text-emerald-600 tabular-nums">{done} done</span>
                </li>
              ))}
              {owners.length > 8 ? (
                <li className="text-[11px] text-zinc-400">+{owners.length - 8} more</li>
              ) : null}
            </ul>
          )}
        </div>
      </div>
    </div>
  );
}

function StatCard({ label, value, Icon, tint }: { label: string; value: number; Icon: React.ComponentType<{ className?: string; style?: React.CSSProperties }>; tint: string }) {
  return (
    <div className="rounded-lg border border-zinc-200 bg-white p-3" style={{ borderLeft: `3px solid ${tint}` }}>
      <div className="flex items-center justify-between">
        <span className="text-[11px] text-zinc-500">{label}</span>
        <Icon className="w-3.5 h-3.5" style={{ color: tint }} />
      </div>
      <div className="mt-1 text-[22px] font-semibold tabular-nums text-zinc-900 leading-none">{value}</div>
    </div>
  );
}

function BreakdownCard({ title, segs, total, emptyHint }: { title: string; segs: Seg[]; total: number; emptyHint?: string }) {
  return (
    <div className="rounded-lg border border-zinc-200 bg-white p-4">
      <div className="text-[12.5px] font-semibold text-zinc-900 mb-3">{title}</div>
      {segs.length === 0 || total === 0 ? (
        <p className="text-[12px] text-zinc-400">{emptyHint ?? "Nothing here yet."}</p>
      ) : (
        <>
          <div className="flex h-3 w-full rounded-sm overflow-hidden ring-1 ring-black/5 mb-3">
            {segs.map((s) => (
              <span key={s.key} style={{ width: `${(s.count / total) * 100}%`, background: s.color }} title={`${s.label}: ${s.count}`} aria-hidden />
            ))}
          </div>
          <ul className="space-y-1.5">
            {segs.map((s) => (
              <li key={s.key} className="flex items-center gap-2 text-[12px]">
                <span className="h-2 w-2 rounded-full shrink-0" style={{ backgroundColor: s.color }} aria-hidden />
                <span className="flex-1 text-zinc-600">{s.label}</span>
                <span className="tabular-nums text-zinc-700">{s.count}</span>
                <span className="tabular-nums text-zinc-400 w-10 text-right">{Math.round((s.count / total) * 100)}%</span>
              </li>
            ))}
          </ul>
        </>
      )}
    </div>
  );
}
