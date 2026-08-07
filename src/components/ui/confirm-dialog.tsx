"use client";

import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { AlertTriangle } from "lucide-react";

interface ConfirmDialogProps {
  open: boolean;
  onClose: () => void;
  onConfirm: () => void;
  title?: string;
  description?: string;
  confirmLabel?: string;
  cancelLabel?: string;
  destructive?: boolean;
  loading?: boolean;
}

export function ConfirmDialog({
  open,
  onClose,
  onConfirm,
  title = "Are you sure?",
  description = "This action cannot be undone.",
  confirmLabel = "Confirm",
  cancelLabel = "Cancel",
  destructive = true,
  loading = false,
}: ConfirmDialogProps) {
  return (
    <Dialog open={open} onOpenChange={onClose}>
      <DialogContent
        className="max-w-[420px] gap-0 p-6"
        onOpenAutoFocus={(e) => e.preventDefault()}
      >
        <div className="flex items-center gap-2.5">
          {destructive && (
            <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-red-50 dark:bg-[#E2445C]/15">
              <AlertTriangle size={15} className="text-[#E2445C]" />
            </span>
          )}
          <DialogTitle className="text-[15px] leading-none">{title}</DialogTitle>
        </div>
        <p className="mt-2.5 text-[13px] leading-relaxed text-zinc-500 dark:text-zinc-400">
          {description}
        </p>
        <div className="mt-5 flex items-center justify-end gap-2">
          <Button variant="outline" size="sm" onClick={onClose} disabled={loading}>
            {cancelLabel}
          </Button>
          <Button
            variant={destructive ? "destructive" : "default"}
            size="sm"
            onClick={onConfirm}
            disabled={loading}
          >
            {loading ? "Processing…" : confirmLabel}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
