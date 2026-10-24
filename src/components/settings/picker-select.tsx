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
// fills, the chevron at its end. `align` is the popover's edge: "end" for a
// control at a row's right, "start" for a field whose control sits at the
// left. With no `label`, a <label htmlFor={id}> names the trigger.

import { useState } from "react";
import { ChevronDown } from "lucide-react";
import { Picker, type PickerOption } from "@/components/ui/picker";
import { cn } from "@/lib/utils";

export interface PickerSelectProps {
  value: string;
  options: PickerOption[];
  onChange: (value: string) => void;
  /** Accessible name for the trigger and the listbox; omit only when a <label htmlFor={id}> names it. */
  label?: string;
  /** The trigger's id, for a <label htmlFor>. */
  id?: string;
  /** Which edge of the trigger the popover lines up with. */
  align?: "start" | "end";
  /** Shown on the trigger when no option matches the value. */
  placeholder?: string;
  searchPlaceholder?: string;
  disabled?: boolean;
  width?: number;
  className?: string;
}

export function PickerSelect({ value, options, onChange, label, id, align = "end", placeholder, searchPlaceholder, disabled, width = 280, className }: PickerSelectProps) {
  const [open, setOpen] = useState(false);
  const current = options.find((o) => o.value === value);
  return (
    <span className={cn("relative inline-block max-w-full align-middle", className)}>
      <button
        type="button"
        id={id}
        aria-label={label}
        aria-haspopup="listbox"
        aria-expanded={open}
        disabled={disabled}
        onClick={() => setOpen((v) => !v)}
        className="inline-flex h-9 w-full max-w-[260px] items-center justify-between gap-2 rounded-md border border-line-strong bg-raised px-2 text-base text-ink disabled:opacity-50"
      >
        <span className="min-w-0 truncate">{current?.label ?? placeholder ?? value}</span>
        <ChevronDown className="h-4 w-4 shrink-0 text-ink-2" strokeWidth={1.5} aria-hidden />
      </button>
      <Picker
        open={open}
        onClose={() => setOpen(false)}
        ariaLabel={label}
        searchPlaceholder={searchPlaceholder ?? (label ? `Search ${label.toLowerCase()}` : "Search")}
        selected={value}
        align={align}
        width={width}
        sections={[{ options }]}
        onSelect={(v) => {
          setOpen(false);
          if (v !== value) onChange(v);
        }}
      />
    </span>
  );
}
