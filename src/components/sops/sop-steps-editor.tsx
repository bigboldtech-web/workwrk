"use client";

// The Step-by-step editor (spec-process section 2 `/sops/[id]`, Content tab
// in edit mode): numbered step cards with a 44px header row (grip, number
// pill, title input, "…" with Move up / Move down / Duplicate / Delete), a
// body with the step's rich text and optional image (StepImageEditor), an
// "+ Add step" ghost row, and drag to reorder. The flow layout renders the
// same steps through ProcessFlowBuilder (with branches). The "Show as flow"
// display option lives on the Content tab's "…" in the page; this component
// only renders whichever layout it is handed.
//
// Everything a person could do to a step before is here: add, edit title
// and rich description, attach an image by upload or URL, reorder by drag
// or by the menu, duplicate, delete.

import { useEffect, useRef, useState } from "react";
import { GripVertical, Plus } from "lucide-react";
import { RichEditor } from "@/components/ui/rich-editor";
import { RowMoreButton } from "@/components/ui/table-card";
import { MenuItem, MenuList, MenuSeparator } from "@/components/ui/menu";
import { MorePortal } from "@/components/layout/os/more-portal";
import { usePrompt } from "@/components/ui/dialog-provider";
import { ProcessFlowBuilder, type ProcessFlow, type ProcessFlowStep } from "@/components/process-flow-builder";
import { FlowStepOwnerRows } from "@/components/sops/sop-read-view";
import { cn } from "@/lib/utils";
import { Switch } from "@/components/ui/switch";
import { ownerFields, type LayoutStep } from "@/lib/sop-step-layout";

/** A step as the editor holds it (src/lib/sop-step-layout.ts owns the shape). */
export type EditStep = LayoutStep;

/**
 * The conversions between the two layouts live in src/lib/sop-step-layout.ts
 * (pure and tested): the image, the job title and "Creates a task" ride along
 * both ways, so switching the layout or saving in flow mode never drops one.
 */
export { flowFromSteps, stepsFromFlow } from "@/lib/sop-step-layout";

export function newStepId(): string {
  return `step_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

type JobTitleOption = { id: string; title: string };

/** The workspace's job titles, read once per editor (GET /api/roles). */
function useJobTitles(): { titles: JobTitleOption[]; loaded: boolean; failed: boolean; retry: () => void } {
  const [titles, setTitles] = useState<JobTitleOption[]>([]);
  // Until the first answer, "none yet" is not known: the hint says it is
  // loading rather than asking for job titles that may already exist.
  const [loaded, setLoaded] = useState(false);
  const [failed, setFailed] = useState(false);
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    let live = true;
    fetch("/api/roles", { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(String(r.status)))))
      .then((d: unknown) => {
        if (!live) return;
        const rows = Array.isArray(d) ? d : Array.isArray((d as { data?: unknown })?.data) ? (d as { data: unknown[] }).data : [];
        setTitles(rows.map((r) => r as { id?: unknown; title?: unknown }).filter((r) => typeof r.id === "string" && typeof r.title === "string").map((r) => ({ id: r.id as string, title: r.title as string })));
        setFailed(false);
        setLoaded(true);
      })
      .catch(() => { if (live) { setFailed(true); setLoaded(true); } });
    return () => { live = false; };
  }, [attempt]);
  return { titles, loaded, failed, retry: () => setAttempt((a) => a + 1) };
}

/** The job titles' load state, said once where a row of controls sits under it. */
function JobTitlesHint({ titles, loaded = true, failed, retry }: { titles: JobTitleOption[]; loaded?: boolean; failed: boolean; retry: () => void }) {
  if (!loaded) return <span className="text-xs text-ink-3">Loading job titles…</span>;
  if (failed) {
    return (
      <span className="text-xs text-ink-3">
        Job titles did not load. <button type="button" onClick={retry} className="font-medium text-ink-2 underline">Retry</button>
      </span>
    );
  }
  return titles.length === 0 ? <span className="text-xs text-ink-3">Add job titles in People to give steps an owner.</span> : null;
}

function StepOwnerRow({ step, titles, loaded = true, failed, retry, onChange, hint = true }: {
  step: EditStep;
  titles: JobTitleOption[];
  loaded?: boolean;
  failed: boolean;
  retry: () => void;
  onChange: (patch: Partial<EditStep>) => void;
  /** Off where the caller says the job titles' state once for many rows. */
  hint?: boolean;
}) {
  const current = step.jobTitle ?? null;
  // A title that was renamed or deleted since the step was saved still shows
  // what the step holds, so the select never silently reads as "No owner".
  const known = current ? titles.some((t) => t.id === current.roleId) : true;
  return (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
      <label className="inline-flex items-center gap-2 text-sm text-ink-2">
        Owner by job title
        <select
          value={current?.roleId ?? ""}
          onChange={(e) => {
            const id = e.target.value;
            const t = titles.find((x) => x.id === id);
            onChange({ jobTitle: t ? { roleId: t.id, title: t.title } : null });
          }}
          className="h-7 rounded-md border border-line bg-raised px-2 text-sm text-ink"
        >
          <option value="">No owner</option>
          {!known && current ? <option value={current.roleId}>{current.title}</option> : null}
          {titles.map((t) => <option key={t.id} value={t.id}>{t.title}</option>)}
        </select>
      </label>
      {hint ? <JobTitlesHint titles={titles} loaded={loaded} failed={failed} retry={retry} /> : null}
      <label className="inline-flex items-center gap-2 text-sm text-ink-2">
        <Switch checked={step.createsTask === true} onChange={(v) => onChange({ createsTask: v })} aria-label="Creates a task when the SOP is run" />
        Creates a task when the SOP is run
      </label>
    </div>
  );
}

/** The flow layout's owners: the read summary at rest, the same per-step controls as the list behind "Edit owners". */
function FlowOwnersEditor({ flow, onFlowChange, jobTitles }: {
  flow: ProcessFlow;
  onFlowChange: (next: ProcessFlow) => void;
  jobTitles: { titles: JobTitleOption[]; loaded: boolean; failed: boolean; retry: () => void };
}) {
  const [editing, setEditing] = useState(false);
  // An empty flow has its own empty state below; owners of no steps say nothing.
  if (flow.steps.length === 0) return null;
  // By position, not id: a flow step stored without an id would otherwise
  // match every other id-less step and take the same owner.
  const patch = (index: number, p: Partial<EditStep>) =>
    onFlowChange({ ...flow, steps: flow.steps.map((s, j) => (j === index ? ({ ...s, ...p } as ProcessFlowStep) : s)) });
  // One section in both states, with the SAME toggle button, so keyboard
  // focus stays on it and aria-expanded is heard; only the rows below swap.
  // "Done" here only folds the owner controls (the sticky bar's Done leaves
  // edit mode), so it is named for what it closes.
  return (
    <section aria-label="Owners by job title" className="rounded-lg border border-line bg-raised">
      <div className="flex min-h-11 flex-wrap items-center gap-x-3 gap-y-1 px-3 py-2">
        <span className="min-w-0 flex-1 text-sm font-medium text-ink-2">Owners by job title</span>
        <button type="button" onClick={() => setEditing((v) => !v)} aria-expanded={editing} aria-label={editing ? "Done editing owners" : undefined} className="inline-flex h-7 items-center rounded-md px-2 text-sm font-medium text-ink-2 hover:bg-hover hover:text-ink">
          {editing ? "Done" : "Edit owners"}
        </button>
        {/* Once for every step, not once per row. */}
        {editing ? <span className="basis-full empty:hidden"><JobTitlesHint titles={jobTitles.titles} loaded={jobTitles.loaded} failed={jobTitles.failed} retry={jobTitles.retry} /></span> : null}
      </div>
      {editing ? (
        <ol className="flex flex-col divide-y divide-line border-t border-line">
          {flow.steps.map((s, i) => (
            <li key={s.id ?? i} className="flex flex-col gap-2 px-3 py-2">
              <span className="flex items-center gap-3">
                <span className="inline-flex h-6 min-w-6 items-center justify-center rounded-full bg-active px-1.5 text-xs font-medium tabular-nums text-ink">{i + 1}</span>
                <span className="min-w-0 flex-1 truncate text-row text-ink">{s.title || `Step ${i + 1}`}</span>
              </span>
              <StepOwnerRow
                step={{ id: s.id, title: s.title, ...ownerFields(s as { jobTitle?: unknown; createsTask?: unknown }) }}
                titles={jobTitles.titles}
                loaded={jobTitles.loaded}
                failed={jobTitles.failed}
                retry={jobTitles.retry}
                onChange={(p) => patch(i, p)}
                hint={false}
              />
            </li>
          ))}
        </ol>
      ) : (
        <FlowStepOwnerRows steps={flow.steps} />
      )}
    </section>
  );
}

function StepImageEditor({ image, onChange }: { image?: string; onChange: (img: string) => void }) {
  const prompt = usePrompt();
  const inputRef = useRef<HTMLInputElement | null>(null);

  function handleFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => { const src = reader.result as string; if (src) onChange(src); };
    reader.readAsDataURL(file);
  }
  async function handleUrl() {
    const url = await prompt({ title: "Paste image URL", description: "Leave blank to remove the current image.", defaultValue: image || "", placeholder: "https://", submitLabel: image ? "Save" : "Add image", required: false });
    if (url === null) return;
    onChange(url);
  }

  if (image) {
    return (
      <div className="relative inline-block">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={image} alt="" className="max-h-48 rounded-lg border border-line" />
        <div className="absolute end-1 top-1 flex gap-1">
          <button type="button" onClick={() => void handleUrl()} className="rounded bg-inverse px-1.5 py-0.5 text-xs text-inverse-fg">Replace</button>
          <button type="button" onClick={() => onChange("")} aria-label="Remove image" className="rounded bg-inverse px-1.5 py-0.5 text-xs text-inverse-fg">Remove</button>
        </div>
      </div>
    );
  }
  return (
    <div className="flex items-center gap-2">
      <input ref={inputRef} type="file" accept="image/*" className="sr-only" onChange={handleFile} />
      <button type="button" onClick={() => inputRef.current?.click()} className="inline-flex h-7 items-center rounded-md border border-dashed border-line-strong px-2 text-sm text-ink-2 hover:bg-hover hover:text-ink">Upload image</button>
      <button type="button" onClick={() => void handleUrl()} className="inline-flex h-7 items-center rounded-md px-2 text-sm text-ink-2 hover:bg-hover hover:text-ink">or paste a URL</button>
    </div>
  );
}

export function SopStepsEditor({ layout, steps, flow, onStepsChange, onFlowChange }: {
  layout: "list" | "flow";
  steps: EditStep[];
  flow: ProcessFlow;
  onStepsChange: (next: EditStep[]) => void;
  onFlowChange: (next: ProcessFlow) => void;
}) {
  const [openId, setOpenId] = useState<string | null>(null);
  const [menu, setMenu] = useState<{ id: string; anchor: React.RefObject<HTMLButtonElement | null> } | null>(null);
  const [dragId, setDragId] = useState<string | null>(null);
  const [overId, setOverId] = useState<string | null>(null);
  const jobTitles = useJobTitles();

  if (layout === "flow") {
    // The flow canvas has no owner controls, so a step's owner by job title
    // and "Creates a task" are listed, and edited with the list layout's own
    // StepOwnerRow, above it (FlowOwnersEditor). Saving in flow mode writes
    // the steps from the flow, owner fields included (sop-editor-page).
    return (
      <div className="flex flex-col gap-3">
        <FlowOwnersEditor flow={flow} onFlowChange={onFlowChange} jobTitles={jobTitles} />
        <ProcessFlowBuilder flow={flow} onChange={onFlowChange} editing />
      </div>
    );
  }

  const update = (id: string, patch: Partial<EditStep>) => onStepsChange(steps.map((s) => (s.id === id ? { ...s, ...patch } : s)));
  const move = (from: number, to: number) => {
    if (from === to || from < 0 || to < 0 || from >= steps.length || to >= steps.length) return;
    const next = steps.slice();
    const [item] = next.splice(from, 1);
    next.splice(to, 0, item);
    onStepsChange(next);
  };
  const add = () => {
    const s: EditStep = { id: newStepId(), title: "", description: "" };
    onStepsChange([...steps, s]);
    setOpenId(s.id);
  };
  const duplicate = (i: number) => {
    const src = steps[i];
    const copy: EditStep = { ...src, id: newStepId() };
    const next = steps.slice();
    next.splice(i + 1, 0, copy);
    onStepsChange(next);
  };
  const remove = (id: string) => {
    onStepsChange(steps.filter((s) => s.id !== id));
    if (openId === id) setOpenId(null);
  };

  return (
    <div className="flex flex-col gap-3">
      {steps.map((step, index) => {
        const open = openId === step.id;
        return (
          <div
            key={step.id}
            draggable={!open}
            onDragStart={(e) => { setDragId(step.id); e.dataTransfer.effectAllowed = "move"; e.dataTransfer.setData("text/plain", step.id); }}
            onDragOver={(e) => { if (!dragId || dragId === step.id) return; e.preventDefault(); e.dataTransfer.dropEffect = "move"; if (overId !== step.id) setOverId(step.id); }}
            onDragLeave={() => { if (overId === step.id) setOverId(null); }}
            onDrop={(e) => { e.preventDefault(); const from = steps.findIndex((s) => s.id === (dragId || e.dataTransfer.getData("text/plain"))); if (from >= 0) move(from, index); setDragId(null); setOverId(null); }}
            onDragEnd={() => { setDragId(null); setOverId(null); }}
            className={cn("rounded-lg border bg-raised", dragId === step.id ? "opacity-40" : "", overId === step.id && dragId && dragId !== step.id ? "border-brand" : "border-line")}
          >
            <div className="flex h-11 items-center gap-2 px-2">
              <span className="inline-flex h-7 w-7 cursor-grab items-center justify-center text-ink-3 active:cursor-grabbing" aria-label="Drag to reorder" title="Drag to reorder">
                <GripVertical className="h-4 w-4" strokeWidth={1.5} aria-hidden />
              </span>
              <span className="inline-flex h-6 min-w-6 items-center justify-center rounded-full bg-active px-1.5 text-xs font-medium tabular-nums text-ink">{index + 1}</span>
              <input
                value={step.title}
                onChange={(e) => update(step.id, { title: e.target.value })}
                onFocus={() => setOpenId(step.id)}
                placeholder="Step title"
                className="h-8 min-w-0 flex-1 rounded-md bg-transparent px-2 text-row font-medium text-ink placeholder:text-ink-3 focus:bg-subtle focus:outline-none"
              />
              <button type="button" onClick={() => setOpenId(open ? null : step.id)} className="inline-flex h-7 items-center rounded-md px-2 text-sm font-medium text-ink-2 hover:bg-hover hover:text-ink">
                {open ? "Done" : "Edit"}
              </button>
              <StepMenuButton id={step.id} open={menu?.id === step.id} onOpen={(anchor) => setMenu({ id: step.id, anchor })} />
            </div>
            {open ? (
              <div className="flex flex-col gap-3 px-4 pb-4 ps-12">
                <RichEditor
                  content={step.description || ""}
                  onChange={(html) => update(step.id, { description: html })}
                  placeholder="Add details, links, lists or formatting. Press / for commands."
                  editable
                  compact
                  minHeight="80px"
                />
                <StepImageEditor image={step.image} onChange={(img) => update(step.id, { image: img })} />
                <StepOwnerRow step={step} titles={jobTitles.titles} loaded={jobTitles.loaded} failed={jobTitles.failed} retry={jobTitles.retry} onChange={(patch) => update(step.id, patch)} />
              </div>
            ) : step.description || step.image || step.jobTitle || step.createsTask ? (
              <button type="button" onClick={() => setOpenId(step.id)} className="block w-full px-4 pb-3 ps-12 text-start">
                {step.description ? <span className="line-clamp-2 text-sm text-ink-2">{step.description.replace(/<[^>]+>/g, " ").trim()}</span> : null}
                {step.image ? <span className="block text-xs text-ink-3">Has an image</span> : null}
                {step.jobTitle || step.createsTask ? (
                  <span className="block text-xs text-ink-3">
                    {step.jobTitle ? `Owner: ${step.jobTitle.title}` : "No owner"}
                    {step.createsTask ? ". Creates a task when run" : ""}
                  </span>
                ) : null}
              </button>
            ) : null}
          </div>
        );
      })}
      <button type="button" onClick={add} className="inline-flex h-11 items-center gap-2 rounded-lg border border-dashed border-line-strong px-3 text-base font-medium text-ink-2 hover:bg-hover hover:text-ink">
        <Plus className="h-4 w-4" strokeWidth={1.5} aria-hidden /> Add step
      </button>
      {menu ? (
        <MorePortal anchorRef={menu.anchor} width={200} open onClose={() => setMenu(null)} placement="below">
          <MenuList onClick={() => setMenu(null)}>
            {(() => {
              const i = steps.findIndex((s) => s.id === menu.id);
              return (
                <>
                  <MenuItem label="Move up" disabled={i <= 0} onClick={() => move(i, i - 1)} />
                  <MenuItem label="Move down" disabled={i >= steps.length - 1} onClick={() => move(i, i + 1)} />
                  <MenuItem label="Duplicate" onClick={() => duplicate(i)} />
                  <MenuSeparator />
                  <MenuItem label="Delete" destructive onClick={() => remove(menu.id)} />
                </>
              );
            })()}
          </MenuList>
        </MorePortal>
      ) : null}
    </div>
  );
}

function StepMenuButton({ id, open, onOpen }: { id: string; open: boolean; onOpen: (ref: React.RefObject<HTMLButtonElement | null>) => void }) {
  const ref = useRef<HTMLButtonElement>(null);
  void id;
  return <RowMoreButton buttonRef={ref} open={open} onClick={() => onOpen(ref)} label="Step actions" />;
}
