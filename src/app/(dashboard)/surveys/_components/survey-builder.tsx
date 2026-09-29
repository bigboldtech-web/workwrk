"use client";

// The survey builder (spec-teams-performance /surveys, the 960 editor modal):
// a title; the questions as a ReorderableList (drag, keyboard, and Move up /
// Move down in each row's "...": never drag alone), each with its type and,
// for the two pick types, at least two options; who it goes to (Everyone,
// offices, departments, tags, or Specific people, built over the people
// picker); Anonymous; Repeats; Closes on. The footer is Cancel, Save as
// draft and the blue Publish ("Publishing sends this to N people right
// away"), which is what ends the old publish-only builder: Draft is a real
// status again. Editing is for a Draft only; an Open survey's questions are
// fixed (every stored answer is keyed to them).
//
// The runner gate is server side (POST /api/pulse-surveys and PATCH
// /api/pulse-surveys/[id]); the page only opens this for a runner.
//
// The dialog is a shell layer (kind "dialog"), as the widget editor is. Every
// Picker and the DateField in here registers a popover layer above it, and Esc
// goes to the LayerStack: the first Esc closes the open list, and only an Esc
// with nothing open reaches requestClose (and its Discard confirm). Radix sees
// Esc first, so without onEscapeKeyDown one Esc on an open Who it goes to list
// asked to throw the whole survey away with the list still open over it.
//
// The body scrolls, and every popover in it is an absolutely positioned DOM
// child (never a portal: see the row "..." note below), so a list that opens
// near the body's foot (Who it goes to, Repeats, Closes on) was clipped by it.
// When a popover opens, the body scrolls just far enough to show it whole.

import { useContext, useEffect, useMemo, useRef, useState } from "react";
import { MoreHorizontal, Plus, X } from "lucide-react";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { DateField } from "@/components/ui/date-field";
import { Switch } from "@/components/ui/switch";
import { useConfirm } from "@/components/ui/dialog-provider";
import { Picker } from "@/components/ui/picker";
import { OsShellContext, useLayer } from "@/components/layout/os/shell-context";
import { PickerButton } from "@/components/dashboards/widget-registry";
import { PeoplePickerField, type PickPerson } from "@/components/people/person-bits";
import { ReorderableList } from "@/components/performance/reorderable-list";
import { apiFetch } from "@/lib/api-fetch";
import { SURVEY_QUESTION_TYPES, closesAtDateKey, closesAtFromDateKey, pickerZone, type SurveyQuestionType } from "@/lib/performance/survey";
import { useDatePrefs } from "@/lib/format/use-date-prefs";

export type QType = SurveyQuestionType;
export interface BuilderQuestion { id: string; text: string; type: QType; options?: string[]; required?: boolean }
export interface EditableSurvey {
  id: string;
  title: string;
  questions: BuilderQuestion[];
  audienceType: string;
  officeIds?: string[];
  departmentIds?: string[];
  userIds?: string[];
  tagIds?: string[];
  anonymous: boolean;
  frequency?: string | null;
  closesAt?: string | null;
}

type Audience = "ALL" | "OFFICES" | "DEPARTMENTS" | "TAGS" | "USERS";
const AUDIENCES: Array<{ value: Audience; label: string }> = [
  { value: "ALL", label: "Everyone" },
  { value: "OFFICES", label: "By office" },
  { value: "DEPARTMENTS", label: "By department" },
  { value: "TAGS", label: "By tag" },
  { value: "USERS", label: "Specific people" },
];
const REPEATS = [
  { value: "", label: "Does not repeat" },
  { value: "WEEKLY", label: "Weekly" },
  { value: "BIWEEKLY", label: "Every two weeks" },
  { value: "MONTHLY", label: "Monthly" },
  { value: "QUARTERLY", label: "Quarterly" },
];

type Lookup = { id: string; name: string };
const blank = (n: number): BuilderQuestion => ({ id: `q${Date.now().toString(36)}${n}`, text: "", type: "rating" });

type Span = { top: number; bottom: number };
/**
 * How far to scroll the builder's body so a popover that opened below its
 * foot shows whole: 0 when it already fits. Never so far that the popover's
 * anchor (the button that opened it) leaves the top of the body, so a list
 * taller than the body shows its trigger and as much of itself as fits.
 */
const REVEAL_GAP = 8;
export function popoverRevealDelta(pop: Span, anchor: Span, body: Span, gap = REVEAL_GAP): number {
  const below = pop.bottom + gap - body.bottom;
  if (below <= 0) return 0;
  const room = Math.max(0, anchor.top - gap - body.top);
  return Math.min(below, room);
}

export function SurveyBuilder({
  open,
  onOpenChange,
  mode = "create",
  survey,
  onSaved,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  mode?: "create" | "edit";
  survey?: EditableSurvey | null;
  onSaved: (saved: { id: string; status: string }) => void;
}) {
  const confirm = useConfirm();
  const [title, setTitle] = useState(survey?.title ?? "");
  const [questions, setQuestions] = useState<BuilderQuestion[]>(survey?.questions?.length ? survey.questions : [blank(1)]);
  const [audience, setAudience] = useState<Audience>((survey?.audienceType as Audience) ?? "ALL");
  const [officeIds, setOfficeIds] = useState<string[]>(survey?.officeIds ?? []);
  const [departmentIds, setDepartmentIds] = useState<string[]>(survey?.departmentIds ?? []);
  const [tagIds, setTagIds] = useState<string[]>(survey?.tagIds ?? []);
  const [people, setPeople] = useState<PickPerson[]>([]);
  const [userIds, setUserIds] = useState<string[]>(survey?.userIds ?? []);
  const [anonymous, setAnonymous] = useState(survey?.anonymous ?? true);
  const [frequency, setFrequency] = useState(survey?.frequency ?? "");
  const zone = pickerZone(useDatePrefs().timezone);
  const [closesAt, setClosesAt] = useState<string>(closesAtDateKey(survey?.closesAt, zone) ?? "");
  const [lookups, setLookups] = useState<{ offices: Lookup[]; departments: Lookup[]; tags: Lookup[] }>({ offices: [], departments: [], tags: [] });
  const [busy, setBusy] = useState<null | "DRAFT" | "ACTIVE">(null);
  const [error, setError] = useState<string | null>(null);
  // The row "..." is a Picker rendered in place, never a portal: a portalled
  // menu sits outside the dialog's focus trap and a click on it closes the
  // dialog.
  const [menuFor, setMenuFor] = useState<string | null>(null);
  const [dirty, setDirty] = useState(false);
  const bodyRef = useRef<HTMLDivElement>(null);
  const tailRef = useRef<HTMLDivElement>(null);
  const shell = useContext(OsShellContext);
  const topLayerKind = shell?.topLayerKind ?? null;
  const layerCount = shell?.layerCount ?? 0;

  // Reveal a popover that just opened (the top layer became one) inside the
  // scrolling body. A Picker's root is the role="presentation" box around its
  // listbox; the DateField's is its role="dialog" calendar. Both are
  // positioned against the relative span that holds their trigger.
  //
  // An absolutely positioned box extends the body's scroll area only to its
  // own border (the body's padding is not added after it), so a list at the
  // foot could be scrolled flush with the edge and no further, its border
  // and shadow shaved off. The tail spacer at the end of the body grows
  // while the popover is open to leave REVEAL_GAP below it, and goes back to
  // nothing when it closes. The body's height is held while it is open, so
  // the tail scrolls rather than growing the dialog (a centred dialog that
  // grew would jump up under the pointer). Both are set on the DOM, not in
  // state: a re-render here would move the very list being measured.
  useEffect(() => {
    if (!open || topLayerKind !== "popover") return;
    const tail = tailRef.current;
    const body = bodyRef.current;
    const raf = requestAnimationFrame(() => {
      if (!body || !tail) return;
      const found = Array.from(body.querySelectorAll<HTMLElement>('[role="listbox"], [role="dialog"]')).pop();
      if (!found) return;
      const pop = found.getAttribute("role") === "listbox" && found.parentElement?.getAttribute("role") === "presentation" ? found.parentElement : found;
      const anchor = pop.offsetParent instanceof HTMLElement ? pop.offsetParent : pop;
      body.style.maxHeight = `${body.clientHeight}px`;
      const popBox = pop.getBoundingClientRect();
      tail.style.height = `${Math.max(0, Math.ceil(popBox.bottom + REVEAL_GAP - tail.getBoundingClientRect().top))}px`;
      const delta = popoverRevealDelta(popBox, anchor.getBoundingClientRect(), body.getBoundingClientRect());
      if (delta > 0) body.scrollTop += delta;
    });
    return () => {
      cancelAnimationFrame(raf);
      if (tail) tail.style.height = "";
      if (body) body.style.maxHeight = "";
    };
  }, [open, topLayerKind, layerCount]);

  useEffect(() => {
    if (!open) return;
    const need = (audience === "OFFICES" && !lookups.offices.length) || (audience === "DEPARTMENTS" && !lookups.departments.length) || (audience === "TAGS" && !lookups.tags.length);
    if (!need) return;
    void Promise.all([
      apiFetch<Lookup[]>("/api/offices", { cache: "no-store" }),
      apiFetch<Lookup[]>("/api/departments", { cache: "no-store" }),
      apiFetch<Lookup[] | { data: Lookup[] }>("/api/tags", { cache: "no-store" }),
    ]).then(([o, d, t]) => {
      const arr = (x: unknown): Lookup[] => (Array.isArray(x) ? x : x && typeof x === "object" && Array.isArray((x as { data?: unknown }).data) ? (x as { data: Lookup[] }).data : []).map((v: Lookup) => ({ id: String(v.id), name: String(v.name ?? "") }));
      setLookups({ offices: o.ok ? arr(o.data) : [], departments: d.ok ? arr(d.data) : [], tags: t.ok ? arr(t.data) : [] });
    });
  }, [open, audience, lookups]);

  const touch = <T,>(fn: (v: T) => void) => (v: T) => { setDirty(true); fn(v); };
  const setQ = (id: string, patch: Partial<BuilderQuestion>) => { setDirty(true); setQuestions((qs) => qs.map((q) => (q.id === id ? { ...q, ...patch } : q))); };

  const requestClose = async () => {
    if (busy) return;
    if (dirty && !(await confirm({ title: "Discard this survey?", description: "Your changes have not been saved.", confirmLabel: "Discard", destructive: true }))) return;
    onOpenChange(false);
  };
  // Refuses while a save is in flight, so the answer lands on the dialog that asked.
  useLayer(open, { kind: "dialog", close: () => void requestClose(), canClose: () => !busy });

  const validate = (): string | null => {
    if (!title.trim()) return "Give the survey a title.";
    const real = questions.filter((q) => q.text.trim());
    if (!real.length) return "Add at least one question.";
    for (const q of real) {
      if ((q.type === "single_choice" || q.type === "multi_choice") && (q.options ?? []).filter((o) => o.trim()).length < 2) return `"${q.text.trim()}" needs at least two options.`;
    }
    if (audience === "OFFICES" && !officeIds.length) return "Pick at least one office.";
    if (audience === "DEPARTMENTS" && !departmentIds.length) return "Pick at least one department.";
    if (audience === "TAGS" && !tagIds.length) return "Pick at least one tag.";
    if (audience === "USERS" && !userIds.length) return "Pick at least one person.";
    if (frequency && !closesAt) return "A repeating survey needs a close date.";
    return null;
  };

  const save = async (status: "DRAFT" | "ACTIVE") => {
    const bad = validate();
    if (bad) { setError(bad); return; }
    setBusy(status);
    setError(null);
    const payload = {
      title: title.trim(),
      questions: questions.filter((q) => q.text.trim()).map((q) => ({ ...q, text: q.text.trim(), options: q.options?.map((o) => o.trim()).filter(Boolean) })),
      audienceType: audience,
      officeIds, departmentIds, tagIds, userIds,
      anonymous,
      frequency: frequency || null,
      closesAt: closesAtFromDateKey(closesAt || null, zone),
      status,
    };
    const r = mode === "edit" && survey
      ? await apiFetch<{ id: string; status: string }>(`/api/pulse-surveys/${survey.id}`, { method: "PATCH", json: payload })
      : await apiFetch<{ id: string; status: string }>("/api/pulse-surveys", { method: "POST", json: payload });
    setBusy(null);
    if (!r.ok) { setError(r.error || "Couldn't save the survey."); return; }
    setDirty(false);
    onSaved({ id: r.data.id, status: r.data.status });
    onOpenChange(false);
  };

  const idsPicker = (label: string, list: Lookup[], value: string[], set: (v: string[]) => void) => (
    <PickerButton ariaLabel={label} multi keepOpen
      label={value.length ? list.filter((x) => value.includes(x.id)).map((x) => x.name).join(", ") || `${value.length} picked` : <span className="text-ink-3">Pick {label.toLowerCase()}</span>}
      selected={value} sections={[{ options: list.map((x) => ({ value: x.id, label: x.name })) }]}
      onSelect={(id) => { setDirty(true); set(value.includes(id) ? value.filter((x) => x !== id) : [...value, id]); }} emptyLabel="None yet" className="mt-2" />
  );
  const reachLine = audience === "USERS" ? `${userIds.length} ${userIds.length === 1 ? "person" : "people"}` : audience === "ALL" ? "everyone" : "everyone in the groups you picked";
  const questionOptions = useMemo(() => SURVEY_QUESTION_TYPES.map((t) => ({ value: t.value, label: t.label })), []);
  const input = "h-9 w-full rounded-md border border-line bg-raised px-3 text-row text-ink outline-none focus-visible:border-[var(--os-focus)]";

  return (
    <Dialog open={open} onOpenChange={(v) => { if (!v) void requestClose(); }}>
      <DialogContent className="max-h-[90vh] max-w-[960px]"
        onEscapeKeyDown={(e) => {
          // Outside the shell (no LayerStack) Radix's own Esc runs requestClose.
          if (!shell) return;
          e.preventDefault();
          if (shell.closeTopLayer() === "none") void requestClose();
        }}>
        <DialogHeader>
          <DialogTitle>{mode === "edit" ? "Edit survey" : "New survey"}</DialogTitle>
          <DialogDescription>Save it as a draft, or publish it to send it now.</DialogDescription>
        </DialogHeader>
        <div ref={bodyRef} className="flex min-h-0 flex-col gap-5 overflow-y-auto pe-1" onKeyDown={(e) => { if ((e.metaKey || e.ctrlKey) && e.key === "Enter") { e.preventDefault(); void save("ACTIVE"); } }}>
          <label className="flex flex-col gap-1">
            <span className="text-sm font-medium text-ink">Title</span>
            <input autoFocus value={title} maxLength={200} onChange={(e) => touch(setTitle)(e.target.value)} className={input} />
          </label>

          <div className="flex flex-col gap-2">
            <span className="text-sm font-medium text-ink">Questions</span>
            <ReorderableList
              items={questions}
              itemKey={(q) => q.id}
              itemLabel={(q) => q.text}
              onReorder={(next) => { setDirty(true); setQuestions(next); }}
              renderRow={(q, api) => {
                const pick = q.type === "single_choice" || q.type === "multi_choice";
                const opts = q.options ?? [];
                return (
                  <div className="flex flex-col gap-2 rounded-md border border-line p-2">
                    <div className="flex items-center gap-2">
                      {api.grip}
                      <input value={q.text} maxLength={1000} placeholder={`Question ${api.index + 1}`} aria-label={`Question ${api.index + 1}`} onChange={(e) => setQ(q.id, { text: e.target.value })} className={input} />
                      <PickerButton ariaLabel={`Type of question ${api.index + 1}`} label={SURVEY_QUESTION_TYPES.find((t) => t.value === q.type)?.label ?? "Free text"} selected={q.type}
                        sections={[{ options: questionOptions }]}
                        onSelect={(v) => setQ(q.id, { type: v as QType, options: v === "single_choice" || v === "multi_choice" ? (q.options?.length ? q.options : ["", ""]) : undefined })} className="shrink-0" />
                      <span className="relative shrink-0">
                        <button type="button" aria-label={`More for question ${api.index + 1}`} aria-haspopup="menu" aria-expanded={menuFor === q.id} onClick={() => setMenuFor((m) => (m === q.id ? null : q.id))} className="inline-flex h-8 w-8 items-center justify-center rounded-md text-ink-2 hover:bg-hover hover:text-ink"><MoreHorizontal className="h-4 w-4" /></button>
                        {menuFor === q.id ? (
                          <Picker open onClose={() => setMenuFor(null)} ariaLabel="Question actions" width={180} align="end" className="absolute end-0 top-9 z-50"
                            sections={[{ options: [
                              ...(api.moveUp ? [{ value: "up", label: "Move up" }] : []),
                              ...(api.moveDown ? [{ value: "down", label: "Move down" }] : []),
                              ...(questions.length > 1 ? [{ value: "remove", label: "Remove" }] : []),
                            ] }]}
                            onSelect={(v) => {
                              setMenuFor(null);
                              if (v === "up") api.moveUp?.();
                              else if (v === "down") api.moveDown?.();
                              else if (v === "remove") { setDirty(true); setQuestions((qs) => (qs.length > 1 ? qs.filter((x) => x.id !== q.id) : qs)); }
                            }} />
                        ) : null}
                      </span>
                      <button type="button" aria-label={`Remove question ${api.index + 1}`} disabled={questions.length === 1} onClick={() => { setDirty(true); setQuestions((qs) => qs.filter((x) => x.id !== q.id)); }} className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-md text-ink-2 hover:bg-hover hover:text-ink disabled:opacity-40"><X className="h-4 w-4" /></button>
                    </div>
                    {pick ? (
                      <div className="flex flex-col gap-1 ps-8">
                        {opts.map((o, oi) => (
                          <div key={oi} className="flex items-center gap-2">
                            <input value={o} maxLength={300} placeholder={`Option ${oi + 1}`} aria-label={`Option ${oi + 1} of question ${api.index + 1}`}
                              onChange={(e) => setQ(q.id, { options: opts.map((x, xi) => (xi === oi ? e.target.value : x)) })} className="h-8 w-full rounded-md border border-line bg-raised px-2 text-sm text-ink outline-none focus-visible:border-[var(--os-focus)]" />
                            <button type="button" aria-label={`Remove option ${oi + 1}`} onClick={() => setQ(q.id, { options: opts.filter((_, xi) => xi !== oi) })} className="inline-flex h-7 w-7 items-center justify-center rounded text-ink-2 hover:bg-hover"><X className="h-3.5 w-3.5" /></button>
                          </div>
                        ))}
                        {opts.filter((o) => o.trim()).length < 2 ? <span className="text-xs text-danger-text">Add at least two options.</span> : null}
                        <button type="button" onClick={() => setQ(q.id, { options: [...opts, ""] })} className="self-start text-sm font-medium text-ink-2 hover:text-ink">Add option</button>
                      </div>
                    ) : null}
                    <label className="flex items-center gap-2 ps-8 text-sm text-ink-2">
                      <input type="checkbox" checked={!!q.required} onChange={(e) => setQ(q.id, { required: e.target.checked || undefined })} className="h-4 w-4" />Required
                    </label>
                  </div>
                );
              }}
            />
            <button type="button" onClick={() => { setDirty(true); setQuestions((qs) => [...qs, blank(qs.length + 1)]); }} className="inline-flex h-9 items-center gap-2 self-start rounded-md px-2 text-sm font-medium text-ink-2 hover:bg-hover hover:text-ink"><Plus className="h-4 w-4" />Add question</button>
          </div>

          <div className="grid gap-4 md:grid-cols-2">
            <div className="flex flex-col gap-1">
              <span className="text-sm font-medium text-ink">Who it goes to</span>
              <PickerButton ariaLabel="Audience" label={AUDIENCES.find((a) => a.value === audience)?.label ?? "Everyone"} selected={audience} sections={[{ options: AUDIENCES }]} onSelect={(v) => { setDirty(true); setAudience(v as Audience); }} />
              {audience === "OFFICES" ? idsPicker("Offices", lookups.offices, officeIds, setOfficeIds) : null}
              {audience === "DEPARTMENTS" ? idsPicker("Departments", lookups.departments, departmentIds, setDepartmentIds) : null}
              {audience === "TAGS" ? idsPicker("Tags", lookups.tags, tagIds, setTagIds) : null}
              {audience === "USERS" ? (
                <div className="mt-2">
                  <PeoplePickerField ariaLabel="People" multiple value={userIds} people={people} placeholder="Pick people"
                    onChange={(ids, picked) => { setDirty(true); setUserIds(ids); setPeople(picked); }} />
                </div>
              ) : null}
            </div>
            <div className="flex flex-col gap-3">
              <label className="flex items-start gap-3 text-sm text-ink">
                <Switch checked={anonymous} onChange={(v) => { setDirty(true); setAnonymous(v); }} aria-label="Anonymous" />
                <span className="flex flex-col"><span className="font-medium">Anonymous</span><span className="text-xs text-ink-2">Names are never shown, not even to you. This is fixed once the survey opens.</span></span>
              </label>
              <div className="grid grid-cols-2 gap-3">
                <div className="flex flex-col gap-1">
                  <span className="text-sm font-medium text-ink">Repeats</span>
                  <PickerButton ariaLabel="Repeats" label={REPEATS.find((r) => r.value === frequency)?.label ?? "Does not repeat"} selected={frequency || ""} sections={[{ options: REPEATS.map((r) => ({ value: r.value || "none", label: r.label })) }]} onSelect={(v) => { setDirty(true); setFrequency(v === "none" ? "" : v); }} />
                </div>
                <div className="flex flex-col gap-1">
                  <span className="text-sm font-medium text-ink">Closes on</span>
                  <DateField value={closesAt || null} onChange={(v) => { setDirty(true); setClosesAt(v ?? ""); }} ariaLabel="Closes on" align="end" />
                </div>
              </div>
            </div>
          </div>
          {error ? <p role="alert" className="m-0 text-sm text-danger-text">{error}</p> : null}
          {/* The reveal tail (see the popover effect above). -mt-5 cancels the
              column gap, so at rest it adds nothing to the layout. */}
          <div ref={tailRef} aria-hidden className="-mt-5 shrink-0" />
        </div>
        <DialogFooter className="flex-col items-stretch gap-2 sm:flex-row sm:items-center">
          <span className="me-auto text-xs text-ink-2">Publishing sends this to {reachLine} right away.</span>
          <Button variant="ghost" onClick={() => void requestClose()} disabled={!!busy}>Cancel</Button>
          <Button variant="outline" onClick={() => void save("DRAFT")} disabled={!!busy}>{busy === "DRAFT" ? "Saving" : "Save as draft"}</Button>
          <Button onClick={() => void save("ACTIVE")} disabled={!!busy}>{busy === "ACTIVE" ? "Publishing" : "Publish"}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
