"use client";

import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
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
      <DialogContent className="max-w-md">
        <DialogHeader>
          <div className="flex items-center gap-3">
            {destructive && (
              <div className="h-10 w-10 rounded-xl bg-[rgba(255,61,138,0.1)] border border-[rgba(255,61,138,0.3)] flex items-center justify-center shrink-0">
                <AlertTriangle size={18} className="text-[#ff3d8a]" />
              </div>
            )}
            <div>
              <DialogTitle>{title}</DialogTitle>
              <p className="text-[13px] text-[#a0a0a0] mt-1 leading-relaxed">{description}</p>
            </div>
          </div>
        </DialogHeader>
        <DialogFooter className="mt-4">
          <Button variant="ghost" onClick={onClose} disabled={loading}>
            {cancelLabel}
          </Button>
          <Button
            variant={destructive ? "destructive" : "default"}
            onClick={onConfirm}
            disabled={loading}
          >
            {loading ? "Processing…" : confirmLabel}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
