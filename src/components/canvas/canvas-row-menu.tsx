"use client";

// CanvasRowMenu (spec-docs-knowledge section 3): the ONE menu for a canvas,
// shared by the /canvas rows and cards, the Space tree canvas rows
// (CanvasMoreTrigger delegates here) and the /canvas/[id] editor "...".
//
//   Open · Copy link · Add to / Remove from favorites · Rename (inline) ·
//   Move to… (Space picker or No location; PATCH { spaceId }) · Share ·
//   Duplicate · Save as template (Full access) · separator · Move to Trash
//   (Full access; DELETE sets archivedAt, restorable from /trash?type=canvas)

import { useRef, useState, type RefObject } from "react";
import { usePathname, useRouter } from "next/navigation";
import { Copy, ExternalLink, FolderInput, Frame, LayoutTemplate, Link2, Pencil, Share2, Star, Trash2 } from "lucide-react";
import { MenuItem, MenuList, MenuSeparator } from "@/components/ui/menu";
import { MorePortal } from "@/components/layout/os/more-portal";
import { Picker } from "@/components/ui/picker";
import { EntityTile } from "@/components/ui/entity-tile";
import { useOsToast } from "@/components/layout/os/toast";
import { useBoot } from "@/components/layout/os/boot-context";
import { useConfirm } from "@/components/ui/dialog-provider";
import { refreshSidebar } from "@/components/layout/os/sidebar-refresh";
import { apiFetch } from "@/lib/api-fetch";

export interface CanvasMenuTarget {
  id: string;
  name: string;
  spaceId?: string | null;
  favorite?: boolean;
  /** Full access (owner or admin): Save as template and Move to Trash. */
  canManage?: boolean;
  /** Can edit the scene (absent = true, today's default). */
  canEdit?: boolean;
}

export type CanvasMenuChange = "renamed" | "trashed" | "duplicated" | "favorited" | "moved" | "templated";

export function dispatchCanvasesChanged() {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new CustomEvent("workwrk:whiteboards-changed"));
  refreshSidebar();
}

interface SpaceRow { id: string; name: string; icon?: string | null; color?: string | null }

export function CanvasRowMenu({ canvas, context = "row", onClose, onChanged, onShare, onRenameInline, extraRows }: {
  canvas: CanvasMenuTarget;
  /** The editor "..." is already on the canvas: no Open rows there. */
  context?: "row" | "editor";
  onClose: () => void;
  onChanged?: (kind: CanvasMenuChange) => void;
  onShare?: () => void;
  /** The editor focuses its title field instead of the inline rename row. */
  onRenameInline?: () => void;
  extraRows?: React.ReactNode;
}) {
  const router = useRouter();
  const pathname = usePathname() || "";
  const { toast } = useOsToast();
  const confirm = useConfirm();
  const { boot } = useBoot();
  const [mode, setMode] = useState<"menu" | "rename" | "move">("menu");
  const [draft, setDraft] = useState(canvas.name);
  const [fav, setFav] = useState(!!canvas.favorite);
  const [spaces, setSpaces] = useState<SpaceRow[] | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const canEdit = canvas.canEdit !== false;
  const canManage = canvas.canManage !== false;
  const name = canvas.name || "Untitled canvas";
  const trashDays = boot.org.trashDays;
  const done = (kind: CanvasMenuChange) => { onChanged?.(kind); dispatchCanvasesChanged(); };

  function copyLink() {
    void navigator.clipboard?.writeText(`${window.location.origin}/canvas/${canvas.id}`).then(() => toast("Link copied"), () => toast("Couldn't copy link"));
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
      const r = await apiFetch<{ spaces?: SpaceRow[]; data?: SpaceRow[] } | SpaceRow[]>("/api/spaces", { cache: "no-store" });
      const list = r.ok ? (Array.isArray(r.data) ? r.data : r.data.spaces ?? r.data.data ?? []) : [];
      setSpaces(list.map((s) => ({ id: s.id, name: s.name, icon: s.icon ?? null, color: s.color ?? null })));
    }
  }

  async function moveTo(value: string) {
    setBusy("move");
    const r = await apiFetch(`/api/whiteboards/${canvas.id}`, { method: "PATCH", json: { spaceId: value === "none" ? null : value } });
    setBusy(null);
    if (r.ok) { toast(value === "none" ? "Moved to No location" : "Moved"); done("moved"); router.refresh(); }
    else toast(r.error || "Couldn't move");
    onClose();
  }

  async function duplicate() {
    setBusy("duplicate");
    const r = await apiFetch<{ whiteboard: { id: string } }>(`/api/whiteboards/${canvas.id}/duplicate`, { method: "POST" });
    setBusy(null);
    if (r.ok) { toast("Duplicated"); done("duplicated"); router.push(`/canvas/${r.data.whiteboard.id}`); }
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
      if (pathname === `/canvas/${canvas.id}`) router.push("/canvas"); else router.refresh();
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
            { options: [{ value: "none", label: "No location", description: "A standalone canvas" }] },
            { label: "Spaces", options: (spaces ?? []).map((s) => ({ value: s.id, label: s.name, glyph: <EntityTile size="xs" icon={s.icon} color={s.color} name={s.name} fallback="folder" /> })) },
          ]}
        />
      </div>
    );
  }

  return (
    <MenuList style={{ minWidth: 220 }}>
      {context !== "editor" ? (
        <>
          <MenuItem icon={Frame} label="Open" onClick={() => { router.push(`/canvas/${canvas.id}`); onClose(); }} />
          <MenuItem icon={ExternalLink} label="Open in new tab" onClick={() => { window.open(`/canvas/${canvas.id}`, "_blank", "noopener"); onClose(); }} />
        </>
      ) : null}
      <MenuItem icon={Link2} label="Copy link" shortcut="⌘L" onClick={copyLink} />
      <MenuItem icon={Star} iconFilled={fav} label={fav ? "Remove from favorites" : "Add to favorites"} onClick={() => void toggleFav()} />
      {canEdit ? (
        <>
          <MenuItem icon={Pencil} label="Rename" onClick={() => { if (onRenameInline) { onClose(); onRenameInline(); } else { setDraft(canvas.name); setMode("rename"); } }} />
          <MenuItem icon={FolderInput} label="Move to…" busy={busy === "move"} onClick={() => void openMove()} />
          {onShare ? <MenuItem icon={Share2} label="Share" onClick={() => { onClose(); onShare(); }} /> : null}
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
  const s = menu.state;
  if (!s) return null;
  return (
    <MorePortal anchorRef={s.anchor ?? dummy} width={240} open placement="below" point={s.point} onClose={menu.close}>
      <CanvasRowMenu canvas={s.canvas} onClose={menu.close} onChanged={(k) => onChanged?.(k, s.canvas)} onShare={onShare ? () => onShare(s.canvas) : undefined} />
    </MorePortal>
  );
}
