"use client";

// FolderFilesCard — files that live inside a Space folder. Upload here lands
// the file in this folder AND in Library → Files (space + folder anchored, so
// the drive's Space filter and visibility gating apply automatically).

import { useCallback, useEffect, useRef, useState } from "react";
import { FileText, Image as ImageIcon, FileArchive, Film, Music, Upload, Loader2, Trash2, ExternalLink, MoveRight } from "lucide-react";
import { useConfirm } from "@/components/ui/dialog-provider";
import { MoveFileDialog } from "@/components/files/move-file-dialog";
import { useOsToast } from "@/components/layout/os/toast";

interface FileRow {
  id: string;
  name: string;
  mimeType: string;
  size: number;
  url: string;
  updatedAt: string;
}

function iconFor(mime: string) {
  if (mime.startsWith("image/")) return ImageIcon;
  if (mime.startsWith("video/")) return Film;
  if (mime.startsWith("audio/")) return Music;
  if (mime.includes("zip") || mime.includes("compressed")) return FileArchive;
  return FileText;
}

function fmtSize(bytes: number): string {
  if (bytes >= 1_048_576) return `${(bytes / 1_048_576).toFixed(1)} MB`;
  if (bytes >= 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${bytes} B`;
}

export function FolderFilesCard({ folderId, canEdit }: { folderId: string; canEdit: boolean }) {
  const { toast } = useOsToast();
  const confirm = useConfirm();
  const [files, setFiles] = useState<FileRow[] | null>(null);
  const [uploading, setUploading] = useState(false);
  const [movingFile, setMovingFile] = useState<FileRow | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const load = useCallback(async () => {
    try {
      const res = await fetch(`/api/files?spaceFolderId=${encodeURIComponent(folderId)}`, { cache: "no-store" });
      if (!res.ok) return;
      const d = await res.json();
      setFiles(Array.isArray(d) ? d : d.data ?? []);
    } catch { /* card stays in loading state; nothing destructive */ }
  }, [folderId]);
  useEffect(() => { void load(); }, [load]);
  useEffect(() => {
    const onChanged = () => void load();
    window.addEventListener("workwrk:files-changed", onChanged);
    return () => window.removeEventListener("workwrk:files-changed", onChanged);
  }, [load]);

  async function uploadFiles(list: FileList | null) {
    if (!list || list.length === 0) return;
    setUploading(true);
    try {
      for (const f of Array.from(list)) {
        const fd = new FormData();
        fd.append("file", f);
        const up = await fetch("/api/upload", { method: "POST", body: fd });
        if (!up.ok) { toast(`Couldn't upload ${f.name}`); continue; }
        const u = await up.json();
        const url = u.url ?? u.data?.url;
        if (!url) { toast(`Couldn't upload ${f.name}`); continue; }
        const res = await fetch("/api/files", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ name: f.name, mimeType: f.type || "application/octet-stream", size: f.size, url, spaceFolderId: folderId }),
        });
        if (!res.ok) toast(`Couldn't save ${f.name}`);
      }
      await load();
    } finally {
      setUploading(false);
      if (inputRef.current) inputRef.current.value = "";
    }
  }

  async function remove(f: FileRow) {
    if (!(await confirm({
      title: `Delete "${f.name}"?`,
      description: "Removes the file from this folder and from Library → Files.",
      confirmLabel: "Delete file",
      destructive: true,
    }))) return;
    const res = await fetch(`/api/files/${f.id}`, { method: "DELETE" });
    if (res.ok) { toast("File deleted"); void load(); }
    else toast("Couldn't delete the file");
  }

  return (
    <section className="rounded-xl border border-zinc-200 bg-white p-4">
      <div className="mb-3 flex items-center justify-between">
        <h2 className="text-sm font-semibold text-zinc-900">Files</h2>
        {canEdit ? (
          <>
            <input ref={inputRef} type="file" multiple className="hidden" onChange={(e) => void uploadFiles(e.target.files)} />
            <button
              type="button"
              disabled={uploading}
              onClick={() => inputRef.current?.click()}
              className="inline-flex h-7 items-center gap-1.5 rounded-md border border-zinc-200 px-2.5 text-[13px] text-zinc-700 hover:bg-zinc-50 disabled:opacity-50"
            >
              {uploading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Upload className="h-3.5 w-3.5" />} Upload
            </button>
          </>
        ) : null}
      </div>

      {files === null ? (
        <div className="flex items-center gap-2 py-4 text-[13px] text-zinc-400"><Loader2 className="h-4 w-4 animate-spin" /> Loading…</div>
      ) : files.length === 0 ? (
        <p className="py-3 text-[13px] text-zinc-400">
          No files yet.{canEdit ? " Drag files anywhere on this page to upload — they also appear in Library → Files." : ""}
        </p>
      ) : (
        <ul className="divide-y divide-zinc-100">
          {files.map((f) => {
            const Icon = iconFor(f.mimeType);
            return (
              <li key={f.id} className="group flex items-center gap-3 py-2">
                <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-zinc-100">
                  <Icon className="h-4 w-4 text-zinc-500" />
                </span>
                <div className="min-w-0 flex-1">
                  <a href={f.url} target="_blank" rel="noopener" className="block truncate text-[14px] text-zinc-800 hover:text-[#0073EA]" title={f.name}>
                    {f.name}
                  </a>
                  <span className="text-[12px] text-zinc-400">
                    {fmtSize(f.size)} · {new Date(f.updatedAt).toLocaleDateString("en-US", { month: "short", day: "numeric" })}
                  </span>
                </div>
                <a href={f.url} target="_blank" rel="noopener" aria-label={`Open ${f.name}`} className="rounded-md p-1.5 text-zinc-300 opacity-0 hover:bg-zinc-100 hover:text-zinc-700 group-hover:opacity-100">
                  <ExternalLink className="h-3.5 w-3.5" />
                </a>
                {canEdit ? (
                  <>
                    <button type="button" onClick={() => setMovingFile(f)} aria-label={`Move ${f.name}`} title="Move to another folder, space or the library" className="rounded-md p-1.5 text-zinc-300 opacity-0 hover:bg-zinc-100 hover:text-zinc-700 group-hover:opacity-100">
                      <MoveRight className="h-3.5 w-3.5" />
                    </button>
                    <button type="button" onClick={() => void remove(f)} aria-label={`Delete ${f.name}`} className="rounded-md p-1.5 text-zinc-300 opacity-0 hover:bg-red-50 hover:text-red-500 group-hover:opacity-100">
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  </>
                ) : null}
              </li>
            );
          })}
        </ul>
      )}
      {movingFile ? (
        <MoveFileDialog fileId={movingFile.id} fileName={movingFile.name} onClose={() => setMovingFile(null)} />
      ) : null}
    </section>
  );
}
