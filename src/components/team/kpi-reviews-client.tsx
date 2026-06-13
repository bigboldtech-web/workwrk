"use client";

// KpiReviewsClient — manager queue for submitted KPI scores. Mirrors
// TeamReviewsClient: "Awaiting your approval" cards with inline Approve /
// Request-changes (PATCH /api/kpi-records/[id]/manager-review), plus a
// "Recently acted" history. Optimistic move from pending → acted.

import { useCallback, useState } from "react";
import { useRouter } from "next/navigation";
import { Check, X, MessageSquareWarning, CheckCircle2 } from "lucide-react";
import type { KpiReviewQueueItem } from "@/lib/kpi-record";

interface Props {
  pending: KpiReviewQueueItem[];
  acted: KpiReviewQueueItem[];
}

const nameOf = (s: KpiReviewQueueItem["subject"]) =>
  s ? `${s.firstName ?? ""} ${s.lastName ?? ""}`.trim() || "Someone" : "Someone";

export function KpiReviewsClient({ pending, acted }: Props) {
  const router = useRouter();
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [localPending, setLocalPending] = useState(pending);
  const [localActed, setLocalActed] = useState(acted);

  const act = useCallback(
    async (id: string, action: "approve" | "request_changes", notes?: string) => {
      setBusyId(id);
      setError(null);
      try {
        const res = await fetch(`/api/kpi-records/${id}/manager-review`, {
          method: "PATCH",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ action, notes }),
        });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) {
          setError(data?.error ?? "Failed to save");
          return;
        }
        const moved = localPending.find((r) => r.id === id);
        if (moved) {
          const next: KpiReviewQueueItem = {
            ...moved,
            status: action === "approve" ? "APPROVED" : "REJECTED",
            managerNotes: notes ?? null,
          };
          setLocalPending((prev) => prev.filter((r) => r.id !== id));
          setLocalActed((prev) => [next, ...prev]);
        }
        router.refresh();
      } catch (e) {
        setError(e instanceof Error ? e.message : "Failed to save");
      } finally {
        setBusyId(null);
      }
    },
    [localPending, router],
  );

  return (
    <div className="space-y-8">
      {error ? (
        <div className="text-xs text-red-500 bg-red-500/10 rounded-md px-3 py-2 flex items-center justify-between">
          {error}
          <button onClick={() => setError(null)} className="text-zinc-500 hover:text-zinc-900">
            <X className="w-3 h-3" />
          </button>
        </div>
      ) : null}

      <section>
        <h2 className="text-xs uppercase tracking-wide text-zinc-500 mb-2">
          Awaiting your approval · {localPending.length}
        </h2>
        {localPending.length === 0 ? (
          <div className="rounded-lg border border-zinc-200 bg-white px-6 py-8 text-center">
            <CheckCircle2 className="w-6 h-6 mx-auto text-emerald-600 mb-2" />
            <div className="text-sm font-medium">Inbox zero.</div>
            <div className="text-xs text-zinc-500 mt-1">No KPI scores waiting for your approval.</div>
          </div>
        ) : (
          <ul className="space-y-2">
            {localPending.map((r) => (
              <li key={r.id}>
                <PendingKpiCard
                  item={r}
                  busy={busyId === r.id}
                  onApprove={(notes) => act(r.id, "approve", notes)}
                  onRequestChanges={(notes) => act(r.id, "request_changes", notes)}
                />
              </li>
            ))}
          </ul>
        )}
      </section>

      {localActed.length > 0 ? (
        <section>
          <h2 className="text-xs uppercase tracking-wide text-zinc-500 mb-2">Recently acted</h2>
          <ul className="space-y-1.5">
            {localActed.map((r) => (
              <li key={r.id}>
                <ActedKpiCard item={r} />
              </li>
            ))}
          </ul>
        </section>
      ) : null}
    </div>
  );
}

function PendingKpiCard({
  item,
  busy,
  onApprove,
  onRequestChanges,
}: {
  item: KpiReviewQueueItem;
  busy: boolean;
  onApprove: (notes?: string) => void;
  onRequestChanges: (notes?: string) => void;
}) {
  const [notes, setNotes] = useState("");
  const initials =
    nameOf(item.subject).split(" ").map((p) => p[0]).join("").slice(0, 2).toUpperCase() || "?";
  const unit = item.kpi.unit ?? "";
  const fmt = (v: number | null) => (v == null ? "—" : `${v}${unit ? ` ${unit}` : ""}`);

  return (
    <article className="rounded-lg border border-zinc-200 bg-white px-4 py-3">
      <div className="flex items-center gap-3">
        <span className="inline-flex items-center justify-center w-8 h-8 rounded-full bg-zinc-100 text-sm font-medium shrink-0">
          {initials}
        </span>
        <div className="flex-1 min-w-0">
          <div className="text-sm font-medium truncate">{nameOf(item.subject)}</div>
          <div className="text-xs text-zinc-500 truncate">{item.kpi.name} · {item.period}</div>
        </div>
        <div className="text-right shrink-0">
          <div className="text-sm font-semibold tabular-nums">
            {item.score != null ? `${Math.round(item.score)}%` : "—"}
          </div>
          <div className="text-[11px] text-zinc-500 tabular-nums">
            {fmt(item.actualValue)} / {fmt(item.targetValue)}
          </div>
        </div>
      </div>

      {item.notes ? (
        <div className="mt-2 rounded-md border border-zinc-200 bg-zinc-50 px-3 py-2 text-sm whitespace-pre-wrap break-words">
          {item.notes}
        </div>
      ) : null}

      <div className="mt-3 space-y-2">
        <textarea
          rows={2}
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          placeholder={`Note to ${item.subject?.firstName ?? "report"} (optional, sent with your decision)`}
          className="w-full px-3 py-2 rounded-md border border-zinc-200 bg-white text-sm resize-y focus:outline-none focus:border-[var(--os-brand)]"
        />
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => onRequestChanges(notes.trim() || undefined)}
            disabled={busy}
            className="inline-flex items-center gap-1.5 h-9 px-3 rounded-md text-sm border border-red-500/40 text-red-700 hover:bg-red-500/10 disabled:opacity-50"
          >
            <MessageSquareWarning className="w-3.5 h-3.5" />
            {busy ? "Saving…" : "Request changes"}
          </button>
          <button
            type="button"
            onClick={() => onApprove(notes.trim() || undefined)}
            disabled={busy}
            className="ml-auto inline-flex items-center gap-1.5 h-9 px-4 rounded-md text-sm text-white bg-[var(--os-brand)] hover:bg-[var(--os-brand-hover)] disabled:opacity-50"
          >
            <Check className="w-3.5 h-3.5" />
            {busy ? "Saving…" : "Approve"}
          </button>
        </div>
      </div>
    </article>
  );
}

function ActedKpiCard({ item }: { item: KpiReviewQueueItem }) {
  const approved = item.status === "APPROVED";
  return (
    <div
      className={`px-4 py-2.5 rounded-md border ${
        approved ? "border-emerald-500/30 bg-emerald-500/5" : "border-red-500/30 bg-red-500/5"
      }`}
    >
      <div className="flex items-center gap-2 text-sm">
        <span className="font-medium truncate">{nameOf(item.subject)}</span>
        <span className="text-xs text-zinc-500 truncate flex-1">{item.kpi.name} · {item.period}</span>
        <span
          className={`text-[10px] uppercase tracking-wide px-1.5 py-0.5 rounded ${
            approved ? "bg-emerald-500/15 text-emerald-700" : "bg-red-500/15 text-red-700"
          }`}
        >
          {approved ? "Approved" : "Changes"}
        </span>
      </div>
      {item.managerNotes ? (
        <div className="text-xs text-zinc-500 mt-1 whitespace-pre-wrap">{item.managerNotes}</div>
      ) : null}
    </div>
  );
}
