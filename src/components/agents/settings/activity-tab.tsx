"use client";

// The Activity tab of a teammate's settings (docs/plans/ai-teammates.md
// 5.5): what it did lately (GET /api/agents/teammates/[slug]/activity).
//
//   Recent runs  the runs this person may read (Run history's own rule):
//                a status dot, the summary, when; each opens its detail in
//                Run history
//   Approvals    this person's own requests to it: the card's status chip,
//                the title, when; each opens its card in the chat. A call
//                their own Don't ask let run had no card: it reads "Ran
//                without asking" and opens its run (activityActionView)
//   Usage        the month's AI questions, against its own limit when it
//                has one
//
// Never a cost in cents: a teammate's use is counted in AI questions, the
// unit the plan sells, and the route sends nothing else.

import Link from "next/link";
import { RunStatusDot } from "@/components/automation/run-status-chip";
import { StatusChip } from "@/components/ui/chip";
import { SkeletonRows } from "@/components/ui/skeleton";
import { ACTIVITY_COPY, TEAMMATE_CHAT, usageLine } from "@/lib/agents/teammate-copy";
import { activityActionView, type ActionView } from "@/lib/agents/teammate-thread";
import type { TeammateDetail, TeammateRunRow, TeammateUsage } from "@/lib/agents/teammate-views";
import { RUN_TONE_COLOR } from "@/lib/automation/run-status";
import { formatDate, formatRelative } from "@/lib/format/date";
import { useDatePrefs } from "@/lib/format/use-date-prefs";
import { cn } from "@/lib/utils";
import { ActionStatusChip } from "../approval-card";
import { useTeammateData } from "./use-teammate-data";

const LINK = "font-medium text-brand-deep hover:underline";
const ROW = "flex h-9 w-full min-w-0 items-center gap-2 rounded-md px-2 text-start text-sm hover:bg-hover";

interface Activity {
  runs: TeammateRunRow[];
  actions: ActionView[];
  usage: TeammateUsage;
}

/** The month a usage line is for: the route sends its first day (UTC). */
function usageMonth(month: string): Date {
  const d = new Date(`${month}T00:00:00Z`);
  return Number.isNaN(d.getTime()) ? new Date() : d;
}

export function ActivityTab({ teammate: t }: { teammate: TeammateDetail }) {
  const datePrefs = useDatePrefs();
  const { data, error, reload } = useTeammateData<Activity>(`/api/agents/teammates/${encodeURIComponent(t.slug)}/activity`, t.id);

  if (!data) {
    return error ? (
      <div className="flex h-9 items-center gap-2 text-sm text-ink-2">
        {ACTIVITY_COPY.loadError} ·
        <button type="button" className={LINK} onClick={() => void reload()}>
          {TEAMMATE_CHAT.tryAgain}
        </button>
      </div>
    ) : (
      <SkeletonRows rows={5} />
    );
  }

  const slug = encodeURIComponent(t.slug);
  return (
    <div className="flex flex-col gap-6">
      <section aria-label={ACTIVITY_COPY.recentRuns} className="flex flex-col">
        <h3 className="mb-1 text-sm font-medium text-ink-2">{ACTIVITY_COPY.recentRuns}</h3>
        {data.runs.length === 0 ? (
          <p className="m-0 flex h-9 items-center text-sm text-ink-2">{ACTIVITY_COPY.nothingYet}</p>
        ) : (
          <ul className="flex flex-col">
            {data.runs.map((r) => (
              <li key={r.id}>
                <Link href={`/agents?tab=runs&agent=${slug}&run=${encodeURIComponent(r.id)}`} className={ROW}>
                  <RunStatusDot status={r.status} />
                  <span className="min-w-0 flex-1 truncate text-ink">{r.summary}</span>
                  {r.practice ? <span className="shrink-0 text-ink-2">{TEAMMATE_CHAT.practice}</span> : null}
                  <span className="shrink-0 text-ink-2" title={formatDate(r.startedAt, datePrefs, "datetime")}>
                    {formatRelative(r.startedAt, datePrefs)}
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section aria-label={ACTIVITY_COPY.approvals} className="flex flex-col">
        <h3 className="mb-1 text-sm font-medium text-ink-2">{ACTIVITY_COPY.approvals}</h3>
        {data.actions.length === 0 ? (
          <p className="m-0 flex h-9 items-center text-sm text-ink-2">{ACTIVITY_COPY.nothingYet}</p>
        ) : (
          <ul className="flex flex-col">
            {data.actions.map((a) => {
              const at = a.decidedAt ?? a.createdAt;
              const row = activityActionView(a, t.slug);
              return (
                <li key={a.id}>
                  <Link href={row.href} className={cn(ROW, "h-auto min-h-9 py-1")}>
                    {row.chip ? (
                      <StatusChip color={RUN_TONE_COLOR[row.chip.tone]} label={row.chip.label} className="shrink-0" />
                    ) : (
                      <ActionStatusChip status={a.status} className="shrink-0" />
                    )}
                    <span className="min-w-0 flex-1 truncate text-ink">{a.preview.title}</span>
                    <span className="shrink-0 text-ink-2" title={formatDate(at, datePrefs, "datetime")}>
                      {formatRelative(at, datePrefs)}
                    </span>
                  </Link>
                </li>
              );
            })}
          </ul>
        )}
      </section>

      <section aria-label={ACTIVITY_COPY.usage} className="flex flex-col gap-1">
        <h3 className="m-0 text-sm font-medium text-ink-2">{ACTIVITY_COPY.usage}</h3>
        <p className="m-0 text-base text-ink">{usageLine(data.usage.used, data.usage.cap, usageMonth(data.usage.month))}</p>
      </section>
    </div>
  );
}
