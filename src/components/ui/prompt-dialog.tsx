"use client";

import { useEffect, useRef, useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
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
  const inputRef = useRef<HTMLInputElement>(null);

  // Re-seed the field every time the dialog opens so a previous value
  // doesn't leak into a fresh prompt.
  useEffect(() => {
    if (open) {
      setValue(defaultValue);
      // Defer focus so the dialog has actually mounted.
      requestAnimationFrame(() => {
        inputRef.current?.focus();
        inputRef.current?.select();
      });
    }
  }, [open, defaultValue]);

  function submit() {
    const trimmed = value.trim();
    if (required && !trimmed) return;
    onSubmit(trimmed);
  }

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <div className="flex items-center gap-3">
            <div className="h-10 w-10 rounded-xl bg-[rgba(212,255,46,0.10)] border border-[rgba(212,255,46,0.30)] flex items-center justify-center shrink-0">
              <Pencil size={16} className="text-[#d4ff2e]" />
            </div>
            <div>
              <DialogTitle>{title}</DialogTitle>
              {description && (
                <p className="text-[13px] text-muted mt-1 leading-relaxed">{description}</p>
              )}
            </div>
          </div>
        </DialogHeader>

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

        <DialogFooter className="mt-4">
          <Button variant="ghost" onClick={onClose} disabled={loading}>
            {cancelLabel}
          </Button>
          <Button onClick={submit} disabled={loading || (required && !value.trim())}>
            {loading ? "Saving…" : submitLabel}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
