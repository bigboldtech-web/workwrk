"use client";

// A survey (spec-teams-performance /surveys/[id]): answer it, or read what
// came back. Every permission comes from the server (GET
// /api/pulse-surveys/[id] viewer), never from a role read here.
//
//   Respond   in the audience while it is Open: "8 questions, about 2
//             minutes", the questions (QuestionRenderer), and the blue Submit
//             (or "Update my answers" once changed) in the title row. After
//             submitting: Your answers, read only, with Change my answers
//             while it is open. What you type is kept on this device until
//             it is sent.
//   Results   the creator, the People team and Admin: "18 of 24 answered ·
//             75% response rate · Closes 20 Sep", then a card per question.
//             An anonymous survey shows nothing under four answers.
// Someone who holds both gets a Respond · Results pill row, landing on
// Respond until they have answered, with a line saying why.

import { useCallback, useEffect, useMemo, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { Ban, Bell, CalendarClock, Download, Link2, Pencil, Play, RotateCcw, Trash2 } from "lucide-react";
import { Breadcrumb } from "@/components/layout/os/top-bar/breadcrumb";
import { OsPageHeader, OsPageHeaderSkeleton } from "@/components/layout/os/page-header";
import { OsEmptyView } from "@/components/layout/os/empty-view";
import { useOsShell } from "@/components/layout/os/shell-context";
import { useOsToast } from "@/components/layout/os/toast";
import { useBoot } from "@/components/layout/os/boot-context";
import { draftKey as scopedDraftKey, dropLegacyDraft } from "@/lib/people/draft-keys";
import { ViewTab } from "@/components/ui/view-tabs";
import { SkeletonLines } from "@/components/ui/skeleton";
import { useConfirm } from "@/components/ui/dialog-provider";
import { ToneChip } from "@/components/people/person-bits";
import { AnonymityNote } from "@/components/culture/anonymity-note";
import { QuestionRenderer, hasAnswer, type QuestionType } from "@/components/performance/question-renderer";
import { apiFetch, apiFetchWithRetry } from "@/lib/api-fetch";
import { formatDate } from "@/lib/format/date";
import { useDatePrefs } from "@/lib/format/use-date-prefs";
import { surveyMinutes, surveyStatusOf, type SurveyQuestion } from "@/lib/performance/survey";
import { SurveyBuilder, type EditableSurvey } from "../_components/survey-builder";
import { ChangeCloseDateDialog } from "../_components/change-close-date-dialog";

type Detail = {
  survey: {
    id: string; title: string; questions: SurveyQuestion[]; status: "DRAFT" | "ACTIVE" | "CLOSED"; anonymous: boolean;
    audienceType: string; audience?: string; officeIds?: string[]; departmentIds?: string[]; userIds?: string[]; tagIds?: string[];
    frequency: string | null; closesAt: string | null; closedAt: string | null; createdAt: string;
  };
  viewer: { inAudience: boolean; canRespond: boolean; hasResponded: boolean; canManage: boolean; canSeeResults: boolean; canDelete: boolean; canExport: boolean; questionsLocked: boolean };
  myAnswers: Array<{ questionId: string; value: unknown }> | null;
  answeredAt: string | null;
  stats: { audienceSize: number | null; totalResponses: number; responseRate: number } | null;
};
type ResultQuestion =
  | { questionId: string; text: string; kind: "rating" | "nps"; totalAnswered: number; belowFloor?: boolean; average: number | null; min: number; max: number; distribution: Array<{ value: number; count: number }> }
  | { questionId: string; text: string; kind: "single_choice" | "multi_choice" | "yes_no"; totalAnswered: number; belowFloor?: boolean; options: Array<{ value: string; count: number }> }
  | { questionId: string; text: string; kind: "text"; totalAnswered: number; belowFloor?: boolean; responses: Array<{ value: string; createdAt: string | null; respondent: { id: string; name: string } | null }> };
type Results = { totalResponses: number; belowFloor: boolean; anonymityFloor?: number; summary: { npsScore: number | null }; questions: ResultQuestion[] };

// Unsent answers are kept per person (lib/people/draft-keys.ts); the old
// object-only key is removed on sight.
const surveyDraftKey = (userId: string, id: string) => scopedDraftKey("workwrk:survey-answers:", userId, id);

export default function SurveyDetailClient({ id }: { id: string }) {
  const router = useRouter();
  const pathname = usePathname();
  const sp = useSearchParams();
  const { toast } = useOsToast();
  const { blockingLayerOpen } = useOsShell();
  const { boot } = useBoot();
  const viewerId = (boot?.viewer as { id?: string } | undefined)?.id ?? "anon";
  const draftKey = useCallback((sid: string) => surveyDraftKey(viewerId, sid), [viewerId]);
  useEffect(() => { dropLegacyDraft("workwrk:survey-answers:", id); }, [id]);
  const confirm = useConfirm();
  const datePrefs = useDatePrefs();
  const isAgent = !!(boot.viewer as { isAgent?: boolean }).isAgent;

  const [d, setD] = useState<Detail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const load = useCallback(async () => {
    const r = await apiFetch<Detail>(`/api/pulse-surveys/${id}`, { cache: "no-store" });
    if (!r.ok) { setError(r.status === 404 ? "This survey is not available to you." : r.error || "Couldn't load the survey"); return; }
    setError(null);
    setD(r.data);
  }, [id]);
  useEffect(() => { const t = setTimeout(() => { void load(); }, 0); return () => clearTimeout(t); }, [load]);

  // ── Answers ───────────────────────────────────────────────────────
  const [answers, setAnswers] = useState<Record<string, unknown>>({});
  const [answersFor, setAnswersFor] = useState<string | null>(null);
  const [editing, setEditing] = useState(false);
  const [dirty, setDirty] = useState(false);
  if (d && answersFor !== `${d.survey.id}:${d.answeredAt ?? ""}`) {
    setAnswersFor(`${d.survey.id}:${d.answeredAt ?? ""}`);
    const mine: Record<string, unknown> = {};
    for (const a of d.myAnswers ?? []) mine[a.questionId] = a.value;
    let local: Record<string, unknown> | null = null;
    try { const raw = typeof window !== "undefined" ? window.localStorage.getItem(draftKey(d.survey.id)) : null; local = raw ? (JSON.parse(raw) as Record<string, unknown>) : null; } catch { /* private mode */ }
    setAnswers(local && !d.viewer.hasResponded ? local : mine);
  }
  const setAnswer = (qid: string, v: unknown) => setAnswers((a) => {
    const next = { ...a, [qid]: v };
    setDirty(true);
    try { window.localStorage.setItem(draftKey(id), JSON.stringify(next)); } catch { /* kept in memory */ }
    return next;
  });
  const [submitting, setSubmitting] = useState(false);
  const [submitErr, setSubmitErr] = useState<string | null>(null);
  const questions = useMemo(() => (Array.isArray(d?.survey.questions) ? d!.survey.questions : []), [d]);
  const submit = useCallback(async () => {
    if (!d) return;
    const payload = questions.filter((q) => hasAnswer(q.type as QuestionType, answers[q.id])).map((q) => ({ questionId: q.id, value: answers[q.id] }));
    const missing = questions.filter((q) => q.required && !hasAnswer(q.type as QuestionType, answers[q.id]));
    if (!payload.length) { setSubmitErr("Answer at least one question."); return; }
    if (missing.length) { setSubmitErr(`Answer the required ${missing.length === 1 ? "question" : "questions"} first.`); return; }
    setSubmitting(true);
    setSubmitErr(null);
    const r = await apiFetchWithRetry(`/api/pulse-surveys/${d.survey.id}/respond`, { method: "POST", keepalive: true, json: { answers: payload } }, { retryWrites: true });
    setSubmitting(false);
    if (!r.ok) { setSubmitErr(r.error ? `Not sent: ${r.error}` : "Not sent. Your answers are kept on this device, try again."); return; }
    try { window.localStorage.removeItem(draftKey(d.survey.id)); } catch { /* ignore */ }
    setEditing(false);
    setDirty(false);
    toast(d.viewer.hasResponded ? "Your answers are updated" : "Thanks. Your answers are in.");
    void load();
  }, [d, questions, answers, toast, load, draftKey]);

  // ── Faces and tabs ────────────────────────────────────────────────
  const v = d?.viewer;
  const both = !!v?.canSeeResults && (!!v?.canRespond || !!v?.hasResponded);
  const tabParam = sp?.get("tab");
  const face: "respond" | "results" | "preview" = !d || !v ? "preview"
    : d.survey.status === "DRAFT" ? "preview"
      : both ? (tabParam === "results" ? "results" : tabParam === "respond" ? "respond" : v.hasResponded ? "results" : "respond")
        : v.canSeeResults && !v.canRespond && !v.hasResponded ? "results" : "respond";
  const setTab = (t: "respond" | "results") => {
    const next = new URLSearchParams(sp?.toString() ?? "");
    next.set("tab", t);
    router.replace(`${pathname}?${next}`, { scroll: false });
  };
  const showForm = face === "respond" && !!v?.canRespond && (!v.hasResponded || editing);

  useEffect(() => {
    if (!showForm) return;
    const onKey = (e: KeyboardEvent) => { if ((e.metaKey || e.ctrlKey) && e.key === "Enter") { e.preventDefault(); void submit(); } };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [showForm, submit]);

  // ── Runner actions ────────────────────────────────────────────────
  const [builder, setBuilder] = useState(false);
  const [closeDate, setCloseDate] = useState(false);
  const patch = async (body: Record<string, unknown>, ok: string) => {
    const r = await apiFetch(`/api/pulse-surveys/${id}`, { method: "PATCH", json: body });
    if (!r.ok) { toast(r.error || "Couldn't change the survey", { tone: "danger" }); return; }
    toast(ok);
    void load();
  };
  const remind = async () => {
    const r = await apiFetch<{ notified: number }>(`/api/pulse-surveys/${id}/reminders`, { method: "POST" });
    if (!r.ok) { toast(r.error || "Couldn't send a reminder", { tone: "danger" }); return; }
    toast(r.data.notified ? `Reminded ${r.data.notified} ${r.data.notified === 1 ? "person" : "people"}` : "Everyone has answered or was reminded today");
  };

  const back = { fallbackHref: "/surveys", label: "Surveys" };
  if (error && !d) {
    return (
      <>
        <OsPageHeader title="Survey" back={back} />
        <div className="mx-auto w-full max-w-[720px] px-6 py-6"><OsEmptyView variant="error" title="Couldn't load the survey" hint={error} action={{ label: "Try again", onClick: () => void load() }} /></div>
      </>
    );
  }
  if (!d || !v) {
    return (
      <>
        <OsPageHeaderSkeleton />
        <div className="mx-auto flex w-full max-w-[720px] flex-col gap-4 px-6 py-6">{[0, 1, 2].map((i) => <div key={i} className="rounded-lg border border-line p-6"><SkeletonLines lines={3} /></div>)}</div>
      </>
    );
  }

  const s = d.survey;
  const st = surveyStatusOf(s.status);
  const primary = showForm && !blockingLayerOpen && (!v.hasResponded || dirty)
    ? { label: submitting ? "Sending" : v.hasResponded ? "Update my answers" : "Submit", onClick: () => void submit() }
    : null;
  const more = v.canManage ? [
    { label: "Copy link", icon: Link2, onClick: () => { void navigator.clipboard.writeText(`${window.location.origin}/surveys/${id}`).then(() => toast("Link copied"), () => toast("Couldn't copy the link", { tone: "danger" })); } },
    ...(s.status === "DRAFT" ? [{ label: "Edit", icon: Pencil, onClick: () => setBuilder(true) }, { label: "Launch", icon: Play, onClick: () => { void confirm({ title: `Send ${s.title} now?`, description: `It goes to ${s.audience?.toLowerCase() ?? "its audience"}, and each of them is told.`, confirmLabel: "Launch", destructive: false }).then((ok) => { if (ok) void patch({ status: "ACTIVE" }, "Survey launched"); }); } }] : []),
    ...(s.status === "ACTIVE" ? [
      { label: "Change close date", icon: CalendarClock, onClick: () => setCloseDate(true) },
      { label: "Send a reminder", icon: Bell, onClick: () => void remind() },
      { label: "Close", icon: Ban, onClick: () => { void confirm({ title: `Close ${s.title}?`, description: "Nobody can answer after this. You can reopen it later.", confirmLabel: "Close", destructive: false }).then((ok) => { if (ok) void patch({ status: "CLOSED" }, "Survey closed"); }); } },
    ] : []),
    ...(s.status === "CLOSED" ? [{ label: "Reopen", icon: RotateCcw, onClick: () => { void confirm({ title: `Reopen ${s.title}?`, description: "People in the audience can answer again.", confirmLabel: "Reopen", destructive: false }).then((ok) => { if (ok) void patch({ status: "ACTIVE", ...(s.closesAt && new Date(s.closesAt).getTime() <= Date.now() ? { closesAt: null } : {}) }, "Survey reopened"); }); } }] : []),
    ...(v.canExport && !isAgent ? [{ label: "Export CSV", icon: Download, onClick: () => { window.location.href = `/api/pulse-surveys/${id}/responses/export`; } }] : []),
    ...(v.canDelete && !isAgent ? [{ separator: true as const }, { label: "Delete", icon: Trash2, destructive: true, onClick: () => { void confirm({ title: `Delete ${s.title}?`, description: "Nobody has answered it. This cannot be undone.", confirmLabel: "Delete", destructive: true }).then(async (ok) => { if (!ok) return; const r = await apiFetch(`/api/pulse-surveys/${id}`, { method: "DELETE" }); if (!r.ok) { toast(r.error || "Couldn't delete it", { tone: "danger" }); return; } toast("Survey deleted"); router.push("/surveys?view=all"); }); } }] : []),
  ] : undefined;

  return (
    <>
      <Breadcrumb items={[{ label: "Surveys", href: "/surveys" }, { label: s.title }]} />
      <OsPageHeader
        title={s.title}
        back={back}
        titleSlot={
          <>
            <h1 className="min-w-0 truncate text-title font-semibold text-ink">{s.title}</h1>
            <ToneChip tone={st.tone} label={st.label} />
            <span className="inline-flex h-6 shrink-0 items-center rounded-md border border-line bg-subtle px-2 text-xs font-medium text-ink-2">{s.anonymous ? "Anonymous" : "Attributed"}</span>
          </>
        }
        actions={primary ? (
          <button type="button" onClick={primary.onClick} disabled={submitting} className="inline-flex h-9 items-center rounded-md bg-brand px-3 text-base font-medium text-white hover:bg-brand-hover disabled:opacity-60">{primary.label}</button>
        ) : undefined}
        more={more}
      />
      <div className="min-h-0 flex-1 overflow-y-auto">
        <div className="mx-auto flex w-full max-w-[720px] flex-col gap-4 px-6 pb-10 pt-2">
          {both ? (
            <div className="flex flex-col gap-1">
              <div role="tablist" aria-label="Sections" className="flex h-9 items-center gap-1">
                <ViewTab label="Respond" active={face === "respond"} onClick={() => setTab("respond")} />
                <ViewTab label="Results" active={face === "results"} onClick={() => setTab("results")} />
              </div>
              <p className="m-0 text-sm text-ink-2">
                {v.hasResponded
                  ? face === "results" ? "You have answered. Switch to Respond to change your answers while this is open." : "You have answered. Your answers are below."
                  : face === "results" ? "You have not answered yet. Switch to Respond to answer." : "You have not answered yet. The results are under Results."}
              </p>
            </div>
          ) : null}

          {face === "preview" ? (
            <>
              <p className="m-0 rounded-md bg-subtle px-3 py-2 text-sm text-ink-2">A draft. Nobody has been sent this yet. Edit or launch it from More actions beside the title.</p>
              {questions.map((q, i) => <QuestionRenderer key={q.id} index={i} readOnly question={{ ...q, type: q.type as QuestionType }} value={undefined} onChange={() => {}} />)}
            </>
          ) : face === "results" ? (
            <SurveyResults surveyId={s.id} anonymous={s.anonymous} stats={d.stats} closesAt={s.closesAt} canRemind={v.canManage && s.status === "ACTIVE"} onRemind={() => void remind()} canExport={v.canExport && !isAgent} />
          ) : (
            <>
              <p className="m-0 text-sm text-ink-2">{questions.length} {questions.length === 1 ? "question" : "questions"} · {surveyMinutes(questions.length)}{s.closesAt ? ` · Closes ${formatDate(s.closesAt, datePrefs, "date")}` : ""}</p>
              {s.anonymous ? <AnonymityNote mode="survey" responded={v.hasResponded} /> : <p className="m-0 text-sm text-ink-2">This survey is attributed: the people who run it see your name with your answers.</p>}
              {v.hasResponded && !editing ? (
                <div className="flex items-center gap-3">
                  <h2 className="m-0 flex-1 text-lg font-semibold text-ink">Your answers</h2>
                  {v.canRespond ? <button type="button" onClick={() => setEditing(true)} className="inline-flex h-9 items-center rounded-md px-3 text-sm font-medium text-ink-2 hover:bg-hover hover:text-ink">Change my answers</button> : null}
                </div>
              ) : null}
              {!v.canRespond && !v.hasResponded ? <p className="m-0 text-sm text-ink-2">This survey is closed for answers.</p> : null}
              {questions.map((q, i) => (
                <QuestionRenderer key={q.id} index={i} question={{ ...q, type: q.type as QuestionType }} value={answers[q.id]} readOnly={!showForm} onChange={(val) => setAnswer(q.id, val)} />
              ))}
              {submitErr ? <p role="alert" className="m-0 text-sm text-danger-text">{submitErr}</p> : null}
            </>
          )}
        </div>
      </div>

      {builder ? (
        <SurveyBuilder open mode="edit" survey={s as unknown as EditableSurvey} onOpenChange={(o) => { if (!o) setBuilder(false); }}
          onSaved={(x) => { toast(x.status === "DRAFT" ? "Draft saved" : "Survey published"); void load(); }} />
      ) : null}
      {closeDate ? <ChangeCloseDateDialog surveyId={s.id} title={s.title} closesAt={s.closesAt} onClose={() => setCloseDate(false)} onSaved={() => { setCloseDate(false); void load(); }} /> : null}
    </>
  );
}

function SurveyResults({ surveyId, anonymous, stats, closesAt, canRemind, onRemind, canExport }: {
  surveyId: string; anonymous: boolean; stats: Detail["stats"]; closesAt: string | null; canRemind: boolean; onRemind: () => void; canExport: boolean;
}) {
  const datePrefs = useDatePrefs();
  const [r, setR] = useState<Results | null>(null);
  const [error, setError] = useState<string | null>(null);
  const load = useCallback(async () => {
    const x = await apiFetch<Results>(`/api/pulse-surveys/${surveyId}/responses`, { cache: "no-store" });
    if (!x.ok) { setError(x.error || "Couldn't load the results"); return; }
    setError(null);
    setR(x.data);
  }, [surveyId]);
  useEffect(() => { const t = setTimeout(() => { void load(); }, 0); return () => clearTimeout(t); }, [load]);
  useEffect(() => { const again = () => void load(); window.addEventListener("focus", again); return () => window.removeEventListener("focus", again); }, [load]);
  if (error && !r) return <OsEmptyView variant="error" title="Couldn't load the results" hint={error} action={{ label: "Try again", onClick: () => void load() }} />;
  if (!r) return <SkeletonLines lines={6} />;
  const floor = r.anonymityFloor ?? 4;
  const meta = [
    stats?.audienceSize != null ? `${r.totalResponses} of ${stats.audienceSize} answered` : `${r.totalResponses} answered`,
    stats ? `${stats.responseRate}% response rate` : null,
    closesAt ? `Closes ${formatDate(closesAt, datePrefs, "date")}` : null,
  ].filter(Boolean).join(" · ");
  if (r.totalResponses === 0) {
    return (
      <div className="flex flex-col gap-3">
        <p className="m-0 text-sm text-ink-2">{meta}</p>
        <OsEmptyView title="No answers yet" action={canRemind ? { label: "Send a reminder", onClick: onRemind } : undefined} />
      </div>
    );
  }
  if (r.belowFloor) {
    return (
      <div className="flex flex-col gap-3">
        <p className="m-0 text-sm text-ink-2">{meta}</p>
        <OsEmptyView title={`Results appear once ${floor} people have answered. ${r.totalResponses} so far.`} hint="So nobody's answer on an anonymous survey can be singled out." />
      </div>
    );
  }
  const bars = (items: Array<{ label: string; count: number }>, total: number) => {
    const top = Math.max(1, ...items.map((i) => i.count));
    return (
      <ul className="m-0 flex list-none flex-col gap-1.5 p-0">
        {items.map((i) => (
          <li key={i.label} className="grid grid-cols-[minmax(24px,120px)_1fr_72px] items-center gap-2 text-sm">
            <span className="truncate text-ink-2" title={i.label}>{i.label}</span>
            <span className="h-2 overflow-hidden rounded-full bg-subtle" aria-hidden><span className="block h-full rounded-full bg-[var(--os-ink-3)]" style={{ width: `${(i.count / top) * 100}%` }} /></span>
            <span className="text-end tabular-nums text-ink-2">{i.count} · {total ? Math.round((i.count / total) * 100) : 0}%</span>
          </li>
        ))}
      </ul>
    );
  };
  return (
    <div className="flex flex-col gap-4">
      <p className="m-0 text-sm text-ink-2">{meta}</p>
      {r.questions.map((q, i) => (
        <section key={q.questionId} className="flex flex-col gap-3 rounded-lg border border-line bg-raised p-6">
          <div className="flex items-start gap-3">
            <p className="m-0 flex-1 text-row font-medium text-ink">{i + 1}. {q.text}</p>
            <span className="shrink-0 text-xs tabular-nums text-ink-2">{q.totalAnswered} answered</span>
          </div>
          {q.belowFloor ? (
            <p className="m-0 text-sm text-ink-2">Fewer than {floor} people answered this question, so its answers stay hidden.</p>
          ) : q.kind === "rating" || q.kind === "nps" ? (
            <div className="flex items-start gap-6">
              <div className="flex flex-col">
                <span className="text-xl font-semibold tabular-nums text-ink">{q.average ?? ""}</span>
                <span className="text-xs text-ink-2">average, {q.min} to {q.max}</span>
                {q.kind === "nps" ? <NpsSplit distribution={q.distribution} total={q.totalAnswered} /> : null}
              </div>
              <div className="min-w-0 flex-1">{bars([...q.distribution].reverse().map((dd) => ({ label: String(dd.value), count: dd.count })), q.totalAnswered)}</div>
            </div>
          ) : q.kind === "text" ? (
            <ul className="m-0 flex max-h-[420px] list-none flex-col gap-2 overflow-y-auto p-0">
              {q.responses.map((a, k) => (
                <li key={k} className="rounded-md border-s-2 border-line-strong bg-subtle px-3 py-2">
                  <p className="m-0 whitespace-pre-wrap text-row text-ink">{a.value}</p>
                  {!anonymous && a.respondent ? <p className="m-0 mt-1 text-xs text-ink-2">{a.respondent.name}</p> : null}
                </li>
              ))}
            </ul>
          ) : "options" in q ? bars(q.options.map((o) => ({ label: o.value, count: o.count })), q.totalAnswered) : null}
        </section>
      ))}
      {canExport ? (
        <a href={`/api/pulse-surveys/${surveyId}/responses/export`} className="inline-flex h-9 items-center gap-2 self-start rounded-md px-3 text-sm font-medium text-ink-2 hover:bg-hover hover:text-ink"><Download className="h-4 w-4" />Export CSV</a>
      ) : null}
    </div>
  );
}

function NpsSplit({ distribution, total }: { distribution: Array<{ value: number; count: number }>; total: number }) {
  const sum = (lo: number, hi: number) => distribution.filter((d) => d.value >= lo && d.value <= hi).reduce((a, d) => a + d.count, 0);
  const pct = (n: number) => (total ? Math.round((n / total) * 100) : 0);
  const pro = pct(sum(9, 10));
  const pas = pct(sum(7, 8));
  const det = pct(sum(0, 6));
  return (
    <span className="mt-2 flex flex-col text-xs text-ink-2">
      <span className="text-sm font-medium text-ink">NPS {pro - det}</span>
      <span>Promoters {pro}% · Passives {pas}% · Detractors {det}%</span>
    </span>
  );
}
