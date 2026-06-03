"use client";

// TeamReviewsClient — list of submitted reviews + a smaller "recently
// acted" history. Each pending card expands to show the IC's body
// (KPI snapshots, KRA progress, narratives) and exposes Approve /
// Request-changes actions.

import { useCallback, useState } from "react";
import { useRouter } from "next/navigation";
import {
  Check, X, ChevronDown, ChevronRight, MessageSquareWarning, CheckCircle2,
} from "lucide-react";
import type { ManagerReviewQueueItem } from "@/lib/weekly-review";
import { formatWeekRange } from "@/lib/weekly-review";

interface Props {
  pending: ManagerReviewQueueItem[];
  acted: ManagerReviewQueueItem[];
}

export function TeamReviewsClient({ pending, acted }: Props) {
  const router = useRouter();
  const [openId, setOpenId] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [localPending, setLocalPending] = useState(pending);
  const [localActed, setLocalActed] = useState(acted);

  const act = useCallback(async (
    id: string,
    action: "approve" | "request_changes",
    notes?: string,
  ) => {
    setBusyId(id);
    setError(null);
    try {
      const res = await fetch(`/api/weekly-reviews/${id}/manager-review`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ action, notes }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(data?.error ?? "Failed to save");
        return;
      }
      // Move from pending → acted locally.
      const moved = localPending.find((r) => r.id === id);
      if (moved) {
        const next: ManagerReviewQueueItem = {
          ...moved,
          status: "ACKNOWLEDGED",
          managerStatus: action === "approve" ? "APPROVED" : "CHANGES_REQUESTED",
          managerNotes: notes ?? null,
          reviewedAt: new Date(),
        };
        setLocalPending((prev) => prev.filter((r) => r.id !== id));
        setLocalActed((prev) => [next, ...prev]);
      }
      setOpenId(null);
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to save");
    } finally {
      setBusyId(null);
    }
  }, [localPending, router]);

  return (
    <div className="space-y-8">
      {error ? (
        <div className="text-xs text-red-500 bg-red-500/10 rounded-md px-3 py-2 flex items-center justify-between">
          {error}
          <button onClick={() => setError(null)} className="text-muted hover:text-foreground">
            <X className="w-3 h-3" />
          </button>
        </div>
      ) : null}

      <section>
        <h2 className="text-xs uppercase tracking-wide text-muted mb-2">
          Awaiting your review · {localPending.length}
        </h2>
        {localPending.length === 0 ? (
          <div className="rounded-lg border border-border bg-surface px-6 py-8 text-center">
            <CheckCircle2 className="w-6 h-6 mx-auto text-emerald-600 mb-2" />
            <div className="text-sm font-medium">Inbox zero.</div>
            <div className="text-xs text-muted mt-1">Nothing waiting for you right now.</div>
          </div>
        ) : (
          <ul className="space-y-2">
            {localPending.map((r) => (
              <li key={r.id}>
                <PendingCard
                  review={r}
                  open={openId === r.id}
                  busy={busyId === r.id}
                  onToggle={() => setOpenId((prev) => (prev === r.id ? null : r.id))}
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
          <h2 className="text-xs uppercase tracking-wide text-muted mb-2">Recently acted</h2>
          <ul className="space-y-1.5">
            {localActed.map((r) => (
              <li key={r.id}>
                <ActedCard review={r} />
              </li>
            ))}
          </ul>
        </section>
      ) : null}
    </div>
  );
}

function PendingCard({
  review,
  open,
  busy,
  onToggle,
  onApprove,
  onRequestChanges,
}: {
  review: ManagerReviewQueueItem;
  open: boolean;
  busy: boolean;
  onToggle: () => void;
  onApprove: (notes?: string) => void;
  onRequestChanges: (notes?: string) => void;
}) {
  const subjectName = review.subject ? `${review.subject.firstName} ${review.subject.lastName}` : "Someone";
  const initials = `${review.subject?.firstName?.[0] ?? ""}${review.subject?.lastName?.[0] ?? ""}`.toUpperCase() || "?";
  const [notes, setNotes] = useState("");

  return (
    <article className="rounded-lg border border-border bg-surface">
      <button
        type="button"
        onClick={onToggle}
        className="w-full flex items-center gap-3 px-4 py-3 text-left hover:bg-surface-2"
      >
        <span className="inline-flex items-center justify-center w-8 h-8 rounded-full bg-surface-3 text-sm font-medium">
          {initials}
        </span>
        <div className="flex-1 min-w-0">
          <div className="text-sm font-medium truncate">{subjectName}</div>
          <div className="text-xs text-muted">
            {formatWeekRange(review.periodStart)} · submitted{" "}
            {review.submittedAt ? new Date(review.submittedAt).toLocaleDateString() : "recently"}
          </div>
        </div>
        {open ? <ChevronDown className="w-4 h-4 text-muted" /> : <ChevronRight className="w-4 h-4 text-muted" />}
      </button>

      {open ? (
        <div className="px-4 py-3 border-t border-border space-y-4">
          <Section title="KRA progress">
            {review.kraProgress.length === 0 ? (
              <Empty />
            ) : (
              <ul className="space-y-1.5">
                {review.kraProgress.map((kp) => (
                  <li key={kp.kraId} className="text-sm">
                    <div className="flex items-center gap-2">
                      <span className="text-xs text-muted w-12">{kp.progressPct}%</span>
                      <span className="flex-1 truncate font-mono text-[11px] text-muted">{kp.kraId}</span>
                    </div>
                    {kp.note ? <div className="text-[11px] text-muted ml-12">{kp.note}</div> : null}
                  </li>
                ))}
              </ul>
            )}
          </Section>

          <Section title="KPI snapshots">
            {review.kpiSnapshots.length === 0 ? (
              <Empty />
            ) : (
              <ul className="space-y-1">
                {review.kpiSnapshots.map((k) => (
                  <li key={k.kpiId} className="text-sm flex items-center gap-2">
                    <span className="font-mono text-[11px] text-muted flex-1 truncate">{k.kpiId}</span>
                    <span>{k.value ?? "—"}</span>
                  </li>
                ))}
              </ul>
            )}
          </Section>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
            <Narrative label="Highlights" body={review.highlights} />
            <Narrative label="Blockers" body={review.blockers} />
            <Narrative label="Plan" body={review.plan} />
          </div>

          <div className="border-t border-border pt-3 space-y-2">
            <label className="text-xs font-medium block">Notes to {review.subject?.firstName ?? "report"} <span className="text-muted">(optional, sent with your decision)</span></label>
            <textarea
              rows={2}
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              className="w-full px-3 py-2 rounded-md border border-border bg-surface text-sm resize-y focus:outline-none focus:border-[var(--os-brand)]"
            />
            <div className="flex items-center gap-2 pt-1">
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
        </div>
      ) : null}
    </article>
  );
}

function ActedCard({ review }: { review: ManagerReviewQueueItem }) {
  const subjectName = review.subject ? `${review.subject.firstName} ${review.subject.lastName}` : "Someone";
  const approved = review.managerStatus === "APPROVED";
  return (
    <div className={`px-4 py-2.5 rounded-md border ${
      approved ? "border-emerald-500/30 bg-emerald-500/5" : "border-red-500/30 bg-red-500/5"
    }`}>
      <div className="flex items-center gap-2 text-sm">
        <span className="font-medium flex-1 truncate">{subjectName}</span>
        <span className="text-xs text-muted">{formatWeekRange(review.periodStart)}</span>
        <span className={`text-[10px] uppercase tracking-wide px-1.5 py-0.5 rounded ${
          approved ? "bg-emerald-500/15 text-emerald-700" : "bg-red-500/15 text-red-700"
        }`}>
          {approved ? "Approved" : "Changes"}
        </span>
      </div>
      {review.managerNotes ? (
        <div className="text-xs text-muted mt-1 whitespace-pre-wrap">{review.managerNotes}</div>
      ) : null}
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div>
      <h3 className="text-[11px] uppercase tracking-wide text-muted mb-1.5">{title}</h3>
      {children}
    </div>
  );
}

function Empty() {
  return <div className="text-xs text-muted">—</div>;
}

function Narrative({ label, body }: { label: string; body: string | null }) {
  return (
    <div className="rounded-md border border-border bg-surface-2 px-3 py-2">
      <div className="text-[11px] text-muted">{label}</div>
      <div className="text-sm whitespace-pre-wrap break-words mt-1">{body || <span className="text-muted">—</span>}</div>
    </div>
  );
}
