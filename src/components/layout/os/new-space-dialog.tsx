"use client";

// NewSpaceDialog — minimal "Create a Space" modal. Matches the
// screenshot: icon swatch on the left, name field, description, default
// permission (placeholder), Make Private toggle, Continue button.
//
// Posts to POST /api/spaces with { name, description?, visibility }.
// On success it calls onCreated(space) so the caller can refresh the
// sidebar tree.

import { useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import type { Visibility } from "@/generated/prisma";

interface SpaceLike {
  id: string;
  slug: string;
  name: string;
  visibility: Visibility;
}

export function NewSpaceDialog({
  open,
  onOpenChange,
  onCreated,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  onCreated?: (s: SpaceLike) => void;
}) {
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [isPrivate, setIsPrivate] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const reset = () => {
    setName("");
    setDescription("");
    setIsPrivate(false);
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
      setError("Space name is required");
      return;
    }
    setSubmitting(true);
    try {
      const res = await fetch("/api/spaces", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          name: trimmed,
          description: description.trim() || undefined,
          visibility: isPrivate ? "PRIVATE" : "WORKSPACE",
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(data?.error ?? "Failed to create Space");
        setSubmitting(false);
        return;
      }
      onCreated?.(data.space as SpaceLike);
      handle(false);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to create Space");
      setSubmitting(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={handle}>
      <DialogContent className="max-w-[460px] p-0">
        <div className="px-5 pt-5 pb-2">
          <DialogTitle className="text-base font-semibold">Create a Space</DialogTitle>
          <DialogDescription className="text-xs text-muted mt-1">
            A Space represents teams, departments, or groups, each with its own Boards, workflows, and settings.
          </DialogDescription>
        </div>

        <div className="px-5 py-3 space-y-4">
          <div>
            <label className="text-xs font-medium block mb-1">Icon &amp; name</label>
            <div className="flex items-center gap-2">
              <span className="w-9 h-9 rounded-md bg-surface-2 flex items-center justify-center text-sm font-semibold uppercase">
                {name.trim()[0] ?? "S"}
              </span>
              <input
                type="text"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="e.g. Marketing, Engineering, HR"
                className="flex-1 h-9 px-3 rounded-md border border-border bg-surface text-sm focus:outline-none focus:border-[var(--os-brand)]"
                autoFocus
              />
            </div>
          </div>

          <div>
            <label className="text-xs font-medium block mb-1">
              Description <span className="text-muted">(optional)</span>
            </label>
            <textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              rows={2}
              className="w-full px-3 py-2 rounded-md border border-border bg-surface text-sm resize-none focus:outline-none focus:border-[var(--os-brand)]"
            />
          </div>

          <label className="flex items-center justify-between gap-3 cursor-pointer pt-1">
            <div>
              <div className="text-sm font-medium">Make Private</div>
              <div className="text-xs text-muted">Only you and invited members have access</div>
            </div>
            <span
              role="switch"
              aria-checked={isPrivate}
              tabIndex={0}
              onClick={() => setIsPrivate((v) => !v)}
              onKeyDown={(e) => {
                if (e.key === " " || e.key === "Enter") {
                  e.preventDefault();
                  setIsPrivate((v) => !v);
                }
              }}
              className={`relative w-9 h-5 rounded-full transition-colors ${
                isPrivate ? "bg-[var(--os-brand)]" : "bg-surface-3"
              }`}
            >
              <span
                className={`absolute top-0.5 left-0.5 w-4 h-4 rounded-full bg-white shadow transition-transform ${
                  isPrivate ? "translate-x-4" : "translate-x-0"
                }`}
              />
            </span>
          </label>

          {error ? (
            <div className="text-xs text-red-500 bg-red-500/10 rounded-md px-3 py-2">{error}</div>
          ) : null}
        </div>

        <div className="px-5 pb-5 pt-2 flex items-center justify-between">
          <button
            type="button"
            onClick={() => handle(false)}
            className="text-sm text-muted hover:text-foreground px-3 py-2"
            disabled={submitting}
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={submit}
            disabled={submitting || !name.trim()}
            className="px-4 py-2 rounded-md text-sm font-medium text-white bg-[var(--os-brand)] hover:bg-[var(--os-brand-hover)] disabled:opacity-50"
          >
            {submitting ? "Creating…" : "Continue"}
          </button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
