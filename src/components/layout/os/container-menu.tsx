"use client";

// ContainerMenu: the one "…" for a Space, a Folder and a List.
//
// Spec: docs/plans/ui-refresh/spec-spaces-lists.md section 1 (the three menus,
// item by item) and section 3 ("`ContainerMenu` replaces `space-more-menu.tsx`,
// `folder-more-menu.tsx`, `board-more-menu.tsx`").
//
// WHY ONE COMPONENT. The three menus were the same menu written three times,
// and each copy drifted somewhere the other two did not:
//   * the List's Copy link wrote `/boards/<id>` on a route that resolves a SLUG
//     and 404s on an id, so every List link a person pasted was broken
//     (audit High #1);
//   * the Folder's Copy link wrote `<current page>#folder-<id>`, an anchor that
//     targets nothing on any page (audit Medium #15);
//   * "Sharing & Permissions" opened a dialog on a Space page, toasted "Open
//     the Space to manage sharing" from a sidebar row, and did not exist at all
//     on a Folder row (audit Medium #14);
//   * Duplicate deep-copied a List, POSTed a bare `{ name, icon }` for a Space
//     (so you got an empty room with a familiar name, audit Medium #22), and
//     was absent on a Folder (audit Medium #18);
//   * "List info" was a toast, and a Folder's description had no reader at all.
// The rows now come from one table (`src/lib/work/container-menu.ts`) and the
// handlers from one file, so the next divergence has to be written on purpose.
//
// NOTHING IS DISABLED, rows are absent (the access model's read-only rule).
// The default `role` is "view": it was "full", and three of the five hosts
// passed no role at all, so a Can view member was handed Rename, Move,
// Duplicate, Archive and a red Delete on containers whose API answers 403.
// Every host in this repo now passes the role it has already worked out.
//
// WHAT MOVED RATHER THAN DISAPPEARED, because the founder checks:
//   * Space "Make Private" / "Make workspace-visible"  -> the Share dialog's
//     visibility tri-state, which this menu can now open from EVERY host.
//   * Folder "Make private"                            -> the Restricted switch
//     in the same dialog (it had no un-do at all before).
//   * List "List info" (a toast)                       -> About.
//   * Space "Modules"                                  -> the "Features" row,
//     which keeps the modal reachable until the Space page grows its Settings
//     tab to hold it.
//   * Space "Space settings"                           -> deleted. It pushed
//     `/spaces/[slug]`, which from that page's own title row is the page you
//     are already on: the menu closed and nothing happened. The destination is
//     the Space itself, which is one click away from every host this menu has.

import {
  forwardRef, useCallback, useEffect, useImperativeHandle, useMemo, useRef, useState,
} from "react";
import { useRouter } from "next/navigation";
import {
  MoreHorizontal, Star, Pin, Plus, Edit2, Link as LinkIcon, Palette, Share2,
  Settings, CircleDot, Tag, Shapes, Info, Files, Save, Zap, BellOff, Bell,
  EyeOff, ArrowRightLeft, ArrowUp, ArrowDown, Copy, Archive, Trash2,
  ListChecks, FolderPlus, FileText, Brush, IterationCw, Blocks, Table2,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { MorePortal, type ContextMenuHandle } from "./more-portal";
import { MenuItem, MenuList, MenuSeparator, MenuSubmenu } from "@/components/ui/menu";
import { SkeletonLines } from "@/components/ui/skeleton";
import { useConfirm } from "@/components/ui/dialog-provider";
import { Dots } from "@/components/ui/dots";
import { SpaceIconPicker } from "./space-icon-picker";
import { SpaceModulesModal } from "./space-modules-modal";
import { MoveTargetDialog } from "./move-target-dialog";
import { ContainerAboutModal, type AboutObject } from "./container-about-modal";
import { DuplicateContainerDialog } from "./duplicate-container-dialog";
import { ShareDialog } from "@/components/access/share-dialog";
import { useOsToast } from "./toast";
import { useOsShell } from "./shell-context";
import { refreshSidebar } from "./sidebar-refresh";
import { treeChanged, accessChanged } from "@/lib/work/container-events";
import { hydrateSidebarState, setSpaceHidden } from "@/lib/work/sidebar-expand";
import {
  containerMenuRows, containerPath, containerNoun,
  type ContainerAction, type ContainerKind, type ContainerRole,
} from "@/lib/work/container-menu";

export interface ContainerObject {
  kind: ContainerKind;
  id: string;
  name: string;
  slug?: string | null;
  icon?: string | null;
  color?: string | null;
  visibility?: "PRIVATE" | "WORKSPACE" | "ORG";
  description?: string | null;
  createdAt?: string | null;
  owner?: { id: string; name: string } | null;
  /** The Space this object lives in (itself, for a Space). */
  spaceId?: string | null;
  spaceSlug?: string | null;
  spaceName?: string | null;
  folderId?: string | null;
  folderName?: string | null;
  /** Free text for the About modal ("3 lists · 2 folders"). */
  contents?: string | null;
  /** `Board.settings.defaultItemTypeId`, so the submenu can tick the current one. */
  defaultItemTypeId?: string | null;
}

export interface ContainerMenuProps {
  container: ContainerObject;
  role?: ContainerRole;
  canDelete?: boolean;
  isAgent?: boolean;
  editorsCanShare?: boolean;
  onUpdated?: () => void;
  /** Keyboard alternatives to a drag (critic #10). Absent at the ends. */
  onMoveUp?: () => void;
  onMoveDown?: () => void;
  /** 3.5 on a page title row, 3 on a dense sidebar row. */
  compact?: boolean;
  className?: string;
}

const API_BASE: Record<ContainerKind, string> = {
  space: "/api/spaces",
  folder: "/api/folders",
  list: "/api/boards",
};

const FAVORITES_PATH: Record<ContainerKind, string> = {
  space: "/api/me/favorites/spaces",
  folder: "/api/me/favorites/folders",
  list: "/api/me/favorites/boards",
};

const FAVORITES_PREF_KEY: Record<ContainerKind, string> = {
  space: "favoriteSpaceIds",
  folder: "favoriteFolderIds",
  list: "favoriteBoardIds",
};

const FAVORITES_BODY_KEY: Record<ContainerKind, string> = {
  space: "spaceId",
  folder: "folderId",
  list: "boardId",
};

/** The kind word /api/me/pins stores for each container. */
const TOP_PIN_KIND: Record<ContainerKind, string> = { space: "space", folder: "folder", list: "board" };

const ROW_ICON: Record<ContainerAction, LucideIcon> = {
  favorite: Star,
  "pin-top": Pin,
  new: Plus,
  rename: Edit2,
  "copy-link": LinkIcon,
  color: Palette,
  share: Share2,
  features: Blocks,
  statuses: CircleDot,
  fields: Tag,
  "default-type": Shapes,
  about: Info,
  templates: Files,
  automations: Zap,
  mute: BellOff,
  hide: EyeOff,
  move: ArrowRightLeft,
  duplicate: Copy,
  archive: Archive,
  delete: Trash2,
};

export const ContainerMenuTrigger = forwardRef<ContextMenuHandle, ContainerMenuProps>(
  function ContainerMenuTrigger(props, ref) {
    const { container, onUpdated, compact, className } = props;
    const [open, setOpen] = useState(false);
    const [point, setPoint] = useState<{ x: number; y: number } | null>(null);
    const [moveOpen, setMoveOpen] = useState(false);
    const [shareOpen, setShareOpen] = useState(false);
    const [aboutOpen, setAboutOpen] = useState(false);
    const [modulesOpen, setModulesOpen] = useState(false);
    const [duplicateOpen, setDuplicateOpen] = useState(false);
    const [duplicating, setDuplicating] = useState(false);
    const btnRef = useRef<HTMLButtonElement>(null);
    const panelRef = useRef<HTMLDivElement>(null);
    const router = useRouter();
    const { toast } = useOsToast();

    // Duplicate lives on the trigger, not in the menu body: the menu closes the
    // moment the dialog opens, and a request that outlives its own component is
    // a request whose result nobody renders.
    const runDuplicate = useCallback(async (includeTasks: boolean) => {
      setDuplicating(true);
      try {
        const res = await fetch(`${API_BASE[container.kind]}/${container.id}/duplicate`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ includeTasks }),
        });
        const d = await res.json().catch(() => ({}));
        if (!res.ok) {
          toast(d?.error ?? `Couldn't duplicate the ${containerNoun(container.kind).toLowerCase()}`);
          return;
        }
        // The routes answer with what actually arrived. Reporting only
        // "Duplicated" hid a copy that skipped a private folder or lost a List
        // to a failed re-anchor.
        const parts: string[] = [];
        if (typeof d?.copiedFolders === "number") parts.push(`${d.copiedFolders} folder${d.copiedFolders === 1 ? "" : "s"}`);
        if (typeof d?.copiedLists === "number") parts.push(`${d.copiedLists} list${d.copiedLists === 1 ? "" : "s"}`);
        const missed = (Number(d?.skipped) || 0) + (Number(d?.failed) || 0);
        toast(
          `Duplicated "${container.name}"${parts.length ? ` · ${parts.join(" · ")}` : ""}` +
          (missed > 0 ? ` · ${missed} not copied` : ""),
        );
        onUpdated?.();
        refreshSidebar();
        treeChanged({ kind: container.kind, action: "created" });
        setDuplicateOpen(false);
        if (container.kind === "space" && d?.space?.slug) router.push(`/spaces/${d.space.slug}`);
        else if (container.kind === "list" && d?.board?.slug) router.push(`/boards/${d.board.slug}`);
        else if (container.kind === "folder" && d?.folder?.id) router.push(`/folders/${d.folder.id}`);
        else router.refresh();
      } catch {
        toast("Couldn't duplicate");
      } finally {
        setDuplicating(false);
      }
    }, [container.id, container.kind, container.name, onUpdated, router, toast]);

    useImperativeHandle(ref, () => ({
      openAtPoint: (x, y) => { setPoint({ x, y }); setOpen(true); },
    }), []);

    useEffect(() => {
      if (!open) return;
      const onClick = (e: MouseEvent) => {
        const t = e.target as Node;
        if (panelRef.current?.contains(t) || btnRef.current?.contains(t)) return;
        setOpen(false);
      };
      const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") setOpen(false); };
      window.addEventListener("mousedown", onClick);
      window.addEventListener("keydown", onKey);
      return () => {
        window.removeEventListener("mousedown", onClick);
        window.removeEventListener("keydown", onKey);
      };
    }, [open]);

    const aboutObject: AboutObject = useMemo(() => {
      const location: Array<{ label: string; href: string }> = [];
      if (container.kind !== "space" && container.spaceName && container.spaceSlug) {
        location.push({ label: container.spaceName, href: `/spaces/${container.spaceSlug}` });
      }
      if (container.kind === "list" && container.folderName && container.folderId) {
        location.push({ label: container.folderName, href: `/folders/${container.folderId}` });
      }
      return {
        kind: container.kind,
        id: container.id,
        name: container.name,
        slug: container.slug ?? null,
        icon: container.icon ?? null,
        color: container.color ?? null,
        description: container.description ?? null,
        createdAt: container.createdAt ?? null,
        owner: container.owner ?? null,
        location,
        contents: container.contents ?? null,
      };
    }, [container]);

    return (
      <span className="relative inline-flex">
        <button
          ref={btnRef}
          type="button"
          onClick={(e) => { e.preventDefault(); e.stopPropagation(); setPoint(null); setOpen((v) => !v); }}
          className={
            className ??
            `rounded transition-colors ${compact ? "p-0.5" : "p-1"} ${
              open ? "text-ink bg-active" : "text-ink-2 hover:bg-hover"
            }`
          }
          aria-label={`${containerNoun(container.kind)} actions`}
          aria-haspopup="menu"
          aria-expanded={open}
          title="More"
        >
          <MoreHorizontal className={compact ? "w-3 h-3" : "w-3.5 h-3.5"} />
        </button>

        <MorePortal
          anchorRef={btnRef}
          panelRef={panelRef}
          width={container.kind === "space" ? 260 : 244}
          open={open}
          placement={compact ? "right" : "below"}
          point={point}
        >
          <ContainerMenuBody
            {...props}
            onClose={() => setOpen(false)}
            onRequestMove={() => setMoveOpen(true)}
            onRequestShare={() => setShareOpen(true)}
            onRequestAbout={() => setAboutOpen(true)}
            onRequestModules={() => setModulesOpen(true)}
            onRequestDuplicate={() => setDuplicateOpen(true)}
          />
        </MorePortal>

        {moveOpen ? (
          // A Folder is moved with the FOLDER flavour. It used to take the
          // Space branch, which POSTs `/api/spaces/<id>/move` with a folder id
          // and 404s every time, while `/api/folders/[id]/move` sat unused.
          <MoveTargetDialog
            kind={container.kind === "list" ? "board" : container.kind}
            entityId={container.id}
            entityName={container.name}
            onClose={() => setMoveOpen(false)}
            onMoved={() => { onUpdated?.(); refreshSidebar(); treeChanged({ kind: container.kind, id: container.id, action: "moved" }); router.refresh(); }}
          />
        ) : null}

        <ShareDialog
          open={shareOpen}
          onOpenChange={setShareOpen}
          // The same decision the row's own label is made from
          // (containerMenuRows: Full access, or Can edit under toggle 4).
          readOnly={!((props.role ?? "view") === "full"
            || (props.editorsCanShare === true && (props.role ?? "view") === "edit"))}
          target={{
            kind: container.kind,
            id: container.id,
            name: container.name,
            visibility: container.visibility,
            parentSpaceName: container.spaceName ?? null,
          }}
          onChanged={() => { onUpdated?.(); accessChanged({ kind: container.kind, id: container.id }); }}
        />

        <ContainerAboutModal
          open={aboutOpen}
          onOpenChange={setAboutOpen}
          object={aboutObject}
          canEdit={(props.role ?? "view") === "full"}
          onSaved={() => { onUpdated?.(); router.refresh(); }}
        />

        {modulesOpen && container.kind === "space" ? (
          <SpaceModulesModal spaceId={container.id} onClose={() => setModulesOpen(false)} />
        ) : null}

        {duplicateOpen ? (
        <DuplicateContainerDialog
          open
          onOpenChange={setDuplicateOpen}
          name={container.name}
          noun={containerNoun(container.kind)}
          busy={duplicating}
          onConfirm={runDuplicate}
        />
        ) : null}
      </span>
    );
  },
);

type Mode = "menu" | "rename" | "icon";

function ContainerMenuBody({
  container,
  role = "view",
  canDelete = true,
  isAgent = false,
  editorsCanShare = false,
  onUpdated,
  onMoveUp,
  onMoveDown,
  onClose,
  onRequestMove,
  onRequestShare,
  onRequestAbout,
  onRequestModules,
  onRequestDuplicate,
}: ContainerMenuProps & {
  onClose: () => void;
  onRequestMove: () => void;
  onRequestShare: () => void;
  onRequestAbout: () => void;
  onRequestModules: () => void;
  onRequestDuplicate: () => void;
}) {
  const router = useRouter();
  const { toast } = useOsToast();
  const confirm = useConfirm();
  const { openTemplateCenter, openCreateList, openCreateSprint } = useOsShell();
  const [mode, setMode] = useState<Mode>("menu");
  const [draft, setDraft] = useState(container.name);
  const [busy, setBusy] = useState<string | null>(null);
  const [iconName, setIconName] = useState(container.icon ?? null);
  const [color, setColor] = useState(container.color ?? "var(--os-ink-3)");
  const [starred, setStarred] = useState<boolean | null>(null);
  const [topPinned, setTopPinned] = useState(false);
  const [muted, setMuted] = useState(false);
  // Spec row 10 is a submenu that WRITES Board.settings.defaultItemTypeId. The
  // row navigated to /settings/task-types instead, which is the org-wide list,
  // not this List's default, so the row did not do what it said.
  const [types, setTypes] = useState<Array<{ id: string; singular: string }> | null>(null);
  const [defaultTypeId, setDefaultTypeId] = useState<string | null>(container.defaultItemTypeId ?? null);

  const noun = containerNoun(container.kind);
  const base = `${API_BASE[container.kind]}/${container.id}`;
  const spaceId = container.kind === "space" ? container.id : container.spaceId ?? null;

  useEffect(() => {
    let alive = true;
    fetch("/api/preferences", { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        if (!alive) return;
        const ids: string[] = d?.effective?.home?.[FAVORITES_PREF_KEY[container.kind]] ?? [];
        setStarred(ids.includes(container.id));
        const pins: Array<{ kind: string; id: string }> = Array.isArray(d?.effective?.home?.topPins) ? d.effective.home.topPins : [];
        setTopPinned(pins.some((p) => p.kind === TOP_PIN_KIND[container.kind] && p.id === container.id));
        const mutedList: string[] = d?.effective?.home?.notifications?.muted ?? [];
        setMuted(mutedList.includes(`${container.kind}:${container.id}`));
      })
      .catch(() => { if (alive) setStarred(false); });
    return () => { alive = false; };
  }, [container.id, container.kind]);

  useEffect(() => {
    if (container.kind !== "list" || role !== "full") return;
    let alive = true;
    fetch("/api/item-types", { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        if (!alive) return;
        const rows = (d?.data?.types ?? d?.types ?? []) as Array<{ id: string; singular: string }>;
        setTypes(Array.isArray(rows) ? rows : []);
      })
      .catch(() => { if (alive) setTypes([]); });
    return () => { alive = false; };
  }, [container.kind, role]);

  const setDefaultType = useCallback(async (typeId: string) => {
    setBusy(`type:${typeId}`);
    const prev = defaultTypeId;
    setDefaultTypeId(typeId);
    try {
      const res = await fetch(base, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ defaultItemTypeId: typeId }),
      });
      if (!res.ok) {
        const d = await res.json().catch(() => ({}));
        setDefaultTypeId(prev);
        toast(d?.error ?? "Couldn't change the default type");
        return;
      }
      toast("Default task type saved");
      onUpdated?.();
      router.refresh();
    } catch {
      setDefaultTypeId(prev);
      toast("Couldn't change the default type");
    } finally {
      setBusy(null);
    }
  }, [base, defaultTypeId, onUpdated, router, toast]);

  const patch = useCallback(async (body: Record<string, unknown>, kind: string): Promise<boolean> => {
    setBusy(kind);
    try {
      const res = await fetch(base, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        toast(data?.error ?? "Update failed");
        return false;
      }
      onUpdated?.();
      treeChanged({ kind: container.kind, id: container.id, action: "renamed" });
      refreshSidebar();
      router.refresh();
      return true;
    } catch {
      toast("Update failed");
      return false;
    } finally {
      setBusy(null);
    }
  }, [base, container.id, container.kind, onUpdated, router, toast]);

  // The row renders as "Add to favorites" while the preferences fetch that
  // decides its label is still in flight, so an early click used to hit
  // `starred === null` and silently do nothing. It resolves the current state
  // first instead: the click always lands, it just waits for the answer.
  const toggleFavorite = useCallback(async () => {
    let current = starred;
    if (current === null) {
      try {
        const d = await fetch("/api/preferences", { cache: "no-store" }).then((r) => (r.ok ? r.json() : null));
        const ids: string[] = d?.effective?.home?.[FAVORITES_PREF_KEY[container.kind]] ?? [];
        current = ids.includes(container.id);
      } catch {
        current = false;
      }
      setStarred(current);
    }
    const starredNow = current;
    const next = !starredNow;
    setStarred(next);
    try {
      await fetch(FAVORITES_PATH[container.kind], {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ [FAVORITES_BODY_KEY[container.kind]]: container.id, on: next }),
      });
      if (typeof window !== "undefined") window.dispatchEvent(new CustomEvent("workwrk:favs-changed"));
    } catch {
      setStarred(starredNow);
    }
  }, [container.id, container.kind, starred]);

  /** Favorite > Top: the chip strip under the bar. Optimistic, reverted on failure. */
  const toggleTopPin = useCallback(async () => {
    const next = !topPinned;
    setTopPinned(next);
    try {
      const res = await fetch("/api/me/pins", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ kind: TOP_PIN_KIND[container.kind], id: container.id, on: next }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      window.dispatchEvent(new CustomEvent("workwrk:pins-changed"));
    } catch {
      setTopPinned(!next);
      toast("Couldn't update the top strip");
    }
  }, [container.id, container.kind, topPinned, toast]);

  // audit High #1 (List) and Medium #15 (Folder): both wrote a link that did
  // not resolve. The path now comes from one pure function with a test.
  const copyLink = useCallback(async () => {
    const path = containerPath({ kind: container.kind, id: container.id, slug: container.slug ?? null });
    if (!path) { toast(`This ${noun.toLowerCase()} has no link yet`); return; }
    try {
      await navigator.clipboard.writeText(`${window.location.origin}${path}`);
      toast("Link copied");
    } catch {
      toast("Couldn't copy");
    }
  }, [container.id, container.kind, container.slug, noun, toast]);

  const toggleMute = useCallback(async () => {
    const key = `${container.kind}:${container.id}`;
    const next = !muted;
    setMuted(next);
    try {
      const prefs = await fetch("/api/preferences", { cache: "no-store" }).then((r) => (r.ok ? r.json() : null));
      const current: string[] = prefs?.effective?.home?.notifications?.muted ?? [];
      const list = next ? Array.from(new Set([...current, key])) : current.filter((k) => k !== key);
      const res = await fetch("/api/preferences", {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ home: { notifications: { muted: list } } }),
      });
      if (!res.ok) throw new Error();
      toast(next ? `Muted ${container.name}` : `Unmuted ${container.name}`);
    } catch {
      setMuted(!next);
      toast("Couldn't change notifications");
    }
  }, [container.id, container.kind, container.name, muted, toast]);

  // Hiding never changes access: the Space stays on /spaces, in search, in the
  // breadcrumb and behind the SPACES section menu's "Show hidden Spaces (N)".
  // The store writes the preference and tells the tree, so the row leaves the
  // sidebar at once rather than on the next reload.
  const hideFromSidebar = useCallback(async () => {
    await hydrateSidebarState();
    setSpaceHidden(container.id, true);
    toast(`${container.name} hidden from your sidebar`);
    refreshSidebar();
    onClose();
  }, [container.id, container.name, onClose, toast]);

  const saveAsTemplate = useCallback(async () => {
    setBusy("save-template");
    const source = container.kind === "space" ? "SPACE" : container.kind === "folder" ? "FOLDER" : "LIST";
    const idKey = container.kind === "space" ? "spaceId" : container.kind === "folder" ? "folderId" : "boardId";
    try {
      const res = await fetch("/api/template-center/save-as", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ source, [idKey]: container.id }),
      });
      if (!res.ok) {
        const d = await res.json().catch(() => ({}));
        toast(d?.error ?? "Couldn't save template");
        return;
      }
      toast(`Saved "${container.name}" as a template`);
      onClose();
    } catch {
      toast("Couldn't save template");
    } finally {
      setBusy(null);
    }
  }, [container.id, container.kind, container.name, onClose, toast]);

  // WHAT THIS CONFIRM SAYS, AND WHY IT CHANGED TWICE. It first said "You can
  // restore it from Trash" when nothing in the app un-archived a container, so
  // it was rewritten to "there is no un-archive screen yet". Phase 2 then BUILT
  // that screen: /trash's Archived tab lists archived Spaces, Folders and Lists
  // and restores them in place through POST /api/trash/bulk. Leaving the older
  // sentence in place talked people out of a shipped feature, which is the
  // same defect the other way round.
  const archive = useCallback(async () => {
    if (!(await confirm({
      title: `Archive ${noun.toLowerCase()}`,
      description: `Archive "${container.name}"? It leaves your sidebar, search and every list. Nothing is deleted: you can restore it from Trash, on the Archived tab.`,
      destructive: true, confirmLabel: "Archive",
    }))) return;
    setBusy("archive");
    try {
      const res = await fetch(base, { method: "DELETE" });
      if (!res.ok) {
        const d = await res.json().catch(() => ({}));
        toast(d?.error ?? "Archive failed");
        return;
      }
      toast(`${container.name} archived`);
      onUpdated?.();
      refreshSidebar();
      treeChanged({ kind: container.kind, id: container.id, action: "archived" });
      router.refresh();
      onClose();
    } finally {
      setBusy(null);
    }
  }, [base, confirm, container.id, container.kind, container.name, noun, onClose, onUpdated, router, toast]);

  const del = useCallback(async () => {
    if (!(await confirm({
      title: `Move ${container.name} to Trash?`,
      // The retention window is org config this component does not read, and
      // /trash is manager-gated, so neither a day count nor a plain "you can
      // restore it" is honest here.
      description: "Everything inside goes with it. It lands in Trash, which a manager can restore it from.",
      destructive: true, confirmLabel: "Delete",
    }))) return;
    setBusy("delete");
    try {
      const res = await fetch(`${base}?hard=1`, { method: "DELETE" });
      if (!res.ok) {
        const d = await res.json().catch(() => ({}));
        toast(d?.error ?? "Delete failed");
        return;
      }
      toast(`${container.name} deleted`);
      onUpdated?.();
      refreshSidebar();
      treeChanged({ kind: container.kind, id: container.id, action: "deleted" });
      onClose();
      if (container.kind === "space") router.push("/spaces");
      else router.refresh();
    } finally {
      setBusy(null);
    }
  }, [base, confirm, container.id, container.kind, container.name, onClose, onUpdated, router, toast]);

  // ── New submenu targets ───────────────────────────────────────────
  const createDoc = useCallback(async () => {
    setBusy("doc");
    try {
      const res = await fetch("/api/docs", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          title: "Untitled doc",
          entityType: container.kind === "folder" ? "FOLDER" : "SPACE",
          entityId: container.kind === "folder" ? container.id : spaceId,
          content: { type: "doc", content: [{ type: "paragraph" }] },
        }),
      });
      const d = await res.json().catch(() => null);
      if (!res.ok) { toast(d?.error ?? "Couldn't create doc"); return; }
      refreshSidebar();
      treeChanged({ kind: "doc", action: "created" });
      onClose();
      const id = d?.doc?.id ?? d?.id;
      if (id) router.push(`/docs/${id}`);
    } catch { toast("Couldn't create doc"); } finally { setBusy(null); }
  }, [container.id, container.kind, onClose, router, spaceId, toast]);

  const createFolder = useCallback(async () => {
    if (!spaceId) { toast("Couldn't create folder"); return; }
    setBusy("folder");
    try {
      const res = await fetch("/api/folders", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          spaceId,
          name: "New Folder",
          ...(container.kind === "folder" ? { parentFolderId: container.id } : {}),
        }),
      });
      const d = await res.json().catch(() => ({}));
      if (!res.ok) { toast(d?.error ?? "Couldn't create folder"); return; }
      toast("Folder created");
      onUpdated?.();
      refreshSidebar();
      treeChanged({ kind: "folder", action: "created" });
      router.refresh();
      onClose();
    } catch { toast("Couldn't create folder"); } finally { setBusy(null); }
  }, [container.id, container.kind, onClose, onUpdated, router, spaceId, toast]);

  // "Table" is the naming canon's word for what the popover called "Database".
  // It is in this submenu because the sidebar's three-icon hover cluster
  // collapses to one "…", and the "+" it replaced could make one.
  const createTable = useCallback(async () => {
    if (!spaceId) { toast("Couldn't create table"); return; }
    setBusy("table");
    try {
      const res = await fetch("/api/tables", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ name: "Untitled table", spaceId }),
      });
      const d = await res.json().catch(() => null);
      const id = d?.id ?? d?.data?.id;
      if (!res.ok || !id) { toast(d?.error ?? "Couldn't create table"); return; }
      refreshSidebar();
      treeChanged({ kind: "table", action: "created" });
      onClose();
      // The server seeded the canonical sheet (no columns were sent);
      // ?new=1 selects the name so it can be typed.
      router.push(`/tables/${id}?new=1`);
    } catch { toast("Couldn't create table"); } finally { setBusy(null); }
  }, [onClose, router, spaceId, toast]);

  const createCanvas = useCallback(async () => {
    setBusy("canvas");
    try {
      const res = await fetch("/api/whiteboards", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          name: "Untitled canvas",
          ...(spaceId ? { spaceId } : {}),
          // A Canvas made from a Folder belongs on that Folder's page.
          ...(container.kind === "folder" ? { folderId: container.id } : {}),
        }),
      });
      const d = await res.json().catch(() => null);
      if (!res.ok) { toast(d?.error ?? "Couldn't create canvas"); return; }
      refreshSidebar();
      treeChanged({ kind: "canvas", action: "created" });
      onClose();
      const id = d?.whiteboard?.id ?? d?.id;
      if (id) router.push(`/canvas/${id}`);
    } catch { toast("Couldn't create canvas"); } finally { setBusy(null); }
  }, [container.id, container.kind, onClose, router, spaceId, toast]);

  const openBoardPanel = useCallback((panel: "fields" | "statuses") => {
    onClose();
    if (container.slug) router.push(`/boards/${container.slug}?panel=${panel}`);
    else toast("Open the List to edit this");
  }, [container.slug, onClose, router, toast]);

  const automationsHref = useMemo(() => {
    const key = container.kind === "space" ? "spaceId" : container.kind === "folder" ? "folderId" : "listId";
    return `/automation/workflows?${key}=${container.id}`;
  }, [container.id, container.kind]);

  // ── Rename and icon sub-panels ────────────────────────────────────
  if (mode === "rename") {
    return (
      <div className="bg-raised rounded-xl border border-line p-3" style={{ boxShadow: "var(--os-shadow-pop)" }}>
        <div className="text-xs uppercase tracking-wide text-ink-3 font-semibold mb-2">Rename {noun.toLowerCase()}</div>
        <input
          type="text"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              const v = draft.trim();
              if (v && v !== container.name) patch({ name: v }, "rename").then((ok) => { if (ok) onClose(); });
              else onClose();
            }
            if (e.key === "Escape") onClose();
          }}
          className="w-full h-9 px-2.5 rounded-md border border-line bg-raised text-base text-ink focus:outline-none focus:border-line-strong"
          autoFocus
        />
        <div className="flex justify-end gap-1.5 mt-2.5">
          <button type="button" onClick={() => setMode("menu")} disabled={Boolean(busy)}
            className="h-7 px-2.5 rounded-md text-sm text-ink-2 hover:bg-hover">Cancel</button>
          <button
            type="button"
            onClick={async () => {
              const v = draft.trim();
              if (!v || v === container.name) { onClose(); return; }
              if (await patch({ name: v }, "rename")) onClose();
            }}
            disabled={Boolean(busy) || !draft.trim()}
            className="h-7 px-2.5 rounded-md text-sm font-medium text-ink-inv bg-brand hover:bg-brand-hover disabled:opacity-50 inline-flex items-center gap-1.5"
          >
            {busy === "rename" ? <Dots variant="pending" /> : null}
            Save
          </button>
        </div>
      </div>
    );
  }

  if (mode === "icon") {
    return (
      <div className="bg-raised rounded-xl border border-line p-3" style={{ boxShadow: "var(--os-shadow-pop)" }}>
        <div className="text-xs uppercase tracking-wide text-ink-3 font-semibold mb-2">Color &amp; icon</div>
        <div className="flex items-center gap-3">
          <SpaceIconPicker
            iconName={iconName}
            color={color}
            fallbackInitial={container.name[0]?.toUpperCase() ?? "W"}
            onChange={({ iconName: next, color: nextColor }) => { setIconName(next); setColor(nextColor); }}
          />
          <div className="text-sm text-ink-2">The same catalog every container uses.</div>
        </div>
        <div className="flex justify-end gap-1.5 mt-3">
          <button type="button" onClick={() => setMode("menu")} disabled={Boolean(busy)}
            className="h-7 px-2.5 rounded-md text-sm text-ink-2 hover:bg-hover">Cancel</button>
          <button
            type="button"
            onClick={async () => { if (await patch({ icon: iconName ?? null, color }, "icon")) onClose(); }}
            disabled={Boolean(busy)}
            className="h-7 px-2.5 rounded-md text-sm font-medium text-ink-inv bg-brand hover:bg-brand-hover disabled:opacity-50 inline-flex items-center gap-1.5"
          >
            {busy === "icon" ? <Dots variant="pending" /> : null}
            Save
          </button>
        </div>
      </div>
    );
  }

  const rows = containerMenuRows({
    kind: container.kind,
    role,
    isFavorite: Boolean(starred),
    isTopPinned: topPinned,
    canDelete,
    isAgent,
    editorsCanShare,
  });

  return (
    <MenuList>
      {rows.map((row, i) => {
        if (row.kind === "separator") return <MenuSeparator key={`sep-${i}`} />;
        const Icon = row.action === "mute" && muted ? Bell : ROW_ICON[row.action];

        switch (row.action) {
          case "favorite":
            return <MenuItem key={row.action} icon={Icon} label={row.label} iconFilled={Boolean(starred)} onClick={toggleFavorite} />;

          case "pin-top":
            return <MenuItem key={row.action} icon={Icon} label={row.label} iconFilled={topPinned} onClick={toggleTopPin} />;

          case "new":
            return (
              <MenuSubmenu key={row.action} icon={Icon} label="New">
                <MenuItem icon={ListChecks} label="List" onClick={() => {
                  onClose();
                  openCreateList({ ...(spaceId ? { spaceId } : {}), ...(container.kind === "folder" ? { folderId: container.id } : {}) });
                }} />
                <MenuItem icon={IterationCw} label="Sprint" onClick={() => {
                  onClose();
                  openCreateSprint({ ...(spaceId ? { spaceId } : {}), ...(container.kind === "folder" ? { folderId: container.id } : {}) });
                }} />
                <MenuItem icon={FolderPlus} label="Folder" busy={busy === "folder"} onClick={createFolder} />
                <MenuItem icon={FileText} label="Doc" busy={busy === "doc"} onClick={createDoc} />
                <MenuItem icon={Brush} label="Canvas" busy={busy === "canvas"} onClick={createCanvas} />
                {container.kind === "space" ? (
                  <MenuItem icon={Table2} label="Table" busy={busy === "table"} onClick={createTable} />
                ) : null}
              </MenuSubmenu>
            );

          case "rename":
            return <MenuItem key={row.action} icon={Icon} label={row.label} onClick={() => setMode("rename")} />;

          case "copy-link":
            return <MenuItem key={row.action} icon={Icon} label={row.label} onClick={copyLink} />;

          case "color":
            return <MenuItem key={row.action} icon={Icon} label={row.label} submenu onClick={() => setMode("icon")} />;

          case "share":
            return <MenuItem key={row.action} icon={Icon} label={row.label} onClick={() => { onClose(); onRequestShare(); }} />;

          case "features":
            // The Space Settings tab (spec row 9) is not built. Its one unique
            // destination, the modules modal, keeps a row of its own; "Settings"
            // does not, because it pushed the Space page, which from that
            // page's own title row is where you already are.
            return <MenuItem key={row.action} icon={Icon} label={row.label} onClick={() => { onClose(); onRequestModules(); }} />;

          case "statuses":
            return <MenuItem key={row.action} icon={Icon} label={row.label} onClick={() => openBoardPanel("statuses")} />;

          case "fields":
            return <MenuItem key={row.action} icon={Icon} label={row.label} onClick={() => openBoardPanel("fields")} />;

          case "default-type":
            return (
              <MenuSubmenu key={row.action} icon={Icon} label={row.label} width={220}>
                {types === null ? (
                  <SkeletonLines lines={3} className="px-3 py-1.5" />
                ) : types.length === 0 ? (
                  // An empty line, not a greyed row. consistency-report H.2:
                  // all 17 specs agreed that a control a person cannot use is
                  // not rendered, and no unit ships a greyed control. "No task
                  // types" is a sentence, not a control, so it renders as one
                  // and the "Manage types" door below it is the way out.
                  <p className="px-3 py-1.5 text-sm text-ink-2">No task types yet</p>
                ) : (
                  types.map((t) => (
                    <MenuItem
                      key={t.id}
                      label={t.singular}
                      selected={defaultTypeId === t.id}
                      busy={busy === `type:${t.id}`}
                      onClick={() => setDefaultType(t.id)}
                    />
                  ))
                )}
                <MenuSeparator />
                <MenuItem icon={Settings} label="Manage types" onClick={() => { onClose(); router.push("/settings/task-types"); }} />
              </MenuSubmenu>
            );

          case "about":
            return <MenuItem key={row.action} icon={Icon} label={row.label} onClick={() => { onClose(); onRequestAbout(); }} />;

          case "templates":
            return (
              <MenuSubmenu key={row.action} icon={Icon} label="Templates">
                {/* Spec row 10: a Folder browses "kind Folder and List,
                    applied inside this Folder". `applyContext` carried only a
                    spaceId, so a List template opened from a shelf landed at
                    the Space root. The Folder does NOT pin `kind` to FOLDER:
                    the apply route cannot build a Folder from a template yet,
                    so pinning it would leave a browser of things that cannot be
                    applied; leaving it open lists Folder AND List templates,
                    which is what the row promises. */}
                <MenuItem icon={Files} label="Browse templates" onClick={() => {
                  onClose();
                  const folderId =
                    container.kind === "folder" ? container.id
                      : container.kind === "list" ? container.folderId ?? null
                        : null;
                  openTemplateCenter({
                    ...(container.kind === "list" ? { kind: "LIST" as const } : {}),
                    ...(spaceId
                      ? { applyContext: { spaceId, ...(folderId ? { folderId } : {}) } }
                      : {}),
                  });
                }} />
                <MenuItem icon={Save} label="Save as template" busy={busy === "save-template"} onClick={saveAsTemplate} />
              </MenuSubmenu>
            );

          case "automations":
            return <MenuItem key={row.action} icon={Icon} label={row.label} onClick={() => { onClose(); router.push(automationsHref); }} />;

          case "mute":
            return <MenuItem key={row.action} icon={Icon} label={muted ? "Unmute notifications" : "Mute notifications"} onClick={toggleMute} />;

          case "hide":
            return <MenuItem key={row.action} icon={Icon} label={row.label} onClick={hideFromSidebar} />;

          case "move":
            return (
              <span key={row.action} className="contents">
                <MenuItem icon={Icon} label={row.label} onClick={() => { onClose(); onRequestMove(); }} />
                {/* Each arrow renders only when it can actually move: the
                    first row has no "Move up" and the last has no "Move
                    down". A greyed row is a control a person cannot use, and
                    consistency-report H.2 has all 17 specs agreeing those are
                    not rendered at all. */}
                {onMoveUp ? (
                  <MenuItem icon={ArrowUp} label="Move up" onClick={() => { onClose(); onMoveUp(); }} />
                ) : null}
                {onMoveDown ? (
                  <MenuItem icon={ArrowDown} label="Move down" onClick={() => { onClose(); onMoveDown(); }} />
                ) : null}
              </span>
            );

          case "duplicate":
            return <MenuItem key={row.action} icon={Icon} label={row.label} onClick={() => { onClose(); onRequestDuplicate(); }} />;

          case "archive":
            return <MenuItem key={row.action} icon={Icon} label={row.label} busy={busy === "archive"} onClick={archive} />;

          case "delete":
            return <MenuItem key={row.action} icon={Icon} label={row.label} destructive busy={busy === "delete"} onClick={del} />;

          default:
            return null;
        }
      })}
    </MenuList>
  );
}
