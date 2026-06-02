"use client";

// NewFolderDialog — minimal "Create a Folder" modal. Creates a Folder
// inside a Space (and optionally a parent Folder for nesting).

import { useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";

interface FolderLike {
  id: string;
  name: string;
}

export function NewFolderDialog({
  open,
  onOpenChange,
  spaceId,
  parentFolderId,
  onCreated,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  spaceId: string;
  parentFolderId?: string | null;
  onCreated?: (f: FolderLike) => void;
}) {
  const [name, setName] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const reset = () => {
    setName("");
    setError(null);
    setSubmitting(false);
  };

  const handle = (next: boolean) => {
    if (!next) reset();
    onOpenChange(next);
  };

  const submit = async () => {
    setError(null);
    const trimmed = name.trim();
    if (!trimmed) {
      setError("Folder name is required");
      return;
    }
    setSubmitting(true);
    try {
      const res = await fetch("/api/folders", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          spaceId,
          parentFolderId: parentFolderId ?? null,
          name: trimmed,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(data?.error ?? "Failed to create folder");
        setSubmitting(false);
        return;
      }
      onCreated?.(data.folder as FolderLike);
      handle(false);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to create folder");
      setSubmitting(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={handle}>
      <DialogContent className="max-w-[420px] p-0">
        <div className="px-5 pt-5 pb-2">
          <DialogTitle className="text-base font-semibold">New Folder</DialogTitle>
          <DialogDescription className="text-xs text-muted mt-1">
            Folders group related Boards inside a Space.
          </DialogDescription>
        </div>

        <div className="px-5 py-3">
          <label className="text-xs font-medium block mb-1">Name</label>
          <input
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter") void submit(); }}
            placeholder="e.g. Q3 launches, Engineering, Sprint #14"
            className="w-full h-9 px-3 rounded-md border border-border bg-surface text-sm focus:outline-none focus:border-[var(--os-brand)]"
            autoFocus
          />
          {error ? <div className="mt-2 text-xs text-red-500">{error}</div> : null}
        </div>

        <div className="px-5 pb-5 pt-2 flex items-center justify-between">
          <button type="button" onClick={() => handle(false)} className="text-sm text-muted hover:text-foreground px-3 py-2" disabled={submitting}>
            Cancel
          </button>
          <button
            type="button"
            onClick={submit}
            disabled={submitting || !name.trim()}
            className="px-4 py-2 rounded-md text-sm font-medium text-white bg-[var(--os-brand)] hover:bg-[var(--os-brand-hover)] disabled:opacity-50"
          >
            {submitting ? "Creating…" : "Create Folder"}
          </button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
