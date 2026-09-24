"use client";

// Picker, the ONE popover list in the product (design-system 5.6).
//
// Before this there were five: the assignee picker, the priority picker, the
// tag picker, the type picker and an inline status menu, each with its own
// width, its own `fixed inset-0` backdrop, its own z-index and its own idea of
// what a keyboard does. One of them closed on `onMouseLeave`, which cannot be
// used with a keyboard or a trackpad at all.
//
// The anatomy, quoted from the design system:
//
//   Width 280 (min 240; date 288), surface, 1px line, radius 8, shadow-pop,
//   padding 4. Search input at the top (36px, auto-focused, borderless with a
//   bottom line), HIDDEN when the list has fewer than 6 items. Rows 36: 16px
//   glyph + label 14/400 + right-aligned kbd hint or check (multi-select keeps
//   it open). Sections via 11/600 uppercase labels. Footer only for a real
//   door ("Manage statuses"). Keyboard: up/down Enter Esc, type-ahead.
//   Inside a dialog: position:absolute child, NEVER portalled.
//
// That last line is load-bearing and is why this component renders no portal:
// a portalled popover inside the task drawer escapes the drawer's focus trap
// and lands behind the scrim of whatever opens next.

import { useCallback, useEffect, useId, useMemo, useRef, useState, type ReactNode } from "react";
import { Check, Search } from "lucide-react";
import { useLayer } from "@/components/layout/os/shell-context";
import { SkeletonLines } from "@/components/ui/skeleton";

// Which open Picker owns the arrow keys. Two can be mounted at once (a Picker
// inside a drawer whose host list also has one open behind it), and only the
// most recently opened may answer a keypress, so the stack is module level
// rather than per instance.
const openPickers: string[] = [];

export interface PickerOption {
  value: string;
  label: string;
  /** 16px glyph, identical to the one the value renders with in the list. */
  glyph?: ReactNode;
  /** A second line under the label (a KPI's parent KRA, a List's Space). */
  description?: string;
  /** Right-aligned hint text, in place of the check. */
  hint?: string;
  /** Extra text the type-ahead should match on (an email, a Space name). */
  keywords?: string;
  disabled?: boolean;
}

export interface PickerSectionDef {
  /** 11/600 uppercase section label; omit for an unlabelled run of rows. */
  label?: string;
  options: PickerOption[];
}

export interface PickerProps {
  open: boolean;
  onClose: () => void;
  sections: PickerSectionDef[];
  /** One value, or the set of checked values in multi mode. */
  selected?: string | string[] | null;
  /** Multi keeps the popover open and renders checks on every chosen row. */
  multi?: boolean;
  onSelect: (value: string) => void;
  searchPlaceholder?: string;
  /** Force the search field on (a remote-searching picker with few rows). */
  alwaysSearch?: boolean;
  /** Called on every keystroke when the caller searches server-side. */
  onSearchChange?: (query: string) => void;
  width?: number;
  /** Which edge of the trigger the popover lines up with. */
  align?: "start" | "end";
  /** Above the trigger instead of below (a composer at the foot of a drawer). */
  side?: "bottom" | "top";
  /** One ghost row at the bottom: "Manage statuses", "Unassign all". */
  footer?: ReactNode;
  /** Shown in place of the rows when everything is filtered away. */
  emptyLabel?: string;
  /** Options are still arriving: skeleton lines under the rows, never a "Loading" string. */
  loading?: boolean;
  /** Accessible name for the listbox. */
  ariaLabel?: string;
  className?: string;
  /**
   * Highlight this row instead of the one this component is tracking, for the
   * one case where focus has to stay somewhere else: the @-mention typeahead,
   * where the caret must remain in the textarea the person is typing in, so
   * the arrow keys are answered by the caller and the list only shows where
   * they got to.
   */
  activeValue?: string | null;
  /** The typeahead also owns its own focus, so the list must not steal it. */
  autoFocusList?: boolean;
  /**
   * The transparent click-out catcher. On by default. The @-mention typeahead
   * turns it off: it floats over the very textarea the person is typing in, so
   * a catcher would eat the click that moves their caret.
   */
  backdrop?: boolean;
  /**
   * Pin the popover to a VIEWPORT POINT instead of to its trigger.
   *
   * The row menus mount a triggerless ItemMoreMenu (a right-click opens it at
   * the pointer), and a triggerless host renders no button, so its wrapper
   * span has no size: "just under the trigger" resolved to wherever that empty
   * span happened to sit in the renderer's DOM, which on Calendar, Gantt,
   * Timeline, Hierarchy and Cards put the destination list behind the sidebar
   * and below the fold. When there is no trigger, the click point is the only
   * honest anchor. Clamped to stay on screen.
   */
  anchorPoint?: { top: number; left: number } | null;
}

/** Roughly how tall a pinned popover gets: the 280px list plus its search row,
 *  footer and padding. Used only to keep it on screen, so an estimate is the
 *  right tool: the alternative is measuring after paint, which costs a frame
 *  the user sees. */
const PINNED_MAX_HEIGHT = 360;

/** Keep a pinned popover inside the viewport, never off the left/top edge. */
function clampToViewport(value: number, size: number, axis: "x" | "y"): number {
  if (typeof window === "undefined") return value;
  const limit = (axis === "x" ? window.innerWidth : window.innerHeight) - size - 8;
  return Math.max(8, Math.min(value, Math.max(8, limit)));
}

/** Flatten for keyboard traversal: sections are visual, not navigational. */
function flatten(sections: PickerSectionDef[]): PickerOption[] {
  return sections.flatMap((s) => s.options);
}

function matches(option: PickerOption, needle: string): boolean {
  if (!needle) return true;
  const hay = `${option.label} ${option.description ?? ""} ${option.keywords ?? ""}`.toLowerCase();
  return hay.includes(needle);
}

export function Picker({
  open,
  onClose,
  sections,
  selected = null,
  multi = false,
  onSelect,
  searchPlaceholder = "Search…",
  alwaysSearch = false,
  onSearchChange,
  width = 280,
  align = "start",
  side = "bottom",
  footer,
  emptyLabel = "No matches",
  loading = false,
  ariaLabel,
  className = "",
  activeValue = null,
  autoFocusList,
  backdrop = true,
  anchorPoint = null,
}: PickerProps) {
  const [query, setQuery] = useState("");
  const [internalIdx, setInternalIdx] = useState(0);
  // Reset on OPEN, adjusted during render rather than in an effect: an effect
  // would paint one frame with the previous query still in the box.
  const [openedFor, setOpenedFor] = useState(open);
  if (openedFor !== open) {
    setOpenedFor(open);
    if (open) {
      setQuery("");
      setInternalIdx(0);
    }
  }
  const listRef = useRef<HTMLDivElement>(null);
  const listboxId = useId();
  const instanceId = useId();

  // Esc goes through the shell's LayerStack, exactly as the Drawer does.
  // Before this the Picker registered nothing, so one Esc inside the task
  // drawer closed the picker AND the drawer and navigated back to the list.
  // The picker is registered last, so it is the top layer and Esc stops here.
  useLayer(open, { id: `picker-${instanceId}`, kind: "popover", close: onClose });

  const total = useMemo(() => flatten(sections).length, [sections]);
  const showSearch = alwaysSearch || total >= 6;

  const filtered = useMemo(() => {
    const needle = query.trim().toLowerCase();
    // A caller that searches server-side has already filtered; filtering again
    // here would hide rows the server deliberately returned.
    if (onSearchChange) return sections;
    if (!needle) return sections;
    return sections
      .map((s) => ({ ...s, options: s.options.filter((o) => matches(o, needle)) }))
      .filter((s) => s.options.length > 0);
  }, [sections, query, onSearchChange]);

  const rows = useMemo(() => flatten(filtered), [filtered]);

  // The highlighted row: the caller's when it controls one (the @-mention
  // typeahead, whose caret never leaves the textarea), otherwise this
  // component's own.
  const controlledIdx = activeValue == null ? -1 : rows.findIndex((r) => r.value === activeValue);
  // Clamped rather than corrected in state: filtering the list shorter must
  // not cost a second render pass.
  const activeIdx = controlledIdx >= 0 ? controlledIdx : internalIdx < rows.length ? internalIdx : 0;

  const chosen = useMemo(() => {
    if (Array.isArray(selected)) return new Set(selected);
    return new Set(selected ? [selected] : []);
  }, [selected]);

  const pick = useCallback(
    (option: PickerOption) => {
      if (option.disabled) return;
      onSelect(option.value);
      if (!multi) onClose();
    },
    [onSelect, multi, onClose],
  );

  // The caller owns the arrows in exactly one case: the @-mention typeahead,
  // where the caret must stay in the textarea. It passes `activeValue`, and
  // then this component listens for nothing.
  const selfDriven = activeValue == null;

  // Track which Picker is on top of the open stack.
  useEffect(() => {
    if (!open || !selfDriven) return;
    openPickers.push(instanceId);
    return () => {
      const at = openPickers.lastIndexOf(instanceId);
      if (at >= 0) openPickers.splice(at, 1);
    };
  }, [open, selfDriven, instanceId]);

  // ONE window listener, in the capture phase, rather than a React onKeyDown
  // on the popover div. The div is never focused (the rows are buttons, the
  // search box is an input), so a React handler on it could only ever fire for
  // a keypress that started inside it, which is why arrow keys and Enter did
  // nothing at all here before: the listbox's `autoFocus` is inert on a div,
  // because React sets the attribute after mount and browsers only honour it
  // during parse.
  useEffect(() => {
    if (!open || !selfDriven) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.defaultPrevented) return;
      // Only the top picker answers.
      if (openPickers[openPickers.length - 1] !== instanceId) return;
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      if (e.key === "ArrowDown") {
        e.preventDefault();
        setInternalIdx((i) => (rows.length ? (i + 1) % rows.length : 0));
        return;
      }
      if (e.key === "ArrowUp") {
        e.preventDefault();
        setInternalIdx((i) => (rows.length ? (i - 1 + rows.length) % rows.length : 0));
        return;
      }
      if (e.key === "Home" && rows.length) {
        e.preventDefault();
        setInternalIdx(0);
        return;
      }
      if (e.key === "End" && rows.length) {
        e.preventDefault();
        setInternalIdx(rows.length - 1);
        return;
      }
      if (e.key === "Enter") {
        const row = rows[activeIdx];
        if (row && !row.disabled) {
          e.preventDefault();
          pick(row);
        }
      }
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [open, selfDriven, instanceId, rows, activeIdx, pick]);

  // Put focus where the keys are read from, so a screen reader follows along
  // and a tab out of the popover lands somewhere sane.
  useEffect(() => {
    if (!open || autoFocusList === false) return;
    if (showSearch) return; // the search input carries its own autoFocus
    const el = listRef.current;
    if (el && !el.contains(document.activeElement)) el.focus({ preventScroll: true });
  }, [open, showSearch, autoFocusList]);

  // Keep the active row on screen for a keyboard user.
  useEffect(() => {
    if (!open) return;
    const el = listRef.current?.querySelector<HTMLElement>(`[data-picker-idx="${activeIdx}"]`);
    el?.scrollIntoView({ block: "nearest" });
  }, [activeIdx, open]);

  if (!open) return null;

  let idx = -1;
  return (
    <>
      {/* The click-out catcher. Transparent, below the popover, above the page:
          one element rather than a document listener, so a click never lands on
          the control underneath on its way out. */}
      {backdrop ? <div className="fixed inset-0 z-[60]" onMouseDown={onClose} aria-hidden="true" /> : null}
      <div
        className={
          anchorPoint
            ? `fixed z-[61] rounded-lg border border-line bg-raised p-1 shadow-[var(--os-shadow-pop)] ${className}`
            : `absolute z-[61] rounded-lg border border-line bg-raised p-1 shadow-[var(--os-shadow-pop)] ${
                side === "top" ? "bottom-full mb-1" : "top-full mt-1"
              } ${align === "end" ? "end-0" : "start-0"} ${className}`
        }
        style={
          anchorPoint
            ? {
                width,
                maxWidth: "calc(100vw - 32px)",
                left: clampToViewport(anchorPoint.left, width, "x"),
                top: clampToViewport(anchorPoint.top, PINNED_MAX_HEIGHT, "y"),
              }
            : { width, maxWidth: "calc(100vw - 32px)" }
        }
        role="presentation"
      >
        {showSearch ? (
          <div className="mb-1 flex h-9 items-center gap-2 border-b border-line px-2">
            <Search className="h-4 w-4 shrink-0 text-ink-3" strokeWidth={1.5} aria-hidden="true" />
            <input
              autoFocus
              value={query}
              onChange={(e) => {
                setQuery(e.target.value);
                onSearchChange?.(e.target.value);
              }}
              placeholder={searchPlaceholder}
              aria-label={searchPlaceholder}
              aria-controls={listboxId}
              aria-activedescendant={rows[activeIdx] ? `${listboxId}-${activeIdx}` : undefined}
              className="min-w-0 flex-1 bg-transparent text-base text-ink outline-none placeholder:text-ink-3"
            />
          </div>
        ) : null}

        <div
          ref={listRef}
          id={listboxId}
          role="listbox"
          aria-label={ariaLabel}
          aria-multiselectable={multi || undefined}
          aria-activedescendant={rows[activeIdx] ? `${listboxId}-${activeIdx}` : undefined}
          tabIndex={showSearch ? -1 : 0}
          // No `outline-none` here: os.css gives every [tabindex="0"] a
          // focus-visible ring at a higher specificity, so the class was dead
          // and the popover painted a brand-blue box around its scroller
          // anyway. The ring is correct for a keyboard user; saying the
          // opposite in the class list was the defect.
          className="max-h-[280px] overflow-y-auto"
        >
          {rows.length === 0 ? (
            loading ? null : <p className="px-2 py-2 text-sm text-ink-2">{emptyLabel}</p>
          ) : (
            filtered.map((section, si) => (
              <div key={section.label ?? `s${si}`}>
                {section.label ? (
                  <div className="px-2 pb-1 pt-2 text-micro font-semibold uppercase tracking-wide text-ink-3">
                    {section.label}
                  </div>
                ) : null}
                {section.options.map((option) => {
                  idx += 1;
                  const myIdx = idx;
                  const isChosen = chosen.has(option.value);
                  return (
                    <button
                      key={option.value}
                      id={`${listboxId}-${myIdx}`}
                      type="button"
                      role="option"
                      aria-selected={isChosen}
                      data-picker-idx={myIdx}
                      disabled={option.disabled}
                      onMouseEnter={() => setInternalIdx(myIdx)}
                      onClick={() => pick(option)}
                      className={`flex w-full items-center gap-2 rounded-md px-2 text-start transition-colors disabled:opacity-50 ${
                        option.description ? "min-h-9 py-1.5" : "h-9"
                      } ${myIdx === activeIdx ? "bg-hover" : ""}`}
                    >
                      {option.glyph ? (
                        <span className="flex h-4 w-4 shrink-0 items-center justify-center text-ink-2">{option.glyph}</span>
                      ) : null}
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-base text-ink">{option.label}</span>
                        {option.description ? (
                          <span className="block truncate text-xs text-ink-2">{option.description}</span>
                        ) : null}
                      </span>
                      {option.hint ? <span className="shrink-0 text-xs text-ink-3">{option.hint}</span> : null}
                      {isChosen ? (
                        <Check className="h-4 w-4 shrink-0 text-brand-deep" strokeWidth={1.5} aria-hidden="true" />
                      ) : null}
                    </button>
                  );
                })}
              </div>
            ))
          )}
          {loading ? <SkeletonLines lines={3} className="px-2" /> : null}
        </div>

        {footer ? <div className="mt-1 border-t border-line pt-1">{footer}</div> : null}
      </div>
    </>
  );
}

/** The one ghost row shape a Picker footer uses. */
export function PickerFooterRow({
  onClick,
  children,
  icon,
  destructive = false,
}: {
  onClick: () => void;
  children: ReactNode;
  icon?: ReactNode;
  destructive?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`flex h-8 w-full items-center gap-2 rounded-md px-2 text-start text-sm transition-colors hover:bg-hover ${
        destructive ? "text-danger-text" : "text-ink-2"
      }`}
    >
      {icon ? <span className="flex h-4 w-4 shrink-0 items-center justify-center">{icon}</span> : null}
      {children}
    </button>
  );
}
