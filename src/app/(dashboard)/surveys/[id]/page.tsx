"use client";

/* Survey detail — respond + results.
 *
 * One page, two audiences:
 *   • RESPOND — any member in the survey's audience takes it once. On an
 *     anonymous survey nothing here attaches or shows their identity.
 *   • RESULTS — managers/admins only. Aggregates per question, wired to
 *     GET /api/pulse-surveys/[id]/responses (manager-gated + org-scoped
 *     server-side) and the CSV export route. Never shows individual
 *     identities on an anonymous survey.
 *
 * Load is GET /api/pulse-surveys/[id] (org-scoped; audience-or-manager
 * gated; returns only the caller's own prior answers).
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import {
  ArrowLeft, Lock, Loader2, CheckCircle2, AlertTriangle, BarChart3, MessageSquare,
  Download, Users, Pencil, Activity, Edit3, Star, TrendingUp,
} from "lucide-react";
import { useOsToast } from "@/components/layout/os/toast";
import { SurveyBuilder, type EditableSurvey, type BuilderQuestion } from "../_components/survey-builder";

type SrStatus = "DRAFT" | "ACTIVE" | "CLOSED";
type AnswerValue = string | number | string[];
type LoadStatus = "loading" | "ok" | "notfound" | "forbidden" | "error";

/** Tagged load failure so the fetch happy-path can stay unconditional
 *  (errors flow through a single catch) — the shape the effect linter
 *  wants, and it keeps 404 vs 403 vs generic distinct for the UI. */
class LoadError extends Error {
  code: Exclude<LoadStatus, "loading" | "ok">;
  constructor(code: Exclude<LoadStatus, "loading" | "ok">) {
    super(code);
    this.code = code;
  }
}

interface Question {
  id: string;
  text: string;
  type: string;
  options?: string[];
}
interface Answer {
  questionId: string;
  value: AnswerValue;
}

interface DetailResp {
  survey: {
    id: string;
    title: string;
    questions: Question[];
    status: SrStatus;
    anonymous: boolean;
    audienceType: string;
    officeIds?: string[];
    departmentIds?: string[];
    frequency: string | null;
    closesAt: string | null;
    closedAt: string | null;
    createdAt: string;
  };
  viewer: { inAudience: boolean; isManager: boolean; hasResponded: boolean };
  myAnswers: Answer[] | null;
  stats: { audienceSize: number; totalResponses: number; responseRate: number };
}

type ResultQuestion =
  | {
      questionId: string; text: string; kind: "rating" | "nps"; totalAnswered: number;
      min: number; max: number; average: number | null;
      distribution: { value: number; count: number }[];
    }
  | {
      questionId: string; text: string; kind: "single_choice" | "multi_choice" | "yes_no";
      totalAnswered: number; options: { value: string; count: number }[];
    }
  | {
      questionId: string; text: string; kind: "text"; totalAnswered: number;
      responses: { value: string; createdAt: string; respondent: { id: string; name: string } | null }[];
    };

interface ResultsResp {
  survey: { id: string; title: string; status: string; anonymous: boolean };
  totalResponses: number;
  summary: { npsScore: number | null; firstResponseAt: string | null; lastResponseAt: string | null };
  questions: ResultQuestion[];
}

const STATUS_META: Record<SrStatus, { label: string; hue: string; Icon: typeof Activity }> = {
  DRAFT: { label: "Draft", hue: "var(--os-c-darkgray, var(--os-ink-3))", Icon: Edit3 },
  ACTIVE: { label: "Active", hue: "var(--os-c-orange)", Icon: Activity },
  CLOSED: { label: "Closed", hue: "var(--os-c-green)", Icon: CheckCircle2 },
};

function fmtDate(iso: string | null | undefined): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}

export default function SurveyDetailPage() {
  const params = useParams<{ id: string }>();
  const id = params?.id;
  const { toast } = useOsToast();

  const [data, setData] = useState<DetailResp | null>(null);
  const [status, setStatus] = useState<LoadStatus>("loading");
  const [tab, setTab] = useState<"respond" | "results">("respond");
  const [editing, setEditing] = useState(false);

  const load = useCallback(async () => {
    if (!id) return;
    try {
      const res = await fetch(`/api/pulse-surveys/${id}`);
      if (res.status === 404) throw new LoadError("notfound");
      if (res.status === 403) throw new LoadError("forbidden");
      if (!res.ok) throw new LoadError("error");
      const json = (await res.json()) as DetailResp;
      setData(json);
      // Managers who can't (or don't need to) respond start on Results.
      const startResults =
        json.viewer.isManager &&
        (!json.viewer.inAudience || json.viewer.hasResponded || json.survey.status !== "ACTIVE");
      setTab((prev) => (prev === "respond" && startResults ? "results" : prev));
      setStatus("ok");
    } catch (e) {
      setStatus(e instanceof LoadError ? e.code : "error");
    }
  }, [id]);

  useEffect(() => { void load(); }, [load]);

  if (status === "loading") {
    return <Centered><Loader2 className="w-4 h-4 animate-spin" /> Loading survey…</Centered>;
  }
  if (status === "notfound") {
    return <StatePanel Icon={AlertTriangle} title="Survey not found" subtitle="It may have been deleted, or it belongs to another workspace." />;
  }
  if (status === "forbidden") {
    return <StatePanel Icon={Lock} title="No access to this survey" subtitle="You're not in this survey's audience." />;
  }
  if (status === "error" || !data) {
    return <StatePanel Icon={AlertTriangle} title="Couldn't load the survey" subtitle="Please try again." onRetry={() => { setStatus("loading"); void load(); }} />;
  }

  const { survey, viewer, stats } = data;
  const sm = STATUS_META[survey.status];
  const canRespond = viewer.inAudience;
  const canSeeResults = viewer.isManager;
  const showTabs = canRespond && canSeeResults;

  const editable: EditableSurvey = {
    id: survey.id,
    title: survey.title,
    questions: survey.questions as BuilderQuestion[],
    audienceType: survey.audienceType,
    officeIds: survey.officeIds ?? [],
    departmentIds: survey.departmentIds ?? [],
    anonymous: survey.anonymous,
    frequency: survey.frequency,
    closesAt: survey.closesAt,
  };

  return (
    <>
      {/* Header */}
      <div className="px-7 pt-4 pb-3 bg-white border-b border-[var(--os-line)]">
        <Link href="/surveys" className="inline-flex items-center gap-1.5 text-[12px] text-[var(--os-ink-3)] hover:text-[var(--os-ink)] mb-2">
          <ArrowLeft className="w-3.5 h-3.5" /> All surveys
        </Link>
        <div className="flex items-start gap-3 flex-wrap">
          <div className="min-w-0 flex-1">
            <h1 className="text-[17px] font-semibold text-[var(--os-ink)] leading-tight truncate">{survey.title}</h1>
            <div className="mt-1.5 flex items-center gap-2 flex-wrap text-[11.5px]">
              <span className="inline-flex items-center gap-1 font-semibold px-2 py-0.5 rounded-full" style={{ color: sm.hue, background: "color-mix(in srgb, currentColor 12%, transparent)" }}>
                <sm.Icon className="w-3 h-3" /> {sm.label}
              </span>
              {survey.anonymous ? (
                <span className="inline-flex items-center gap-1 text-[var(--os-ink-3)] font-medium px-2 py-0.5 rounded-full bg-[var(--os-surface-1)] border border-[var(--os-line)]">
                  <Lock className="w-3 h-3" /> Anonymous
                </span>
              ) : (
                <span className="inline-flex items-center gap-1 text-[var(--os-ink-3)] font-medium px-2 py-0.5 rounded-full bg-[var(--os-surface-1)] border border-[var(--os-line)]">
                  <Users className="w-3 h-3" /> Attributed
                </span>
              )}
              <span className="text-[var(--os-ink-4)]">{survey.questions.length} question{survey.questions.length === 1 ? "" : "s"}</span>
              {survey.closesAt ? <span className="text-[var(--os-ink-4)]">· Closes {fmtDate(survey.closesAt)}</span> : null}
            </div>
          </div>
          {canSeeResults ? (
            <button
              type="button"
              onClick={() => setEditing(true)}
              className="inline-flex items-center gap-1.5 h-8 px-3 rounded-lg border border-[var(--os-line)] text-[12.5px] text-[var(--os-ink-2)] hover:bg-[var(--os-surface-1)]"
            >
              <Pencil className="w-3.5 h-3.5" /> Edit
            </button>
          ) : null}
        </div>

        {showTabs ? (
          <div className="mt-3 flex items-center gap-1">
            <TabButton active={tab === "respond"} onClick={() => setTab("respond")} Icon={MessageSquare} label="Respond" />
            <TabButton active={tab === "results"} onClick={() => setTab("results")} Icon={BarChart3} label="Results" />
          </div>
        ) : null}
      </div>

      {/* Body */}
      <div className="px-7 pt-5 pb-16 max-w-[860px] mx-auto">
        {(!showTabs || tab === "respond") && canRespond ? (
          <RespondPanel
            key={`respond-${survey.status}-${viewer.hasResponded}`}
            survey={survey}
            viewer={viewer}
            myAnswers={data.myAnswers}
            onSubmitted={load}
          />
        ) : null}

        {(!showTabs || tab === "results") && canSeeResults ? (
          <ResultsPanel surveyId={survey.id} anonymous={survey.anonymous} stats={stats} />
        ) : null}

        {!canRespond && !canSeeResults ? (
          <StatePanel Icon={Lock} title="Nothing to show" subtitle="You don't have access to respond to or view this survey." inline />
        ) : null}
      </div>

      {editing ? (
        <SurveyBuilder
          open={editing}
          mode="edit"
          survey={editable}
          onClose={() => setEditing(false)}
          onSaved={(msg) => { toast(msg); void load(); }}
        />
      ) : null}
    </>
  );
}

/* ─────────────────────────── Respond ─────────────────────────── */

function RespondPanel({
  survey,
  viewer,
  myAnswers,
  onSubmitted,
}: {
  survey: DetailResp["survey"];
  viewer: DetailResp["viewer"];
  myAnswers: Answer[] | null;
  onSubmitted: () => void | Promise<void>;
}) {
  const { toast } = useOsToast();
  const initial = useMemo<Record<string, AnswerValue>>(() => {
    const m: Record<string, AnswerValue> = {};
    if (Array.isArray(myAnswers)) {
      for (const a of myAnswers) {
        if (a && typeof a.questionId === "string") m[a.questionId] = a.value;
      }
    }
    return m;
  }, [myAnswers]);

  // Initialized once from props; the parent remounts this panel (via key)
  // whenever the responded/status state changes, so no prop→state sync
  // effect is needed.
  const [values, setValues] = useState<Record<string, AnswerValue>>(initial);
  const [submitting, setSubmitting] = useState(false);
  const [done, setDone] = useState(viewer.hasResponded);

  const isOpen = survey.status === "ACTIVE";

  function setValue(qid: string, value: AnswerValue) {
    setValues((v) => ({ ...v, [qid]: value }));
  }
  function toggleMulti(qid: string, option: string) {
    setValues((v) => {
      const cur = Array.isArray(v[qid]) ? (v[qid] as string[]) : [];
      const next = cur.includes(option) ? cur.filter((o) => o !== option) : [...cur, option];
      return { ...v, [qid]: next };
    });
  }

  async function submit() {
    const answers: Answer[] = [];
    for (const q of survey.questions) {
      const v = values[q.id];
      const empty = v === undefined || v === "" || (Array.isArray(v) && v.length === 0);
      if (!empty) answers.push({ questionId: q.id, value: v });
    }
    if (answers.length === 0) { toast("Answer at least one question first"); return; }

    setSubmitting(true);
    try {
      const res = await fetch(`/api/pulse-surveys/${survey.id}/respond`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ answers }),
      });
      if (!res.ok) {
        let msg = "Couldn't submit your response.";
        try { const j = await res.json(); if (j?.error) msg = j.error; } catch { /* keep default */ }
        toast(msg);
        return;
      }
      setDone(true);
      toast(viewer.hasResponded ? "Response updated" : "Response submitted — thank you");
      await onSubmitted();
    } catch {
      toast("Network error — couldn't submit.");
    } finally {
      setSubmitting(false);
    }
  }

  if (!isOpen) {
    const isDraft = survey.status === "DRAFT";
    return (
      <div className="flex flex-col gap-4">
        <div className="rounded-xl border border-[var(--os-line)] bg-[var(--os-surface-1)] p-5 text-center">
          {isDraft ? <Edit3 className="w-6 h-6 mx-auto text-[var(--os-ink-3)]" /> : <CheckCircle2 className="w-6 h-6 mx-auto text-[var(--os-c-green)]" />}
          <div className="mt-2 text-[14px] font-semibold text-[var(--os-ink)]">
            {isDraft ? "This survey isn't open yet" : "This survey is closed"}
          </div>
          <div className="mt-1 text-[12.5px] text-[var(--os-ink-3)]">
            {isDraft
              ? "It hasn't been launched, so it's not collecting responses."
              : done ? "Your response was recorded. Thanks for taking part." : "It's no longer collecting responses."}
          </div>
        </div>
        {done && !isDraft ? <ReadonlyAnswers survey={survey} values={values} /> : null}
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      {survey.anonymous ? (
        <div className="flex items-start gap-2 rounded-lg border border-[var(--os-line)] bg-[var(--os-surface-1)] px-3.5 py-2.5">
          <Lock className="w-4 h-4 mt-[1px] text-[var(--os-brand-deep)] shrink-0" />
          <div className="text-[12.5px] text-[var(--os-ink-2)]">
            <span className="font-semibold text-[var(--os-ink)]">This survey is anonymous.</span> Your name is never attached to your answers. Managers only ever see combined results.
          </div>
        </div>
      ) : (
        <div className="flex items-start gap-2 rounded-lg border border-[var(--os-line)] bg-[var(--os-surface-1)] px-3.5 py-2.5">
          <Users className="w-4 h-4 mt-[1px] text-[var(--os-ink-3)] shrink-0" />
          <div className="text-[12.5px] text-[var(--os-ink-2)]">
            <span className="font-semibold text-[var(--os-ink)]">This survey is attributed.</span> Your responses are linked to your name for managers.
          </div>
        </div>
      )}

      {done ? (
        <div className="flex items-center gap-2 rounded-lg border border-[color:var(--os-c-green)]/40 bg-[color:var(--os-c-green)]/10 px-3.5 py-2.5 text-[12.5px] text-[var(--os-c-green)]">
          <CheckCircle2 className="w-4 h-4 shrink-0" />
          <span>You&rsquo;ve responded. You can update your answers below while the survey is open.</span>
        </div>
      ) : null}

      <div className="flex flex-col gap-3">
        {survey.questions.map((q, i) => (
          <QuestionField
            key={q.id}
            index={i}
            question={q}
            value={values[q.id]}
            onScalar={(v) => setValue(q.id, v)}
            onToggleMulti={(opt) => toggleMulti(q.id, opt)}
          />
        ))}
      </div>

      <div className="flex items-center justify-end gap-2 pt-1">
        <button
          type="button"
          onClick={submit}
          disabled={submitting}
          className="inline-flex items-center gap-1.5 h-9 px-4 rounded-lg bg-[var(--os-brand)] text-white text-[13px] font-medium hover:bg-[var(--os-brand-hover)] disabled:opacity-60"
        >
          {submitting ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : null}
          {done ? "Update response" : "Submit response"}
        </button>
      </div>
    </div>
  );
}

function QuestionField({
  index,
  question,
  value,
  onScalar,
  onToggleMulti,
}: {
  index: number;
  question: Question;
  value: AnswerValue | undefined;
  onScalar: (v: AnswerValue) => void;
  onToggleMulti: (option: string) => void;
}) {
  const num = typeof value === "number" ? value : undefined;
  const str = typeof value === "string" ? value : "";
  const arr = Array.isArray(value) ? value : [];

  return (
    <div className="rounded-xl border border-[var(--os-line)] bg-white p-4">
      <div className="flex items-baseline gap-2">
        <span className="text-[11px] font-semibold text-[var(--os-ink-4)] tabular-nums">{index + 1}</span>
        <div className="text-[13.5px] font-medium text-[var(--os-ink)]">{question.text}</div>
      </div>
      <div className="mt-3">
        {question.type === "rating" ? (
          <ScaleRow min={1} max={5} value={num} onPick={(n) => onScalar(n)} labelLeft="Poor" labelRight="Great" stars />
        ) : question.type === "nps" ? (
          <ScaleRow min={0} max={10} value={num} onPick={(n) => onScalar(n)} labelLeft="Not likely" labelRight="Very likely" />
        ) : question.type === "yes_no" ? (
          <div className="flex gap-2">
            {["Yes", "No"].map((opt) => (
              <OptionChip key={opt} active={str === opt} label={opt} onClick={() => onScalar(opt)} />
            ))}
          </div>
        ) : question.type === "single_choice" ? (
          <div className="flex flex-col gap-1.5">
            {(question.options ?? []).map((opt) => (
              <ChoiceRow key={opt} active={str === opt} label={opt} kind="radio" onClick={() => onScalar(opt)} />
            ))}
          </div>
        ) : question.type === "multi_choice" ? (
          <div className="flex flex-col gap-1.5">
            {(question.options ?? []).map((opt) => (
              <ChoiceRow key={opt} active={arr.includes(opt)} label={opt} kind="check" onClick={() => onToggleMulti(opt)} />
            ))}
          </div>
        ) : (
          <textarea
            value={str}
            onChange={(e) => onScalar(e.target.value)}
            placeholder="Type your answer…"
            rows={3}
            className="w-full rounded-lg border border-[var(--os-line)] bg-[var(--os-surface-1)] px-3 py-2 text-[13px] leading-relaxed text-[var(--os-ink)] placeholder:text-[var(--os-ink-4)] outline-none resize-y focus:border-[var(--os-brand)]"
          />
        )}
      </div>
    </div>
  );
}

function ScaleRow({
  min, max, value, onPick, labelLeft, labelRight, stars,
}: {
  min: number; max: number; value: number | undefined;
  onPick: (n: number) => void; labelLeft: string; labelRight: string; stars?: boolean;
}) {
  const nums: number[] = [];
  for (let n = min; n <= max; n++) nums.push(n);
  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex flex-wrap gap-1.5">
        {nums.map((n) => {
          const active = value === n;
          return (
            <button
              key={n}
              type="button"
              onClick={() => onPick(n)}
              aria-label={`${n}`}
              className={`h-9 min-w-9 px-2 inline-flex items-center justify-center gap-1 rounded-lg border text-[13px] font-medium transition-colors ${
                active
                  ? "border-[var(--os-brand)] bg-[var(--os-brand-soft)] text-[var(--os-brand-deep)]"
                  : "border-[var(--os-line)] text-[var(--os-ink-2)] hover:bg-[var(--os-surface-1)]"
              }`}
            >
              {stars ? <Star className={`w-3.5 h-3.5 ${active ? "fill-current" : ""}`} /> : null}
              {n}
            </button>
          );
        })}
      </div>
      <div className="flex justify-between text-[10.5px] text-[var(--os-ink-4)] px-0.5">
        <span>{labelLeft}</span>
        <span>{labelRight}</span>
      </div>
    </div>
  );
}

function OptionChip({ active, label, onClick }: { active: boolean; label: string; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`h-9 px-4 rounded-lg border text-[13px] font-medium transition-colors ${
        active
          ? "border-[var(--os-brand)] bg-[var(--os-brand-soft)] text-[var(--os-brand-deep)]"
          : "border-[var(--os-line)] text-[var(--os-ink-2)] hover:bg-[var(--os-surface-1)]"
      }`}
    >
      {label}
    </button>
  );
}

function ChoiceRow({ active, label, kind, onClick }: { active: boolean; label: string; kind: "radio" | "check"; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`flex items-center gap-2.5 h-10 px-3 rounded-lg border text-[13px] transition-colors text-left ${
        active
          ? "border-[var(--os-brand)] bg-[var(--os-brand-soft)] text-[var(--os-brand-deep)] font-medium"
          : "border-[var(--os-line)] text-[var(--os-ink-2)] hover:bg-[var(--os-surface-1)]"
      }`}
    >
      <span
        className={`inline-flex items-center justify-center w-4 h-4 shrink-0 border ${kind === "radio" ? "rounded-full" : "rounded"} ${
          active ? "border-[var(--os-brand)] bg-[var(--os-brand)]" : "border-[var(--os-line-strong,var(--os-line))]"
        }`}
      >
        {active ? <CheckCircle2 className="w-3 h-3 text-white" /> : null}
      </span>
      {label}
    </button>
  );
}

function ReadonlyAnswers({ survey, values }: { survey: DetailResp["survey"]; values: Record<string, AnswerValue> }) {
  const answered = survey.questions.filter((q) => {
    const v = values[q.id];
    return v !== undefined && v !== "" && !(Array.isArray(v) && v.length === 0);
  });
  if (answered.length === 0) return null;
  return (
    <div className="flex flex-col gap-2">
      <div className="text-[11px] font-semibold uppercase tracking-wide text-[var(--os-ink-4)]">Your answers</div>
      {answered.map((q) => {
        const v = values[q.id];
        const display = Array.isArray(v) ? v.join(", ") : String(v);
        return (
          <div key={q.id} className="rounded-lg border border-[var(--os-line)] bg-white p-3">
            <div className="text-[12.5px] font-medium text-[var(--os-ink)]">{q.text}</div>
            <div className="mt-1 text-[13px] text-[var(--os-ink-2)]">{display}</div>
          </div>
        );
      })}
    </div>
  );
}

/* ─────────────────────────── Results ─────────────────────────── */

function ResultsPanel({
  surveyId,
  anonymous,
  stats,
}: {
  surveyId: string;
  anonymous: boolean;
  stats: DetailResp["stats"];
}) {
  const [results, setResults] = useState<ResultsResp | null>(null);
  const [state, setState] = useState<"loading" | "ok" | "error">("loading");

  const load = useCallback(async () => {
    try {
      const res = await fetch(`/api/pulse-surveys/${surveyId}/responses`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const json = (await res.json()) as ResultsResp;
      setResults(json);
      setState("ok");
    } catch {
      setState("error");
    }
  }, [surveyId]);

  useEffect(() => { void load(); }, [load]);

  if (state === "loading") return <Centered inline><Loader2 className="w-4 h-4 animate-spin" /> Loading results…</Centered>;
  if (state === "error" || !results) {
    return <StatePanel Icon={AlertTriangle} title="Couldn't load results" subtitle="Please try again." inline onRetry={() => { setState("loading"); void load(); }} />;
  }

  const total = results.totalResponses;

  return (
    <div className="flex flex-col gap-4">
      {/* Summary strip */}
      <div className="flex flex-wrap items-stretch gap-2.5">
        <StatTile label="Responses" value={String(total)} sub={stats.audienceSize > 0 ? `of ${stats.audienceSize}` : "collected"} Icon={MessageSquare} />
        <StatTile label="Participation" value={`${stats.responseRate}%`} sub="of audience" Icon={Users} />
        {results.summary.npsScore !== null ? (
          <StatTile label="NPS" value={String(results.summary.npsScore)} sub="promoters − detractors" Icon={TrendingUp} />
        ) : null}
        <div className="flex-1 min-w-[120px]" />
        <a
          href={`/api/pulse-surveys/${surveyId}/responses/export`}
          className={`self-center inline-flex items-center gap-1.5 h-9 px-3.5 rounded-lg border text-[12.5px] font-medium ${
            total > 0
              ? "border-[var(--os-line)] text-[var(--os-ink-2)] hover:bg-[var(--os-surface-1)]"
              : "border-[var(--os-line)] text-[var(--os-ink-4)] pointer-events-none opacity-50"
          }`}
          {...(total > 0 ? {} : { "aria-disabled": true, tabIndex: -1 })}
        >
          <Download className="w-3.5 h-3.5" /> Export CSV
        </a>
      </div>

      {anonymous ? (
        <div className="flex items-start gap-2 rounded-lg border border-[var(--os-line)] bg-[var(--os-surface-1)] px-3.5 py-2.5 text-[12px] text-[var(--os-ink-3)]">
          <Lock className="w-3.5 h-3.5 mt-[1px] shrink-0" />
          <span>Anonymous survey — only combined results are shown. Individual respondents are never identified.</span>
        </div>
      ) : null}

      {total === 0 ? (
        <StatePanel Icon={BarChart3} title="No responses yet" subtitle="Results appear here as people respond." inline />
      ) : (
        <div className="flex flex-col gap-3">
          {results.questions.map((q) => <ResultCard key={q.questionId} q={q} anonymous={anonymous} />)}
        </div>
      )}
    </div>
  );
}

function ResultCard({ q, anonymous }: { q: ResultQuestion; anonymous: boolean }) {
  return (
    <div className="rounded-xl border border-[var(--os-line)] bg-white p-4">
      <div className="flex items-start justify-between gap-3">
        <div className="text-[13.5px] font-medium text-[var(--os-ink)]">{q.text}</div>
        <span className="shrink-0 text-[11px] text-[var(--os-ink-4)] tabular-nums">{q.totalAnswered} answered</span>
      </div>

      <div className="mt-3">
        {/* switch narrows the discriminated union reliably where a nested
            ternary did not (TS widened `q` back in the final else). */}
        {(() => {
          switch (q.kind) {
            case "rating":
            case "nps":
              return <RatingResult q={q} />;
            case "text":
              return <TextResult responses={q.responses} anonymous={anonymous} />;
            default:
              return <ChoiceResult options={q.options} total={q.totalAnswered} />;
          }
        })()}
      </div>
    </div>
  );
}

function RatingResult({ q }: { q: Extract<ResultQuestion, { kind: "rating" | "nps" }> }) {
  const maxCount = Math.max(1, ...q.distribution.map((d) => d.count));
  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-end gap-2">
        <span className="text-[26px] font-bold text-[var(--os-ink)] leading-none tabular-nums">{q.average ?? "—"}</span>
        <span className="text-[12px] text-[var(--os-ink-4)] mb-0.5">avg · {q.min}–{q.max}</span>
      </div>
      <div className="flex flex-col gap-1.5">
        {q.distribution.map((d) => {
          const pct = q.totalAnswered > 0 ? Math.round((d.count / q.totalAnswered) * 100) : 0;
          return (
            <div key={d.value} className="flex items-center gap-2">
              <span className="w-6 text-right text-[11.5px] text-[var(--os-ink-3)] tabular-nums">{d.value}</span>
              <div className="flex-1 h-4 rounded bg-[var(--os-surface-1)] overflow-hidden">
                <div className="h-full rounded bg-[var(--os-brand)]" style={{ width: `${(d.count / maxCount) * 100}%` }} />
              </div>
              <span className="w-16 text-[11px] text-[var(--os-ink-4)] tabular-nums text-right">{d.count} · {pct}%</span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function ChoiceResult({ options, total }: { options: { value: string; count: number }[]; total: number }) {
  const maxCount = Math.max(1, ...options.map((o) => o.count));
  return (
    <div className="flex flex-col gap-1.5">
      {options.map((o) => {
        const pct = total > 0 ? Math.round((o.count / total) * 100) : 0;
        return (
          <div key={o.value} className="flex items-center gap-2">
            <span className="w-28 truncate text-[12px] text-[var(--os-ink-2)]" title={o.value}>{o.value}</span>
            <div className="flex-1 h-4 rounded bg-[var(--os-surface-1)] overflow-hidden">
              <div className="h-full rounded bg-[var(--os-brand)]" style={{ width: `${(o.count / maxCount) * 100}%` }} />
            </div>
            <span className="w-16 text-[11px] text-[var(--os-ink-4)] tabular-nums text-right">{o.count} · {pct}%</span>
          </div>
        );
      })}
    </div>
  );
}

function TextResult({
  responses,
  anonymous,
}: {
  responses: { value: string; createdAt: string; respondent: { id: string; name: string } | null }[];
  anonymous: boolean;
}) {
  if (responses.length === 0) return <div className="text-[12px] text-[var(--os-ink-4)]">No text responses.</div>;
  return (
    <div className="flex flex-col gap-2">
      {responses.map((r, i) => (
        <div key={i} className="rounded-lg border border-[var(--os-line)] bg-[var(--os-surface-1)] px-3 py-2">
          <div className="text-[12.5px] text-[var(--os-ink)] whitespace-pre-wrap break-words">{r.value}</div>
          <div className="mt-1 text-[10.5px] text-[var(--os-ink-4)]">
            {!anonymous && r.respondent ? r.respondent.name : "Anonymous"} · {fmtDate(r.createdAt)}
          </div>
        </div>
      ))}
    </div>
  );
}

/* ─────────────────────────── Shared bits ─────────────────────────── */

function TabButton({ active, onClick, Icon, label }: { active: boolean; onClick: () => void; Icon: typeof Activity; label: string }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`inline-flex items-center gap-1.5 h-8 px-3 rounded-lg text-[12.5px] font-medium transition-colors ${
        active
          ? "bg-[var(--os-brand-soft)] text-[var(--os-brand-deep)]"
          : "text-[var(--os-ink-3)] hover:bg-[var(--os-surface-1)]"
      }`}
    >
      <Icon className="w-3.5 h-3.5" /> {label}
    </button>
  );
}

function StatTile({ label, value, sub, Icon }: { label: string; value: string; sub: string; Icon: typeof Activity }) {
  return (
    <div className="rounded-xl border border-[var(--os-line)] bg-white px-3.5 py-2.5 min-w-[130px]">
      <div className="flex items-center gap-1.5 text-[10.5px] font-semibold uppercase tracking-wide text-[var(--os-ink-4)]">
        <Icon className="w-3 h-3" /> {label}
      </div>
      <div className="mt-1 text-[20px] font-bold text-[var(--os-ink)] leading-none tabular-nums">{value}</div>
      <div className="mt-0.5 text-[11px] text-[var(--os-ink-4)]">{sub}</div>
    </div>
  );
}

function Centered({ children, inline }: { children: React.ReactNode; inline?: boolean }) {
  return (
    <div className={`flex items-center justify-center gap-2 text-[13px] text-[var(--os-ink-3)] ${inline ? "py-16" : "h-full py-24"}`}>
      {children}
    </div>
  );
}

function StatePanel({
  Icon,
  title,
  subtitle,
  onRetry,
  inline,
}: {
  Icon: typeof Activity;
  title: string;
  subtitle: string;
  onRetry?: () => void;
  inline?: boolean;
}) {
  return (
    <div className={`flex flex-col items-center justify-center text-center gap-2 ${inline ? "py-16" : "h-full py-24"}`}>
      <div className="w-11 h-11 rounded-xl bg-[var(--os-surface-1)] border border-[var(--os-line)] flex items-center justify-center text-[var(--os-ink-3)]">
        <Icon className="w-5 h-5" />
      </div>
      <div className="text-[14px] font-semibold text-[var(--os-ink)]">{title}</div>
      <div className="text-[12.5px] text-[var(--os-ink-3)] max-w-[340px]">{subtitle}</div>
      {onRetry ? (
        <button
          type="button"
          onClick={onRetry}
          className="mt-1 h-8 px-3 rounded-lg border border-[var(--os-line)] text-[12.5px] text-[var(--os-ink-2)] hover:bg-[var(--os-surface-1)]"
        >
          Retry
        </button>
      ) : null}
    </div>
  );
}
