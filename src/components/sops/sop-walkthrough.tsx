"use client";

/* SOP Walkthrough viewer — "Next Step" style.
 *
 * Modal slide-over that walks the user through an SOP one step at a time.
 * Supports all three SOP variants we have today:
 *   - CHECKLIST   : sections[].steps[]  (title + notes)
 *   - RECORDED    : steps[]             (action + description + screenshot)
 *   - WRITTEN     : steps[]             (title + description HTML)
 *
 * Progress is held in local component state for v1 — a future ProcessRun
 * integration can persist it server-side and resume across sessions.
 */

import { useEffect, useMemo, useState } from "react";
import { ArrowLeft, ArrowRight, Check, X, BookCopy, Loader2 } from "lucide-react";

export type WalkthroughStep = {
  id: string;
  index: number;        // 1-based position across the whole SOP
  title: string;
  description?: string; // HTML or plain text
  url?: string;         // RECORDED steps: the URL the action was on
  screenshot?: string;  // RECORDED steps: image URL (S3 presigned or data URL)
  sectionTitle?: string; // CHECKLIST: which section this step belongs to
};

interface ApiSopBase {
  id: string;
  title: string;
  sopType?: "WRITTEN" | "RECORDED" | "CHECKLIST" | string | null;
  content?: SopWalkContent | null;
}

type ChecklistSectionInput = { title?: string; steps?: Array<{ id?: string; title?: string; notes?: string }> };
type RecordedStepInput = { id?: string; action?: string; description?: string; url?: string; screenshot?: string; screenshotKey?: string; order?: number };
type WrittenStepInput = { id?: string; title?: string; description?: string };

type SopWalkContent = {
  type?: string;
  sections?: ChecklistSectionInput[];
  steps?: RecordedStepInput[] | WrittenStepInput[];
};

export function stepsFromSop(sop: ApiSopBase): WalkthroughStep[] {
  const out: WalkthroughStep[] = [];
  const c = sop.content;
  if (!c) return out;
  if (Array.isArray(c.sections)) {
    let i = 1;
    for (const sec of c.sections) {
      const sectionTitle = sec.title ?? "";
      for (const step of sec.steps ?? []) {
        out.push({
          id: String(step.id ?? `s-${i}`),
          index: i++,
          title: step.title ?? `Step ${i - 1}`,
          description: step.notes ?? "",
          sectionTitle,
        });
      }
    }
    return out;
  }
  if (Array.isArray(c.steps)) {
    const steps = [...c.steps].sort((a, b) => (("order" in a ? a.order ?? 0 : 0) as number) - (("order" in b ? b.order ?? 0 : 0) as number));
    steps.forEach((step, i) => {
      const s = step as RecordedStepInput & WrittenStepInput;
      out.push({
        id: String(s.id ?? `s-${i + 1}`),
        index: i + 1,
        title: s.action ?? s.title ?? `Step ${i + 1}`,
        description: s.description ?? "",
        url: s.url,
        screenshot: s.screenshot,
      });
    });
    return out;
  }
  return out;
}

interface Props {
  sop: ApiSopBase;
  onClose: () => void;
}

export function SopWalkthrough({ sop, onClose }: Props) {
  const steps = useMemo(() => stepsFromSop(sop), [sop]);
  const [cursor, setCursor] = useState(0);
  const [doneIds, setDoneIds] = useState<Set<string>>(() => new Set());

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
      if (e.key === "ArrowRight" || e.key === "Enter") setCursor((c) => Math.min(steps.length - 1, c + 1));
      if (e.key === "ArrowLeft") setCursor((c) => Math.max(0, c - 1));
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [steps.length, onClose]);

  if (steps.length === 0) {
    return (
      <div className="sopwalk" role="dialog" aria-modal="true" onClick={onClose}>
        <div className="sopwalk__panel" onClick={(e) => e.stopPropagation()}>
          <header className="sopwalk__head">
            <BookCopy />
            <div>
              <h2>{sop.title || "Untitled SOP"}</h2>
              <p>Walkthrough</p>
            </div>
            <button type="button" className="sopwalk__x" onClick={onClose} aria-label="Close"><X /></button>
          </header>
          <div className="sopwalk__empty">
            <Loader2 className="bedit__spin" />
            <p>No steps to walk through yet. Add steps in the editor first.</p>
          </div>
        </div>
      </div>
    );
  }

  const step = steps[cursor];
  const progress = Math.round(((cursor + (doneIds.has(step.id) ? 1 : 0)) / steps.length) * 100);
  const atLast = cursor === steps.length - 1;
  const isDone = doneIds.has(step.id);

  function markDoneAndNext() {
    setDoneIds((prev) => { const next = new Set(prev); next.add(step.id); return next; });
    if (!atLast) setCursor((c) => c + 1);
  }

  return (
    <div className="sopwalk" role="dialog" aria-modal="true" onClick={onClose}>
      <div className="sopwalk__panel" onClick={(e) => e.stopPropagation()}>
        <header className="sopwalk__head">
          <BookCopy />
          <div>
            <h2>{sop.title || "Untitled SOP"}</h2>
            <p>Step {step.index} of {steps.length}{step.sectionTitle ? ` · ${step.sectionTitle}` : ""}</p>
          </div>
          <button type="button" className="sopwalk__x" onClick={onClose} aria-label="Close"><X /></button>
        </header>

        <div className="sopwalk__progress">
          <div className="sopwalk__progress-bar" style={{ width: `${progress}%` }} />
        </div>

        <div className="sopwalk__body">
          <h3 className={isDone ? "is-done" : ""}>
            {isDone && <Check className="sopwalk__check" />}
            {step.title}
          </h3>
          {step.url && (
            <a href={step.url} target="_blank" rel="noopener noreferrer" className="sopwalk__url">{step.url}</a>
          )}
          {step.screenshot && (
            // eslint-disable-next-line @next/next/no-img-element
            <img className="sopwalk__shot" src={step.screenshot} alt="" />
          )}
          {step.description && (
            <div
              className="sopwalk__desc"
              dangerouslySetInnerHTML={{ __html: looksLikeHTML(step.description) ? step.description : escapeText(step.description) }}
            />
          )}
        </div>

        <footer className="sopwalk__foot">
          <button
            type="button"
            className="sopwalk__btn"
            onClick={() => setCursor((c) => Math.max(0, c - 1))}
            disabled={cursor === 0}
          >
            <ArrowLeft /> Back
          </button>
          <div className="sopwalk__steps">
            {steps.map((s, i) => (
              <button
                key={s.id}
                type="button"
                className={`sopwalk__pip ${i === cursor ? "is-current" : ""} ${doneIds.has(s.id) ? "is-done" : ""}`}
                title={`${s.index}. ${s.title}`}
                onClick={() => setCursor(i)}
                aria-label={`Go to step ${s.index}: ${s.title}`}
              />
            ))}
          </div>
          {atLast && isDone ? (
            <button type="button" className="sopwalk__btn sopwalk__btn--primary" onClick={onClose}>
              Done <Check />
            </button>
          ) : (
            <button type="button" className="sopwalk__btn sopwalk__btn--primary" onClick={markDoneAndNext}>
              {atLast ? "Finish" : "Mark done · Next"} <ArrowRight />
            </button>
          )}
        </footer>
      </div>
    </div>
  );
}

function looksLikeHTML(s: string): boolean {
  return /<(?:p|div|h[1-6]|ul|ol|li|br|b|strong|i|em|a)\b/i.test(s);
}
function escapeText(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]!))
    .replace(/\n/g, "<br>");
}
