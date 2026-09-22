"use client";

// TimesheetWeekCard (spec-planner.md section 3): the seven day columns a
// person actually types their week into, and the same seven rendered read
// only inside the Timesheet drawer.
//
// ONE COMPONENT, TWO MODES. The drawer used to render its own stacked list
// of a week, which is how the page and the drawer came to disagree about
// what a day total was. `editable={false}` is the drawer's mode: the same
// grid, the same totals, no add rows and no delete.
//
// WHAT IT REFUSES TO DO. It never decides whether hours may be added: the
// page passes `editable`, resolved from src/lib/timesheet-grid.ts's
// weekAcceptsHours, which answers the same three refusals POST
// /api/time-entries would. A control the API would refuse is not rendered
// (access spec section 5.4), so there is no disabled add row anywhere here.
//
// THE DAY KEY NEVER BECOMES A LOCAL DATE. Every column is keyed by the
// stored "YYYY-MM-DD" and labelled by handing MIDDAY UTC to the one
// formatter, so no zone on earth shifts a Tuesday's hours under Monday's
// heading. src/lib/timesheet-grid.ts carries the rule.

import { useRef, useState } from "react";
import Link from "next/link";
import { Plus, Trash2 } from "lucide-react";
import { Dots } from "@/components/ui/dots";
import { HoursInput } from "@/components/ui/hours-input";
import { Picker, type PickerOption } from "@/components/ui/picker";
import { useFormat } from "@/lib/format/use-date-prefs";
import { dayKey } from "@/lib/format/date";
import { formatHm } from "@/lib/time-format";
import type { WorkSchedule } from "@/lib/work-schedule";
import {
  buildWeekGrid,
  entryMinutes,
  entrySourceLabel,
  isRunningPunch,
  type DayKey,
  weekBlockReason,
  type GridEntry,
  type WeekStatus,
} from "@/lib/timesheet-grid";

export interface NewEntry {
  dayKey: DayKey;
  minutes: number;
  description: string;
  itemId: string | null;
  billable: boolean;
  tags: string[];
}

export interface TimesheetWeekCardProps {
  weekStartKey: DayKey;
  status: WeekStatus | null;
  entries: GridEntry[] | null;
  /** DRAFT and mine: the add rows and the row ✕ render. */
  editable: boolean;
  /** Hours the organization expects of this week, from the work schedule. */
  expectedHours?: number | null;
  /**
   * The organization's working calendar. A non-working day is tinted and a
   * holiday is NAMED: a week that is 30 hours rather than 37.5 because of
   * Founders Day should say so on the day, not just in the total.
   */
  schedule?: WorkSchedule;
  showNotes?: boolean;
  showSource?: boolean;
  /** Open tasks for the row picker. Empty is fine: "No task" is always first. */
  taskOptions?: PickerOption[];
  onAdd?: (entry: NewEntry) => Promise<boolean>;
  onDelete?: (entryId: string) => void;
  /**
   * Inline edit of an existing row (PATCH /api/time-entries/[id]). Absent on
   * a week that cannot take changes, so the row is plain text there rather
   * than a control that would be refused.
   */
  onEdit?: (entryId: string, patch: { hours?: number; description?: string }) => Promise<boolean>;
  /**
   * Seven columns, or seven stacked sections.
   *
   * The drawer is 520px wide. Seven columns inside it left each one about
   * 60px, which truncated every task title to a single letter ("s.", "T.",
   * "a.") and made the week unreadable for the one person whose job is to
   * read it. The page keeps the columns; the drawer stacks.
   */
  layout?: "columns" | "stacked";
  /** A header slot: the status chip, the total and the state action. */
  header?: React.ReactNode;
  /** Under the header: the rejection banner or the submitted line. */
  banner?: React.ReactNode;
}

/** "YYYY-MM-DD" read as the calendar day it IS. Midday UTC, so no zone moves it. */
function dayLabel(key: DayKey, fmt: ReturnType<typeof useFormat>, style: "weekday" | "date"): string {
  return fmt.date(`${key}T12:00:00.000Z`, style);
}

/**
 * Is this stored day a working one, and what holiday is on it?
 *
 * Read in UTC, because the key IS a UTC calendar date. Handing the key to
 * isWorkingDay through a local Date would ask about the wrong day for
 * everyone west of UTC, which is the same trap the labels avoid.
 */
function scheduleFor(schedule: WorkSchedule | undefined, key: DayKey): { off: boolean; holiday: string | null } {
  if (!schedule) return { off: false, holiday: null };
  const d = new Date(`${key}T00:00:00.000Z`);
  if (Number.isNaN(d.getTime())) return { off: false, holiday: null };
  const holiday = schedule.holidays.find((h) => h.date === key) ?? null;
  const weekdayOff = schedule.workdays.length > 0 && !schedule.workdays.includes(d.getUTCDay() as 0 | 1 | 2 | 3 | 4 | 5 | 6);
  return { off: weekdayOff || Boolean(holiday), holiday: holiday?.name ?? null };
}

export function TimesheetWeekCard({
  weekStartKey,
  status,
  entries,
  editable,
  expectedHours,
  schedule,
  layout = "columns",
  showNotes = true,
  showSource = true,
  taskOptions = [],
  onAdd,
  onDelete,
  onEdit,
  header,
  banner,
}: TimesheetWeekCardProps) {
  const fmt = useFormat();
  const [addingOn, setAddingOn] = useState<DayKey | null>(null);
  const cols = layout === "columns";

  if (entries === null) {
    return (
      <div className="rounded-lg border border-line bg-raised">
        <div className="flex h-11 items-center gap-3 border-b border-line-soft px-3">{header}</div>
        <div className={cols ? "grid grid-cols-1 min-[900px]:grid-cols-7" : "grid grid-cols-1"}>
          {Array.from({ length: 7 }, (_, i) => (
            <div key={i} className="border-b border-line-soft p-2 last:border-b-0">
              <div className="h-4 w-16 rounded bg-subtle" />
              <div className="mt-2 h-4 w-full rounded bg-subtle" />
            </div>
          ))}
        </div>
        <span className="sr-only">Loading this week</span>
      </div>
    );
  }

  const grid = buildWeekGrid(weekStartKey, entries);
  const groups = [...grid.days, ...grid.strays];
  // Today, in the VIEWER'S zone, which is the zone the punch route now
  // stamps a day in (src/lib/time-format.ts dayStartInZone). Reading it off
  // the machine's UTC clock put "Add time on today" on tomorrow's column for
  // everyone west of UTC after 19:00.
  const todayKey = dayKey(new Date(), fmt.prefs);
  const blockedReason = weekBlockReason(status);

  return (
    <div className="rounded-lg border border-line bg-raised">
      <div className="flex min-h-11 flex-wrap items-center gap-3 border-b border-line-soft px-3 py-1.5">
        {header}
      </div>
      {banner}

      <div className={cols ? "grid grid-cols-1 min-[900px]:grid-cols-7" : "grid grid-cols-1"}>
        {groups.map((day) => {
          const { off, holiday } = scheduleFor(schedule, day.key);
          const stray = !grid.days.some((d) => d.key === day.key);
          const isToday = day.key === todayKey;
          return (
            <div
              key={day.key}
              id={day.key}
              className={[
                "min-w-0 border-b border-line-soft last:border-b-0",
                cols ? "min-[900px]:border-b-0 min-[900px]:border-e min-[900px]:last:border-e-0" : "",
              ].join(" ")}
              // THE NON-WORKING TINT HAS TO READ IN BOTH THEMES. `bg-subtle`
              // is N50 in light, which works, and in dark it is DARKER than
              // the card it sits on by three values, which is invisible.
              // Mixing the ink token instead lifts a dark column and shades a
              // light one, so one rule says "this day is off" in both.
              style={off ? { background: "color-mix(in srgb, var(--os-ink-3) 14%, transparent)" } : undefined}
            >
              <div className="flex items-baseline justify-between gap-2 px-2 py-1.5">
                <span className="truncate text-sm font-medium text-ink-2">
                  {dayLabel(day.key, fmt, "weekday")}
                  {/* Today's date wears the brand pill, so the week has a
                      visual anchor for now (spec-planner section 2). */}
                  <span
                    className={isToday
                      ? "ms-1 rounded-md bg-brand px-1.5 py-0.5 text-white"
                      : "ms-1 text-ink-3"}
                  >
                    {dayLabel(day.key, fmt, "date")}
                  </span>
                </span>
                <span className="shrink-0 tabular-nums text-sm font-semibold text-ink-2">
                  {day.minutes > 0 ? formatHm(day.minutes) : ""}
                </span>
              </div>
              {holiday ? <p className="truncate px-2 pb-1 text-xs text-ink-3">{holiday}</p> : null}
              {stray ? (
                <p className="px-2 pb-1 text-xs text-ink-3">Outside this week</p>
              ) : null}

              <ul className="px-1 pb-1">
                {day.entries.map((e) => (
                  <EntryRow
                    key={e.id}
                    entry={e}
                    showNotes={showNotes}
                    showSource={showSource}
                    onDelete={editable && onDelete ? () => onDelete(e.id) : undefined}
                    onEdit={editable && onEdit ? (patch) => onEdit(e.id, patch) : undefined}
                  />
                ))}

                {editable && onAdd ? (
                  <li>
                    {addingOn === day.key ? (
                      <AddRow
                        dayKey={day.key}
                        taskOptions={taskOptions}
                        onAdd={onAdd}
                        onDone={() => setAddingOn(null)}
                      />
                    ) : (
                      <button
                        type="button"
                        onClick={() => setAddingOn(day.key)}
                        // The Log time button and `?add=today` reach the add
                        // row through these two hooks rather than through a
                        // second copy of the open state living on the page.
                        data-day={day.key}
                        data-ts-add-today={day.key === todayKey ? "" : undefined}
                        data-ts-add-first={day.key === grid.days[0]?.key ? "" : undefined}
                        className="flex h-8 w-full items-center gap-1.5 rounded-md px-1.5 text-start text-base text-ink-3 hover:bg-hover hover:text-ink-2"
                      >
                        <Plus className="h-3.5 w-3.5 shrink-0" strokeWidth={1.5} aria-hidden />
                        Add time
                      </button>
                    )}
                  </li>
                ) : null}
              </ul>
            </div>
          );
        })}
      </div>

      <div className="flex flex-wrap items-center justify-between gap-2 border-t border-line-soft px-3 py-2">
        <span className="text-base text-ink-2">
          {/* The refusal the API would give, resolved before anybody reaches
              for an add row that is not there. */}
          {!editable && blockedReason
            ? blockedReason
            : grid.totalMinutes === 0
              ? "No hours logged this week"
              : `${grid.days.filter((d) => d.minutes > 0).length} days logged`}
        </span>
        <span className="tabular-nums text-base font-medium text-ink">
          {formatHm(grid.totalMinutes)}
          {expectedHours ? <span className="text-ink-3"> / {fmtExpected(expectedHours)}</span> : null}
        </span>
      </div>
    </div>
  );
}

/**
 * The week's target, in the ONE format this unit prints hours in.
 *
 * spec-planner section 1 Naming canon: "Hours render as h:mm everywhere in
 * this unit ... '1:30', never '1.5h' or '90m' in display." The target used
 * to be printed as decimal hours with an "h" suffix, so the week card header
 * read "39:11 / 30h" and a half-day schedule would have read "37:30 / 37.5h":
 * two formats for the same quantity, side by side on one line.
 */
export function fmtExpected(hours: number): string {
  return formatHm(Math.round(hours * 60));
}

function EntryRow({
  entry, showNotes, showSource, onDelete, onEdit,
}: {
  entry: GridEntry;
  showNotes: boolean;
  showSource: boolean;
  onDelete?: () => void;
  onEdit?: (patch: { hours?: number; description?: string }) => Promise<boolean>;
}) {
  const running = isRunningPunch(entry);
  const title = entry.item?.title ?? entry.task?.title ?? entry.description ?? "Time entry";
  const minutes = entryMinutes(entry);
  // ONE CLICK USED TO DELETE AN HOUR FOR EVER. DELETE /api/time-entries/[id]
  // is a permanent row delete with no Trash and no undo, and the hover cross
  // fired it straight through; the manager this page replaced wrapped the
  // same action in a confirm dialog. spec-planner section 2 asks for the
  // inline confirm rather than a modal, so the row becomes the question.
  const [confirming, setConfirming] = useState(false);
  const [editing, setEditing] = useState<null | "hours" | "title">(null);
  const [draftMinutes, setDraftMinutes] = useState<number | null>(minutes);
  const [draftNote, setDraftNote] = useState(entry.description ?? "");
  const [saving, setSaving] = useState(false);

  // One ordered list, so the dots fall between the parts that are actually
  // there rather than leaving a leading or a doubled separator.
  const metaParts: string[] = [];
  if (showSource) metaParts.push(entrySourceLabel(entry.source));
  if (entry.billable) metaParts.push("Billable");
  if (showNotes && entry.description && entry.item) metaParts.push(entry.description);
  if (entry.tags?.length) metaParts.push(entry.tags.join(", "));
  const metaLine = metaParts.join(" · ");

  async function commit(patch: { hours?: number; description?: string }) {
    if (!onEdit) return;
    setSaving(true);
    const ok = await onEdit(patch);
    setSaving(false);
    if (ok) setEditing(null);
  }

  if (confirming) {
    return (
      <li className="flex min-h-8 flex-wrap items-center gap-1.5 rounded-md bg-danger-soft px-1.5 py-1">
        <span className="min-w-0 flex-1 truncate text-base text-ink" title={title}>
          Remove {formatHm(minutes)}?
        </span>
        <button
          type="button"
          onClick={() => { setConfirming(false); onDelete?.(); }}
          className="h-7 shrink-0 rounded-md px-2 text-sm font-medium text-danger-solid hover:bg-danger-soft"
        >
          Remove
        </button>
        <button
          type="button"
          autoFocus
          onClick={() => setConfirming(false)}
          className="h-7 shrink-0 rounded-md px-2 text-sm font-medium text-ink-2 hover:bg-hover hover:text-ink"
        >
          Keep
        </button>
      </li>
    );
  }

  return (
    <li className="group flex min-h-8 items-center gap-1.5 rounded-md px-1.5 py-1 hover:bg-hover">
      <div className="min-w-0 flex-1">
        <div className="flex min-w-0 items-center gap-1.5">
          {running ? <Dots variant="live" /> : null}
          {/* EVERY TITLE CAN BE READ. A day column is about 150px wide, so a
              real task title is clipped to a few characters; `title` gives
              the whole string on hover and to a screen reader, which is the
              only way this grid says what the hours were spent on. */}
          {editing === "title" ? (
            <input
              type="text"
              autoFocus
              value={draftNote}
              onChange={(e) => setDraftNote(e.target.value)}
              onBlur={() => { void commit({ description: draftNote.trim() }); }}
              onKeyDown={(e) => {
                if (e.key === "Enter") { e.preventDefault(); void commit({ description: draftNote.trim() }); }
                if (e.key === "Escape") { e.stopPropagation(); setDraftNote(entry.description ?? ""); setEditing(null); }
              }}
              aria-label="Entry note"
              className="h-7 w-full min-w-0 rounded-md border border-line-strong bg-raised px-1.5 text-base text-ink outline-none focus:shadow-[0_0_0_3px_var(--os-focus-halo)]"
            />
          ) : entry.item ? (
            /* The task drawer over this page, not a full navigation: the
               (dashboard) layout mounts the @drawer slot, so /item/<id>
               renders the intercepted drawer and closing comes back here
               with the week intact. */
            <Link href={`/item/${entry.item.id}`} title={title} className="truncate text-base text-ink hover:underline">
              {title}
            </Link>
          ) : onEdit && !running ? (
            <button
              type="button"
              title={`${title} (click to edit)`}
              onClick={() => { setDraftNote(entry.description ?? ""); setEditing("title"); }}
              className="min-w-0 truncate text-start text-base text-ink hover:underline"
            >
              {title}
            </button>
          ) : (
            <span className="truncate text-base text-ink" title={title}>{title}</span>
          )}
        </div>
        {/* ONE LINE, PARTS SEPARATED BY A MIDDLE DOT, ALWAYS TRUNCATED.
            spec-planner section 2 writes the meta inline after the title
            ("Fix invoice PDF · From timer"); it stays on its own line here
            because a day column is about 150px wide and putting both on one
            line leaves the task title roughly four characters, which is the
            one thing the row exists to say. What is adopted is the spec's
            separator and its single line: as four independent spans the
            source and the Billable chip ran past the column and were clipped
            mid-word under the hours value. */}
        {metaLine ? (
          <div className="truncate text-xs text-ink-3" title={metaLine}>{metaLine}</div>
        ) : null}
      </div>
      {/* Clicking the hours edits them in place (DRAFT weeks only, and never
          a running punch, which the API refuses too): fixing a typo used to
          mean deleting the row and typing it again. */}
      {editing === "hours" ? (
        <HoursInput
          initialMinutes={minutes}
          onChange={setDraftMinutes}
          onSubmit={() => { if (draftMinutes) void commit({ hours: draftMinutes / 60 }); }}
          autoFocus
          disabled={saving}
          label="Hours for this entry"
          className="shrink-0"
        />
      ) : running ? (
        <span className="shrink-0 tabular-nums text-base text-ink-2">running</span>
      ) : onEdit ? (
        <button
          type="button"
          title="Edit these hours"
          onClick={() => { setDraftMinutes(minutes); setEditing("hours"); }}
          className="shrink-0 rounded-md px-1 tabular-nums text-base text-ink-2 hover:bg-hover hover:text-ink"
        >
          {formatHm(minutes)}
        </button>
      ) : (
        <span className="shrink-0 tabular-nums text-base text-ink-2">{formatHm(minutes)}</span>
      )}
      {editing === "hours" ? (
        <button
          type="button"
          onClick={() => { if (draftMinutes) void commit({ hours: draftMinutes / 60 }); }}
          disabled={!draftMinutes || saving}
          className="h-7 shrink-0 rounded-md border border-line-strong px-2 text-sm font-medium text-ink hover:bg-hover disabled:opacity-40"
        >
          {saving ? <Dots variant="pending" /> : "Save"}
        </button>
      ) : null}
      {onDelete && editing === null ? (
        <button
          type="button"
          aria-label={`Remove ${title}`}
          onClick={() => setConfirming(true)}
          className="inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-md text-ink-3 opacity-0 hover:bg-hover hover:text-danger-solid focus-visible:opacity-100 group-hover:opacity-100"
        >
          <Trash2 className="h-3.5 w-3.5" strokeWidth={1.5} aria-hidden />
        </button>
      ) : null}
    </li>
  );
}

/**
 * The add row: hours, a note, an optional task, a billable flag.
 *
 * Enter saves, Esc cancels. A save that fails leaves everything typed
 * exactly where it is, because the page keeps the failure on screen with a
 * Retry rather than clearing the row on a toast that fades.
 */
function AddRow({
  dayKey, taskOptions, onAdd, onDone,
}: {
  dayKey: DayKey;
  taskOptions: PickerOption[];
  onAdd: (entry: NewEntry) => Promise<boolean>;
  onDone: () => void;
}) {
  const [minutes, setMinutes] = useState<number | null>(null);
  const [note, setNote] = useState("");
  const [itemId, setItemId] = useState<string | null>(null);
  const [billable, setBillable] = useState(false);
  const [tagText, setTagText] = useState("");
  const [saving, setSaving] = useState(false);
  const [pickerOpen, setPickerOpen] = useState(false);
  const pickerTriggerRef = useRef<HTMLButtonElement>(null);

  /**
   * Close the task Picker AND PUT FOCUS BACK ON THE ROW.
   *
   * Esc layering was already right (the first press closes only the Picker),
   * but focus stayed inside the closing popover, so the row's own Escape
   * handler no longer had it: the second press did nothing and the person
   * had to click back into the hours field before they could cancel. Focus
   * returns to the trigger, which is a child of the row, so the next Escape
   * reaches the handler above.
   */
  function closePicker() {
    setPickerOpen(false);
    // After the popover has unmounted, or the browser moves focus back to
    // the body on its way out.
    requestAnimationFrame(() => pickerTriggerRef.current?.focus());
  }
  const [nonce, setNonce] = useState(0);

  const chosen = taskOptions.find((o) => o.value === itemId) ?? null;

  async function save() {
    if (minutes === null || minutes <= 0 || saving) return;
    setSaving(true);
    const ok = await onAdd({
      dayKey,
      minutes,
      description: note.trim(),
      itemId,
      billable,
      // Decided addition (c), "notes and tags on entries". The column, the
      // normaliser and both API verbs existed with no writer anywhere in the
      // UI, so a tag could never be set and every read-side renderer was
      // dead. Comma separated, trimmed; the server normalises again.
      tags: tagText.split(",").map((t) => t.trim()).filter(Boolean),
    });
    setSaving(false);
    if (ok) {
      setMinutes(null);
      setNote("");
      setTagText("");
      setNonce((n) => n + 1);
    }
  }

  return (
    <div
      // The marker the page scrolls to after opening this row: the trigger
      // it clicked has been replaced by this composer by then.
      data-ts-add-row={dayKey}
      className="rounded-md border border-line-strong bg-app p-1.5"
      onKeyDown={(e) => {
        if (e.key !== "Escape") return;
        // ESC CLOSES ONLY THE TOPMOST OVERLAY. This handler used to fire
        // whatever else was open, so one press dismissed the task Picker AND
        // collapsed the row underneath it, throwing away the hours and the
        // note already typed. With the Picker open, the Picker takes it.
        if (pickerOpen) { closePicker(); e.stopPropagation(); return; }
        e.stopPropagation();
        onDone();
      }}
    >
      <div className="flex flex-wrap items-center gap-1.5">
        <HoursInput
          key={nonce}
          onChange={setMinutes}
          onSubmit={() => { void save(); }}
          autoFocus
          label={`Hours on ${dayKey}`}
          className="shrink-0"
        />
        {/* SECONDARY, not a second blue. "Log time" in the toolbar is this
            page's one primary, and the two sat in the same viewport
            (design-system principle 1). */}
        <button
          type="button"
          onClick={() => { void save(); }}
          disabled={minutes === null || minutes <= 0 || saving}
          className="h-9 shrink-0 rounded-md border border-line-strong bg-raised px-2.5 text-base font-medium text-ink hover:bg-hover disabled:opacity-40"
        >
          {saving ? <Dots variant="pending" /> : "Add"}
        </button>
      </div>
      <input
        type="text"
        value={note}
        onChange={(e) => setNote(e.target.value)}
        onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); void save(); } }}
        placeholder="What was it for?"
        aria-label={`Note for ${dayKey}`}
        className="mt-1.5 h-9 w-full rounded-md border border-line-strong bg-raised px-2 text-base text-ink outline-none placeholder:text-ink-3 focus:shadow-[0_0_0_3px_var(--os-focus-halo)]"
      />
      <input
        type="text"
        value={tagText}
        onChange={(e) => setTagText(e.target.value)}
        onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); void save(); } }}
        placeholder="Tags, comma separated"
        aria-label={`Tags for ${dayKey}`}
        className="mt-1.5 h-9 w-full rounded-md border border-line-strong bg-raised px-2 text-base text-ink outline-none placeholder:text-ink-3 focus:shadow-[0_0_0_3px_var(--os-focus-halo)]"
      />
      {/* The task, the billable flag and Done WRAP rather than share one
          line: a day column is about 150px wide at 1440, and three controls
          on one row squeezed the task button down to a single letter. */}
      <div className="relative mt-1.5 flex flex-wrap items-center gap-1.5">
        <button
          ref={pickerTriggerRef}
          type="button"
          onClick={() => setPickerOpen((o) => !o)}
          className="h-9 w-full min-w-0 truncate rounded-md border border-line-strong bg-raised px-2 text-start text-base text-ink-2 hover:bg-hover"
        >
          {chosen ? chosen.label : "No task"}
        </button>
        <label className="flex shrink-0 items-center gap-1.5 text-sm text-ink-2">
          <input
            type="checkbox"
            checked={billable}
            onChange={(e) => setBillable(e.target.checked)}
            className="h-[18px] w-[18px] rounded border-line-strong accent-[var(--os-brand)]"
          />
          Billable
        </label>
        <button
          type="button"
          onClick={onDone}
          className="ms-auto h-7 shrink-0 rounded-md px-1.5 text-sm text-ink-3 hover:bg-hover hover:text-ink-2"
        >
          Done
        </button>
        <Picker
          open={pickerOpen}
          onClose={closePicker}
          ariaLabel="Task for this entry"
          searchPlaceholder="Search my tasks"
          selected={itemId}
          sections={[{ options: [{ value: "", label: "No task" }, ...taskOptions] }]}
          onSelect={(v) => { setItemId(v || null); closePicker(); }}
          emptyLabel="No open tasks assigned to you"
        />
      </div>
    </div>
  );
}
