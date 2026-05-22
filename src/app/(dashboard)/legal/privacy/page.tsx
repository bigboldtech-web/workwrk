"use client";

// Legal → Privacy (DSARs) board.

import { useCallback, useEffect, useState } from "react";
import { Shield, AlertTriangle, Clock } from "lucide-react";
import { BoardShell } from "@/components/layout/board-shell";
import {
  PrivacyModal, Empty, Loading, PRIVACY_TONES, fmtDate, daysUntil,
  type PrivacyRequest,
} from "@/components/legal/shared";

export default function LegalPrivacyPage() {
  const [requests, setRequests] = useState<PrivacyRequest[]>([]);
  const [loading, setLoading] = useState(true);
  const [showNew, setShowNew] = useState(false);

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const r = await fetch("/api/legal/privacy-requests");
      const d = r.ok ? await r.json() : { requests: [] };
      setRequests(d.requests || []);
    } finally { setLoading(false); }
  }, []);
  useEffect(() => { refresh(); }, [refresh]);

  return (
    <BoardShell
      productSlug="workwrk-contracts"
      boardKey="privacy"
      viewMode="table"
      primaryAction={{ label: "Log DSAR", onClick: () => setShowNew(true) }}
      titleAccessory={<span className="ml-2 text-xs text-muted-2 tabular-nums">{requests.length}</span>}
    >
      <div className="rounded-xl border border-border bg-surface overflow-hidden">
        {loading ? <Loading /> : requests.length === 0 ? (
          <Empty
            Icon={Shield}
            title="No DSARs filed"
            hint="GDPR / CCPA data subject requests get filed here. SLA timers auto-compute per jurisdiction."
            onAction={() => setShowNew(true)}
            actionLabel="Log a DSAR"
          />
        ) : (
          <div className="divide-y divide-border">
            {requests.map((r) => {
              const d = daysUntil(r.dueAt);
              const overdue = d !== null && d < 0;
              const urgent = d !== null && d <= 7 && d >= 0 && !["COMPLETED", "DENIED", "CANCELLED"].includes(r.status);
              return (
                <div key={r.id} className="px-4 py-3 hover:bg-surface-2 flex items-start gap-4">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-1">
                      <span className="text-[10px] font-bold px-1.5 py-0.5 rounded uppercase tracking-wider bg-indigo-100 text-indigo-700">
                        {r.type.replace(/_/g, " ")}
                      </span>
                      <span className={`text-[10px] font-medium px-2 py-0.5 rounded-full uppercase tracking-wider ${PRIVACY_TONES[r.status]}`}>
                        {r.status.replace(/_/g, " ")}
                      </span>
                      {r.jurisdiction && <span className="text-[10px] text-muted-2 uppercase tracking-wider">{r.jurisdiction}</span>}
                    </div>
                    <div className="font-medium text-sm">{r.subjectName ?? r.subjectEmail}</div>
                    {r.subjectName && <div className="text-xs text-muted-2">{r.subjectEmail}</div>}
                  </div>
                  <div className="flex-shrink-0 text-xs text-right">
                    {r.completedAt ? (
                      <span className="text-emerald-600">Done {fmtDate(r.completedAt)}</span>
                    ) : (
                      <>
                        <div className={overdue ? "text-rose-700 font-medium" : urgent ? "text-amber-700 font-medium" : "text-muted"}>
                          {overdue ? <AlertTriangle size={11} className="inline mr-1" /> : urgent ? <Clock size={11} className="inline mr-1" /> : null}
                          Due {fmtDate(r.dueAt)}
                        </div>
                        {d !== null && (
                          <div className={overdue ? "text-rose-700" : urgent ? "text-amber-700" : "text-muted-2"}>
                            {overdue ? `${-d}d overdue` : `${d}d left`}
                          </div>
                        )}
                      </>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {showNew && (
        <PrivacyModal onClose={() => setShowNew(false)} onCreated={() => { setShowNew(false); refresh(); }} />
      )}
    </BoardShell>
  );
}
