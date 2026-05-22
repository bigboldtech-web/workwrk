"use client";

// Legal → IP portfolio board.

import { useCallback, useEffect, useState } from "react";
import { Award, Clock } from "lucide-react";
import { BoardShell } from "@/components/layout/board-shell";
import {
  TrademarkModal, Empty, Loading, TRADEMARK_TONES, fmtDate, daysUntil,
  type Trademark,
} from "@/components/legal/shared";

export default function LegalIpPage() {
  const [trademarks, setTrademarks] = useState<Trademark[]>([]);
  const [loading, setLoading] = useState(true);
  const [showNew, setShowNew] = useState(false);

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const r = await fetch("/api/legal/trademarks");
      const d = r.ok ? await r.json() : { trademarks: [] };
      setTrademarks(d.trademarks || []);
    } finally { setLoading(false); }
  }, []);
  useEffect(() => { refresh(); }, [refresh]);

  return (
    <BoardShell
      productSlug="workwrk-contracts"
      boardKey="ip"
      viewMode="table"
      primaryAction={{ label: "New IP record", onClick: () => setShowNew(true) }}
      titleAccessory={<span className="ml-2 text-xs text-muted-2 tabular-nums">{trademarks.length}</span>}
    >
      {loading ? (
        <div className="rounded-xl border border-border bg-surface"><Loading /></div>
      ) : trademarks.length === 0 ? (
        <div className="rounded-xl border border-border bg-surface">
          <Empty
            Icon={Award}
            title="No IP records"
            hint="Track trademarks, patents, copyrights with renewal alerts + outside-counsel attribution."
            onAction={() => setShowNew(true)}
            actionLabel="Add first mark"
          />
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
          {trademarks.map((t) => {
            const d = daysUntil(t.renewalDueAt);
            const renewalSoon = d !== null && d <= 90 && d >= 0;
            return (
              <article key={t.id} className="rounded-xl border border-border bg-surface p-4 hover:border-indigo-300">
                <div className="flex items-center gap-2 mb-2">
                  <span className="text-[10px] uppercase tracking-wider text-muted-2">{t.type.replace(/_/g, " ")}</span>
                  <span className={`text-[10px] font-medium px-2 py-0.5 rounded-full uppercase tracking-wider ${TRADEMARK_TONES[t.status]} ml-auto`}>
                    {t.status.replace(/_/g, " ")}
                  </span>
                </div>
                <h3 className="font-semibold text-base mb-1">{t.mark}</h3>
                {t.registrationNumber && <p className="text-[11px] text-muted-2 mb-1 font-mono">Reg# {t.registrationNumber}</p>}
                {t.jurisdictions && t.jurisdictions.length > 0 && <p className="text-xs text-muted mb-2">{t.jurisdictions.join(" · ")}</p>}
                {t.renewalDueAt && (
                  <div className={`text-[11px] mt-2 ${renewalSoon ? "text-amber-700 font-medium" : "text-muted-2"}`}>
                    {renewalSoon && <Clock size={11} className="inline mr-1" />}
                    Renewal: {fmtDate(t.renewalDueAt)} {d !== null && d >= 0 && `(${d}d)`}
                  </div>
                )}
              </article>
            );
          })}
        </div>
      )}

      {showNew && (
        <TrademarkModal onClose={() => setShowNew(false)} onCreated={() => { setShowNew(false); refresh(); }} />
      )}
    </BoardShell>
  );
}
