"use client";

// The Text card's body: a heading or a note. Editors write in place; the
// text is saved through the dashboard's save queue like every other edit
// (debounced while typing, flushed on blur), and readers see it as written.
// A card holds no List data, so everyone who can open the dashboard sees it.

import { useEffect, useRef, useState } from "react";

const MAX = 20000;
const DEBOUNCE_MS = 600;

export function NotesBody({ text, canEdit, onChange }: { text: string; canEdit: boolean; onChange: (next: string) => void }) {
  const [draft, setDraft] = useState(text);
  const [seen, setSeen] = useState(text);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pending = useRef<string | null>(null);
  const onChangeRef = useRef(onChange);
  useEffect(() => {
    onChangeRef.current = onChange;
  });

  // A new value from outside (a reload, a rebase) replaces the draft only
  // while nothing typed here is still waiting to be handed over.
  if (seen !== text && pending.current === null) {
    setSeen(text);
    setDraft(text);
  }

  const commit = () => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = null;
    const next = pending.current;
    pending.current = null;
    if (next !== null) onChangeRef.current(next);
  };

  useEffect(() => () => commit(), []); // eslint-disable-line react-hooks/exhaustive-deps

  if (!canEdit) {
    return text.trim() ? (
      <div className="h-full min-h-0 overflow-y-auto whitespace-pre-wrap break-words px-1 text-base text-ink">{text}</div>
    ) : (
      <div className="flex h-full items-center justify-center text-sm text-ink-3">No text yet</div>
    );
  }
  return (
    <textarea
      value={draft}
      maxLength={MAX}
      aria-label="Text"
      placeholder="Write a heading or a note"
      onChange={(e) => {
        const v = e.target.value.slice(0, MAX);
        setDraft(v);
        pending.current = v;
        if (timer.current) clearTimeout(timer.current);
        timer.current = setTimeout(commit, DEBOUNCE_MS);
      }}
      onBlur={commit}
      className="widget-no-drag h-full min-h-0 w-full resize-none rounded-md border border-transparent bg-transparent px-1 py-0.5 text-base text-ink outline-none placeholder:text-ink-3 hover:border-line focus:border-line-strong"
    />
  );
}
