"use client";

/* Pulse survey builder — create + edit.
 *
 * Manager/admin gated at the call site AND server-side (POST /api/pulse-surveys
 * and PATCH /api/pulse-surveys/[id] both require isManager). Offers ONLY fields
 * the PulseSurvey model already has: title, questions, audienceType, anonymous,
 * frequency, closesAt. Narrower `USERS` targeting needs a paginated,
 * searchable person picker we haven't built, so it's honest Coming-soon rather
 * than a control the audience-count math would silently drop.
 *
 * Creating publishes immediately (the POST route sets status ACTIVE and
 * notifies the audience) — the copy says so; managers close later from the
 * card / detail page.
 */

import { useCallback, useEffect, useState } from "react";
import {
  Plus, Trash2, GripVertical, Loader2, AlertTriangle, Star, Gauge,
  ToggleRight, CircleDot, ListChecks, Type as TypeIcon, Lock,
} from "lucide-react";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter,
} from "@/components/ui/dialog";
import { Switch } from "@/components/ui/switch";

export type QType = "rating" | "nps" | "yes_no" | "single_choice" | "multi_choice" | "text";

export interface BuilderQuestion {
  id: string;
  text: string;
  type: QType;
  options?: string[];
}

export interface EditableSurvey {
  id: string;
  title: string;
  questions: BuilderQuestion[];
  audienceType: string;
  officeIds: string[];
  departmentIds: string[];
  tagIds: string[];
  anonymous: boolean;
  frequency: string | null;
  closesAt: string | null;
}

type AudienceType = "ALL" | "OFFICES" | "DEPARTMENTS" | "USERS" | "TAGS";
type Lookup = { id: string; name: string };

const Q_TYPES: { value: QType; label: string; Icon: typeof Star; hasOptions: boolean }[] = [
  { value: "rating", label: "Rating 1–5", Icon: Star, hasOptions: false },
  { value: "nps", label: "NPS 0–10", Icon: Gauge, hasOptions: false },
  { value: "yes_no", label: "Yes / No", Icon: ToggleRight, hasOptions: false },
  { value: "single_choice", label: "Single choice", Icon: CircleDot, hasOptions: true },
  { value: "multi_choice", label: "Multiple choice", Icon: ListChecks, hasOptions: true },
  { value: "text", label: "Free text", Icon: TypeIcon, hasOptions: false },
];

const FREQ_OPTS: { value: string; label: string }[] = [
  { value: "", label: "One-off (no repeat)" },
  { value: "WEEKLY", label: "Weekly" },
  { value: "BIWEEKLY", label: "Biweekly" },
  { value: "MONTHLY", label: "Monthly" },
  { value: "QUARTERLY", label: "Quarterly" },
];

function newQid(): string {
  return `q_${Math.random().toString(36).slice(2, 10)}${Date.now().toString(36)}`;
}

function blankQuestion(): BuilderQuestion {
  return { id: newQid(), text: "", type: "rating" };
}

/** yyyy-mm-dd for a Date offset by `days` from today (local). */
function dateInputValue(days: number): string {
  const d = new Date();
  d.setDate(d.getDate() + days);
  return d.toISOString().slice(0, 10);
}

/** Prefill an edited survey's close date only when it's still in the future —
 *  the PATCH route rejects past dates, so a stale one would block saving. */
function futureDateOnly(iso: string | null): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime()) || d.getTime() <= Date.now()) return "";
  return d.toISOString().slice(0, 10);
}

export function SurveyBuilder({
  open,
  mode,
  survey,
  onClose,
  onSaved,
}: {
  open: boolean;
  mode: "create" | "edit";
  survey?: EditableSurvey | null;
  onClose: () => void;
  onSaved: (msg: string) => void;
}) {
  const [title, setTitle] = useState("");
  const [questions, setQuestions] = useState<BuilderQuestion[]>([blankQuestion()]);
  const [audienceType, setAudienceType] = useState<AudienceType>("ALL");
  const [officeIds, setOfficeIds] = useState<string[]>([]);
  const [departmentIds, setDepartmentIds] = useState<string[]>([]);
  const [tagIds, setTagIds] = useState<string[]>([]);
  const [anonymous, setAnonymous] = useState(true);
  const [frequency, setFrequency] = useState("");
  const [closesAt, setClosesAt] = useState("");

  const [offices, setOffices] = useState<Lookup[]>([]);
  const [departments, setDepartments] = useState<Lookup[]>([]);
  const [tags, setTags] = useState<Lookup[]>([]);

  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Hydrate the form when the dialog opens (create → blank, edit → survey).
  useEffect(() => {
    if (!open) return;
    if (mode === "edit" && survey) {
      setTitle(survey.title);
      setQuestions(
        survey.questions.length > 0
          ? survey.questions.map((q) => ({ ...q, id: q.id || newQid() }))
          : [blankQuestion()],
      );
      setAudienceType((["ALL", "OFFICES", "DEPARTMENTS", "USERS", "TAGS"].includes(survey.audienceType) ? survey.audienceType : "ALL") as AudienceType);
      setOfficeIds(survey.officeIds ?? []);
      setDepartmentIds(survey.departmentIds ?? []);
      setTagIds(survey.tagIds ?? []);
      setAnonymous(survey.anonymous);
      setFrequency(survey.frequency ?? "");
      setClosesAt(futureDateOnly(survey.closesAt));
    } else {
      setTitle("");
      setQuestions([blankQuestion()]);
      setAudienceType("ALL");
      setOfficeIds([]);
      setDepartmentIds([]);
      setTagIds([]);
      setAnonymous(true);
      setFrequency("");
      setClosesAt("");
    }
    setError(null);
  }, [open, mode, survey]);

  // Lazy-load office / department lookups once when needed.
  const loadLookups = useCallback(async () => {
    try {
      if (offices.length === 0) {
        const r = await fetch("/api/offices");
        if (r.ok) {
          const data: unknown = await r.json();
          if (Array.isArray(data)) setOffices(data.map((o) => ({ id: String((o as Lookup).id), name: String((o as Lookup).name ?? "Office") })));
        }
      }
      if (departments.length === 0) {
        const r = await fetch("/api/departments");
        if (r.ok) {
          const data: unknown = await r.json();
          if (Array.isArray(data)) setDepartments(data.map((d) => ({ id: String((d as Lookup).id), name: String((d as Lookup).name ?? "Department") })));
        }
      }
      if (tags.length === 0) {
        const r = await fetch("/api/tags");
        if (r.ok) {
          const data: unknown = await r.json();
          if (Array.isArray(data)) setTags(data.map((t) => ({ id: String((t as Lookup).id), name: String((t as Lookup).name ?? "Tag") })));
        }
      }
    } catch { /* lookups are best-effort; ALL still works */ }
  }, [offices.length, departments.length, tags.length]);

  useEffect(() => {
    if (open && (audienceType === "OFFICES" || audienceType === "DEPARTMENTS" || audienceType === "TAGS")) void loadLookups();
  }, [open, audienceType, loadLookups]);

  function handleOpenChange(next: boolean) {
    if (next || submitting) return;
    onClose();
  }

  function updateQuestion(id: string, patch: Partial<BuilderQuestion>) {
    setQuestions((qs) => qs.map((q) => (q.id === id ? { ...q, ...patch } : q)));
  }
  function setQuestionType(id: string, type: QType) {
    setQuestions((qs) =>
      qs.map((q) => {
        if (q.id !== id) return q;
        const hasOptions = type === "single_choice" || type === "multi_choice";
        return {
          ...q,
          type,
          options: hasOptions ? (q.options && q.options.length > 0 ? q.options : ["", ""]) : undefined,
        };
      }),
    );
  }
  function addQuestion() {
    setQuestions((qs) => [...qs, blankQuestion()]);
  }
  function removeQuestion(id: string) {
    setQuestions((qs) => (qs.length <= 1 ? qs : qs.filter((q) => q.id !== id)));
  }
  function setOption(qid: string, idx: number, value: string) {
    setQuestions((qs) =>
      qs.map((q) => {
        if (q.id !== qid || !q.options) return q;
        const options = [...q.options];
        options[idx] = value;
        return { ...q, options };
      }),
    );
  }
  function addOption(qid: string) {
    setQuestions((qs) => qs.map((q) => (q.id === qid ? { ...q, options: [...(q.options ?? []), ""] } : q)));
  }
  function removeOption(qid: string, idx: number) {
    setQuestions((qs) =>
      qs.map((q) => {
        if (q.id !== qid || !q.options) return q;
        if (q.options.length <= 2) return q;
        return { ...q, options: q.options.filter((_, i) => i !== idx) };
      }),
    );
  }

  function toggleId(list: string[], id: string): string[] {
    return list.includes(id) ? list.filter((x) => x !== id) : [...list, id];
  }

  async function submit() {
    setError(null);
    if (!title.trim()) { setError("Give the survey a title."); return; }

    const cleaned: BuilderQuestion[] = [];
    for (const q of questions) {
      if (!q.text.trim()) { setError("Every question needs text (or remove the empty one)."); return; }
      if (q.type === "single_choice" || q.type === "multi_choice") {
        const opts = (q.options ?? []).map((o) => o.trim()).filter(Boolean);
        if (opts.length < 2) { setError(`"${q.text.trim()}" needs at least two options.`); return; }
        cleaned.push({ id: q.id, text: q.text.trim(), type: q.type, options: opts });
      } else {
        cleaned.push({ id: q.id, text: q.text.trim(), type: q.type });
      }
    }
    if (cleaned.length === 0) { setError("Add at least one question."); return; }

    if (audienceType === "OFFICES" && officeIds.length === 0) { setError("Pick at least one office."); return; }
    if (audienceType === "DEPARTMENTS" && departmentIds.length === 0) { setError("Pick at least one department."); return; }
    if (audienceType === "TAGS" && tagIds.length === 0) { setError("Pick at least one tag."); return; }

    if (closesAt) {
      const ms = new Date(`${closesAt}T23:59:59`).getTime();
      if (Number.isNaN(ms) || ms <= Date.now()) { setError("Close date must be in the future."); return; }
    }
    if (frequency && !closesAt) { setError("A repeating survey needs a close date so we know when to rotate it."); return; }

    const payload: Record<string, unknown> = {
      title: title.trim(),
      questions: cleaned,
      audienceType,
      officeIds: audienceType === "OFFICES" ? officeIds : [],
      departmentIds: audienceType === "DEPARTMENTS" ? departmentIds : [],
      tagIds: audienceType === "TAGS" ? tagIds : [],
      anonymous,
      frequency: frequency || null,
      closesAt: closesAt ? new Date(`${closesAt}T23:59:59`).toISOString() : null,
    };

    setSubmitting(true);
    try {
      const url = mode === "edit" && survey ? `/api/pulse-surveys/${survey.id}` : "/api/pulse-surveys";
      const res = await fetch(url, {
        method: mode === "edit" ? "PATCH" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      if (!res.ok) {
        if (res.status === 403) { setError("You need manager access to build surveys."); return; }
        let msg = "Couldn't save the survey.";
        try { const j = await res.json(); if (j?.error) msg = j.error; } catch { /* keep default */ }
        setError(msg);
        return;
      }
      onSaved(mode === "edit" ? "Survey updated" : "Survey published");
      onClose();
    } catch {
      setError("Network error — couldn't save.");
    } finally {
      setSubmitting(false);
    }
  }

  const anonLabel = anonymous ? "Anonymous" : "Attributed";

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="workwrk-os os-portal-panel max-w-[620px]">
        <DialogHeader>
          <DialogTitle>{mode === "edit" ? "Edit survey" : "New pulse survey"}</DialogTitle>
          <DialogDescription>
            {mode === "edit"
              ? "Update the questions, audience, or settings."
              : "Publishing sends this to the audience right away and starts collecting responses."}
          </DialogDescription>
        </DialogHeader>

        <div className="flex flex-col gap-4 py-1">
          {/* Title */}
          <label className="flex flex-col gap-1.5">
            <span className="text-[13px] font-medium text-[var(--os-ink-2)]">Title</span>
            <input
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="e.g. How was your sprint?"
              maxLength={160}
              className="h-10 rounded-lg border border-[var(--os-line)] bg-[var(--os-surface-1)] px-3 text-[14.5px] text-[var(--os-ink)] placeholder:text-[var(--os-ink-4)] outline-none focus:border-[var(--os-brand)]"
            />
          </label>

          {/* Questions */}
          <div className="flex flex-col gap-2">
            <span className="text-[13px] font-medium text-[var(--os-ink-2)]">Questions</span>
            <div className="flex flex-col gap-2.5">
              {questions.map((q, qi) => {
                const meta = Q_TYPES.find((t) => t.value === q.type);
                const hasOptions = q.type === "single_choice" || q.type === "multi_choice";
                return (
                  <div key={q.id} className="rounded-lg border border-[var(--os-line)] bg-[var(--os-surface-1)] p-2.5 flex flex-col gap-2">
                    <div className="flex items-start gap-2">
                      <span className="mt-2 text-[var(--os-ink-4)]"><GripVertical className="w-3.5 h-3.5" /></span>
                      <div className="flex-1 flex flex-col gap-2">
                        <input
                          value={q.text}
                          onChange={(e) => updateQuestion(q.id, { text: e.target.value })}
                          placeholder={`Question ${qi + 1}`}
                          maxLength={240}
                          className="h-9 rounded-md border border-[var(--os-line)] bg-[var(--os-surface)] px-2.5 text-[14px] text-[var(--os-ink)] placeholder:text-[var(--os-ink-4)] outline-none focus:border-[var(--os-brand)]"
                        />
                        <div className="flex flex-wrap gap-1.5">
                          {Q_TYPES.map(({ value, label, Icon }) => {
                            const active = q.type === value;
                            return (
                              <button
                                key={value}
                                type="button"
                                onClick={() => setQuestionType(q.id, value)}
                                className={`inline-flex items-center gap-1.5 h-7 px-2 rounded-md text-[12.5px] border transition-colors ${
                                  active
                                    ? "border-[var(--os-brand)] bg-[var(--os-brand-soft)] text-[var(--os-brand-deep)] font-medium"
                                    : "border-[var(--os-line)] text-[var(--os-ink-3)] hover:bg-[var(--os-surface)]"
                                }`}
                              >
                                <Icon className="w-3 h-3" /> {label}
                              </button>
                            );
                          })}
                        </div>

                        {hasOptions ? (
                          <div className="flex flex-col gap-1.5 pl-1">
                            {(q.options ?? []).map((opt, oi) => (
                              <div key={oi} className="flex items-center gap-1.5">
                                <span className="text-[var(--os-ink-4)]">
                                  {meta?.value === "multi_choice" ? <ListChecks className="w-3 h-3" /> : <CircleDot className="w-3 h-3" />}
                                </span>
                                <input
                                  value={opt}
                                  onChange={(e) => setOption(q.id, oi, e.target.value)}
                                  placeholder={`Option ${oi + 1}`}
                                  maxLength={120}
                                  className="flex-1 h-8 rounded-md border border-[var(--os-line)] bg-[var(--os-surface)] px-2.5 text-[13.5px] text-[var(--os-ink)] placeholder:text-[var(--os-ink-4)] outline-none focus:border-[var(--os-brand)]"
                                />
                                <button
                                  type="button"
                                  onClick={() => removeOption(q.id, oi)}
                                  disabled={(q.options ?? []).length <= 2}
                                  aria-label="Remove option"
                                  className="h-7 w-7 inline-flex items-center justify-center rounded-md text-[var(--os-ink-4)] hover:text-[var(--os-c-red)] hover:bg-[var(--os-surface)] disabled:opacity-30 disabled:hover:text-[var(--os-ink-4)]"
                                >
                                  <Trash2 className="w-3.5 h-3.5" />
                                </button>
                              </div>
                            ))}
                            <button
                              type="button"
                              onClick={() => addOption(q.id)}
                              className="self-start inline-flex items-center gap-1 h-7 px-2 rounded-md text-[12.5px] text-[var(--os-brand-deep)] hover:bg-[var(--os-surface)]"
                            >
                              <Plus className="w-3 h-3" /> Add option
                            </button>
                          </div>
                        ) : null}
                      </div>
                      <button
                        type="button"
                        onClick={() => removeQuestion(q.id)}
                        disabled={questions.length <= 1}
                        aria-label="Remove question"
                        className="mt-1 h-7 w-7 inline-flex items-center justify-center rounded-md text-[var(--os-ink-4)] hover:text-[var(--os-c-red)] hover:bg-[var(--os-surface)] disabled:opacity-30 disabled:hover:text-[var(--os-ink-4)]"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
            <button
              type="button"
              onClick={addQuestion}
              className="self-start inline-flex items-center gap-1.5 h-8 px-2.5 rounded-lg border border-dashed border-[var(--os-line)] text-[13.5px] text-[var(--os-ink-2)] hover:bg-[var(--os-surface-1)]"
            >
              <Plus className="w-3.5 h-3.5" /> Add question
            </button>
          </div>

          {/* Audience */}
          <div className="flex flex-col gap-1.5">
            <span className="text-[13px] font-medium text-[var(--os-ink-2)]">Audience</span>
            <div className="flex flex-wrap gap-1.5">
              {([
                { value: "ALL", label: "Everyone" },
                { value: "OFFICES", label: "By office" },
                { value: "DEPARTMENTS", label: "By department" },
                { value: "TAGS", label: "By tag" },
              ] as { value: AudienceType; label: string }[]).map(({ value, label }) => {
                const active = audienceType === value;
                return (
                  <button
                    key={value}
                    type="button"
                    onClick={() => setAudienceType(value)}
                    className={`inline-flex items-center h-8 px-3 rounded-lg text-[13.5px] border transition-colors ${
                      active
                        ? "border-[var(--os-brand)] bg-[var(--os-brand-soft)] text-[var(--os-brand-deep)] font-medium"
                        : "border-[var(--os-line)] text-[var(--os-ink-2)] hover:bg-[var(--os-surface-1)]"
                    }`}
                  >
                    {label}
                  </button>
                );
              })}
              <span
                className="inline-flex items-center h-8 px-3 rounded-lg text-[13.5px] border border-dashed border-[var(--os-line)] text-[var(--os-ink-4)] cursor-not-allowed"
                title="Targeting named individuals is coming soon"
              >
                Specific people · Coming soon
              </span>
            </div>

            {audienceType === "OFFICES" ? (
              <PickerGrid items={offices} selected={officeIds} onToggle={(id) => setOfficeIds((l) => toggleId(l, id))} empty="No offices found" />
            ) : null}
            {audienceType === "DEPARTMENTS" ? (
              <PickerGrid items={departments} selected={departmentIds} onToggle={(id) => setDepartmentIds((l) => toggleId(l, id))} empty="No departments found" />
            ) : null}
            {audienceType === "TAGS" ? (
              <PickerGrid items={tags} selected={tagIds} onToggle={(id) => setTagIds((l) => toggleId(l, id))} empty="No tags yet — create some in Settings → Tags" />
            ) : null}
          </div>

          {/* Anonymous + frequency + close date */}
          <div className="flex flex-col gap-2.5 rounded-lg border border-[var(--os-line)] p-3">
            <label className="flex items-center justify-between gap-3">
              <span className="flex flex-col">
                <span className="text-[14px] text-[var(--os-ink)] inline-flex items-center gap-1.5">
                  <Lock className="w-3.5 h-3.5 text-[var(--os-ink-3)]" /> {anonLabel} responses
                </span>
                <span className="text-[12.5px] text-[var(--os-ink-3)]">
                  {anonymous
                    ? "Managers see aggregates only — no names, ever."
                    : "Managers can see who said what. Use only when people expect it."}
                </span>
              </span>
              <Switch checked={anonymous} onChange={setAnonymous} aria-label="Anonymous responses" />
            </label>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 pt-1">
              <label className="flex flex-col gap-1.5">
                <span className="text-[13px] font-medium text-[var(--os-ink-2)]">Repeat</span>
                <select
                  value={frequency}
                  onChange={(e) => setFrequency(e.target.value)}
                  className="h-10 rounded-lg border border-[var(--os-line)] bg-[var(--os-surface-1)] px-2.5 text-[14px] text-[var(--os-ink)] outline-none focus:border-[var(--os-brand)]"
                >
                  {FREQ_OPTS.map((f) => <option key={f.value} value={f.value}>{f.label}</option>)}
                </select>
              </label>
              <label className="flex flex-col gap-1.5">
                <span className="text-[13px] font-medium text-[var(--os-ink-2)]">
                  Close date {frequency ? <span className="text-[var(--os-c-red)]">*</span> : <span className="text-[var(--os-ink-4)]">(optional)</span>}
                </span>
                <input
                  type="date"
                  value={closesAt}
                  min={dateInputValue(1)}
                  onChange={(e) => setClosesAt(e.target.value)}
                  className="h-10 rounded-lg border border-[var(--os-line)] bg-[var(--os-surface-1)] px-3 text-[14px] text-[var(--os-ink)] outline-none focus:border-[var(--os-brand)]"
                />
              </label>
            </div>
          </div>

          {error ? (
            <div className="flex items-start gap-2 rounded-lg border border-[color:var(--os-c-red)]/40 bg-[color:var(--os-c-red)]/10 px-3 py-2 text-[13.5px] text-[var(--os-c-red)]">
              <AlertTriangle className="w-4 h-4 mt-[1px] shrink-0" />
              <span>{error}</span>
            </div>
          ) : null}
        </div>

        <DialogFooter>
          <button
            type="button"
            onClick={() => handleOpenChange(false)}
            disabled={submitting}
            className="h-9 px-3.5 rounded-lg border border-[var(--os-line)] text-[14px] text-[var(--os-ink-2)] hover:bg-[var(--os-surface-1)] disabled:opacity-50"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={submit}
            disabled={submitting}
            className="inline-flex items-center gap-1.5 h-9 px-3.5 rounded-lg bg-[var(--os-brand)] text-white text-[14px] font-medium hover:bg-[var(--os-brand-hover)] disabled:opacity-60"
          >
            {submitting ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : null}
            {mode === "edit" ? "Save changes" : "Publish survey"}
          </button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function PickerGrid({
  items,
  selected,
  onToggle,
  empty,
}: {
  items: Lookup[];
  selected: string[];
  onToggle: (id: string) => void;
  empty: string;
}) {
  if (items.length === 0) {
    return <div className="text-[13px] text-[var(--os-ink-4)] px-1 pt-1">{empty}…</div>;
  }
  return (
    <div className="flex flex-wrap gap-1.5 pt-1">
      {items.map((it) => {
        const active = selected.includes(it.id);
        return (
          <button
            key={it.id}
            type="button"
            onClick={() => onToggle(it.id)}
            className={`inline-flex items-center h-7 px-2.5 rounded-md text-[13px] border transition-colors ${
              active
                ? "border-[var(--os-brand)] bg-[var(--os-brand-soft)] text-[var(--os-brand-deep)] font-medium"
                : "border-[var(--os-line)] text-[var(--os-ink-2)] hover:bg-[var(--os-surface-1)]"
            }`}
          >
            {it.name}
          </button>
        );
      })}
    </div>
  );
}
