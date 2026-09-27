// Pulse surveys: questions, answers and the moves (spec-teams-performance
// /surveys and /surveys/[id]). Pure.
//
// Worst cases decided here:
//   - Questions and anonymity freeze once the first answer exists: every
//     stored answer is keyed to a question id and an option's words, and a
//     survey promised anonymous can never be flipped to attributed after
//     people answered under that promise.
//   - An answer to a question the survey does not have is dropped, and each
//     value is bounded to its type (a rating 1 to 5, NPS 0 to 10, a choice
//     one of the survey's own options).
//   - Closed reopens to Open, never back to Draft; Draft launches to Open.

export type SurveyQuestionType = "rating" | "nps" | "yes_no" | "single_choice" | "multi_choice" | "text";
export type SurveyQuestion = { id: string; text: string; type: SurveyQuestionType; options?: string[]; required?: boolean };

export const SURVEY_QUESTION_TYPES: Array<{ value: SurveyQuestionType; label: string; hasOptions: boolean }> = [
  { value: "rating", label: "Rating 1 to 5", hasOptions: false },
  { value: "nps", label: "NPS 0 to 10", hasOptions: false },
  { value: "yes_no", label: "Yes or no", hasOptions: false },
  { value: "single_choice", label: "Pick one", hasOptions: true },
  { value: "multi_choice", label: "Pick several", hasOptions: true },
  { value: "text", label: "Free text", hasOptions: false },
];
const TYPES = new Set(SURVEY_QUESTION_TYPES.map((t) => t.value));

/** Builder input to stored questions, or the reason it cannot be saved. */
export function cleanSurveyQuestions(raw: unknown): { ok: true; questions: SurveyQuestion[] } | { ok: false; error: string } {
  if (!Array.isArray(raw)) return { ok: false, error: "Questions are required" };
  const used = new Set<string>();
  const out: SurveyQuestion[] = [];
  for (let i = 0; i < raw.length; i += 1) {
    const q = raw[i];
    if (!q || typeof q !== "object") continue;
    const o = q as Record<string, unknown>;
    const text = typeof o.text === "string" ? o.text.trim().slice(0, 1000) : "";
    if (!text) continue;
    const type = typeof o.type === "string" && TYPES.has(o.type as SurveyQuestionType) ? (o.type as SurveyQuestionType) : "text";
    let id = typeof o.id === "string" && o.id.trim() ? o.id.trim().slice(0, 64) : `q${i + 1}`;
    while (used.has(id)) id = `${id}x`;
    used.add(id);
    const item: SurveyQuestion = { id, text, type };
    if (type === "single_choice" || type === "multi_choice") {
      const opts = Array.isArray(o.options) ? [...new Set(o.options.filter((x): x is string => typeof x === "string").map((x) => x.trim().slice(0, 300)).filter(Boolean))] : [];
      if (opts.length < 2) return { ok: false, error: `"${text}" needs at least two options` };
      item.options = opts.slice(0, 50);
    }
    if (o.required === true) item.required = true;
    out.push(item);
  }
  if (!out.length) return { ok: false, error: "At least one question is required" };
  return { ok: true, questions: out.slice(0, 100) };
}

/** A respondent's answers kept only for the survey's own questions, bounded to each type. */
export function cleanSurveyAnswers(raw: unknown, questions: readonly SurveyQuestion[]): Array<{ questionId: string; value: string | number | string[] }> {
  if (!Array.isArray(raw)) return [];
  const byId = new Map(questions.map((q) => [q.id, q] as const));
  const seen = new Set<string>();
  const out: Array<{ questionId: string; value: string | number | string[] }> = [];
  for (const a of raw) {
    if (!a || typeof a !== "object") continue;
    const questionId = (a as { questionId?: unknown }).questionId;
    const value = (a as { value?: unknown }).value;
    if (typeof questionId !== "string" || seen.has(questionId)) continue;
    const q = byId.get(questionId);
    if (!q) continue;
    let v: string | number | string[] | null = null;
    if (q.type === "rating" || q.type === "nps") {
      const n = Number(value);
      const [lo, hi] = q.type === "rating" ? [1, 5] : [0, 10];
      v = Number.isInteger(n) && n >= lo && n <= hi ? n : null;
    } else if (q.type === "yes_no") {
      v = value === "Yes" || value === true ? "Yes" : value === "No" || value === false ? "No" : null;
    } else if (q.type === "single_choice") {
      v = typeof value === "string" && (q.options ?? []).includes(value) ? value : null;
    } else if (q.type === "multi_choice") {
      const picks = Array.isArray(value) ? value.filter((x): x is string => typeof x === "string" && (q.options ?? []).includes(x)) : [];
      v = picks.length ? [...new Set(picks)] : null;
    } else {
      v = typeof value === "string" && value.trim() ? value.slice(0, 5000) : null;
    }
    if (v == null) continue;
    seen.add(questionId);
    out.push({ questionId, value: v });
  }
  return out;
}

/** The required questions an answer set leaves empty. */
export function missingRequired(questions: readonly SurveyQuestion[], answers: ReadonlyArray<{ questionId: string }>): string[] {
  const have = new Set(answers.map((a) => a.questionId));
  return questions.filter((q) => q.required && !have.has(q.id)).map((q) => q.text);
}

export function surveyTransitionBlocked(from: string, to: string): string | null {
  if (from === to) return null;
  if (to === "ACTIVE") return from === "DRAFT" || from === "CLOSED" ? null : "Unknown status";
  if (to === "CLOSED") return from === "ACTIVE" ? null : "Only an open survey can close";
  if (to === "DRAFT") return "A survey cannot go back to draft";
  return "Unknown status";
}

export function surveyStatusOf(s: string): { label: string; tone: "neutral" | "info" } {
  if (s === "ACTIVE") return { label: "Open", tone: "info" };
  if (s === "CLOSED") return { label: "Closed", tone: "neutral" };
  return { label: "Draft", tone: "neutral" };
}

/** "about 2 minutes" for a question count (15 seconds a question, rounded up). */
export function surveyMinutes(count: number): string {
  const m = Math.max(1, Math.ceil((count * 15) / 60));
  return m === 1 ? "about a minute" : `about ${m} minutes`;
}
