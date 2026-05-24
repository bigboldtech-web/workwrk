"use client";

// Dev → Sprints board.

import { useCallback, useEffect, useState } from "react";
import { Code, Calendar } from "lucide-react";
import { BoardShell } from "@/components/layout/board-shell";
import { useActiveWorkspace } from "@/hooks/use-active-workspace";
import {
  Empty, Loading, SprintModal, SPRINT_TONES, type Sprint,
} from "@/components/dev/shared";

export default function DevSprintsPage() {
  const [sprints, setSprints] = useState<Sprint[]>([]);
  const [loading, setLoading] = useState(true);
  const [showNew, setShowNew] = useState(false);

  const workspaceId = useActiveWorkspace("workwrk-dev");
  const wsQuery = workspaceId ? `?workspace=${encodeURIComponent(workspaceId)}` : "";

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const r = await fetch(`/api/dev/sprints${wsQuery}`);
      const d = r.ok ? await r.json() : { sprints: [] };
      setSprints(d.sprints || []);
    } finally { setLoading(false); }
  }, [wsQuery]);
  useEffect(() => { refresh(); }, [refresh]);

  return (
    <BoardShell
      productSlug="workwrk-dev"
      boardKey="sprints"
      viewMode="table"
      primaryAction={{ label: "New sprint", onClick: () => setShowNew(true) }}
      titleAccessory={
        <span className="ml-2 text-xs text-muted-2 tabular-nums">{sprints.length}</span>
      }
    >
      <div className="rounded-xl border border-border bg-surface overflow-hidden">
        {loading ? <Loading /> : sprints.length === 0 ? (
          <Empty
            Icon={Code}
            title="No sprints planned"
            hint="Define a sprint with goal + duration. Track committed vs completed points."
            onAction={() => setShowNew(true)}
            actionLabel="Plan first sprint"
          />
        ) : (
          <div className="divide-y divide-border">
            {sprints.map((s) => {
              const progress = s.committedPoints
                ? Math.round(((s.completedPoints ?? 0) / s.committedPoints) * 100)
                : null;
              return (
                <div key={s.id} className="px-4 py-3 hover:bg-surface-2">
                  <div className="flex items-start gap-4">
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 mb-1">
                        <span className={`text-[10px] font-medium px-1.5 py-0.5 rounded uppercase tracking-wider ${SPRINT_TONES[s.status]}`}>
                          {s.status}
                        </span>
                        <span className="font-semibold text-sm">{s.name}</span>
                      </div>
                      {s.goal && <p className="text-xs text-muted mb-2">{s.goal}</p>}
                      <div className="flex items-center gap-3 text-[11px] text-muted-2">
                        <span>
                          <Calendar size={11} className="inline mr-1" />
                          {new Date(s.startDate).toLocaleDateString("en-US", { month: "short", day: "numeric" })}
                          {" – "}
                          {new Date(s.endDate).toLocaleDateString("en-US", { month: "short", day: "numeric" })}
                        </span>
                        {s.committedPoints !== null && (
                          <span>· {s.completedPoints ?? 0}/{s.committedPoints} pts</span>
                        )}
                      </div>
                    </div>
                    {progress !== null && (
                      <div className="w-24 flex-shrink-0">
                        <div className="text-xs font-medium mb-1 text-right">{progress}%</div>
                        <div className="h-1.5 rounded-full bg-surface-2 overflow-hidden">
                          <div className="h-full bg-violet-500" style={{ width: progress + "%" }} />
                        </div>
                      </div>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {showNew && (
        <SprintModal
          workspaceId={workspaceId}
          onClose={() => setShowNew(false)}
          onCreated={() => { setShowNew(false); refresh(); }}
        />
      )}
    </BoardShell>
  );
}
