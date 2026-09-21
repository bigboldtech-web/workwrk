"use client";

// FileRowMenu and FolderRowMenu (spec-docs-knowledge section 3): the ONE menu
// for a file, shared by the /files rows and tiles, the preview drawer and,
// through the same component, task attachments and doc file embeds.
//
//   file    Preview · Open in new tab · Download (a signed URL from
//           GET /api/files/[id]/url, every viewer with Can view) · Copy link ·
//           Add to / Remove from favorites · Rename (inline) · Move to…
//           (MoveFileDialog) · Summarize with AI (PDF, text, JSON; AI on) ·
//           separator · Move to Trash (restorable from /trash?type=file)
//   folder  Open · Rename (inline) · New folder inside · separator ·
//           Move to Trash (Full access: the folder, its subfolders and their
//           files go to Trash as ONE restorable snapshot, /trash?type=folder)
//
// Share is not offered on a file yet: a file has no grant rows of its own and
// the one share dialog has no drive-folder body until the access flip
// (spec-docs-knowledge section 4 step 6, change request A1). No dead control.

import { useRef, useState, type RefObject } from "react";
import { useRouter } from "next/navigation";
import { Download, Eye, ExternalLink, FolderInput, FolderPlus, Link2, Pencil, Sparkles, Star, Trash2, FolderOpen } from "lucide-react";
import { MenuItem, MenuList, MenuSeparator } from "@/components/ui/menu";
import { MorePortal } from "@/components/layout/os/more-portal";
import { useOsToast } from "@/components/layout/os/toast";
import { useOsShell } from "@/components/layout/os/shell-context";
import { useBoot } from "@/components/layout/os/boot-context";
import { useConfirm, usePrompt } from "@/components/ui/dialog-provider";
import { apiFetch } from "@/lib/api-fetch";
import { MoveFileDialog } from "./move-file-dialog";

export interface FileMenuTarget {
  id: string;
  name: string;
  mimeType: string;
  folderId: string | null;
  favorite?: boolean;
  summary?: string | null;
  /** Can edit (rename, move, trash). Absent = true, today's default. */
  canEdit?: boolean;
}

export interface FolderMenuTarget {
  id: string;
  name: string;
  parentId: string | null;
  /** Full access (creator or org admin): Move to Trash. Absent = true. */
  canManage?: boolean;
}

export type FileMenuChange = "renamed" | "trashed" | "moved" | "favorited" | "summarized" | "folder-renamed" | "folder-created" | "folder-trashed";

export function dispatchFilesChanged() {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new CustomEvent("workwrk:files-changed"));
}

export function isSummarizable(mime: string): boolean {
  return mime === "application/pdf" || mime.startsWith("text/") || mime.includes("json");
}

/** Open the signed URL in a new tab; never a stored URL from a list payload. */
export async function downloadFile(id: string, toast: (m: string, o?: { tone?: "danger" }) => void) {
  const r = await apiFetch<{ url: string }>(`/api/files/${id}/url`, { cache: "no-store" });
  if (!r.ok) { toast(r.error || "Couldn't get a download link", { tone: "danger" }); return; }
  window.open(r.data.url, "_blank", "noopener");
}

export function FileRowMenu({ file, onClose, onChanged, onPreview }: {
  file: FileMenuTarget;
  onClose: () => void;
  onChanged?: (kind: FileMenuChange) => void;
  /** Opens the preview drawer (the host owns `?file=`). */
  onPreview?: () => void;
}) {
  const router = useRouter();
  const { toast } = useOsToast();
  const { railApps } = useOsShell();
  const { boot } = useBoot();
  const confirm = useConfirm();
  const [mode, setMode] = useState<"menu" | "rename" | "move">("menu");
  const [draft, setDraft] = useState(file.name);
  const [fav, setFav] = useState(!!file.favorite);
  const [busy, setBusy] = useState<string | null>(null);
  const canEdit = file.canEdit !== false;
  const aiOn = railApps.some((a) => a.key === "ai");
  const done = (kind: FileMenuChange) => { onChanged?.(kind); dispatchFilesChanged(); };

  function copyLink() {
    void navigator.clipboard?.writeText(`${window.location.origin}/files?file=${file.id}`).then(() => toast("Link copied"), () => toast("Couldn't copy link"));
    onClose();
  }
  async function openNewTab() {
    onClose();
    await downloadFile(file.id, toast);
  }
  async function rename() {
    const v = draft.trim();
    if (!v || v === file.name) { onClose(); return; }
    setBusy("rename");
    const r = await apiFetch(`/api/files/${file.id}`, { method: "PATCH", json: { name: v } });
    setBusy(null);
    if (r.ok) { toast("Renamed"); done("renamed"); } else toast(r.error || "Couldn't rename", { tone: "danger" });
    onClose();
  }
  async function toggleFav() {
    const next = !fav;
    setFav(next);
    const r = await apiFetch("/api/me/favorites/files", { method: "POST", json: { fileId: file.id, on: next } });
    if (r.ok) { window.dispatchEvent(new CustomEvent("workwrk:favs-changed")); onChanged?.("favorited"); toast(next ? "Added to favorites" : "Removed from favorites"); }
    else { setFav(!next); toast("Couldn't update favorite", { tone: "danger" }); }
    onClose();
  }
  async function summarize() {
    setBusy("summarize");
    const r = await apiFetch(`/api/files/${file.id}/summarize`, { method: "POST" });
    setBusy(null);
    if (r.ok) { toast("Summary ready"); done("summarized"); } else toast(r.error || "Couldn't summarize", { tone: "danger" });
    onClose();
  }
  async function trash() {
    onClose();
    const ok = await confirm({ title: `Move "${file.name}" to Trash?`, description: `You can restore it for ${boot.org.trashDays} days.`, destructive: true, confirmLabel: "Move to Trash" });
    if (!ok) return;
    const r = await apiFetch(`/api/files/${file.id}`, { method: "DELETE" });
    if (r.ok) { toast("Moved to Trash", { action: { label: "View Trash", onClick: () => router.push("/trash?type=file") } }); done("trashed"); }
    else toast(r.error || "Couldn't move to Trash", { tone: "danger" });
  }

  if (mode === "move") {
    return <MoveFileDialog fileId={file.id} fileName={file.name} currentFolderId={file.folderId} onClose={onClose} onMoved={() => done("moved")} />;
  }
  if (mode === "rename") {
    return (
      <MenuList className="p-2" style={{ minWidth: 260 }}>
        <form onSubmit={(e) => { e.preventDefault(); void rename(); }} className="flex flex-col gap-2">
          <input autoFocus value={draft} onChange={(e) => setDraft(e.target.value)} onKeyDown={(e) => { if (e.key === "Escape") { e.preventDefault(); onClose(); } }} onFocus={(e) => { const dot = e.target.value.lastIndexOf("."); e.target.setSelectionRange(0, dot > 0 ? dot : e.target.value.length); }} placeholder="File name"
            className="h-9 w-full rounded-md border border-line-strong bg-raised px-3 text-base text-ink placeholder:text-ink-3 focus:outline-none focus-visible:border-brand" />
          <div className="flex justify-end gap-1">
            <button type="button" onClick={onClose} className="h-8 rounded-md px-2.5 text-sm font-medium text-ink-2 hover:bg-hover">Cancel</button>
            <button type="submit" disabled={busy === "rename" || !draft.trim()} className="h-8 rounded-md bg-brand px-3 text-sm font-medium text-white hover:bg-brand-hover disabled:opacity-50">Rename</button>
          </div>
        </form>
      </MenuList>
    );
  }
  return (
    <MenuList style={{ minWidth: 220 }}>
      {onPreview ? <MenuItem icon={Eye} label="Preview" onClick={() => { onClose(); onPreview(); }} /> : null}
      <MenuItem icon={ExternalLink} label="Open in new tab" onClick={() => void openNewTab()} />
      <MenuItem icon={Download} label="Download" onClick={() => void openNewTab()} />
      <MenuItem icon={Link2} label="Copy link" shortcut="⌘L" onClick={copyLink} />
      <MenuItem icon={Star} iconFilled={fav} label={fav ? "Remove from favorites" : "Add to favorites"} onClick={() => void toggleFav()} />
      {canEdit ? (
        <>
          <MenuItem icon={Pencil} label="Rename" onClick={() => { setDraft(file.name); setMode("rename"); }} />
          <MenuItem icon={FolderInput} label="Move to…" onClick={() => setMode("move")} />
          {aiOn && isSummarizable(file.mimeType) ? <MenuItem icon={Sparkles} label={file.summary ? "Re-summarize with AI" : "Summarize with AI"} busy={busy === "summarize"} onClick={() => void summarize()} /> : null}
          <MenuSeparator />
          <MenuItem icon={Trash2} label="Move to Trash" destructive onClick={() => void trash()} />
        </>
      ) : null}
    </MenuList>
  );
}

export function FolderRowMenu({ folder, onClose, onChanged }: {
  folder: FolderMenuTarget;
  onClose: () => void;
  onChanged?: (kind: FileMenuChange) => void;
}) {
  const router = useRouter();
  const { toast } = useOsToast();
  const { boot } = useBoot();
  const confirm = useConfirm();
  const prompt = usePrompt();
  const canManage = folder.canManage !== false;
  const [mode, setMode] = useState<"menu" | "rename">("menu");
  const [draft, setDraft] = useState(folder.name);
  const [busy, setBusy] = useState<string | null>(null);
  const done = (kind: FileMenuChange) => { onChanged?.(kind); dispatchFilesChanged(); };

  async function rename() {
    const v = draft.trim();
    if (!v || v === folder.name) { onClose(); return; }
    setBusy("rename");
    const r = await apiFetch(`/api/files/folders/${folder.id}`, { method: "PATCH", json: { name: v } });
    setBusy(null);
    if (r.ok) { toast("Renamed"); done("folder-renamed"); } else toast(r.error || "Couldn't rename", { tone: "danger" });
    onClose();
  }
  async function newInside() {
    onClose();
    const name = (await prompt({ title: "New folder", description: `Inside ${folder.name}`, placeholder: "Folder name" }))?.trim();
    if (!name) return;
    const r = await apiFetch("/api/files/folders", { method: "POST", json: { name, parentId: folder.id } });
    if (r.ok) { toast("Folder created"); done("folder-created"); } else toast(r.error || "Couldn't create folder", { tone: "danger" });
  }
  async function trash() {
    onClose();
    const ok = await confirm({ title: `Move "${folder.name}" to Trash?`, description: `Everything inside goes with it. You can restore it for ${boot.org.trashDays} days.`, destructive: true, confirmLabel: "Move to Trash" });
    if (!ok) return;
    const r = await apiFetch(`/api/files/folders/${folder.id}`, { method: "DELETE" });
    if (r.ok) { toast("Moved to Trash", { action: { label: "View Trash", onClick: () => router.push("/trash?type=folder") } }); done("folder-trashed"); }
    else toast(r.error || "Couldn't move to Trash", { tone: "danger" });
  }

  if (mode === "rename") {
    return (
      <MenuList className="p-2" style={{ minWidth: 260 }}>
        <form onSubmit={(e) => { e.preventDefault(); void rename(); }} className="flex flex-col gap-2">
          <input autoFocus value={draft} onChange={(e) => setDraft(e.target.value)} onKeyDown={(e) => { if (e.key === "Escape") { e.preventDefault(); onClose(); } }} onFocus={(e) => e.target.select()} placeholder="Folder name"
            className="h-9 w-full rounded-md border border-line-strong bg-raised px-3 text-base text-ink placeholder:text-ink-3 focus:outline-none focus-visible:border-brand" />
          <div className="flex justify-end gap-1">
            <button type="button" onClick={onClose} className="h-8 rounded-md px-2.5 text-sm font-medium text-ink-2 hover:bg-hover">Cancel</button>
            <button type="submit" disabled={busy === "rename" || !draft.trim()} className="h-8 rounded-md bg-brand px-3 text-sm font-medium text-white hover:bg-brand-hover disabled:opacity-50">Rename</button>
          </div>
        </form>
      </MenuList>
    );
  }
  return (
    <MenuList style={{ minWidth: 220 }}>
      <MenuItem icon={FolderOpen} label="Open" onClick={() => { onClose(); router.push(`/files?folder=${encodeURIComponent(folder.id)}`); }} />
      <MenuItem icon={Pencil} label="Rename" onClick={() => { setDraft(folder.name); setMode("rename"); }} />
      <MenuItem icon={FolderPlus} label="New folder inside" onClick={() => void newInside()} />
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

export type FileMenuState =
  | { kind: "file"; file: FileMenuTarget; point: { x: number; y: number } | null; anchor: RefObject<HTMLElement | null> | null }
  | { kind: "folder"; folder: FolderMenuTarget; point: { x: number; y: number } | null; anchor: RefObject<HTMLElement | null> | null };

export function useFileRowMenu() {
  const [state, setState] = useState<FileMenuState | null>(null);
  const openFileAt = (e: React.MouseEvent, file: FileMenuTarget) => { e.preventDefault(); e.stopPropagation(); setState({ kind: "file", file, point: { x: e.clientX, y: e.clientY }, anchor: null }); };
  const openFileFrom = (anchor: RefObject<HTMLElement | null>, file: FileMenuTarget) => setState({ kind: "file", file, point: null, anchor });
  const openFolderAt = (e: React.MouseEvent, folder: FolderMenuTarget) => { e.preventDefault(); e.stopPropagation(); setState({ kind: "folder", folder, point: { x: e.clientX, y: e.clientY }, anchor: null }); };
  const openFolderFrom = (anchor: RefObject<HTMLElement | null>, folder: FolderMenuTarget) => setState({ kind: "folder", folder, point: null, anchor });
  const close = () => setState(null);
  return { state, openFileAt, openFileFrom, openFolderAt, openFolderFrom, close };
}

export function FileRowMenuHost({ menu, onChanged, onPreview }: {
  menu: ReturnType<typeof useFileRowMenu>;
  onChanged?: (kind: FileMenuChange) => void;
  onPreview?: (file: FileMenuTarget) => void;
}) {
  const dummy = useRef<HTMLElement | null>(null);
  const s = menu.state;
  if (!s) return null;
  return (
    <MorePortal anchorRef={s.anchor ?? dummy} width={240} open placement="below" point={s.point} onClose={menu.close}>
      {s.kind === "file" ? (
        <FileRowMenu file={s.file} onClose={menu.close} onChanged={onChanged} onPreview={onPreview ? () => onPreview(s.file) : undefined} />
      ) : (
        <FolderRowMenu folder={s.folder} onClose={menu.close} onChanged={onChanged} />
      )}
    </MorePortal>
  );
}
