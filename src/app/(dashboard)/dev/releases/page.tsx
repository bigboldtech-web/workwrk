"use client";

// Dev → Releases board.

import { useCallback, useEffect, useState } from "react";
import { Rocket } from "lucide-react";
import { BoardShell } from "@/components/layout/board-shell";
import {
  Empty, Loading, ReleaseModal, RELEASE_TONES, type Release,
} from "@/components/dev/shared";

export default function DevReleasesPage() {
  const [releases, setReleases] = useState<Release[]>([]);
  const [loading, setLoading] = useState(true);
  const [showNew, setShowNew] = useState(false);

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const r = await fetch("/api/dev/releases");
      const d = r.ok ? await r.json() : { releases: [] };
      setReleases(d.releases || []);
    } finally { setLoading(false); }
  }, []);
  useEffect(() => { refresh(); }, [refresh]);

  return (
    <BoardShell
      productSlug="workwrk-dev"
      boardKey="releases"
      viewMode="table"
      primaryAction={{ label: "New release", onClick: () => setShowNew(true) }}
      titleAccessory={
        <span className="ml-2 text-xs text-muted-2 tabular-nums">{releases.length}</span>
      }
    >
      <div className="rounded-xl border border-border bg-surface overflow-hidden">
        {loading ? <Loading /> : releases.length === 0 ? (
          <Empty
            Icon={Rocket}
            title="No releases tracked"
            hint="Track each version from In Development → Ready → Shipped, with public changelog."
            onAction={() => setShowNew(true)}
            actionLabel="Track a release"
          />
        ) : (
          <table className="w-full text-sm">
            <thead className="bg-surface-2 text-xs uppercase tracking-wider text-muted-2">
              <tr>
                <th className="text-left px-4 py-2.5">Version</th>
                <th className="text-left px-4 py-2.5">Name</th>
                <th className="text-left px-4 py-2.5">Status</th>
                <th className="text-left px-4 py-2.5">Type</th>
                <th className="text-left px-4 py-2.5">Date</th>
                <th className="text-left px-4 py-2.5">Public</th>
              </tr>
            </thead>
            <tbody>
              {releases.map((r) => (
                <tr key={r.id} className="border-t border-border hover:bg-surface-2">
                  <td className="px-4 py-2.5 font-mono text-xs">{r.version}</td>
                  <td className="px-4 py-2.5 font-medium">{r.name ?? "—"}</td>
                  <td className="px-4 py-2.5">
                    <span className={`text-[10px] font-medium px-2 py-0.5 rounded-full uppercase tracking-wider ${RELEASE_TONES[r.status]}`}>
                      {r.status.replace(/_/g, " ")}
                    </span>
                  </td>
                  <td className="px-4 py-2.5 text-xs text-muted-2">{r.releaseType ?? "—"}</td>
                  <td className="px-4 py-2.5 text-xs text-muted-2">
                    {r.shippedAt
                      ? new Date(r.shippedAt).toLocaleDateString()
                      : r.scheduledFor
                        ? new Date(r.scheduledFor).toLocaleDateString()
                        : "—"}
                  </td>
                  <td className="px-4 py-2.5 text-xs">{r.isPublic ? "✓" : "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {showNew && (
        <ReleaseModal
          onClose={() => setShowNew(false)}
          onCreated={() => { setShowNew(false); refresh(); }}
        />
      )}
    </BoardShell>
  );
}
