"use client";

// CanvasVersionsPanel (spec-docs-knowledge section 2, /canvas/[id] "Version
// history", a 360 right panel): the scene snapshots the save path records,
// newest first, as 44px rows "v{n} · {name} · {date}" with Restore. A restore
// snapshots the current scene first on the server, so it is itself
// reversible; the page reloads to mount the restored scene cleanly.

import { useCallback, useEffect, useState } from "react";
import { History, RotateCcw, X } from "lucide-react";
import { SkeletonLines } from "@/components/ui/skeleton";
import { OsEmptyView } from "@/components/layout/os/empty-view";
import { useOsToast } from "@/components/layout/os/toast";
import { useConfirm } from "@/components/ui/dialog-provider";
import { useLayer } from "@/components/layout/os/shell-context";
import { apiFetch } from "@/lib/api-fetch";
import { useFormat } from "@/lib/format/use-date-prefs";
import { Dots } from "@/components/ui/dots";

type Version = { id: string; createdAt: string; createdBy: { id: string; firstName: string; lastName: string; avatar: string | null } | null };

export function CanvasVersionsPanel({ canvasId, canRestore, onClose }: { canvasId: string; canRestore: boolean; onClose: () => void }) {
  const { toast } = useOsToast();
  const confirm = useConfirm();
  const fmt = useFormat();
  const [versions, setVersions] = useState<Version[] | null>(null);
  const [failed, setFailed] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  useLayer(true, { id: "canvas-versions", kind: "panel", close: onClose });

  const load = useCallback(async () => {
    const r = await apiFetch<{ versions: Version[] }>(`/api/whiteboards/${canvasId}/versions`, { cache: "no-store" });
    if (!r.ok) { setFailed(true); return; }
    setFailed(false);
    setVersions(r.data.versions ?? []);
  }, [canvasId]);
  useEffect(() => {
    let alive = true;
    const t = setTimeout(() => { if (alive) void load(); }, 0);
    return () => { alive = false; clearTimeout(t); };
  }, [load]);

  async function restore(v: Version, n: number) {
    const ok = await confirm({ title: `Restore v${n}?`, description: "The current version is kept in Version history, so this can be undone.", confirmLabel: "Restore" });
    if (!ok) return;
    setBusy(v.id);
    const r = await apiFetch(`/api/whiteboards/${canvasId}/versions/${v.id}/restore`, { method: "POST" });
    setBusy(null);
    if (!r.ok) { toast(r.error || "Couldn't restore", { tone: "danger" }); return; }
    toast(`Restored v${n}`);
    window.location.reload();
  }

  return (
    <aside role="dialog" aria-label="Version history" className="os-chrome absolute bottom-0 end-0 top-0 z-30 flex w-[360px] flex-col border-s border-line bg-raised shadow-[var(--os-shadow-modal)]">
      <header className="flex h-12 shrink-0 items-center gap-2 border-b border-line px-4">
        <History className="h-4 w-4 text-ink-2" strokeWidth={1.5} aria-hidden />
        <h2 className="min-w-0 flex-1 truncate text-lg font-semibold text-ink">Version history</h2>
        <button type="button" onClick={onClose} aria-label="Close" className="inline-flex h-8 w-8 items-center justify-center rounded-md text-ink-2 hover:bg-hover hover:text-ink"><X className="h-4 w-4" strokeWidth={1.5} aria-hidden /></button>
      </header>
      <div className="min-h-0 flex-1 overflow-y-auto">
        {failed ? (
          <OsEmptyView variant="error" compact title="Couldn't load versions" action={{ label: "Retry", onClick: () => void load() }} />
        ) : versions === null ? (
          <div className="p-4"><SkeletonLines lines={4} /></div>
        ) : versions.length === 0 ? (
          <p className="p-4 text-base text-ink-2">No versions yet. A version is kept each time the canvas saves.</p>
        ) : (
          <ul className="flex flex-col py-1">
            {versions.map((v, i) => {
              const n = versions.length - i;
              const who = v.createdBy ? `${v.createdBy.firstName} ${v.createdBy.lastName}`.trim() : "Unknown";
              return (
                <li key={v.id} className="flex min-h-11 items-center gap-3 px-4 hover:bg-hover">
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-base text-ink">v{n}{i === 0 ? " · current" : ""}</span>
                    <span className="block truncate text-xs text-ink-2">{who} · <span title={fmt.title(v.createdAt)}>{fmt.date(v.createdAt, "datetime")}</span></span>
                  </span>
                  {canRestore && i > 0 ? (
                    <button type="button" onClick={() => void restore(v, n)} disabled={busy === v.id} className="inline-flex h-8 items-center gap-1.5 rounded-md px-2 text-sm font-medium text-ink-2 hover:bg-active hover:text-ink disabled:opacity-50">
                      {busy === v.id ? <Dots variant="pending" /> : <RotateCcw className="h-4 w-4" strokeWidth={1.5} aria-hidden />} Restore
                    </button>
                  ) : null}
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </aside>
  );
}
