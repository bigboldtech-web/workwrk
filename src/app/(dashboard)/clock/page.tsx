"use client";

/* Clock in and out.
 *
 *  GET  /api/time-entries/punch                      the active punch and the week status
 *  POST /api/time-entries/punch { action, itemId? }  start or stop
 *  GET  /api/time-entries?mine=1&from=&to=           today, and this week
 *  GET  /api/timers/active                           a task timer, the other clock
 *
 * THE PAGE WORKS, AND IT IS NOW THE PAGE THE SPEC ASKS FOR. Stage A fixed
 * the two breaks (a punch POST with no body against a route that requires
 * an action, and a GET that did not exist). This is spec-planner section 4
 * step 4: the gradient hero, the 88px digits and the pulsing bar are gone,
 * the card is PunchCard with a task picker and a note, and "Recent
 * sessions" becomes the Today and This week cards on TableCard (audit C-6,
 * C-7).
 *
 * Every state the API can answer with is rendered rather than swallowed
 * (audit C-5): the 5 second minimum, the 16 hour auto-stop, and the three
 * week-status refusals. The week status is read BEFORE the click, so a
 * person whose week is submitted is told so rather than finding out from a
 * 409 (audit C-8).
 *
 * NO POLLER (spec-planner /clock Realtime). The elapsed time is a local
 * clock, not a fetch; the page refetches on `workwrk:timesheets-changed`
 * and on window focus, and the top bar pill and the sidebar Clock row are
 * fed by the shell's single GET /api/time/active.
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Square } from "lucide-react";
import { OsPageHeader } from "@/components/layout/os/page-header";
import { OsEmptyView } from "@/components/layout/os/empty-view";
import { TableCard } from "@/components/ui/table-card";
import { Dots } from "@/components/ui/dots";
import { useOsShell } from "@/components/layout/os/shell-context";
import { useOsToast } from "@/components/layout/os/toast";
import { useDatePrefs, useFormat } from "@/lib/format/use-date-prefs";
import { dayKey } from "@/lib/format/date";
import { apiFetch, apiFetchWithRetry } from "@/lib/api-fetch";
import { formatElapsed, formatHm, utcDayFromKey, utcDayKey } from "@/lib/time-format";
import { weekStartUTC } from "@/lib/timesheet-week";
import { shiftDayKey, weekDayKeys, type WeekStatus } from "@/lib/timesheet-grid";
import { PunchCard, type ActivePunch } from "@/components/planner/punch-card";
import type { PickerOption } from "@/components/ui/picker";

type PunchRead = {
  active: ActivePunch | null;
  week?: { id: string | null; status: WeekStatus; weekStartDate: string } | null;
};

type EntryRow = {
  id: string;
  day: string;
  minutes: number | null;
  description: string | null;
  source: string;
  startTime: string | null;
  endTime: string | null;
  itemTitle: string | null;
  itemId: string | null;
};

type TimerActive = { id: string; startedAt: string; title: string | null; url: string | null } | null;

type MyItem = { id: string; title: string; board?: { name?: string | null } | null };

/**
 * Did this session end on a different calendar day from the one it started?
 * Compared in the browser's own day boundaries, which is the day the two
 * times on the row are rendered in, so the label can never disagree with
 * the clock times beside it.
 */
function crossesMidnight(startIso: string | null, endIso: string | null): boolean {
  if (!startIso || !endIso) return false;
  const a = new Date(startIso);
  const b = new Date(endIso);
  if (Number.isNaN(a.getTime()) || Number.isNaN(b.getTime())) return false;
  return a.getFullYear() !== b.getFullYear() || a.getMonth() !== b.getMonth() || a.getDate() !== b.getDate();
}

export default function ClockPage() {
  const [punch, setPunch] = useState<PunchRead | null>(null);
  const [entries, setEntries] = useState<EntryRow[]>([]);
  const [entriesError, setEntriesError] = useState<string | null>(null);
  const [timer, setTimer] = useState<TimerActive>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [items, setItems] = useState<MyItem[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [now, setNow] = useState<number | null>(null);
  const { rowVersion } = useOsShell();
  const { toast } = useOsToast();
  const fmt = useFormat();
  const datePrefs = useDatePrefs();
  const router = useRouter();

  useEffect(() => {
    const tick = () => setNow(Date.now());
    tick();
    const i = setInterval(tick, 1000);
    return () => clearInterval(i);
  }, []);

  // TODAY IS THE VIEWER'S TODAY, NOT THE SERVER'S UTC DAY. This card used to
  // bucket on `utcDayKey(new Date())` while every time on every row rendered
  // in home.locale.timezone, so at 4am in New York it listed sessions
  // stamped 9:34 PM under a heading that said Today and printed a total no
  // single day can hold (audit T-7, TC-4). The punch route now stamps the
  // day in the same zone (src/lib/time-format.ts dayStartInZone), so the two
  // ends of the same fact finally agree.
  const todayKey = useMemo(() => dayKey(new Date(), datePrefs), [datePrefs]);
  const weekKey = useMemo(
    () => utcDayKey(weekStartUTC(utcDayFromKey(todayKey) ?? new Date())),
    [todayKey],
  );
  const weekHref = `/timesheets?week=${weekKey}`;

  const load = useCallback(async () => {
    // The whole week in one read: Today is a filter over it, so the two
    // cards can never disagree about a session that straddles midnight.
    const [p, e, t] = await Promise.all([
      apiFetch<PunchRead>("/api/time-entries/punch"),
      apiFetch<{ entries: EntryRow[] }>(
        `/api/time-entries?mine=1&from=${weekKey}&to=${shiftDayKey(weekKey, 6)}&limit=200`,
      ),
      apiFetch<{ active: TimerActive }>("/api/timers/active"),
    ]);

    // A failed read is never rendered as a healthy page: no zeros, no
    // "Clocked out" over an unknown state.
    if (!p.ok) { setLoadError(p.error); return; }
    setPunch(p.data);
    setLoadError(null);

    if (e.ok) { setEntries(e.data.entries ?? []); setEntriesError(null); }
    else { setEntries([]); setEntriesError(e.error); }

    setTimer(t.ok ? t.data.active : null);
  }, [weekKey]);

  // The load is wrapped rather than called directly, so the effect body
  // itself sets no state before its first await
  // (react-hooks/set-state-in-effect).
  useEffect(() => {
    const run = async () => { await load(); };
    void run();
  }, [load]);

  const v = rowVersion("timesheets");
  useEffect(() => {
    if (v === 0) return;
    const run = async () => { await load(); };
    void run();
  }, [v, load]);

  useEffect(() => {
    const refresh = () => { void load(); };
    window.addEventListener("focus", refresh);
    window.addEventListener("workwrk:timesheets-changed", refresh);
    return () => {
      window.removeEventListener("focus", refresh);
      window.removeEventListener("workwrk:timesheets-changed", refresh);
    };
  }, [load]);

  useEffect(() => {
    let alive = true;
    void (async () => {
      const r = await apiFetch<{ items?: MyItem[] }>("/api/me/items?status=open");
      if (!alive) return;
      setItems(r.ok ? (r.data.items ?? []) : []);
    })();
    return () => { alive = false; };
  }, []);

  const taskOptions = useMemo<PickerOption[]>(
    () => (items ?? []).slice(0, 200).map((i) => ({
      value: i.id,
      label: i.title,
      description: i.board?.name ?? undefined,
      keywords: i.board?.name ?? undefined,
    })),
    [items],
  );

  const active = punch?.active ?? null;
  const isClockedIn = Boolean(active?.clockedInAt);
  const elapsedMs = active?.clockedInAt && now !== null
    ? Math.max(0, now - new Date(active.clockedInAt).getTime())
    : 0;

  async function doPunch(action: "start" | "stop", opts?: { itemId: string | null; description: string }) {
    if (busy) return;
    setBusy(true);
    // keepalive: a punch begun as the tab closes still reaches the server.
    const r = await apiFetchWithRetry<{
      autoStopped?: boolean;
      weekStatus?: WeekStatus | null;
      closed?: { minutes?: number | null } | null;
    }>(
      "/api/time-entries/punch",
      {
        method: "POST",
        json: {
          action,
          ...(opts?.itemId ? { itemId: opts.itemId } : {}),
          ...(opts?.description ? { description: opts.description } : {}),
        },
        keepalive: true,
      },
      { attempts: 2, retryWrites: false },
    );
    setBusy(false);

    if (!r.ok) {
      // The API's own message, verbatim, with a real Retry. Never a bare
      // "Punch failed" over a message that says what to do.
      toast(r.error, { tone: "danger", action: { label: "Try again", onClick: () => { void doPunch(action, opts); } } });
      void load();
      return;
    }

    const openWeek = { label: "Open timesheet", onClick: () => { router.push(weekHref); } };
    if (action === "stop" && r.data.autoStopped) {
      toast("This clock had been running over 16 hours, so it was stopped at 16 hours. Check the entry in Timesheets.", {
        tone: "danger",
        action: openWeek,
      });
    } else if (action === "stop" && (r.data.weekStatus === "SUBMITTED" || r.data.weekStatus === "APPROVED")) {
      // The clock started while the week was open and the week closed under
      // it. The hours are kept (they were worked) and the approver has been
      // told, so say both rather than letting a total change in silence.
      toast(
        `Clocked out. This week was ${r.data.weekStatus === "APPROVED" ? "already approved" : "already submitted"}, so your approver has been told the hours changed.`,
        { tone: "danger", action: openWeek },
      );
    } else {
      // THE NUMBER THE SERVER WROTE, not the one the page was counting. The
      // local clock rounds down to whole minutes, so a 20 second punch
      // toasted "0:00 logged" over a row that reads 0:01: the toast and the
      // row it created disagreed about the same entry. `closed.minutes` is
      // the entry's own stored duration.
      const loggedMinutes = r.data.closed?.minutes;
      toast(
        action === "stop"
          ? `Clocked out. ${formatHm(typeof loggedMinutes === "number" ? loggedMinutes : Math.floor(elapsedMs / 60_000))} logged to this week.`
          : "Clocked in",
        { action: openWeek },
      );
    }
    void load();
    // The Planner sidebar's Clock row and the top bar pill both read
    // GET /api/time/active and refresh on this event.
    window.dispatchEvent(new CustomEvent("workwrk:timesheets-changed"));
  }

  async function stopTimer() {
    const r = await apiFetch("/api/timers/stop", { method: "POST", json: {} });
    if (!r.ok) { toast(`Couldn't stop the timer: ${r.error}`, { tone: "danger" }); return; }
    toast("Timer stopped");
    void load();
  }

  // ── Today, and this week ─────────────────────────────────────────

  const todayRows = useMemo(
    () => entries
      .filter((e) => String(e.day ?? "").slice(0, 10) === todayKey)
      // THE RUNNING PUNCH IS THE FIRST ROW. The list arrives ordered by the
      // stored day, so a clock started this morning sat fifth, under four
      // manual rows, and the one live thing on the page was the hardest row
      // to find. Everything else keeps the order it came in.
      .slice()
      .sort((a, b) => {
        const ra = a.startTime && !a.endTime ? 0 : 1;
        const rb = b.startTime && !b.endTime ? 0 : 1;
        return ra - rb;
      }),
    [entries, todayKey],
  );
  const todayMinutes = todayRows.reduce((a, e) => a + (e.minutes ?? 0), 0)
    + (isClockedIn ? Math.floor(elapsedMs / 60_000) : 0);

  const weekDays = useMemo(() => {
    const byDay = new Map<string, number>();
    for (const e of entries) {
      const k = String(e.day ?? "").slice(0, 10);
      byDay.set(k, (byDay.get(k) ?? 0) + (e.minutes ?? 0));
    }
    return weekDayKeys(weekKey).map((key) => ({ key, minutes: byDay.get(key) ?? 0 }));
  }, [entries, weekKey]);
  const weekMinutes = weekDays.reduce((a, d) => a + d.minutes, 0)
    + (isClockedIn ? Math.floor(elapsedMs / 60_000) : 0);

  return (
    <>
      <OsPageHeader
        // One label per destination: the Planner sidebar row, the breadcrumb
        // and the tab title all say "Clock in/out".
        title="Clock in/out"
      />

      <div className="mx-auto w-full max-w-[640px] px-6 py-6">
        {loadError ? (
          <OsEmptyView
            variant="error"
            title="Couldn't load your clock"
            hint={loadError}
            action={{ label: "Try again", onClick: () => { setLoadError(null); void load(); } }}
          />
        ) : (
          <>
            <PunchCard
              active={punch === null ? undefined : active}
              weekStatus={punch?.week?.status ?? null}
              weekHref={weekHref}
              busy={busy}
              taskOptions={taskOptions}
              onStart={(opts) => { void doPunch("start", opts); }}
              onStop={() => { void doPunch("stop"); }}
              timerRow={timer ? (
                /* The other clock. Two time models meet on one page (C-4). */
                <div className="mt-4 flex items-center gap-2 border-t border-line-soft pt-3 text-base text-ink-2">
                  <Dots variant="live" />
                  <span className="min-w-0 flex-1 truncate">
                    Timer running{timer.title ? ` on ${timer.title}` : ""}
                    {now !== null ? ` · ${formatElapsed(now - new Date(timer.startedAt).getTime())}` : ""}
                  </span>
                  <button
                    type="button"
                    onClick={() => { void stopTimer(); }}
                    className="inline-flex h-7 shrink-0 items-center gap-1.5 rounded-md border border-line-strong px-2 text-sm font-medium text-ink-2 hover:bg-hover hover:text-ink"
                  >
                    <Square className="h-3 w-3" strokeWidth={1.5} aria-hidden /> Stop
                  </button>
                </div>
              ) : null}
            />

            <div className="mt-6 flex items-baseline justify-between">
              <h2 className="text-base font-semibold text-ink">Today</h2>
              <span className="tabular-nums text-base font-medium text-ink-2">{formatHm(todayMinutes)}</span>
            </div>
            {entriesError ? (
              <p className="mt-2 flex items-center gap-2 rounded-lg border border-danger-solid bg-danger-soft px-3 py-2 text-base text-ink">
                <span className="flex-1">Couldn&rsquo;t load today&rsquo;s sessions. {entriesError}</span>
                <button type="button" onClick={() => { void load(); }} className="h-7 rounded-md border border-line-strong px-2.5 text-sm font-medium text-ink hover:bg-hover">
                  Retry
                </button>
              </p>
            ) : (
              <div className="mt-2">
                <TableCard<EntryRow>
                  ariaLabel="Today's sessions"
                  rows={punch === null ? null : todayRows}
                  rowKey={(r) => r.id}
                  empty={<span>No time clocked today</span>}
                  footer={punch === null ? undefined : {
                    total: todayRows.length,
                    noun: "records",
                    from: todayRows.length ? 1 : 0,
                    to: todayRows.length,
                  }}
                  columns={[
                    {
                      key: "when",
                      label: "When",
                      title: true,
                      width: "minmax(160px,1fr)",
                      render: (r) => (
                        <span className="flex min-w-0 items-center gap-1.5">
                          {/* A live row wears the live indicator, not the
                              word "running" in body text (design-system 5:
                              Dots variants). */}
                          {r.startTime && !r.endTime ? <Dots variant="live" /> : null}
                          <span className="truncate">
                            {r.startTime ? fmt.date(r.startTime, "time") : "Manual"}
                            {r.endTime ? ` to ${fmt.date(r.endTime, "time")}` : ""}
                            {crossesMidnight(r.startTime, r.endTime) ? (
                              <span className="text-ink-3"> (ends {fmt.date(r.endTime!, "weekday")})</span>
                            ) : null}
                          </span>
                        </span>
                      ),
                    },
                    {
                      key: "what",
                      label: "What",
                      width: "minmax(180px,1.4fr)",
                      render: (r) => (r.itemId && r.itemTitle ? (
                        <Link href={`/item/${r.itemId}`} className="truncate text-ink hover:underline">{r.itemTitle}</Link>
                      ) : (
                        <span className="truncate text-ink-2">{r.itemTitle ?? r.description ?? "Time entry"}</span>
                      )),
                    },
                    {
                      key: "dur",
                      label: "Length",
                      numeric: true,
                      width: "100px",
                      render: (r) => (r.endTime === null && r.startTime
                        ? formatHm(Math.floor(elapsedMs / 60_000))
                        : formatHm(r.minutes ?? 0)),
                    },
                  ]}
                />
              </div>
            )}

            <div className="mt-6 flex items-baseline justify-between">
              <h2 className="text-base font-semibold text-ink">This week</h2>
              <span className="tabular-nums text-base font-medium text-ink-2">{formatHm(weekMinutes)}</span>
            </div>
            <div className="mt-2">
              <TableCard<{ key: string; minutes: number }>
                ariaLabel="This week"
                rows={punch === null ? null : weekDays}
                rowKey={(r) => r.key}
                footer={punch === null ? undefined : {
                  total: weekDays.length,
                  noun: "records",
                  from: weekDays.length ? 1 : 0,
                  to: weekDays.length,
                }}
                // Every day reaches the week it belongs to, opened on that
                // week, rather than one link under the whole card.
                rowMenu={(r) => (
                  <Link
                    href={`/timesheets?week=${weekKey}#${r.key}`}
                    onClick={(e) => e.stopPropagation()}
                    className="inline-flex h-7 items-center rounded-md px-2 text-sm font-medium text-ink-2 hover:bg-hover hover:text-ink"
                  >
                    Open
                  </Link>
                )}
                columns={[
                  {
                    key: "day",
                    label: "Day",
                    title: true,
                    width: "minmax(160px,1fr)",
                    // Midday UTC: the stored key read as the calendar day it
                    // is, never shifted by the viewer's zone.
                    render: (r) => `${fmt.date(`${r.key}T12:00:00.000Z`, "weekday")} ${fmt.date(`${r.key}T12:00:00.000Z`, "date")}`,
                  },
                  {
                    key: "mins",
                    label: "Clocked",
                    numeric: true,
                    width: "110px",
                    render: (r) => (r.minutes > 0 ? formatHm(r.minutes) : ""),
                  },
                ]}
              />
            </div>
            <p className="mt-2">
              <Link href={weekHref} className="text-base text-brand hover:underline">Open this week in Timesheets</Link>
            </p>

            {/* The guardrails are stated rather than met as a surprise (C-8). */}
            <p className="mt-6 text-base text-ink-3">
              Clock-ins shorter than 5 seconds are ignored. A clock-in still running after 16 hours is
              stopped at 16 hours and marked for you to check in Timesheets.
            </p>
          </>
        )}
      </div>
    </>
  );
}
