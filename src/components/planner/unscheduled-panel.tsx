"use client";

// UnscheduledPanel: the Calendar's optional right panel (spec-planner.md
// section 2 `/planner`, body item 4).
//
// WHAT IT REPLACES. `PlannerSidePanel` had three collapsible buckets
// (Assigned to me / Today and overdue / Backlog) all derived from one
// `GET /api/me/work` call, beside an "Add priority" button that had no
// handler at all and a "Meet with" list that wrote a personal task titled
// "Meet with X". The two task buckets that duplicate My work are gone,
// because a task list belongs in Work and not beside a calendar; the
// BACKLOG bucket is the one that earned its place here, because a task with
// no date is exactly what a person opens a calendar to give a date to. So
// this is the Backlog bucket, renamed to what it is, and nothing else.
//
// It is OFF by default (`home.planner.showUnscheduled`), so the calendar is
// a calendar until somebody asks for the list.

import { useCallback, useEffect, useState } from "react";
import { apiFetch } from "@/lib/api-fetch";
import { Dots } from "@/components/ui/dots";
import type { MyWorkRow } from "@/lib/my-work";

const PAGE = 20;

export function UnscheduledPanel({ onOpen }: { onOpen: (itemId: string) => void }) {
  const [rows, setRows] = useState<MyWorkRow[] | null>(null);
  const [failed, setFailed] = useState(false);
  const [shown, setShown] = useState(PAGE);

  const load = useCallback(async () => {
    // `group=due` makes the server bucket every row in the VIEWER'S zone, so
    // "has no date" is the server's answer and not a client guess about what
    // a null means.
    const r = await apiFetch<{ rows: MyWorkRow[] }>("/api/me/work?group=due&sort=due&limit=100&done=0");
    if (!r.ok) { setFailed(true); return; }
    setFailed(false);
    setRows((r.data.rows ?? []).filter((row) => row.dueBucket === "none"));
  }, []);

  useEffect(() => {
    const run = async () => { await load(); };
    void run();
    const onChanged = () => { void load(); };
    window.addEventListener("workwrk:items-changed", onChanged);
    return () => window.removeEventListener("workwrk:items-changed", onChanged);
  }, [load]);

  return (
    <aside className="pln-unsched" aria-label="Unscheduled tasks">
      <header>
        <h2>Unscheduled</h2>
        {rows ? <span className="pln-unsched__count">{rows.length}</span> : null}
      </header>

      {failed ? (
        <p className="pln-unsched__row is-bad">
          Couldn&rsquo;t load them.{" "}
          <button type="button" onClick={() => { void load(); }}>Retry</button>
        </p>
      ) : !rows ? (
        <p className="pln-unsched__row"><Dots variant="pending" /> Reading your tasks</p>
      ) : rows.length === 0 ? (
        <p className="pln-unsched__row is-quiet">Nothing unscheduled</p>
      ) : (
        <>
          <ul>
            {rows.slice(0, shown).map((row) => (
              <li key={row.id}>
                <button
                  type="button"
                  className="pln-unsched__task"
                  onClick={() => onOpen(row.id)}
                  title={row.title}
                >
                  {row.statusColor ? (
                    <i style={{ background: row.statusColor }} aria-hidden />
                  ) : <i aria-hidden />}
                  <span>{row.title}</span>
                </button>
              </li>
            ))}
          </ul>
          {rows.length > shown ? (
            <button type="button" className="pln-unsched__more" onClick={() => setShown((n) => n + PAGE)}>
              Show {Math.min(PAGE, rows.length - shown)} more
            </button>
          ) : null}
        </>
      )}
    </aside>
  );
}
