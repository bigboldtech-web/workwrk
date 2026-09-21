"use client";

// DocRowMenu (spec-docs-knowledge section 3): the ONE menu for a doc, used by
// the /docs table rows, the Docs sidebar tree, FAVORITES rows, the Space tree
// doc rows and the editor "..." (which adds its page options around it).
//
// Rows, in the spec's order, each rendered only when the role allows it:
//   Open · Open beside · Copy link (cmd L) · Add to / Remove from favorites ·
//   Rename (inline) · New doc inside · Move to… · Share · Duplicate (cmd D) ·
//   separator · Move to Trash (destructive; Full access, or own creation at
//   Can edit; Agents never)
// A Can view viewer's menu is Open, Open beside, Copy link, Add to favorites.
//
// It is a MenuList body. Hosts mount it in a MorePortal anchored to the row's
// "..." (or at the right-click point), or use `useDocRowMenu()` + `DocRowMenuHost`,
// which do that wiring once. The old `note-actions-menu.tsx` wrapper is gone:
// the Docs sidebar tree, the doc pages panel and the Space tree doc rows all
// mount this host directly.

import { useEffect, useRef, useState, type RefObject } from "react";
import { useRouter, usePathname } from "next/navigation";
import {
  Columns2, Copy, ExternalLink, FileText, FolderInput, Link2, Pencil, Plus, Share2, Star, Trash2, LayoutTemplate,
} from "lucide-react";
import { MenuItem, MenuList, MenuSeparator } from "@/components/ui/menu";
import { MorePortal } from "@/components/layout/os/more-portal";
import { Picker } from "@/components/ui/picker";
import { useOsToast } from "@/components/layout/os/toast";
import { useBoot } from "@/components/layout/os/boot-context";
import { useConfirm } from "@/components/ui/dialog-provider";
import { refreshSidebar } from "@/components/layout/os/sidebar-refresh";
import { createChildPage } from "@/components/docs/doc-pages-panel";
import { EntityTile } from "@/components/ui/entity-tile";
import { apiFetch } from "@/lib/api-fetch";

export type DocMenuRole = "full" | "edit" | "comment" | "view";

/** GET /api/docs/[id]'s role fields, read when a host cannot pass the role. */
type ResolvedRole = { role: DocMenuRole; own: boolean };

export interface DocMenuTarget {
  id: string;
  title: string;
  parentId?: string | null;
  entityType?: string | null;
  entityId?: string | null;
  favorite?: boolean;
  /**
   * The viewer's role on this doc. Absent = the menu asks GET /api/docs/[id]
   * on open (the Space tree and older hosts know only the id and title), so a
   * Can view holder never sees Rename or Move and Full access always sees
   * Move to Trash.
   */
  role?: DocMenuRole;
  /** Created by the viewer: Move to Trash at Can edit. */
  own?: boolean;
}

export type DocMenuChange = "renamed" | "trashed" | "duplicated" | "favorited" | "child-created" | "moved" | "templated";

export function dispatchDocsChanged() {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new CustomEvent("workwrk:docs-changed"));
  refreshSidebar();
}

interface SpaceRow { id: string; name: string; slug?: string; icon?: string | null; color?: string | null }

export interface DocRowMenuProps {
  doc: DocMenuTarget;
  context: "table" | "tree" | "editor";
  onClose: () => void;
  onChanged?: (kind: DocMenuChange) => void;
  /** The host opens its Share dialog for this doc (absent = no Share row). */
  onShare?: () => void;
  /** Editor context: extra rows the host renders between the shared rows and Trash. */
  extraRows?: React.ReactNode;
  /** The editor focuses its title instead of the inline rename row. */
  onRenameInline?: () => void;
}

export function DocRowMenu({ doc, context, onClose, onChanged, onShare, extraRows, onRenameInline }: DocRowMenuProps) {
  const router = useRouter();
  const pathname = usePathname() || "";
  const { toast } = useOsToast();
  const confirm = useConfirm();
  const { boot } = useBoot();
  const [mode, setMode] = useState<"menu" | "rename" | "move">("menu");
  const [name, setName] = useState(doc.title);
  const [fav, setFav] = useState(!!doc.favorite);
  const [spaces, setSpaces] = useState<SpaceRow[] | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  // A host that knows the role passes it; otherwise it is resolved on open.
  // Until it lands, only the rows every role holds are rendered.
  const [resolved, setResolved] = useState<ResolvedRole | null>(null);
  const roleKnown = doc.role !== undefined;
  useEffect(() => {
    if (roleKnown) return;
    let alive = true;
    void (async () => {
      const r = await apiFetch<{ myRole?: string; canManage?: boolean; doc?: { createdById?: string | null } }>(`/api/docs/${doc.id}`, { cache: "no-store" });
      if (!alive) return;
      if (!r.ok) { setResolved({ role: "view", own: false }); return; }
      const myRole = r.data.myRole === "view" ? "view" : r.data.myRole === "comment" ? "comment" : "edit";
      setResolved({ role: r.data.canManage ? "full" : myRole, own: !!r.data.doc?.createdById && r.data.doc.createdById === boot.viewer.id });
    })();
    return () => { alive = false; };
  }, [roleKnown, doc.id, boot.viewer.id]);
  const role: DocMenuRole = doc.role ?? resolved?.role ?? "view";
  const own = doc.own ?? resolved?.own ?? false;
  const pending = !roleKnown && resolved === null;
  const canEdit = role === "full" || role === "edit";
  const canTrash = role === "full" || (role === "edit" && own);
  // Share writes the member map: Full access only, the same rule the header's
  // ShareOrRoleChip renders (Can edit shares only under toggle 4, which no
  // surface reads yet), so the two doors never disagree.
  const canShare = role === "full";
  const title = doc.title || "Untitled doc";
  const trashDays = boot.org.trashDays;

  const done = (kind: DocMenuChange) => { onChanged?.(kind); dispatchDocsChanged(); };

  function copyLink() {
    void navigator.clipboard?.writeText(`${window.location.origin}/docs/${doc.id}`).then(() => toast("Link copied"), () => toast("Couldn't copy link"));
    onClose();
  }

  function openBeside() {
    // On a doc page (from any context, the tree included): add ?peek= to the
    // current doc; on a list: open the doc.
    if (pathname.startsWith("/docs/")) {
      const current = pathname.slice("/docs/".length).split("/")[0];
      if (current && current !== doc.id) { router.push(`/docs/${current}?peek=${doc.id}`); onClose(); return; }
    }
    router.push(`/docs/${doc.id}`);
    onClose();
  }

  async function rename() {
    const t = name.trim() || "Untitled doc";
    if (t === doc.title) { onClose(); return; }
    setBusy("rename");
    const r = await apiFetch(`/api/docs/${doc.id}`, { method: "PUT", json: { title: t } });
    setBusy(null);
    if (r.ok) { toast("Renamed"); done("renamed"); } else toast(r.error || "Couldn't rename");
    onClose();
  }

  async function newInside() {
    const id = await createChildPage(doc.id);
    if (id) { done("child-created"); router.push(`/docs/${id}?new=1`); }
    else toast("Couldn't create the doc");
    onClose();
  }

  async function duplicate() {
    setBusy("duplicate");
    const r = await apiFetch<{ doc?: { id: string }; data?: { id: string }; id?: string }>(`/api/docs/${doc.id}/duplicate`, { method: "POST" });
    setBusy(null);
    if (r.ok) {
      const id = r.data?.doc?.id ?? r.data?.data?.id ?? r.data?.id;
      toast("Duplicated"); done("duplicated");
      if (id) router.push(`/docs/${id}`);
    } else toast(r.error || "Couldn't duplicate");
    onClose();
  }

  async function toggleFav() {
    const next = !fav;
    setFav(next);
    const r = await apiFetch("/api/me/favorites/docs", { method: "POST", json: { docId: doc.id, on: next } });
    if (r.ok) {
      window.dispatchEvent(new CustomEvent("workwrk:favs-changed"));
      onChanged?.("favorited");
      toast(next ? "Added to favorites" : "Removed from favorites");
    } else { setFav(!next); toast("Couldn't update favorite"); }
    onClose();
  }

  async function openMove() {
    setMode("move");
    if (spaces === null) {
      const r = await apiFetch<{ spaces?: SpaceRow[]; data?: SpaceRow[] } | SpaceRow[]>("/api/spaces", { cache: "no-store" });
      const list = r.ok ? (Array.isArray(r.data) ? r.data : r.data.spaces ?? r.data.data ?? []) : [];
      setSpaces(list.map((s) => ({ id: s.id, name: s.name, slug: s.slug, icon: s.icon ?? null, color: s.color ?? null })));
    }
  }

  async function moveTo(value: string) {
    const body = value === "none" ? { entityType: null, entityId: null } : { entityType: "SPACE", entityId: value };
    setBusy("move");
    const r = await apiFetch(`/api/docs/${doc.id}`, { method: "PUT", json: body });
    setBusy(null);
    if (r.ok) { toast(value === "none" ? "Moved to No location" : "Moved"); done("moved"); }
    else toast(r.error || "Couldn't move");
    onClose();
  }

  async function saveAsTemplate() {
    setBusy("template");
    const r = await apiFetch<{ template: { id: string; name: string } }>("/api/template-center/save-as", { method: "POST", json: { source: "DOC", docId: doc.id } });
    setBusy(null);
    if (r.ok) {
      toast("Saved as a template", { tone: "success", action: { label: "View", onClick: () => router.push("/templates?kind=doc") } });
      onChanged?.("templated");
    } else toast(r.error || "Couldn't save the template");
    onClose();
  }

  async function trash() {
    onClose();
    const ok = await confirm({
      title: `Move "${title}" to Trash?`,
      description: `You can restore it for ${trashDays} days.`,
      destructive: true,
      confirmLabel: "Move to Trash",
    });
    if (!ok) return;
    const r = await apiFetch(`/api/docs/${doc.id}`, { method: "DELETE" });
    if (r.ok) {
      toast("Moved to Trash", { action: { label: "View Trash", onClick: () => router.push("/trash?type=doc") } });
      done("trashed");
      if (pathname === `/docs/${doc.id}`) router.push("/docs");
    } else toast(r.error || "Couldn't move to Trash");
  }

  if (mode === "rename") {
    return (
      <MenuList className="p-2" style={{ minWidth: 240 }}>
        <form onSubmit={(e) => { e.preventDefault(); void rename(); }} className="flex flex-col gap-2">
          <input
            autoFocus
            value={name}
            onChange={(e) => setName(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Escape") { e.preventDefault(); onClose(); } }}
            onFocus={(e) => e.target.select()}
            placeholder="Doc name"
            className="h-9 w-full rounded-md border border-line-strong bg-raised px-3 text-base text-ink placeholder:text-ink-3 focus:outline-none focus-visible:border-brand"
          />
          <div className="flex justify-end gap-1">
            <button type="button" onClick={onClose} className="h-8 rounded-md px-2.5 text-sm font-medium text-ink-2 hover:bg-hover">Cancel</button>
            <button type="submit" disabled={busy === "rename"} className="h-8 rounded-md bg-brand px-3 text-sm font-medium text-white hover:bg-brand-hover disabled:opacity-50">Rename</button>
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
          ariaLabel={`Move ${title}`}
          searchPlaceholder="Find a Space"
          backdrop={false}
          selected={doc.entityType === "SPACE" ? doc.entityId ?? null : !doc.entityType ? "none" : null}
          onSelect={(v) => void moveTo(v)}
          emptyLabel="No Spaces"
          sections={[
            { options: [{ value: "none", label: "No location", description: "A standalone doc" }] },
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
          <MenuItem icon={FileText} label="Open" onClick={() => { router.push(`/docs/${doc.id}`); onClose(); }} />
          <MenuItem icon={Columns2} label="Open beside" onClick={openBeside} />
          <MenuItem icon={ExternalLink} label="Open in new tab" onClick={() => { window.open(`/docs/${doc.id}`, "_blank", "noopener"); onClose(); }} />
        </>
      ) : null}
      <MenuItem icon={Link2} label="Copy link" shortcut="⌘L" onClick={copyLink} />
      {context === "editor" ? extraRows : null}
      <MenuItem icon={Star} iconFilled={fav} label={fav ? "Remove from favorites" : "Add to favorites"} onClick={() => void toggleFav()} />
      {canEdit ? (
        <>
          <MenuItem icon={Pencil} label="Rename" onClick={() => { if (onRenameInline) { onClose(); onRenameInline(); } else { setName(doc.title); setMode("rename"); } }} />
          <MenuItem icon={Plus} label="New doc inside" onClick={() => void newInside()} />
          <MenuItem icon={FolderInput} label="Move to…" busy={busy === "move"} onClick={() => void openMove()} />
          {onShare && canShare ? <MenuItem icon={Share2} label="Share" onClick={() => { onClose(); onShare(); }} /> : null}
          <MenuItem icon={Copy} label="Duplicate" shortcut="⌘D" busy={busy === "duplicate"} onClick={() => void duplicate()} />
          {role === "full" ? <MenuItem icon={LayoutTemplate} label="Save as template" busy={busy === "template"} onClick={() => void saveAsTemplate()} /> : null}
        </>
      ) : null}
      {context !== "editor" ? extraRows : null}
      {pending ? (
        <div className="flex flex-col gap-2 px-3 py-2" aria-busy="true" aria-label="Loading">
          {["60%", "45%"].map((w, i) => <span key={i} className="h-3 rounded bg-skeleton os-skeleton-pulse" style={{ width: w }} />)}
        </div>
      ) : null}
      {canTrash ? (
        <>
          <MenuSeparator />
          <MenuItem icon={Trash2} label="Move to Trash" destructive onClick={() => void trash()} />
        </>
      ) : null}
    </MenuList>
  );
}

/* ───────────────────────── the host: point or anchor ───────────────────────── */

export interface DocRowMenuState {
  doc: DocMenuTarget;
  point: { x: number; y: number } | null;
  anchor: RefObject<HTMLElement | null> | null;
}

/**
 * `const menu = useDocRowMenu();` then `menu.openAt(e, doc)` from a
 * right-click, or `menu.openFrom(buttonRef, doc)` from a "..." button, and
 * render `<DocRowMenuHost menu={menu} context="table" onChanged={...} />` once.
 */
export function useDocRowMenu() {
  const [state, setState] = useState<DocRowMenuState | null>(null);
  const openAt = (e: React.MouseEvent, doc: DocMenuTarget) => {
    e.preventDefault();
    e.stopPropagation();
    setState({ doc, point: { x: e.clientX, y: e.clientY }, anchor: null });
  };
  const openFrom = (anchor: RefObject<HTMLElement | null>, doc: DocMenuTarget) => setState({ doc, point: null, anchor });
  /**
   * One opener for both gestures: a right-click opens at the pointer; a click
   * on a "..." button anchors to that button, so Enter and Space on the
   * focused button (clientX/Y = 0) open the menu beside the row and never at
   * the viewport's corner (design 4.7: every control works from the keyboard).
   */
  const open = (e: React.MouseEvent, doc: DocMenuTarget) => {
    e.preventDefault();
    e.stopPropagation();
    const el = e.type === "contextmenu" ? null : (e.currentTarget as HTMLElement | null);
    setState(el ? { doc, point: null, anchor: { current: el } } : { doc, point: { x: e.clientX, y: e.clientY }, anchor: null });
  };
  const close = () => setState(null);
  return { state, openAt, openFrom, open, close };
}

export function DocRowMenuHost({ menu, context, onChanged, onShare }: {
  menu: ReturnType<typeof useDocRowMenu>;
  context: "table" | "tree" | "editor";
  onChanged?: (kind: DocMenuChange, doc: DocMenuTarget) => void;
  onShare?: (doc: DocMenuTarget) => void;
}) {
  const dummy = useRef<HTMLElement | null>(null);
  const s = menu.state;
  if (!s) return null;
  return (
    <MorePortal anchorRef={s.anchor ?? dummy} width={240} open placement="below" point={s.point} onClose={menu.close}>
      <DocRowMenu
        doc={s.doc}
        context={context}
        onClose={menu.close}
        onChanged={(kind) => onChanged?.(kind, s.doc)}
        onShare={onShare ? () => onShare(s.doc) : undefined}
      />
    </MorePortal>
  );
}
