"use client";

// FilePreviewDrawer (spec-docs-knowledge section 2, /files): the 520 drawer
// at `/files?file=[id]` on the one Drawer container (design-system 4.5).
//
//   header   folder › name 13px, Copy link, close (no Expand: a file has no page)
//   preview  image at fit; PDF in a sandboxed iframe; video and audio with
//            native controls; text and JSON monospaced; otherwise the type
//            glyph and "No preview for this type"
//   rows     Type · Size · Uploaded by · Uploaded · Location · Favorites
//   then     AI summary (the summary, or a Summarize ghost when AI is on),
//            "Used in" (entity links: tasks, docs, canvases that embed it)
//   footer   Download (secondary) · Move to… · Move to Trash (destructive ghost)
//
// Close (the header ✕, Esc through the LayerStack, the browser Back) removes
// `?file=` and keeps the folder. The drawer carries the page's URL so Copy
// link always works.

import { createElement, useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { Archive, Code2, Download, File as FileIcon, FileText, Film, FolderInput, Image as ImageIcon, Link2, Music, Sparkles, Trash2, X } from "lucide-react";
import { Drawer, DRAWER_DEFAULT_W } from "@/components/ui/drawer";
import { Switch } from "@/components/ui/switch";
import { SkeletonLines } from "@/components/ui/skeleton";
import { OsEmptyView } from "@/components/layout/os/empty-view";
import { PersonAvatar, type PersonRef } from "@/components/board-view/assignee-picker";
import { useOsToast } from "@/components/layout/os/toast";
import { useOsShell } from "@/components/layout/os/shell-context";
import { useBoot } from "@/components/layout/os/boot-context";
import { useConfirm } from "@/components/ui/dialog-provider";
import { apiFetch } from "@/lib/api-fetch";
import { useFormat } from "@/lib/format/use-date-prefs";
import { fileTypeBucket, fileTypeLabel } from "@/lib/files-list";
import { MoveFileDialog } from "./move-file-dialog";
import { dispatchFilesChanged, downloadFile, isSummarizable } from "./file-row-menu";
// The drawer opens over Work and Docs pages alike, so the builders below
// stay canonical and every link is mapped into the section it is followed
// in (src/lib/nav/object-href.ts).
import { sectionHrefNow, useObjectHref } from "@/components/layout/os/use-object-href";

export interface PreviewFile {
  id: string;
  name: string;
  mimeType: string;
  size: number;
  url: string;
  folderId: string | null;
  spaceId?: string | null;
  spaceFolderId?: string | null;
  favorite?: boolean;
  starred?: boolean;
  summary?: string | null;
  summarizedAt?: string | null;
  createdAt: string;
  updatedAt: string;
  uploadedBy?: (PersonRef & { name: string | null }) | null;
  folder?: { id: string; name: string } | null;
  spaceFolder?: { id: string; name: string } | null;
  space?: { id: string; name: string; slug: string } | null;
}

type Link = { id: string; sourceType: string; sourceId: string };

function glyphFor(mime: string) {
  switch (fileTypeBucket(mime)) {
    case "images": return ImageIcon;
    case "video": return Film;
    case "audio": return Music;
    case "archives": return Archive;
    case "documents": return mime.includes("json") ? Code2 : FileText;
    case "pdfs": return FileText;
    default: return FileIcon;
  }
}

function sourceHref(l: Link): { label: string; href: string | null } {
  switch (l.sourceType) {
    case "BOARD_ITEM": return { label: "Task", href: `/item/${l.sourceId}` };
    case "DOC":
    case "NOTE": return { label: "Doc", href: `/docs/${l.sourceId}` };
    case "WHITEBOARD": return { label: "Canvas", href: `/canvas/${l.sourceId}` };
    case "SOP": return { label: "SOP", href: `/sops/${l.sourceId}` };
    default: return { label: l.sourceType, href: null };
  }
}

export function FilePreviewDrawer({ fileId, initial, onClose, onChanged }: {
  fileId: string;
  /** The row the list already holds, so the header paints before the fetch lands. */
  initial?: PreviewFile | null;
  onClose: () => void;
  onChanged?: () => void;
}) {
  const router = useRouter();
  const { map: sectionLink } = useObjectHref();
  const { toast } = useOsToast();
  const { railApps } = useOsShell();
  const { boot } = useBoot();
  const confirm = useConfirm();
  const fmt = useFormat();
  const aiOn = railApps.some((a) => a.key === "ai");

  const [file, setFile] = useState<PreviewFile | null>(initial ?? null);
  const [missing, setMissing] = useState(false);
  const [links, setLinks] = useState<Link[] | null>(null);
  const [text, setText] = useState<string | null>(null);
  const [moveOpen, setMoveOpen] = useState(false);
  const [summarizing, setSummarizing] = useState(false);
  const [width, setWidth] = useState(DRAWER_DEFAULT_W);

  const load = useCallback(async () => {
    const r = await apiFetch<{ data?: PreviewFile } | PreviewFile>(`/api/files/${fileId}`, { cache: "no-store" });
    if (!r.ok) { if (r.status === 404) setMissing(true); return; }
    const row = ("data" in r.data && r.data.data ? r.data.data : r.data) as PreviewFile;
    setFile((prev) => ({ ...(prev ?? {}), ...row, favorite: prev?.favorite ?? row.favorite, uploadedBy: row.uploadedBy ?? prev?.uploadedBy ?? null, folder: row.folder ?? prev?.folder ?? null }));
  }, [fileId]);
  useEffect(() => { const t = setTimeout(() => void load(), 0); return () => clearTimeout(t); }, [load]);
  useEffect(() => {
    let live = true;
    void (async () => {
      const r = await apiFetch<{ links: Link[] }>(`/api/entity-links?targetType=FILE&targetId=${encodeURIComponent(fileId)}`, { cache: "no-store" });
      if (live) setLinks(r.ok ? r.data.links ?? [] : []);
    })();
    return () => { live = false; };
  }, [fileId]);

  const bucket = file ? fileTypeBucket(file.mimeType) : "other";
  const isText = !!file && (file.mimeType.startsWith("text/") || file.mimeType.includes("json")) && file.size < 512 * 1024;
  const textUrl = isText && file ? file.url : null;
  useEffect(() => {
    if (!textUrl) return;
    let live = true;
    fetch(textUrl).then((r) => (r.ok ? r.text() : Promise.reject(new Error()))).then((t) => { if (live) setText(t); }).catch(() => { if (live) setText(""); });
    return () => { live = false; };
  }, [textUrl]);

  async function toggleStar(next: boolean) {
    if (!file) return;
    setFile({ ...file, favorite: next });
    const r = await apiFetch("/api/me/favorites/files", { method: "POST", json: { fileId: file.id, on: next } });
    if (!r.ok) { setFile({ ...file, favorite: !next }); toast("Couldn't update favorite", { tone: "danger" }); return; }
    window.dispatchEvent(new CustomEvent("workwrk:favs-changed"));
    onChanged?.();
  }
  async function summarize() {
    if (!file) return;
    setSummarizing(true);
    const r = await apiFetch<{ data?: { summary?: string }; summary?: string }>(`/api/files/${file.id}/summarize`, { method: "POST" });
    setSummarizing(false);
    if (!r.ok) { toast(r.error || "Couldn't summarize", { tone: "danger" }); return; }
    const summary = r.data.data?.summary ?? r.data.summary ?? null;
    setFile({ ...file, summary, summarizedAt: new Date().toISOString() });
    dispatchFilesChanged();
    onChanged?.();
  }
  async function trash() {
    if (!file) return;
    const ok = await confirm({ title: `Move "${file.name}" to Trash?`, description: `You can restore it for ${boot.org.trashDays} days.`, destructive: true, confirmLabel: "Move to Trash" });
    if (!ok) return;
    const r = await apiFetch(`/api/files/${file.id}`, { method: "DELETE" });
    if (!r.ok) { toast(r.error || "Couldn't move to Trash", { tone: "danger" }); return; }
    toast("Moved to Trash", { action: { label: "View Trash", onClick: () => router.push("/trash?type=file") } });
    dispatchFilesChanged();
    onChanged?.();
    onClose();
  }
  function copyLink() {
    void navigator.clipboard?.writeText(`${window.location.origin}/files?file=${fileId}`).then(() => toast("Link copied"), () => toast("Couldn't copy link"));
  }

  const location = useMemo(() => {
    if (!file) return null;
    if (file.spaceFolder) return { label: `${file.space?.name ?? "Space"} › ${file.spaceFolder.name}`, href: `/folders/${file.spaceFolder.id}` };
    if (file.space) return { label: file.space.name, href: `/spaces/${file.space.slug}` };
    if (file.folder) return { label: `Files › ${file.folder.name}`, href: `/files?folder=${file.folder.id}` };
    return { label: "Files", href: "/files" };
  }, [file]);

  const ghost = "inline-flex h-8 items-center gap-1.5 rounded-md px-2.5 text-sm font-medium text-ink-2 hover:bg-hover hover:text-ink";

  return (
    <>
      <Drawer
        open
        onClose={onClose}
        ariaLabel="File preview"
        layerId="file-preview"
        width={width}
        onWidthChange={setWidth}
        header={
          <>
            <span className="min-w-0 flex-1 truncate text-sm text-ink-2">
              {file?.folder ? <><span>{file.folder.name}</span><span className="mx-1">›</span></> : null}
              <span className="font-medium text-ink">{file?.name ?? "File"}</span>
            </span>
            <button type="button" onClick={copyLink} aria-label="Copy link" title="Copy link" className="inline-flex h-8 w-8 items-center justify-center rounded-md text-ink-2 hover:bg-hover hover:text-ink"><Link2 className="h-4 w-4" strokeWidth={1.5} aria-hidden /></button>
            <button type="button" onClick={onClose} aria-label="Close" title="Close" className="inline-flex h-8 w-8 items-center justify-center rounded-md text-ink-2 hover:bg-hover hover:text-ink"><X className="h-4 w-4" strokeWidth={1.5} aria-hidden /></button>
          </>
        }
        footer={file ? (
          <div className="flex h-11 items-center gap-1 px-3">
            <button type="button" onClick={() => void downloadFile(file.id, toast)} className="inline-flex h-8 items-center gap-1.5 rounded-md border border-line-strong bg-raised px-3 text-sm font-medium text-ink hover:bg-hover"><Download className="h-4 w-4" strokeWidth={1.5} aria-hidden />Download</button>
            <button type="button" onClick={() => setMoveOpen(true)} className={ghost}><FolderInput className="h-4 w-4" strokeWidth={1.5} aria-hidden />Move to…</button>
            <span className="flex-1" />
            <button type="button" onClick={() => void trash()} className="inline-flex h-8 items-center gap-1.5 rounded-md px-2.5 text-sm font-medium text-danger-text hover:bg-danger-bg"><Trash2 className="h-4 w-4" strokeWidth={1.5} aria-hidden />Move to Trash</button>
          </div>
        ) : undefined}
      >
        {missing ? (
          <OsEmptyView variant="error" compact title="This file is not available" action={{ label: "Close", onClick: onClose }} />
        ) : !file ? (
          <div className="p-4"><SkeletonLines lines={4} /></div>
        ) : (
          <div className="flex flex-col">
            {/* Preview */}
            <div className="flex min-h-[220px] items-center justify-center border-b border-line bg-app p-4">
              {bucket === "images" ? (
                <img src={file.url} alt={file.name} className="max-h-[360px] max-w-full rounded-md object-contain" />
              ) : bucket === "pdfs" ? (
                <iframe src={file.url} title={file.name} sandbox="" className="h-[420px] w-full rounded-md border border-line bg-raised" />
              ) : bucket === "video" ? (
                <video src={file.url} controls className="max-h-[360px] w-full rounded-md" />
              ) : bucket === "audio" ? (
                <audio src={file.url} controls className="w-full" />
              ) : isText ? (
                text === null ? <SkeletonLines lines={4} className="w-full" /> : <pre className="max-h-[360px] w-full overflow-auto rounded-md border border-line bg-raised p-3 font-mono text-sm text-ink whitespace-pre-wrap">{text || "(empty)"}</pre>
              ) : (
                <div className="flex flex-col items-center gap-2 text-ink-2">
                  <FileGlyph mime={file.mimeType} className="h-10 w-10" />
                  <span className="text-base">No preview for this type</span>
                </div>
              )}
            </div>

            {/* Rows */}
            <dl className="os-chrome px-4 py-2">
              <Row label="Type">{fileTypeLabel(file.mimeType)}</Row>
              <Row label="Size">{fmt.bytes(file.size)}</Row>
              <Row label="Uploaded by">{file.uploadedBy ? <span className="inline-flex items-center gap-2"><PersonAvatar person={file.uploadedBy} size={20} />{file.uploadedBy.name ?? `${file.uploadedBy.firstName ?? ""} ${file.uploadedBy.lastName ?? ""}`.trim()}</span> : <span className="text-ink-3">Unknown</span>}</Row>
              <Row label="Uploaded"><span title={fmt.title(file.createdAt)}>{fmt.date(file.createdAt)}</span></Row>
              {/* The mapped form on BOTH the href and the handler, so the shell's
                  link interceptor sees nothing to map and never races it. */}
              <Row label="Location">{location ? <a href={sectionLink(location.href)} className="text-brand-deep hover:underline" onClick={(e) => { e.preventDefault(); router.push(sectionHrefNow(location.href)); }}>{location.label}</a> : null}</Row>
              <Row label="Favorites"><Switch checked={!!file.favorite} onChange={(v) => void toggleStar(v)} aria-label="Add to favorites" /></Row>
            </dl>

            {/* AI summary */}
            {aiOn && isSummarizable(file.mimeType) ? (
              <div className="mx-4 my-2 rounded-lg border border-line p-3">
                <div className="mb-1 flex items-center gap-2">
                  <span className="text-base font-semibold text-ink">AI summary</span>
                  <span className="flex-1" />
                  <button type="button" onClick={() => void summarize()} disabled={summarizing} className={ghost} aria-busy={summarizing}>
                    <Sparkles className="h-4 w-4" strokeWidth={1.5} aria-hidden />{file.summary ? "Re-summarize" : "Summarize"}
                  </button>
                </div>
                {file.summary ? <p className="text-base leading-6 text-ink">{file.summary}</p> : <p className="text-sm text-ink-2">No summary yet.</p>}
              </div>
            ) : null}

            {/* Used in */}
            <div className="px-4 py-2">
              <div className="mb-1 text-xs font-semibold uppercase tracking-wide text-ink-2">Used in</div>
              {links === null ? <SkeletonLines lines={2} /> : links.length === 0 ? (
                <p className="text-sm text-ink-2">Not embedded anywhere yet.</p>
              ) : (
                <ul className="flex flex-col">
                  {links.map((l) => {
                    const s = sourceHref(l);
                    return (
                      <li key={l.id} className="flex h-9 items-center gap-2 text-base text-ink">
                        <span className="text-ink-2">{s.label}</span>
                        {s.href ? <button type="button" onClick={() => router.push(sectionHrefNow(s.href!))} className="font-medium text-brand-deep hover:underline">Open</button> : null}
                      </li>
                    );
                  })}
                </ul>
              )}
            </div>
          </div>
        )}
      </Drawer>
      {moveOpen && file ? <MoveFileDialog fileId={file.id} fileName={file.name} currentFolderId={file.folderId} onClose={() => setMoveOpen(false)} onMoved={() => { void load(); onChanged?.(); }} /> : null}
    </>
  );
}

function FileGlyph({ mime, className }: { mime: string; className?: string }) {
  return createElement(glyphFor(mime), { className, strokeWidth: 1.5, "aria-hidden": true });
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex min-h-9 items-center gap-3 border-b border-line-soft last:border-b-0">
      <dt className="w-[120px] shrink-0 text-sm font-medium text-ink-2">{label}</dt>
      <dd className="min-w-0 flex-1 truncate text-base text-ink">{children}</dd>
    </div>
  );
}
