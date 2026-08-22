"use client";

/* FormulaBar — Tables Phase 3 (docs/plans/tables.md).
 *
 * Two exports:
 *
 *   FormulaTextInput — a single-line formula input with reference
 *   highlighting (an overlay renders the same text with each ref token
 *   coloured; the input's own text is transparent so the two never
 *   disagree) and optional function autocomplete fed by the engine's
 *   FUNCTIONS metadata. Commit/cancel semantics belong to the CALLER:
 *   this component only reports value changes and forwards the keys it
 *   did not consume, so the page can wire it into the same
 *   cancel-ref/blur-commit contract its cell editors use.
 *
 *   FormulaBar — the fx bar above the sheet grid, laid out like Google
 *   Sheets': a bordered cell-address box on the left, an italic "fx"
 *   glyph, then the formula input stretching the full width. Behaviour is
 *   unchanged from the pre-reskin bar: the cell's source is editable with
 *   the same Enter-commits / Escape-cancels / blur-commits semantics as
 *   in-cell editing (cancel is a ref raised BEFORE blur, because blur
 *   fires in the same tick and must read it synchronously).
 *
 * The bar lives OUTSIDE the grid element, so its keystrokes never reach
 * the grid's keydown handler at all — no shortcut stealing in either
 * direction (the grid's EDITABLE_SEL guard is for editors inside it).
 */

import { useEffect, useMemo, useRef, useState } from "react";
import { FUNCTIONS, tokenize } from "@/lib/sheet-engine";

/* Distinct colour per distinct ref, cycling — how Sheets/Excel paint the
 * refs of the formula being edited. First entry is the brand blue. */
const REF_PALETTE = ["#0073EA", "#D83A52", "#007A5A", "#9D5BD2", "#B7791F"];

/* Both layers of the highlight trick (coloured overlay + transparent-text
 * input) must render text with IDENTICAL metrics or the colours drift off
 * the characters, so the shared classes live in one place. */
const TEXT_CLS = "font-mono text-[12.5px]";

type Segment = { text: string; color: string | null };

/** Split a formula source into coloured segments. Only text that IS a
 *  formula (leading "=") is tokenized; literals stay uncoloured. A source
 *  that fails to lex (half-typed string, stray bracket) renders plain —
 *  the input keeps working, the colours simply pause. */
function highlightSegments(text: string): Segment[] {
  if (!text.startsWith("=")) return [{ text, color: null }];
  const lexed = tokenize(text);
  if (!lexed.ok) return [{ text, color: null }];
  const colorByRef = new Map<string, string>();
  const out: Segment[] = [];
  let pos = 0;
  for (const tok of lexed.tokens) {
    if (tok.type !== "ref") continue;
    const key = tok.text.toUpperCase();
    if (!colorByRef.has(key)) {
      colorByRef.set(key, REF_PALETTE[colorByRef.size % REF_PALETTE.length]);
    }
    if (tok.start > pos) out.push({ text: text.slice(pos, tok.start), color: null });
    out.push({ text: text.slice(tok.start, tok.end), color: colorByRef.get(key)! });
    pos = tok.end;
  }
  if (pos < text.length) out.push({ text: text.slice(pos), color: null });
  return out.length ? out : [{ text, color: null }];
}

export type FunctionItem = { name: string; signature: string; summary: string };

const FUNCTION_ITEMS: FunctionItem[] = [...FUNCTIONS.values()]
  .map((f) => ({ name: f.name, signature: f.signature, summary: f.summary }))
  .sort((a, b) => a.name.localeCompare(b.name));

const MAX_MENU_ITEMS = 9;

/** The partial function name under the caret, if the position can take a
 *  function: the word must follow "=", "(", a separator or an operator —
 *  never sit inside a [Header] ref or dangle after another value. */
function functionWordAt(value: string, caret: number): { wordStart: number; word: string } | null {
  if (!value.startsWith("=")) return null;
  const m = /([A-Za-z_][A-Za-z0-9_]*)$/.exec(value.slice(0, caret));
  if (!m) return null;
  const wordStart = caret - m[1].length;
  let i = wordStart - 1;
  while (i >= 0 && /\s/.test(value[i])) i--;
  if (i < 0) return null;
  if (!"=(,+-*/^&<>%:".includes(value[i])) return null;
  return { wordStart, word: m[1] };
}

export function FormulaTextInput({
  value,
  onValueChange,
  onKeyDown,
  onBlur,
  onFocus,
  readOnly = false,
  placeholder,
  withAutocomplete = false,
  className = "",
  ariaLabel = "Formula",
}: {
  value: string;
  onValueChange: (next: string) => void;
  /** Receives only the keys the autocomplete menu did not consume. */
  onKeyDown?: (e: React.KeyboardEvent<HTMLInputElement>) => void;
  onBlur?: (e: React.FocusEvent<HTMLInputElement>) => void;
  onFocus?: (e: React.FocusEvent<HTMLInputElement>) => void;
  readOnly?: boolean;
  placeholder?: string;
  withAutocomplete?: boolean;
  /** Sizing/padding for the whole control (height, px) — text metrics are fixed. */
  className?: string;
  ariaLabel?: string;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const overlayRef = useRef<HTMLSpanElement>(null);
  const [menu, setMenu] = useState<{ items: FunctionItem[]; sel: number; wordStart: number } | null>(null);

  const segments = useMemo(() => highlightSegments(value), [value]);

  // The overlay must pan exactly with the input's own horizontal scroll,
  // including the scroll a keystroke causes when the caret runs past the
  // right edge (no scroll event fires for that in every browser).
  const syncScroll = () => {
    if (overlayRef.current && inputRef.current) {
      overlayRef.current.scrollLeft = inputRef.current.scrollLeft;
    }
  };
  useEffect(syncScroll, [value]);

  const refreshMenu = (nextValue: string, caret: number | null) => {
    if (!withAutocomplete || readOnly || caret == null) {
      setMenu(null);
      return;
    }
    const ctx = functionWordAt(nextValue, caret);
    if (!ctx) {
      setMenu(null);
      return;
    }
    const prefix = ctx.word.toUpperCase();
    const items = FUNCTION_ITEMS.filter((f) => f.name.startsWith(prefix)).slice(0, MAX_MENU_ITEMS);
    setMenu(items.length ? { items, sel: 0, wordStart: ctx.wordStart } : null);
  };

  const insertFunction = (item: FunctionItem) => {
    const el = inputRef.current;
    const caret = el?.selectionStart ?? value.length;
    const ctx = functionWordAt(value, caret);
    setMenu(null);
    if (!ctx) return;
    const next = value.slice(0, ctx.wordStart) + item.name + "(" + value.slice(caret);
    onValueChange(next);
    // The caret lands after the "(", once the controlled value has rendered.
    const caretTarget = ctx.wordStart + item.name.length + 1;
    requestAnimationFrame(() => {
      const node = inputRef.current;
      if (!node) return;
      node.focus();
      node.setSelectionRange(caretTarget, caretTarget);
    });
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (menu && menu.items.length > 0) {
      // The menu owns these keys; they must not fall through to the
      // caller's commit/cancel handling (Enter picks a function, it does
      // not commit the cell; Escape closes the menu, it does not cancel
      // the edit).
      if (e.key === "ArrowDown" || e.key === "ArrowUp") {
        e.preventDefault();
        e.stopPropagation();
        const d = e.key === "ArrowDown" ? 1 : -1;
        setMenu({ ...menu, sel: (menu.sel + d + menu.items.length) % menu.items.length });
        return;
      }
      if (e.key === "Enter" || e.key === "Tab") {
        e.preventDefault();
        e.stopPropagation();
        insertFunction(menu.items[menu.sel]);
        return;
      }
      if (e.key === "Escape") {
        e.preventDefault();
        e.stopPropagation();
        setMenu(null);
        return;
      }
    }
    onKeyDown?.(e);
  };

  return (
    <span className={`relative block min-w-0 flex-1 ${className}`}>
      <span
        ref={overlayRef}
        aria-hidden
        className={`pointer-events-none absolute inset-0 flex items-center overflow-hidden px-2 ${TEXT_CLS}`}
      >
        {segments.map((s, i) => (
          <span key={i} className="whitespace-pre" style={s.color ? { color: s.color } : { color: "var(--os-ink, #3f3f46)" }}>
            {s.text}
          </span>
        ))}
      </span>
      <input
        ref={inputRef}
        type="text"
        value={value}
        readOnly={readOnly}
        placeholder={placeholder}
        aria-label={ariaLabel}
        role={withAutocomplete ? "combobox" : undefined}
        aria-autocomplete={withAutocomplete ? "list" : undefined}
        aria-expanded={withAutocomplete ? !!menu : undefined}
        spellCheck={false}
        autoComplete="off"
        className={`relative h-full w-full bg-transparent px-2 text-transparent caret-zinc-800 outline-none placeholder:text-zinc-400 ${TEXT_CLS}`}
        onChange={(e) => {
          onValueChange(e.target.value);
          refreshMenu(e.target.value, e.target.selectionStart);
        }}
        onSelect={(e) => {
          const el = e.target as HTMLInputElement;
          // Caret moves (arrows, clicks) re-evaluate whether the menu
          // still applies at the new position.
          if (menu) refreshMenu(el.value, el.selectionStart);
        }}
        onScroll={syncScroll}
        onKeyDown={handleKeyDown}
        onBlur={(e) => {
          setMenu(null);
          onBlur?.(e);
        }}
        onFocus={onFocus}
      />
      {menu && menu.items.length > 0 && (
        <div
          role="listbox"
          aria-label="Functions"
          className="absolute left-0 top-full z-40 mt-1 max-h-72 w-[360px] overflow-y-auto rounded-lg border border-zinc-200 bg-white py-1 shadow-lg"
        >
          {menu.items.map((f, i) => (
            <button
              key={f.name}
              type="button"
              role="option"
              aria-selected={i === menu.sel}
              className={`flex w-full flex-col items-start gap-0.5 px-3 py-1.5 text-left ${i === menu.sel ? "bg-[#0073EA]/8" : "hover:bg-zinc-50"}`}
              // mousedown, not click: click would blur the input first and
              // the blur-commit would fire before the insertion.
              onMouseDown={(e) => {
                e.preventDefault();
                insertFunction(f);
              }}
              onMouseEnter={() => setMenu((m) => (m ? { ...m, sel: i } : m))}
            >
              <span className="font-mono text-[12px] font-medium text-zinc-800">{f.signature}</span>
              <span className="text-[11.5px] leading-snug text-zinc-500">{f.summary}</span>
            </button>
          ))}
        </div>
      )}
    </span>
  );
}

export type FormulaBarCell = {
  /** A1-style address, spelled against the UNSORTED row order — the row
   *  number a formula ref would actually resolve to. */
  address: string;
  /** Editable text: a formula cell's source, or the literal spelled the
   *  way the cell editors read and write it. */
  source: string;
  readOnly?: boolean;
  readOnlyReason?: string;
};

interface FormulaBarProps {
  cell: FormulaBarCell | null;
  /** Raw text the user committed (Enter or blur). The page owns what it
   *  means: "=…" becomes a stored formula, anything else a typed literal. */
  onCommit: (raw: string) => void;
  onReadOnlyEdit?: (reason: string) => void;
}

export function FormulaBar(props: FormulaBarProps) {
  // Keyed remount on cell change: a half-typed draft belongs to the cell
  // the user just left and must never follow the selection to a new one —
  // resetting by identity avoids a setState-in-effect cascade.
  return <FormulaBarRow key={props.cell?.address ?? ""} {...props} />;
}

function FormulaBarRow({ cell, onCommit, onReadOnlyEdit }: FormulaBarProps) {
  // null = not editing; the input mirrors the cell. Same commit contract
  // as the in-cell editors: blur commits, and Escape raises a ref BEFORE
  // blurring so the blur handler can read it synchronously and skip.
  const [draft, setDraft] = useState<string | null>(null);
  const cancelRef = useRef(false);
  const address = cell?.address ?? "";

  const shown = draft ?? cell?.source ?? "";
  const disabled = !cell;
  const readOnly = disabled || !!cell?.readOnly;

  const commit = () => {
    if (!cell || readOnly) return;
    if (draft != null && draft !== cell.source) onCommit(draft);
    setDraft(null);
  };

  return (
    // Sheets layout: square-edged full-width strip sitting flush between
    // the toolbar and the grid (border-b only), address box + "fx" glyph +
    // the input. overflow-visible stays: the autocomplete menu hangs below.
    <div className="flex h-7 shrink-0 items-stretch overflow-visible border-b border-t border-zinc-200 bg-white">
      <div
        className="flex w-16 shrink-0 items-center justify-center border-r border-zinc-200 font-mono text-[12px] font-medium text-zinc-600"
        title="Active cell"
      >
        {address}
      </div>
      <div className="flex w-8 shrink-0 items-center justify-center border-r border-zinc-100 font-serif text-[13px] italic text-zinc-400 select-none" title="Formula" aria-hidden>
        fx
      </div>
      <FormulaTextInput
        value={shown}
        onValueChange={(next) => {
          if (readOnly) return;
          setDraft(next);
        }}
        readOnly={readOnly}
        placeholder={disabled ? "Select a cell" : "Type a value, or = to start a formula"}
        withAutocomplete
        ariaLabel={cell ? `Formula for ${cell.address}` : "Formula"}
        onKeyDown={(e) => {
          if (readOnly) {
            // The cell can't take text (column formula, computed or picker
            // column) — say why instead of silently eating keystrokes.
            if (e.key.length === 1 && cell?.readOnlyReason) onReadOnlyEdit?.(cell.readOnlyReason);
            return;
          }
          if (e.key === "Enter") {
            e.preventDefault();
            (e.target as HTMLInputElement).blur(); // blur runs the commit below
          } else if (e.key === "Escape") {
            e.preventDefault();
            cancelRef.current = true; // before blur — blur reads it this tick
            setDraft(null);
            (e.target as HTMLInputElement).blur();
          }
        }}
        onBlur={() => {
          if (cancelRef.current) {
            cancelRef.current = false;
            setDraft(null);
            return;
          }
          commit();
        }}
      />
    </div>
  );
}
