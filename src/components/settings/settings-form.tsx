"use client";

// The form pieces every Workspace settings page shares (spec-settings-
// workspace 1.7 item 4, design-system 5.4): a field with its label ABOVE
// (13/500), a 13/400 helper, "(required)" as a word, the 36px input with the
// one focus halo, a textarea that grows, a number input with a suffix, a
// native select for short lists, a chip list, and the two confirm dialogs
// (plain and typed). Built on the account-ui primitives so both doors look
// the same; tokens only, no hex.

import { useEffect, useId, useRef, useState, type ReactNode, type TextareaHTMLAttributes } from "react";
import { X } from "lucide-react";
import { AccountDialog, FieldError, Pending, TextInput, btn } from "@/components/account/account-ui";
import { cn } from "@/lib/utils";

export { btn, Pending, TextInput };

export function Field({
  label,
  htmlFor,
  helper,
  error,
  required,
  id,
  children,
  className,
}: {
  label: ReactNode;
  htmlFor?: string;
  helper?: ReactNode;
  error?: string | null;
  required?: boolean;
  /** The registry anchor (settings-registry SettingEntry id). */
  id?: string;
  children: ReactNode;
  className?: string;
}) {
  return (
    <div id={id} className={cn("scroll-mt-4", className)}>
      <label htmlFor={htmlFor} className="mb-1.5 block text-sm font-medium text-ink">
        {label}
        {required ? <span className="ms-1 font-normal text-ink-2">(required)</span> : null}
      </label>
      {children}
      {helper && !error ? <p className="mt-1.5 text-sm text-ink-2">{helper}</p> : null}
      <FieldError>{error}</FieldError>
    </div>
  );
}

const FIELD = "w-full rounded-md border bg-raised px-3 text-base text-ink placeholder:text-ink-3 outline-none focus:shadow-[0_0_0_3px_var(--os-focus-halo)]";

/** A textarea that starts at `rows` and grows to `maxRows` with its text. */
export function TextArea({
  rows = 4,
  maxRows = 12,
  invalid,
  className,
  value,
  ...rest
}: TextareaHTMLAttributes<HTMLTextAreaElement> & { maxRows?: number; invalid?: boolean }) {
  const ref = useRef<HTMLTextAreaElement>(null);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.style.height = "auto";
    const line = parseFloat(getComputedStyle(el).lineHeight) || 20;
    const max = line * maxRows + 16;
    el.style.height = `${Math.min(el.scrollHeight + 2, max)}px`;
  }, [value, maxRows]);
  return (
    <textarea
      ref={ref}
      rows={rows}
      value={value}
      aria-invalid={invalid ? true : undefined}
      className={cn(FIELD, "resize-none py-2 leading-relaxed", invalid ? "border-[var(--os-danger-solid)]" : "border-line-strong focus:border-brand", className)}
      {...rest}
    />
  );
}

/**
 * Why a number field cannot be saved, or null when it can (pure; tested).
 * An empty field is missing unless `allowEmpty`.
 */
export function numberFieldError(v: number | "", min?: number, max?: number, allowEmpty = false): string | null {
  const words =
    min !== undefined && max !== undefined ? `Enter a number from ${min} to ${max}`
    : min !== undefined ? `Enter ${min} or more`
    : max !== undefined ? `Enter ${max} or less`
    : "Enter a number";
  if (v === "") return allowEmpty ? null : words;
  if ((min !== undefined && v < min) || (max !== undefined && v > max)) return words;
  return null;
}

/**
 * What one keystroke in a bounded number field hands the form (pure;
 * tested): the number when it is in range, else null and the field keeps
 * the text as typed. Never a clamp: clamping each keystroke turned "12"
 * into 8 and then 82, saved as 64, and a cleared field snapped back to the
 * minimum before the next digit landed.
 */
export function acceptTypedNumber(n: number | "", bounds: { min: number; max: number }): number | null {
  return n !== "" && numberFieldError(n, bounds.min, bounds.max) === null ? n : null;
}

export interface TypedNumberField {
  /** The sentence to show under the field, once the person has left it or tried to save. */
  error: string | null;
  input: {
    value: number | "";
    min: number;
    max: number;
    invalid: boolean;
    onChange: (v: number | "") => void;
    onBlur: () => void;
  };
}

/**
 * Bounded number fields on a Save bar page. The form holds only valid
 * numbers; while a field reads empty or out of range, what the person typed
 * is kept here and shown in the field, the form keeps its last valid value,
 * and `check()` refuses the save (and turns every such field red) until it
 * is fixed. So typing is never rewritten under the cursor and a blank field
 * never saves a number nobody chose.
 */
export function useTypedNumbers() {
  const [typed, setTyped] = useState<Record<string, number | "">>({});
  const [left, setLeft] = useState<Record<string, true>>({});
  const [tried, setTried] = useState(false);
  const without = <T,>(o: Record<string, T>, key: string) => { const n = { ...o }; delete n[key]; return n; };
  const heldKeys = Object.keys(typed);
  return {
    heldKeys,
    blocked: heldKeys.length > 0,
    field(key: string, value: number, bounds: { min: number; max: number }, commit: (n: number) => void): TypedNumberField {
      const held = Object.prototype.hasOwnProperty.call(typed, key);
      const error = held && (left[key] || tried) ? numberFieldError(typed[key], bounds.min, bounds.max) : null;
      return {
        error,
        input: {
          value: held ? typed[key] : value,
          min: bounds.min,
          max: bounds.max,
          invalid: !!error,
          onChange: (n) => {
            const ok = acceptTypedNumber(n, bounds);
            setTyped((t) => (ok === null ? { ...t, [key]: n } : without(t, key)));
            // Typing again hides the sentence until the person leaves the field.
            setLeft((l) => without(l, key));
            if (ok !== null) commit(ok);
          },
          onBlur: () => setLeft((l) => (held ? { ...l, [key]: true } : l)),
        },
      };
    },
    /** False (and every held field shown red) while any field is not a valid number. */
    check(): boolean {
      if (heldKeys.length === 0) return true;
      setTried(true);
      return false;
    },
    /** After a save or a Discard. */
    reset() { setTyped({}); setLeft({}); setTried(false); },
    /** Drop the typed text of fields whose key starts with `prefix` (a section reset, a removed row). */
    clear(prefix: string) {
      const drop = <T,>(o: Record<string, T>) => Object.fromEntries(Object.entries(o).filter(([k]) => !k.startsWith(prefix)));
      setTyped(drop);
      setLeft(drop);
    },
  };
}

/** A whole-number input with an optional suffix ("days", "minutes"). */
export function NumberInput({
  value,
  onChange,
  onBlur,
  min,
  max,
  suffix,
  id,
  invalid,
  disabled,
  width = 96,
  ariaLabel,
}: {
  value: number | "";
  onChange: (v: number | "") => void;
  onBlur?: () => void;
  min?: number;
  max?: number;
  suffix?: string;
  id?: string;
  invalid?: boolean;
  disabled?: boolean;
  width?: number;
  ariaLabel?: string;
}) {
  return (
    <span className="inline-flex items-center gap-2">
      <input
        id={id}
        type="number"
        inputMode="numeric"
        min={min}
        max={max}
        step={1}
        value={value}
        disabled={disabled}
        aria-label={ariaLabel}
        aria-invalid={invalid ? true : undefined}
        onChange={(e) => {
          const raw = e.target.value;
          if (raw === "") return onChange("");
          const n = Number(raw);
          onChange(Number.isFinite(n) ? Math.trunc(n) : "");
        }}
        onBlur={onBlur}
        style={{ width }}
        className={cn(FIELD, "h-9 tabular-nums", invalid ? "border-[var(--os-danger-solid)]" : "border-line-strong focus:border-brand", disabled && "opacity-60")}
      />
      {suffix ? <span className="text-base text-ink-2">{suffix}</span> : null}
    </span>
  );
}

/** A native select for a short fixed list (six items or fewer). */
export function NativeSelect<T extends string>({
  value,
  options,
  onChange,
  id,
  ariaLabel,
  disabled,
  className,
}: {
  value: T;
  options: readonly { value: T; label: string }[];
  onChange: (v: T) => void;
  id?: string;
  ariaLabel?: string;
  disabled?: boolean;
  className?: string;
}) {
  return (
    <select
      id={id}
      aria-label={ariaLabel}
      value={value}
      disabled={disabled}
      onChange={(e) => onChange(e.target.value as T)}
      className={cn("h-9 rounded-md border border-line-strong bg-raised px-2 text-base text-ink outline-none focus:border-brand focus:shadow-[0_0_0_3px_var(--os-focus-halo)] disabled:opacity-60", className)}
    >
      {options.map((o) => (
        <option key={o.value} value={o.value}>{o.label}</option>
      ))}
    </select>
  );
}

/**
 * A chip list with one input under it: Enter or Add appends, case-insensitive
 * dedupe, a 12px x removes, the arrow buttons reorder (drag is never the only
 * way). `validate` returns an error sentence or null.
 */
export function ChipsInput({
  values,
  onChange,
  placeholder,
  max = 12,
  validate,
  reorder = false,
  ariaLabel,
}: {
  values: string[];
  onChange: (v: string[]) => void;
  placeholder?: string;
  max?: number;
  validate?: (v: string) => string | null;
  reorder?: boolean;
  ariaLabel: string;
}) {
  const [draft, setDraft] = useState("");
  const [err, setErr] = useState<string | null>(null);
  const inputId = useId();
  const add = () => {
    const v = draft.trim();
    if (!v) return;
    const bad = validate?.(v) ?? null;
    if (bad) { setErr(bad); return; }
    if (values.some((x) => x.toLowerCase() === v.toLowerCase())) { setDraft(""); setErr(null); return; }
    if (values.length >= max) { setErr(`Up to ${max}`); return; }
    onChange([...values, v]);
    setDraft("");
    setErr(null);
  };
  const move = (i: number, d: -1 | 1) => {
    const j = i + d;
    if (j < 0 || j >= values.length) return;
    const next = [...values];
    [next[i], next[j]] = [next[j], next[i]];
    onChange(next);
  };
  return (
    <div>
      {values.length > 0 ? (
        <ul className="mb-2 flex flex-wrap gap-1.5" aria-label={ariaLabel}>
          {values.map((v, i) => (
            <li key={`${v}-${i}`} className="inline-flex h-6 items-center gap-1 rounded-full border border-line bg-hover ps-2.5 pe-1 text-sm text-ink">
              {reorder && i > 0 ? (
                <button type="button" onClick={() => move(i, -1)} aria-label={`Move ${v} earlier`} className="text-ink-3 hover:text-ink">‹</button>
              ) : null}
              <span>{v}</span>
              {reorder && i < values.length - 1 ? (
                <button type="button" onClick={() => move(i, 1)} aria-label={`Move ${v} later`} className="text-ink-3 hover:text-ink">›</button>
              ) : null}
              <button type="button" onClick={() => onChange(values.filter((_, idx) => idx !== i))} aria-label={`Remove ${v}`} className="inline-flex h-4 w-4 items-center justify-center rounded-full text-ink-3 hover:bg-active hover:text-ink">
                <X className="h-3 w-3" strokeWidth={2} />
              </button>
            </li>
          ))}
        </ul>
      ) : null}
      <div className="flex items-center gap-2">
        <TextInput
          id={inputId}
          aria-label={`Add to ${ariaLabel.toLowerCase()}`}
          value={draft}
          placeholder={placeholder}
          invalid={!!err}
          onChange={(e) => { setDraft(e.target.value); setErr(null); }}
          onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); add(); } }}
        />
        <button type="button" onClick={add} disabled={!draft.trim()} className={btn.secondary}>Add</button>
      </div>
      <FieldError>{err}</FieldError>
    </div>
  );
}

/** A 400px confirm. `danger` makes the confirm button destructive. */
export function ConfirmDialog({
  open,
  onOpenChange,
  title,
  children,
  confirmLabel,
  onConfirm,
  danger,
  typed,
  busy,
  error,
  width = 400,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  title: string;
  children?: ReactNode;
  confirmLabel: string;
  onConfirm: () => void | Promise<void>;
  danger?: boolean;
  /** Require this exact text typed before the confirm enables. */
  typed?: string;
  busy?: boolean;
  error?: string | null;
  width?: 400 | 560;
}) {
  const [text, setText] = useState("");
  const inputId = useId();
  useEffect(() => {
    if (!open) {
      const t = setTimeout(() => setText(""), 0);
      return () => clearTimeout(t);
    }
  }, [open]);
  const ready = !typed || text.trim() === typed;
  return (
    <AccountDialog
      open={open}
      onOpenChange={onOpenChange}
      title={title}
      width={width}
      footer={
        <>
          <button type="button" className={btn.ghost} onClick={() => onOpenChange(false)} disabled={busy}>Cancel</button>
          <button
            type="button"
            className={danger ? btn.danger : btn.primary}
            disabled={!ready || busy}
            onClick={() => { void onConfirm(); }}
          >
            {busy ? <Pending /> : null}
            {confirmLabel}
          </button>
        </>
      }
    >
      <div className="flex flex-col gap-3 text-base text-ink">{children}</div>
      {typed ? (
        <div>
          <label htmlFor={inputId} className="mb-1.5 block text-sm font-medium text-ink">
            Type <span className="font-semibold">{typed}</span> to confirm
          </label>
          <TextInput
            id={inputId}
            value={text}
            autoComplete="off"
            onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter" && ready && !busy) { e.preventDefault(); void onConfirm(); } }}
          />
        </div>
      ) : null}
      {error ? <p role="alert" className="rounded-md bg-[var(--os-danger-bg)] px-3 py-2 text-sm text-danger-text">{error}</p> : null}
    </AccountDialog>
  );
}
