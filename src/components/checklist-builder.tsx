"use client";

// ChecklistBuilder: the shared checklist editor (the SOP page in edit mode
// and the create route both mount it). Sections hold steps; a step has a
// type (Task / Approval), a description, content blocks (Text, Divider,
// Image, Video) and inputs (Short text, Long text, Number, Yes/No, Email,
// Link, Date, Dropdown, Multiple choice, File) with a Required switch.
//
// Tokens only (spec-process step 3): the shadcn set, the `#0073EA` literal
// and the amber approval badge are gone; an approval step shows a neutral
// "Approval" chip. Every operation the builder had is still here: add a
// section above, below or at the end, rename, duplicate and delete a
// section, add / select / move / delete a step, the step's type, description,
// content blocks and inputs, and the AI generate button when the host
// passes `onAiGenerate`.

import { useState } from "react";
import {
  Plus, X, GripVertical, ChevronDown, ChevronRight, Trash2, Copy,
  Type, Minus, Image, Video, Hash, AlignLeft, AlignJustify,
  CheckSquare, Mail, Globe, Calendar, List, ListChecks, Upload,
  ArrowUp, ArrowDown, Sparkles,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { SegmentedControl } from "@/components/ui/segmented-control";

// ============================================
// Types (exported for other components)
// ============================================

export interface ChecklistInputField {
  id: string;
  type: "number" | "short_text" | "long_text" | "checkbox" | "email" | "website" | "date" | "dropdown" | "multichoice" | "file_upload";
  label: string;
  required: boolean;
  placeholder?: string;
  options?: string[];
}

export interface ChecklistContentBlock {
  id: string;
  type: "text" | "horizontal_line" | "image" | "video";
  content: string;
}

export interface ChecklistStep {
  id: string;
  title: string;
  description?: string;
  type: "task" | "approval";
  inputs: ChecklistInputField[];
  contentBlocks: ChecklistContentBlock[];
}

export interface ChecklistSection {
  id: string;
  title: string;
  steps: ChecklistStep[];
}

function genId(prefix: string) {
  return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
}

// Normalize any persisted `sections` into the rich shape the builder + runner
// expect. Handles the legacy checklist editor shape
// ({ title, steps:[{ id, title, notes }] }) and is idempotent on already-rich
// data, so old checklists open in the rich builder without crashing and
// their `notes` carry over as the step description.
type RawStep = { id?: unknown; title?: unknown; notes?: unknown; description?: unknown; type?: unknown; inputs?: unknown; contentBlocks?: unknown };
type RawSection = { id?: unknown; title?: unknown; steps?: unknown };
export function normalizeChecklistSections(raw: unknown): ChecklistSection[] {
  if (!Array.isArray(raw)) return [];
  return (raw as RawSection[]).map((sec) => ({
    id: typeof sec?.id === "string" ? sec.id : genId("sec"),
    title: typeof sec?.title === "string" ? sec.title : "Steps",
    steps: Array.isArray(sec?.steps)
      ? (sec.steps as RawStep[]).map((st) => ({
          id: typeof st?.id === "string" ? st.id : genId("step"),
          title: typeof st?.title === "string" ? st.title : "",
          description:
            typeof st?.description === "string"
              ? st.description
              : typeof st?.notes === "string"
                ? st.notes
                : "",
          type: (st?.type === "approval" ? "approval" : "task") as ChecklistStep["type"],
          inputs: Array.isArray(st?.inputs) ? (st.inputs as ChecklistInputField[]) : [],
          contentBlocks: Array.isArray(st?.contentBlocks) ? (st.contentBlocks as ChecklistContentBlock[]) : [],
        }))
      : [],
  }));
}

const INPUT_TYPES: { value: ChecklistInputField["type"]; label: string; icon: typeof Hash }[] = [
  { value: "short_text", label: "Short text", icon: AlignLeft },
  { value: "long_text", label: "Long text", icon: AlignJustify },
  { value: "number", label: "Number", icon: Hash },
  { value: "checkbox", label: "Yes/No", icon: CheckSquare },
  { value: "email", label: "Email", icon: Mail },
  { value: "website", label: "Link", icon: Globe },
  { value: "date", label: "Date", icon: Calendar },
  { value: "dropdown", label: "Dropdown", icon: List },
  { value: "multichoice", label: "Multiple choice", icon: ListChecks },
  { value: "file_upload", label: "File", icon: Upload },
];

const CONTENT_TYPES: { value: ChecklistContentBlock["type"]; label: string; icon: typeof Type }[] = [
  { value: "text", label: "Text", icon: Type },
  { value: "horizontal_line", label: "Divider", icon: Minus },
  { value: "image", label: "Image", icon: Image },
  { value: "video", label: "Video", icon: Video },
];

// ============================================
// Main Component
// ============================================

interface ChecklistBuilderProps {
  sections: ChecklistSection[];
  onChange: (sections: ChecklistSection[]) => void;
  editing: boolean;
  onAiGenerate?: () => void;
}

export function ChecklistBuilder({ sections, onChange, editing, onAiGenerate }: ChecklistBuilderProps) {
  const [expandedSections, setExpandedSections] = useState<Set<string>>(new Set(sections.map((s) => s.id)));
  const [selectedStep, setSelectedStep] = useState<{ sectionId: string; stepId: string } | null>(null);
  const [showInputPicker, setShowInputPicker] = useState(false);
  const [showContentPicker, setShowContentPicker] = useState(false);

  // Get the selected step object
  const selectedSection = selectedStep ? sections.find((s) => s.id === selectedStep.sectionId) : null;
  const selectedStepObj = selectedSection?.steps.find((s) => s.id === selectedStep?.stepId) || null;

  // ---- Section operations ----
  function addSection() {
    const id = genId("sec");
    onChange([...sections, { id, title: "", steps: [] }]);
    setExpandedSections((prev) => new Set(prev).add(id));
  }

  function addSectionAt(index: number) {
    const id = genId("sec");
    const ns = [...sections];
    ns.splice(index, 0, { id, title: "", steps: [] });
    onChange(ns);
    setExpandedSections((prev) => new Set(prev).add(id));
  }

  function removeSection(sectionId: string) {
    if (selectedStep?.sectionId === sectionId) setSelectedStep(null);
    onChange(sections.filter((s) => s.id !== sectionId));
  }

  function updateSectionTitle(sectionId: string, title: string) {
    onChange(sections.map((s) => (s.id === sectionId ? { ...s, title } : s)));
  }

  function duplicateSection(sectionId: string) {
    const section = sections.find((s) => s.id === sectionId);
    if (!section) return;
    const newId = genId("sec");
    const newSection: ChecklistSection = {
      ...section, id: newId, title: `${section.title} (Copy)`,
      steps: section.steps.map((step) => ({
        ...step, id: genId("step"),
        inputs: step.inputs.map((i) => ({ ...i, id: genId("inp") })),
        contentBlocks: step.contentBlocks.map((c) => ({ ...c, id: genId("cb") })),
      })),
    };
    const idx = sections.findIndex((s) => s.id === sectionId);
    const ns = [...sections];
    ns.splice(idx + 1, 0, newSection);
    onChange(ns);
  }

  function toggleSection(id: string) {
    setExpandedSections((prev) => { const n = new Set(prev); n.has(id) ? n.delete(id) : n.add(id); return n; });
  }

  // ---- Step operations ----
  function addStep(sectionId: string) {
    const stepId = genId("step");
    onChange(sections.map((s) => s.id === sectionId ? {
      ...s, steps: [...s.steps, { id: stepId, title: "", description: "", type: "task" as const, inputs: [], contentBlocks: [] }],
    } : s));
    setSelectedStep({ sectionId, stepId });
  }

  function removeStep(sectionId: string, stepId: string) {
    if (selectedStep?.stepId === stepId) setSelectedStep(null);
    onChange(sections.map((s) => s.id === sectionId ? { ...s, steps: s.steps.filter((st) => st.id !== stepId) } : s));
  }

  function updateStep(sectionId: string, stepId: string, updates: Partial<ChecklistStep>) {
    onChange(sections.map((s) => s.id === sectionId ? { ...s, steps: s.steps.map((st) => st.id === stepId ? { ...st, ...updates } : st) } : s));
  }

  function moveStep(sectionId: string, stepId: string, direction: "up" | "down") {
    const section = sections.find((s) => s.id === sectionId);
    if (!section) return;
    const idx = section.steps.findIndex((s) => s.id === stepId);
    if (direction === "up" && idx <= 0) return;
    if (direction === "down" && idx >= section.steps.length - 1) return;
    const newSteps = [...section.steps];
    const swapIdx = direction === "up" ? idx - 1 : idx + 1;
    [newSteps[idx], newSteps[swapIdx]] = [newSteps[swapIdx], newSteps[idx]];
    onChange(sections.map((s) => s.id === sectionId ? { ...s, steps: newSteps } : s));
  }

  // ---- Input operations ----
  function addInput(sectionId: string, stepId: string, type: ChecklistInputField["type"]) {
    const label = INPUT_TYPES.find((t) => t.value === type)?.label || "Field";
    const newInput: ChecklistInputField = {
      id: genId("inp"), type, label, required: false,
      ...(type === "dropdown" || type === "multichoice" ? { options: ["Option 1", "Option 2"] } : {}),
    };
    updateStep(sectionId, stepId, {
      inputs: [...(selectedStepObj?.inputs || []), newInput],
    });
    setShowInputPicker(false);
  }

  function removeInput(inputId: string) {
    if (!selectedStep || !selectedStepObj) return;
    updateStep(selectedStep.sectionId, selectedStep.stepId, {
      inputs: selectedStepObj.inputs.filter((i) => i.id !== inputId),
    });
  }

  function updateInput(inputId: string, updates: Partial<ChecklistInputField>) {
    if (!selectedStep || !selectedStepObj) return;
    updateStep(selectedStep.sectionId, selectedStep.stepId, {
      inputs: selectedStepObj.inputs.map((i) => i.id === inputId ? { ...i, ...updates } : i),
    });
  }

  // ---- Content block operations ----
  function addContentBlock(type: ChecklistContentBlock["type"]) {
    if (!selectedStep || !selectedStepObj) return;
    updateStep(selectedStep.sectionId, selectedStep.stepId, {
      contentBlocks: [...selectedStepObj.contentBlocks, { id: genId("cb"), type, content: "" }],
    });
    setShowContentPicker(false);
  }

  function removeContentBlock(cbId: string) {
    if (!selectedStep || !selectedStepObj) return;
    updateStep(selectedStep.sectionId, selectedStep.stepId, {
      contentBlocks: selectedStepObj.contentBlocks.filter((c) => c.id !== cbId),
    });
  }

  function updateContentBlock(cbId: string, content: string) {
    if (!selectedStep || !selectedStepObj) return;
    updateStep(selectedStep.sectionId, selectedStep.stepId, {
      contentBlocks: selectedStepObj.contentBlocks.map((c) => c.id === cbId ? { ...c, content } : c),
    });
  }

  // ============================================
  // Render
  // ============================================

  const GHOST = "inline-flex h-8 items-center gap-1.5 rounded-md px-2 text-sm font-medium text-ink-2 hover:bg-hover hover:text-ink";
  const ICON_BTN = "inline-flex h-7 w-7 items-center justify-center rounded-md text-ink-2 hover:bg-hover hover:text-ink";
  const FIELD = "h-8 w-full rounded-md border border-line-strong bg-raised px-2 text-sm text-ink placeholder:text-ink-3 focus:outline-none focus-visible:border-brand";

  return (
    <div className="flex min-h-[420px] overflow-hidden rounded-lg border border-line bg-raised">
      {/* ===== LEFT: sections and steps ===== */}
      <div className={cn("min-w-0 overflow-y-auto", selectedStep ? "w-[55%] border-e border-line" : "w-full")}>
        {editing ? (
          <div className="flex h-11 items-center gap-1 border-b border-line bg-[var(--os-table-head-bg)] px-2">
            <button type="button" onClick={addSection} className={GHOST}><Plus className="h-4 w-4" strokeWidth={1.5} aria-hidden /> Section</button>
            {onAiGenerate ? <button type="button" onClick={onAiGenerate} className={GHOST}><Sparkles className="h-4 w-4" strokeWidth={1.5} aria-hidden /> Generate with AI</button> : null}
          </div>
        ) : null}

        {sections.length === 0 ? (
          <div className="flex flex-col items-center gap-2 px-4 py-12 text-center">
            <p className="text-row text-ink-2">No sections yet</p>
            <p className="text-sm text-ink-3">Add sections and steps to build this checklist.</p>
            {editing ? (
              <div className="mt-2 flex items-center gap-2">
                <button type="button" onClick={addSection} className={GHOST}><Plus className="h-4 w-4" strokeWidth={1.5} aria-hidden /> Add section</button>
                {onAiGenerate ? <button type="button" onClick={onAiGenerate} className={GHOST}><Sparkles className="h-4 w-4" strokeWidth={1.5} aria-hidden /> Generate with AI</button> : null}
              </div>
            ) : null}
          </div>
        ) : null}

        <div>
          {sections.map((section, sIdx) => {
            const isExpanded = expandedSections.has(section.id);
            return (
              <div key={section.id}>
                {editing ? (
                  <div className="group/divider relative h-0">
                    <button type="button" onClick={() => addSectionAt(sIdx)} className="absolute inset-x-0 -top-1 z-10 flex h-2 items-center justify-center opacity-0 focus-visible:opacity-100 group-hover/divider:opacity-100">
                      <span className="inline-flex h-5 items-center gap-1 rounded-full bg-brand px-2 text-xs font-medium text-white"><Plus className="h-3 w-3" aria-hidden /> Add section</span>
                    </button>
                  </div>
                ) : null}
                <div className="flex h-11 items-center gap-2 border-b border-line-soft bg-[var(--os-table-head-bg)] px-2">
                  {editing ? <GripVertical className="h-4 w-4 shrink-0 text-ink-3" strokeWidth={1.5} aria-hidden /> : null}
                  <button type="button" onClick={() => toggleSection(section.id)} aria-expanded={isExpanded} aria-label={isExpanded ? "Collapse section" : "Expand section"} className={ICON_BTN}>
                    {isExpanded ? <ChevronDown className="h-4 w-4" strokeWidth={1.5} aria-hidden /> : <ChevronRight className="h-4 w-4 rtl:rotate-180" strokeWidth={1.5} aria-hidden />}
                  </button>
                  {editing ? (
                    <input value={section.title} onChange={(e) => updateSectionTitle(section.id, e.target.value)} placeholder="Section title" aria-label="Section title" className="h-8 min-w-0 flex-1 rounded-md bg-transparent px-2 text-row font-medium text-ink placeholder:text-ink-3 focus:bg-raised focus:outline-none" />
                  ) : (
                    <span className="min-w-0 flex-1 truncate text-row font-medium text-ink">{section.title || "Steps"}</span>
                  )}
                  <span className="shrink-0 text-xs tabular-nums text-ink-2">{section.steps.length}</span>
                  {editing ? (
                    <span className="flex shrink-0 items-center">
                      <button type="button" onClick={() => duplicateSection(section.id)} aria-label="Duplicate section" title="Duplicate section" className={ICON_BTN}><Copy className="h-3.5 w-3.5" strokeWidth={1.5} aria-hidden /></button>
                      <button type="button" onClick={() => removeSection(section.id)} aria-label="Delete section" title="Delete section" className={cn(ICON_BTN, "hover:text-danger-text")}><Trash2 className="h-3.5 w-3.5" strokeWidth={1.5} aria-hidden /></button>
                    </span>
                  ) : null}
                </div>

                {isExpanded ? (
                  <div>
                    {section.steps.map((step, stIdx) => {
                      const isSelected = selectedStep?.stepId === step.id;
                      const hasInputs = step.inputs.length > 0;
                      return (
                        <div
                          key={step.id}
                          role="button"
                          tabIndex={0}
                          onClick={() => setSelectedStep({ sectionId: section.id, stepId: step.id })}
                          onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); setSelectedStep({ sectionId: section.id, stepId: step.id }); } }}
                          className={cn("group/step flex h-11 cursor-pointer items-center gap-2 border-b border-line-soft border-s-2 px-3", isSelected ? "border-s-brand bg-selected" : "border-s-transparent hover:bg-hover")}
                        >
                          <span className="w-5 shrink-0 text-xs tabular-nums text-ink-3">{stIdx + 1}</span>
                          <span className={cn("min-w-0 flex-1 truncate text-row", step.title ? "text-ink" : "text-ink-3")}>{step.title || "Untitled step"}</span>
                          {hasInputs ? <span className="shrink-0 text-xs text-ink-2">{step.inputs.length} field{step.inputs.length === 1 ? "" : "s"}</span> : null}
                          {step.type === "approval" ? <span className="inline-flex h-6 shrink-0 items-center rounded-md bg-active px-2 text-xs font-medium text-ink">Approval</span> : null}
                          {editing ? (
                            <span className="flex shrink-0 items-center opacity-0 focus-within:opacity-100 group-hover/step:opacity-100">
                              <button type="button" aria-label="Move step up" title="Move up" disabled={stIdx === 0} className={cn(ICON_BTN, "disabled:opacity-30")} onClick={(e) => { e.stopPropagation(); moveStep(section.id, step.id, "up"); }}><ArrowUp className="h-3.5 w-3.5" strokeWidth={1.5} aria-hidden /></button>
                              <button type="button" aria-label="Move step down" title="Move down" disabled={stIdx === section.steps.length - 1} className={cn(ICON_BTN, "disabled:opacity-30")} onClick={(e) => { e.stopPropagation(); moveStep(section.id, step.id, "down"); }}><ArrowDown className="h-3.5 w-3.5" strokeWidth={1.5} aria-hidden /></button>
                              <button type="button" aria-label="Delete step" title="Delete step" className={cn(ICON_BTN, "hover:text-danger-text")} onClick={(e) => { e.stopPropagation(); removeStep(section.id, step.id); }}><X className="h-3.5 w-3.5" strokeWidth={1.5} aria-hidden /></button>
                            </span>
                          ) : null}
                        </div>
                      );
                    })}
                    {editing ? (
                      <button type="button" onClick={() => addStep(section.id)} className="flex h-10 w-full items-center gap-2 border-b border-line-soft px-3 text-sm font-medium text-ink-2 hover:bg-hover hover:text-ink">
                        <Plus className="h-4 w-4" strokeWidth={1.5} aria-hidden /> Add step
                      </button>
                    ) : null}
                  </div>
                ) : null}
              </div>
            );
          })}

          {editing && sections.length > 0 ? (
            <div className="flex items-center justify-center py-3">
              <button type="button" onClick={addSection} className="inline-flex h-8 items-center gap-1.5 rounded-md border border-dashed border-line-strong px-3 text-sm font-medium text-ink-2 hover:bg-hover hover:text-ink">
                <Plus className="h-4 w-4" strokeWidth={1.5} aria-hidden /> Add section
              </button>
            </div>
          ) : null}
        </div>
      </div>

      {/* ===== RIGHT: step details ===== */}
      {selectedStep && selectedStepObj ? (
        <div className="w-[45%] overflow-y-auto">
          <div className="flex h-11 items-center justify-between border-b border-line bg-[var(--os-table-head-bg)] px-3">
            <span className="text-sm font-medium text-ink-2">Step</span>
            <span className="flex items-center gap-1">
              {editing ? <button type="button" aria-label="Delete step" title="Delete step" className={cn(ICON_BTN, "hover:text-danger-text")} onClick={() => removeStep(selectedStep.sectionId, selectedStep.stepId)}><Trash2 className="h-3.5 w-3.5" strokeWidth={1.5} aria-hidden /></button> : null}
              <button type="button" aria-label="Close" title="Close" className={ICON_BTN} onClick={() => setSelectedStep(null)}><X className="h-4 w-4" strokeWidth={1.5} aria-hidden /></button>
            </span>
          </div>

          <div className="flex flex-col gap-4 p-4">
            {editing ? (
              <input value={selectedStepObj.title} onChange={(e) => updateStep(selectedStep.sectionId, selectedStep.stepId, { title: e.target.value })} placeholder="Step title" aria-label="Step title" className="h-9 w-full rounded-md bg-transparent px-2 text-lg font-semibold text-ink placeholder:text-ink-3 focus:bg-subtle focus:outline-none" />
            ) : (
              <h3 className="text-lg font-semibold text-ink">{selectedStepObj.title || "Untitled step"}</h3>
            )}

            <div className="flex flex-col gap-1">
              <span className="text-sm font-medium text-ink-2">Type</span>
              <SegmentedControl<"task" | "approval">
                label="Step type"
                value={selectedStepObj.type}
                locked={!editing}
                lockedHint="Read only"
                onChange={(t) => updateStep(selectedStep.sectionId, selectedStep.stepId, { type: t })}
                options={[{ value: "task", label: "Task" }, { value: "approval", label: "Approval" }]}
              />
            </div>

            <div className="flex flex-col gap-1">
              <span className="text-sm font-medium text-ink-2">Description</span>
              {editing ? (
                <textarea value={selectedStepObj.description || ""} onChange={(e) => updateStep(selectedStep.sectionId, selectedStep.stepId, { description: e.target.value })} placeholder="What needs to be done in this step" rows={3} className={cn(FIELD, "h-auto py-1.5")} />
              ) : (
                <p className="text-sm text-ink-2">{selectedStepObj.description || "No description"}</p>
              )}
            </div>

            <div className="flex flex-col gap-2">
              <div className="flex items-center justify-between">
                <span className="text-sm font-medium text-ink-2">Content</span>
                {editing ? (
                  <span className="relative">
                    <button type="button" className={GHOST} onClick={() => setShowContentPicker(!showContentPicker)}><Type className="h-3.5 w-3.5" strokeWidth={1.5} aria-hidden /> Block</button>
                    {showContentPicker ? (
                      <ul className="absolute end-0 top-full z-10 mt-1 min-w-[160px] rounded-md border border-line bg-raised py-1 shadow-[var(--os-shadow-pop)]" role="menu">
                        {CONTENT_TYPES.map((ct) => (
                          <li key={ct.value}><button type="button" role="menuitem" className="flex h-8 w-full items-center gap-2 px-2.5 text-start text-sm text-ink hover:bg-hover" onClick={() => addContentBlock(ct.value)}><ct.icon className="h-3.5 w-3.5 text-ink-2" strokeWidth={1.5} aria-hidden /> {ct.label}</button></li>
                        ))}
                      </ul>
                    ) : null}
                  </span>
                ) : null}
              </div>
              {selectedStepObj.contentBlocks.map((cb) => (
                <div key={cb.id} className="flex items-start gap-2">
                  {cb.type === "horizontal_line" ? <hr className="my-2 flex-1 border-line" /> :
                   cb.type === "text" ? (
                    editing ? <textarea value={cb.content} onChange={(e) => updateContentBlock(cb.id, e.target.value)} placeholder="Text" rows={2} className={cn(FIELD, "h-auto flex-1 py-1.5")} />
                    : <p className="flex-1 whitespace-pre-wrap text-sm text-ink-2">{cb.content}</p>
                   ) : (
                    editing ? <input value={cb.content} onChange={(e) => updateContentBlock(cb.id, e.target.value)} placeholder={cb.type === "image" ? "Image URL" : "Video URL"} className={cn(FIELD, "flex-1")} />
                    // eslint-disable-next-line @next/next/no-img-element
                    : cb.content ? (cb.type === "image" ? <img src={cb.content} alt="" loading="lazy" decoding="async" className="max-w-full rounded-md border border-line" /> : <video src={cb.content} controls preload="metadata" className="max-w-full rounded-md" />) : null
                   )}
                  {editing ? <button type="button" aria-label="Remove block" className={cn(ICON_BTN, "shrink-0 hover:text-danger-text")} onClick={() => removeContentBlock(cb.id)}><X className="h-3.5 w-3.5" strokeWidth={1.5} aria-hidden /></button> : null}
                </div>
              ))}
            </div>

            <div className="flex flex-col gap-2">
              <div className="flex items-center justify-between">
                <span className="text-sm font-medium text-ink-2">Inputs</span>
                {editing ? (
                  <span className="relative">
                    <button type="button" className={GHOST} onClick={() => setShowInputPicker(!showInputPicker)}><Plus className="h-3.5 w-3.5" strokeWidth={1.5} aria-hidden /> Add input</button>
                    {showInputPicker ? (
                      <ul className="absolute end-0 top-full z-10 mt-1 max-h-[260px] min-w-[180px] overflow-y-auto rounded-md border border-line bg-raised py-1 shadow-[var(--os-shadow-pop)]" role="menu">
                        {INPUT_TYPES.map((it) => (
                          <li key={it.value}><button type="button" role="menuitem" className="flex h-8 w-full items-center gap-2 px-2.5 text-start text-sm text-ink hover:bg-hover" onClick={() => selectedStep && addInput(selectedStep.sectionId, selectedStep.stepId, it.value)}><it.icon className="h-3.5 w-3.5 text-ink-2" strokeWidth={1.5} aria-hidden /> {it.label}</button></li>
                        ))}
                      </ul>
                    ) : null}
                  </span>
                ) : null}
              </div>
              {selectedStepObj.inputs.length === 0 && !editing ? <p className="text-sm text-ink-3">This step asks for nothing.</p> : null}
              {selectedStepObj.inputs.map((input) => {
                const Icon = INPUT_TYPES.find((t) => t.value === input.type)?.icon || Hash;
                return (
                  <div key={input.id} className="flex items-start gap-2 rounded-md border border-line bg-subtle p-2">
                    <span className="mt-1 inline-flex h-6 w-6 shrink-0 items-center justify-center rounded bg-active text-ink-2"><Icon className="h-3.5 w-3.5" strokeWidth={1.5} aria-hidden /></span>
                    <div className="flex min-w-0 flex-1 flex-col gap-1.5">
                      {editing ? (
                        <>
                          <div className="flex items-center gap-2">
                            <input value={input.label} onChange={(e) => updateInput(input.id, { label: e.target.value })} placeholder="Field label" aria-label="Field label" className={cn(FIELD, "flex-1")} />
                            <label className="inline-flex shrink-0 cursor-pointer items-center gap-1.5 text-sm text-ink-2">
                              <input type="checkbox" checked={input.required} onChange={(e) => updateInput(input.id, { required: e.target.checked })} className="h-4 w-4 rounded border-line-strong accent-[var(--os-brand)]" />
                              Required
                            </label>
                          </div>
                          {input.type === "dropdown" || input.type === "multichoice" ? (
                            <textarea value={(input.options || []).join("\n")} onChange={(e) => updateInput(input.id, { options: e.target.value.split("\n") })} rows={3} placeholder="One option per line" className={cn(FIELD, "h-auto py-1.5")} />
                          ) : null}
                        </>
                      ) : (
                        <div className="flex flex-wrap items-center gap-2 text-sm">
                          <span className="text-ink">{input.label}</span>
                          <span className="text-ink-3">{INPUT_TYPES.find((t) => t.value === input.type)?.label}</span>
                          {input.required ? <span className="text-ink-2">Required</span> : null}
                        </div>
                      )}
                    </div>
                    {editing ? <button type="button" aria-label="Remove input" className={cn(ICON_BTN, "shrink-0 hover:text-danger-text")} onClick={() => removeInput(input.id)}><X className="h-3.5 w-3.5" strokeWidth={1.5} aria-hidden /></button> : null}
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
