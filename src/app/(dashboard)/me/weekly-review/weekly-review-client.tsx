"use client";

// The weekly review body: the header stack, the week pills, and the form.
//
// Spec: docs/plans/ui-refresh/spec-work-home.md section 2 (/me/weekly-review).
//
// AUTOSAVE IS THE CONTRACT. Every field saves on blur and two seconds after
// the last keystroke, and the indicator in the title row says which state it
// is in. There is no "Save draft" button, because a button is a promise the
// person has to remember to keep; the one primary is "Submit for review".
// (The data-integrity rule: nothing a person typed is lost because they closed
// the tab.)

import { useCallback, useMemo, useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import { OsPageHeader } from "@/components/layout/os/page-header";
import { AutosaveIndicator } from "@/components/ui/autosave-indicator";
import { WeekPills } from "@/components/me/week-pills";
import { useAutosave } from "@/hooks/use-autosave";
import { useConfirm } from "@/components/ui/dialog-provider";
import { useOsToast } from "@/components/layout/os/toast";
import { DotsArt } from "@/components/ui/dots-art";
import { Dots } from "@/components/ui/dots";
import { apiFetch } from "@/lib/api-fetch";
import { WORK_HOME_HREF } from "@/lib/nav/route-hub";
import { parseWeekKey, weekRangeLabel, type WeekOption } from "@/lib/weeks";
import type { KpiSnapshot, KraProgressEntry, WeeklyReviewDoc } from "@/lib/weekly-review";

interface KraOption {
  id: string;
  name: string;
  category: string | null;
  weightage: number;
  kpis: Array<{ id: string; name: string; unit: string | null; frequency: string; targetValue: number | null; lowerIsBetter: boolean }>;
}

const STATUS_LABEL: Record<string, string> = {
  DRAFT: "In progress",
  SUBMITTED: "Submitted",
  ACKNOWLEDGED: "Reviewed",
};

export function WeeklyReviewClient({
  weekKeyValue,
  weeks,
  review: initialReview,
  editable,
  kras,
}: {
  weekKeyValue: string;
  weeks: WeekOption[];
  review: WeeklyReviewDoc | null;
  editable: boolean;
  kras: KraOption[];
}) {
  const router = useRouter();
  const pathname = usePathname();
  const confirm = useConfirm();
  const { toast } = useOsToast();

  const [review, setReview] = useState<WeeklyReviewDoc | null>(initialReview);
  const [kraDraft, setKraDraft] = useState<Record<string, KraProgressEntry>>(
    Object.fromEntries((initialReview?.kraProgress ?? []).map((k) => [k.kraId, k])),
  );
  const [kpiDraft, setKpiDraft] = useState<Record<string, KpiSnapshot>>(
    Object.fromEntries((initialReview?.kpiSnapshots ?? []).map((k) => [k.kpiId, k])),
  );
  const [highlights, setHighlights] = useState(initialReview?.highlights ?? "");
  const [blockers, setBlockers] = useState(initialReview?.blockers ?? "");
  const [plan, setPlan] = useState(initialReview?.plan ?? "");
  const [busy, setBusy] = useState<null | "submit" | "reopen">(null);

  const submitted = review?.status === "SUBMITTED" || review?.status === "ACKNOWLEDGED";
  const readOnly = !editable || !review || submitted;

  const snapshot = useMemo(
    () => ({
      kraProgress: Object.values(kraDraft),
      kpiSnapshots: Object.values(kpiDraft),
      highlights: highlights.trim() || null,
      blockers: blockers.trim() || null,
      plan: plan.trim() || null,
    }),
    [kraDraft, kpiDraft, highlights, blockers, plan],
  );

  const save = useCallback(
    async (value: typeof snapshot) => {
      if (!review) return;
      const res = await apiFetch<{ review: WeeklyReviewDoc }>(`/api/me/weekly-review/${review.id}`, {
        method: "PATCH",
        json: { ...value, action: "save" },
      });
      // useAutosave decides retry from the throw, so a failure must throw
      // rather than be swallowed: "Not saved, retrying" is the honest state.
      if (!res.ok) throw new Error(res.error);
    },
    [review],
  );

  const { status, lastSavedAt } = useAutosave({
    snapshot,
    save,
    enabled: !readOnly,
    delay: 2000,
  });

  const act = useCallback(
    async (action: "submit" | "reopen") => {
      if (!review) return;
      if (action === "submit") {
        const ok = await confirm({
          title: "Submit this week's review?",
          description: "You can reopen it until your manager reviews it.",
          confirmLabel: "Submit",
        });
        if (!ok) return;
      }
      setBusy(action);
      const res = await apiFetch<{ review: WeeklyReviewDoc }>(`/api/me/weekly-review/${review.id}`, {
        method: "PATCH",
        json: { ...snapshot, action },
      });
      setBusy(null);
      if (!res.ok) { toast(action === "submit" ? "Couldn't submit" : "Couldn't reopen", { tone: "danger", description: res.error }); return; }
      setReview(res.data.review);
      router.refresh();
    },
    [review, snapshot, confirm, toast, router],
  );

  const start = parseWeekKey(weekKeyValue);
  const statusWord = review ? STATUS_LABEL[review.status] ?? review.status : "Not started";

  return (
    <>
      <OsPageHeader
        title="Weekly review"
        back={{ fallbackHref: WORK_HOME_HREF, label: "Home" }}
        autosave={
          readOnly ? undefined : (
            <AutosaveIndicator
              status={status}
              lastSavedAt={lastSavedAt}
              labels={{ idle: "Autosaves as you type" }}
            />
          )
        }
        views={
          <WeekPills
            weeks={weeks}
            active={weekKeyValue}
            onChange={(key) => router.push(`${pathname}?week=${key}`)}
          />
        }
      />

      <div className="mx-auto w-full max-w-[720px] px-6 py-4">
        {/* The status strip: a row, not a banner. */}
        <div className="flex h-11 items-center gap-2 text-sm">
          <span className="inline-flex h-[22px] items-center rounded-md bg-active px-1.5 text-xs font-medium text-ink-2">{statusWord}</span>
          {start ? <span className="text-ink-2">{weekRangeLabel(start)}</span> : null}
          {review?.managerStatus === "PENDING" ? <span className="text-ink-2">Waiting on your manager</span> : null}
        </div>

        {!review ? (
          <div className="flex flex-col items-center justify-center gap-2 px-6 py-16 text-center">
            <DotsArt arrangement="stack" size={64} />
            <p className="text-base font-medium text-ink">Nothing filed for this week</p>
            <p className="max-w-[46ch] text-base text-ink-2">
              You did not write a review for this week. Pick This week to write the current one.
            </p>
          </div>
        ) : (
          <div className="flex flex-col gap-6">
            <Card title="Your KRAs">
              {kras.length === 0 ? (
                // No raw path in the copy: a person is told who to ask, not
                // which URL to type (misc-apps #25).
                <p className="text-base text-ink-2">No KRAs assigned yet. Ask your manager or the People team.</p>
              ) : (
                <ul className="flex flex-col gap-4">
                  {kras.map((k) => {
                    const entry = kraDraft[k.id] ?? { kraId: k.id, progressPct: 0, note: "" };
                    return (
                      <li key={k.id} className="flex flex-col gap-1.5">
                        <div className="flex items-center gap-2">
                          <span className="min-w-0 flex-1 truncate font-medium text-ink">{k.name}</span>
                          <span className="inline-flex h-[22px] items-center rounded-md bg-active px-1.5 text-xs font-medium text-ink-2">
                            {k.weightage}%
                          </span>
                          <span className="w-10 text-end text-sm font-medium tabular-nums text-ink">{entry.progressPct}%</span>
                        </div>
                        {readOnly ? (
                          // A submitted week shows a progress bar, not a
                          // disabled slider you can push and nothing happens.
                          <div className="h-1 w-full rounded-full bg-active" role="img" aria-label={`${entry.progressPct} percent`}>
                            <div className="h-1 rounded-full bg-brand" style={{ width: `${entry.progressPct}%` }} />
                          </div>
                        ) : (
                          <input
                            type="range"
                            min={0}
                            max={100}
                            step={5}
                            value={entry.progressPct}
                            aria-label={`${k.name} progress`}
                            aria-valuetext={`${entry.progressPct} percent`}
                            onChange={(e) => setKraDraft((d) => ({ ...d, [k.id]: { ...entry, progressPct: Number(e.target.value) } }))}
                            className="w-full accent-[var(--os-brand)]"
                          />
                        )}
                        {readOnly ? (
                          entry.note ? <p className="text-base text-ink-2">{entry.note}</p> : null
                        ) : (
                          <input
                            type="text"
                            value={entry.note ?? ""}
                            placeholder="A note, if it needs one"
                            onChange={(e) => setKraDraft((d) => ({ ...d, [k.id]: { ...entry, note: e.target.value } }))}
                            className="h-9 w-full rounded-lg border border-line bg-raised px-2 text-base text-ink"
                          />
                        )}
                      </li>
                    );
                  })}
                </ul>
              )}
            </Card>

            {/* The Home "N KPI numbers to record" row links straight here. */}
            <Card title="Your KPIs" id="kpis">
              {kras.flatMap((k) => k.kpis).length === 0 ? (
                <p className="text-base text-ink-2">No KPIs under your KRAs yet.</p>
              ) : (
                <ul className="flex flex-col gap-2">
                  {kras.flatMap((k) =>
                    k.kpis.map((kpi) => {
                      const snap = kpiDraft[kpi.id] ?? { kpiId: kpi.id, value: null };
                      return (
                        <li key={kpi.id} className="flex items-center gap-3">
                          <span className="min-w-0 flex-1">
                            <span className="block truncate text-base text-ink">{kpi.name}</span>
                            <span className="block truncate text-sm text-ink-2">
                              Target {kpi.targetValue ?? "not set"}{kpi.unit ? ` ${kpi.unit}` : ""}
                              {kpi.lowerIsBetter ? " · lower is better" : ""}
                            </span>
                          </span>
                          {readOnly ? (
                            <span className="w-24 text-end text-base tabular-nums text-ink">{snap.value ?? "—"}</span>
                          ) : (
                            <input
                              type="number"
                              step="any"
                              value={snap.value ?? ""}
                              aria-label={kpi.name}
                              onChange={(e) => {
                                const raw = e.target.value;
                                const next = raw === "" ? null : Number(raw);
                                setKpiDraft((d) => ({ ...d, [kpi.id]: { ...snap, value: Number.isFinite(next as number) ? next : null } }));
                              }}
                              className="h-9 w-24 rounded-lg border border-line bg-raised px-2 text-end text-base text-ink"
                            />
                          )}
                          {kpi.unit ? <span className="w-10 shrink-0 text-sm text-ink-2">{kpi.unit}</span> : null}
                        </li>
                      );
                    }),
                  )}
                </ul>
              )}
            </Card>

            <Narrative title="Highlights" value={highlights} onChange={setHighlights} readOnly={readOnly} placeholder="What went well" />
            <Narrative title="Blockers" value={blockers} onChange={setBlockers} readOnly={readOnly} placeholder="What is stuck, or where you need help" />
            <Narrative title="Plan for next week" value={plan} onChange={setPlan} readOnly={readOnly} placeholder="What you will ship next" />

            {review.managerNotes ? (
              <Card title="Manager note">
                <p className="whitespace-pre-wrap text-base text-ink">{review.managerNotes}</p>
              </Card>
            ) : null}

            {editable ? (
              <div className="flex items-center gap-2">
                {review.status === "DRAFT" ? (
                  <button
                    type="button"
                    disabled={busy !== null}
                    onClick={() => void act("submit")}
                    className="inline-flex h-9 items-center gap-2 rounded-lg bg-brand px-4 text-base font-medium text-white disabled:opacity-60"
                  >
                    {busy === "submit" ? <Dots variant="pending" /> : null} Submit for review
                  </button>
                ) : null}
                {review.status === "SUBMITTED" ? (
                  <button
                    type="button"
                    disabled={busy !== null}
                    onClick={() => void act("reopen")}
                    className="inline-flex h-9 items-center gap-2 rounded-lg border border-line px-3 text-base text-ink hover:bg-hover disabled:opacity-60"
                  >
                    {busy === "reopen" ? <Dots variant="pending" /> : null} Reopen
                  </button>
                ) : null}
                {/* Reviewed weeks show nothing: the strip already says so. */}
              </div>
            ) : null}
          </div>
        )}
      </div>
    </>
  );
}

function Card({ title, id, children }: { title: string; id?: string; children: React.ReactNode }) {
  return (
    <section id={id} className="os-row scroll-mt-4 rounded-lg border border-line bg-raised p-4">
      <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-ink-2">{title}</h2>
      {children}
    </section>
  );
}

function Narrative({
  title,
  value,
  onChange,
  readOnly,
  placeholder,
}: {
  title: string;
  value: string;
  onChange: (v: string) => void;
  readOnly: boolean;
  placeholder: string;
}) {
  return (
    <Card title={title}>
      {readOnly ? (
        <p className="whitespace-pre-wrap text-base text-ink">{value || <span className="text-ink-3">Nothing written</span>}</p>
      ) : (
        <textarea
          rows={3}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder={placeholder}
          aria-label={title}
          className="w-full resize-y bg-transparent text-base text-ink outline-none placeholder:text-ink-3"
        />
      )}
    </Card>
  );
}
