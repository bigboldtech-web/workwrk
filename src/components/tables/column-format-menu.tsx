"use client";

/* Column format + highlight-rules popover (Tables Phase 4; Type radios
 * replaced by the Sheets-style "123" Number-format section).
 *
 * Opens from the sheet header's "…" button for every column. There is no
 * "column type" UI anymore (rejected twice): the Number format section IS
 * the type — picking Currency sets col.type AND a starter col.format in
 * one host write (Sheets' Format → Number → Currency mental model). The
 * kind→patch mapping lives in lib/sheet-format-actions so the toolbar's
 * 123 menu and this popover cannot drift. Detail controls (decimals,
 * negative style, date display) and highlight rules are DISPLAY config.
 * All of it writes `column.type` / `column.format` / `column.rules`
 * through the page's persistColumns path (which pushes the change onto
 * the undo stack) and never touches raw cell values.
 *
 * Positioning: absolute inside the header cell (which is position:relative),
 * NOT fixed — the grid header is sticky/transformed, and a fixed popover
 * would detach from its column on horizontal scroll (see the
 * picker-in-dialog rule the app's other popovers follow).
 *
 * Commit cadence: discrete controls (selects, checkboxes, swatches) persist
 * immediately — each is one undoable command. Free-text inputs (currency
 * code, rule value) commit on blur/Enter so a keystroke doesn't become a
 * command apiece.
 */

import { useEffect, useRef } from "react";
import { Plus, Trash2 } from "lucide-react";
import type { ColumnFormat, ConditionalRule } from "@/lib/sheet-format";
import {
  NUMBER_FORMAT_CHOICES,
  kindForColType,
  type NumberFormatKind,
} from "@/lib/sheet-format-actions";

const NUMERIC_TYPES = new Set(["number", "currency", "percent"]);

// Relational/computed legacy types are never offered here — an existing
// column keeps working read-only, and the menu says so instead of showing
// a chooser that could sever its config.
const LEGACY_TYPES = new Set(["link", "lookup", "rollup", "person", "attachment", "formula"]);

// Brand YBRG first (the palette the chips draw from), then two calmer
// extras so a rule can highlight without shouting.
const RULE_COLORS = ["#FFCB00", "#0073EA", "#E2445C", "#00C875", "#FDAB3D", "#A1A1AA"];

const OPERATORS: { value: ConditionalRule["when"]; label: string; needsValue: boolean }[] = [
  { value: "gt", label: ">", needsValue: true },
  { value: "gte", label: "≥", needsValue: true },
  { value: "lt", label: "<", needsValue: true },
  { value: "lte", label: "≤", needsValue: true },
  { value: "eq", label: "=", needsValue: true },
  { value: "neq", label: "≠", needsValue: true },
  { value: "contains", label: "contains", needsValue: true },
  { value: "empty", label: "is empty", needsValue: false },
  { value: "nonempty", label: "is not empty", needsValue: false },
];

const DATE_FORMATS: { value: NonNullable<ColumnFormat["dateFormat"]>; label: string }[] = [
  { value: "iso", label: "2026-08-22 (ISO)" },
  { value: "dmy", label: "22/08/2026" },
  { value: "mdy", label: "08/22/2026" },
  { value: "long", label: "Aug 22, 2026" },
];

const NEGATIVE_STYLES: { value: NonNullable<ColumnFormat["negative"]>; label: string }[] = [
  { value: "minus", label: "-1,234" },
  { value: "parens", label: "(1,234)" },
  { value: "red", label: "-1,234 in red" },
  { value: "parens-red", label: "(1,234) in red" },
];

/** A rule's typed comparison value: numbers stay numbers so gt/lt compare
 *  as magnitudes; anything else stays the text the user typed. */
function coerceRuleValue(raw: string): string | number | undefined {
  const t = raw.trim();
  if (t === "") return undefined;
  const n = Number(t);
  return Number.isFinite(n) ? n : raw;
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="flex items-center justify-between gap-2 text-[12px] text-zinc-600">
      <span className="shrink-0">{label}</span>
      {children}
    </label>
  );
}

const CONTROL = "h-6 rounded border border-zinc-200 bg-white px-1 text-[12px] text-zinc-800 outline-none focus:border-[#0073EA]";

export function ColumnFormatMenu({ colType, format, rules, onNumberFormat, onFormatChange, onRulesChange, onClose }: {
  colType: string;
  format?: ColumnFormat;
  rules?: ConditionalRule[];
  /** Present ⇒ render the 123 Number-format section (current kind checked).
   *  One call per choice; the host applies formatPatchFor(kind) as ONE
   *  persistColumns write so type+format undo together. Legacy colTypes
   *  render a read-only line instead of the chooser. */
  onNumberFormat?: (kind: NumberFormatKind) => void;
  /** Persist the whole format object (undefined clears it). */
  onFormatChange: (format: ColumnFormat | undefined) => void;
  /** Persist the whole rules array (undefined clears it). */
  onRulesChange: (rules: ConditionalRule[] | undefined) => void;
  onClose: () => void;
}) {
  const ref = useRef<HTMLDivElement>(null);

  // Outside mousedown closes; Escape closes. Listeners on window so a click
  // anywhere in the grid (or beyond) dismisses the popover.
  useEffect(() => {
    const onDown = (e: MouseEvent) => {
      if (!ref.current?.contains(e.target as Node)) onClose();
    };
    window.addEventListener("mousedown", onDown);
    return () => window.removeEventListener("mousedown", onDown);
  }, [onClose]);

  const fmt = format ?? {};
  const isNumeric = NUMERIC_TYPES.has(colType);
  const resolvedStyle = fmt.style ?? (colType === "currency" ? "currency" : colType === "percent" ? "percent" : "number");

  /** Merge a patch, drop undefined keys, and clear back to no-format when
   *  nothing is left — an empty {} must not count as "configured". */
  const setFmt = (patch: Partial<ColumnFormat>) => {
    const next: ColumnFormat = { ...fmt, ...patch };
    for (const k of Object.keys(next) as (keyof ColumnFormat)[]) {
      if (next[k] === undefined) delete next[k];
    }
    onFormatChange(Object.keys(next).length > 0 ? next : undefined);
  };

  const ruleList = rules ?? [];
  const setRule = (i: number, patch: Partial<ConditionalRule>) =>
    onRulesChange(ruleList.map((r, j) => (j === i ? { ...r, ...patch } : r)));
  const removeRule = (i: number) => {
    const next = ruleList.filter((_, j) => j !== i);
    onRulesChange(next.length > 0 ? next : undefined);
  };
  const addRule = () =>
    onRulesChange([
      ...ruleList,
      // A comparison seed for numbers (dates compare fine as ISO text via
      // the lib's string fallback); "is not empty" for anything else.
      isNumeric ? { when: "gt", value: 0, bg: RULE_COLORS[0] } : { when: "nonempty", bg: RULE_COLORS[0] },
    ]);

  return (
    <div
      ref={ref}
      // The grid's keyboard shortcuts live on an ancestor: a Delete pressed
      // while a swatch button has focus must configure rules, not clear the
      // selected cells. Escape still closes before it is stopped.
      onKeyDown={(e) => {
        if (e.key === "Escape") onClose();
        e.stopPropagation();
      }}
      onMouseDown={(e) => e.stopPropagation()}
      className="absolute left-0 top-full z-50 mt-1 flex w-[252px] cursor-default flex-col gap-2 rounded-lg border border-zinc-200 bg-white p-3 text-left shadow-xl"
    >
      {onNumberFormat && (
        LEGACY_TYPES.has(colType) ? (
          <div className="text-[11px] leading-snug text-zinc-400">
            {colType === "formula"
              ? "Formula column — edit it via the header's Σ button"
              : "Linked column — managed by legacy tables"}
          </div>
        ) : (
          <>
            <div className="text-[11px] font-semibold uppercase tracking-wide text-zinc-400">Number format</div>
            <div className="grid grid-cols-2 gap-x-2">
              {NUMBER_FORMAT_CHOICES.map((t) => (
                <button
                  key={t.kind}
                  type="button"
                  onClick={() => onNumberFormat(t.kind)}
                  className="flex items-center gap-1.5 rounded px-1 py-0.5 text-left text-[12px] text-zinc-700 hover:bg-zinc-50"
                >
                  <span
                    aria-hidden
                    className={`inline-block h-3 w-3 shrink-0 rounded-full border ${kindForColType(colType) === t.kind ? "border-[4px] border-[#0073EA]" : "border-zinc-300"}`}
                  />
                  {t.label}
                </button>
              ))}
            </div>
          </>
        )
      )}

      {isNumeric && (
        <>
          {/* Detail knobs under the kind picker — "Options" so the header
           * doesn't repeat the Number format section right above it. */}
          <div className="text-[11px] font-semibold uppercase tracking-wide text-zinc-400">Options</div>
          <Row label="Style">
            <select
              className={CONTROL}
              value={fmt.style ?? ""}
              onChange={(e) => setFmt({ style: (e.target.value || undefined) as ColumnFormat["style"] })}
            >
              <option value="">Column default</option>
              <option value="number">Number</option>
              <option value="currency">Currency</option>
              <option value="percent">Percent</option>
            </select>
          </Row>
          {resolvedStyle === "currency" && (
            <Row label="Currency">
              <input
                className={`${CONTROL} w-16 uppercase`}
                defaultValue={fmt.currency ?? "USD"}
                maxLength={3}
                placeholder="USD"
                onKeyDown={(e) => { if (e.key === "Enter") (e.target as HTMLInputElement).blur(); }}
                onBlur={(e) => {
                  const code = e.target.value.trim().toUpperCase();
                  setFmt({ currency: /^[A-Z]{3}$/.test(code) && code !== "USD" ? code : undefined });
                }}
                title="ISO 4217 code, e.g. EUR"
              />
            </Row>
          )}
          <Row label="Decimals">
            <select
              className={CONTROL}
              value={fmt.decimals ?? ""}
              onChange={(e) => setFmt({ decimals: e.target.value === "" ? undefined : Number(e.target.value) })}
            >
              <option value="">Auto</option>
              {Array.from({ length: 11 }, (_, i) => (
                <option key={i} value={i}>{i}</option>
              ))}
            </select>
          </Row>
          <Row label="Thousands separator">
            <input
              type="checkbox"
              className="accent-[#0073EA]"
              checked={fmt.thousands === true}
              onChange={(e) => setFmt({ thousands: e.target.checked ? true : undefined })}
            />
          </Row>
          <Row label="Negative numbers">
            <select
              className={CONTROL}
              value={fmt.negative ?? "minus"}
              onChange={(e) => {
                const v = e.target.value as NonNullable<ColumnFormat["negative"]>;
                setFmt({ negative: v === "minus" ? undefined : v });
              }}
            >
              {NEGATIVE_STYLES.map((n) => (
                <option key={n.value} value={n.value}>{n.label}</option>
              ))}
            </select>
          </Row>
        </>
      )}

      {colType === "date" && (
        <>
          <div className="text-[11px] font-semibold uppercase tracking-wide text-zinc-400">Date format</div>
          <Row label="Display as">
            <select
              className={CONTROL}
              value={fmt.dateFormat ?? "iso"}
              onChange={(e) => {
                const v = e.target.value as NonNullable<ColumnFormat["dateFormat"]>;
                // ISO is the stored shape and the default: keep the Json lean.
                setFmt({ dateFormat: v === "iso" ? undefined : v });
              }}
            >
              {DATE_FORMATS.map((d) => (
                <option key={d.value} value={d.value}>{d.label}</option>
              ))}
            </select>
          </Row>
        </>
      )}

      <div className="mt-1 text-[11px] font-semibold uppercase tracking-wide text-zinc-400">Highlight rules</div>
      {ruleList.map((rule, i) => {
        const op = OPERATORS.find((o) => o.value === rule.when);
        return (
          // Index keys are safe here: rows only append/remove, and the
          // value input is uncontrolled per mount (commit on blur).
          <div key={`${i}-${ruleList.length}`} className="flex items-center gap-1">
            <select
              className={`${CONTROL} min-w-0 flex-1`}
              value={rule.when}
              onChange={(e) => {
                const when = e.target.value as ConditionalRule["when"];
                const needs = OPERATORS.find((o) => o.value === when)?.needsValue;
                setRule(i, { when, ...(needs ? {} : { value: undefined }) });
              }}
            >
              {OPERATORS.map((o) => (
                <option key={o.value} value={o.value}>{o.label}</option>
              ))}
            </select>
            {op?.needsValue && (
              <input
                className={`${CONTROL} w-14 min-w-0`}
                defaultValue={rule.value == null ? "" : String(rule.value)}
                placeholder="value"
                onKeyDown={(e) => { if (e.key === "Enter") (e.target as HTMLInputElement).blur(); }}
                onBlur={(e) => setRule(i, { value: coerceRuleValue(e.target.value) })}
              />
            )}
            <span className="flex shrink-0 items-center gap-0.5">
              {RULE_COLORS.map((c) => (
                <button
                  key={c}
                  type="button"
                  aria-label={`Highlight ${c}`}
                  onClick={() => setRule(i, { bg: c })}
                  className={`h-3.5 w-3.5 rounded-full border ${rule.bg === c ? "border-zinc-700 ring-1 ring-zinc-400" : "border-zinc-200"}`}
                  style={{ background: c }}
                />
              ))}
            </span>
            <button
              type="button"
              aria-label="Remove rule"
              onClick={() => removeRule(i)}
              className="inline-flex h-5 w-5 shrink-0 items-center justify-center rounded text-zinc-300 hover:bg-red-50 hover:text-red-600"
            >
              <Trash2 className="h-3 w-3" />
            </button>
          </div>
        );
      })}
      <button
        type="button"
        onClick={addRule}
        className="inline-flex items-center gap-1 self-start rounded px-1 py-0.5 text-[12px] text-[#0073EA] hover:bg-[#0073EA]/8"
      >
        <Plus className="h-3.5 w-3.5" /> Add rule
      </button>
      {ruleList.length > 1 && (
        <div className="text-[11px] text-zinc-400">First matching rule wins.</div>
      )}
    </div>
  );
}
