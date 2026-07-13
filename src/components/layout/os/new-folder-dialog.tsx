"use client";

// NewFolderDialog — "Create Folder" modal matching ClickUp: name (+ colour),
// description, a Settings section (Statuses), and a Make-private row. Creates a
// Folder inside a Space (optionally nested under a parent Folder).
//
// NOTE: the primary button's background is an INLINE style, not a `bg-*` class.
// This dialog portals to <body> (outside `.workwrk-os`), where two things break
// class-based backgrounds: `--os-brand` isn't defined, and the shell's
// `.workwrk-os button { background:none }` reset would strip it. `var(--os-brand,
// #0073EA)` resolves to the accent when themed and falls back to brand blue
// otherwise, and inline style beats the reset — same fix as ui/switch.

import { useState } from "react";
import { LayoutList, Lock } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { Switch } from "@/components/ui/switch";

interface FolderLike {
  id: string;
  name: string;
}

// Folder accent swatches (stored on Folder.color, rendered on the sidebar tile).
const FOLDER_COLORS = [
  "#6B7280", "#0073EA", "#8B5CF6", "#EC4899",
  "#F59E0B", "#10B981", "#EF4444", "#14B8A6",
];

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
  const [description, setDescription] = useState("");
  const [color, setColor] = useState<string | null>(null);
  const [colorOpen, setColorOpen] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const reset = () => {
    setName("");
    setDescription("");
    setColor(null);
    setColorOpen(false);
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
          description: description.trim() || undefined,
          color: color ?? undefined,
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

  const inputCls =
    "w-full h-9 px-3 rounded-md border border-zinc-200 bg-white text-[13px] text-zinc-900 placeholder:text-zinc-400 focus:outline-none focus:border-[#0073EA]";

  return (
    <Dialog open={open} onOpenChange={handle}>
      <DialogContent className="max-w-[460px] p-0 overflow-visible">
        {/* Header */}
        <div className="px-5 pt-5 pb-3">
          <DialogTitle className="text-[16px] font-semibold text-zinc-900">Create Folder</DialogTitle>
          <DialogDescription className="text-[12.5px] text-zinc-500 mt-1">
            Use Folders to organize your Lists, Docs, and more.
          </DialogDescription>
        </div>

        {/* Body */}
        <div className="px-5 space-y-4">
          {/* Name + colour swatch */}
          <div>
            <label className="text-[12.5px] font-medium text-zinc-700 block mb-1.5">Name</label>
            <div className="relative">
              <input
                type="text"
                value={name}
                onChange={(e) => setName(e.target.value)}
                onKeyDown={(e) => { if (e.key === "Enter") void submit(); }}
                placeholder="e.g. Project, Client, Team"
                className={`${inputCls} pr-10`}
                autoFocus
              />
              <button
                type="button"
                onClick={() => setColorOpen((v) => !v)}
                className="absolute right-2 top-1/2 -translate-y-1/2 w-6 h-6 rounded-md hover:bg-zinc-100 flex items-center justify-center"
                title="Folder colour"
                aria-label="Folder colour"
              >
                <span className="w-4 h-4 rounded-full border border-black/10" style={{ backgroundColor: color ?? "#9CA3AF" }} />
              </button>
              {colorOpen ? (
                <div className="absolute right-0 top-[38px] z-10 p-2 rounded-lg bg-white border border-zinc-200 shadow-lg grid grid-cols-4 gap-1.5">
                  {FOLDER_COLORS.map((c) => (
                    <button
                      key={c}
                      type="button"
                      onClick={() => { setColor(c); setColorOpen(false); }}
                      className={`w-6 h-6 rounded-full border ${color === c ? "ring-2 ring-offset-1 ring-zinc-400" : "border-black/10"}`}
                      style={{ backgroundColor: c }}
                      aria-label={`Colour ${c}`}
                    />
                  ))}
                </div>
              ) : null}
            </div>
          </div>

          {/* Description */}
          <div>
            <label className="text-[12.5px] font-medium text-zinc-700 block mb-1.5">Description</label>
            <textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Tell us a bit about your Folder (optional)"
              maxLength={280}
              className="w-full min-h-[64px] px-3 py-2 rounded-md border border-zinc-200 bg-white text-[13px] text-zinc-900 placeholder:text-zinc-400 resize-none focus:outline-none focus:border-[#0073EA]"
            />
          </div>

          {/* Settings — Statuses (folders inherit the Space's statuses) */}
          <div>
            <div className="text-[12.5px] font-medium text-zinc-700 mb-1.5">Settings</div>
            <div className="flex items-center gap-3 px-3 py-2.5 rounded-md border border-zinc-200">
              <span className="w-8 h-8 rounded-md bg-zinc-100 flex items-center justify-center flex-shrink-0">
                <LayoutList className="w-4 h-4 text-zinc-500" />
              </span>
              <div className="flex-1 min-w-0">
                <div className="text-[13px] font-medium text-zinc-800">Statuses</div>
                <div className="text-[11.5px] text-zinc-500">Use Space statuses</div>
              </div>
              <span className="text-[10px] font-medium px-1.5 py-0.5 rounded bg-zinc-100 text-zinc-500">Soon</span>
            </div>
          </div>

          {/* Make private (needs folder-level access control — surfaced honestly) */}
          <div className="flex items-center gap-3">
            <span className="w-8 h-8 rounded-md bg-zinc-100 flex items-center justify-center flex-shrink-0">
              <Lock className="w-4 h-4 text-zinc-500" />
            </span>
            <div className="flex-1 min-w-0">
              <div className="text-[13px] font-medium text-zinc-800 flex items-center gap-1.5">
                Make private
                <span className="text-[10px] font-medium px-1.5 py-0.5 rounded bg-zinc-100 text-zinc-500">Soon</span>
              </div>
              <div className="text-[11.5px] text-zinc-500">Only you and invited members have access</div>
            </div>
            <Switch checked={false} disabled aria-label="Make private" />
          </div>

          {error ? <div className="text-[12px] text-red-500">{error}</div> : null}
        </div>

        {/* Footer */}
        <div className="px-5 py-4 mt-3 border-t border-zinc-100 flex items-center justify-end gap-2">
          <button
            type="button"
            onClick={() => handle(false)}
            className="text-[12.5px] text-zinc-500 hover:text-zinc-900 px-3 h-8 rounded-md hover:bg-zinc-100"
            disabled={submitting}
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={submit}
            disabled={submitting || !name.trim()}
            style={{ backgroundColor: "var(--os-brand, #0073EA)" }}
            className="px-4 h-8 rounded-md text-[12.5px] font-medium text-white hover:opacity-90 disabled:opacity-50"
          >
            {submitting ? "Creating…" : "Create Folder"}
          </button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
