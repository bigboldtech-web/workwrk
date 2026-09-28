"use client";

// A review cycle's page (spec-teams-performance /reviews/[id]): one review
// round, from the employee's own review through the manager's, calibration
// and the final outcome.
//
// The sections come from who the viewer is IN the cycle (the server page
// decides the faces; every section's API scopes its rows again):
//   My review       the subject of a row                      MyReviewPanel
//   Team            a reviewer, anyone above a subject, the    TeamPanel and
//                   People team and Admin                      ManagerReviewDrawer
//   Peer feedback   someone asked for peer feedback            PeerFeedbackPanel
//   Calibration     the cycle's runner, once In calibration    CalibrationPanel
// A viewer with one section sees no pill row. The old Dashboard tab is the
// header's step dots and counts plus the Team table.
//
// The title row carries the ONE blue button for the viewer's next action
// (Launch cycle, Submit my review, Open next review, Finalize outcomes), and
// it is not rendered while a drawer or a modal with its own primary is open.
// Every load renders a wired Retry in its own section (the old page swallowed
// twelve failures in empty catch blocks); every save path autosaves with
// keepalive, retry and a visible failure state.

import { useCallback, useEffect, useMemo, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { Ban, Bell, Download, FileText, Link2, Scale, Trash2 } from "lucide-react";
import { Breadcrumb } from "@/components/layout/os/top-bar/breadcrumb";
import { OsPageHeader, OsPageHeaderSkeleton } from "@/components/layout/os/page-header";
import { OsEmptyView } from "@/components/layout/os/empty-view";
import { useOsShell } from "@/components/layout/os/shell-context";
import { useOsToast } from "@/components/layout/os/toast";
import { useBoot } from "@/components/layout/os/boot-context";
import { useConfirm } from "@/components/ui/dialog-provider";
import { ViewTab } from "@/components/ui/view-tabs";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { SkeletonLines } from "@/components/ui/skeleton";
import { ToneChip } from "@/components/people/person-bits";
import { ReviewStepDots } from "@/components/performance/review-step-dots";
import { apiFetch } from "@/lib/api-fetch";
import { formatDate } from "@/lib/format/date";
import { useDatePrefs } from "@/lib/format/use-date-prefs";
import { cycleStatusOf, stepsPassed } from "@/lib/performance/review-cycle";
import { audiencePhrase, calibrationConfirmText, launchConfirmText, launchNobodyText, peopleCount, type AppraisalLetter, type CycleData, type LaunchPreview, type PanelPrimary } from "./cycle-types";
import { buildLetterHtml, downloadLetter } from "./appraisal-letter";
import { MyReviewPanel } from "./my-review-panel";
import { TeamPanel } from "./team-panel";
import { ManagerReviewDrawer } from "./manager-review-drawer";
import { PeerFeedbackPanel } from "./peer-feedback-panel";
import { CalibrationPanel } from "./calibration-panel";

/**
 * Which sections this viewer gets, decided on the server page from the
 * viewer's rows in the cycle (reviews/[id]/page.tsx).
 */
export interface CycleFaces {
  /** The viewer is the subject of a review in this cycle. */
  self: boolean;
  /** The viewer reviews at least one person in this cycle. */
  team: boolean;
  /** The viewer was asked for peer feedback in this cycle. */
  peer: boolean;
  /** People team, Admin, or the manager who started the cycle. */
  canManage: boolean;
  /** Someone in the viewer's reporting chain is in this cycle. */
  chain: boolean;
  /** The viewer holds the Review cycles row (so the back button can go there). */
  canSeeList?: boolean;
}

type Tab = "self" | "team" | "peer" | "calibration";

export default function ReviewDetailClient({ cycleId, faces }: { cycleId: string; faces: CycleFaces }) {
  const router = useRouter();
  const pathname = usePathname();
  const sp = useSearchParams();
  const { toast } = useOsToast();
  const { blockingLayerOpen } = useOsShell();
  const { boot } = useBoot();
  const confirm = useConfirm();
  const datePrefs = useDatePrefs();
  // A cycle's start and close are calendar days, stored at midnight UTC:
  // read them as days, never shifted a day by the viewer's time zone.
  const dayPrefs = { ...datePrefs, timezone: "UTC" };
  const viewer = boot.viewer as { id: string; isAgent?: boolean };

  // When the page opened: the "closes in N days" line reads it, and a
  // render never reads the clock.
  const [now] = useState(() => Date.now());
  const [cycle, setCycle] = useState<CycleData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const load = useCallback(async () => {
    const r = await apiFetch<CycleData>(`/api/reviews/${cycleId}`, { cache: "no-store" });
    if (!r.ok) { setError(r.error || "Couldn't load this cycle"); return; }
    setError(null);
    setCycle(r.data);
  }, [cycleId]);
  useEffect(() => {
    const t = setTimeout(() => { void load(); }, 0);
    return () => clearTimeout(t);
  }, [load]);

  // Who a Draft cycle would ask, for its runner's note (and refreshed by
  // every Launch click, which never trusts this copy for its confirm).
  const [preview, setPreview] = useState<{ data: LaunchPreview | null; error: string | null } | null>(null);
  const draftRunner = cycle?.status === "DRAFT" && (cycle.viewer?.canManage ?? faces.canManage);
  const loadPreview = useCallback(async () => {
    setPreview(null);
    const r = await apiFetch<LaunchPreview>(`/api/reviews/${cycleId}/launch`, { cache: "no-store" });
    setPreview(r.ok ? { data: r.data, error: null } : { data: null, error: r.error || "Couldn't count who it covers" });
  }, [cycleId]);
  useEffect(() => {
    if (!draftRunner) return;
    const t = setTimeout(() => { void loadPreview(); }, 0);
    return () => clearTimeout(t);
  }, [draftRunner, loadPreview]);

  const setParams = useCallback((patch: Record<string, string | null>, push = false) => {
    const next = new URLSearchParams(sp?.toString() ?? "");
    for (const [k, v] of Object.entries(patch)) { if (v) next.set(k, v); else next.delete(k); }
    const s = next.toString();
    const href = s ? `${pathname}?${s}` : pathname;
    if (push) router.push(href, { scroll: false }); else router.replace(href, { scroll: false });
  }, [sp, router, pathname]);

  const status = cycle?.status ?? "DRAFT";
  const v = cycle?.viewer;
  const canManage = v?.canManage ?? faces.canManage;
  const teamRows = useMemo(() => (cycle?.reviews ?? []).filter((r) => !r.peerOnly && r.subjectId !== viewer.id), [cycle, viewer.id]);
  const tabs: Tab[] = [
    faces.self ? "self" : null,
    faces.team || faces.chain || (canManage && teamRows.length > 0) || (v?.peopleTeamOrAdmin && teamRows.length > 0) ? "team" : null,
    faces.peer ? "peer" : null,
    canManage && (status === "IN_CALIBRATION" || status === "COMPLETED") ? "calibration" : null,
  ].filter((t): t is Tab => t !== null);
  const asked = sp?.get("tab");
  const tabAlias: Record<string, Tab> = { self: "self", "self-assessment": "self", team: "team", "manager-review": "team", peer: "peer", "peer-feedback": "peer", calibration: "calibration" };
  // The landing tab is the viewer's single next action: a runner of a cycle
  // In calibration lands on Calibration (where Finalize outcomes is), even
  // when they are also its subject, whose own review is read only by then.
  const defaultTab: Tab | undefined = status === "IN_CALIBRATION" && tabs.includes("calibration") ? "calibration" : tabs[0];
  const tab: Tab | null = (asked && tabAlias[asked] && tabs.includes(tabAlias[asked]) ? tabAlias[asked] : defaultTab) ?? null;
  const person = sp?.get("person") ?? null;

  // The primary the active panel hands up (Submit my review, Finalize).
  const [panelPrimary, setPanelPrimary] = useState<PanelPrimary>(null);
  const onPrimary = useCallback((p: PanelPrimary) => setPanelPrimary(p), []);

  // ── Actions ───────────────────────────────────────────────────────
  const [launching, setLaunching] = useState(false);
  // Launch emails every person it covers and cannot be undone, so the
  // confirm names the count first (GET /launch works it out the same way
  // the launch does). No count, no confirm: a launch never goes ahead on a
  // number nobody saw, and the POST refuses if the count moved meanwhile.
  const launch = async () => {
    if (!cycle) return;
    setLaunching(true);
    const pre = await apiFetch<LaunchPreview>(`/api/reviews/${cycleId}/launch`, { cache: "no-store" });
    setLaunching(false);
    if (!pre.ok) { toast(pre.error || "Couldn't count who this cycle covers", { tone: "danger", action: { label: "Try again", onClick: () => void launch() } }); return; }
    setPreview({ data: pre.data, error: null });
    const description = launchConfirmText(pre.data);
    if (!description) { toast(launchNobodyText(pre.data), { tone: "danger" }); return; }
    const ok = await confirm({ title: `Launch ${cycle.name}?`, description, confirmLabel: "Launch", destructive: false });
    if (!ok) return;
    setLaunching(true);
    const r = await apiFetch<{ count: number }>(`/api/reviews/${cycleId}/launch`, { method: "POST", json: { expect: pre.data.count } });
    setLaunching(false);
    if (!r.ok) { toast(r.error || "Couldn't launch the cycle", { tone: "danger" }); void loadPreview(); return; }
    toast(`Launched. ${r.data.count} ${r.data.count === 1 ? "person" : "people"} asked for a review.`);
    router.refresh();
    void load();
  };
  const remind = async () => {
    const r = await apiFetch<{ notified: number }>(`/api/reviews/${cycleId}/reminders`, { method: "POST", json: {} });
    if (!r.ok) { toast(r.error || "Couldn't send reminders", { tone: "danger" }); return; }
    toast(r.data.notified ? `Reminded ${r.data.notified} ${r.data.notified === 1 ? "person" : "people"}` : "Nobody needed a reminder");
  };
  const cancel = async () => {
    if (!cycle) return;
    const ok = await confirm({ title: `Cancel ${cycle.name}?`, description: "Nothing is deleted. The cycle stops and nobody is asked for anything more.", confirmLabel: "Cancel cycle", cancelLabel: "Keep it", destructive: true });
    if (!ok) return;
    const r = await apiFetch(`/api/reviews/${cycleId}/cancel`, { method: "POST", json: {} });
    if (!r.ok) { toast(r.error || "Couldn't cancel the cycle", { tone: "danger" }); return; }
    toast("Cycle cancelled");
    void load();
  };
  // Delete draft: a Draft nobody has a review in, by its starter, the People
  // team or Admin (viewer.canDelete, the DELETE route's own rule).
  const removeDraft = async () => {
    if (!cycle) return;
    const ok = await confirm({ title: `Delete ${cycle.name}?`, description: "It is a draft and nobody has been asked for anything, so nothing else is lost.", confirmLabel: "Delete draft", destructive: true });
    if (!ok) return;
    const r = await apiFetch(`/api/reviews?id=${encodeURIComponent(cycleId)}`, { method: "DELETE" });
    if (!r.ok) { toast(r.error || "Couldn't delete the draft", { tone: "danger", action: { label: "Try again", onClick: () => void removeDraft() } }); return; }
    toast("Draft deleted");
    router.push("/reviews?view=draft");
  };
  const startCalibration = async () => {
    if (!cycle) return;
    const ok = await confirm({ title: `Start calibration for ${cycle.name}?`, description: calibrationConfirmText(cycle.stats), confirmLabel: "Start calibration", destructive: false });
    if (!ok) return;
    const r = await apiFetch(`/api/reviews`, { method: "PATCH", json: { id: cycleId, status: "IN_CALIBRATION" } });
    if (!r.ok) { toast(r.error || "Couldn't start calibration", { tone: "danger" }); return; }
    toast("Calibration started");
    await load();
    setParams({ tab: "calibration" });
  };

  // ── Appraisal letter ──────────────────────────────────────────────
  const [letter, setLetter] = useState<{ reviewId: string; data: AppraisalLetter | null; error: string | null } | null>(null);
  const openLetter = useCallback(async (reviewId: string) => {
    setLetter({ reviewId, data: null, error: null });
    const r = await apiFetch<AppraisalLetter>(`/api/reviews/${cycleId}/appraisal-letter?reviewId=${encodeURIComponent(reviewId)}`, { cache: "no-store" });
    setLetter({ reviewId, data: r.ok ? r.data : null, error: r.ok ? null : r.error || "Couldn't make the appraisal letter" });
  }, [cycleId, setLetter]);

  // ── The next action (one blue on screen) ──────────────────────────
  const myRow = (cycle?.reviews ?? []).find((r) => r.subjectId === viewer.id && !r.peerOnly);
  const outstanding = teamRows.filter((r) => r.reviewerId === viewer.id && (r.status === "PENDING" || r.status === "SELF_ASSESSMENT"));
  let primary: PanelPrimary = null;
  if (canManage && status === "DRAFT") primary = { label: "Launch cycle", onClick: () => void launch(), busy: launching };
  else if (tab === "self" && panelPrimary) primary = panelPrimary;
  else if (tab === "calibration" && panelPrimary) primary = panelPrimary;
  else if (tab === "team" && outstanding.length && (status === "ACTIVE" || status === "IN_CALIBRATION")) primary = { label: "Open next review", onClick: () => setParams({ person: outstanding[0].subjectId }, true) };
  const showPrimary = primary && !blockingLayerOpen && !person && !letter;

  const back = faces.canSeeList !== false ? { fallbackHref: "/reviews", label: "Review cycles" } : { fallbackHref: "/people/me", label: "My profile" };
  const moreEntries = cycle ? [
    { label: "Copy link", icon: Link2, onClick: () => { void navigator.clipboard.writeText(`${window.location.origin}/reviews/${cycleId}`).then(() => toast("Link copied"), () => toast("Couldn't copy the link", { tone: "danger" })); } },
    ...((canManage || v?.inChain || v?.isReviewer) && (status === "ACTIVE" || status === "IN_CALIBRATION") ? [{ label: "Send a reminder", icon: Bell, onClick: () => void remind() }] : []),
    ...(myRow && myRow.status === "COMPLETED" ? [{ label: "Download my appraisal letter", icon: FileText, onClick: () => void openLetter(myRow.id) }] : []),
    ...(v?.peopleTeamOrAdmin && !viewer.isAgent ? [{ label: "Export cycle CSV", icon: Download, onClick: () => { window.location.href = `/api/export/reviews/${cycleId}`; } }] : []),
    ...(canManage && status === "ACTIVE" ? [{ label: "Start calibration", icon: Scale, onClick: () => void startCalibration() }] : []),
    ...(canManage && !viewer.isAgent && (status === "DRAFT" || status === "ACTIVE") ? [{ separator: true as const }, { label: "Cancel cycle", icon: Ban, destructive: true, onClick: () => void cancel() }] : []),
    ...(v?.canDelete && status === "DRAFT" ? [{ label: "Delete draft", icon: Trash2, destructive: true, onClick: () => void removeDraft() }] : []),
  ] : [];

  if (error && !cycle) {
    return (
      <>
        <OsPageHeader title="Review cycle" back={back} />
        <div className="px-6 py-6"><OsEmptyView variant="error" title="Couldn't load this cycle" hint={error} action={{ label: "Try again", onClick: () => void load() }} /></div>
      </>
    );
  }
  if (!cycle) {
    return (
      <>
        <OsPageHeaderSkeleton />
        <div className="mx-auto flex w-full max-w-[720px] flex-col gap-6 px-6 py-6" aria-busy="true">
          <SkeletonLines lines={2} />
          {[0, 1, 2].map((i) => <div key={i} className="rounded-lg border border-line p-6"><SkeletonLines lines={4} /></div>)}
        </div>
      </>
    );
  }

  const st = cycleStatusOf(status);
  const closed = status === "COMPLETED" || status === "CANCELLED";
  // A subject's own row still Not started once the cycle is past Active is
  // a self review that closed unsent (self reviews close when calibration
  // starts): their dots show Self missed, never passed, and the header
  // stops saying their review is due (My review says why, just below).
  // (A runner or reviewer who is also a subject reads the cycle's dots.)
  const above = canManage || v?.inChain || v?.peopleTeamOrAdmin || v?.isReviewer;
  const selfMissed = !above && !!faces.self && status === "IN_CALIBRATION" && myRow?.status === "PENDING";
  const passed = selfMissed ? 0 : stepsPassed(status, cycle.stats);
  const daysLeft = Math.ceil((new Date(cycle.endDate).getTime() - now) / 86_400_000);
  const stalled = status === "ACTIVE" && daysLeft < 0;
  const pct = cycle.stats.total ? Math.round((cycle.stats.completed / cycle.stats.total) * 100) : 0;
  const wide = tab === "team" || tab === "calibration";

  return (
    <>
      <Breadcrumb items={faces.canSeeList !== false ? [{ label: "Review cycles", href: "/reviews" }, { label: cycle.name }] : [{ label: cycle.name }]} />
      <OsPageHeader
        title={cycle.name}
        back={back}
        titleSlot={
          <>
            <h1 className="min-w-0 truncate text-title font-semibold text-ink">{cycle.name}</h1>
            <ToneChip tone={st.tone} label={st.label} />
          </>
        }
        actions={showPrimary && primary ? (
          <button type="button" onClick={primary.onClick} disabled={primary.busy} title={primary.title}
            className="inline-flex h-9 items-center rounded-md bg-brand px-3 text-base font-medium text-white hover:bg-brand-hover disabled:opacity-60">
            {primary.busy ? "Working" : primary.label}
          </button>
        ) : undefined}
        more={moreEntries}
      />
      <div className="min-h-0 flex-1 overflow-y-auto">
        <div className={`mx-auto flex w-full flex-col gap-4 px-6 pb-10 pt-2 ${wide ? "max-w-[1152px]" : "max-w-[720px]"}`}>
          {/* The meta strip: steps, period, what is left. */}
          <div className="flex min-h-14 flex-wrap items-center gap-x-6 gap-y-2">
            <ReviewStepDots passed={passed} stalled={stalled || selfMissed} withLabels />
            <span className="whitespace-nowrap text-sm text-ink-2">
              {formatDate(cycle.startDate, dayPrefs, "date")} to {formatDate(cycle.endDate, dayPrefs, "date")}
              {" · "}
              {closed ? (status === "CANCELLED" ? "Cancelled" : "Closed") : daysLeft < 0 ? `Closed for answers ${-daysLeft} ${-daysLeft === 1 ? "day" : "days"} ago` : daysLeft === 0 ? "Closes today" : `Closes in ${daysLeft} ${daysLeft === 1 ? "day" : "days"}`}
            </span>
            {above && cycle.stats.total ? (
              <span className="flex items-center gap-2 whitespace-nowrap text-sm text-ink-2">
                {cycle.stats.completed} of {cycle.stats.total} reviews complete
                <span className="h-1 w-[120px] overflow-hidden rounded-full bg-subtle" aria-hidden><span className="block h-full rounded-full bg-brand" style={{ width: `${pct}%` }} /></span>
              </span>
            ) : faces.self && status === "ACTIVE" ? (
              <span className="text-sm text-ink-2">Your review is due {formatDate(cycle.endDate, dayPrefs, "date")}</span>
            ) : null}
          </div>

          {closed && !primary ? <p className="m-0 rounded-md bg-subtle px-3 py-2 text-sm text-ink-2">{status === "CANCELLED" ? "This cycle was cancelled. Nothing more is asked of anyone." : "This cycle is closed. Scores and outcomes are final."}</p> : null}
          {status === "DRAFT" && canManage ? (
            // Who it covers, from the cycle's own audience and the same count
            // the launch makes (the old note told a manager "the people who
            // report to you" even for a cycle naming one person).
            <p className="m-0 rounded-lg border border-line bg-raised px-4 py-3 text-row text-ink-2">
              Nobody has been added yet.{" "}
              {preview?.data ? (
                preview.data.count > 0
                  ? `Launching the cycle creates a review for ${peopleCount(preview.data.count)} (${audiencePhrase(preview.data)}).`
                  : launchNobodyText(preview.data)
              ) : preview?.error ? (
                <>Couldn&apos;t count who it covers. <button type="button" className="font-medium text-brand-deep hover:underline" onClick={() => void loadPreview()}>Try again</button></>
              ) : (
                "Launching the cycle creates a review for everyone it covers."
              )}
            </p>
          ) : null}

          {tabs.length > 1 ? (
            <div role="tablist" aria-label="Sections" className="flex h-9 items-center gap-1">
              {tabs.map((t) => (
                <ViewTab key={t} label={t === "self" ? "My review" : t === "team" ? "Team" : t === "peer" ? "Peer feedback" : "Calibration"} active={tab === t} onClick={() => setParams({ tab: t === defaultTab ? null : t, person: null })} />
              ))}
            </div>
          ) : null}

          {tab === "self" ? (
            <MyReviewPanel cycleId={cycleId} cycleStatus={status} cycleEnd={cycle.endDate} words={cycle.scale.words} bands={cycle.bands} onPrimary={onPrimary} onChanged={() => void load()} onOpenLetter={(id) => void openLetter(id)} />
          ) : tab === "team" ? (
            <TeamPanel cycleId={cycleId} cycleStatus={status} rows={teamRows} viewerId={viewer.id} isAgent={!!viewer.isAgent}
              onOpen={(id) => setParams({ person: id, tab: defaultTab === "team" ? null : "team" }, true)} onOpenLetter={(id) => void openLetter(id)} onChanged={() => void load()} />
          ) : tab === "peer" ? (
            <PeerFeedbackPanel cycleId={cycleId} cycleStatus={status} words={cycle.scale.words} />
          ) : tab === "calibration" ? (
            <CalibrationPanel cycleId={cycleId} cycleStatus={status} isAgent={!!viewer.isAgent} onPrimary={onPrimary} onChanged={() => void load()} />
          ) : status === "DRAFT" ? null : (
            <p className="m-0 text-row text-ink-2">Nothing in this cycle is yours to do.</p>
          )}
        </div>
      </div>

      {person && tab === "team" ? (
        <ManagerReviewDrawer key={person} cycleId={cycleId} cycleName={cycle.name} subjectId={person} onClose={() => setParams({ person: null })} onSaved={() => void load()} />
      ) : null}

      {letter ? (
        <Dialog open onOpenChange={(o) => { if (!o) setLetter(null); }}>
          <DialogContent className="max-w-[720px]">
            <DialogHeader>
              <DialogTitle>Appraisal letter</DialogTitle>
              <DialogDescription>A preview of the file you can download, save or print.</DialogDescription>
            </DialogHeader>
            {letter.error ? (
              <p role="alert" className="m-0 text-sm text-danger-text">{letter.error}. <button type="button" className="font-medium text-brand-deep hover:underline" onClick={() => void openLetter(letter.reviewId)}>Try again</button></p>
            ) : !letter.data ? (
              <SkeletonLines lines={8} />
            ) : (
              <iframe title="Appraisal letter preview" sandbox="" srcDoc={buildLetterHtml(letter.data)} className="h-[56vh] w-full rounded-md border border-line bg-white" />
            )}
            <DialogFooter>
              <Button variant="ghost" onClick={() => setLetter(null)}>Close</Button>
              {letter.data ? <Button variant="ghost" onClick={() => downloadLetter(letter.data!)}>Download</Button> : null}
            </DialogFooter>
          </DialogContent>
        </Dialog>
      ) : null}
    </>
  );
}
