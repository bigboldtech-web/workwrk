"use client";

// MoveFileDialog — move a file anywhere: into any Space folder, to a Space's
// root, or out of Spaces entirely (Library only). Spaces load once; each
// space's folders load lazily on expand. Moving PATCHes /api/files/[id] and
// broadcasts `workwrk:files-changed`.

import { useEffect, useState } from "react";
import { ChevronRight, FolderOpen, Layers, Library, Loader2 } from "lucide-react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { useOsToast } from "@/components/layout/os/toast";

interface SpaceRow { id: string; name: string }
interface FolderRow { id: string; name: string; parentId?: string | null }

export function MoveFileDialog({ fileId, fileName, onClose }: { fileId: string; fileName: string; onClose: () => void }) {
  const { toast } = useOsToast();
  const [spaces, setSpaces] = useState<SpaceRow[] | null>(null);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [folders, setFolders] = useState<Record<string, FolderRow[]>>({});
  const [loadingFolders, setLoadingFolders] = useState<string | null>(null);
  const [moving, setMoving] = useState(false);

  useEffect(() => {
    fetch("/api/spaces")
      .then((r) => (r.ok ? r.json() : []))
      .then((d) => setSpaces((Array.isArray(d) ? d : d.data ?? []).map((s: SpaceRow) => ({ id: s.id, name: s.name }))))
      .catch(() => setSpaces([]));
  }, []);

  async function expand(spaceId: string) {
    if (expanded === spaceId) { setExpanded(null); return; }
    setExpanded(spaceId);
    if (!folders[spaceId]) {
      setLoadingFolders(spaceId);
      try {
        const r = await fetch(`/api/folders?spaceId=${encodeURIComponent(spaceId)}`);
        const d = r.ok ? await r.json() : [];
        setFolders((prev) => ({ ...prev, [spaceId]: Array.isArray(d) ? d : d.data ?? [] }));
      } finally { setLoadingFolders(null); }
    }
  }

  async function move(patch: { spaceFolderId?: string | null; spaceId?: string | null }, destination: string) {
    setMoving(true);
    try {
      const res = await fetch(`/api/files/${fileId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(patch),
      });
      if (!res.ok) {
        const d = await res.json().catch(() => ({}));
        toast(d?.error ?? "Couldn't move the file");
        return;
      }
      toast(`Moved to ${destination}`);
      window.dispatchEvent(new CustomEvent("workwrk:files-changed"));
      onClose();
    } finally { setMoving(false); }
  }

  const row = "flex w-full items-center gap-2 rounded-md px-2.5 py-2 text-left text-[14px] text-zinc-800 hover:bg-zinc-50 disabled:opacity-50";

  return (
    <Dialog open onOpenChange={(v) => { if (!v) onClose(); }}>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle className="truncate">Move &ldquo;{fileName}&rdquo;</DialogTitle>
        </DialogHeader>
        <div className="max-h-[50vh] space-y-0.5 overflow-y-auto">
          <button type="button" disabled={moving} className={row} onClick={() => void move({ spaceId: null, spaceFolderId: null }, "Library")}>
            <Library className="h-4 w-4 shrink-0 text-zinc-400" /> Library only (no Space)
          </button>
          {spaces === null ? (
            <div className="flex items-center gap-2 px-2.5 py-3 text-[13px] text-zinc-400"><Loader2 className="h-4 w-4 animate-spin" /> Loading spaces…</div>
          ) : spaces.length === 0 ? (
            <p className="px-2.5 py-3 text-[13px] text-zinc-400">No spaces available.</p>
          ) : (
            spaces.map((s) => (
              <div key={s.id}>
                <div className="flex items-center">
                  <button
                    type="button"
                    onClick={() => void expand(s.id)}
                    aria-label={`Show folders in ${s.name}`}
                    className="rounded-md p-1 text-zinc-400 hover:bg-zinc-100 hover:text-zinc-700"
                  >
                    <ChevronRight className={`h-3.5 w-3.5 transition-transform ${expanded === s.id ? "rotate-90" : ""}`} />
                  </button>
                  <button type="button" disabled={moving} className={row} onClick={() => void move({ spaceId: s.id, spaceFolderId: null }, s.name)}>
                    <Layers className="h-4 w-4 shrink-0 text-zinc-400" /> {s.name}
                  </button>
                </div>
                {expanded === s.id ? (
                  loadingFolders === s.id ? (
                    <div className="flex items-center gap-2 py-1.5 pl-10 text-[13px] text-zinc-400"><Loader2 className="h-3.5 w-3.5 animate-spin" /> Loading…</div>
                  ) : (folders[s.id] ?? []).length === 0 ? (
                    <p className="py-1.5 pl-10 text-[13px] text-zinc-400">No folders in this space.</p>
                  ) : (
                    (folders[s.id] ?? []).map((f) => (
                      <button
                        key={f.id}
                        type="button"
                        disabled={moving}
                        className={`${row} pl-10`}
                        onClick={() => void move({ spaceFolderId: f.id }, `${s.name} / ${f.name}`)}
                      >
                        <FolderOpen className="h-4 w-4 shrink-0 text-zinc-400" /> {f.name}
                      </button>
                    ))
                  )
                ) : null}
              </div>
            ))
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
