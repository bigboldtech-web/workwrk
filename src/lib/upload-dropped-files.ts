"use client";

// Shared uploader for OS-file drops (folder pages, sidebar tree rows).
// Uploads each file (/api/upload → /api/files) into the given anchor and
// broadcasts `workwrk:files-changed` so every files surface reloads.
// Callers own the toast — this stays hook-free.

export interface DropAnchor {
  spaceFolderId?: string;
  spaceId?: string;
}

export async function uploadDroppedFiles(
  files: FileList | File[],
  anchor: DropAnchor,
): Promise<{ ok: number; total: number }> {
  const list = Array.from(files);
  let ok = 0;
  for (const f of list) {
    try {
      const fd = new FormData();
      fd.append("file", f);
      const up = await fetch("/api/upload", { method: "POST", body: fd });
      if (!up.ok) continue;
      const u = await up.json();
      const url = u.url ?? u.data?.url;
      if (!url) continue;
      const s3Key = typeof (u.s3Key ?? u.data?.s3Key) === "string" ? (u.s3Key ?? u.data?.s3Key) : null;
      const res = await fetch("/api/files", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: f.name,
          mimeType: f.type || "application/octet-stream",
          size: f.size,
          url,
          ...(s3Key ? { s3Key } : {}),
          ...(anchor.spaceFolderId ? { spaceFolderId: anchor.spaceFolderId } : {}),
          ...(anchor.spaceId && !anchor.spaceFolderId ? { spaceId: anchor.spaceId } : {}),
        }),
      });
      if (res.ok) ok += 1;
    } catch { /* per-file failure — the caller's summary toast reports counts */ }
  }
  window.dispatchEvent(new CustomEvent("workwrk:files-changed"));
  return { ok, total: list.length };
}

export function dragHasFiles(e: { dataTransfer: DataTransfer | null }): boolean {
  return !!e.dataTransfer && Array.from(e.dataTransfer.types).includes("Files");
}
