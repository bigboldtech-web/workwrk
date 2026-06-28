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
          <DialogTitle className="text-[15px] font-semibold">New Folder</DialogTitle>
          <DialogDescription className="text-[12px] text-zinc-500 mt-1">
            Folders group related Boards inside a Space.
          </DialogDescription>
        </div>

        <div className="px-5 py-3">
          <label className="text-[12.5px] font-medium block mb-1.5">Name</label>
          <input
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter") void submit(); }}
            placeholder="e.g. Q3 launches, Engineering, Sprint #14"
            className="w-full h-8 px-3 rounded-md border border-zinc-200 bg-white text-[13px] focus:outline-none focus:border-[var(--os-brand)]"
            autoFocus
          />
          {error ? <div className="mt-2 text-[12px] text-red-500">{error}</div> : null}
        </div>

        <div className="px-5 pb-5 pt-2 flex items-center justify-end gap-2">
          <button type="button" onClick={() => handle(false)} className="text-[12.5px] text-zinc-500 hover:text-zinc-900 px-3 h-8 rounded-md" disabled={submitting}>
            Cancel
          </button>
          <button
            type="button"
            onClick={submit}
            disabled={submitting || !name.trim()}
            className="px-4 h-8 rounded-md text-[12.5px] font-medium text-white bg-[var(--os-brand)] hover:bg-[var(--os-brand-hover)] disabled:opacity-50"
          >
            {submitting ? "Creating…" : "Create Folder"}
          </button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
