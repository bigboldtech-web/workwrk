"use client";

// QuestionRenderer (spec-teams-performance section 3): ONE place decides how
// a question looks, so candor and surveys never drift again.
//   rating                the 1 to 5 RatingScale with its end words (never
//                         five stars: a star scale reads as a product review)
//   nps                   eleven 36px segments 0 to 10, "Not at all likely"
//                         and "Extremely likely" under the ends
//   yes_no                two 36px secondary buttons (stored "Yes" or "No")
//   single / multi        radio or checkbox rows, 36px (the stored value is
//                         the option's words, or a list of them, which is
//                         what the survey results count; single_choice and
//                         multi_choice are the survey names for the same)
//   text                  a 3 row auto-growing textarea
//   start_stop_continue   three labelled textareas
// Required questions say "(required)" in words, never a red asterisk.

import { RatingScale } from "./rating-scale";
import { cn } from "@/lib/utils";

export type QuestionType = "rating" | "nps" | "yes_no" | "single" | "multi" | "single_choice" | "multi_choice" | "text" | "start_stop_continue";
export interface RenderQuestion {
  id: string;
  text: string;
  type: QuestionType;
  options?: string[];
  required?: boolean;
}

const RATING_WORDS = ["Very poor", "Poor", "Okay", "Good", "Great"];

function Area({ value, onChange, readOnly, label }: { value: string; onChange: (v: string) => void; readOnly?: boolean; label: string }) {
  if (readOnly) return <p className="m-0 whitespace-pre-wrap text-row text-ink">{value || <span className="text-ink-3">No answer</span>}</p>;
  return (
    <textarea
      aria-label={label}
      value={value}
      rows={3}
      maxLength={5000}
      onChange={(e) => onChange(e.target.value)}
      className="min-h-[76px] w-full resize-y rounded-md border border-line bg-raised px-3 py-2 text-row text-ink outline-none focus-visible:border-[var(--os-focus)]"
    />
  );
}

export function QuestionRenderer({
  question,
  value,
  onChange,
  readOnly = false,
  index,
}: {
  question: RenderQuestion;
  value: unknown;
  onChange: (v: unknown) => void;
  readOnly?: boolean;
  index?: number;
}) {
  const q = question;
  const heading = (
    <p className="m-0 text-row font-medium text-ink">
      {index != null ? `${index + 1}. ` : ""}{q.text}
      {q.required ? <span className="ms-1 text-sm font-normal text-ink-2">(required)</span> : null}
    </p>
  );
  let body: React.ReactNode = null;
  switch (q.type) {
    case "rating":
      body = <RatingScale name={`q-${q.id}`} ariaLabel={q.text} value={typeof value === "number" ? value : null} labels={RATING_WORDS} readOnly={readOnly} onChange={(n) => onChange(n)} />;
      break;
    case "nps": {
      const cur = typeof value === "number" ? value : null;
      body = (
        <div className="flex flex-col gap-1">
          <div role="radiogroup" aria-label={q.text} className="flex max-w-[480px] gap-1">
            {Array.from({ length: 11 }, (_, n) => (
              <button key={n} type="button" role="radio" aria-checked={cur === n} disabled={readOnly && cur !== n}
                onClick={() => !readOnly && onChange(n)}
                className={cn("h-9 min-w-0 flex-1 rounded-md border text-sm font-medium tabular-nums", cur === n ? "border-[var(--os-brand)] bg-brand-soft text-brand-deep" : "border-line bg-raised text-ink-2 hover:bg-hover")}>
                {n}
              </button>
            ))}
          </div>
          <div className="flex max-w-[480px] justify-between text-xs text-ink-2"><span>Not at all likely</span><span>Extremely likely</span></div>
        </div>
      );
      break;
    }
    case "yes_no": {
      const cur = value === true || value === "Yes" || value === "yes" ? "Yes" : value === false || value === "No" || value === "no" ? "No" : null;
      body = (
        <div className="flex gap-2">
          {(["Yes", "No"] as const).map((v) => (
            <button key={v} type="button" aria-pressed={cur === v} disabled={readOnly && cur !== v} onClick={() => !readOnly && onChange(v)}
              className={cn("inline-flex h-9 items-center rounded-md border px-4 text-sm font-medium", cur === v ? "border-[var(--os-brand)] bg-brand-soft text-brand-deep" : "border-line bg-raised text-ink hover:bg-hover")}>
              {v}
            </button>
          ))}
        </div>
      );
      break;
    }
    case "single":
    case "single_choice":
    case "multi":
    case "multi_choice": {
      const multi = q.type === "multi" || q.type === "multi_choice";
      const opts = q.options ?? [];
      const cur = multi ? (Array.isArray(value) ? (value as unknown[]).map(String) : []) : typeof value === "string" ? value : "";
      body = (
        <div role={multi ? "group" : "radiogroup"} aria-label={q.text} className="flex flex-col">
          {opts.map((opt, i) => {
            const on = multi ? (cur as string[]).includes(opt) : cur === opt;
            return (
              <label key={i} className={cn("flex min-h-9 items-center gap-3 rounded-md px-2 text-row text-ink", !readOnly && "cursor-pointer hover:bg-hover")}>
                <input
                  type={multi ? "checkbox" : "radio"}
                  name={`q-${q.id}`}
                  checked={on}
                  disabled={readOnly}
                  onChange={() => {
                    if (!multi) { onChange(opt); return; }
                    const set = new Set(cur as string[]);
                    if (set.has(opt)) set.delete(opt); else set.add(opt);
                    onChange(opts.filter((o) => set.has(o)));
                  }}
                  className="h-4 w-4"
                />
                {opt}
              </label>
            );
          })}
        </div>
      );
      break;
    }
    case "start_stop_continue": {
      const o = (value && typeof value === "object" ? value : {}) as Record<string, string>;
      body = (
        <div className="flex flex-col gap-3">
          {(["start", "stop", "continue"] as const).map((k) => (
            <label key={k} className="flex flex-col gap-1">
              <span className="text-sm font-medium text-ink-2">{k === "start" ? "Start" : k === "stop" ? "Stop" : "Continue"}</span>
              <Area label={`${q.text}: ${k}`} value={o[k] ?? ""} readOnly={readOnly} onChange={(v) => onChange({ ...o, [k]: v })} />
            </label>
          ))}
        </div>
      );
      break;
    }
    default:
      body = <Area label={q.text} value={typeof value === "string" ? value : ""} readOnly={readOnly} onChange={(v) => onChange(v)} />;
  }
  return (
    <section className="flex flex-col gap-3 rounded-lg border border-line bg-raised p-6">
      {heading}
      {body}
    </section>
  );
}

/** Is a value an answer (for required questions and submit readiness)? */
export function hasAnswer(type: QuestionType, v: unknown): boolean {
  if (v == null) return false;
  if (type === "text") return typeof v === "string" && v.trim().length > 0;
  if (type === "multi" || type === "multi_choice") return Array.isArray(v) && v.length > 0;
  if (type === "single" || type === "single_choice" || type === "yes_no") return typeof v === "string" ? v.length > 0 : v != null;
  if (type === "start_stop_continue") return typeof v === "object" && Object.values(v as Record<string, string>).some((s) => typeof s === "string" && s.trim());
  return true;
}
