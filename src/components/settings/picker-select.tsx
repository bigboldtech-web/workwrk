"use client";

// PickerSelect: a settings row's single-choice control built on the ONE
// Picker (design-system 5.6), in place of a native <select> where the list
// is long enough to need a search field (Time zone: several hundred IANA
// zones) or carries a first row with its own meaning ("Use my device time
// zone"). The trigger is the same 36px field every row control uses; the
// popover is a position:absolute child, never portalled, so it stays inside
// any dialog focus trap.

import { useState } from "react";
import { ChevronDown } from "lucide-react";
import { Picker, type PickerOption } from "@/components/ui/picker";
import { cn } from "@/lib/utils";

export interface PickerSelectProps {
  value: string;
  options: PickerOption[];
  onChange: (value: string) => void;
  /** Accessible name for the trigger and the listbox. */
  label: string;
  /** Shown on the trigger when no option matches the value. */
  placeholder?: string;
  searchPlaceholder?: string;
  disabled?: boolean;
  width?: number;
  className?: string;
}

export function PickerSelect({ value, options, onChange, label, placeholder, searchPlaceholder, disabled, width = 280, className }: PickerSelectProps) {
  const [open, setOpen] = useState(false);
  const current = options.find((o) => o.value === value);
  return (
    <span className={cn("relative inline-block", className)}>
      <button
        type="button"
        aria-label={label}
        aria-haspopup="listbox"
        aria-expanded={open}
        disabled={disabled}
        onClick={() => setOpen((v) => !v)}
        className="inline-flex h-9 max-w-[260px] items-center gap-2 rounded-md border border-line-strong bg-raised px-2 text-base text-ink disabled:opacity-50"
      >
        <span className="min-w-0 truncate">{current?.label ?? placeholder ?? value}</span>
        <ChevronDown className="h-4 w-4 shrink-0 text-ink-2" strokeWidth={1.5} aria-hidden />
      </button>
      <Picker
        open={open}
        onClose={() => setOpen(false)}
        ariaLabel={label}
        searchPlaceholder={searchPlaceholder ?? `Search ${label.toLowerCase()}`}
        selected={value}
        align="end"
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
