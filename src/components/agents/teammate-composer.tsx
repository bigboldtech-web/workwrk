"use client";

// The composer of a chat with an AI teammate (docs/plans/ai-teammates.md
// 5.1, 5.4): Ask AI's composer (src/components/ai/ask-ai-thread.tsx), with
// the Practice run switch beside Send. Enter sends, Shift+Enter breaks the
// line, Esc leaves the field; it grows with its text up to 8 lines. The blue
// Send is the page's one primary.
//
// Under the field: "Works as you. Sees only what you can see.", or, with
// Practice run on, "Practice run is on. Nothing will change." (the switch's
// tooltip says what a practice run is).

import { useEffect, useRef, type KeyboardEvent, type RefObject } from "react";
import { ArrowUp } from "lucide-react";
import { Dots } from "@/components/ui/dots";
import { Switch } from "@/components/ui/switch";
import { TEAMMATE_CHAT, composerPlaceholder } from "@/lib/agents/teammate-copy";

/** The longest message the route takes (POST .../messages). */
const MESSAGE_MAX = 20000;

export function TeammateComposer({
  name,
  value,
  practice,
  busy,
  offline,
  onChange,
  onPractice,
  onSend,
  inputRef,
}: {
  name: string;
  value: string;
  practice: boolean;
  /** An answer is arriving: Send waits. */
  busy: boolean;
  offline: boolean;
  onChange: (text: string) => void;
  onPractice: (on: boolean) => void;
  onSend: () => void;
  inputRef?: RefObject<HTMLTextAreaElement | null>;
}) {
  const localRef = useRef<HTMLTextAreaElement>(null);
  const ref = inputRef ?? localRef;
  const canSend = value.trim().length > 0 && !busy && !offline;

  // The field grows with its text, 1 to 8 lines.
  useEffect(() => {
    const t = ref.current;
    if (!t) return;
    t.style.height = "auto";
    t.style.height = `${Math.min(t.scrollHeight, 160)}px`;
  }, [value, ref]);

  function onKey(e: KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
      e.preventDefault();
      if (canSend) onSend();
    } else if (e.key === "Escape") {
      e.currentTarget.blur();
    }
  }

  return (
    <div className="rounded-lg border border-line-strong bg-raised p-3 focus-within:border-brand">
      <textarea
        ref={ref}
        className="block max-h-40 min-h-5 w-full resize-none bg-transparent text-base text-ink outline-none placeholder:text-ink-3"
        placeholder={composerPlaceholder(name)}
        aria-label={composerPlaceholder(name)}
        value={value}
        maxLength={MESSAGE_MAX}
        onChange={(e) => onChange(e.target.value)}
        onKeyDown={onKey}
        rows={1}
      />
      <div className="mt-2 flex items-center justify-between gap-3">
        <span className="min-w-0 truncate text-sm text-ink-2" role={practice ? "status" : undefined}>
          {practice ? TEAMMATE_CHAT.practiceOn : TEAMMATE_CHAT.composerHint}
        </span>
        <div className="flex shrink-0 items-center gap-3">
          <label className="flex cursor-pointer items-center gap-2 text-sm text-ink-2" title={TEAMMATE_CHAT.practiceTooltip}>
            <Switch checked={practice} onChange={onPractice} aria-label={TEAMMATE_CHAT.practice} />
            {TEAMMATE_CHAT.practice}
          </label>
          <button
            type="button"
            onClick={onSend}
            disabled={!canSend}
            aria-label={busy ? TEAMMATE_CHAT.working : TEAMMATE_CHAT.send}
            title={offline ? TEAMMATE_CHAT.offline : TEAMMATE_CHAT.sendHint}
            className={
              busy
                ? "inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-md text-ink-2"
                : "inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-md bg-brand text-white hover:bg-brand-hover disabled:opacity-40"
            }
          >
            {busy ? <Dots variant="pending" label={TEAMMATE_CHAT.working} /> : <ArrowUp className="h-4 w-4" />}
          </button>
        </div>
      </div>
    </div>
  );
}
