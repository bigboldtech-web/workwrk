"use client";

// NotesWidget — borderless scratchpad card. Text debounces (600ms) into
// config.noteText via onConfigChange; the page-level debounce PATCH does
// the actual persist. Unmount flushes pending text so nothing is lost.

import { useEffect, useRef, useState } from "react";
import type { DashWidget } from "../widget-types";

export function NotesWidget({
  widget,
  onConfigChange,
}: {
  widget: DashWidget;
  onConfigChange: (patch: Partial<DashWidget["config"]>) => void;
}) {
  const [text, setText] = useState(widget.config.noteText ?? "");
  const [saveState, setSaveState] = useState<"idle" | "dirty" | "saved">("idle");
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const textRef = useRef(text);
  const dirtyRef = useRef(false);
  const onConfigChangeRef = useRef(onConfigChange);
  useEffect(() => {
    onConfigChangeRef.current = onConfigChange;
  }, [onConfigChange]);

  const handleChange = (value: string) => {
    setText(value);
    textRef.current = value;
    dirtyRef.current = true;
    setSaveState("dirty");
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => {
      dirtyRef.current = false;
      onConfigChangeRef.current({ noteText: textRef.current });
      setSaveState("saved");
    }, 600);
  };

  // Data integrity: flush un-debounced text on unmount.
  useEffect(() => {
    return () => {
      if (timer.current) clearTimeout(timer.current);
      if (dirtyRef.current) onConfigChangeRef.current({ noteText: textRef.current });
    };
  }, []);

  return (
    <div className="flex h-full flex-col">
      <textarea
        value={text}
        onChange={(e) => handleChange(e.target.value)}
        placeholder="Jot down quick notes…"
        className="min-h-0 flex-1 resize-none bg-transparent text-[13px] leading-relaxed text-zinc-800 outline-none placeholder:text-zinc-400"
      />
      <div className="flex h-4 shrink-0 items-center justify-end">
        {saveState !== "idle" ? (
          <span className="text-[11px] text-zinc-400">
            {saveState === "dirty" ? "Saving…" : "Saved"}
          </span>
        ) : null}
      </div>
    </div>
  );
}
