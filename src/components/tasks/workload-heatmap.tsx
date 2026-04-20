"use client";

import { useEffect, useMemo, useState } from "react";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import type { TeamMember } from "./types";
import { formatISODate, startOfDay } from "./types";

interface WorkloadRow {
  userId: string;
  date: string;
  estimateHours: number;
  taskCount: number;
  completedCount: number;
}

/** Manager workload heatmap. Rows are team members, columns are days.
 *  Each cell darkens with estimated hours. Click to drill — parent page
 *  handles the drill target (filters Day view to that user+date). */
export function WorkloadHeatmap({
  weekStart,
  teamMembers,
  onDrill,
}: {
  weekStart: Date;
  teamMembers: TeamMember[];
  onDrill: (userId: string, date: string) => void;
}) {
  const [rows, setRows] = useState<WorkloadRow[] | null>(null);

  const days = useMemo(() => {
    const out: Date[] = [];
    const s = startOfDay(weekStart);
    for (let i = 0; i < 7; i++) {
      const d = new Date(s);
      d.setDate(s.getDate() + i);
      out.push(d);
    }
    return out;
  }, [weekStart]);

  useEffect(() => {
    if (teamMembers.length === 0) { setRows([]); return; }
    const from = formatISODate(days[0]);
    const to = formatISODate(days[6]);
    const userIds = teamMembers.map((m) => m.id).join(",");
    let cancelled = false;
    fetch(`/api/tasks/workload?from=${from}&to=${to}&userIds=${userIds}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        if (cancelled) return;
        const list: WorkloadRow[] = Array.isArray(d) ? d : d?.data || [];
        setRows(list);
      })
      .catch(() => setRows([]));
    return () => { cancelled = true; };
  }, [weekStart, teamMembers, days]);

  const byKey = useMemo(() => {
    const m = new Map<string, WorkloadRow>();
    for (const r of rows ?? []) m.set(`${r.userId}::${r.date}`, r);
    return m;
  }, [rows]);

  if (!rows) {
    return <div className="rounded-xl border border-border bg-surface p-4 text-xs text-muted">Loading workload…</div>;
  }
  if (teamMembers.length === 0) {
    return <div className="rounded-xl border border-border bg-surface p-4 text-xs text-muted">No team members to show.</div>;
  }

  return (
    <div className="rounded-xl border border-border bg-surface overflow-hidden">
      <div className="px-3 py-2 border-b border-border bg-surface-2/40 text-xs font-medium">
        Team workload — estimate hours per day
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-xs">
          <thead>
            <tr className="text-[10px] text-muted">
              <th className="text-left px-3 py-1.5 font-medium">Person</th>
              {days.map((d) => (
                <th key={formatISODate(d)} className="px-1.5 py-1.5 font-medium text-center">
                  <div>{d.toLocaleDateString("en-US", { weekday: "short" })}</div>
                  <div className="opacity-70">{d.getDate()}</div>
                </th>
              ))}
              <th className="px-3 py-1.5 font-medium text-right">Total</th>
            </tr>
          </thead>
          <tbody>
            {teamMembers.map((m) => {
              const weekTotal = days.reduce((sum, d) => {
                const row = byKey.get(`${m.id}::${formatISODate(d)}`);
                return sum + (row?.estimateHours ?? 0);
              }, 0);
              return (
                <tr key={m.id} className="border-t border-border">
                  <td className="px-3 py-1.5">
                    <div className="flex items-center gap-2">
                      <Avatar className="h-5 w-5">
                        {m.avatar ? <AvatarImage src={m.avatar} alt="" /> : null}
                        <AvatarFallback className="text-[9px]">
                          {m.firstName[0]}{m.lastName[0]}
                        </AvatarFallback>
                      </Avatar>
                      <span>{m.firstName} {m.lastName}</span>
                    </div>
                  </td>
                  {days.map((d) => {
                    const key = formatISODate(d);
                    const row = byKey.get(`${m.id}::${key}`);
                    const hours = row?.estimateHours ?? 0;
                    // Intensity bucket — 0–2h light, 2–4 medium, 4–7 strong, 7+ overload.
                    const bg =
                      hours === 0 ? "transparent"
                      : hours < 2 ? "rgba(212,255,46,0.10)"
                      : hours < 4 ? "rgba(212,255,46,0.25)"
                      : hours < 7 ? "rgba(212,255,46,0.45)"
                      : "rgba(255,107,107,0.45)";
                    return (
                      <td key={key} className="p-0.5">
                        <button
                          onClick={() => onDrill(m.id, key)}
                          className="w-full h-7 rounded text-[10px] text-foreground/90 hover:ring-1 hover:ring-[#d4ff2e] transition"
                          style={{ backgroundColor: bg }}
                          title={hours > 0 ? `${hours.toFixed(1)}h · ${row?.taskCount ?? 0} tasks` : "—"}
                        >
                          {hours > 0 ? hours.toFixed(1) : ""}
                        </button>
                      </td>
                    );
                  })}
                  <td className="px-3 py-1.5 text-right text-muted">
                    {weekTotal > 0 ? `${weekTotal.toFixed(1)}h` : "—"}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
