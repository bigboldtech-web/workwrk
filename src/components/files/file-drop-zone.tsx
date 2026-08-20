"use client";

// FileDropZone — drag a file from the desktop anywhere over the wrapped
// region and it uploads straight into the given anchor (Space folder or
// Space root). No picker ceremony: drop, see it appear. Completion is
// broadcast as `workwrk:files-changed` so every files surface reloads.

import { useCallback, useRef, useState } from "react";
import { UploadCloud } from "lucide-react";
import { useOsToast } from "@/components/layout/os/toast";

interface FileDropZoneProps {
  spaceFolderId?: string;
  spaceId?: string;
  disabled?: boolean;
  /** Shown in the drop overlay: "Drop to upload to <label>". */
  label: string;
  children: React.ReactNode;
  className?: string;
}

export function FileDropZone({ spaceFolderId, spaceId, disabled, label, children, className }: FileDropZoneProps) {
  const { toast } = useOsToast();
  const [over, setOver] = useState(false);
  // dragenter/leave fire for every child — depth counting keeps the overlay
  // stable while the cursor crosses inner elements.
  const depth = useRef(0);

  const uploadAll = useCallback(async (list: FileList) => {
    let ok = 0;
    for (const f of Array.from(list)) {
      try {
        const fd = new FormData();
        fd.append("file", f);
        const up = await fetch("/api/upload", { method: "POST", body: fd });
        if (!up.ok) continue;
        const u = await up.json();
        const url = u.url ?? u.data?.url;
        if (!url) continue;
        const res = await fetch("/api/files", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            name: f.name,
            mimeType: f.type || "application/octet-stream",
            size: f.size,
            url,
            ...(spaceFolderId ? { spaceFolderId } : {}),
            ...(spaceId && !spaceFolderId ? { spaceId } : {}),
          }),
        });
        if (res.ok) ok += 1;
      } catch { /* per-file failure — the summary toast reports the count */ }
    }
    toast(ok === list.length ? `${ok} file${ok === 1 ? "" : "s"} uploaded` : `${ok}/${list.length} files uploaded`);
    window.dispatchEvent(new CustomEvent("workwrk:files-changed"));
  }, [spaceFolderId, spaceId, toast]);

  if (disabled) return <div className={className}>{children}</div>;

  return (
    <div
      className={`relative ${className ?? ""}`}
      onDragEnter={(e) => {
        if (!e.dataTransfer.types.includes("Files")) return;
        e.preventDefault();
        depth.current += 1;
        setOver(true);
      }}
      onDragOver={(e) => {
        if (!e.dataTransfer.types.includes("Files")) return;
        e.preventDefault();
      }}
      onDragLeave={(e) => {
        if (!e.dataTransfer.types.includes("Files")) return;
        depth.current = Math.max(0, depth.current - 1);
        if (depth.current === 0) setOver(false);
      }}
      onDrop={(e) => {
        if (!e.dataTransfer.types.includes("Files")) return;
        e.preventDefault();
        depth.current = 0;
        setOver(false);
        if (e.dataTransfer.files.length > 0) void uploadAll(e.dataTransfer.files);
      }}
    >
      {children}
      {over ? (
        <div className="pointer-events-none absolute inset-0 z-40 flex items-center justify-center rounded-xl border-2 border-dashed border-[#0073EA] bg-[#0073EA]/5">
          <div className="flex items-center gap-2 rounded-lg bg-white px-4 py-2 text-[14px] font-medium text-[#0073EA] shadow-lg">
            <UploadCloud className="h-4 w-4" /> Drop to upload to {label}
          </div>
        </div>
      ) : null}
    </div>
  );
}
