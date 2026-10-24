"use client";

// DateField (design-system 5.6, the date mode of the one picker popover): a
// 36px field that reads the date in the viewer's format and opens a 288px
// popover with the quick chips Today / Tomorrow / Next week / No date at 24px
// and one month grid of 32px cells; today ringed 1px --os-brand, the selected
// day --os-brand filled. Never a native <input type=date> on an app surface.
//
// Value contract: a calendar date as "YYYY-MM-DD", or null. It owns no
// network: the caller writes the value where it goes. Inside a dialog or the
// Filter panel the popover is a position:absolute child (never portalled),
// which is what keeps it inside Radix's focus trap.
//
// A DAY IS NOT AN INSTANT, so nothing in here reads a key back through a
// zoned formatter. `fmt.date(new Date(y, m, d))` builds midnight in the
// BROWSER's zone and then re-reads it in home.locale.timezone, which for any
// westward viewer prints the day before: the trigger said "24 Sep" for a
// value of "2026-09-25". Labels go through `fmt.wallDate` (the day exactly as
// written, in the viewer's date order) and "today" is the viewer's own today
// from `fmt.today()`, never the machine's.
//
// NAME AND FOCUS (settings-cleanup Phase 3 review, M3). The trigger is named
// by its label AND the date it shows (aria-labelledby the hidden label, then
// the value), so a screen reader hears "Due date 25 Oct 2026", never the
// label alone over a value it cannot read. A pick, a chip, the clear X, Esc
// and a click outside all hand focus back to the trigger, as PickerSelect
// does (ui/return-focus), so focus never drops to the page when the
// popover's day button unmounts under it.

import { useCallback, useId, useMemo, useRef, useState } from "react";
import { CalendarDays, ChevronLeft, ChevronRight, X } from "lucide-react";
import { useLayer } from "@/components/layout/os/shell-context";
import { useFormat } from "@/lib/format/use-date-prefs";
import { idToken, returnFocusOnClose } from "@/components/ui/return-focus";
import { cn } from "@/lib/utils";

function pad(n: number): string { return n < 10 ? `0${n}` : String(n); }
export function toDateKey(d: Date): string { return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`; }
function fromDateKey(v: string | null | undefined): Date | null {
  if (!v) return null;
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(v);
  if (!m) { const d = new Date(v); return Number.isNaN(d.getTime()) ? null : d; }
  return new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
}
function addDays(d: Date, n: number): Date { const x = new Date(d); x.setDate(x.getDate() + n); return x; }

const WEEKDAYS = ["M", "T", "W", "T", "F", "S", "S"];

export function DateField({
  value,
  onChange,
  placeholder = "Pick a date",
  allowClear = true,
  size = "md",
  align = "start",
  inline = false,
  className,
  ariaLabel,
  disabled,
}: {
  value: string | null | undefined;
  onChange: (next: string | null) => void;
  placeholder?: string;
  /** Show the "No date" chip and the clear affordance. */
  allowClear?: boolean;
  /** 36px in forms, 32px inside the Filter panel. */
  size?: "md" | "sm";
  align?: "start" | "end";
  /** Draw the chips and the month grid in place (inside a 400 dialog), with no trigger and no popover. */
  inline?: boolean;
  className?: string;
  ariaLabel?: string;
  disabled?: boolean;
}) {
  const fmt = useFormat();
  const [open, setOpen] = useState(false);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const wrapRef = useRef<HTMLSpanElement>(null);
  const base = idToken("df", useId());
  const nameId = `${base}-name`;
  const valueId = `${base}-value`;
  const selected = useMemo(() => fromDateKey(value), [value]);
  // The viewer's today, read in their zone, as a plain calendar Date so the
  // grid arithmetic below stays ordinary.
  const today = useMemo(() => fromDateKey(fmt.today()) ?? new Date(), [fmt]);
  const [cursor, setCursor] = useState<Date>(() => { const base = selected ?? today; return new Date(base.getFullYear(), base.getMonth(), 1); });
  // Re-adopt the month of the selected value whenever the popover opens.
  const [seenOpen, setSeenOpen] = useState(open);
  if (seenOpen !== open) {
    setSeenOpen(open);
    if (open) { const base = selected ?? today; setCursor(new Date(base.getFullYear(), base.getMonth(), 1)); }
  }
  // Closing hands focus back to the trigger (inline mode has none).
  const close = useCallback((reason: "select" | "dismiss") => {
    setOpen(false);
    if (!inline) returnFocusOnClose(reason, triggerRef.current, wrapRef.current);
  }, [inline]);
  useLayer(open && !inline, { kind: "popover", close: () => close("dismiss") });

  const pick = (d: Date | null) => { onChange(d ? toDateKey(d) : null); close("select"); };

  const grid = useMemo(() => {
    const first = new Date(cursor.getFullYear(), cursor.getMonth(), 1);
    const daysInMonth = new Date(cursor.getFullYear(), cursor.getMonth() + 1, 0).getDate();
    // Monday-first: JS Sunday is 0.
    const lead = (first.getDay() + 6) % 7;
    const cells: Array<Date | null> = [];
    for (let i = 0; i < lead; i++) cells.push(null);
    for (let d = 1; d <= daysInMonth; d++) cells.push(new Date(cursor.getFullYear(), cursor.getMonth(), d));
    while (cells.length % 7 !== 0) cells.push(null);
    return cells;
  }, [cursor]);

  const monthLabel = cursor.toLocaleDateString(fmt.prefs.language ?? undefined, { month: "long", year: "numeric" });
  const selectedKey = selected ? toDateKey(selected) : null;
  const todayKey = toDateKey(today);
  const h = size === "sm" ? "h-8" : "h-9";

  const chip = (label: string, d: Date | null) => (
    <button type="button" onClick={() => pick(d)} className="inline-flex h-6 items-center rounded-md bg-active px-2 text-xs font-medium text-ink hover:bg-hover">{label}</button>
  );

  const calendar = (
    <>
    <div className="flex flex-wrap gap-1 px-1 pb-2">
      {chip("Today", today)}
      {chip("Tomorrow", addDays(today, 1))}
      {chip("Next week", addDays(today, 7))}
      {allowClear ? chip("No date", null) : null}
    </div>
    <div className="flex h-8 items-center gap-1 px-1">
      <button type="button" onClick={() => setCursor(new Date(cursor.getFullYear(), cursor.getMonth() - 1, 1))} aria-label="Previous month" className="inline-flex h-7 w-7 items-center justify-center rounded-md text-ink-2 hover:bg-hover hover:text-ink"><ChevronLeft className="h-4 w-4 rtl:rotate-180" strokeWidth={1.5} aria-hidden /></button>
      <span className="min-w-0 flex-1 truncate text-center text-sm font-medium text-ink">{monthLabel}</span>
      <button type="button" onClick={() => setCursor(new Date(cursor.getFullYear(), cursor.getMonth() + 1, 1))} aria-label="Next month" className="inline-flex h-7 w-7 items-center justify-center rounded-md text-ink-2 hover:bg-hover hover:text-ink"><ChevronRight className="h-4 w-4 rtl:rotate-180" strokeWidth={1.5} aria-hidden /></button>
    </div>
    <div className="grid grid-cols-7 gap-0.5 px-1">
      {WEEKDAYS.map((w, i) => <span key={i} className="flex h-6 items-center justify-center text-xs font-medium text-ink-3" aria-hidden>{w}</span>)}
      {grid.map((d, i) => {
        if (!d) return <span key={`e${i}`} className="h-8" aria-hidden />;
        const key = toDateKey(d);
        const isSel = key === selectedKey;
        const isToday = key === todayKey;
        return (
          <button
            key={key}
            type="button"
            onClick={() => pick(d)}
            aria-label={fmt.wallDate(key)}
            aria-pressed={isSel}
            className={cn(
              "inline-flex h-8 w-8 items-center justify-center rounded-md text-sm tabular-nums",
              isSel ? "bg-brand font-medium text-white" : "text-ink hover:bg-hover",
              isToday && !isSel ? "ring-1 ring-inset ring-[var(--os-brand)]" : "",
            )}
          >
            {d.getDate()}
          </button>
        );
      })}
    </div>
    </>
  );

  if (inline) {
    return <div className={cn("w-full", className)} role="group" aria-label={ariaLabel ?? "Pick a date"}>{calendar}</div>;
  }

  return (
    <span ref={wrapRef} className={cn("relative block", className)}>
      {ariaLabel ? <span id={nameId} hidden>{ariaLabel}</span> : null}
      <span className="flex items-center gap-1">
        <button
          ref={triggerRef}
          type="button"
          disabled={disabled}
          onClick={() => setOpen((o) => !o)}
          aria-haspopup="dialog"
          aria-expanded={open}
          aria-labelledby={ariaLabel ? `${nameId} ${valueId}` : undefined}
          className={cn("inline-flex w-full min-w-0 items-center gap-2 rounded-md border border-line-strong bg-raised px-3 text-start text-base text-ink hover:bg-hover focus:outline-none focus-visible:border-brand disabled:opacity-60", h)}
        >
          <CalendarDays className="h-4 w-4 shrink-0 text-ink-2" strokeWidth={1.5} aria-hidden />
          <span id={valueId} className={cn("min-w-0 flex-1 truncate", selected ? "" : "text-ink-3")}>{selectedKey ? fmt.wallDate(selectedKey) : placeholder}</span>
        </button>
        {allowClear && selected && !disabled ? (
          // The X goes with the date it clears, so focus goes back to the field.
          <button type="button" onClick={() => { onChange(null); triggerRef.current?.focus({ preventScroll: true }); }} aria-label="Clear date" className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-md text-ink-2 hover:bg-hover hover:text-ink">
            <X className="h-4 w-4" strokeWidth={1.5} aria-hidden />
          </button>
        ) : null}
      </span>
      {open ? (
        <>
          <div className="fixed inset-0 z-[60]" onMouseDown={() => close("dismiss")} aria-hidden="true" />
          <div role="dialog" aria-label="Pick a date" className={cn("absolute z-[61] mt-1 w-[288px] max-w-[calc(100vw-32px)] rounded-lg border border-line bg-raised p-2 shadow-[var(--os-shadow-pop)]", align === "end" ? "end-0" : "start-0", "top-full")}>
            {calendar}
          </div>
        </>
      ) : null}
    </span>
  );
}
