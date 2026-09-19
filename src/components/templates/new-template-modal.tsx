"use client";

// "New template": the one primary on /templates (spec-spaces-lists section 2).
//
// "What do you want to save?" over the things the viewer can actually save,
// then Name, Description and Category, then the existing save-as flow.
//
// WHAT IT OFFERS, AND WHY NOT MORE. The spec's picker names Lists, Folders,
// Spaces, Docs and Canvases. `POST /api/template-center/save-as` snapshots two
// of those, Lists and Spaces, because `snapshotBoard` and `snapshotSpace` are
// the only snapshotters that exist. Offering the other three would be three
// rows that 400, so the picker offers what can be saved and no more; adding a
// snapshotter is what adds a row here, not a copy change.
//
// A viewer with nothing they can save sees the empty sentence rather than a
// picker with no options, and /templates renders no primary at all for them.

import { useCallback, useEffect, useState } from "react";
import { Boxes, ListChecks } from "lucide-react";
import { apiFetch } from "@/lib/api-fetch";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Dots } from "@/components/ui/dots";
import { EntityTile } from "@/components/ui/entity-tile";
import { useOsToast } from "@/components/layout/os/toast";

interface SourceRow {
  source: "LIST" | "SPACE";
  id: string;
  name: string;
  icon: string | null;
  color: string | null;
  /** "Design Team" for a List, "8 lists" for a Space. */
  meta: string;
}

interface SpaceApiRow {
  id: string;
  name: string;
  icon?: string | null;
  color?: string | null;
  boardCount?: number;
  /** "view" | "edit" | "full": `GET /api/spaces` decides it per Space. */
  role?: string | null;
}

interface ChildrenApiPayload {
  boards?: Array<{ id: string; name: string; icon?: string | null; color?: string | null; role?: string | null }>;
  folders?: Array<{ boards?: Array<{ id: string; name: string; icon?: string | null; color?: string | null; role?: string | null }> }>;
}

/** Can this person publish this object's structure to the whole org? */
function manageable(role: string | null | undefined): boolean {
  return role === "edit" || role === "full" || role === "admin" || role === "owner";
}

/**
 * The modal mounts only while it is open.
 *
 * The body used to stay mounted and RESET its four fields inside the effect
 * that ran on `open`. Mounting on demand gets the same fresh form from the
 * useState initializers, with no effect writing state at all, which is what
 * `react-hooks/set-state-in-effect` is about: an effect that sets state runs a
 * second render pass for a value the first render could have had.
 */
export function NewTemplateModal({ open, onClose, onSaved }: { open: boolean; onClose: () => void; onSaved: () => void }) {
  if (!open) return null;
  return <NewTemplateModalBody onClose={onClose} onSaved={onSaved} />;
}

function NewTemplateModalBody({
  onClose,
  onSaved,
}: {
  onClose: () => void;
  onSaved: () => void;
}) {
  const { toast } = useOsToast();
  const [sources, setSources] = useState<SourceRow[] | null>(null);
  const [failed, setFailed] = useState<string | null>(null);
  const [picked, setPicked] = useState<SourceRow | null>(null);
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [category, setCategory] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let live = true;
    void (async () => {
      const res = await apiFetch<{ spaces: SpaceApiRow[] }>("/api/spaces", { cache: "no-store" });
      if (!live) return;
      if (!res.ok) { setFailed(res.error); return; }
      // Only the Spaces this person manages, and only their Lists: a row you
      // cannot save would be a row whose Save button 403s.
      const spaces = (res.data.spaces ?? []).filter((s) => manageable(s.role));
      const rows: SourceRow[] = spaces.map((s) => ({
        source: "SPACE" as const,
        id: s.id,
        name: s.name,
        icon: s.icon ?? null,
        color: s.color ?? null,
        meta: typeof s.boardCount === "number" ? `${s.boardCount} list${s.boardCount === 1 ? "" : "s"}` : "Space",
      }));
      // `GET /api/spaces` carries counts, not children, so the Lists come from
      // the same children route the sidebar tree expands with.
      const children = await Promise.all(
        spaces.map((s) => apiFetch<ChildrenApiPayload>(`/api/spaces/${s.id}/children`, { cache: "no-store" })),
      );
      if (!live) return;
      children.forEach((child, i) => {
        if (!child.ok) return;
        const space = spaces[i];
        const boards = [
          ...(child.data.boards ?? []),
          ...(child.data.folders ?? []).flatMap((f) => f.boards ?? []),
        ];
        for (const b of boards) {
          rows.push({ source: "LIST", id: b.id, name: b.name, icon: b.icon ?? null, color: b.color ?? null, meta: space.name });
        }
      });
      setSources(rows);
      setFailed(null);
    })();
    return () => { live = false; };
  }, []);

  const save = useCallback(async () => {
    if (!picked) return;
    setBusy(true);
    const res = await apiFetch<{ template: { name: string } }>("/api/template-center/save-as", {
      method: "POST",
      json: {
        source: picked.source,
        ...(picked.source === "LIST" ? { boardId: picked.id } : { spaceId: picked.id }),
        ...(name.trim() ? { name: name.trim() } : {}),
        ...(description.trim() ? { description: description.trim() } : {}),
        ...(category.trim() ? { category: category.trim() } : {}),
      },
    });
    setBusy(false);
    if (!res.ok) {
      toast("Couldn't save that as a template", { tone: "danger", description: res.error });
      return;
    }
    toast(`${res.data.template.name} saved as a template`);
    onSaved();
    onClose();
  }, [picked, name, description, category, toast, onSaved, onClose]);

  return (
    <Dialog open onOpenChange={(v) => { if (!v) onClose(); }}>
      <DialogContent className="max-w-[560px]">
        <DialogHeader>
          <DialogTitle>{picked ? "Save as a template" : "What do you want to save?"}</DialogTitle>
        </DialogHeader>

        {picked ? (
          <>
            <div className="flex items-center gap-2 rounded-lg border border-line px-3 py-2">
              <EntityTile size="sm" icon={picked.icon} color={picked.color} name={picked.name} />
              <span className="min-w-0 flex-1 truncate text-base font-medium text-ink">{picked.name}</span>
              <button type="button" onClick={() => setPicked(null)} className="text-base font-medium text-brand-deep hover:underline">
                Change
              </button>
            </div>
            <label className="block">
              <span className="text-sm font-medium text-ink-2">Name</span>
              <input
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder={picked.name}
                className="mt-1 h-9 w-full rounded-lg border border-line bg-raised px-2 text-base text-ink"
              />
            </label>
            <label className="block">
              <span className="text-sm font-medium text-ink-2">Description</span>
              <textarea
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                rows={3}
                placeholder="What is this for?"
                className="mt-1 w-full rounded-lg border border-line bg-raised px-2 py-1.5 text-base text-ink"
              />
            </label>
            <label className="block">
              <span className="text-sm font-medium text-ink-2">Category</span>
              <input
                value={category}
                onChange={(e) => setCategory(e.target.value)}
                placeholder="Lists"
                className="mt-1 h-9 w-full rounded-lg border border-line bg-raised px-2 text-base text-ink"
              />
            </label>
            <div className="mt-2 flex items-center gap-2">
              <button
                type="button"
                disabled={busy}
                onClick={() => void save()}
                className="inline-flex h-9 items-center gap-2 rounded-lg bg-brand px-4 text-base font-medium text-white disabled:opacity-60"
              >
                {busy ? <Dots variant="pending" /> : null} Save template
              </button>
              <button type="button" onClick={onClose} className="inline-flex h-9 items-center rounded-lg border border-line px-3 text-base text-ink hover:bg-hover">
                Cancel
              </button>
            </div>
          </>
        ) : failed ? (
          <p className="text-base text-ink-2">Couldn&apos;t load what you can save. {failed}</p>
        ) : sources === null ? (
          <div className="flex h-24 items-center justify-center"><Dots variant="pending" /></div>
        ) : sources.length === 0 ? (
          <p className="text-base text-ink-2">
            There is nothing you can save yet. Templates are made from a List or a Space you can manage.
          </p>
        ) : (
          <div className="max-h-[320px] overflow-y-auto rounded-lg border border-line">
            {sources.map((s) => (
              <button
                key={`${s.source}-${s.id}`}
                type="button"
                onClick={() => { setPicked(s); setName(s.name); }}
                className="flex w-full items-center gap-2.5 border-b border-line-soft px-3 text-start last:border-b-0 hover:bg-hover"
                style={{ minHeight: "var(--os-row-h)" }}
              >
                <EntityTile
                  size="sm"
                  icon={s.icon ?? (s.source === "SPACE" ? Boxes : ListChecks)}
                  color={s.color}
                  name={s.name}
                />
                <span className="min-w-0 flex-1 truncate text-base font-medium text-ink">{s.name}</span>
                <span className="shrink-0 text-sm text-ink-2">{s.meta}</span>
              </button>
            ))}
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
