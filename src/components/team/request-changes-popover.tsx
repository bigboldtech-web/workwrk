"use client";

// RequestChangesPopover (spec-goals section 3): the 280px anchored popover
// behind every "Request changes" button on a manager surface (the Alignment
// board, Sub-teams, KPI reviews, and the weekly queue by choice). The note
// is REQUIRED: a person told "change this" with no word of what is worse off
// than one told nothing, so Send stays disabled until there is text.
//
// Esc and an outside click close it; with unsaved text either asks first,
// so a slip of the hand never throws a written note away. Send is secondary,
// not blue: the page that hosts it has no primary to compete with.
//
// Rendered in place (position absolute inside a relative parent), never in a
// portal, so it stays inside any drawer or dialog focus trap.

import { useEffect, useId, useRef, useState } from "react";
import { useConfirm } from "@/components/ui/dialog-provider";

export function RequestChangesPopover({
  personFirstName,
  onSend,
  onCancel,
  busy = false,
  align = "start",
}: {
  personFirstName: string;
  /** Resolve true when the note was saved; the popover closes on true. */
  onSend: (note: string) => Promise<boolean> | boolean;
  onCancel: () => void;
  busy?: boolean;
  align?: "start" | "end";
}) {
  const [note, setNote] = useState("");
  const [failed, setFailed] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const textRef = useRef<HTMLTextAreaElement>(null);
  const confirm = useConfirm();
  const labelId = useId();
  const dirty = note.trim().length > 0;

  const tryClose = async () => {
    if (dirty) {
      const ok = await confirm({ title: "Discard this note?", confirmLabel: "Discard", destructive: true });
      if (!ok) return;
    }
    onCancel();
  };

  useEffect(() => {
    textRef.current?.focus();
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      e.stopPropagation();
      void tryClose();
    };
    const onDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) void tryClose();
    };
    window.addEventListener("keydown", onKey, true);
    window.addEventListener("mousedown", onDown);
    return () => {
      window.removeEventListener("keydown", onKey, true);
      window.removeEventListener("mousedown", onDown);
    };
  });

  const send = async () => {
    const text = note.trim();
    if (!text || busy) return;
    setFailed(false);
    const ok = await onSend(text);
    if (!ok) setFailed(true);
  };

  return (
    <div
      ref={ref}
      role="dialog"
      aria-labelledby={labelId}
      className={`absolute top-full z-[60] mt-1 w-[280px] rounded-lg border border-line bg-raised p-3 text-ink shadow-[var(--os-shadow-pop)] ${align === "end" ? "end-0" : "start-0"}`}
    >
      <label id={labelId} htmlFor={`${labelId}-note`} className="mb-1.5 block text-sm font-medium text-ink">
        What should {personFirstName} change?
      </label>
      <textarea
        id={`${labelId}-note`}
        ref={textRef}
        value={note}
        onChange={(e) => setNote(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) { e.preventDefault(); void send(); }
        }}
        rows={2}
        maxLength={5000}
        className="block w-full resize-y rounded-md border border-line bg-surface px-2 py-1.5 text-base text-ink outline-none placeholder:text-ink-3 focus:border-brand"
        placeholder="A sentence is enough"
      />
      {failed ? <p className="mt-1.5 text-xs text-danger-text">Not sent. Your note is kept; try again.</p> : null}
      <div className="mt-2 flex items-center justify-end gap-2">
        <button
          type="button"
          onClick={() => void tryClose()}
          className="inline-flex h-8 items-center rounded-md px-3 text-sm text-ink-2 hover:bg-hover hover:text-ink"
        >
          Cancel
        </button>
        <button
          type="button"
          onClick={() => void send()}
          disabled={!dirty || busy}
          className="inline-flex h-8 items-center rounded-md border border-line bg-surface px-3 text-sm font-medium text-ink hover:bg-hover disabled:opacity-50"
        >
          {busy ? "Sending" : "Send"}
        </button>
      </div>
    </div>
  );
}
