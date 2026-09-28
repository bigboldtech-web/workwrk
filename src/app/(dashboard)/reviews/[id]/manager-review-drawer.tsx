"use client";

// The manager review drawer (spec-teams-performance /reviews/[id] Team,
// ?person={userId}): what the system knows about the person this cycle,
// their self review and peer feedback (collapsed), a rating and comment per
// KRA, the five behaviours on the org's scale words (Settings > Scoring and
// reviews > Behavioural anchors, or the built-in five), overall comments
// and the outcome (all five, Exit recommendation included). Autosaves with
// the AutosaveIndicator in the header (a local backup under the manager's own
// mgr-review key, offered back through a Restore banner when it is newer
// than the server copy);
// the footer's blue Submit manager review is the only blue on screen while
// the drawer is open. Someone who reads but does not write it (a manager
// higher in the chain, the People team) gets the same drawer read only.

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { ChevronDown, ChevronRight, Copy, Maximize2, Minimize2, X } from "lucide-react";
import { OsEmptyView } from "@/components/layout/os/empty-view";
import { useOsToast } from "@/components/layout/os/toast";
import { Drawer } from "@/components/ui/drawer";
import { AutosaveIndicator } from "@/components/ui/autosave-indicator";
import { SkeletonLines } from "@/components/ui/skeleton";
import { useConfirm } from "@/components/ui/dialog-provider";
import { PickerButton } from "@/components/dashboards/widget-registry";
import { PersonAvatar, personName } from "@/components/people/person-bits";
import { RatingScale } from "@/components/performance/rating-scale";
import { ReviewFormCard } from "@/components/performance/review-form-card";
import { useAutosave, readAutosaveBackup, clearAutosaveBackup } from "@/hooks/use-autosave";
import { useBoot } from "@/components/layout/os/boot-context";
import { draftKey, dropLegacyDraft } from "@/lib/people/draft-keys";
import { formatDate } from "@/lib/format/date";
import { useDatePrefs } from "@/lib/format/use-date-prefs";
import { apiFetch, apiFetchWithRetry } from "@/lib/api-fetch";
import { BEHAVIOURS, OUTCOMES, outcomeLabel, reviewStatusOf } from "@/lib/performance/review-cycle";
import type { PeerFeedbackRow, ReviewRow } from "./cycle-types";

type DrawerData = {
  review: ReviewRow & { updatedAt?: string; cycle: { id: string; name: string; status: string } };
  peerFeedback: PeerFeedbackRow[];
  peersAsked: number;
  kras: Array<{ id: string; name: string; weight: number | null }>;
  metrics: { avgKpiScore: number | null; avgSopScore: number | null; okrAvgProgress: number | null };
  scale: { words: string[]; fromSettings: boolean };
  canWrite: boolean;
};
type Form = {
  kras: Record<string, { rating: number | null; comments: string }>;
  behavioral: Record<string, number | null>;
  comments: string;
  outcome: string;
};

function Collapsible({ title, count, children }: { title: string; count?: string; children: React.ReactNode }) {
  const [open, setOpen] = useState(false);
  return (
    <section className="rounded-md border border-line">
      <button type="button" aria-expanded={open} onClick={() => setOpen((v) => !v)} className="flex h-9 w-full items-center gap-2 px-3 text-start text-sm font-medium text-ink hover:bg-hover">
        {open ? <ChevronDown className="h-4 w-4 text-ink-2" /> : <ChevronRight className="h-4 w-4 text-ink-2" />}
        <span className="flex-1">{title}</span>
        {count ? <span className="text-xs text-ink-2">{count}</span> : null}
      </button>
      {open ? <div className="flex flex-col gap-3 border-t border-line-soft px-3 py-3">{children}</div> : null}
    </section>
  );
}

export function ManagerReviewDrawer({
  cycleId,
  cycleName,
  subjectId,
  onClose,
  onSaved,
}: {
  cycleId: string;
  cycleName: string;
  subjectId: string;
  onClose: () => void;
  onSaved: () => void;
}) {
  const { toast } = useOsToast();
  const confirm = useConfirm();
  const [data, setData] = useState<DrawerData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [form, setForm] = useState<Form>({ kras: {}, behavioral: {}, comments: "", outcome: "" });
  const [loaded, setLoaded] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const datePrefs = useDatePrefs();
  const viewerId = (useBoot().boot?.viewer as { id?: string } | undefined)?.id ?? "anon";
  const [backup, setBackup] = useState<{ at: number; data: Form } | null>(null);
  // A 409 while typing (calibration started, the cycle closed): autosave
  // stops, the text stays on screen, the local backup is kept.
  const [locked, setLocked] = useState<string | null>(null);

  const load = useCallback(async () => {
    const r = await apiFetch<DrawerData>(`/api/reviews/${cycleId}/manager-review?subjectId=${encodeURIComponent(subjectId)}`, { cache: "no-store" });
    if (!r.ok) { setError(r.status === 404 ? "This review is not available to you." : r.error || "Couldn't load this review"); return; }
    setError(null);
    setData(r.data);
    const ma = r.data.review.managerAssessment ?? {};
    const kras: Form["kras"] = {};
    for (const k of ma.kraRatings ?? []) kras[k.kraId] = { rating: k.rating ?? null, comments: k.comments ?? "" };
    setForm({
      kras,
      behavioral: { ...(ma.behavioral ?? {}) },
      comments: r.data.review.managerComments ?? ma.overallComments ?? "",
      outcome: r.data.review.outcome ?? ma.recommendation ?? "",
    });
    setLoaded(true);
    // Unsaved changes from a closed drawer or a failed save are offered
    // back, never dropped: the promise the close confirm makes.
    dropLegacyDraft("mgr-review:", r.data.review.id);
    const b = readAutosaveBackup<Form>(draftKey("mgr-review:", viewerId, r.data.review.id));
    const serverAt = r.data.review.updatedAt ? new Date(r.data.review.updatedAt).getTime() : 0;
    setBackup(b && r.data.canWrite && b.at > serverAt + 2000 ? b : null);
  }, [cycleId, subjectId, viewerId]);
  useEffect(() => {
    const t = setTimeout(() => { void load(); }, 0);
    return () => clearTimeout(t);
  }, [load]);

  const canWrite = !!data?.canWrite && !locked;
  const reviewId = data?.review.id;
  const payload = useCallback((f: Form, submit: boolean) => ({
    reviewId,
    submit,
    managerComments: f.comments,
    outcome: f.outcome || undefined,
    managerAssessment: {
      kraRatings: (data?.kras ?? []).map((k) => ({ kraId: k.id, kraName: k.name, rating: f.kras[k.id]?.rating ?? null, comments: f.kras[k.id]?.comments ?? "" })),
      behavioral: Object.fromEntries(Object.entries(f.behavioral).filter(([, v]) => typeof v === "number")),
      overallComments: f.comments,
      recommendation: f.outcome,
    },
  }), [reviewId, data?.kras]);

  const autosave = useAutosave({
    snapshot: form,
    enabled: canWrite && loaded,
    delay: 1200,
    localKey: reviewId ? draftKey("mgr-review:", viewerId, reviewId) : undefined,
    save: async (snap) => {
      const r = await apiFetchWithRetry(`/api/reviews/${cycleId}/manager-review`, { method: "PATCH", keepalive: true, json: { ...payload(snap, false), allowEmpty: true } }, { retryWrites: true });
      // Throwing keeps the local backup (a resolved save removes it).
      if (!r.ok && r.status === 409) { setLocked(r.error || "This review no longer takes changes"); throw new Error("locked"); }
      if (!r.ok) throw new Error(r.error || `HTTP ${r.status}`);
    },
  });

  // Closing never loses typing: pending changes are flushed first, and a
  // save that is failing asks (the local backup keeps them either way).
  const { status: saveStatus, flushNow } = autosave;
  const close = useCallback(async () => {
    if (saveStatus === "error") {
      if (!(await confirm({ title: "Leave without saving?", description: "Your latest changes did not save yet. They are kept on this device, and you can restore them when you open this review again.", confirmLabel: "Leave", destructive: true }))) return;
    } else if (saveStatus === "dirty" || saveStatus === "saving") {
      await flushNow();
    }
    onSaved();
    onClose();
  }, [saveStatus, flushNow, confirm, onSaved, onClose]);

  const submit = async () => {
    if (!form.outcome) { setSubmitError("Pick an outcome before you submit."); return; }
    setSubmitting(true);
    setSubmitError(null);
    const r = await apiFetchWithRetry(`/api/reviews/${cycleId}/manager-review`, { method: "PATCH", keepalive: true, json: payload(form, true) }, { retryWrites: true });
    setSubmitting(false);
    if (!r.ok) { setSubmitError(r.error ? `Not submitted: ${r.error}` : "Not submitted. Your answers are kept, try again."); return; }
    toast(`Manager review for ${data ? personName(data.review.subject) : "them"} submitted`);
    onSaved();
    onClose();
  };

  const subject = data?.review.subject;
  const self = data?.review.selfRatings;
  const words = data?.scale.words ?? [];
  const fact = (label: string, v: number | null) => (
    <span className="flex flex-col"><span className="text-xs text-ink-2">{label}</span><span className={v == null ? "text-sm text-ink-3" : "text-row font-medium tabular-nums text-ink"}>{v == null ? "No data" : `${v}%`}</span></span>
  );

  return (
    <Drawer
      open
      onClose={() => void close()}
      canClose={() => { void close(); return false; }}
      ariaLabel="Manager review"
      layerId="manager-review-drawer"
      expanded={expanded}
      header={
        <>
          <span className="min-w-0 flex-1 truncate text-sm text-ink-2">{cycleName} › <span className="text-ink">{subject ? personName(subject) : ""}</span></span>
          {canWrite ? <AutosaveIndicator status={autosave.status} lastSavedAt={autosave.lastSavedAt} onRetry={autosave.retriesExhausted ? autosave.retryNow : undefined} /> : null}
          <button type="button" aria-label={expanded ? "Collapse" : "Expand"} title={expanded ? "Collapse" : "Expand"} onClick={() => setExpanded((v) => !v)} className="inline-flex h-8 w-8 items-center justify-center rounded-md text-ink-2 hover:bg-hover hover:text-ink">
            {expanded ? <Minimize2 className="h-4 w-4" /> : <Maximize2 className="h-4 w-4" />}
          </button>
          <button type="button" aria-label="Copy link" title="Copy link" onClick={() => { void navigator.clipboard.writeText(`${window.location.origin}/reviews/${cycleId}?tab=team&person=${subjectId}`).then(() => toast("Link copied"), () => toast("Couldn't copy the link", { tone: "danger" })); }} className="inline-flex h-8 w-8 items-center justify-center rounded-md text-ink-2 hover:bg-hover hover:text-ink">
            <Copy className="h-4 w-4" />
          </button>
          <button type="button" aria-label="Close" onClick={() => void close()} className="inline-flex h-8 w-8 items-center justify-center rounded-md text-ink-2 hover:bg-hover hover:text-ink">
            <X className="h-4 w-4" />
          </button>
        </>
      }
      footer={canWrite ? (
        <div className="flex w-full flex-col gap-1 px-5 py-3">
          {submitError ? <p role="alert" className="m-0 text-sm text-danger-text">{submitError}</p> : null}
          <div className="flex items-center justify-end gap-2">
            <button type="button" onClick={() => void close()} className="inline-flex h-9 items-center rounded-md px-3 text-sm font-medium text-ink-2 hover:bg-hover hover:text-ink">Cancel</button>
            <button type="button" disabled={submitting} onClick={() => void submit()} className="inline-flex h-9 items-center rounded-md bg-brand px-4 text-sm font-medium text-white hover:bg-brand-hover disabled:opacity-60">
              {submitting ? "Submitting" : data?.review.status === "MANAGER_REVIEW" ? "Update manager review" : "Submit manager review"}
            </button>
          </div>
        </div>
      ) : undefined}
    >
      <div className="flex flex-col gap-4 px-5 py-4">
        {backup && canWrite ? (
          <div role="status" className="flex min-h-11 flex-wrap items-center gap-3 rounded-lg border border-line bg-subtle px-4 text-sm text-ink">
            <span className="min-w-0 flex-1">You have changes from {formatDate(backup.at, datePrefs, "datetime")} that were not saved.</span>
            <button type="button" className="font-medium text-brand-deep hover:underline" onClick={() => { setForm(backup.data); setBackup(null); }}>Restore</button>
            <button type="button" className="font-medium text-ink-2 hover:text-ink" onClick={() => { if (reviewId) clearAutosaveBackup(draftKey("mgr-review:", viewerId, reviewId)); setBackup(null); }}>Discard</button>
          </div>
        ) : null}
        {locked ? (
          <div role="alert" className="flex min-h-11 flex-wrap items-center gap-3 rounded-lg border border-line bg-subtle px-4 py-2 text-sm text-danger-text">
            <span className="min-w-0 flex-1">Not saved: {locked}. What you typed is still on screen and kept on this device.</span>
            <button type="button" className="font-medium text-brand-deep hover:underline" onClick={() => { setLocked(null); void load(); }}>Show the saved review</button>
          </div>
        ) : null}
        {error ? (
          <OsEmptyView variant="error" compact title="Couldn't open this review" hint={error} action={{ label: "Try again", onClick: () => void load() }} />
        ) : !data || !subject ? (
          <SkeletonLines lines={10} />
        ) : (
          <>
            <div className="flex items-center gap-2">
              <PersonAvatar person={subject} size={32} />
              <span className="min-w-0 flex-1">
                <Link href={`/people/${subject.id}`} className="block truncate text-row font-medium text-ink hover:underline">{personName(subject)}</Link>
                <span className="block truncate text-sm text-ink-2">{[subject.role?.title, subject.department?.name].filter(Boolean).join(" · ")}</span>
              </span>
              <span className="shrink-0 text-xs font-medium text-ink-2">{reviewStatusOf(data.review).label}</span>
            </div>
            {!canWrite ? (
              <p className="m-0 rounded-md bg-subtle px-3 py-2 text-sm text-ink-2">
                {data.review.reviewer ? `${personName(data.review.reviewer)} writes this review.` : "Read only."} You can read it; only they can change it.
              </p>
            ) : null}
            <div className="grid grid-cols-3 gap-3 rounded-md border border-line px-3 py-2">
              {fact("KPI score", data.metrics.avgKpiScore)}
              {fact("SOP compliance", data.metrics.avgSopScore)}
              {fact("Goal progress", data.metrics.okrAvgProgress)}
            </div>
            <Collapsible title="Their self review" count={data.review.status === "PENDING" ? "Not submitted" : undefined}>
              {data.review.status === "PENDING" ? (
                <p className="m-0 text-sm text-ink-2">They have not submitted it yet. You can still write yours.</p>
              ) : (
                <>
                  {(self?.kraRatings ?? []).map((k) => (
                    <div key={k.kraId} className="flex flex-col gap-0.5">
                      <span className="text-row text-ink">{k.kraName || "A KRA"} · <span className="tabular-nums">{k.rating ?? "No rating"}{k.rating ? " of 5" : ""}</span></span>
                      {k.achievements ? <span className="whitespace-pre-wrap text-sm text-ink-2">{k.achievements}</span> : null}
                    </div>
                  ))}
                  {(["wentWell", "couldImprove", "goals"] as const).map((k) => (self?.reflection?.[k] ? (
                    <div key={k} className="flex flex-col gap-0.5">
                      <span className="text-sm font-medium text-ink">{k === "wentWell" ? "What went well" : k === "couldImprove" ? "What could have gone better" : "What they want next period"}</span>
                      <span className="whitespace-pre-wrap text-sm text-ink-2">{self?.reflection?.[k]}</span>
                    </div>
                  ) : null))}
                </>
              )}
            </Collapsible>
            <Collapsible title="Their peer feedback" count={`${data.peerFeedback.length} of ${data.peersAsked} answered`}>
              <p className="m-0 text-xs text-ink-2">Anonymous: names are not shown.</p>
              {data.peerFeedback.length ? data.peerFeedback.map((pf) => (
                <div key={pf.id} className="flex flex-col gap-0.5 border-t border-line-soft pt-2 first:border-t-0 first:pt-0">
                  <span className="text-sm text-ink">{pf.giver ? personName(pf.giver) : "A peer"} · collaboration {pf.collaborationRating ?? pf.rating ?? ""} of 5</span>
                  {pf.strengths ? <span className="whitespace-pre-wrap text-sm text-ink-2">What they do well: {pf.strengths}</span> : null}
                  {pf.improvements ? <span className="whitespace-pre-wrap text-sm text-ink-2">What would help them: {pf.improvements}</span> : null}
                </div>
              )) : <p className="m-0 text-sm text-ink-3">No peer feedback yet.</p>}
            </Collapsible>

            <section className="flex flex-col">
              <h3 className="m-0 flex h-9 items-center text-sm font-medium text-ink-2">Rate their KRAs</h3>
              {data.kras.length ? data.kras.map((k) => (
                <ReviewFormCard
                  key={k.id}
                  kra={k}
                  rating={form.kras[k.id]?.rating ?? null}
                  comment={form.kras[k.id]?.comments ?? ""}
                  anchors={words}
                  readOnly={!canWrite}
                  commentLabel="Comments"
                  onChange={(v) => setForm((f) => ({ ...f, kras: { ...f.kras, [k.id]: { rating: v.rating, comments: v.comment } } }))}
                />
              )) : <p className="m-0 text-row text-ink-3">No KRAs are assigned to them.</p>}
            </section>

            <section className="flex flex-col gap-3">
              <h3 className="m-0 flex h-9 items-center text-sm font-medium text-ink-2">Behaviours</h3>
              {BEHAVIOURS.map((b) => (
                <div key={b.key} className="flex flex-col gap-1">
                  <span className="text-row text-ink">{b.label}</span>
                  <RatingScale name={`beh-${b.key}`} ariaLabel={b.label} value={form.behavioral[b.key] ?? null} labels={words} readOnly={!canWrite}
                    onChange={(n) => setForm((f) => ({ ...f, behavioral: { ...f.behavioral, [b.key]: n } }))} />
                </div>
              ))}
            </section>

            <label className="flex flex-col gap-1">
              <span className="text-sm font-medium text-ink-2">Overall comments</span>
              {canWrite ? (
                <textarea value={form.comments} onChange={(e) => setForm((f) => ({ ...f, comments: e.target.value }))} rows={4} maxLength={10_000}
                  className="min-h-[96px] w-full resize-y rounded-md border border-line bg-raised px-3 py-2 text-row text-ink outline-none focus-visible:border-[var(--os-focus)]" />
              ) : <p className="m-0 whitespace-pre-wrap text-row text-ink">{form.comments || <span className="text-ink-3">Nothing written</span>}</p>}
            </label>

            <div className="flex flex-col gap-1">
              <span className="text-sm font-medium text-ink-2">Outcome</span>
              {canWrite ? (
                <PickerButton ariaLabel="Outcome" label={form.outcome ? outcomeLabel(form.outcome) : <span className="text-ink-3">Pick an outcome</span>}
                  selected={form.outcome} sections={[{ options: OUTCOMES }]} onSelect={(v) => setForm((f) => ({ ...f, outcome: v }))} />
              ) : <span className="text-row text-ink">{form.outcome ? outcomeLabel(form.outcome) : <span className="text-ink-3">None yet</span>}</span>}
            </div>
          </>
        )}
      </div>
    </Drawer>
  );
}
