"use client";

// FieldValue — render or edit a value for any FieldDef. Two modes:
//   mode="display"  → compact, read-only (used in TABLE cells)
//   mode="edit"     → inline editor (used in drawer rows)
//
// Phase 3f wires editors for Tier 1 types (TEXT, LONG_TEXT, NUMBER,
// DATE, DATETIME, DROPDOWN, MULTI_SELECT, CHECKBOX, LABELS,
// TSHIRT_SIZE, URL, EMAIL, PHONE, MONEY, PERCENT, RATING). Tier 2 /
// AI types render as a muted "—" placeholder until Phase 4+.

import { useEffect, useState } from "react";
import { Check, ChevronDown, Star } from "lucide-react";
import type { FieldChoice, FieldDef } from "@/lib/field-catalog";

interface FieldValueProps {
  field: FieldDef;
  value: unknown;
  mode: "display" | "edit";
  /** Called with the new value when the editor commits. */
  onChange?: (next: unknown) => void;
  /** Editor disabled (read-only). */
  disabled?: boolean;
}

export function FieldValue(props: FieldValueProps) {
  const { field, value, mode, onChange, disabled } = props;
  const readOnly = mode === "display" || disabled || !onChange;

  switch (field.type) {
    case "TEXT":
    case "URL":
    case "EMAIL":
    case "PHONE":
      return <TextValue field={field} value={value} readOnly={readOnly} onChange={onChange} />;
    case "LONG_TEXT":
      return <LongTextValue value={value} readOnly={readOnly} onChange={onChange} />;
    case "NUMBER":
    case "MONEY":
    case "PERCENT":
      return <NumberValue field={field} value={value} readOnly={readOnly} onChange={onChange} />;
    case "DATE":
    case "DATETIME":
      return <DateValue field={field} value={value} readOnly={readOnly} onChange={onChange} />;
    case "CHECKBOX":
      return <CheckboxValue value={value} readOnly={readOnly} onChange={onChange} />;
    case "DROPDOWN":
    case "TSHIRT_SIZE":
      return <DropdownValue field={field} value={value} readOnly={readOnly} onChange={onChange} />;
    case "MULTI_SELECT":
    case "LABELS":
      return <MultiSelectValue field={field} value={value} readOnly={readOnly} onChange={onChange} />;
    case "RATING":
      return <RatingValue field={field} value={value} readOnly={readOnly} onChange={onChange} />;
    default:
      return <span className="text-xs text-muted">—</span>;
  }
}

// ── Text-like (TEXT, URL, EMAIL, PHONE) ───────────────────────────

function TextValue({
  field,
  value,
  readOnly,
  onChange,
}: {
  field: FieldDef;
  value: unknown;
  readOnly: boolean;
  onChange?: (v: string) => void;
}) {
  const v = typeof value === "string" ? value : "";
  const [draft, setDraft] = useState(v);
  useEffect(() => setDraft(v), [v]);
  if (readOnly) {
    if (!v) return <span className="text-xs text-muted">—</span>;
    if (field.type === "URL" && /^https?:\/\//.test(v)) {
      return <a href={v} className="text-sm text-[var(--os-brand)] hover:underline truncate inline-block max-w-full" target="_blank" rel="noreferrer">{v}</a>;
    }
    if (field.type === "EMAIL" && v.includes("@")) {
      return <a href={`mailto:${v}`} className="text-sm text-[var(--os-brand)] hover:underline">{v}</a>;
    }
    return <span className="text-sm">{v}</span>;
  }
  return (
    <input
      type={field.type === "URL" ? "url" : field.type === "EMAIL" ? "email" : field.type === "PHONE" ? "tel" : "text"}
      value={draft}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={() => { if (draft !== v) onChange?.(draft); }}
      onKeyDown={(e) => { if (e.key === "Enter") (e.currentTarget as HTMLInputElement).blur(); }}
      className="w-full bg-transparent text-sm outline-none border-b border-transparent focus:border-[var(--os-brand)]"
      placeholder="—"
    />
  );
}

function LongTextValue({
  value,
  readOnly,
  onChange,
}: {
  value: unknown;
  readOnly: boolean;
  onChange?: (v: string) => void;
}) {
  const v = typeof value === "string" ? value : "";
  const [draft, setDraft] = useState(v);
  useEffect(() => setDraft(v), [v]);
  if (readOnly) {
    if (!v) return <span className="text-xs text-muted">—</span>;
    return <span className="text-sm whitespace-pre-wrap break-words">{v}</span>;
  }
  return (
    <textarea
      rows={3}
      value={draft}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={() => { if (draft !== v) onChange?.(draft); }}
      className="w-full px-2 py-1 rounded-md border border-border bg-surface text-sm resize-y focus:outline-none focus:border-[var(--os-brand)]"
      placeholder="—"
    />
  );
}

// ── Number-like (NUMBER, MONEY, PERCENT) ──────────────────────────

function NumberValue({
  field,
  value,
  readOnly,
  onChange,
}: {
  field: FieldDef;
  value: unknown;
  readOnly: boolean;
  onChange?: (v: number | null) => void;
}) {
  const n = typeof value === "number" ? value : null;
  const [draft, setDraft] = useState<string>(n == null ? "" : String(n));
  useEffect(() => setDraft(n == null ? "" : String(n)), [n]);

  const formatDisplay = (x: number): string => {
    const decimals = field.options?.decimals ?? (field.type === "MONEY" ? 2 : 0);
    if (field.type === "MONEY") {
      const cur = field.options?.currency ?? "USD";
      try {
        return new Intl.NumberFormat(undefined, { style: "currency", currency: cur, minimumFractionDigits: decimals, maximumFractionDigits: decimals }).format(x);
      } catch {
        return `${cur} ${x.toFixed(decimals)}`;
      }
    }
    if (field.type === "PERCENT") return `${x.toFixed(decimals)}%`;
    return x.toFixed(decimals);
  };

  if (readOnly) {
    if (n == null) return <span className="text-xs text-muted">—</span>;
    return <span className="text-sm">{formatDisplay(n)}</span>;
  }
  return (
    <input
      type="number"
      step="any"
      value={draft}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={() => {
        if (draft === "") { if (n != null) onChange?.(null); return; }
        const parsed = Number(draft);
        if (!Number.isFinite(parsed)) return;
        if (parsed !== n) onChange?.(parsed);
      }}
      className="w-full bg-transparent text-sm outline-none border-b border-transparent focus:border-[var(--os-brand)]"
      placeholder="—"
    />
  );
}

// ── Date / DateTime ───────────────────────────────────────────────

function DateValue({
  field,
  value,
  readOnly,
  onChange,
}: {
  field: FieldDef;
  value: unknown;
  readOnly: boolean;
  onChange?: (v: string | null) => void;
}) {
  const v = typeof value === "string" ? value : "";
  if (readOnly) {
    if (!v) return <span className="text-xs text-muted">—</span>;
    try {
      const d = new Date(v);
      return (
        <span className="text-sm">
          {field.type === "DATETIME" ? d.toLocaleString() : d.toLocaleDateString()}
        </span>
      );
    } catch {
      return <span className="text-sm">{v}</span>;
    }
  }
  const kind: "DATE" | "DATETIME" = field.type === "DATETIME" ? "DATETIME" : "DATE";
  return (
    <input
      type={kind === "DATETIME" ? "datetime-local" : "date"}
      value={toInputDate(v, kind)}
      onChange={(e) => onChange?.(e.target.value || null)}
      className="bg-transparent text-sm outline-none border-b border-transparent focus:border-[var(--os-brand)]"
    />
  );
}

function toInputDate(raw: string, type: "DATE" | "DATETIME"): string {
  if (!raw) return "";
  try {
    const d = new Date(raw);
    if (isNaN(d.getTime())) return "";
    if (type === "DATE") return d.toISOString().slice(0, 10);
    // datetime-local wants YYYY-MM-DDTHH:mm
    const pad = (n: number) => String(n).padStart(2, "0");
    return `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
  } catch {
    return "";
  }
}

// ── Checkbox ──────────────────────────────────────────────────────

function CheckboxValue({
  value,
  readOnly,
  onChange,
}: {
  value: unknown;
  readOnly: boolean;
  onChange?: (v: boolean) => void;
}) {
  const checked = !!value;
  return (
    <button
      type="button"
      disabled={readOnly}
      onClick={() => onChange?.(!checked)}
      className={`inline-flex items-center justify-center w-[18px] h-[18px] rounded border ${
        checked ? "bg-[var(--os-brand)] border-[var(--os-brand)] text-white" : "border-border text-transparent"
      } ${readOnly ? "cursor-default opacity-70" : ""}`}
      aria-checked={checked}
    >
      <Check className="w-3 h-3" />
    </button>
  );
}

// ── Dropdown (single choice) ──────────────────────────────────────

function DropdownValue({
  field,
  value,
  readOnly,
  onChange,
}: {
  field: FieldDef;
  value: unknown;
  readOnly: boolean;
  onChange?: (v: string | null) => void;
}) {
  const choices: FieldChoice[] = field.options?.choices ?? [];
  const v = typeof value === "string" ? value : "";
  const current = choices.find((c) => c.value === v) ?? null;
  const [open, setOpen] = useState(false);

  const pill = current ? (
    <span
      className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium"
      style={{ background: `${current.color ?? "#94a3b8"}22`, color: current.color ?? "#475569" }}
    >
      {current.label}
    </span>
  ) : (
    <span className="text-xs text-muted">—</span>
  );

  if (readOnly) return pill;
  return (
    <div className="relative inline-block">
      <button type="button" onClick={() => setOpen((x) => !x)} className="inline-flex items-center gap-1.5">
        {pill}
        <ChevronDown className="w-3 h-3 text-muted" />
      </button>
      {open ? (
        <div className="absolute z-10 mt-1 left-0 min-w-[180px] rounded-md border border-border bg-surface shadow-lg py-1" onMouseLeave={() => setOpen(false)}>
          {choices.length === 0 ? (
            <div className="px-2 py-1 text-xs text-muted">No options yet</div>
          ) : (
            choices.map((c) => (
              <button
                key={c.value}
                type="button"
                onClick={() => { onChange?.(c.value); setOpen(false); }}
                className="flex items-center gap-2 w-full px-2 py-1.5 text-left text-sm hover:bg-surface-2"
              >
                <span
                  className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium"
                  style={{ background: `${c.color ?? "#94a3b8"}22`, color: c.color ?? "#475569" }}
                >
                  {c.label}
                </span>
                {c.value === v ? <Check className="w-3.5 h-3.5 ml-auto text-[var(--os-brand)]" /> : null}
              </button>
            ))
          )}
          <button
            type="button"
            onClick={() => { onChange?.(null); setOpen(false); }}
            className="block w-full px-2 py-1.5 text-left text-xs text-muted hover:bg-surface-2"
          >
            Clear
          </button>
        </div>
      ) : null}
    </div>
  );
}

// ── Multi-select / Labels (array of choice values) ────────────────

function MultiSelectValue({
  field,
  value,
  readOnly,
  onChange,
}: {
  field: FieldDef;
  value: unknown;
  readOnly: boolean;
  onChange?: (v: string[]) => void;
}) {
  const choices: FieldChoice[] = field.options?.choices ?? [];
  const values = Array.isArray(value) ? (value as string[]) : [];
  const chips = values.map((v) => choices.find((c) => c.value === v)).filter((c): c is FieldChoice => !!c);

  if (readOnly) {
    if (chips.length === 0) return <span className="text-xs text-muted">—</span>;
    return (
      <span className="flex flex-wrap gap-1">
        {chips.map((c) => (
          <span
            key={c.value}
            className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium"
            style={{ background: `${c.color ?? "#94a3b8"}22`, color: c.color ?? "#475569" }}
          >
            {c.label}
          </span>
        ))}
      </span>
    );
  }
  const toggle = (val: string) => {
    const next = values.includes(val) ? values.filter((x) => x !== val) : [...values, val];
    onChange?.(next);
  };
  return (
    <div className="flex flex-wrap gap-1">
      {choices.length === 0 ? (
        <span className="text-xs text-muted">No options yet</span>
      ) : (
        choices.map((c) => {
          const on = values.includes(c.value);
          return (
            <button
              key={c.value}
              type="button"
              onClick={() => toggle(c.value)}
              className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-medium ${
                on ? "" : "opacity-50"
              }`}
              style={{ background: `${c.color ?? "#94a3b8"}22`, color: c.color ?? "#475569" }}
            >
              {c.label}
            </button>
          );
        })
      )}
    </div>
  );
}

// ── Rating (1..N stars) ───────────────────────────────────────────

function RatingValue({
  field,
  value,
  readOnly,
  onChange,
}: {
  field: FieldDef;
  value: unknown;
  readOnly: boolean;
  onChange?: (v: number | null) => void;
}) {
  const max = field.options?.ratingMax ?? 5;
  const n = typeof value === "number" ? Math.max(0, Math.min(max, value)) : 0;
  return (
    <div className="inline-flex items-center gap-0.5">
      {Array.from({ length: max }, (_, i) => i + 1).map((i) => (
        <button
          key={i}
          type="button"
          disabled={readOnly}
          onClick={() => onChange?.(i === n ? null : i)}
          className={readOnly ? "cursor-default" : "cursor-pointer"}
          aria-label={`Rate ${i}`}
        >
          <Star className={`w-4 h-4 ${i <= n ? "fill-amber-400 text-amber-400" : "text-muted"}`} />
        </button>
      ))}
    </div>
  );
}
