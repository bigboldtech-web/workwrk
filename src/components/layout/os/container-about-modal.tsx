"use client";

// ContainerAboutModal — what this Space, Folder or List is, and the one place
// its description is readable after creation.
//
// Spec: docs/plans/ui-refresh/spec-spaces-lists.md section 1 (Folder "…" row 9,
// List "…" row 11) and section 3 (`ContainerAboutModal`).
//
// THE BUG IT CLOSES. `NewFolderDialog` has captured a Folder description since
// it shipped and `POST /api/folders` has stored it; the Folder page's own
// `findFirst` does not even SELECT the column, no card renders it and no form
// edits it. So every description anyone has ever typed into that field has been
// write-only data (audit spaces-boards section 12, the Folder gap). The List
// had the same field and answered "List info" with a toast that said
// `"{name}": a List` (audit Medium #18). One modal, three flavours, and the
// text a person wrote is finally on screen.
//
// AUTOSAVE, not a Save button, per design-system section 5: the description
// saves on blur with the `AutosaveIndicator`.
//
// WHAT A FAILED SAVE MUST NOT COST. The box was UNCONTROLLED and keyed
// `${object.id}:${open}`, so closing the modal remounted it on the last stored
// value: a save that failed said "Not saved, retrying", nothing retried, and
// the typed text was gone the moment the person pressed Esc. Data integrity is
// the whole point of this field. So: the draft is state, it survives the close,
// the retry is real (one scheduled attempt, then the box keeps the text and
// says so), and `useDirtyGuard` arms `beforeunload` while it is dirty.

import { useCallback, useEffect, useRef, useState } from "react";
import { useDirtyGuard } from "@/hooks/use-dirty-guard";
import Link from "next/link";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { AutosaveIndicator } from "@/components/ui/autosave-indicator";
import type { AutosaveStatus } from "@/hooks/use-autosave";
import { EntityTile } from "@/components/ui/entity-tile";
import { useOsToast } from "./toast";
import type { ContainerKind } from "@/lib/work/container-menu";
import { containerNoun } from "@/lib/work/container-menu";

export interface AboutObject {
  kind: ContainerKind;
  id: string;
  name: string;
  slug?: string | null;
  icon?: string | null;
  color?: string | null;
  description?: string | null;
  createdAt?: string | null;
  owner?: { id: string; name: string } | null;
  /** Space › Folder, already resolved by the host, each with its own href. */
  location?: Array<{ label: string; href: string }>;
  /** "3 lists · 2 folders · 1 doc" or "12 open · 40 done". */
  contents?: string | null;
}

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  object: AboutObject | null;
  /** Full access holders edit the description; everyone else reads it. */
  canEdit?: boolean;
  onSaved?: () => void;
}

const API_BASE: Record<ContainerKind, string> = {
  space: "/api/spaces",
  folder: "/api/folders",
  list: "/api/boards",
};

export function ContainerAboutModal({ open, onOpenChange, object, canEdit = false, onSaved }: Props) {
  const { toast } = useOsToast();
  // No effect syncs props into state. The saved text IS the prop until this
  // modal writes one, and the write records which object it was for, so
  // opening the About of a different container never shows the last one's
  // description for a frame.
  const [written, setWritten] = useState<{ id: string; text: string } | null>(null);
  // The unsaved text, kept ACROSS a close so Esc never destroys typing.
  const [draft, setDraft] = useState<{ id: string; text: string } | null>(null);
  const [state, setState] = useState<AutosaveStatus>("idle");
  const [savedAt, setSavedAt] = useState<Date | null>(null);
  const retryRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // The scheduled retry calls the CURRENT save through a ref: a useCallback
  // cannot name itself, and a stale closure would retry against a stale object.
  const saveRef = useRef<((next: string, attempt?: number) => Promise<boolean>) | null>(null);

  const saved = object && written?.id === object.id ? written.text : (object?.description ?? "");
  const value = object && draft?.id === object.id ? draft.text : saved;
  const dirty = Boolean(object) && value.trim() !== saved.trim();

  const save = useCallback(async (next: string, attempt = 0): Promise<boolean> => {
    if (!object) return true;
    const trimmed = next.trim();
    const current = written?.id === object.id ? written.text : (object.description ?? "");
    if (trimmed === current.trim()) { setDraft(null); return true; }
    setState("saving");
    try {
      const res = await fetch(`${API_BASE[object.kind]}/${object.id}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ description: trimmed || null }),
      });
      if (!res.ok) {
        const d = await res.json().catch(() => ({}));
        setState("error");
        // Keep the text and try once more; only then tell the person, and
        // tell them the truth, which is that it is still in the box.
        if (attempt === 0) {
          if (retryRef.current) clearTimeout(retryRef.current);
          retryRef.current = setTimeout(() => { void saveRef.current?.(trimmed, 1); }, 3000);
          return false;
        }
        toast(d?.error ?? "Not saved. Your text is still in the box, try again.");
        return false;
      }
      setWritten({ id: object.id, text: trimmed });
      setDraft(null);
      setState("saved");
      setSavedAt(new Date());
      onSaved?.();
      return true;
    } catch {
      setState("error");
      if (attempt === 0) {
        if (retryRef.current) clearTimeout(retryRef.current);
        retryRef.current = setTimeout(() => { void saveRef.current?.(trimmed, 1); }, 3000);
        return false;
      }
      toast("Not saved. Your text is still in the box, try again.");
      return false;
    }
  }, [object, written, toast, onSaved]);

  useEffect(() => { saveRef.current = save; }, [save]);
  useEffect(() => () => { if (retryRef.current) clearTimeout(retryRef.current); }, []);

  // Arms beforeunload while the description has unsaved text, and gives the
  // shared dirty registry a way to save it.
  useDirtyGuard(canEdit && dirty, { onSave: () => save(value, 1) });

  if (!object) return null;
  const noun = containerNoun(object.kind);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-[560px] p-0 gap-0">
        <div className="px-6 pt-6 pb-4 flex items-start gap-3">
          <EntityTile size="lg" icon={object.icon ?? null} color={object.color ?? null} name={object.name} />
          <div className="min-w-0 flex-1">
            <DialogTitle className="text-lg font-semibold truncate">{object.name}</DialogTitle>
            <p className="text-sm text-muted mt-0.5">{noun}</p>
          </div>
        </div>

        <div className="px-6 pb-6 space-y-5 border-t border-line pt-5">
          <section>
            <div className="flex items-center justify-between mb-1.5">
              <h3 className="text-sm font-semibold uppercase tracking-wide text-muted">Description</h3>
              {canEdit ? <AutosaveIndicator status={state} lastSavedAt={savedAt} /> : null}
            </div>
            {canEdit ? (
              <textarea
                // Controlled, so the text survives a close, a reopen and a
                // failed save. It was uncontrolled and keyed on `open`.
                value={value}
                onChange={(e) => { setDraft({ id: object.id, text: e.target.value }); setState("dirty"); }}
                onBlur={(e) => { void save(e.target.value); }}
                rows={3}
                maxLength={280}
                placeholder={`What is this ${noun.toLowerCase()} for?`}
                className="w-full rounded-md border border-line bg-surface px-2.5 py-2 text-base text-foreground placeholder:text-muted focus:outline-none focus:border-line-strong resize-y"
              />
            ) : (
              <p className="text-base text-foreground whitespace-pre-wrap">
                {saved || <span className="text-muted">No description yet.</span>}
              </p>
            )}
            {canEdit && state === "error" ? (
              <p className="mt-1 text-sm text-danger-text">
                Not saved yet. Your text is kept here until it saves.
              </p>
            ) : null}
          </section>

          <dl className="grid grid-cols-[110px_1fr] gap-y-2.5 text-base">
            {object.owner ? (
              <>
                <dt className="text-muted">Owner</dt>
                <dd className="text-foreground">{object.owner.name}</dd>
              </>
            ) : null}
            {object.location && object.location.length > 0 ? (
              <>
                <dt className="text-muted">Location</dt>
                <dd className="text-foreground flex flex-wrap items-center gap-1">
                  {object.location.map((crumb, i) => (
                    <span key={crumb.href} className="inline-flex items-center gap-1">
                      {i > 0 ? <span className="text-muted">›</span> : null}
                      <Link href={crumb.href} className="hover:underline" onClick={() => onOpenChange(false)}>
                        {crumb.label}
                      </Link>
                    </span>
                  ))}
                </dd>
              </>
            ) : null}
            {object.createdAt ? (
              <>
                <dt className="text-muted">Created</dt>
                <dd className="text-foreground">
                  {new Date(object.createdAt).toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" })}
                </dd>
              </>
            ) : null}
            {object.contents ? (
              <>
                <dt className="text-muted">Contents</dt>
                <dd className="text-foreground">{object.contents}</dd>
              </>
            ) : null}
          </dl>
        </div>
      </DialogContent>
    </Dialog>
  );
}
