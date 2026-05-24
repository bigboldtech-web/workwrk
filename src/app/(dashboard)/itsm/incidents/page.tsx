"use client";

// ITSM → Incidents board (timeline).

import { useCallback, useEffect, useState } from "react";
import { AlertTriangle, ChevronRight, Clock } from "lucide-react";
import { BoardShell } from "@/components/layout/board-shell";
import { useActiveWorkspace } from "@/hooks/use-active-workspace";
import {
  NewIncidentModal, EmptyState, SEVERITY_TONES, INC_STATUS_TONES, timeAgo,
  type Incident,
} from "@/components/itsm/shared";

export default function ItsmIncidentsPage() {
  const [incidents, setIncidents] = useState<Incident[]>([]);
  const [loading, setLoading] = useState(true);
  const [showNew, setShowNew] = useState(false);

  const workspaceId = useActiveWorkspace("workwrk-itsm");
  const wsQuery = workspaceId ? `?workspace=${encodeURIComponent(workspaceId)}` : "";

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const r = await fetch(`/api/itsm/incidents${wsQuery}`);
      const d = r.ok ? await r.json() : { incidents: [] };
      setIncidents(d.incidents || []);
    } finally { setLoading(false); }
  }, [wsQuery]);
  useEffect(() => { refresh(); }, [refresh]);

  return (
    <BoardShell
      productSlug="workwrk-itsm"
      boardKey="incidents"
      viewMode="table"
      primaryAction={{ label: "Declare incident", onClick: () => setShowNew(true) }}
      titleAccessory={
        <span className="ml-2 text-xs text-muted-2 tabular-nums">{incidents.length}</span>
      }
    >
      <div className="rounded-xl border border-border bg-surface overflow-hidden">
        {loading ? (
          <div className="text-sm text-muted py-20 text-center">Loading incidents…</div>
        ) : incidents.length === 0 ? (
          <EmptyState
            Icon={AlertTriangle}
            title="No incidents declared"
            hint="When production breaks, declare an incident to coordinate response."
            action={{ label: "Declare incident", onClick: () => setShowNew(true) }}
          />
        ) : (
          <div className="divide-y divide-border">
            {incidents.map((i) => (
              <div key={i.id} className="p-4 hover:bg-surface-2">
                <div className="flex items-start justify-between gap-4">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-1.5">
                      <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded ${SEVERITY_TONES[i.severity]}`}>{i.severity}</span>
                      <span className={`text-[10px] font-medium px-2 py-0.5 rounded-full uppercase tracking-wider ${INC_STATUS_TONES[i.status]}`}>{i.status}</span>
                      <span className="text-xs text-muted-2 inline-flex items-center gap-1">
                        <Clock size={11} /> {timeAgo(i.startedAt)} ago
                      </span>
                    </div>
                    <h3 className="font-semibold text-sm mb-1">{i.title}</h3>
                    {i.summary && <p className="text-xs text-muted line-clamp-2">{i.summary}</p>}
                  </div>
                  <ChevronRight size={16} className="text-muted-2 flex-shrink-0" />
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {showNew && (
        <NewIncidentModal
          workspaceId={workspaceId}
          onClose={() => setShowNew(false)}
          onCreated={() => { setShowNew(false); refresh(); }}
        />
      )}
    </BoardShell>
  );
}
