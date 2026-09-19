"use client";

// LightEditor, the small editor a task description and a comment get
// (spec-task-detail section 3, and section 4 step 3 change (c)).
//
//   "bold, italic, bullet and numbered lists, links (auto-linked URLs),
//    @mentions, stored as a markdown STRING in Item.metadata.description
//    (existing plain-text values render unchanged). No 'write with AI' wand."
//
// It is a textarea with a toolbar, not a contenteditable surface, and that is
// a decision rather than a shortcut:
//
//   * the value on the wire is a markdown string, so what a person edits and
//     what is stored are the same characters, no serialiser to lose anything
//     between them, which matters because this field autosaves;
//   * a textarea keeps native undo, native spellcheck, native IME and native
//     mobile keyboards, all of which a contenteditable editor has to rebuild;
//   * every plain-text description already stored renders unchanged, because
//     plain text IS the format.
//
// It is NOT the doc editor. A description that wants headings, tables or
// embeds is a Doc, and Related is how a task points at one.

import { useCallback, useEffect, useLayoutEffect, useRef, type KeyboardEvent, type ReactNode } from "react";
import { Bold, Italic, Link2, List, ListOrdered } from "lucide-react";
import { applyWrap, continueList, type WrapStyle } from "@/lib/markdown-lite";
import { MarkdownLite } from "./markdown-lite";
import { useMentionTypeahead } from "@/components/comments/mention-typeahead";
import type { MentionRef } from "@/lib/mention-token";

export interface LightEditorProps {
  value: string;
  onChange: (next: string) => void;
  onBlur?: () => void;
  placeholder?: string;
  /** Turns the @ typeahead on; the caller sends the surviving ids. */
  mentions?: boolean;
  /** The List this text belongs to, so @mentions offer the people who can
   *  reach it rather than the author's own report tree. */
  boardId?: string | null;
  /** Called whenever a person is inserted, so the caller can send the ids. */
  onMentionsChange?: (mentions: MentionRef[]) => void;
  minRows?: number;
  maxRows?: number;
  readOnly?: boolean;
  /** Rendered under the toolbar, right-aligned (a Send button, a hint). */
  toolbarEnd?: ReactNode;
  /** Submit chord; return true if it was handled. */
  onSubmit?: () => void;
  ariaLabel?: string;
  autoFocus?: boolean;
  className?: string;
}

const LINE_H = 22;

export function LightEditor({
  value,
  onChange,
  onBlur,
  placeholder = "Add a description…",
  mentions = false,
  boardId = null,
  onMentionsChange,
  minRows = 3,
  maxRows = 12,
  readOnly = false,
  toolbarEnd,
  onSubmit,
  ariaLabel = "Description",
  autoFocus = false,
  className = "",
}: LightEditorProps) {
  const ref = useRef<HTMLTextAreaElement>(null);
  const typeahead = useMentionTypeahead({ value, setValue: onChange, textareaRef: ref, enabled: mentions && !readOnly, boardId });

  const mentionList = typeahead.mentions;
  useEffect(() => {
    onMentionsChange?.(mentionList);
  }, [mentionList, onMentionsChange]);

  // Auto-grow between minRows and maxRows. Layout effect so the box is the
  // right height on the first paint and never jumps.
  //
  // `readOnly` is in the deps because it is what decides whether there is a
  // textarea to measure at all. A caller that rests on the rendered body and
  // opens the editor on click flips only that prop: without it here the
  // effect never re-ran, the freshly mounted textarea kept the browser's
  // two-row default, and a long description opened CLIPPED.
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.style.height = "auto";
    const min = minRows * LINE_H;
    const max = maxRows * LINE_H;
    el.style.height = `${Math.min(max, Math.max(min, el.scrollHeight))}px`;
    el.style.overflowY = el.scrollHeight > max ? "auto" : "hidden";
  }, [value, minRows, maxRows, readOnly]);

  // One place that writes a new value and puts the caret back where the edit
  // left it, shared by the toolbar and by Enter-inside-a-list.
  const applyEdit = useCallback(
    (next: string, selectionStart: number, selectionEnd: number) => {
      const el = ref.current;
      onChange(next);
      requestAnimationFrame(() => {
        if (!el) return;
        el.focus();
        el.setSelectionRange(selectionStart, selectionEnd);
      });
    },
    [onChange],
  );

  const wrap = useCallback(
    (style: WrapStyle) => {
      const el = ref.current;
      if (!el) return;
      const { value: next, selectionStart, selectionEnd } = applyWrap(value, el.selectionStart, el.selectionEnd, style);
      applyEdit(next, selectionStart, selectionEnd);
    },
    [value, applyEdit],
  );

  // Enter carries a list on: "- a" + Enter opens "- ", and Enter on an empty
  // item ends the list. Shift+Enter is the escape hatch for a soft break
  // inside one item, and continueList() answers null for prose, so typing a
  // paragraph is untouched.
  const enterContinuesList = useCallback(
    (e: KeyboardEvent<HTMLTextAreaElement>) => {
      if (e.key !== "Enter" || e.shiftKey || e.metaKey || e.ctrlKey || e.altKey) return false;
      const el = ref.current;
      if (!el || el.selectionStart !== el.selectionEnd) return false;
      const next = continueList(value, el.selectionStart);
      if (!next) return false;
      e.preventDefault();
      applyEdit(next.value, next.selectionStart, next.selectionEnd);
      return true;
    },
    [value, applyEdit],
  );

  if (readOnly) {
    if (!value.trim()) return <p className="text-row text-ink-3">No description</p>;
    return <MarkdownLite source={value} className={className} />;
  }

  return (
    <div className={`relative ${className}`}>
      <div className="mb-1 flex items-center gap-0.5">
        <ToolButton label="Bold" onClick={() => wrap("bold")}><Bold className="h-4 w-4" strokeWidth={1.5} /></ToolButton>
        <ToolButton label="Italic" onClick={() => wrap("italic")}><Italic className="h-4 w-4" strokeWidth={1.5} /></ToolButton>
        <ToolButton label="Bulleted list" onClick={() => wrap("bullet")}><List className="h-4 w-4" strokeWidth={1.5} /></ToolButton>
        <ToolButton label="Numbered list" onClick={() => wrap("number")}><ListOrdered className="h-4 w-4" strokeWidth={1.5} /></ToolButton>
        <ToolButton label="Link" onClick={() => wrap("link")}><Link2 className="h-4 w-4" strokeWidth={1.5} /></ToolButton>
        {toolbarEnd ? <span className="ms-auto flex items-center gap-2">{toolbarEnd}</span> : null}
      </div>
      <div className="relative">
        {typeahead.popover}
        <textarea
          ref={ref}
          value={value}
          autoFocus={autoFocus}
          aria-label={ariaLabel}
          placeholder={placeholder}
          onChange={(e) => typeahead.onValueChange(e.target.value)}
          onClick={typeahead.onCaretMove}
          onKeyUp={typeahead.onCaretMove}
          onBlur={() => {
            typeahead.close();
            onBlur?.();
          }}
          onKeyDown={(e) => {
            if (typeahead.onKeyDown(e)) return;
            if (onSubmit && e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
              e.preventDefault();
              onSubmit();
              return;
            }
            if (enterContinuesList(e)) return;
          }}
          className="w-full resize-none rounded-md border border-line bg-raised px-3 py-2 text-row leading-[22px] text-ink outline-none transition-colors placeholder:text-ink-3 hover:border-line-strong focus:border-brand focus:shadow-[0_0_0_3px_var(--os-focus-halo)]"
        />
      </div>
    </div>
  );
}

function ToolButton({ label, onClick, children }: { label: string; onClick: () => void; children: ReactNode }) {
  return (
    <button
      type="button"
      title={label}
      aria-label={label}
      // Mouse-down default is prevented so the textarea keeps its selection:
      // a toolbar that blurs the field cannot format what is selected in it.
      onMouseDown={(e) => e.preventDefault()}
      onClick={onClick}
      className="inline-flex h-7 w-7 items-center justify-center rounded-md text-ink-2 transition-colors hover:bg-hover hover:text-ink"
    >
      {children}
    </button>
  );
}
