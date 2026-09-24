"use client";

// CreateInsideTrigger: the hover "+" on a Space or Folder row in the Work
// sidebar. One hover, one click, one menu: List, Sprint, Folder, Doc, Canvas,
// Table (Space only) and Browse templates, created INSIDE this container.
// The same targets sit under the row's "..." > New submenu (two clicks deep);
// this restores the one-hover door the old SpaceCreatePopover gave, on the
// MenuList primitives and the tokens. Present only for roles that may write
// (roleAtLeast "edit"), so the control is absent rather than a 403.
//
// Every target goes through the same routes the container menu uses, and
// tells the tree (refreshSidebar + treeChanged) so the new row appears at
// once.

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Brush, Files, FileText, FolderPlus, IterationCw, ListChecks, Plus, Table2 } from "lucide-react";
import { MenuItem, MenuList, MenuSeparator } from "@/components/ui/menu";
import { roleAtLeast, type ContainerRole } from "@/lib/work/container-menu";
import { treeChanged } from "@/lib/work/container-events";
import { MorePortal } from "./more-portal";
import { refreshSidebar } from "./sidebar-refresh";
import { useOsShell } from "./shell-context";
import { useOsToast } from "./toast";

interface Props {
  kind: "space" | "folder";
  /** The Space id (for a Folder, its owning Space). */
  spaceId: string;
  /** The Folder id when kind is "folder". */
  folderId?: string;
  /** Absent = the reader's role (no door), as the container menu treats it. */
  role?: ContainerRole;
  /** After a create that lands in this row's subtree. */
  onCreated?: () => void;
}

export function CreateInsideTrigger({ kind, spaceId, folderId, role, onCreated }: Props) {
  const router = useRouter();
  const { toast } = useOsToast();
  const { openCreateList, openCreateSprint, openTemplateCenter } = useOsShell();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const btnRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      const t = e.target as Node;
      if (panelRef.current?.contains(t) || btnRef.current?.contains(t)) return;
      setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") setOpen(false); };
    window.addEventListener("mousedown", onDown);
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("mousedown", onDown);
      window.removeEventListener("keydown", onKey);
    };
  }, [open]);

  const place = { spaceId, ...(kind === "folder" && folderId ? { folderId } : {}) };
  const close = () => setOpen(false);

  const post = useCallback(async (url: string, body: Record<string, unknown>, what: string) => {
    setBusy(what);
    try {
      const res = await fetch(url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
      const d = await res.json().catch(() => null);
      if (!res.ok) { toast(d?.error ?? `Couldn't create ${what}`); return null; }
      return d;
    } catch {
      toast(`Couldn't create ${what}`);
      return null;
    } finally {
      setBusy(null);
    }
  }, [toast]);

  const createFolder = async () => {
    const d = await post("/api/folders", { spaceId, name: "New Folder", ...(folderId ? { parentFolderId: folderId } : {}) }, "folder");
    if (!d) return;
    toast("Folder created");
    refreshSidebar();
    treeChanged({ kind: "folder", action: "created" });
    onCreated?.();
    router.refresh();
    close();
  };

  const createDoc = async () => {
    const d = await post("/api/docs", {
      title: "Untitled doc",
      entityType: kind === "folder" ? "FOLDER" : "SPACE",
      entityId: kind === "folder" ? folderId : spaceId,
      content: { type: "doc", content: [{ type: "paragraph" }] },
    }, "doc");
    if (!d) return;
    refreshSidebar();
    treeChanged({ kind: "doc", action: "created" });
    onCreated?.();
    close();
    const id = d?.doc?.id ?? d?.id;
    if (id) router.push(`/docs/${id}`);
  };

  const createCanvas = async () => {
    const d = await post("/api/whiteboards", { name: "Untitled canvas", spaceId, ...(folderId ? { folderId } : {}) }, "canvas");
    if (!d) return;
    refreshSidebar();
    treeChanged({ kind: "canvas", action: "created" });
    onCreated?.();
    close();
    const id = d?.whiteboard?.id ?? d?.id;
    if (id) router.push(`/canvas/${id}`);
  };

  const createTable = async () => {
    // The one create recipe: no columns sent, so the server applies the
    // canonical seed (26 columns, 1,000 rows); the table opens with ?new=1.
    const d = await post("/api/tables", { name: "Untitled table", spaceId }, "table");
    const id = d?.id ?? d?.data?.id;
    if (!d || !id) return;
    refreshSidebar();
    treeChanged({ kind: "table", action: "created" });
    close();
    router.push(`/tables/${id}?new=1`);
  };

  if (!role || !roleAtLeast(role, "edit")) return null;

  return (
    <>
      <button
        ref={btnRef}
        type="button"
        onClick={(e) => { e.preventDefault(); e.stopPropagation(); setOpen((v) => !v); }}
        aria-label={kind === "space" ? "Create inside this Space" : "Create inside this Folder"}
        title={kind === "space" ? "Create inside this Space" : "Create inside this Folder"}
        aria-haspopup="menu"
        aria-expanded={open}
        className={`inline-flex h-6 w-6 items-center justify-center rounded text-ink-3 hover:bg-active hover:text-ink ${open ? "bg-active text-ink" : ""}`}
      >
        <Plus className="h-3.5 w-3.5" strokeWidth={1.5} aria-hidden />
      </button>
      <MorePortal anchorRef={btnRef} panelRef={panelRef} width={220} open={open} placement="below">
        <MenuList aria-label={kind === "space" ? "Create inside this Space" : "Create inside this Folder"}>
          <MenuItem icon={ListChecks} label="List" onClick={() => { close(); openCreateList(place); }} />
          <MenuItem icon={IterationCw} label="Sprint" onClick={() => { close(); openCreateSprint(place); }} />
          <MenuItem icon={FolderPlus} label="Folder" busy={busy === "folder"} onClick={() => { void createFolder(); }} />
          <MenuItem icon={FileText} label="Doc" busy={busy === "doc"} onClick={() => { void createDoc(); }} />
          <MenuItem icon={Brush} label="Canvas" busy={busy === "canvas"} onClick={() => { void createCanvas(); }} />
          {kind === "space" ? <MenuItem icon={Table2} label="Table" busy={busy === "table"} onClick={() => { void createTable(); }} /> : null}
          <MenuSeparator />
          <MenuItem
            icon={Files}
            label="Browse templates"
            onClick={() => {
              close();
              openTemplateCenter({ applyContext: { spaceId, ...(folderId ? { folderId } : {}) } });
            }}
          />
        </MenuList>
      </MorePortal>
    </>
  );
}
