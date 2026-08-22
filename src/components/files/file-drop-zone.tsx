"use client";

// FileDropZone — drag a file from the desktop anywhere over the containing
// region and it uploads straight into the given anchor (Space folder or Space
// root). Rendered as a SELF-ATTACHING OVERLAY (a sibling inside the target
// container), never as a wrapper: wrapping server-rendered children in a
// client component forces the whole subtree through the RSC serialization
// boundary, and any component-as-prop inside it crashes the page ("Functions
// cannot be passed to Client Components"). The overlay attaches its drag
// listeners to the parent element instead. Completion broadcasts
// `workwrk:files-changed` so every files surface reloads.

import { useCallback, useEffect, useRef, useState } from "react";
import { UploadCloud } from "lucide-react";
import { useOsToast } from "@/components/layout/os/toast";

interface FileDropZoneProps {
  spaceFolderId?: string;
  spaceId?: string;
  disabled?: boolean;
  /** Shown in the drop overlay: "Drop to upload to <label>". */
  label: string;
}

export function FileDropZone({ spaceFolderId, spaceId, disabled, label }: FileDropZoneProps) {
  const { toast } = useOsToast();
  const [over, setOver] = useState(false);
  const anchorRef = useRef<HTMLDivElement>(null);
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
        const s3KeyVal = typeof (u.s3Key ?? u.data?.s3Key) === "string" ? (u.s3Key ?? u.data?.s3Key) : null;
        const res = await fetch("/api/files", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            name: f.name,
            mimeType: f.type || "application/octet-stream",
            size: f.size,
            url,
            ...(s3KeyVal ? { s3Key: s3KeyVal } : {}),
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

  useEffect(() => {
    if (disabled) return;
    const parent = anchorRef.current?.parentElement;
    if (!parent) return;
    // The overlay positions against the parent; ensure it is a positioning
    // context without touching the server markup.
    if (getComputedStyle(parent).position === "static") parent.style.position = "relative";

    const hasFiles = (e: DragEvent) => !!e.dataTransfer && Array.from(e.dataTransfer.types).includes("Files");
    const onEnter = (e: DragEvent) => {
      if (!hasFiles(e)) return;
      e.preventDefault();
      depth.current += 1;
      setOver(true);
    };
    const onOver = (e: DragEvent) => { if (hasFiles(e)) e.preventDefault(); };
    const onLeave = (e: DragEvent) => {
      if (!hasFiles(e)) return;
      depth.current = Math.max(0, depth.current - 1);
      if (depth.current === 0) setOver(false);
    };
    const onDrop = (e: DragEvent) => {
      if (!hasFiles(e)) return;
      e.preventDefault();
      depth.current = 0;
      setOver(false);
      if (e.dataTransfer && e.dataTransfer.files.length > 0) void uploadAll(e.dataTransfer.files);
    };
    parent.addEventListener("dragenter", onEnter);
    parent.addEventListener("dragover", onOver);
    parent.addEventListener("dragleave", onLeave);
    parent.addEventListener("drop", onDrop);
    return () => {
      parent.removeEventListener("dragenter", onEnter);
      parent.removeEventListener("dragover", onOver);
      parent.removeEventListener("dragleave", onLeave);
      parent.removeEventListener("drop", onDrop);
    };
  }, [disabled, uploadAll]);

  return (
    <div ref={anchorRef} className="contents">
      {over && !disabled ? (
        <div className="pointer-events-none absolute inset-0 z-40 flex items-center justify-center rounded-xl border-2 border-dashed border-[#0073EA] bg-[#0073EA]/5">
          <div className="flex items-center gap-2 rounded-lg bg-white px-4 py-2 text-[14px] font-medium text-[#0073EA] shadow-lg">
            <UploadCloud className="h-4 w-4" /> Drop to upload to {label}
          </div>
        </div>
      ) : null}
    </div>
  );
}
