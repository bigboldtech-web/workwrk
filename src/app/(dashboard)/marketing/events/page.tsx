"use client";

// Marketing → Events board. Card grid view.

import { useCallback, useEffect, useState } from "react";
import { Calendar } from "lucide-react";
import { BoardShell } from "@/components/layout/board-shell";
import {
  EventModal, EVENT_TONES, Empty, Loading, dateRange, type EventBrief,
} from "@/components/marketing/shared";

export default function MarketingEventsPage() {
  const [items, setItems] = useState<EventBrief[]>([]);
  const [loading, setLoading] = useState(true);
  const [showNew, setShowNew] = useState(false);

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const r = await fetch("/api/marketing/events");
      const d = r.ok ? await r.json() : { events: [] };
      setItems(d.events || []);
    } finally { setLoading(false); }
  }, []);
  useEffect(() => { refresh(); }, [refresh]);

  return (
    <BoardShell
      productSlug="workwrk-campaigns"
      boardKey="events"
      viewMode="table"
      primaryAction={{ label: "New event", onClick: () => setShowNew(true) }}
      titleAccessory={
        <span className="ml-2 text-xs text-muted-2 tabular-nums">{items.length}</span>
      }
    >
      <div className="rounded-xl border border-border bg-surface overflow-hidden">
        {loading ? <Loading /> : items.length === 0 ? (
          <Empty
            Icon={Calendar}
            title="No events on the calendar"
            hint="Conferences, webinars, customer events — plan, run, measure ROI."
            onAction={() => setShowNew(true)}
            actionLabel="Add an event"
          />
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3 p-3">
            {items.map((e) => (
              <article key={e.id} className="rounded-xl border border-border bg-surface p-4 hover:border-amber-300">
                <div className="flex items-center gap-2 mb-2">
                  <span className={`text-[10px] font-medium px-2 py-0.5 rounded-full uppercase tracking-wider ${EVENT_TONES[e.status]}`}>
                    {e.status}
                  </span>
                  {e.format && <span className="text-[10px] text-muted-2">· {e.format}</span>}
                </div>
                <h3 className="font-semibold text-sm mb-1">{e.name}</h3>
                {e.type && <p className="text-xs text-muted mb-2">{e.type}</p>}
                <div className="flex items-center gap-3 text-[11px] text-muted-2 flex-wrap">
                  <span>{dateRange(e.startDate, e.endDate)}</span>
                  {e.location && <span>· {e.location}</span>}
                  {e.capacity !== null && <span>· {e.registeredCount ?? 0}/{e.capacity}</span>}
                </div>
              </article>
            ))}
          </div>
        )}
      </div>

      {showNew && (
        <EventModal
          onClose={() => setShowNew(false)}
          onCreated={() => { setShowNew(false); refresh(); }}
        />
      )}
    </BoardShell>
  );
}
