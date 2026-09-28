"use client";

// My review (spec-teams-performance /reviews/[id], the subject's section):
// what the system already knows, your goals, a rating and a note per KRA,
// your reflection. Autosaves per field (AutosaveIndicator in the card
// header, keepalive plus retry, a local backup under the person's own
// review-self key, lib/people/draft-keys.ts);
// "Submit my review" is the page's blue button, handed up through
// onPrimary. Once submitted it is read only; once the cycle is completed a
// "Your result" card shows the band, the manager's comments, the outcome and
// the appraisal letter.

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { OsEmptyView } from "@/components/layout/os/empty-view";
import { useOsToast } from "@/components/layout/os/toast";
import { AutosaveIndicator } from "@/components/ui/autosave-indicator";
import { SkeletonLines } from "@/components/ui/skeleton";
import { useConfirm } from "@/components/ui/dialog-provider";
import { ReviewFormCard } from "@/components/performance/review-form-card";
import { PerformanceBandChip } from "@/components/performance/performance-band-chip";
import { useAutosave, readAutosaveBackup, clearAutosaveBackup } from "@/hooks/use-autosave";
import { apiFetch, apiFetchWithRetry } from "@/lib/api-fetch";
import { formatDate } from "@/lib/format/date";
import { useDatePrefs } from "@/lib/format/use-date-prefs";
import { outcomeLabel } from "@/lib/performance/review-cycle";
import { useBoot } from "@/components/layout/os/boot-context";
import { draftKey, dropLegacyDraft } from "@/lib/people/draft-keys";
import type { Band, PanelPrimary, Reflection, ReviewRow, SelfKraRating } from "./cycle-types";

type SelfData = {
  review: ReviewRow & { updatedAt?: string };
  metrics: { avgKpiScore: number | null; avgSopScore: number | null; okrAvgProgress: number | null; okrs?: Array<{ id: string; title: string; progress: number }> };
  kraAssignments?: Array<{ weightage?: number | null; kra: { id: string; name: string; weight?: number | null } }>;
};
type Draft = { kraRatings: Record<string, { rating: number | null; achievements: string }>; reflection: { wentWell: string; couldImprove: string; goals: string } };

function Card({ title, hint, right, children }: { title: string; hint?: string; right?: React.ReactNode; children: React.ReactNode }) {
  return (
    <section className="rounded-lg border border-line bg-raised p-6">
      <header className="mb-4 flex items-start gap-3">
        <div className="min-w-0 flex-1">
          <h2 className="m-0 text-lg font-semibold text-ink">{title}</h2>
          {hint ? <p className="m-0 mt-0.5 text-sm text-ink-2">{hint}</p> : null}
        </div>
        {right}
      </header>
      {children}
    </section>
  );
}

export function MyReviewPanel({
  cycleId,
  cycleStatus,
  cycleEnd,
  words,
  bands,
  onPrimary,
  onChanged,
  onOpenLetter,
}: {
  cycleId: string;
  cycleStatus: string;
  cycleEnd: string;
  words: string[];
  bands: Band[];
  onPrimary: (p: PanelPrimary) => void;
  onChanged: () => void;
  onOpenLetter: (reviewId: string) => void;
}) {
  const { toast } = useOsToast();
  const confirm = useConfirm();
  const datePrefs = useDatePrefs();
  // A cycle's start and close are calendar days, stored at midnight UTC:
  // read them as days, never shifted a day by the viewer's time zone.
  const dayPrefs = { ...datePrefs, timezone: "UTC" };
  const [data, setData] = useState<SelfData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [draft, setDraft] = useState<Draft>({ kraRatings: {}, reflection: { wentWell: "", couldImprove: "", goals: "" } });
  const [loaded, setLoaded] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const viewerId = (useBoot().boot?.viewer as { id?: string } | undefined)?.id ?? "anon";
  const localKey = draftKey("review-self:", viewerId, cycleId);
  useEffect(() => { dropLegacyDraft("review-self:", cycleId); }, [cycleId]);
  const [backup, setBackup] = useState<{ at: number; data: Draft } | null>(null);
  // The server stopped taking this review while the person typed (submitted
  // in another tab, or the cycle moved to calibration or was cancelled): the
  // autosave stops, the text on screen stays, the local backup is KEPT, and
  // the person is told. It never reloads the server copy over their words.
  const [locked, setLocked] = useState<string | null>(null);
  // Stored ratings for a KRA no longer assigned are carried through every
  // save, so removing an assignment mid-cycle never drops what was written.
  const storedRef = useRef<SelfKraRating[]>([]);

  const load = useCallback(async () => {
    const r = await apiFetch<SelfData>(`/api/reviews/${cycleId}/self-assessment`, { cache: "no-store" });
    if (!r.ok) { setError(r.error || "Couldn't load your review"); return; }
    setError(null);
    setData(r.data);
    const sr = r.data.review.selfRatings;
    storedRef.current = (sr?.kraRatings ?? []) as SelfKraRating[];
    const ratings: Draft["kraRatings"] = {};
    for (const k of sr?.kraRatings ?? []) ratings[k.kraId] = { rating: k.rating ?? null, achievements: k.achievements ?? "" };
    const ref: Reflection = sr?.reflection ?? {};
    setDraft({ kraRatings: ratings, reflection: { wentWell: ref.wentWell ?? "", couldImprove: ref.couldImprove ?? "", goals: ref.goals ?? "" } });
    setLoaded(true);
    // A backup newer than the server copy (a tab closed mid-save, a session
    // that expired) is offered back, never silently dropped.
    const b = readAutosaveBackup<Draft>(localKey);
    const serverAt = r.data.review.updatedAt ? new Date(r.data.review.updatedAt).getTime() : 0;
    if (b && b.at > serverAt + 2000 && r.data.review.status === "PENDING") setBackup(b);
  }, [cycleId, localKey, setDraft, setBackup]);
  useEffect(() => {
    const t = setTimeout(() => { void load(); }, 0);
    return () => clearTimeout(t);
  }, [load]);

  const review = data?.review ?? null;
  const writable = !!review && review.status === "PENDING" && cycleStatus === "ACTIVE" && !locked;
  const kras = useMemo(() => (data?.kraAssignments ?? []).map((a) => ({ id: a.kra.id, name: a.kra.name, weight: a.weightage || a.kra.weight || null })), [data]);

  const body = useCallback((d: Draft) => {
    const current = new Set(kras.map((k) => k.id));
    return {
      kraRatings: [
        ...kras.map((k) => ({ kraId: k.id, kraName: k.name, rating: d.kraRatings[k.id]?.rating ?? null, achievements: d.kraRatings[k.id]?.achievements ?? "" })),
        ...storedRef.current.filter((k) => k.kraId && !current.has(k.kraId)),
      ] as SelfKraRating[],
      reflection: d.reflection,
    };
  }, [kras]);

  const autosave = useAutosave({
    snapshot: draft,
    enabled: writable && loaded,
    delay: 1200,
    localKey,
    save: async (snap) => {
      const r = await apiFetchWithRetry(`/api/reviews/${cycleId}/self-assessment`, { method: "PATCH", keepalive: true, json: { selfRatings: body(snap), submit: false, allowEmpty: true } }, { retryWrites: true });
      // A 409: submitted elsewhere, or the cycle no longer takes self
      // reviews. Throwing keeps the local backup (a resolved save removes
      // it); `locked` stops the autosave and says so.
      if (!r.ok && r.status === 409) {
        setLocked(r.error || "This review no longer takes changes");
        throw new Error("locked");
      }
      if (!r.ok) throw new Error(r.error || `HTTP ${r.status}`);
    },
  });

  const gap = kras.filter((k) => !draft.kraRatings[k.id]?.rating).length;
  const submit = useCallback(async () => {
    if (gap > 0) {
      setSubmitError(`Rate every KRA first (${gap} left).`);
      document.querySelector<HTMLElement>("[data-kra-card]")?.scrollIntoView({ block: "center", behavior: "smooth" });
      return;
    }
    const ok = await confirm({ title: "Submit your review?", description: "Your manager can read it once you submit, and you can no longer change it.", confirmLabel: "Submit", destructive: false });
    if (!ok) return;
    setSubmitting(true);
    setSubmitError(null);
    const r = await apiFetchWithRetry(`/api/reviews/${cycleId}/self-assessment`, { method: "PATCH", keepalive: true, json: { selfRatings: body(draft), submit: true } }, { retryWrites: true });
    setSubmitting(false);
    if (!r.ok) { setSubmitError(r.error ? `Not submitted: ${r.error}` : "Not submitted. Your answers are kept, try again."); return; }
    clearAutosaveBackup(localKey);
    toast("Your review is submitted");
    await load();
    onChanged();
  }, [gap, confirm, cycleId, body, draft, localKey, toast, load, onChanged]);

  // The title row's blue button calls the latest submit through a ref, so the
  // primary handed up changes only when what it shows changes (never on
  // every keystroke, which would re-render the page in a loop).
  const submitRef = useRef(submit);
  useEffect(() => { submitRef.current = submit; }, [submit]);
  const gapTitle = gap > 0 ? "Rate every KRA first" : undefined;
  useEffect(() => {
    onPrimary(writable ? { label: "Submit my review", onClick: () => void submitRef.current(), busy: submitting, title: gapTitle } : null);
  }, [writable, submitting, gapTitle, onPrimary]);
  useEffect(() => () => onPrimary(null), [onPrimary]);

  if (error && !data) return <OsEmptyView variant="error" title="Couldn't load your review" hint={error} action={{ label: "Try again", onClick: () => void load() }} />;
  if (!data || !review) return <div className="flex flex-col gap-6">{[0, 1, 2, 3].map((i) => <div key={i} className="rounded-lg border border-line p-6"><SkeletonLines lines={4} /></div>)}</div>;

  const m = data.metrics;
  const fact = (label: string, value: number | null, href: string, source: string) => (
    <li className="flex items-center gap-3 py-2">
      <span className="min-w-0 flex-1">
        <Link href={href} className="block text-row text-ink hover:underline">{label}</Link>
        <span className="block text-sm text-ink-2">{source}</span>
      </span>
      <span className={value == null ? "text-row text-ink-3" : "text-row font-medium tabular-nums text-ink"}>{value == null ? "Not enough data yet" : `${value}%`}</span>
    </li>
  );
  const windowNote = `From your records for this cycle, to ${formatDate(cycleEnd, dayPrefs, "date")}`;
  const reflection = draft.reflection;
  const setReflection = (k: keyof Draft["reflection"], v: string) => setDraft((d) => ({ ...d, reflection: { ...d.reflection, [k]: v } }));
  const done = review.status !== "PENDING";
  const completed = review.status === "COMPLETED";
  const score = review.overallScore ?? review.calibratedScore ?? null;

  return (
    <div className="flex flex-col gap-6">
      {backup && writable ? (
        <div role="status" className="flex min-h-11 flex-wrap items-center gap-3 rounded-lg border border-line bg-subtle px-4 text-sm text-ink">
          <span className="min-w-0 flex-1">You have answers from {formatDate(backup.at, datePrefs, "datetime")} that were not saved.</span>
          <button type="button" className="font-medium text-brand-deep hover:underline" onClick={() => { setDraft(backup.data); setBackup(null); }}>Restore</button>
          <button type="button" className="font-medium text-ink-2 hover:text-ink" onClick={() => { clearAutosaveBackup(localKey); setBackup(null); }}>Discard</button>
        </div>
      ) : null}
      {done ? (
        <p className="m-0 text-sm text-ink-2">{review.submittedAt ? `Submitted ${formatDate(review.submittedAt, datePrefs, "date")}.` : "Submitted."} {completed ? "" : "Your result appears here when the cycle is finalized."}</p>
      ) : cycleStatus !== "ACTIVE" ? (
        <p className="m-0 text-sm text-ink-2">This cycle no longer takes self reviews.</p>
      ) : (
        <p className="m-0 text-sm text-ink-2">Your review saves as you go. Submit it when every KRA is rated.</p>
      )}
      {submitError ? <p role="alert" className="m-0 text-sm text-danger-text">{submitError}</p> : null}
      {locked ? (
        <div role="alert" className="flex min-h-11 flex-wrap items-center gap-3 rounded-lg border border-line bg-subtle px-4 py-2 text-sm text-danger-text">
          <span className="min-w-0 flex-1">Not saved: {locked}. What you typed is still on screen and kept on this device.</span>
          <button type="button" className="font-medium text-brand-deep hover:underline" onClick={() => { setLocked(null); void load(); onChanged(); }}>Show the saved review</button>
        </div>
      ) : null}

      <Card title="What the system already knows" hint="Read only. Each number opens where it comes from.">
        <ul className="m-0 list-none divide-y divide-line-soft p-0">
          {fact("Average KPI score", m.avgKpiScore, "/kra-kpi", windowNote)}
          {fact("SOP compliance", m.avgSopScore, "/sops/my-sops", windowNote)}
          {fact("Goal progress", m.okrAvgProgress, "/okrs", "Across the goals you own")}
        </ul>
      </Card>

      <Card title="Your goals this period">
        {m.okrs?.length ? (
          <ul className="m-0 list-none divide-y divide-line-soft p-0">
            {m.okrs.map((o) => (
              <li key={o.id} className="flex items-center gap-3 py-2">
                <Link href={`/okrs/${o.id}`} className="min-w-0 flex-1 truncate text-row text-ink hover:underline">{o.title}</Link>
                <span className="h-1 w-24 overflow-hidden rounded-full bg-subtle" aria-hidden><span className="block h-full rounded-full bg-brand" style={{ width: `${Math.max(0, Math.min(100, o.progress ?? 0))}%` }} /></span>
                <span className="w-10 text-end text-sm tabular-nums text-ink-2">{Math.round(o.progress ?? 0)}%</span>
              </li>
            ))}
          </ul>
        ) : <p className="m-0 text-row text-ink-3">You own no goals yet.</p>}
      </Card>

      <Card
        title="Rate your KRAs"
        hint={`1 to 5: ${words.join(", ")}.`}
        right={writable ? <AutosaveIndicator status={autosave.status} lastSavedAt={autosave.lastSavedAt} onRetry={autosave.retriesExhausted ? autosave.retryNow : undefined} /> : null}
      >
        <div data-kra-card="">
          {kras.length ? kras.map((k) => (
            <ReviewFormCard
              key={k.id}
              kra={k}
              rating={draft.kraRatings[k.id]?.rating ?? null}
              comment={draft.kraRatings[k.id]?.achievements ?? ""}
              anchors={words}
              readOnly={!writable}
              onChange={(v) => setDraft((d) => ({ ...d, kraRatings: { ...d.kraRatings, [k.id]: { rating: v.rating, achievements: v.comment } } }))}
            />
          )) : <p className="m-0 text-row text-ink-3">No KRAs are assigned to you, so there is nothing to rate. Your reflection still counts.</p>}
        </div>
      </Card>

      <Card title="Your reflection">
        <div className="flex flex-col gap-4">
          {([
            ["wentWell", "What went well"],
            ["couldImprove", "What could have gone better"],
            ["goals", "What you want next period"],
          ] as const).map(([k, label]) => (
            <label key={k} className="flex flex-col gap-1">
              <span className="text-sm font-medium text-ink">{label}</span>
              {writable ? (
                <textarea value={reflection[k]} onChange={(e) => setReflection(k, e.target.value)} rows={3} maxLength={10_000}
                  className="min-h-[76px] w-full resize-y rounded-md border border-line bg-raised px-3 py-2 text-row text-ink outline-none focus-visible:border-[var(--os-focus)]" />
              ) : (
                <p className="m-0 whitespace-pre-wrap text-row text-ink">{reflection[k] || <span className="text-ink-3">Nothing written</span>}</p>
              )}
            </label>
          ))}
        </div>
      </Card>

      {completed ? (
        <Card title="Your result">
          <div className="flex flex-col gap-3">
            <div className="flex flex-wrap items-center gap-3">
              <span className="text-xl font-semibold tabular-nums text-ink">{score != null ? Math.round(score) : ""}</span>
              <PerformanceBandChip score={score} bands={bands} />
              {review.outcome ? <span className="inline-flex h-[26px] items-center rounded-md border border-line bg-subtle px-2 text-xs font-medium text-ink">{outcomeLabel(review.outcome)}</span> : null}
            </div>
            {review.managerComments ? (
              <div className="flex flex-col gap-1">
                <span className="text-sm font-medium text-ink-2">Your manager&apos;s comments</span>
                <p className="m-0 whitespace-pre-wrap text-row text-ink">{review.managerComments}</p>
              </div>
            ) : null}
            {review.peerSummary ? (
              <p className="m-0 text-sm text-ink-2">
                {review.peerSummary.belowFloor
                  ? `Peer feedback: shown once 4 people have answered (${review.peerSummary.submitted} so far).`
                  : `Peer feedback: ${review.peerSummary.averageRating ?? ""} of 5 on average, from ${review.peerSummary.submitted} people.`}
              </p>
            ) : null}
            <div>
              <button type="button" onClick={() => onOpenLetter(review.id)} className="inline-flex h-9 items-center rounded-md px-3 text-sm font-medium text-ink-2 hover:bg-hover hover:text-ink">
                Download appraisal letter
              </button>
            </div>
          </div>
        </Card>
      ) : null}
    </div>
  );
}
