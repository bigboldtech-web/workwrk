"use client";

// CanvasRowMenu (spec-docs-knowledge section 3): the ONE menu for a canvas,
// shared by the /canvas rows and cards, the Space tree canvas rows
// (CanvasMoreTrigger delegates here) and the /canvas/[id] editor "...".
//
//   Open · Copy link · Add to / Remove from favorites · Rename (inline) ·
//   Move to… (Space picker or No location; PATCH { spaceId }) · Manage access
//   (Who has access below Full access) · Duplicate · Save as template (Full
//   access) · separator · Move to Trash (Full access; DELETE sets archivedAt,
//   restorable from /trash?type=canvas)
//
// THE ACCESS ROW opens the canvas's OWN Manage access dialog, for every
// reader (Agents excepted: they never share). The editor's Share chip used to
// open its Space's dialog instead, so sharing a canvas added a Space member
// and handed out the whole Space (the reported over-grant). CanvasRowMenuHost
// mounts the dialog when its host passes none.
//
// WHERE ITS ROWS GO: the section the menu is used in (src/lib/nav/
// object-href.ts). Open, Open in new tab and Duplicate build the address of
// the section the person is in when they click (the Space-scoped Work
// address when the host passes spaceSlug); Copy link copies the share form.
// A Trash of the OPEN canvas always leaves it for its section's list: in
// Work the pathname never equalled /canvas/<id>, so the trashed canvas stayed
// mounted and its autosave kept writing to an archived board.

import { useRef, useState, type RefObject } from "react";
import { useRouter } from "next/navigation";
import { Copy, ExternalLink, FolderInput, Frame, LayoutTemplate, Link2, Pencil, Star, Trash2, UserPlus, Users } from "lucide-react";
import { MenuItem, MenuList, MenuSeparator } from "@/components/ui/menu";
import { ShareDialog } from "@/components/access/share-dialog";
import { MorePortal } from "@/components/layout/os/more-portal";
import { Picker } from "@/components/ui/picker";
import { EntityTile } from "@/components/ui/entity-tile";
import { useOsToast } from "@/components/layout/os/toast";
import { useBoot } from "@/components/layout/os/boot-context";
import { useConfirm } from "@/components/ui/dialog-provider";
import { refreshSidebar } from "@/components/layout/os/sidebar-refresh";
import { apiFetch } from "@/lib/api-fetch";
import { currentOpenObject } from "@/components/layout/os/work-placement";
import { copyObjectLink, objectHrefNow } from "@/components/layout/os/use-object-href";

export interface CanvasMenuTarget {
  id: string;
  name: string;
  spaceId?: string | null;
  /** The canvas's Space slug when the host knows it (a Work tree row, the editor in Work). */
  spaceSlug?: string | null;
  favorite?: boolean;
  /** Full access (owner or admin): Save as template and Move to Trash. */
  canManage?: boolean;
  /** Can edit the scene (absent = true, today's default). */
  canEdit?: boolean;
}

export type CanvasMenuChange = "renamed" | "trashed" | "duplicated" | "favorited" | "moved" | "templated" | "shared";

export function dispatchCanvasesChanged() {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new CustomEvent("workwrk:whiteboards-changed"));
  refreshSidebar();
}

interface SpaceRow { id: string; name: string; icon?: string | null; color?: string | null; pickable?: boolean; folders?: Array<{ id: string; name: string }> }

/** GET /api/move/destinations: the places the move rule accepts (node-placement moveDestinations). */
interface MoveDestinationsReply {
  root: { pickable: boolean; current: boolean } | null;
  spaces: Array<{ id: string; name: string; icon: string | null; color: string | null; pickable: boolean; folders: Array<{ id: string; name: string; pickable: boolean }> }>;
}

export function CanvasRowMenu({ canvas, context = "row", onClose, onChanged, onShare, onRenameInline, extraRows }: {
  canvas: CanvasMenuTarget;
  /** The editor "..." is already on the canvas: no Open rows there. */
  context?: "row" | "editor";
  onClose: () => void;
  onChanged?: (kind: CanvasMenuChange) => void;
  /** Opens the canvas's Manage access dialog, read only below Full access (absent = no access row). */
  onShare?: (readOnly: boolean) => void;
  /** The editor focuses its title field instead of the inline rename row. */
  onRenameInline?: () => void;
  extraRows?: React.ReactNode;
}) {
  const router = useRouter();
  const { toast } = useOsToast();
  const confirm = useConfirm();
  const { boot } = useBoot();
  const [mode, setMode] = useState<"menu" | "rename" | "move">("menu");
  const [draft, setDraft] = useState(canvas.name);
  const [fav, setFav] = useState(!!canvas.favorite);
  const [spaces, setSpaces] = useState<SpaceRow[] | null>(null);
  const [rootMove, setRootMove] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const canEdit = canvas.canEdit !== false;
  const canManage = canvas.canManage !== false;
  const name = canvas.name || "Untitled canvas";
  const trashDays = boot.org.trashDays;
  const done = (kind: CanvasMenuChange) => { onChanged?.(kind); dispatchCanvasesChanged(); };

  function copyLink() {
    void navigator.clipboard?.writeText(copyObjectLink("canvas", canvas.id)).then(() => toast("Link copied"), () => toast("Couldn't copy link"));
    onClose();
  }

  async function rename() {
    const v = draft.trim();
    if (!v || v === canvas.name) { onClose(); return; }
    setBusy("rename");
    const r = await apiFetch(`/api/whiteboards/${canvas.id}`, { method: "PATCH", json: { name: v } });
    setBusy(null);
    if (r.ok) { toast("Renamed"); done("renamed"); router.refresh(); } else toast(r.error || "Couldn't rename");
    onClose();
  }

  async function toggleFav() {
    const next = !fav;
    setFav(next);
    const r = await apiFetch("/api/me/favorites/whiteboards", { method: "POST", json: { whiteboardId: canvas.id, on: next } });
    if (r.ok) { window.dispatchEvent(new CustomEvent("workwrk:favs-changed")); onChanged?.("favorited"); toast(next ? "Added to favorites" : "Removed from favorites"); }
    else { setFav(!next); toast("Couldn't update favorite"); }
    onClose();
  }

  async function openMove() {
    setMode("move");
    if (spaces === null) {
      // Exactly the places the move rule accepts for this person (the
      // placement rule, P5): Space roots, Folders, and No location only when
      // each would be taken.
      const r = await apiFetch<MoveDestinationsReply>(`/api/move/destinations?kind=canvas&id=${encodeURIComponent(canvas.id)}`, { cache: "no-store" });
      const d = r.ok ? r.data : null;
      setRootMove(d?.root?.pickable === true);
      setSpaces((d?.spaces ?? []).map((s) => ({ id: s.id, name: s.name, icon: s.icon ?? null, color: s.color ?? null, pickable: s.pickable, folders: s.folders.filter((f) => f.pickable) })));
    }
  }

  async function moveTo(value: string) {
    setBusy("move");
    const json = value === "none" ? { spaceId: null } : value.startsWith("folder:") ? { folderId: value.slice(7) } : { spaceId: value, folderId: null };
    const r = await apiFetch(`/api/whiteboards/${canvas.id}`, { method: "PATCH", json });
    setBusy(null);
    // A refusal keeps the picker open on the choice, with the server's sentence.
    if (!r.ok) { toast(r.error || "Couldn't move"); return; }
    toast(value === "none" ? "Moved to No location" : "Moved"); done("moved"); router.refresh();
    onClose();
  }

  async function duplicate() {
    setBusy("duplicate");
    const r = await apiFetch<{ whiteboard: { id: string } }>(`/api/whiteboards/${canvas.id}/duplicate`, { method: "POST" });
    setBusy(null);
    if (r.ok) { toast("Duplicated"); done("duplicated"); router.push(objectHrefNow("canvas", r.data.whiteboard.id, canvas.spaceSlug)); }
    else toast(r.error || "Couldn't duplicate");
    onClose();
  }

  async function saveAsTemplate() {
    setBusy("template");
    const r = await apiFetch<{ template: { id: string } }>("/api/template-center/save-as", { method: "POST", json: { source: "WHITEBOARD", whiteboardId: canvas.id } });
    setBusy(null);
    if (r.ok) { toast("Saved as a template", { tone: "success", action: { label: "View", onClick: () => router.push("/templates?kind=canvas") } }); onChanged?.("templated"); }
    else toast(r.error || "Couldn't save the template");
    onClose();
  }

  async function trash() {
    onClose();
    const ok = await confirm({ title: `Move "${name}" to Trash?`, description: `Restore within ${trashDays} days.`, destructive: true, confirmLabel: "Move to Trash" });
    if (!ok) return;
    const r = await apiFetch(`/api/whiteboards/${canvas.id}`, { method: "DELETE" });
    if (r.ok) {
      toast("Moved to Trash", { action: { label: "View Trash", onClick: () => router.push("/trash?type=canvas") } });
      done("trashed");
      const open = currentOpenObject();
      if (open?.kind === "canvas" && open.id === canvas.id) router.push(open.closeHref); else router.refresh();
    } else toast(r.error || "Couldn't move to Trash");
  }

  if (mode === "rename") {
    return (
      <MenuList className="p-2" style={{ minWidth: 240 }}>
        <form onSubmit={(e) => { e.preventDefault(); void rename(); }} className="flex flex-col gap-2">
          <input autoFocus value={draft} onChange={(e) => setDraft(e.target.value)} onKeyDown={(e) => { if (e.key === "Escape") { e.preventDefault(); onClose(); } }} onFocus={(e) => e.target.select()} placeholder="Canvas name"
            className="h-9 w-full rounded-md border border-line-strong bg-raised px-3 text-base text-ink placeholder:text-ink-3 focus:outline-none focus-visible:border-brand" />
          <div className="flex justify-end gap-1">
            <button type="button" onClick={onClose} className="h-8 rounded-md px-2.5 text-sm font-medium text-ink-2 hover:bg-hover">Cancel</button>
            <button type="submit" disabled={busy === "rename" || !draft.trim()} className="h-8 rounded-md bg-brand px-3 text-sm font-medium text-white hover:bg-brand-hover disabled:opacity-50">Rename</button>
          </div>
        </form>
      </MenuList>
    );
  }

  if (mode === "move") {
    return (
      <div className="relative">
        <Picker
          open
          onClose={onClose}
          ariaLabel={`Move ${name}`}
          searchPlaceholder="Find a Space"
          backdrop={false}
          selected={canvas.spaceId ?? "none"}
          onSelect={(v) => void moveTo(v)}
          emptyLabel="No Spaces"
          sections={[
            ...(rootMove ? [{ options: [{ value: "none", label: "No location", description: "A standalone canvas" }] }] : []),
            { label: "Spaces", options: (spaces ?? []).filter((s) => s.pickable !== false).map((s) => ({ value: s.id, label: s.name, glyph: <EntityTile size="xs" icon={s.icon} color={s.color} name={s.name} fallback="folder" /> })) },
            { label: "Folders", options: (spaces ?? []).flatMap((s) => (s.folders ?? []).map((f) => ({ value: `folder:${f.id}`, label: f.name, description: s.name, glyph: <EntityTile size="xs" icon={null} color={null} name={f.name} fallback="folder" /> }))) },
          ]}
        />
      </div>
    );
  }

  return (
    <MenuList style={{ minWidth: 220 }}>
      {context !== "editor" ? (
        <>
          <MenuItem icon={Frame} label="Open" onClick={() => { router.push(objectHrefNow("canvas", canvas.id, canvas.spaceSlug)); onClose(); }} />
          <MenuItem icon={ExternalLink} label="Open in new tab" onClick={() => { window.open(objectHrefNow("canvas", canvas.id, canvas.spaceSlug), "_blank", "noopener"); onClose(); }} />
        </>
      ) : null}
      <MenuItem icon={Link2} label="Copy link" shortcut="⌘L" onClick={copyLink} />
      <MenuItem icon={Star} iconFilled={fav} label={fav ? "Remove from favorites" : "Add to favorites"} onClick={() => void toggleFav()} />
      {canEdit ? (
        <>
          <MenuItem icon={Pencil} label="Rename" onClick={() => { if (onRenameInline) { onClose(); onRenameInline(); } else { setDraft(canvas.name); setMode("rename"); } }} />
          <MenuItem icon={FolderInput} label="Move to…" busy={busy === "move"} onClick={() => void openMove()} />
        </>
      ) : null}
      {/* Full access on the canvas changes who can open it (MANAGE_BAR.canvas);
          everyone else may still read the list. */}
      {onShare ? (
        <MenuItem
          icon={canManage ? UserPlus : Users}
          label={canManage ? "Manage access" : "Who has access"}
          onClick={() => { onClose(); onShare(!canManage); }}
        />
      ) : null}
      {canEdit ? (
        <>
          <MenuItem icon={Copy} label="Duplicate" busy={busy === "duplicate"} onClick={() => void duplicate()} />
          {canManage ? <MenuItem icon={LayoutTemplate} label="Save as template" busy={busy === "template"} onClick={() => void saveAsTemplate()} /> : null}
        </>
      ) : null}
      {extraRows}
      {canManage ? (
        <>
          <MenuSeparator />
          <MenuItem icon={Trash2} label="Move to Trash" destructive onClick={() => void trash()} />
        </>
      ) : null}
    </MenuList>
  );
}

/* ───────────────────────── host ───────────────────────── */

export function useCanvasRowMenu() {
  const [state, setState] = useState<{ canvas: CanvasMenuTarget; point: { x: number; y: number } | null; anchor: RefObject<HTMLElement | null> | null } | null>(null);
  const openAt = (e: React.MouseEvent, canvas: CanvasMenuTarget) => { e.preventDefault(); e.stopPropagation(); setState({ canvas, point: { x: e.clientX, y: e.clientY }, anchor: null }); };
  const openFrom = (anchor: RefObject<HTMLElement | null>, canvas: CanvasMenuTarget) => setState({ canvas, point: null, anchor });
  const close = () => setState(null);
  return { state, openAt, openFrom, close };
}

export function CanvasRowMenuHost({ menu, onChanged, onShare }: {
  menu: ReturnType<typeof useCanvasRowMenu>;
  onChanged?: (kind: CanvasMenuChange, canvas: CanvasMenuTarget) => void;
  onShare?: (canvas: CanvasMenuTarget) => void;
}) {
  const dummy = useRef<HTMLElement | null>(null);
  const [share, setShare] = useState<{ canvas: CanvasMenuTarget; readOnly: boolean } | null>(null);
  const [shareOpen, setShareOpen] = useState(false);
  const s = menu.state;
  return (
    <>
      {s ? (
        <MorePortal anchorRef={s.anchor ?? dummy} width={240} open placement="below" point={s.point} onClose={menu.close}>
          <CanvasRowMenu
            canvas={s.canvas}
            onClose={menu.close}
            onChanged={(k) => onChanged?.(k, s.canvas)}
            onShare={(readOnly) => {
              if (onShare) { onShare(s.canvas); return; }
              setShare({ canvas: s.canvas, readOnly });
              setShareOpen(true);
            }}
          />
        </MorePortal>
      ) : null}
      {!onShare && share ? (
        <CanvasShareDialog
          open={shareOpen}
          onOpenChange={setShareOpen}
          canvas={share.canvas}
          readOnly={share.readOnly}
          onChanged={() => onChanged?.("shared", share.canvas)}
        />
      ) : null}
    </>
  );
}

/** The canvas's own Manage access dialog, for every canvas menu host. It never opens its Space's dialog. */
export function CanvasShareDialog({ open, onOpenChange, canvas, readOnly, onChanged }: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  canvas: Pick<CanvasMenuTarget, "id" | "name">;
  readOnly: boolean;
  onChanged?: () => void;
}) {
  return (
    <ShareDialog
      open={open}
      onOpenChange={onOpenChange}
      target={{ kind: "canvas", id: canvas.id, name: canvas.name || "Untitled canvas" }}
      readOnly={readOnly}
      onChanged={() => { onChanged?.(); dispatchCanvasesChanged(); }}
    />
  );
}
