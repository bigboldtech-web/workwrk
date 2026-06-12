"use client";

// BoardFileGalleryView — FILE_GALLERY renderer. Grid of every file
// attached to this board's items (EntityLink BOARD_ITEM → FILE, served
// by /api/files?boardId=). Image files render real thumbnails; other
// mime types get an icon tile. Click the card → open the owning task's
// drawer; download stays a plain anchor.

import { useCallback, useEffect, useState } from "react";
import {
  Download, File as FileIcon, FileArchive, FileAudio, FileImage,
  FileSpreadsheet, FileText, FileVideo, Loader2, Paperclip,
} from "lucide-react";

interface ApiFile {
  id: string;
  name: string;
  mimeType: string;
  size: number;
  url: string;
  updatedAt: string;
  itemId: string | null;
}

interface BoardFileGalleryViewProps {
  boardId: string;
  onOpenItem?: (itemId: string) => void;
}

function mimeIcon(mime: string) {
  if (mime.startsWith("image/")) return FileImage;
  if (mime.startsWith("video/")) return FileVideo;
  if (mime.startsWith("audio/")) return FileAudio;
  if (mime.includes("sheet") || mime.includes("csv") || mime.includes("excel")) return FileSpreadsheet;
  if (mime.includes("zip") || mime.includes("tar") || mime.includes("compressed")) return FileArchive;
  if (mime.includes("pdf") || mime.startsWith("text/") || mime.includes("document")) return FileText;
  return FileIcon;
}

function fmtSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export function BoardFileGalleryView({ boardId, onOpenItem }: BoardFileGalleryViewProps) {
  const [files, setFiles] = useState<ApiFile[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const res = await fetch(`/api/files?boardId=${boardId}`, { cache: "no-store" });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const d = await res.json();
      setFiles(Array.isArray(d) ? d : Array.isArray(d?.data) ? d.data : []);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't load files");
      setFiles([]);
    }
  }, [boardId]);

  useEffect(() => { void load(); }, [load]);

  if (files === null) {
    return (
      <div className="rounded-lg border border-zinc-200 bg-white px-4 py-12 flex items-center justify-center gap-2 text-sm text-zinc-500">
        <Loader2 className="w-4 h-4 animate-spin" /> Loading files…
      </div>
    );
  }

  if (files.length === 0) {
    return (
      <div className="rounded-lg border border-zinc-200 bg-white px-8 py-14 text-center">
        <Paperclip className="w-8 h-8 mx-auto text-zinc-300 mb-3" />
        <h3 className="text-[15px] font-semibold text-zinc-900 mb-1">No files on this List yet</h3>
        <p className="text-[12.5px] text-zinc-500 max-w-sm mx-auto">
          {error ?? "Attach files from any task's drawer (Files section) and they'll collect here as a gallery."}
        </p>
      </div>
    );
  }

  return (
    <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-3">
      {files.map((f) => {
        const Icon = mimeIcon(f.mimeType);
        const isImage = f.mimeType.startsWith("image/");
        return (
          <div key={f.id} className="group rounded-lg border border-zinc-200 bg-white overflow-hidden hover:border-zinc-300 transition-colors">
            <button
              type="button"
              onClick={() => { if (f.itemId && onOpenItem) onOpenItem(f.itemId); }}
              className="block w-full text-left"
              title={f.itemId ? "Open task" : f.name}
            >
              {isImage ? (
                // eslint-disable-next-line @next/next/no-img-element -- user-uploaded blob URLs; next/image needs a configured loader
                <img src={f.url} alt={f.name} className="h-28 w-full object-cover bg-zinc-50" />
              ) : (
                <div className="h-28 w-full flex items-center justify-center bg-zinc-50">
                  <Icon className="w-8 h-8 text-zinc-300" />
                </div>
              )}
            </button>
            <div className="px-2.5 py-2 flex items-center gap-1.5">
              <div className="flex-1 min-w-0">
                <div className="truncate text-[12px] font-medium text-zinc-800" title={f.name}>{f.name}</div>
                <div className="text-[10.5px] text-zinc-400">{fmtSize(f.size)}</div>
              </div>
              <a
                href={f.url}
                download={f.name}
                className="opacity-0 group-hover:opacity-100 inline-flex items-center justify-center w-6 h-6 rounded text-zinc-500 hover:text-zinc-900 hover:bg-zinc-100 transition-opacity"
                aria-label={`Download ${f.name}`}
              >
                <Download className="w-3.5 h-3.5" />
              </a>
            </div>
          </div>
        );
      })}
    </div>
  );
}
