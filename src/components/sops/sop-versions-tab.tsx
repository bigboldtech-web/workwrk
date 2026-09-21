"use client";

// The SOP page's History tab (spec-process section 2 `/sops/[id]`): 44px
// rows "v3 · Published by Anita · 4 Sep" with a "Restore" ghost (Can edit;
// confirm), the current version pinned first with a success dot. Versions
// come from GET /api/sops/[id]/versions; Restore is POST with the versionId
// (the server snapshots the live row first, so nothing is lost).

import { useCallback, useEffect, useState } from "react";
import { SkeletonRows } from "@/components/ui/skeleton";
import { useConfirm } from "@/components/ui/dialog-provider";
import { useOsToast } from "@/components/layout/os/toast";
import { apiFetch } from "@/lib/api-fetch";
import { useFormat } from "@/lib/format/use-date-prefs";

type Version = { id: string; version: number; title: string; description: string | null; createdAt: string; publishedBy: string | null; publishedByName?: string | null };

export function SopVersionsTab({ sopId, currentVersion, status, canRestore, onRestored }: {
  sopId: string;
  currentVersion: number;
  status: string;
  canRestore: boolean;
  onRestored: () => void;
}) {
  const confirm = useConfirm();
  const { toast } = useOsToast();
  const fmt = useFormat();
  const [versions, setVersions] = useState<Version[] | null>(null);
  const [failed, setFailed] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);

  const load = useCallback(async () => {
    setFailed(false);
    const r = await apiFetch<{ versions?: Version[]; data?: { versions?: Version[] } }>(`/api/sops/${sopId}/versions`, { cache: "no-store" });
    if (!r.ok) { setFailed(true); setVersions([]); return; }
    setVersions(r.data.versions ?? r.data.data?.versions ?? []);
  }, [sopId]);
  useEffect(() => { const t = setTimeout(() => void load(), 0); return () => clearTimeout(t); }, [load]);

  async function restore(v: Version) {
    const ok = await confirm({
      title: `Restore v${v.version}?`,
      description: `What is live now is saved as a new version first, then v${v.version} becomes the current content.`,
      confirmLabel: "Restore",
    });
    if (!ok) return;
    setBusy(v.id);
    const r = await apiFetch(`/api/sops/${sopId}/versions`, { method: "POST", json: { versionId: v.id } });
    setBusy(null);
    if (!r.ok) { toast(r.error || "Couldn't restore that version", { tone: "danger" }); return; }
    toast(`Restored v${v.version}`);
    onRestored();
    void load();
  }

  return (
    <div className="overflow-hidden rounded-lg border border-line bg-raised">
      <div className="flex h-11 items-center gap-3 border-b border-line-soft px-3">
        <span aria-hidden className="inline-block h-1.5 w-1.5 shrink-0 rounded-full bg-success-solid" />
        <span className="min-w-0 flex-1 truncate text-row text-ink"><span className="font-medium tabular-nums">v{currentVersion}</span> · Current{status === "PUBLISHED" ? ", published" : ""}</span>
      </div>
      {versions === null ? (
        <SkeletonRows rows={3} rowHeight="44px" />
      ) : failed ? (
        <div className="flex h-11 items-center gap-2 px-3 text-row text-ink-2">Couldn&apos;t load versions · <button type="button" onClick={() => void load()} className="font-medium text-brand-deep hover:underline">Retry</button></div>
      ) : versions.length === 0 ? (
        <div className="flex h-11 items-center px-3 text-row text-ink-2">No earlier versions. One is saved every time a published SOP changes.</div>
      ) : (
        <ul>
          {versions.map((v) => (
            <li key={v.id} className="flex h-11 items-center gap-3 border-b border-line-soft px-3 last:border-b-0">
              <span className="min-w-0 flex-1 truncate text-row text-ink">
                <span className="font-medium tabular-nums">v{v.version}</span>
                <span className="text-ink-2"> · {v.publishedByName ? `Published by ${v.publishedByName}` : "Published"} · <span title={fmt.title(v.createdAt)}>{fmt.date(v.createdAt, "date")}</span></span>
              </span>
              {canRestore ? (
                <button type="button" onClick={() => void restore(v)} disabled={busy === v.id} className="inline-flex h-7 shrink-0 items-center rounded-md px-2 text-sm font-medium text-ink-2 hover:bg-hover hover:text-ink disabled:opacity-60">
                  Restore
                </button>
              ) : null}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
