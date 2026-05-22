"use client";

// Helpdesk → Macros board (canned responses).

import { useCallback, useEffect, useState } from "react";
import { MessageSquareQuote } from "lucide-react";
import { BoardShell } from "@/components/layout/board-shell";
import {
  MacroModal, Empty, Loading, type Macro,
} from "@/components/helpdesk/shared";

export default function HelpdeskMacrosPage() {
  const [macros, setMacros] = useState<Macro[]>([]);
  const [loading, setLoading] = useState(true);
  const [showNew, setShowNew] = useState(false);

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const r = await fetch("/api/helpdesk/macros");
      const d = r.ok ? await r.json() : { macros: [] };
      setMacros(d.macros || []);
    } finally { setLoading(false); }
  }, []);
  useEffect(() => { refresh(); }, [refresh]);

  return (
    <BoardShell
      productSlug="workwrk-help"
      boardKey="macros"
      viewMode="table"
      primaryAction={{ label: "New macro", onClick: () => setShowNew(true) }}
      titleAccessory={<span className="ml-2 text-xs text-muted-2 tabular-nums">{macros.length}</span>}
    >
      {loading ? (
        <div className="rounded-xl border border-border bg-surface"><Loading /></div>
      ) : macros.length === 0 ? (
        <div className="rounded-xl border border-border bg-surface">
          <Empty
            Icon={MessageSquareQuote}
            title="No canned responses"
            hint="Macros are reusable replies your team types once and applies to many tickets. Refund policy, password reset, escalation message."
            onAction={() => setShowNew(true)}
            actionLabel="Write first macro"
          />
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
          {macros.map((m) => (
            <article key={m.id} className="rounded-xl border border-border bg-surface p-4 hover:border-teal-300">
              <div className="flex items-center gap-2 mb-2">
                <span className="font-mono text-[10px] text-muted-2 truncate">/{m.slug}</span>
                {m.category && <span className="text-[10px] uppercase tracking-wider text-teal-700 dark:text-teal-400 ml-auto">{m.category}</span>}
              </div>
              <h3 className="font-semibold text-sm mb-1.5">{m.title}</h3>
              <p className="text-xs text-muted line-clamp-3 mb-2">{m.body}</p>
              <div className="flex items-center justify-between text-[11px] text-muted-2">
                <span>{m.usageCount} use{m.usageCount === 1 ? "" : "s"}</span>
                {m.resolves && <span className="text-emerald-600">auto-resolves</span>}
              </div>
            </article>
          ))}
        </div>
      )}

      {showNew && (
        <MacroModal
          onClose={() => setShowNew(false)}
          onCreated={() => { setShowNew(false); refresh(); }}
        />
      )}
    </BoardShell>
  );
}
