"use client";

// Effort card on the goal page (spec-goals /okrs/[id] body 4): automated,
// never self-reported. Hours logged · Tasks done · In progress · Last moved,
// then "Who's driving it" with real avatars (GET /api/okrs/[id]/effort reads
// every linked KRA, List and Space; src/lib/goal-effort.ts). Six people, then
// Show all. Empty points at Linked work. A failure says so with Retry.

import { useCallback, useEffect, useState } from "react";
import { Avatar } from "@/components/ui/avatar-stack";
import { useFormat } from "@/lib/format/use-date-prefs";

interface Effort {
  hasLinkedWork: boolean;
  totalHours: number;
  tasksDone: number;
  tasksOpen: number;
  lastActivityAt: string | null;
  contributors: { id: string; name: string; avatar: string | null; hours: number; tasks: number }[];
}

export function GoalEffort({ okrId, onLinkWork }: { okrId: string; onLinkWork?: () => void }) {
  const fmt = useFormat();
  const [data, setData] = useState<Effort | null>(null);
  const [err, setErr] = useState(false);
  const [all, setAll] = useState(false);
  const [tick, setTick] = useState(0);
  const retry = useCallback(() => { setErr(false); setData(null); setTick((n) => n + 1); }, []);
  useEffect(() => {
    let active = true;
    fetch(`/api/okrs/${okrId}/effort`, { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(String(r.status)))))
      .then((j) => { if (active) setData(j.data ?? j); })
      .catch(() => { if (active) setErr(true); });
    return () => { active = false; };
  }, [okrId, tick]);

  return (
    <section className="rounded-lg border border-line bg-raised p-6" aria-labelledby="goal-effort-h">
      <h2 id="goal-effort-h" className="m-0 text-base font-semibold text-ink">Effort</h2>
      {err ? (
        <p className="m-0 mt-3 text-sm text-ink-2">Couldn&apos;t load effort · <button type="button" onClick={retry} className="text-brand-deep hover:underline">Retry</button></p>
      ) : !data ? (
        <div className="mt-3 grid grid-cols-4 gap-4" aria-hidden>
          {[0, 1, 2, 3].map((i) => <span key={i} className="h-10 animate-pulse rounded bg-surface-2" />)}
        </div>
      ) : !data.hasLinkedWork ? (
        <p className="m-0 mt-3 text-sm text-ink-2">
          No linked work yet. Link a List, Space or KRA and effort fills in from that work.
          {onLinkWork ? <> <button type="button" onClick={onLinkWork} className="text-brand-deep hover:underline">Link work</button></> : null}
        </p>
      ) : (
        <>
          <dl className="m-0 mt-3 grid grid-cols-2 gap-4 sm:grid-cols-4">
            {[
              ["Hours logged", `${data.totalHours}h`],
              ["Tasks done", String(data.tasksDone)],
              ["In progress", String(data.tasksOpen)],
              ["Last moved", data.lastActivityAt ? fmt.relative(data.lastActivityAt) : "Never"],
            ].map(([k, v]) => (
              <div key={k} className="flex flex-col gap-0.5">
                <dt className="text-xs font-medium text-ink-2">{k}</dt>
                <dd className="m-0 text-title font-semibold tabular-nums text-ink">{v}</dd>
              </div>
            ))}
          </dl>
          {data.contributors.length ? (
            <>
              <h3 className="m-0 mt-5 text-sm font-medium text-ink-2">Who&apos;s driving it</h3>
              <ul className="m-0 mt-1 flex list-none flex-col p-0">
                {(all ? data.contributors : data.contributors.slice(0, 6)).map((c) => (
                  <li key={c.id} className="flex h-9 items-center gap-2 border-b border-line last:border-b-0">
                    <Avatar person={{ id: c.id, firstName: c.name, avatar: c.avatar }} size={24} />
                    <span className="min-w-0 flex-1 truncate text-row text-ink">{c.name}</span>
                    <span className="shrink-0 text-sm tabular-nums text-ink-2">{c.hours}h · {c.tasks} {c.tasks === 1 ? "task" : "tasks"}</span>
                  </li>
                ))}
              </ul>
              {!all && data.contributors.length > 6 ? (
                <button type="button" onClick={() => setAll(true)} className="mt-1 text-sm text-brand-deep hover:underline">Show all {data.contributors.length}</button>
              ) : null}
            </>
          ) : null}
        </>
      )}
    </section>
  );
}
