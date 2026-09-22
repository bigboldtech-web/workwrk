"use client";

// HoursInput: the one duration field in the Planner unit.
//
// spec-planner.md section 3 asks for it by name and section 1 fixes the
// contract: "Hours render as h:mm everywhere in this unit ... Inputs accept
// 1:30, 1.5, 90m". There were three duration fields in the product writing
// three different numbers from the same keystrokes (the deleted timesheet
// manager took a bare `Number(value)`, so "1:30" read as NaN and "1,5" read
// as 1), which is the drift this component exists to end.
//
// It owns the TEXT the person is typing and reports MINUTES, so a half-typed
// "1:" is not rewritten under the cursor and an unparseable string does not
// silently become zero: `onChange(null)` says "not a duration yet" and the
// caller disables its own save. On blur, a value that parsed is normalised to
// h:mm so the field agrees with the row it will become.
//
// No handler-free control, no spinner, no em dash in any string here.

import { useId, useState } from "react";
import { MAX_ENTRY_MINUTES, formatHm, parseHoursInput } from "@/lib/time-format";
import { cn } from "@/lib/utils";

export interface HoursInputProps {
  /**
   * The value the field OPENS with, in whole minutes, or null for empty.
   * It is not pushed back in afterwards: the field owns the text while a
   * person is typing in it, so nothing rewrites "1:" under the cursor. A
   * caller that needs to clear or reload the field changes its React `key`,
   * which is the cheap and honest way to say "this is a different field now".
   */
  initialMinutes?: number | null;
  /** Whole minutes, or null when what is typed is not a duration yet. */
  onChange: (minutes: number | null) => void;
  /** Fires on Enter when the current text parses to a usable duration. */
  onSubmit?: () => void;
  label?: string;
  placeholder?: string;
  autoFocus?: boolean;
  disabled?: boolean;
  className?: string;
  /** Upper bound in minutes; the API's own cap by default. */
  maxMinutes?: number;
}

export function HoursInput({
  initialMinutes = null,
  onChange,
  onSubmit,
  label = "Hours",
  placeholder = "1:30",
  autoFocus,
  disabled,
  className,
  maxMinutes = MAX_ENTRY_MINUTES,
}: HoursInputProps) {
  const id = useId();
  const [text, setText] = useState(() => (initialMinutes === null ? "" : formatHm(initialMinutes)));

  const parsed = parseHoursInput(text);
  const tooBig = parsed !== null && parsed > maxMinutes;
  const unreadable = text.trim() !== "" && parsed === null;

  function commit(next: string) {
    setText(next);
    const m = parseHoursInput(next);
    onChange(m === null || m > maxMinutes ? null : m);
  }

  return (
    <span className={cn("inline-flex flex-col gap-0.5", className)}>
      <input
        id={id}
        type="text"
        inputMode="text"
        aria-label={label}
        aria-invalid={unreadable || tooBig ? true : undefined}
        autoFocus={autoFocus}
        disabled={disabled}
        value={text}
        placeholder={placeholder}
        onChange={(e) => commit(e.target.value)}
        onBlur={() => { if (parsed !== null && !tooBig) setText(formatHm(parsed)); }}
        onKeyDown={(e) => {
          if (e.key === "Enter" && parsed !== null && parsed > 0 && !tooBig) { e.preventDefault(); onSubmit?.(); }
        }}
        className={cn(
          "h-8 w-20 rounded-md border bg-raised px-2 text-base tabular-nums text-ink outline-none",
          "focus:shadow-[0_0_0_3px_var(--os-focus-halo)] disabled:opacity-40",
          unreadable || tooBig ? "border-danger-solid" : "border-line-strong",
        )}
      />
      {unreadable ? (
        <span className="text-xs text-danger-solid">Try 1:30, 1.5 or 90m</span>
      ) : tooBig ? (
        <span className="text-xs text-danger-solid">{formatHm(maxMinutes)} is the most for one entry</span>
      ) : null}
    </span>
  );
}
