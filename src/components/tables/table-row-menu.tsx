"use client";

// TableRowMenu (spec-tables-forms section 3): the ONE menu for a table,
// rendered by the /tables row "...", the Tables sidebar row "...", the Space
// tree table row "..." and the sheet's title-row "...". It replaces
// table-more-menu.tsx (Rename and Delete only) and the sidebar's and the
// bottom tab bar's right-click Rename / Delete sheet menus, so a table can be
// renamed, copied, moved, starred, shared, exported or trashed from any of the
// places it is listed (data.md 3.5).
//
// Rows, in the spec's order, each rendered only when the viewer can use it:
//   Open · Open in new tab (not on the sheet itself) · separator ·
//   Rename (inline) and Duplicate (not a Guest, unless it is theirs) ·
//   Move to Space... (creator or admin) ·
//   Add to / Remove from favorites · separator · Share... · Copy link ·
//   Copy embed code (public link on) · separator · Export as CSV (never an
//   Agent) · separator ·
//   Move to Trash (creator or admin; confirm naming the table)
//
// It is a MenuList body. Hosts use `useTableRowMenu()` + `TableRowMenuHost`,
// which mount it in a MorePortal at the right-click point or under the "...",
// and own the Share dialog so every door opens the same one.
//
// WHERE ITS ROWS GO: the section the menu is used in (src/lib/nav/
// object-href.ts). Open, Open in new tab and the "Copy made" toast build the
// address of the section the person is in when they click (the Space-scoped
// Work address when the host passes spaceSlug); Copy link copies the share
// form; the Trash exit asks the open object where it is mounted.

import { useEffect, useRef, useState, type RefObject } from "react";
import { useRouter } from "next/navigation";
import { Code2, Copy, Download, ExternalLink, FolderInput, Link2, Pencil, Share2, Star, Table2, Trash2 } from "lucide-react";
import { MenuItem, MenuList, MenuSeparator } from "@/components/ui/menu";
import { MorePortal } from "@/components/layout/os/more-portal";
import { Picker } from "@/components/ui/picker";
import { EntityTile } from "@/components/ui/entity-tile";
import { useOsToast } from "@/components/layout/os/toast";
import { useConfirm } from "@/components/ui/dialog-provider";
import { useBoot } from "@/components/layout/os/boot-context";
import { notifyTablesChanged } from "@/components/layout/os/sidebar-refresh";
import { apiFetch } from "@/lib/api-fetch";
import { downloadUrl } from "@/lib/download";
import { ObjectShareDialog, embedSnippet } from "./object-share-dialog";
import { currentOpenObject } from "@/components/layout/os/work-placement";
import { copyObjectLink, objectHrefNow } from "@/components/layout/os/use-object-href";

export interface TableMenuTarget {
  id: string;
  name: string;
  spaceId?: string | null;
  spaceName?: string | null;
  /** The table's Space slug when the host knows it (a Work tree row, the sheet in Work). */
  spaceSlug?: string | null;
  isFavorite?: boolean;
  isPublic?: boolean;
  /** Creator or Owner/Admin. Absent = resolved from GET /api/tables/[id] on open. */
  canManage?: boolean;
  publicLinksAllowed?: boolean;
  ownerName?: string | null;
}

export type TableMenuChange = "renamed" | "duplicated" | "moved" | "favorited" | "trashed" | "public";
export type TableMenuContext = "table" | "tree" | "sheet";

interface SpaceRow { id: string; name: string; icon?: string | null; color?: string | null }

/** Tell every list, sidebar and tree that a table changed. */
export function dispatchTablesChanged() {
  notifyTablesChanged();
}

export function TableRowMenu({
  table, context, onClose, onChanged, onShare, onRenameInline, initialMode = "menu",
}: {
  table: TableMenuTarget;
  context: TableMenuContext;
  /** "move" opens straight at the Space picker (the sheet's File > Move to Space...). */
  initialMode?: "menu" | "move";
  onClose: () => void;
  onChanged?: (kind: TableMenuChange, next?: Partial<TableMenuTarget>) => void;
  onShare?: (resolved: TableMenuTarget) => void;
  /** The sheet focuses its own title instead of the inline rename row. */
  onRenameInline?: () => void;
}) {
  const router = useRouter();
  const { toast } = useOsToast();
  const confirm = useConfirm();
  const { boot } = useBoot();
  const [mode, setMode] = useState<"menu" | "rename" | "move">(initialMode);
  const [name, setName] = useState(table.name);
  const [fav, setFav] = useState(!!table.isFavorite);
  const [busy, setBusy] = useState<string | null>(null);
  const [spaces, setSpaces] = useState<SpaceRow[] | null>(null);
  // Opened straight at the picker: load the Spaces once, in a tick.
  useEffect(() => {
    if (initialMode !== "move") return;
    let alive = true;
    const t = setTimeout(() => {
      void apiFetch<{ spaces?: SpaceRow[] }>("/api/spaces", { cache: "no-store" }).then((r) => {
        if (alive) setSpaces(r.ok ? (r.data.spaces ?? []).map((s) => ({ id: s.id, name: s.name, icon: s.icon ?? null, color: s.color ?? null })) : []);
      });
    }, 0);
    return () => { alive = false; clearTimeout(t); };
  }, [initialMode]);

  // A host that knows the manage right passes it; otherwise it is resolved on
  // open, and until it lands only the rows every reader holds are rendered.
  const [resolved, setResolved] = useState<Partial<TableMenuTarget> | null>(null);
  const known = table.canManage !== undefined && table.isFavorite !== undefined;
  useEffect(() => {
    if (known) return;
    let alive = true;
    void (async () => {
      const [t, f] = await Promise.all([
        apiFetch<{ canManage?: boolean; isPublic?: boolean; spaceId?: string | null; publicLinksAllowed?: boolean }>(`/api/tables/${table.id}`, { cache: "no-store" }),
        table.isFavorite === undefined ? apiFetch<{ tables?: { id: string }[] }>("/api/me/favorites/tables", { cache: "no-store" }) : Promise.resolve(null),
      ]);
      if (!alive) return;
      setResolved({
        canManage: t.ok ? !!t.data.canManage : false,
        isPublic: t.ok ? !!t.data.isPublic : table.isPublic,
        spaceId: t.ok ? t.data.spaceId ?? null : table.spaceId,
        publicLinksAllowed: t.ok ? t.data.publicLinksAllowed !== false : true,
      });
      if (f && f.ok) setFav((f.data.tables ?? []).some((x) => x.id === table.id));
    })();
    return () => { alive = false; };
  }, [known, table.id, table.isFavorite, table.isPublic, table.spaceId]);
  const canManage = table.canManage ?? resolved?.canManage ?? false;
  const pending = !known && resolved === null;
  const isAgent = boot.viewer.isAgent;
  // Rename and Duplicate are edits: a Guest (a read-only holder while the
  // access engine is inert) gets them only on a table they made, which is
  // canManage. Their menu is Open, Copy link and Add to favorites (spec
  // section 2 /tables, read-only), plus what every reader holds.
  const canEdit = boot.viewer.orgRole !== "GUEST" || canManage;
  const title = table.name || "Untitled table";
  const full: TableMenuTarget = { ...table, ...(resolved ?? {}), isFavorite: fav, canManage };

  function copyEmbed() {
    void navigator.clipboard?.writeText(embedSnippet("table", table.id, title)).then(() => toast("Embed code copied"), () => toast("Couldn't copy", { tone: "danger" }));
    onClose();
  }

  function copyLink() {
    void navigator.clipboard?.writeText(copyObjectLink("table", table.id)).then(() => toast("Link copied"), () => toast("Couldn't copy link", { tone: "danger" }));
    onClose();
  }

  async function rename() {
    const t = name.trim() || "Untitled table";
    if (t === table.name) { onClose(); return; }
    setBusy("rename");
    const r = await apiFetch(`/api/tables/${table.id}`, { method: "PATCH", json: { name: t } });
    setBusy(null);
    if (r.ok) { dispatchTablesChanged(); onChanged?.("renamed", { name: t }); } else toast(r.error || "Couldn't rename the table", { tone: "danger" });
    onClose();
  }

  async function duplicate() {
    setBusy("duplicate");
    const r = await apiFetch<{ id: string }>(`/api/tables/${table.id}/duplicate`, { method: "POST" });
    setBusy(null);
    onClose();
    if (!r.ok) { toast(r.error || "Couldn't copy the table", { tone: "danger" }); return; }
    dispatchTablesChanged();
    onChanged?.("duplicated");
    // Resolved when the action is clicked, in the section the person is in then.
    toast("Copy made", { action: { label: "Open", onClick: () => router.push(objectHrefNow("table", r.data.id, table.spaceSlug)) } });
  }

  async function toggleFav() {
    const next = !fav;
    setFav(next);
    const r = await apiFetch("/api/me/favorites/tables", { method: "POST", json: { tableId: table.id, on: next } });
    if (r.ok) {
      window.dispatchEvent(new CustomEvent("workwrk:favs-changed"));
      onChanged?.("favorited", { isFavorite: next });
      toast(next ? "Added to favorites" : "Removed from favorites");
    } else { setFav(!next); toast("Couldn't update favorites", { tone: "danger" }); }
    onClose();
  }

  async function openMove() {
    setMode("move");
    if (spaces === null) {
      const r = await apiFetch<{ spaces?: SpaceRow[] }>("/api/spaces", { cache: "no-store" });
      setSpaces(r.ok ? (r.data.spaces ?? []).map((s) => ({ id: s.id, name: s.name, icon: s.icon ?? null, color: s.color ?? null })) : []);
    }
  }

  async function moveTo(value: string) {
    const spaceId = value === "none" ? null : value;
    setBusy("move");
    const r = await apiFetch(`/api/tables/${table.id}`, { method: "PATCH", json: { spaceId } });
    setBusy(null);
    onClose();
    if (!r.ok) { toast(r.error || "Couldn't move the table", { tone: "danger" }); return; }
    const target = spaceId ? spaces?.find((s) => s.id === spaceId)?.name ?? "the Space" : "No Space";
    toast(`Moved to ${target}`);
    dispatchTablesChanged();
    onChanged?.("moved", { spaceId, spaceName: spaceId ? target : null });
  }

  async function trash() {
    onClose();
    const ok = await confirm({
      title: `Move "${title}" to Trash?`,
      description: `Its rows go with it. You can restore it from Trash for ${boot.org.trashDays} days.`,
      destructive: true,
      confirmLabel: "Move to Trash",
    });
    if (!ok) return;
    const r = await apiFetch(`/api/tables/${table.id}`, { method: "DELETE" });
    if (!r.ok) { toast(r.status === 403 && r.error ? r.error : "Couldn't move the table to Trash", { tone: "danger" }); return; }
    toast("Moved to Trash", { action: { label: "View Trash", onClick: () => router.push("/trash?type=table") } });
    dispatchTablesChanged();
    onChanged?.("trashed");
    // The open table leaves for the list of its own section: /tables in the
    // Tables hub, the nearest Work crumb in Work.
    const open = currentOpenObject();
    if (open?.kind === "table" && open.id === table.id) router.push(open.closeHref);
  }

  if (mode === "rename") {
    return (
      <MenuList className="p-2" style={{ minWidth: 260 }}>
        <form onSubmit={(e) => { e.preventDefault(); void rename(); }} className="flex flex-col gap-2">
          <input
            autoFocus
            value={name}
            onChange={(e) => setName(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Escape") { e.preventDefault(); e.stopPropagation(); onClose(); } }}
            onFocus={(e) => e.target.select()}
            placeholder="Untitled table"
            aria-label="Table name"
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
    const current = full.spaceId ?? null;
    return (
      <div className="relative">
        <Picker
          open
          onClose={onClose}
          ariaLabel={`Move ${title}`}
          searchPlaceholder="Find a Space"
          backdrop={false}
          width={280}
          selected={current ?? "none"}
          onSelect={(v) => void moveTo(v)}
          emptyLabel="No Spaces"
          loading={spaces === null}
          sections={[
            { options: [{ value: "none", label: "No Space", description: "Everyone in the workspace can open it" }] },
            { label: "Spaces", options: (spaces ?? []).map((s) => ({ value: s.id, label: s.name, glyph: <EntityTile size="xs" icon={s.icon} color={s.color} name={s.name} fallback="folder" /> })) },
          ]}
        />
      </div>
    );
  }

  return (
    <MenuList style={{ minWidth: 240 }} aria-label={`Actions for ${title}`}>
      {context !== "sheet" ? (
        <>
          <MenuItem icon={Table2} label="Open" onClick={() => { router.push(objectHrefNow("table", table.id, table.spaceSlug)); onClose(); }} />
          <MenuItem icon={ExternalLink} label="Open in new tab" onClick={() => { window.open(objectHrefNow("table", table.id, table.spaceSlug), "_blank", "noopener"); onClose(); }} />
          <MenuSeparator />
        </>
      ) : null}
      {canEdit ? (
        <>
          <MenuItem icon={Pencil} label="Rename" onClick={() => { if (onRenameInline) { onClose(); onRenameInline(); } else { setName(table.name); setMode("rename"); } }} />
          <MenuItem icon={Copy} label="Duplicate" busy={busy === "duplicate"} onClick={() => void duplicate()} />
        </>
      ) : null}
      {canManage ? <MenuItem icon={FolderInput} label="Move to Space…" busy={busy === "move"} onClick={() => void openMove()} /> : null}
      <MenuItem icon={Star} iconFilled={fav} label={fav ? "Remove from favorites" : "Add to favorites"} onClick={() => void toggleFav()} />
      <MenuSeparator />
      {onShare ? <MenuItem icon={Share2} label="Share…" onClick={() => { onClose(); onShare(full); }} /> : null}
      <MenuItem icon={Link2} label="Copy link" onClick={copyLink} />
      {full.isPublic && full.publicLinksAllowed !== false ? <MenuItem icon={Code2} label="Copy embed code" onClick={copyEmbed} /> : null}
      {!isAgent ? (
        <>
          <MenuSeparator />
          <MenuItem icon={Download} label="Export as CSV" onClick={() => { downloadUrl(`/api/tables/${table.id}/export`); onClose(); }} />
        </>
      ) : null}
      {pending ? (
        <div className="flex flex-col gap-2 px-3 py-2" aria-busy="true" aria-label="Checking what you can do">
          {["60%", "45%"].map((w, i) => <span key={i} className="h-3 rounded bg-skeleton os-skeleton-pulse" style={{ width: w }} />)}
        </div>
      ) : null}
      {canManage ? (
        <>
          <MenuSeparator />
          <MenuItem icon={Trash2} label="Move to Trash" destructive onClick={() => void trash()} />
        </>
      ) : null}
    </MenuList>
  );
}

/* ───────────────────────── the host: point or anchor ───────────────────────── */

export interface TableRowMenuState {
  table: TableMenuTarget;
  point: { x: number; y: number } | null;
  anchor: RefObject<HTMLElement | null> | null;
}

/**
 * `const menu = useTableRowMenu();` then `menu.open(e, table)` from a click on
 * a "..." (anchored to it, so Enter on a focused button opens beside the row)
 * or from a right-click (at the pointer), and render `<TableRowMenuHost>` once.
 */
export function useTableRowMenu() {
  const [state, setState] = useState<TableRowMenuState | null>(null);
  const open = (e: React.MouseEvent, table: TableMenuTarget) => {
    e.preventDefault();
    e.stopPropagation();
    const el = e.type === "contextmenu" ? null : (e.currentTarget as HTMLElement | null);
    setState(el ? { table, point: null, anchor: { current: el } } : { table, point: { x: e.clientX, y: e.clientY }, anchor: null });
  };
  const openFrom = (anchor: RefObject<HTMLElement | null>, table: TableMenuTarget) => setState({ table, point: null, anchor });
  const openAtPoint = (x: number, y: number, table: TableMenuTarget) => setState({ table, point: { x, y }, anchor: null });
  const close = () => setState(null);
  return { state, open, openFrom, openAtPoint, close };
}

export function TableRowMenuHost({ menu, context, onChanged, onRenameInline }: {
  menu: ReturnType<typeof useTableRowMenu>;
  context: TableMenuContext;
  onChanged?: (kind: TableMenuChange, table: TableMenuTarget, next?: Partial<TableMenuTarget>) => void;
  onRenameInline?: () => void;
}) {
  const dummy = useRef<HTMLElement | null>(null);
  const [share, setShare] = useState<TableMenuTarget | null>(null);
  const s = menu.state;
  return (
    <>
      {s ? (
        <MorePortal anchorRef={s.anchor ?? dummy} width={260} open placement="below" point={s.point} onClose={menu.close}>
          <TableRowMenu
            key={s.table.id}
            table={s.table}
            context={context}
            onClose={menu.close}
            onChanged={(kind, next) => onChanged?.(kind, s.table, next)}
            onShare={(t) => setShare(t)}
            onRenameInline={onRenameInline}
          />
        </MorePortal>
      ) : null}
      {share ? (
        <ObjectShareDialog
          open
          mode={share.canManage ? "share" : "who"}
          onClose={() => setShare(null)}
          object={{
            kind: "table",
            id: share.id,
            name: share.name,
            isPublic: !!share.isPublic,
            canManage: !!share.canManage,
            publicLinksAllowed: share.publicLinksAllowed !== false,
            anchorName: share.spaceName ?? null,
            ownerName: share.ownerName ?? null,
          }}
          onPublicChange={(isPublic) => { onChanged?.("public", share, { isPublic }); dispatchTablesChanged(); }}
        />
      ) : null}
    </>
  );
}
