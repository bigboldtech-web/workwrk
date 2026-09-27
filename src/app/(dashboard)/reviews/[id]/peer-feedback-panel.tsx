"use client";

// Peer feedback (spec-teams-performance /reviews/[id]): "You were asked to
// give feedback on 3 people", one card each: a collaboration rating, what
// they do well, what would help them, and Send feedback. A person asked for
// peer feedback holds COMMENT on their own form and nothing else in the
// cycle, so this is all a peer sees. What they type is kept on this device
// until it is sent (workwrk:peer-feedback:{id}), and a send is keepalive
// plus retry: a half-written answer is never lost to a closed tab.

import { useCallback, useEffect, useState } from "react";
import { Check } from "lucide-react";
import { OsEmptyView } from "@/components/layout/os/empty-view";
import { useOsToast } from "@/components/layout/os/toast";
import { SkeletonLines } from "@/components/ui/skeleton";
import { AnonymityNote } from "@/components/culture/anonymity-note";
import { PersonAvatar, personName } from "@/components/people/person-bits";
import { RatingScale } from "@/components/performance/rating-scale";
import { apiFetch, apiFetchWithRetry } from "@/lib/api-fetch";
import type { PeerFeedbackRow } from "./cycle-types";

type Draft = { rating: number | null; strengths: string; improvements: string };
const key = (id: string) => `workwrk:peer-feedback:${id}`;
function readDraft(id: string): Draft | null {
  try { const raw = window.localStorage.getItem(key(id)); return raw ? (JSON.parse(raw) as Draft) : null; } catch { return null; }
}
function writeDraft(id: string, d: Draft | null) {
  try { if (d) window.localStorage.setItem(key(id), JSON.stringify(d)); else window.localStorage.removeItem(key(id)); } catch { /* private mode: kept in memory only */ }
}

function PeerCard({ cycleId, row, words, open, onSent }: { cycleId: string; row: PeerFeedbackRow; words: string[]; open: boolean; onSent: () => void }) {
  const { toast } = useOsToast();
  const sent = row.status === "SUBMITTED";
  const [d, setD] = useState<Draft>(() => (typeof window !== "undefined" ? readDraft(row.id) : null) ?? { rating: row.collaborationRating ?? null, strengths: row.strengths ?? "", improvements: row.improvements ?? "" });
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const set = (patch: Partial<Draft>) => setD((cur) => { const next = { ...cur, ...patch }; writeDraft(row.id, next); return next; });
  const person = row.receiver;
  const name = person ? personName(person) : "Someone";

  const send = async () => {
    if (!d.rating) { setErr("Rate how they collaborate first."); return; }
    setBusy(true);
    setErr(null);
    const r = await apiFetchWithRetry(`/api/reviews/${cycleId}/peer-feedback`, {
      method: "PATCH",
      keepalive: true,
      json: { feedbackId: row.id, collaborationRating: d.rating, strengths: d.strengths, improvements: d.improvements },
    }, { retryWrites: true });
    setBusy(false);
    if (!r.ok) { setErr(r.error ? `Not sent: ${r.error}` : "Not sent. Your answers are kept, try again."); return; }
    writeDraft(row.id, null);
    toast(`Feedback on ${name} sent`);
    onSent();
  };

  return (
    <section className="rounded-lg border border-line bg-raised p-6">
      <header className="mb-4 flex items-center gap-2">
        {person ? <PersonAvatar person={person} size={28} /> : null}
        <h2 className="m-0 min-w-0 flex-1 truncate text-lg font-semibold text-ink">{name}</h2>
        {sent ? <span className="inline-flex items-center gap-1 text-sm font-medium text-success-text"><Check className="h-4 w-4" aria-hidden />Sent</span> : null}
      </header>
      {sent ? (
        <p className="m-0 text-sm text-ink-2">Thanks. Your feedback is in, and it cannot be changed now.</p>
      ) : !open ? (
        <p className="m-0 text-sm text-ink-2">This cycle no longer takes feedback.</p>
      ) : (
        <div className="flex flex-col gap-4">
          <div className="flex flex-col gap-1">
            <span className="text-sm font-medium text-ink">How do they collaborate?</span>
            <RatingScale name={`peer-${row.id}`} ariaLabel={`How ${name} collaborates`} value={d.rating} labels={words} onChange={(n) => set({ rating: n })} />
          </div>
          <label className="flex flex-col gap-1">
            <span className="text-sm font-medium text-ink">What they do well</span>
            <textarea value={d.strengths} onChange={(e) => set({ strengths: e.target.value })} rows={3} maxLength={10_000}
              className="min-h-[76px] w-full resize-y rounded-md border border-line bg-raised px-3 py-2 text-row text-ink outline-none focus-visible:border-[var(--os-focus)]" />
          </label>
          <label className="flex flex-col gap-1">
            <span className="text-sm font-medium text-ink">What would help them</span>
            <textarea value={d.improvements} onChange={(e) => set({ improvements: e.target.value })} rows={3} maxLength={10_000}
              className="min-h-[76px] w-full resize-y rounded-md border border-line bg-raised px-3 py-2 text-row text-ink outline-none focus-visible:border-[var(--os-focus)]" />
          </label>
          {err ? <p role="alert" className="m-0 text-sm text-danger-text">{err}</p> : null}
          <div className="flex justify-end">
            <button type="button" disabled={busy} onClick={() => void send()} className="inline-flex h-9 items-center rounded-md border border-line bg-raised px-4 text-sm font-medium text-ink hover:bg-hover disabled:opacity-60">
              {busy ? "Sending" : "Send feedback"}
            </button>
          </div>
        </div>
      )}
    </section>
  );
}

export function PeerFeedbackPanel({ cycleId, cycleStatus, words }: { cycleId: string; cycleStatus: string; words: string[] }) {
  const [rows, setRows] = useState<PeerFeedbackRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const load = useCallback(async () => {
    const r = await apiFetch<PeerFeedbackRow[]>(`/api/reviews/${cycleId}/peer-feedback`, { cache: "no-store" });
    if (!r.ok) { setError(r.error || "Couldn't load your feedback requests"); return; }
    setError(null);
    setRows(Array.isArray(r.data) ? r.data : []);
  }, [cycleId]);
  useEffect(() => {
    const t = setTimeout(() => { void load(); }, 0);
    return () => clearTimeout(t);
  }, [load]);

  if (error && !rows) return <OsEmptyView variant="error" title="Couldn't load your feedback requests" hint={error} action={{ label: "Try again", onClick: () => void load() }} />;
  if (!rows) return <div className="rounded-lg border border-line p-6"><SkeletonLines lines={5} /></div>;
  const mine = rows.filter((r) => r.receiver);
  const open = cycleStatus === "ACTIVE" || cycleStatus === "IN_CALIBRATION";
  const firstName = mine.length === 1 && mine[0].receiver ? mine[0].receiver.firstName : "them";
  return (
    <div className="flex flex-col gap-4">
      <p className="m-0 text-row text-ink">You were asked to give feedback on {mine.length} {mine.length === 1 ? "person" : "people"}.</p>
      <AnonymityNote mode="peer" subject={mine.length === 1 ? firstName : undefined} />
      {mine.map((r) => <PeerCard key={r.id} cycleId={cycleId} row={r} words={words} open={open} onSent={() => void load()} />)}
    </div>
  );
}
