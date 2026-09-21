"use client";

// My work's Sprint view: the personal sprint room the retired /tasks/sprint
// page was, over the same Item rows the rest of the page reads.
//
//   verdict pill      Ahead of pace / On track / Behind pace / Planning
//   four KPI tiles    Day X of 14 · Committed · Burned · Completion %
//   burndown          ideal against actual, today marked, hover for a day
//   at risk           past-due open rows and unassigned non-low rows, with
//                     a hover "Mark done" that writes the row's OWN done status
//   unassigned        chips for the open rows nobody holds (delegated scope)
//
// The maths is lib/my-work-sprint.ts (pure, tested). The chart is the shared
// BurndownChart (ui/burndown-chart.tsx), which the sprint List's header strip
// draws too: one burndown in the product.

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { AlertTriangle, CheckCircle2, Flag, TrendingDown, Users, Zap } from "lucide-react";
import { useOsToast } from "@/components/layout/os/toast";
import { apiFetch } from "@/lib/api-fetch";
import { openTask } from "@/lib/nav/open-task";
import { emitItemChanged } from "@/lib/realtime-events";
import { PRIORITY_LABEL, type MyWorkRow } from "@/lib/my-work";
import { SPRINT_DAYS, sprintSummary, type SprintVerdictTone } from "@/lib/my-work-sprint";
import { BurndownChart } from "@/components/ui/burndown-chart";
import { dueChipLabel, type LocaleContext } from "@/lib/work-buckets";

const VERDICT_CLASS: Record<SprintVerdictTone, string> = {
  neutral: "bg-subtle text-ink-2",
  good: "bg-success-bg text-success-text",
  ok: "bg-brand-soft text-brand-deep",
  bad: "bg-danger-bg text-danger-text",
};

function dayLabel(d: Date): string {
  return d.toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

export function MyWorkSprint({
  rows,
  now,
  locale,
  onChanged,
}: {
  rows: readonly MyWorkRow[];
  now: Date;
  locale: LocaleContext;
  onChanged: () => void;
}) {
  const router = useRouter();
  const { toast } = useOsToast();
  const [busy, setBusy] = useState<Set<string>>(new Set());
  const s = useMemo(() => sprintSummary(rows, now), [rows, now]);

  const markDone = async (row: MyWorkRow) => {
    if (!row.doneStatus) {
      toast("This list has no done status", { description: "Open the task to set its status." });
      return;
    }
    setBusy((b) => new Set(b).add(row.id));
    const res = await apiFetch(`/api/items/${row.id}`, { method: "PATCH", json: { status: row.doneStatus } });
    setBusy((b) => { const next = new Set(b); next.delete(row.id); return next; });
    if (!res.ok) {
      toast("Couldn't update that task", { tone: "danger", description: res.error });
      return;
    }
    emitItemChanged(row.id, row.board?.id ?? null);
    onChanged();
  };

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center gap-3">
        <span className="text-base font-medium text-ink">
          {dayLabel(s.start)} to {dayLabel(new Date(s.end.getTime() - 1))}
        </span>
        <span className={`inline-flex h-6 items-center rounded-md px-2 text-xs font-medium ${VERDICT_CLASS[s.verdict.tone]}`}>
          {s.verdict.label}
        </span>
        <span className="text-sm text-ink-2">A fortnight window over the tasks due in it</span>
      </div>

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Tile icon={Zap} label="Day" value={`${s.dayOf} of ${SPRINT_DAYS}`} />
        <Tile icon={TrendingDown} label="Committed" value={String(s.total)} hint="tasks in the window" />
        <Tile icon={CheckCircle2} label="Burned" value={String(s.done)} hint="done so far" />
        <Tile icon={AlertTriangle} label="Completion" value={`${s.completionPct}%`} />
      </div>

      <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_360px]">
        <section className="os-row rounded-lg border border-line bg-raised p-4">
          <header className="mb-2 flex items-center gap-3">
            <h3 className="text-base font-medium text-ink">Burndown</h3>
            <span className="flex-1" />
            <span className="inline-flex items-center gap-1.5 text-xs text-ink-2">
              <span className="inline-block h-0.5 w-4 border-t-2 border-dashed border-ink-3" aria-hidden /> Ideal
            </span>
            <span className="inline-flex items-center gap-1.5 text-xs text-ink-2">
              <span className="inline-block h-0.5 w-4 bg-brand" aria-hidden /> Actual
            </span>
          </header>
          <BurndownChart points={s.points} total={s.total} todayIndex={s.dayOf - 1} unit="tasks" />
          <p className="mt-2 text-xs text-ink-3">Every task counts as one. A done task burns on the day it was last updated.</p>
        </section>

        <section className="os-row flex min-h-0 flex-col rounded-lg border border-line bg-raised">
          <header className="flex h-11 items-center gap-2 border-b border-line px-4">
            <AlertTriangle className="h-4 w-4 text-danger-text" strokeWidth={1.5} aria-hidden />
            <h3 className="text-base font-medium text-ink">At risk</h3>
            <span className="text-xs font-medium text-ink-2">{s.atRisk.length}</span>
          </header>
          {s.atRisk.length === 0 ? (
            <p className="px-4 py-6 text-sm text-ink-2">Nothing at risk in this window</p>
          ) : (
            <ul className="max-h-[420px] overflow-y-auto">
              {s.atRisk.map((r) => (
                <li key={r.id} className="group flex items-center gap-2 border-b border-line-soft px-4 last:border-b-0 hover:bg-hover" style={{ minHeight: "var(--os-row-h)" }}>
                  {r.priority ? (
                    <Flag
                      className={r.priority === "URGENT" ? "h-3.5 w-3.5 shrink-0 text-danger-text" : r.priority === "HIGH" ? "h-3.5 w-3.5 shrink-0 fill-current text-ink" : "h-3.5 w-3.5 shrink-0 text-ink-3"}
                      strokeWidth={1.5}
                      aria-label={`Priority ${PRIORITY_LABEL[r.priority] ?? r.priority}`}
                    />
                  ) : (
                    <span className="w-3.5 shrink-0" />
                  )}
                  <button type="button" onClick={() => openTask(router, r.id)} className="min-w-0 flex-1 truncate text-start text-ink hover:underline">
                    {r.title}
                  </button>
                  <span className={r.dueBucket === "overdue" ? "shrink-0 text-xs font-medium text-danger-text" : "shrink-0 text-xs text-ink-2"}>
                    {dueChipLabel(r.dueAt ?? r.startAt, now, locale) ?? (r.assignees.length === 0 ? "Unassigned" : "")}
                  </span>
                  <button
                    type="button"
                    disabled={busy.has(r.id)}
                    onClick={() => void markDone(r)}
                    className="hidden h-7 shrink-0 items-center rounded-md border border-line px-2 text-xs font-medium text-ink-2 hover:bg-raised hover:text-ink group-hover:inline-flex disabled:opacity-50"
                  >
                    Mark done
                  </button>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>

      {s.unassigned.length > 0 ? (
        <section className="os-row rounded-lg border border-line bg-raised p-4">
          <header className="mb-2 flex items-center gap-2">
            <Users className="h-4 w-4 text-ink-2" strokeWidth={1.5} aria-hidden />
            <h3 className="text-base font-medium text-ink">Unassigned</h3>
            <span className="text-xs font-medium text-ink-2">{s.unassigned.length}</span>
          </header>
          <div className="flex flex-wrap gap-2">
            {s.unassigned.map((r) => (
              <button
                key={r.id}
                type="button"
                onClick={() => openTask(router, r.id)}
                className="inline-flex h-7 max-w-[280px] items-center gap-1.5 truncate rounded-md border border-line bg-subtle px-2 text-sm text-ink hover:bg-hover"
              >
                <span className="truncate">{r.title}</span>
              </button>
            ))}
          </div>
        </section>
      ) : null}
    </div>
  );
}

function Tile({ icon: Icon, label, value, hint }: { icon: typeof Zap; label: string; value: string; hint?: string }) {
  return (
    <div className="os-row rounded-lg border border-line bg-raised px-4 py-3">
      <div className="flex items-center gap-1.5 text-xs font-medium uppercase tracking-wide text-ink-2">
        <Icon className="h-3.5 w-3.5" strokeWidth={1.5} aria-hidden />
        {label}
      </div>
      <div className="mt-1 text-2xl font-semibold tabular-nums text-ink">{value}</div>
      {hint ? <div className="text-xs text-ink-3">{hint}</div> : null}
    </div>
  );
}

