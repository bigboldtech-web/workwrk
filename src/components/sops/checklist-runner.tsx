"use client";

// ChecklistRunner (spec-process section 3): the section / step / input UI a
// run is executed with, on the public run page and read-only inside the Run
// drawer.
//
//   sections   44px group headers (chevron + name + "2 of 4")
//   steps      rows with an 18px checkbox (checked --os-brand), the title
//              15/400 (15/500 when it has inputs) and, when inputs exist, the
//              inputs beneath in a 12px-padded sub-block
//   saving     a 6px `saving` dot on the row while its tick is in flight;
//              "Not saved, retrying" on the row when it failed
//   approval   an "Approval" chip and "Approved on {date}" once ticked
//
// It owns no network: `onToggle`, `onInput` and `onUpload` are the caller's,
// and the caller passes back `rowState` so the row can show its dot.

import { useState } from "react";
import { Check, ChevronDown, ChevronRight, Download, Upload } from "lucide-react";
import { Chip } from "@/components/ui/chip";
import { StepText, type ReadChecklistSection, type ReadChecklistStep } from "@/components/sops/sop-read-view";
import { CHECKLIST_INPUT_LABEL, missingRequired } from "@/lib/sop-kind";
import { cn } from "@/lib/utils";

export type RowState = "idle" | "saving" | "retrying" | "failed";

export interface ChecklistRunnerProps {
  sections: ReadChecklistSection[];
  completedSteps: string[];
  /** Typed values per step id, per input id. */
  values: Record<string, Record<string, unknown>>;
  /** Per-step save state for the dot. */
  rowState?: Record<string, RowState>;
  readOnly?: boolean;
  onToggle?: (step: ReadChecklistStep, next: boolean) => void;
  onInput?: (stepId: string, inputId: string, value: unknown) => void;
  /** Returns the stored URL. */
  onUpload?: (stepId: string, inputId: string, file: File) => Promise<string | null>;
  /** "Approved by {name} on {date}" text per step (the caller formats dates). */
  approvedLine?: (stepId: string) => string | null;
  formatDate?: (v: string | Date) => string;
}

const INPUT = "h-9 w-full rounded-md border border-line-strong bg-raised px-3 text-base text-ink placeholder:text-ink-3 focus:outline-none focus-visible:border-brand disabled:opacity-60";

export function ChecklistRunner({ sections, completedSteps, values, rowState = {}, readOnly = false, onToggle, onInput, onUpload, approvedLine }: ChecklistRunnerProps) {
  const [collapsed, setCollapsed] = useState<Set<string>>(() => new Set());
  const done = new Set(completedSteps);

  return (
    <div className="flex flex-col gap-4">
      {sections.map((sec) => {
        const steps = sec.steps ?? [];
        const doneHere = steps.filter((s) => done.has(s.id)).length;
        const open = !collapsed.has(sec.id);
        return (
          <section key={sec.id} className="overflow-hidden rounded-lg border border-line bg-raised">
            <button
              type="button"
              onClick={() => setCollapsed((prev) => { const n = new Set(prev); if (n.has(sec.id)) n.delete(sec.id); else n.add(sec.id); return n; })}
              aria-expanded={open}
              className="flex h-11 w-full items-center gap-2 border-b border-line bg-[var(--os-table-head-bg)] px-3 text-start"
            >
              {open ? <ChevronDown className="h-4 w-4 shrink-0 text-ink-2" strokeWidth={1.5} aria-hidden /> : <ChevronRight className="h-4 w-4 shrink-0 text-ink-2 rtl:rotate-180" strokeWidth={1.5} aria-hidden />}
              <span className="min-w-0 flex-1 truncate text-row font-medium text-ink">{sec.title || "Steps"}</span>
              <span className="text-xs font-medium tabular-nums text-ink-2">{doneHere} of {steps.length}</span>
            </button>
            {open ? (
              <ul>
                {steps.length === 0 ? <li className="px-3 py-3 text-sm text-ink-3">No steps in this section.</li> : null}
                {steps.map((step) => {
                  const isDone = done.has(step.id);
                  const hasInputs = (step.inputs?.length ?? 0) > 0;
                  const stepValues = values[step.id] ?? {};
                  const missing = missingRequired(step, stepValues);
                  const state = rowState[step.id] ?? "idle";
                  const blocked = !isDone && missing.length > 0;
                  const approved = step.type === "approval" && isDone ? approvedLine?.(step.id) ?? null : null;
                  return (
                    <li key={step.id} className={cn("border-b border-line-soft last:border-b-0", isDone ? "bg-subtle" : "")}>
                      <div className="flex min-h-11 items-start gap-3 px-3 py-2.5">
                        {readOnly ? (
                          // Read mode draws the state, never a disabled control: an
                          // 18px box, --os-brand filled with a white check when the
                          // step is done, hollow --os-line-strong otherwise.
                          <span
                            role="img"
                            aria-label={isDone ? "Done" : "Not done"}
                            className={cn("mt-0.5 inline-flex h-[18px] w-[18px] shrink-0 items-center justify-center rounded border", isDone ? "border-brand bg-brand text-white" : "border-line-strong bg-raised")}
                          >
                            {isDone ? <Check className="h-3 w-3" strokeWidth={2.5} aria-hidden /> : null}
                          </span>
                        ) : (
                          <input
                            type="checkbox"
                            checked={isDone}
                            disabled={state === "saving" || blocked}
                            onChange={(e) => onToggle?.(step, e.target.checked)}
                            aria-label={step.title || "Step"}
                            title={blocked ? "Fill in the required fields first" : undefined}
                            className="mt-0.5 h-[18px] w-[18px] shrink-0 rounded border-line-strong accent-[var(--os-brand)] disabled:opacity-60"
                          />
                        )}
                        <div className="min-w-0 flex-1">
                          <div className="flex flex-wrap items-center gap-2">
                            <span className={cn("text-row text-ink", hasInputs ? "font-medium" : "", isDone ? "text-ink-2 line-through" : "")}>{step.title || "Untitled step"}</span>
                            {step.type === "approval" ? <Chip size="default" className="h-6 px-2 text-xs" disabled>Approval</Chip> : null}
                            {state === "saving" ? <span className="inline-flex items-center gap-1.5 text-xs text-ink-2"><span aria-hidden className="inline-block h-1.5 w-1.5 rounded-full bg-brand os-saving-pulse" />Saving</span> : null}
                            {state === "retrying" ? <span className="inline-flex items-center gap-1.5 text-xs text-danger-text"><span aria-hidden className="inline-block h-1.5 w-1.5 rounded-full bg-danger-solid" />Not saved, retrying</span> : null}
                            {state === "failed" ? <span className="inline-flex items-center gap-1.5 text-xs text-danger-text"><span aria-hidden className="inline-block h-1.5 w-1.5 rounded-full bg-danger-solid" />Not saved</span> : null}
                          </div>
                          {step.description ? <StepText html={step.description} className="mt-0.5 text-sm" /> : null}
                          {approved ? <p className="mt-0.5 text-sm text-ink-2">{approved}</p> : null}
                          {(step.contentBlocks ?? []).map((cb) => {
                            if (cb.type === "horizontal_line") return <hr key={cb.id} className="my-2 border-line" />;
                            if (cb.type === "text" && cb.content) return <p key={cb.id} className="mt-1 whitespace-pre-wrap text-sm text-ink-2">{cb.content}</p>;
                            // eslint-disable-next-line @next/next/no-img-element
                            if (cb.type === "image" && cb.content) return <img key={cb.id} src={cb.content} alt="" loading="lazy" className="mt-2 max-w-full rounded-lg border border-line" />;
                            if (cb.type === "video" && cb.content) return <video key={cb.id} src={cb.content} controls preload="metadata" className="mt-2 max-w-full rounded-lg" />;
                            return null;
                          })}
                          {hasInputs && readOnly ? (
                            // The values as text under the step ("Client email:
                            // a@b.co"), never an empty disabled field.
                            <dl className="mt-1.5 flex flex-col gap-0.5">
                              {(step.inputs ?? []).map((input) => (
                                <div key={input.id} className="flex flex-wrap gap-x-2 text-sm">
                                  <dt className="text-ink-2">{input.label || CHECKLIST_INPUT_LABEL[input.type ?? ""] || "Field"}</dt>
                                  <dd className="min-w-0 text-ink"><ReadValue input={input} value={stepValues[input.id]} /></dd>
                                </div>
                              ))}
                            </dl>
                          ) : hasInputs ? (
                            <div className="mt-2 flex flex-col gap-3 rounded-md bg-subtle p-3">
                              {(step.inputs ?? []).map((input) => (
                                <label key={input.id} className="flex flex-col gap-1">
                                  {input.type !== "checkbox" ? (
                                    <span className="text-sm text-ink-2">{input.label || "Field"}{input.required ? <span className="text-danger-text"> (required)</span> : null}</span>
                                  ) : null}
                                  <RunInput
                                    input={input}
                                    value={stepValues[input.id]}
                                    disabled={isDone}
                                    onChange={(v) => onInput?.(step.id, input.id, v)}
                                    onUpload={onUpload ? (file) => onUpload(step.id, input.id, file) : undefined}
                                  />
                                </label>
                              ))}
                            </div>
                          ) : null}
                        </div>
                      </div>
                    </li>
                  );
                })}
              </ul>
            ) : null}
          </section>
        );
      })}
    </div>
  );
}

/** A typed value as read-only text: a link for uploads and URLs, "Yes" / "No" for a box, "Not filled" when empty. */
function ReadValue({ input, value }: { input: NonNullable<ReadChecklistStep["inputs"]>[number]; value: unknown }) {
  if (input.type === "checkbox") return <>{value ? "Yes" : "No"}</>;
  if (Array.isArray(value)) return value.length ? <>{value.join(", ")}</> : <span className="text-ink-3">Not filled</span>;
  const str = typeof value === "string" || typeof value === "number" ? String(value) : "";
  if (!str) return <span className="text-ink-3">Not filled</span>;
  if (input.type === "file_upload" || input.type === "website") {
    return <a href={str} target="_blank" rel="noopener" className="break-all text-brand-deep hover:underline">{input.type === "file_upload" ? str.split("/").pop() : str}</a>;
  }
  return <span className="break-words">{str}</span>;
}

function RunInput({ input, value, disabled, onChange, onUpload }: {
  input: NonNullable<ReadChecklistStep["inputs"]>[number];
  value: unknown;
  disabled: boolean;
  onChange: (v: unknown) => void;
  onUpload?: (file: File) => Promise<string | null>;
}) {
  const [uploading, setUploading] = useState(false);
  const str = typeof value === "string" || typeof value === "number" ? String(value) : "";
  switch (input.type) {
    case "long_text":
      return <textarea value={str} disabled={disabled} onChange={(e) => onChange(e.target.value)} rows={3} className={cn(INPUT, "h-auto py-2")} />;
    case "number":
      return <input type="number" value={str} disabled={disabled} onChange={(e) => onChange(e.target.value)} className={INPUT} />;
    case "email":
      return <input type="email" value={str} disabled={disabled} onChange={(e) => onChange(e.target.value)} placeholder="name@example.com" className={INPUT} />;
    case "website":
      return <input type="url" value={str} disabled={disabled} onChange={(e) => onChange(e.target.value)} placeholder="https://" className={INPUT} />;
    case "date":
      return <input type="date" value={str} disabled={disabled} onChange={(e) => onChange(e.target.value)} className={INPUT} />;
    case "checkbox":
      return (
        <span className="inline-flex h-8 items-center gap-2 text-base text-ink">
          <input type="checkbox" checked={!!value} disabled={disabled} onChange={(e) => onChange(e.target.checked)} className="h-[18px] w-[18px] rounded border-line-strong accent-[var(--os-brand)]" />
          {input.label || "Yes"}{input.required ? <span className="text-sm text-danger-text">(required)</span> : null}
        </span>
      );
    case "dropdown":
      return (
        <select value={str} disabled={disabled} onChange={(e) => onChange(e.target.value)} className={INPUT}>
          <option value="">Choose</option>
          {(input as { options?: string[] }).options?.map((opt) => <option key={opt} value={opt}>{opt}</option>)}
        </select>
      );
    case "multichoice": {
      const selected = Array.isArray(value) ? (value as string[]) : [];
      return (
        <span className="flex flex-col gap-1">
          {((input as { options?: string[] }).options ?? []).map((opt) => (
            <span key={opt} className="inline-flex h-8 items-center gap-2 text-base text-ink">
              <input type="checkbox" checked={selected.includes(opt)} disabled={disabled} onChange={(e) => onChange(e.target.checked ? [...selected, opt] : selected.filter((s) => s !== opt))} className="h-[18px] w-[18px] rounded border-line-strong accent-[var(--os-brand)]" />
              {opt}
            </span>
          ))}
        </span>
      );
    }
    case "file_upload": {
      if (str) {
        return (
          <a href={str} target="_blank" rel="noopener" className="inline-flex h-9 items-center gap-2 rounded-md border border-line bg-raised px-3 text-base text-ink hover:bg-hover">
            <Download className="h-4 w-4 text-ink-2" strokeWidth={1.5} aria-hidden />
            <span className="truncate">{str.split("/").pop()}</span>
          </a>
        );
      }
      return (
        <span className={cn("inline-flex h-11 items-center gap-2 rounded-md border border-dashed border-line-strong px-3 text-base", disabled ? "opacity-60" : "")}>
          <Upload className="h-4 w-4 text-ink-2" strokeWidth={1.5} aria-hidden />
          <span className="font-medium text-brand-deep">{uploading ? "Uploading" : "Upload a file"}</span>
          <input
            type="file"
            className="sr-only"
            disabled={disabled || uploading || !onUpload}
            onChange={async (e) => {
              const file = e.target.files?.[0];
              e.target.value = "";
              if (!file || !onUpload) return;
              setUploading(true);
              try { const url = await onUpload(file); if (url) onChange(url); } finally { setUploading(false); }
            }}
          />
        </span>
      );
    }
    default:
      return <input type="text" value={str} disabled={disabled} onChange={(e) => onChange(e.target.value)} placeholder={input.label || ""} className={INPUT} />;
  }
}
