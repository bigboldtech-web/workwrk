"use client";

// FormFieldCard (spec-tables-forms section 3): one field on the builder's
// Build tab.
//
//   grip       a drag handle on the left edge (design-system 5.16), visible on
//              hover and on focus; with it focused, Cmd+Up / Cmd+Down move the
//              field (the keyboard path), and the "..." carries Move up and
//              Move down (the touch path)
//   type chip  a neutral Chip with the type's glyph
//   Label      14/400, placeholder "Question" (a section's heading)
//   Help text  13/400 ink-2, placeholder "Optional" (a section's description)
//   Options    Single choice, Dropdown, Multiple choice: one row per option,
//              drag to reorder, an x per row, "+ Add option", an "Other" switch
//   Scale      Rating: the top of the scale
//   Required   the shared Switch (never a native checkbox); not on a section
//   "..."      Duplicate · Move up · Move down · Change type > · Delete
//
// Read-only (a Can view reader): the same card with every input disabled and
// no grip and no "...".

import { createElement, useRef, useState } from "react";
import {
  AlignLeft, Calendar, CheckSquare, ChevronDown, CircleDot, Copy, GripVertical, Hash, Heading, Link2, List, ListChecks,
  Mail, MoreHorizontal, MoveDown, MoveUp, Paperclip, Plus, Repeat, Star, Trash2, Type, Users, X, type LucideIcon,
} from "lucide-react";
import { Switch } from "@/components/ui/switch";
import { MenuItem, MenuList, MenuSeparator, MenuSubmenu } from "@/components/ui/menu";
import { MorePortal } from "@/components/layout/os/more-portal";
import { FORM_FIELD_TYPES, fieldTypeLabel, isChoiceType } from "@/lib/forms/builder";
import { ratingMax, type FormField, type FormFieldType } from "@/lib/forms/fields";
import { cn } from "@/lib/utils";

export const FIELD_ICON: Record<string, LucideIcon> = {
  short_text: Type,
  long_text: AlignLeft,
  number: Hash,
  email: Mail,
  url: Link2,
  date: Calendar,
  select: CircleDot,
  dropdown: ChevronDown,
  multi_select: ListChecks,
  checkbox: CheckSquare,
  rating: Star,
  people: Users,
  file: Paperclip,
  section: Heading,
};

export function fieldIcon(type: string): LucideIcon {
  return FIELD_ICON[type] ?? Type;
}

/** The type's glyph as an element (never a component made during render). */
export function FieldTypeIcon({ type, className = "h-4 w-4" }: { type: string; className?: string }) {
  return createElement(fieldIcon(type), { className, strokeWidth: 1.5, "aria-hidden": true });
}

const INPUT = "w-full rounded-md border border-line-strong bg-raised px-3 text-ink placeholder:text-ink-3 focus:outline-none focus-visible:border-brand disabled:bg-subtle disabled:text-ink-2";

export function FormFieldCard({
  field, index, count, number, readOnly, showHelpText, dragging, dropTarget,
  onChange, onMove, onDuplicate, onDelete, onChangeType,
  onDragStart, onDragOver, onDrop, onDragEnd,
}: {
  field: FormField;
  index: number;
  count: number;
  /** "3." before the label when Show field numbers is on. */
  number?: number;
  readOnly: boolean;
  showHelpText: boolean;
  dragging: boolean;
  dropTarget: boolean;
  onChange: (patch: Partial<FormField>) => void;
  onMove: (to: number) => void;
  onDuplicate: () => void;
  onDelete: () => void;
  /** The page confirms when options or answers would be lost. */
  onChangeType: (to: FormFieldType) => void;
  onDragStart: () => void;
  onDragOver: () => void;
  onDrop: () => void;
  onDragEnd: () => void;
}) {
  const [menuOpen, setMenuOpen] = useState(false);
  const moreRef = useRef<HTMLButtonElement>(null);
  const isSection = field.type === "section";
  const choices = isChoiceType(field.type);

  return (
    <article
      data-field-id={field.id}
      onDragOver={(e) => { if (readOnly) return; e.preventDefault(); onDragOver(); }}
      onDrop={(e) => { if (readOnly) return; e.preventDefault(); onDrop(); }}
      className={cn(
        "group/field relative flex gap-2 rounded-lg border bg-raised py-4 pe-4 ps-2",
        dropTarget ? "border-brand" : "border-line",
        dragging && "opacity-50",
      )}
      aria-label={`${isSection ? "Section" : "Question"} ${index + 1}: ${field.label || (isSection ? "Section" : "Untitled question")}`}
    >
      {/* grip: drag with a pointer, Cmd+Up / Cmd+Down from the keyboard */}
      {!readOnly ? (
        <button
          type="button"
          draggable
          onDragStart={(e) => { e.dataTransfer.effectAllowed = "move"; e.dataTransfer.setData("text/plain", field.id); onDragStart(); }}
          onDragEnd={onDragEnd}
          onKeyDown={(e) => {
            if (!(e.metaKey || e.ctrlKey)) return;
            if (e.key === "ArrowUp") { e.preventDefault(); onMove(index - 1); }
            if (e.key === "ArrowDown") { e.preventDefault(); onMove(index + 1); }
          }}
          aria-label={`Move ${field.label || "this field"}. Drag, or press Command and an arrow key.`}
          title="Drag to move"
          className="mt-1 inline-flex h-7 w-6 shrink-0 cursor-grab items-center justify-center rounded text-ink-3 opacity-0 hover:bg-hover hover:text-ink focus-visible:opacity-100 group-hover/field:opacity-100 max-[900px]:opacity-100"
        >
          <GripVertical className="h-4 w-4" aria-hidden />
        </button>
      ) : <span className="w-6 shrink-0" aria-hidden />}

      <div className="flex min-w-0 flex-1 flex-col gap-2.5">
        <div className="flex items-center gap-2">
          <span className="inline-flex h-6 items-center gap-1.5 rounded-md bg-subtle px-2 text-xs font-medium text-ink-2">
            <FieldTypeIcon type={field.type} className="h-3.5 w-3.5" />
            {fieldTypeLabel(field.type)}
          </span>
          {number ? <span className="text-sm text-ink-3 tabular-nums">Question {number}</span> : null}
          <span className="flex-1" />
          {!readOnly && !isSection ? (
            <label className="inline-flex items-center gap-2 text-sm text-ink-2">
              <Switch checked={!!field.required} onChange={(next) => onChange({ required: next })} aria-label="Required" />
              Required
            </label>
          ) : readOnly && field.required ? <span className="text-sm text-ink-2">Required</span> : null}
          {!readOnly ? (
            <button
              ref={moreRef}
              type="button"
              onClick={() => setMenuOpen((o) => !o)}
              onKeyDown={(e) => { if (e.key === ".") { e.preventDefault(); setMenuOpen(true); } }}
              aria-label={`Actions for ${field.label || "this field"}`}
              aria-haspopup="menu"
              aria-expanded={menuOpen}
              className="inline-flex h-7 w-7 items-center justify-center rounded-md text-ink-2 hover:bg-hover hover:text-ink"
            >
              <MoreHorizontal className="h-4 w-4" aria-hidden />
            </button>
          ) : null}
        </div>

        <input
          value={field.label}
          onChange={(e) => onChange({ label: e.target.value })}
          placeholder={isSection ? "Section heading" : "Question"}
          aria-label={isSection ? "Section heading" : "Question"}
          disabled={readOnly}
          maxLength={500}
          className={cn(INPUT, "h-9", isSection ? "text-lg font-semibold" : "text-base")}
        />
        {(showHelpText || isSection) && !(readOnly && !field.placeholder) ? (
          <input
            value={field.placeholder ?? ""}
            onChange={(e) => onChange({ placeholder: e.target.value || undefined })}
            placeholder={isSection ? "Description (optional)" : "Help text (optional)"}
            aria-label={isSection ? "Section description" : "Help text"}
            disabled={readOnly}
            maxLength={1000}
            className={cn(INPUT, "h-8 text-sm text-ink-2")}
          />
        ) : null}

        {choices ? (
          <OptionsEditor
            options={field.options ?? []}
            allowOther={!!field.allowOther}
            readOnly={readOnly}
            multi={field.type === "multi_select"}
            onChange={(options) => onChange({ options })}
            onAllowOther={(on) => onChange({ allowOther: on || undefined })}
          />
        ) : null}

        {field.type === "rating" ? (
          <label className="inline-flex items-center gap-2 text-sm text-ink-2">
            Scale of
            <select
              value={ratingMax(field)}
              onChange={(e) => onChange({ max: Number(e.target.value) })}
              disabled={readOnly}
              aria-label="Rating scale"
              className="h-8 rounded-md border border-line-strong bg-raised px-2 text-sm text-ink"
            >
              {[3, 4, 5, 6, 7, 8, 9, 10].map((n) => <option key={n} value={n}>{n}</option>)}
            </select>
            stars
          </label>
        ) : null}
        {field.type === "people" ? (
          <p className="m-0 text-sm text-ink-3">People pick from everyone in this workspace. Signed-in responders only.</p>
        ) : null}
        {field.type === "file" ? (
          <p className="m-0 text-sm text-ink-3">Up to 10 files per answer. Files are stored in this workspace.</p>
        ) : null}
      </div>

      {menuOpen ? (
        <MorePortal anchorRef={moreRef} width={240} open placement="below" onClose={() => setMenuOpen(false)}>
          <MenuList style={{ minWidth: 220 }} aria-label="Field actions">
            <MenuItem icon={Copy} label="Duplicate" onClick={() => { setMenuOpen(false); onDuplicate(); }} />
            <MenuItem icon={MoveUp} label="Move up" disabled={index === 0} onClick={() => { setMenuOpen(false); onMove(index - 1); }} />
            <MenuItem icon={MoveDown} label="Move down" disabled={index === count - 1} onClick={() => { setMenuOpen(false); onMove(index + 1); }} />
            <MenuSubmenu icon={Repeat} label="Change type" width={220}>
              {FORM_FIELD_TYPES.map((d) => (
                <MenuItem
                  key={d.type}
                  icon={fieldIcon(d.type)}
                  label={d.label}
                  selected={d.type === field.type}
                  onClick={() => { setMenuOpen(false); if (d.type !== field.type) onChangeType(d.type); }}
                />
              ))}
            </MenuSubmenu>
            <MenuSeparator />
            <MenuItem icon={Trash2} label="Delete" destructive onClick={() => { setMenuOpen(false); onDelete(); }} />
          </MenuList>
        </MorePortal>
      ) : null}
    </article>
  );
}

/** The most characters one option may hold (the option input's maxLength). */
export const OPTION_MAX_LENGTH = 200;

/**
 * Pasting a list into one option row. The builder this replaced had an
 * "Options (one per line)" textarea, so a person could paste twenty options
 * from a doc or a column of cells in one go; a single-line input would fold
 * that paste into ONE option ("Low Medium High") and autosave it. This keeps
 * the capability: when the pasted text holds a line break or a tab (a copied
 * column or row range), it becomes one option per line, spliced in where the
 * row being edited is.
 *
 * The text before the selection joins the first pasted line and the text
 * after it joins the last, exactly as a multi-line editor would place them.
 * Blank lines are dropped (the old textarea did the same) and every option is
 * clamped to OPTION_MAX_LENGTH. Returns null for a paste with no line break
 * or tab, so the input keeps its default behaviour; otherwise the new list
 * and the index of the last pasted row, which is where the caret goes.
 */
export function splitPastedOptions(
  options: string[],
  index: number,
  pasted: string,
  selectionStart: number,
  selectionEnd: number,
): { next: string[]; focus: number } | null {
  if (!/[\r\n\t]/.test(pasted)) return null;
  const current = options[index] ?? "";
  const start = Math.max(0, Math.min(selectionStart, current.length));
  const end = Math.max(start, Math.min(selectionEnd, current.length));
  const parts = pasted.split(/\r\n|\r|\n|\t/).map((s) => s.trim()).filter(Boolean);
  if (parts.length === 0) return { next: options, focus: index };
  parts[0] = current.slice(0, start) + parts[0];
  parts[parts.length - 1] = parts[parts.length - 1] + current.slice(end);
  const rows = parts.map((s) => s.trim().slice(0, OPTION_MAX_LENGTH)).filter(Boolean);
  if (rows.length === 0) return { next: options, focus: index };
  return {
    next: [...options.slice(0, index), ...rows, ...options.slice(index + 1)],
    focus: index + rows.length - 1,
  };
}

/** One option per 36px row: drag the grip (or Cmd+arrows on it) to reorder,
 *  an x per row, "+ Add option", and the "Other" switch. Pasting several
 *  lines into a row adds one option per line (splitPastedOptions). */
function OptionsEditor({ options, allowOther, readOnly, multi, onChange, onAllowOther }: {
  options: string[];
  allowOther: boolean;
  readOnly: boolean;
  multi: boolean;
  onChange: (next: string[]) => void;
  onAllowOther: (on: boolean) => void;
}) {
  const [drag, setDrag] = useState<number | null>(null);
  const refs = useRef<Array<HTMLInputElement | null>>([]);
  const move = (from: number, to: number) => {
    if (to < 0 || to >= options.length || from === to) return;
    const next = [...options];
    const [o] = next.splice(from, 1);
    next.splice(to, 0, o);
    onChange(next);
  };
  const Glyph = multi ? CheckSquare : List;
  return (
    <div className="flex flex-col gap-1">
      {options.map((o, i) => (
        <div
          key={i}
          className="group/opt flex h-9 items-center gap-1.5"
          onDragOver={(e) => { if (drag === null) return; e.preventDefault(); }}
          onDrop={(e) => { e.preventDefault(); if (drag !== null) move(drag, i); setDrag(null); }}
        >
          {!readOnly ? (
            <span
              draggable
              tabIndex={0}
              role="button"
              aria-label={`Move option ${o || i + 1}`}
              onDragStart={(e) => { e.dataTransfer.effectAllowed = "move"; e.dataTransfer.setData("text/plain", String(i)); setDrag(i); }}
              onDragEnd={() => setDrag(null)}
              onKeyDown={(e) => {
                if (!(e.metaKey || e.ctrlKey)) return;
                if (e.key === "ArrowUp") { e.preventDefault(); move(i, i - 1); }
                if (e.key === "ArrowDown") { e.preventDefault(); move(i, i + 1); }
              }}
              className="inline-flex h-7 w-5 cursor-grab items-center justify-center text-ink-3 opacity-0 focus-visible:opacity-100 group-hover/opt:opacity-100"
            >
              <GripVertical className="h-3.5 w-3.5" aria-hidden />
            </span>
          ) : null}
          <Glyph className="h-4 w-4 shrink-0 text-ink-3" strokeWidth={1.5} aria-hidden />
          <input
            ref={(el) => { refs.current[i] = el; }}
            value={o}
            onChange={(e) => onChange(options.map((x, j) => (j === i ? e.target.value : x)))}
            onPaste={(e) => {
              const el = e.currentTarget;
              const split = splitPastedOptions(
                options, i, e.clipboardData.getData("text/plain"),
                el.selectionStart ?? el.value.length, el.selectionEnd ?? el.value.length,
              );
              if (!split) return;
              e.preventDefault();
              onChange(split.next);
              // After the re-render the pasted rows exist; the caret lands at
              // the end of the last one so the next paste or Enter follows it.
              setTimeout(() => {
                const last = refs.current[split.focus];
                if (!last) return;
                last.focus();
                last.setSelectionRange(last.value.length, last.value.length);
              }, 0);
            }}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                const next = [...options];
                next.splice(i + 1, 0, `Option ${options.length + 1}`);
                onChange(next);
                setTimeout(() => { refs.current[i + 1]?.focus(); refs.current[i + 1]?.select(); }, 0);
              }
            }}
            aria-label={`Option ${i + 1}`}
            disabled={readOnly}
            maxLength={OPTION_MAX_LENGTH}
            className={cn(INPUT, "h-8 flex-1 border-transparent text-base hover:border-line focus-visible:border-brand")}
          />
          {!readOnly ? (
            <button
              type="button"
              onClick={() => onChange(options.filter((_, j) => j !== i))}
              aria-label={`Remove option ${o || i + 1}`}
              className="inline-flex h-7 w-7 items-center justify-center rounded-md text-ink-3 hover:bg-hover hover:text-ink"
            >
              <X className="h-4 w-4" aria-hidden />
            </button>
          ) : null}
        </div>
      ))}
      {!readOnly ? (
        <div className="flex items-center gap-4">
          <button
            type="button"
            onClick={() => {
              onChange([...options, `Option ${options.length + 1}`]);
              setTimeout(() => { refs.current[options.length]?.focus(); refs.current[options.length]?.select(); }, 0);
            }}
            className="inline-flex h-9 items-center gap-1.5 rounded-md px-2 text-base text-ink-2 hover:bg-hover hover:text-ink"
          >
            <Plus className="h-4 w-4" aria-hidden />
            Add option
          </button>
          <label className="inline-flex items-center gap-2 text-sm text-ink-2">
            <Switch checked={allowOther} onChange={onAllowOther} aria-label="Add an Other option" />
            Other
          </label>
        </div>
      ) : allowOther ? <p className="m-0 ps-7 text-sm text-ink-2">Other</p> : null}
    </div>
  );
}
