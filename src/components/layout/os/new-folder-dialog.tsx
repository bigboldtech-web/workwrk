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
import {
  Dialog,
  DialogContent,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { Switch } from "@/components/ui/switch";
import { EntityTile } from "@/components/ui/entity-tile";
import { useOsShell } from "./shell-context";

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
  spaceName,
  parentFolderId,
  parentFolderName,
  onCreated,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  spaceId: string;
  /** Display-only location breadcrumb (ClickUp shows "Space / Folder"). */
  spaceName?: string;
  parentFolderId?: string | null;
  parentFolderName?: string | null;
  onCreated?: (f: FolderLike) => void;
}) {
  const { openTemplateCenter } = useOsShell();
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [color, setColor] = useState<string | null>(null);
  const [colorOpen, setColorOpen] = useState(false);
  const [isPrivate, setIsPrivate] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const reset = () => {
    setName("");
    setDescription("");
    setColor(null);
    setColorOpen(false);
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
          private: isPrivate,
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
    "w-full h-9 px-3 rounded-md border border-line bg-raised text-base text-ink placeholder:text-ink-3 focus:outline-none focus:border-brand";

  return (
    <Dialog open={open} onOpenChange={handle}>
      <DialogContent className="max-w-[460px] p-0 overflow-visible">
        {/* Header */}
        <div className="px-5 pt-5 pb-3">
          <DialogTitle className="text-lg font-semibold text-ink">Create folder</DialogTitle>
          <DialogDescription className="text-base text-ink-2 mt-1">
            A Folder is a shelf in a Space: it groups Lists, Docs and Canvases.
          </DialogDescription>
        </div>

        {/* Body */}
        <div className="px-5 space-y-4">
          {/* Name + colour swatch */}
          <div>
            <label className="text-base font-medium text-ink-2 block mb-1.5">Name</label>
            <div className="relative">
              <input
                type="text"
                value={name}
                onChange={(e) => setName(e.target.value)}
                onKeyDown={(e) => { if (e.key === "Enter") void submit(); }}
                placeholder="e.g. Project, Client, Team"
                className={`${inputCls} pe-10`}
                autoFocus
              />
              <button
                type="button"
                onClick={() => setColorOpen((v) => !v)}
                className="absolute end-2 top-1/2 -translate-y-1/2 w-6 h-6 rounded-md hover:bg-hover flex items-center justify-center"
                title="Folder colour"
                aria-label="Folder colour"
              >
                <span className="w-4 h-4 rounded-full border border-black/10" style={{ backgroundColor: color ?? "#9CA3AF" }} />
              </button>
              {colorOpen ? (
                <div className="absolute end-0 top-[38px] z-10 p-2 rounded-lg bg-raised border border-line grid grid-cols-4 gap-1.5" style={{ boxShadow: "var(--os-shadow-pop)" }}>
                  {FOLDER_COLORS.map((c) => (
                    <button
                      key={c}
                      type="button"
                      onClick={() => { setColor(c); setColorOpen(false); }}
                      className={`w-6 h-6 rounded-full border ${color === c ? "ring-2 ring-offset-1 ring-line-strong" : "border-black/10"}`}
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
            <label className="text-base font-medium text-ink-2 block mb-1.5">Description</label>
            <textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Tell us a bit about your Folder (optional)"
              maxLength={280}
              className="w-full min-h-[64px] px-3 py-2 rounded-md border border-line bg-raised text-base text-ink placeholder:text-ink-3 resize-none focus:outline-none focus:border-brand"
            />
          </div>

          {/* Location breadcrumb — display-only, like ClickUp's "Space / Folder". */}
          {spaceName ? (
            <div className="flex items-center gap-1.5 text-sm text-ink-2">
              <EntityTile size="sm" icon={null} color={null} name={spaceName} />
              <span className="truncate">{spaceName}</span>
              {parentFolderName ? <span className="truncate"> / {parentFolderName}</span> : null}
            </div>
          ) : null}

          {/* "Restricted" is the canon word (spec-spaces-lists section 1), and
              the second line says how to undo it: until this stage the Folder
              share dialog had no visibility control at all, so a folder ticked
              here was private forever (access-model Broken #10). */}
          <div className="flex items-center justify-between gap-3">
            <div className="flex flex-col">
              <span className="text-base font-medium text-ink">Restricted</span>
              <span className="text-xs text-ink-2">
                Only you and the people you share it with can open it. Change this later in Share.
              </span>
            </div>
            <Switch checked={isPrivate} onChange={setIsPrivate} aria-label="Restrict this folder" />
          </div>

          {error ? <div className="rounded-md bg-danger-bg px-3 py-2 text-sm text-danger-text">{error}</div> : null}
        </div>

        {/* Footer — Use Templates left, dark Create right (X closes; no Cancel). */}
        <div className="px-5 py-4 mt-3 border-t border-line-soft flex items-center justify-between">
          <button
            type="button"
            onClick={() => { handle(false); openTemplateCenter({ kind: "FOLDER" }); }}
            className="px-2.5 h-8 text-base font-medium text-ink-2 hover:text-ink hover:bg-hover rounded-md transition-colors"
            disabled={submitting}
          >
            Use a template
          </button>
          <button
            type="button"
            onClick={submit}
            disabled={submitting || !name.trim()}
            className="px-4 h-8 rounded-md text-base font-medium text-ink-inv bg-brand hover:bg-brand-hover disabled:opacity-50"
          >
            {submitting ? "Creating…" : "Create folder"}
          </button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
