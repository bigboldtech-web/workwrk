"use client";

// PickerSelect: a settings single-choice control built on the ONE Picker
// (design-system 5.6), in place of a native <select> (settings-cleanup B9:
// selects are pickers, never native). NativeSelect in settings-form draws
// this too, so every settings select is one control. The trigger is the
// same 36px field every row control uses; the popover is a position:absolute
// child, never portalled, so it stays inside any dialog focus trap.
//
// Width: the trigger is as wide as its label (up to 260px) unless the
// wrapper is given one (`className="w-[190px]"`, `"w-full"`), which it then
// fills, the chevron at its end. `align` is the popover's preferred edge:
// "end" for a control at a row's right, "start" for a field whose control
// sits at the left. The Picker measures before it paints (autoPlace) and
// takes the other edge, or opens upward, when the preferred one would put
// it off screen or under a parent that clips it: a row stacks below 640px
// and puts its control at the left, and a drawer scrolls.
//
// Naming (settings-cleanup fix M1): the trigger is a button that pops up a
// listbox, named by its label AND its current value, so a screen reader
// hears "Time zone, Asia/Kolkata" and not the label alone. The label is the
// `label` prop, or with none the Field label drawn for `id` (Field gives a
// <label htmlFor={id}> the id `${id}-label`), and a click on that label
// still opens the picker. Not role="combobox": the Picker moves focus into
// its own search field or listbox, which the select-only combobox pattern
// does not allow. The listbox and the search field are named from the label.
//
// Focus (fix M2): choosing, Esc and a click outside all hand focus back to
// the trigger, unless focus has already gone somewhere else (a dialog the
// choice opened); the highlight opens on the current value. A disabled
// control stays focusable (aria-disabled), so a save that disables it for a
// moment, or a confirm dialog that returns focus to it, never drops focus to
// the page.
//
// An option whose value is "" (Everyone, None) is still shown as the
// selected row (fix L1): the Picker reads "" as nothing chosen, so it is
// handed a sentinel instead and the sentinel is turned back on the way out.

import { useCallback, useId, useRef, useState } from "react";
import { ChevronDown } from "lucide-react";
import { Picker, type PickerOption } from "@/components/ui/picker";
import { returnFocusOnClose, shouldReturnFocus } from "@/components/ui/return-focus";
import { cn } from "@/lib/utils";

export interface PickerSelectProps {
  value: string;
  options: PickerOption[];
  onChange: (value: string) => void;
  /** Accessible name for the trigger and the listbox; omit only when a Field label for `id` names it. */
  label?: string;
  /** The trigger's id, for a <label htmlFor>. */
  id?: string;
  /** Which edge of the trigger the popover prefers to line up with. */
  align?: "start" | "end";
  /** Shown on the trigger when no option matches the value. */
  placeholder?: string;
  searchPlaceholder?: string;
  /** A short fixed list read whole: no search box (the Picker's noSearch). */
  noSearch?: boolean;
  disabled?: boolean;
  width?: number;
  className?: string;
}

/** Stands in for "" inside the Picker, which reads "" as nothing chosen. */
export const EMPTY_VALUE_SENTINEL = "\u0000picker-select-empty";

export const toPickerValue = (v: string) => (v === "" ? EMPTY_VALUE_SENTINEL : v);
export const fromPickerValue = (v: string) => (v === EMPTY_VALUE_SENTINEL ? "" : v);

/** The id a Field gives the <label htmlFor={id}> it draws. */
export const fieldLabelId = (htmlFor: string) => `${htmlFor}-label`;

// shouldReturnFocus lives in ui/return-focus since the settings clean-up's
// Phase 3 review (M3): DateField, DateTimeField and TimeField share it.
export { shouldReturnFocus };

export function PickerSelect({ value, options, onChange, label, id, align = "end", placeholder, searchPlaceholder, noSearch, disabled, width = 280, className }: PickerSelectProps) {
  const [open, setOpen] = useState(false);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const wrapRef = useRef<HTMLSpanElement>(null);
  const auto = useId();
  const base = id ?? `ps${auto.replace(/[^a-zA-Z0-9_-]/g, "")}`;
  const valueId = `${base}-value`;
  const listboxId = `${base}-listbox`;
  const nameId = label ? `${base}-name` : id ? fieldLabelId(id) : undefined;
  const current = options.find((o) => o.value === value);
  const shown = current?.label ?? placeholder ?? value;

  const close = useCallback((reason: "select" | "dismiss") => {
    setOpen(false);
    // A click outside lands on the Picker's catcher, whose mousedown moves
    // focus to the catcher's focusable ancestor AFTER this runs; the helper
    // looks again once it has settled.
    returnFocusOnClose(reason, triggerRef.current, wrapRef.current);
  }, []);

  return (
    <span ref={wrapRef} className={cn("relative inline-block max-w-full align-middle", className)}>
      {label ? (
        <span id={nameId} hidden>
          {label}
        </span>
      ) : null}
      <button
        ref={triggerRef}
        type="button"
        id={id}
        aria-labelledby={nameId ? `${nameId} ${valueId}` : undefined}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={open ? listboxId : undefined}
        aria-disabled={disabled || undefined}
        onClick={() => {
          if (disabled) return;
          setOpen((v) => !v);
        }}
        className="inline-flex h-9 w-full max-w-[260px] items-center justify-between gap-2 rounded-md border border-line-strong bg-raised px-2 text-base text-ink aria-disabled:cursor-default aria-disabled:opacity-50"
      >
        <span id={valueId} className="min-w-0 truncate">
          {shown}
        </span>
        <ChevronDown className="h-4 w-4 shrink-0 text-ink-2" strokeWidth={1.5} aria-hidden />
      </button>
      <Picker
        open={open}
        onClose={() => close("dismiss")}
        ariaLabel={label}
        ariaLabelledBy={label ? undefined : nameId}
        listboxId={listboxId}
        searchPlaceholder={searchPlaceholder ?? (label ? `Search ${label.toLowerCase()}` : "Search")}
        noSearch={noSearch}
        selected={toPickerValue(value)}
        align={align}
        autoPlace
        highlightSelected
        width={width}
        sections={[{ options: options.map((o) => ({ ...o, value: toPickerValue(o.value) })) }]}
        onSelect={(v) => {
          close("select");
          const next = fromPickerValue(v);
          if (next !== value) onChange(next);
        }}
      />
    </span>
  );
}
