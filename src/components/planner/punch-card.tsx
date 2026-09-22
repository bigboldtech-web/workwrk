"use client";

// PunchCard (spec-planner.md section 3): the one card on /clock, and the
// one button on it.
//
// WHAT IT REPLACED. The old hero was a gradient panel with 88px digits and
// a pulsing bar, and its button posted an empty body to a route that
// requires an action, so it always failed. The state, the elapsed time and
// the one blue button are all that is left, on tokens.
//
// THE BUTTON IS NOT RENDERED UNTIL THE STATE IS KNOWN. A "Clock in" that
// flashes for a person who is already clocked in invites a click that
// answers "already running", so `active === undefined` renders the skeleton
// line instead of a guess.
//
// A WEEK THAT CANNOT TAKE HOURS SAYS SO BEFORE THE CLICK. The punch route
// answers 409 for a submitted, returned or approved week. That refusal is
// resolved here from the week status the same read already carries, so the
// button is replaced by the sentence and the link that fixes it, rather
// than rendered and then refused (access spec section 5.4).

import { useEffect, useState } from "react";
import Link from "next/link";
import { LogIn, LogOut } from "lucide-react";
import { Dots } from "@/components/ui/dots";
import { Picker, type PickerOption } from "@/components/ui/picker";
import { useFormat } from "@/lib/format/use-date-prefs";
import { formatElapsed } from "@/lib/time-format";
import { weekBlockReason, type WeekStatus } from "@/lib/timesheet-grid";

export interface ActivePunch {
  id: string;
  clockedInAt: string | null;
  description: string | null;
  itemId: string | null;
  itemTitle?: string | null;
}

export interface PunchCardProps {
  /** `undefined` while unknown, `null` when clocked out. */
  active: ActivePunch | null | undefined;
  weekStatus: WeekStatus | null;
  /** Deep link for the sentence a closed week shows instead of the button. */
  weekHref: string;
  busy?: boolean;
  onStart: (opts: { itemId: string | null; description: string }) => void;
  onStop: () => void;
  /** My open tasks, for the "what are you working on" picker. */
  taskOptions?: PickerOption[];
  /** The other clock, rendered under the button so both are in one place. */
  timerRow?: React.ReactNode;
}

export function PunchCard({
  active, weekStatus, weekHref, busy, onStart, onStop, taskOptions = [], timerRow,
}: PunchCardProps) {
  const fmt = useFormat();
  const [now, setNow] = useState<number | null>(null);
  const [itemId, setItemId] = useState<string | null>(null);
  const [note, setNote] = useState("");
  const [pickerOpen, setPickerOpen] = useState(false);

  // A clock, not a fetch: the elapsed time ticks locally from the known
  // start instant. Sampled in an effect, so nothing reads Date.now() during
  // render and the server and the first client paint agree.
  useEffect(() => {
    const tick = () => setNow(Date.now());
    tick();
    const i = setInterval(tick, 1000);
    return () => clearInterval(i);
  }, []);

  const clockedIn = Boolean(active?.clockedInAt);
  const blocked = clockedIn ? null : weekBlockReason(weekStatus);
  const chosen = taskOptions.find((o) => o.value === itemId) ?? null;
  const elapsedMs = active?.clockedInAt && now !== null
    ? Math.max(0, now - new Date(active.clockedInAt).getTime())
    : 0;

  return (
    <section className="rounded-lg border border-line bg-raised p-6">
      <div className="flex flex-wrap items-center gap-2">
        <span
          className="inline-flex h-6 items-center gap-1.5 rounded-md border px-2 text-sm font-medium"
          style={clockedIn
            ? {
                color: "var(--os-success-solid)",
                borderColor: "color-mix(in srgb, var(--os-success-solid) 32%, transparent)",
                background: "color-mix(in srgb, var(--os-success-solid) 12%, var(--os-surface))",
              }
            : {
                color: "var(--os-ink-2)",
                borderColor: "var(--os-line-strong)",
                background: "var(--os-surface-2)",
              }}
        >
          {clockedIn ? <Dots variant="live" /> : null}
          {active === undefined ? "Reading your clock" : clockedIn ? "Clocked in" : "Clocked out"}
        </span>
        {clockedIn && active?.clockedInAt ? (
          <span className="text-base text-ink-2">since {fmt.date(active.clockedInAt, "time")}</span>
        ) : null}
        {clockedIn && active?.itemTitle ? (
          <span className="truncate text-base text-ink-2">on {active.itemTitle}</span>
        ) : null}
      </div>

      <div className="mt-3 tabular-nums text-2xl font-semibold text-ink">
        {active === undefined
          ? <span className="inline-block h-7 w-28 rounded bg-subtle align-middle" />
          : clockedIn
            ? formatElapsed(elapsedMs)
            : now === null ? "" : fmt.date(new Date(now), "time")}
      </div>
      {/* spec-planner section 2 /clock: the 22/600 time, then the DATE 13/400
          beneath it. The caption that used to sit here ("current time",
          "elapsed this session") repeated what the chip above and the digits
          themselves already say, and left the card with no statement of
          which day the punch is being filed under. */}
      <p className="text-base text-ink-3">
        {active === undefined || now === null
          ? ""
          : clockedIn && active?.clockedInAt
            ? `${fmt.date(active.clockedInAt, "weekday")} ${fmt.date(active.clockedInAt, "date")}`
            : `${fmt.date(new Date(now), "weekday")} ${fmt.date(new Date(now), "date")}`}
      </p>

      {/* What am I working on: only offered when clocking IN. Changing it
          mid-punch would rewrite an hour already being counted, which is a
          timesheet edit and belongs on the timesheet. */}
      {active === null && !blocked ? (
        <div className="relative mt-4 flex flex-wrap items-end gap-2">
          <label className="flex flex-col gap-0.5 text-sm text-ink-2">
            What are you working on?
            <button
              type="button"
              onClick={() => setPickerOpen((o) => !o)}
              className="h-9 w-[240px] truncate rounded-md border border-line-strong bg-app px-2 text-start text-base text-ink hover:bg-hover"
            >
              {chosen ? chosen.label : "No task"}
            </button>
          </label>
          <input
            type="text"
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder="Optional note"
            aria-label="Note for this session"
            className="h-9 min-w-[180px] flex-1 rounded-md border border-line-strong bg-app px-2 text-base text-ink outline-none placeholder:text-ink-3 focus:shadow-[0_0_0_3px_var(--os-focus-halo)]"
          />
          <Picker
            open={pickerOpen}
            onClose={() => setPickerOpen(false)}
            ariaLabel="Task for this session"
            searchPlaceholder="Search my tasks"
            selected={itemId}
            sections={[{ options: [{ value: "", label: "No task" }, ...taskOptions] }]}
            onSelect={(v) => { setItemId(v || null); setPickerOpen(false); }}
            emptyLabel="No open tasks assigned to you"
          />
        </div>
      ) : null}

      <div className="mt-4">
        {active === undefined ? null : blocked ? (
          <p className="text-base text-ink-2">
            {blocked}{" "}
            <Link href={weekHref} className="text-brand hover:underline">Open Timesheets</Link>
          </p>
        ) : (
          <button
            type="button"
            disabled={busy}
            onClick={() => {
              if (clockedIn) onStop();
              else onStart({ itemId, description: note.trim() });
            }}
            className="inline-flex h-9 w-full items-center justify-center gap-2 rounded-md bg-brand px-4 text-base font-medium text-white hover:bg-brand-hover disabled:opacity-60 sm:w-auto"
          >
            {busy ? <Dots variant="pending" /> : clockedIn
              ? <LogOut className="h-4 w-4" strokeWidth={1.5} aria-hidden />
              : <LogIn className="h-4 w-4" strokeWidth={1.5} aria-hidden />}
            {clockedIn ? "Clock out" : "Clock in"}
          </button>
        )}
      </div>

      {timerRow}
    </section>
  );
}
