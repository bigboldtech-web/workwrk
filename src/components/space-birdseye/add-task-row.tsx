"use client";

// "+ New task" at the top of an overview column, "+ <Status> task" at the top
// and bottom of a focus column. Type first: the title the person typed is the
// only title ever sent, never a placeholder that a lost rename would leave in
// the List (buildSubtaskBody's rule, applied to tasks).
//
// Enter saves and keeps the row open for the next task; Esc cancels. A save
// that fails keeps every character that was typed, says why, and offers a
// Try again that sends the same request again. Leaving the field with text in
// it never throws the text away: the row stays open until it is saved or
// cancelled. Esc does nothing while a save is in flight, since the row must
// still be there to show a failure. A row that unmounts mid-save (focus mode
// switched, the column left the screen) hands its failure to a toast that
// names the title and still offers Try again.

import { useCallback, useEffect, useRef, useState, type KeyboardEvent } from "react";
import { Plus } from "lucide-react";
import { Dots } from "@/components/ui/dots";
import { useOsToast } from "@/components/layout/os/toast";
import { cn } from "@/lib/utils";
import { TINT_BG, TINT_GLYPH, TINT_LINE, tintVars, CARD_TINT_CLASS } from "@/lib/work/birdseye";

export function AddTaskRow({
  label,
  inputLabel,
  color,
  onCreate,
}: {
  /** "New task", or "<Status> task" in focus. */
  label: string;
  /** The field's accessible name, naming where the task goes. */
  inputLabel: string;
  /** A status colour tints the row (focus); none keeps it neutral (overview). */
  color?: string | null;
  onCreate: (title: string) => Promise<{ ok: true } | { ok: false; error: string }>;
}) {
  const [open, setOpen] = useState(false);
  const [title, setTitle] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const mounted = useRef(true);
  const { toast } = useOsToast();

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  useEffect(() => {
    if (open) inputRef.current?.focus();
  }, [open]);

  // The row is gone, so the toast is the only place left that holds the text.
  const reportDetached = useCallback(
    (text: string, error: string) => {
      const show = (why: string) =>
        toast("Couldn't add the task.", {
          tone: "danger",
          description: `"${text}": ${why}`,
          action: {
            label: "Try again",
            onClick: () => void onCreate(text).then((r) => (r.ok ? undefined : show(r.error))),
          },
        });
      show(error);
    },
    [onCreate, toast],
  );

  const tinted = color !== undefined && color !== null;
  const tint = tinted ? { ...tintVars(color), backgroundColor: TINT_BG, borderColor: TINT_LINE, color: TINT_GLYPH } : undefined;

  const save = async () => {
    const text = title.trim();
    if (!text || busy) {
      inputRef.current?.focus();
      return;
    }
    setBusy(true);
    setError(null);
    const r = await onCreate(text);
    if (!mounted.current) {
      if (!r.ok) reportDetached(text, r.error);
      return;
    }
    setBusy(false);
    if (r.ok) {
      setTitle("");
      inputRef.current?.focus();
    } else {
      setError(r.error);
    }
  };

  const cancel = () => {
    if (busy) return;
    setTitle("");
    setError(null);
    setOpen(false);
  };

  const onKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter" && !e.nativeEvent.isComposing) {
      e.preventDefault();
      void save();
    } else if (e.key === "Escape") {
      // Consumed here, so the shell's Esc does not also leave focus mode.
      e.preventDefault();
      e.stopPropagation();
      // While saving, Esc is ignored: cancelling now would close the row and
      // a failure that lands after it would have nowhere to show the text.
      if (!busy) cancel();
    }
  };

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className={cn(
          "flex h-8 w-full items-center justify-center gap-1.5 rounded-lg border border-dashed text-sm font-medium transition-colors",
          tinted ? CARD_TINT_CLASS : "border-line text-ink-3 hover:bg-hover hover:text-ink-2",
        )}
        style={tint}
      >
        <Plus className="h-3.5 w-3.5 shrink-0" strokeWidth={1.75} aria-hidden />
        <span className="truncate">{label}</span>
      </button>
    );
  }

  return (
    <div
      className={cn("flex flex-col gap-1.5 rounded-lg border p-1.5", tinted ? CARD_TINT_CLASS : "border-line bg-raised")}
      style={tinted ? { ...tintVars(color), backgroundColor: TINT_BG, borderColor: TINT_LINE } : undefined}
      onClick={(e) => e.stopPropagation()}
    >
      <input
        ref={inputRef}
        value={title}
        onChange={(e) => {
          setTitle(e.target.value);
          if (error) setError(null);
        }}
        onKeyDown={onKeyDown}
        onBlur={() => {
          if (!title.trim() && !busy) cancel();
        }}
        maxLength={280}
        placeholder="Task name"
        aria-label={inputLabel}
        aria-invalid={error ? true : undefined}
        readOnly={busy}
        className="h-8 w-full rounded-md border border-line bg-raised px-2 text-base text-ink placeholder:text-ink-3"
      />
      {error ? (
        <div className="flex items-start gap-2 px-0.5 text-xs text-danger-text" role="alert">
          <span className="min-w-0 flex-1">{error}</span>
          <button type="button" onClick={() => void save()} className="shrink-0 font-medium underline underline-offset-2">
            Try again
          </button>
        </div>
      ) : (
        <div className="flex items-center gap-2 px-0.5 text-xs text-ink-3">
          {busy ? <Dots variant="pending" label="Saving" /> : <span>Enter to save, Esc to cancel</span>}
        </div>
      )}
    </div>
  );
}
