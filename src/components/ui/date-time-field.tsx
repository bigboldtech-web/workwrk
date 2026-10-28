"use client";

// DateTimeField: a date and a time, on the product's own controls.
//
// design-system.md section 5: "Selects, dates and people are pickers (5.6),
// never native." Two surfaces in the Planner unit were still native
// `<input type="datetime-local">`: the meeting detail page's When row and the
// New meeting modal's When field. A native datetime field:
//
//   renders the BROWSER's format ("25/09/2026, 06:00 AM") and ignores the
//     home.locale dateFormat and timeFormat the rest of the same page honours
//   draws the operating system's own calendar glyph, which is the one piece
//     of chrome in the product nothing else matches
//   is 32px tall in Chrome against the 36px input standard
//
// This is DateField (5.6's date mode) plus the one Picker in its time mode,
// so both halves read the viewer's preferences and look like everything else.
//
// VALUE CONTRACT. The same string the native control used:
// "YYYY-MM-DDTHH:mm", a WALL CLOCK with no zone, which the callers translate
// through src/lib/zoned-input.ts. Nothing about zones happens in here, which
// is why this component can be dropped straight in where the native one was.
//
// NAME AND FOCUS (settings-cleanup Phase 3 review, M3). Each trigger is named
// by its label and the value it shows ("Mute until: time 3:00 PM"), and a
// pick, Esc or a click outside hands focus back to it (ui/return-focus), as
// DateField and PickerSelect do. The time half IS TimeField, so the two time
// triggers cannot drift apart again.

import { useCallback, useId, useMemo, useRef, useState } from "react";
import { Clock } from "lucide-react";
import { DateField } from "@/components/ui/date-field";
import { Picker, type PickerOption } from "@/components/ui/picker";
import { useFormat } from "@/lib/format/use-date-prefs";
import { idToken, returnFocusOnClose } from "@/components/ui/return-focus";
import { cn } from "@/lib/utils";

/** Split "2026-09-25T06:00" into its two halves. Either may be empty. */
function split(value: string): { date: string; time: string } {
  const m = /^(\d{4}-\d{2}-\d{2})(?:T(\d{2}:\d{2}))?/.exec(value ?? "");
  if (!m) return { date: "", time: "" };
  return { date: m[1], time: m[2] ?? "" };
}

const STEP_MINUTES = 15;

export interface DateTimeFieldProps {
  /** "YYYY-MM-DDTHH:mm", or "" for empty. */
  value: string;
  onChange: (next: string) => void;
  label: string;
  disabled?: boolean;
  className?: string;
}

/**
 * The time half on its own: a 36px trigger reading the viewer's timeFormat
 * and one Picker of quarter hours.
 *
 * Exported because three surfaces need a time and only one of them needs a
 * date beside it: the meeting When row (through DateTimeField), the Event
 * popover's start and end, and the New event modal's start and end. Before
 * it, the last two were `<input type="time">`, which draws the operating
 * system's widget and ignores home.locale entirely, so two create surfaces
 * in the same unit disagreed with each other about what time it was.
 *
 * VALUE CONTRACT: "HH:mm", 24 hour, zone-free. The LABEL is the viewer's
 * format; the value never is.
 */
export function TimeField({
  value, onChange, label, disabled, width = 116, className,
}: {
  value: string;
  onChange: (next: string) => void;
  label: string;
  disabled?: boolean;
  width?: number;
  className?: string;
}) {
  const fmt = useFormat();
  const [open, setOpen] = useState(false);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const wrapRef = useRef<HTMLSpanElement>(null);
  const base = idToken("tf", useId());
  const options = useTimeOptions();
  const shown = value
    ? options.find((o) => o.value === value)?.label ?? fmt.wallHhmm(value)
    : "Pick a time";
  const close = useCallback((reason: "select" | "dismiss") => {
    setOpen(false);
    returnFocusOnClose(reason, triggerRef.current, wrapRef.current);
  }, []);

  return (
    <span ref={wrapRef} className={cn("relative", className)}>
      <span id={`${base}-name`} hidden>{label}</span>
      <button
        ref={triggerRef}
        type="button"
        disabled={disabled}
        onClick={() => setOpen((o) => !o)}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-labelledby={`${base}-name ${base}-value`}
        style={{ minWidth: width }}
        className="inline-flex h-9 items-center gap-2 rounded-md border border-line-strong bg-raised px-3 text-start text-base text-ink hover:bg-hover focus:outline-none focus-visible:border-brand disabled:opacity-60"
      >
        <Clock className="h-4 w-4 shrink-0 text-ink-2" strokeWidth={1.5} aria-hidden />
        <span id={`${base}-value`} className={cn("min-w-0 flex-1 truncate tabular-nums", value ? "" : "text-ink-2")}>{shown}</span>
      </button>
      <Picker
        open={open}
        onClose={() => close("dismiss")}
        ariaLabel={label}
        searchPlaceholder="Type a time"
        width={180}
        selected={value || null}
        sections={[{ options }]}
        onSelect={(v) => { close("select"); onChange(v); }}
      />
    </span>
  );
}

/**
 * Every quarter hour of the day, rendered in the viewer's own time format,
 * so a 24h viewer never reads "06:00 AM" on one control and "06:00" on the
 * header line beside it.
 */
function useTimeOptions(): PickerOption[] {
  const fmt = useFormat();
  return useMemo<PickerOption[]>(() => {
    const out: PickerOption[] = [];
    for (let m = 0; m < 24 * 60; m += STEP_MINUTES) {
      const hh = String(Math.floor(m / 60)).padStart(2, "0");
      const mm = String(m % 60).padStart(2, "0");
      const key = `${hh}:${mm}`;
      out.push({
        value: key,
        // fmt.wallTime and NOT fmt.date. An option is a set of DIGITS, not an
        // instant: fmt.date projects its argument into home.locale.timezone,
        // and a Date built here is in the BROWSER's zone, so every label moved
        // by the difference between the two (the row reading "9:00 AM" carried
        // the value "19:30"). See formatWallClockTime in src/lib/format/date.ts.
        label: fmt.wallTime(Math.floor(m / 60), m % 60),
        keywords: key,
      });
    }
    return out;
  }, [fmt]);
}

export function DateTimeField({ value, onChange, label, disabled, className }: DateTimeFieldProps) {
  const fmt = useFormat();
  const { date, time } = split(value);

  /**
   * A time with no date is not a moment, and a date with no time is not one
   * either, so picking one half fills the other in with a sensible default
   * rather than leaving a value the caller cannot use.
   */
  function setDate(next: string | null) {
    if (!next) { onChange(""); return; }
    onChange(`${next}T${time || "09:00"}`);
  }
  function setTime(next: string) {
    // The viewer's own today, not the server's UTC day and not the machine's:
    // picking a time with no date set must not file it on yesterday.
    const d = date || fmt.today();
    onChange(`${d}T${next}`);
  }

  return (
    <span className={cn("flex min-w-0 flex-wrap items-center gap-2", className)}>
      <DateField
        value={date || null}
        onChange={setDate}
        allowClear={false}
        ariaLabel={`${label}: date`}
        disabled={disabled}
        className="min-w-[150px] flex-1"
      />
      {/* A stored time that is not on a quarter hour still reads correctly (TimeField's own label). */}
      <TimeField value={time} onChange={setTime} label={`${label}: time`} disabled={disabled} />
    </span>
  );
}
