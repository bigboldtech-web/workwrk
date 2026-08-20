"use client";

import { useEffect, useRef, useState } from "react";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Pencil } from "lucide-react";

interface PromptDialogProps {
  open: boolean;
  onClose: () => void;
  onSubmit: (value: string) => void;
  title?: string;
  description?: string;
  /** Pre-fill the input. Selected on open. */
  defaultValue?: string;
  placeholder?: string;
  submitLabel?: string;
  cancelLabel?: string;
  /** Disallow empty submissions. Defaults true. */
  required?: boolean;
  loading?: boolean;
}

/**
 * WorkwrK-styled replacement for `window.prompt`. Single-line text
 * input inside the standard Dialog primitive — same look as
 * ConfirmDialog so they feel like one family.
 */
export function PromptDialog({
  open,
  onClose,
  onSubmit,
  title = "Enter a value",
  description,
  defaultValue = "",
  placeholder,
  submitLabel = "Save",
  cancelLabel = "Cancel",
  required = true,
  loading = false,
}: PromptDialogProps) {
  const [value, setValue] = useState(defaultValue);
  const [wasOpen, setWasOpen] = useState(open);
  const inputRef = useRef<HTMLInputElement>(null);

  // Re-seed the field every time the dialog opens so a previous value
  // doesn't leak into a fresh prompt (state adjustment during render,
  // per react.dev "you might not need an effect").
  if (open !== wasOpen) {
    setWasOpen(open);
    if (open) setValue(defaultValue);
  }

  // Focus + select once the dialog has actually mounted.
  useEffect(() => {
    if (open) {
      requestAnimationFrame(() => {
        inputRef.current?.focus();
        inputRef.current?.select();
      });
    }
  }, [open]);

  function submit() {
    const trimmed = value.trim();
    if (required && !trimmed) return;
    onSubmit(trimmed);
  }

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent className="max-w-[420px] gap-0 p-6">
        <div className="flex items-center gap-2.5">
          <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-blue-50 dark:bg-[#0073EA]/15">
            <Pencil size={14} className="text-[#0073EA]" />
          </span>
          <DialogTitle className="text-[15px] leading-none">{title}</DialogTitle>
        </div>
        {description && (
          <p className="mt-2.5 text-[14px] leading-relaxed text-zinc-500 dark:text-zinc-400">
            {description}
          </p>
        )}

        <div className="mt-3">
          <Input
            ref={inputRef}
            value={value}
            onChange={(e) => setValue(e.target.value)}
            placeholder={placeholder}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                submit();
              } else if (e.key === "Escape") {
                e.preventDefault();
                onClose();
              }
            }}
            disabled={loading}
          />
        </div>

        <div className="mt-5 flex items-center justify-end gap-2">
          <Button variant="outline" size="sm" onClick={onClose} disabled={loading}>
            {cancelLabel}
          </Button>
          <Button size="sm" onClick={submit} disabled={loading || (required && !value.trim())}>
            {loading ? "Saving…" : submitLabel}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
