"use client";

// CreateListModal: the ONE dialog that makes a List.
//
// Spec: docs/plans/ui-refresh/spec-spaces-lists.md section 3 (`CreateListModal`
// rebuilt on `ui/dialog`, "Name, Location picker with real `EntityTile`, Add
// description, Restricted switch, 'Use a template' link; one primary 'Create
// list'") and section 0 (`NewBoardDialog` is deleted; two dialogs for one
// object, and "Board" is a retired word).
//
// THREE THINGS THAT WERE WRONG:
//   * it was hand-rolled chrome, `fixed inset-0` plus its own backdrop and its
//     own Escape handling, rather than `ui/dialog`, so it was outside the
//     shell's layer stack and its own focus trap;
//   * the Location row's glyph was `icon={space.icon ? Boxes : null}`, which
//     throws the Space's real icon away and draws the same generic box for
//     every Space in the list (audit Low #32). The picker is the place a person
//     recognises their room by its tile;
//   * there was no Folder choice. A `folderId` could only arrive from the
//     opener, so "New list" from anywhere but a Folder page could not put the
//     List on a shelf, which is the first thing people do after making one.
// The footer button also read "Use Templates"; the canon is "Use a template".

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { ChevronDown, Check, Folder as FolderIcon } from "lucide-react";
import { Dialog, DialogContent, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Switch } from "@/components/ui/switch";
import { EntityTile } from "@/components/ui/entity-tile";
import { Dots } from "@/components/ui/dots";
import { useOsShell } from "./shell-context";
import { refreshSidebar } from "./sidebar-refresh";
import { treeChanged } from "@/lib/work/container-events";

type FolderRow = { id: string; name: string; icon: string | null; color: string | null; parentFolderId: string | null; pickable: boolean };
/** One Space from GET /api/move/destinations?create=list: its root is a place when `pickable`, and its Folders the ones a List may be made in. */
type SpaceRow = { id: string; slug?: string; name: string; icon: string | null; color: string | null; pickable: boolean; folders: FolderRow[] };

/** The place a new List lands by default in a Space: its root when the viewer may create there, else its first Folder they may. */
function defaultFolder(space: SpaceRow | null | undefined, wanted: string | null | undefined): string | null {
  if (!space) return null;
  if (wanted && space.folders.some((f) => f.id === wanted && f.pickable)) return wanted;
  if (space.pickable) return null;
  return space.folders.find((f) => f.pickable)?.id ?? null;
}

/** How deep each listed Folder sits under the Space, for the indent. */
function folderDepth(folders: FolderRow[], id: string): number {
  const byId = new Map(folders.map((f) => [f.id, f]));
  let d = 0;
  let cursor = byId.get(id)?.parentFolderId ?? null;
  while (cursor && byId.has(cursor) && d < 8) {
    d += 1;
    cursor = byId.get(cursor)?.parentFolderId ?? null;
  }
  return d;
}

export function CreateListModal() {
  const { createListOpen, closeCreateList, openTemplateCenter, createListPreselect } = useOsShell();
  const router = useRouter();
  const [listName, setListName] = useState("");
  const [description, setDescription] = useState("");
  const [isRestricted, setIsRestricted] = useState(false);
  const [spaces, setSpaces] = useState<SpaceRow[]>([]);
  const [spaceId, setSpaceId] = useState<string>("");
  const [folderId, setFolderId] = useState<string | null>(null);
  const [menu, setMenu] = useState<"space" | "folder" | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const loadedRef = useRef(false);

  // THE PLACES THIS PERSON MAY MAKE A LIST IN (the placement rule, node-rules
  // P1 and P5): GET /api/move/destinations?create=list asks the one create
  // rule per place, so the pickers offer exactly what POST /api/boards
  // accepts. They used to list every Space the person could read and each
  // Space's Folders with no role at all: a Can view holder was offered their
  // Spaces and refused on Create, and a Can edit grantee of one Folder inside
  // a Space they only pass through could not pick that Folder.
  useEffect(() => {
    if (!createListOpen || loadedRef.current) return;
    loadedRef.current = true;
    void fetch("/api/move/destinations?create=list", { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : { spaces: [] }))
      .then((d) => {
        const rows: SpaceRow[] = (Array.isArray(d?.spaces) ? d.spaces : []).map((x: SpaceRow) => ({
          ...x,
          folders: Array.isArray(x.folders) ? x.folders : [],
        }));
        setSpaces(rows);
        const preId = createListPreselect?.spaceId;
        const fromPreselect = preId ? rows.find((s) => s.id === preId) : null;
        const slug = typeof window !== "undefined" ? window.location.pathname.match(/\/spaces\/([^/?#]+)/)?.[1] : null;
        const fromRoute = slug ? rows.find((s) => s.slug === decodeURIComponent(slug)) : null;
        const first = fromPreselect ?? fromRoute ?? rows[0] ?? null;
        setSpaceId(first?.id ?? "");
        setFolderId(defaultFolder(first, createListPreselect?.folderId));
      })
      .catch(() => {});
  }, [createListOpen, createListPreselect]);

  const doClose = useCallback(() => {
    loadedRef.current = false;
    setListName(""); setDescription(""); setIsRestricted(false);
    setSpaceId(""); setFolderId(null);
    setError(null); setBusy(false); setMenu(null);
    closeCreateList();
  }, [closeCreateList]);

  const selectedSpace = spaces.find((s) => s.id === spaceId) ?? null;
  const folders = selectedSpace?.folders ?? [];
  const selectedFolder = folders.find((f) => f.id === folderId) ?? null;
  // A place is picked: the Space's root when it may hold the List, else one of its Folders that may.
  const placePicked = Boolean(selectedSpace) && (folderId ? Boolean(selectedFolder?.pickable) : Boolean(selectedSpace?.pickable));
  const canCreate = listName.trim().length > 0 && placePicked && !busy;

  const handleCreate = async () => {
    if (!canCreate) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/boards", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          spaceId,
          ...(folderId ? { folderId } : {}),
          name: listName.trim(),
          ...(description.trim() ? { description: description.trim() } : {}),
          // "Restricted" is the canon word for what the API calls PRIVATE.
          visibility: isRestricted ? "PRIVATE" : "WORKSPACE",
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) { setError(data?.error ?? "Couldn't create the list"); setBusy(false); return; }
      const slug = data?.board?.slug;
      refreshSidebar();
      treeChanged({ kind: "list", action: "created" });
      doClose();
      if (slug) router.push(`/boards/${slug}`);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't create the list");
      setBusy(false);
    }
  };

  if (!createListOpen) return null;

  return (
    <Dialog open onOpenChange={(v) => { if (!v) doClose(); }}>
      <DialogContent className="max-w-[480px] p-0 gap-0">
        <div className="px-5 pt-5 pb-3">
          <DialogTitle className="text-lg font-semibold">Create list</DialogTitle>
          <DialogDescription className="mt-1">
            A List holds tasks and its own statuses. It lives in a Space, and optionally on a shelf.
          </DialogDescription>
        </div>

        {error ? (
          <div className="mx-5 mb-2 rounded-md bg-danger-bg px-3 py-2 text-sm text-danger-text">{error}</div>
        ) : null}

        <div className="px-5 py-3 flex flex-col gap-4">
          <Field label="Name">
            <input
              type="text"
              value={listName}
              onChange={(e) => setListName(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter") void handleCreate(); }}
              placeholder="Your list or project name"
              autoFocus
              className={INPUT}
            />
          </Field>

          <Field label="Description">
            <input
              type="text"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="What is this list for?"
              className={INPUT}
            />
          </Field>

          <Field label="Space">
            <div className="relative">
              <button
                type="button"
                onClick={() => setMenu((m) => (m === "space" ? null : "space"))}
                className="w-full flex items-center justify-between h-8 px-3 bg-raised border border-line rounded-md hover:bg-hover transition-colors"
              >
                <span className="flex items-center gap-2 min-w-0">
                  {selectedSpace ? (
                    <>
                      {/* The Space's REAL tile, not a generic box (audit Low #32). */}
                      <EntityTile size="sm" icon={selectedSpace.icon} color={selectedSpace.color} name={selectedSpace.name} />
                      <span className="text-base text-ink font-medium truncate">{selectedSpace.name}</span>
                    </>
                  ) : (
                    <span className="text-base text-ink-3">{spaces.length ? "Pick a Space" : "Nowhere you can add a List"}</span>
                  )}
                </span>
                <ChevronDown className="w-4 h-4 text-ink-3 shrink-0" />
              </button>
              {menu === "space" ? (
                <Menu>
                  {spaces.length === 0 ? (
                    <div className="px-3 py-2 text-sm text-ink-3">Making a List needs Can edit on a Space or a folder.</div>
                  ) : (
                    spaces.map((s) => (
                      <MenuRow
                        key={s.id}
                        selected={s.id === spaceId}
                        onClick={() => { setSpaceId(s.id); setFolderId(defaultFolder(s, null)); setMenu(null); }}
                      >
                        <EntityTile size="sm" icon={s.icon} color={s.color} name={s.name} />
                        <span className="flex-1 text-base text-ink truncate">{s.name}</span>
                      </MenuRow>
                    ))
                  )}
                </Menu>
              ) : null}
            </div>
          </Field>

          <Field label="Folder">
            <div className="relative">
              <button
                type="button"
                onClick={() => setMenu((m) => (m === "folder" ? null : "folder"))}
                disabled={!spaceId}
                className="w-full flex items-center justify-between h-8 px-3 bg-raised border border-line rounded-md hover:bg-hover transition-colors disabled:opacity-50"
              >
                <span className="flex items-center gap-2 min-w-0">
                  {selectedFolder ? (
                    <>
                      <EntityTile size="sm" icon={selectedFolder.icon} color={selectedFolder.color} name={selectedFolder.name} fallback="folder" />
                      <span className="text-base text-ink truncate">{selectedFolder.name}</span>
                    </>
                  ) : (
                    <span className="text-base text-ink-2">{selectedSpace && !selectedSpace.pickable ? "Pick a folder" : "No folder (Space root)"}</span>
                  )}
                </span>
                <ChevronDown className="w-4 h-4 text-ink-3 shrink-0" />
              </button>
              {menu === "folder" ? (
                <Menu>
                  {selectedSpace?.pickable ? (
                    <MenuRow selected={folderId === null} onClick={() => { setFolderId(null); setMenu(null); }}>
                      <FolderIcon className="w-3.5 h-3.5 text-ink-3" />
                      <span className="flex-1 text-base text-ink-2 truncate">No folder (Space root)</span>
                    </MenuRow>
                  ) : null}
                  {folders.map((f) => (
                    f.pickable ? (
                      <MenuRow key={f.id} selected={f.id === folderId} onClick={() => { setFolderId(f.id); setMenu(null); }}>
                        <span style={{ width: folderDepth(folders, f.id) * 12 }} aria-hidden />
                        <EntityTile size="sm" icon={f.icon} color={f.color} name={f.name} fallback="folder" />
                        <span className="flex-1 text-base text-ink truncate">{f.name}</span>
                      </MenuRow>
                    ) : (
                      // A Folder on the way to one the person may add to: a header, not a place.
                      <div key={f.id} className="w-full flex items-center gap-2 px-3 py-1.5 text-ink-3">
                        <span style={{ width: folderDepth(folders, f.id) * 12 }} aria-hidden />
                        <EntityTile size="sm" icon={f.icon} color={f.color} name={f.name} fallback="folder" />
                        <span className="flex-1 text-base truncate">{f.name}</span>
                      </div>
                    )
                  ))}
                </Menu>
              ) : null}
            </div>
          </Field>

          <div className="flex items-center justify-between pt-1">
            <div className="flex flex-col">
              <span className="text-base font-medium text-ink">Restricted</span>
              <span className="text-sm text-ink-2">
                Only you and the people you share it with can open it. Change this later in Share.
              </span>
            </div>
            <Switch checked={isRestricted} onChange={setIsRestricted} aria-label="Restrict this list" />
          </div>
        </div>

        <div className="px-5 pt-3 pb-4 mt-1 border-t border-line-soft flex items-center justify-between">
          <button
            type="button"
            onClick={() => { doClose(); openTemplateCenter({ kind: "LIST" }); }}
            className="px-2.5 h-8 text-base font-medium text-ink-2 hover:text-ink hover:bg-hover rounded-md transition-colors"
          >
            Use a template
          </button>
          <button
            type="button"
            onClick={() => void handleCreate()}
            disabled={!canCreate}
            className="px-4 h-8 text-base font-medium rounded-md inline-flex items-center gap-1.5 text-ink-inv bg-brand hover:bg-brand-hover disabled:opacity-50"
          >
            {busy ? <Dots variant="pending" /> : null} Create list
          </button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

const INPUT =
  "w-full h-8 px-3 text-base bg-raised border border-line rounded-md text-ink placeholder:text-ink-3 focus:outline-none focus:border-brand transition-colors";

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-1.5">
      <label className="text-base font-medium text-ink-2">{label}</label>
      {children}
    </div>
  );
}

function Menu({ children }: { children: React.ReactNode }) {
  return (
    <div
      // Absolute, not fixed, and a DOM child of the dialog: ui/dialog centres
      // with a CSS transform, which a fixed child would inherit
      // (reference: picker-in-dialog positioning).
      className="absolute z-10 mt-1 start-0 end-0 max-h-[240px] overflow-y-auto rounded-md border border-line bg-raised py-1"
      style={{ boxShadow: "var(--os-shadow-pop)" }}
    >
      {children}
    </div>
  );
}

function MenuRow({
  selected, onClick, children,
}: {
  selected: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="w-full flex items-center gap-2 px-3 py-1.5 text-start hover:bg-hover"
    >
      {children}
      {selected ? <Check className="w-3.5 h-3.5 text-brand" /> : null}
    </button>
  );
}
