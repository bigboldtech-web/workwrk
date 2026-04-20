"use client";

import { useState } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  Plus, X, GripVertical, ChevronDown, ChevronRight, Trash2, Copy,
  AlertCircle, Type, Minus, Image, Video, Hash, AlignLeft, AlignJustify,
  CheckSquare, Mail, Globe, Calendar, List, ListChecks, Upload,
  Sparkles, Settings2, FileText, ArrowUp, ArrowDown,
} from "lucide-react";

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

const INPUT_TYPES: { value: ChecklistInputField["type"]; label: string; icon: typeof Hash }[] = [
  { value: "short_text", label: "Short Text", icon: AlignLeft },
  { value: "long_text", label: "Long Text", icon: AlignJustify },
  { value: "number", label: "Number", icon: Hash },
  { value: "checkbox", label: "Checkbox", icon: CheckSquare },
  { value: "email", label: "Email", icon: Mail },
  { value: "website", label: "Website", icon: Globe },
  { value: "date", label: "Date", icon: Calendar },
  { value: "dropdown", label: "Dropdown", icon: List },
  { value: "multichoice", label: "Multi Choice", icon: ListChecks },
  { value: "file_upload", label: "File Upload", icon: Upload },
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

  return (
    <div className="flex gap-0 min-h-[500px] border border-border rounded-lg overflow-hidden bg-background">
      {/* ===== LEFT PANEL: Sections & Steps ===== */}
      <div className={`overflow-y-auto ${selectedStep ? "w-[55%] border-r border-border" : "w-full"} transition-all`}>
        {/* Header */}
        {editing && (
          <div className="flex items-center gap-2 p-3 border-b border-border bg-surface">
            <Button variant="outline" size="sm" onClick={addSection} className="gap-1.5 text-xs">
              <Plus size={12} /> Section
            </Button>
            {onAiGenerate && (
              <Button variant="outline" size="sm" onClick={onAiGenerate} className="gap-1.5 text-xs">
                <Sparkles size={12} /> AI Generate
              </Button>
            )}
          </div>
        )}

        {/* Empty state */}
        {sections.length === 0 && (
          <div className="text-center py-16 px-4">
            <ListChecks size={40} className="mx-auto text-muted mb-3" />
            <p className="text-sm text-muted mb-1">No sections yet</p>
            <p className="text-xs text-muted-2 mb-4">Add sections and steps to build your process</p>
            {editing && (
              <div className="flex items-center justify-center gap-2">
                <Button variant="outline" size="sm" onClick={addSection} className="gap-1.5"><Plus size={12} /> Add Section</Button>
                {onAiGenerate && <Button variant="outline" size="sm" onClick={onAiGenerate} className="gap-1.5"><Sparkles size={12} /> AI Generate</Button>}
              </div>
            )}
          </div>
        )}

        {/* Sections with hover-to-add dividers */}
        <div>
          {sections.map((section, sIdx) => {
            const isExpanded = expandedSections.has(section.id);
            return (
              <div key={section.id}>
                {/* Hover divider to add section above */}
                {editing && (
                  <div className="group/divider relative h-0">
                    <div className="absolute inset-x-0 -top-1 h-2 z-10 flex items-center justify-center opacity-0 group-hover/divider:opacity-100 transition-opacity cursor-pointer"
                      onClick={() => addSectionAt(sIdx)}>
                      <div className="flex items-center gap-2 px-3 py-0.5 rounded-full bg-[#d4ff2e] text-[#0a0a0a] text-[10px] font-medium shadow-lg">
                        <Plus size={10} /> Add Section
                      </div>
                    </div>
                  </div>
                )}
                {/* Section Header */}
                <div className="flex items-center gap-2 px-3 py-2 bg-surface hover:bg-surface-2 transition-colors">
                  {editing && <GripVertical size={12} className="text-muted-2 shrink-0 cursor-grab" />}
                  <button onClick={() => toggleSection(section.id)} className="shrink-0 text-muted">
                    {isExpanded ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
                  </button>
                  {editing ? (
                    <Input value={section.title} onChange={(e) => updateSectionTitle(section.id, e.target.value)}
                      placeholder="Section title..." className="bg-transparent border-none h-7 text-sm font-semibold flex-1 p-0 focus-visible:ring-0" />
                  ) : (
                    <span className="text-sm font-semibold flex-1">{section.title || "Untitled"}</span>
                  )}
                  <span className="text-[10px] text-muted-2 shrink-0">{section.steps.length} tasks</span>
                  {editing && (
                    <div className="flex items-center gap-0.5 shrink-0">
                      <Button variant="ghost" size="icon" className="h-6 w-6 text-muted" onClick={() => duplicateSection(section.id)}><Copy size={10} /></Button>
                      <Button variant="ghost" size="icon" className="h-6 w-6 text-red-400" onClick={() => removeSection(section.id)}><Trash2 size={10} /></Button>
                    </div>
                  )}
                </div>

                {/* Steps */}
                {isExpanded && (
                  <div>
                    {section.steps.map((step, stIdx) => {
                      const isSelected = selectedStep?.stepId === step.id;
                      const hasInputs = step.inputs.length > 0;
                      return (
                        <div key={step.id}
                          className={`flex items-center gap-2 px-4 py-2 cursor-pointer border-l-2 transition-all ${
                            isSelected ? "border-l-[#d4ff2e] bg-[rgba(212,255,46,0.06)]" : "border-l-transparent hover:bg-surface-2"
                          }`}
                          onClick={() => setSelectedStep({ sectionId: section.id, stepId: step.id })}
                        >
                          <span className="text-xs text-muted-2 w-5 shrink-0">{stIdx + 1}</span>
                          {step.type === "approval" ? (
                            <AlertCircle size={14} className="text-amber-400 shrink-0" />
                          ) : (
                            <div className="h-4 w-4 rounded-full border-2 border-border shrink-0" />
                          )}
                          <span className={`text-sm flex-1 truncate ${step.title ? "" : "text-muted italic"}`}>
                            {step.title || "Untitled step"}
                          </span>
                          {hasInputs && <Badge variant="outline" className="text-[9px] shrink-0">{step.inputs.length} fields</Badge>}
                          {step.type === "approval" && <Badge className="text-[9px] bg-amber-500/10 text-amber-400 shrink-0">Approval</Badge>}
                          {editing && (
                            <div className="flex items-center gap-0.5 shrink-0 opacity-0 group-hover:opacity-100">
                              <Button variant="ghost" size="icon" className="h-5 w-5 text-muted" onClick={(e) => { e.stopPropagation(); moveStep(section.id, step.id, "up"); }}><ArrowUp size={10} /></Button>
                              <Button variant="ghost" size="icon" className="h-5 w-5 text-muted" onClick={(e) => { e.stopPropagation(); moveStep(section.id, step.id, "down"); }}><ArrowDown size={10} /></Button>
                              <Button variant="ghost" size="icon" className="h-5 w-5 text-red-400" onClick={(e) => { e.stopPropagation(); removeStep(section.id, step.id); }}><X size={10} /></Button>
                            </div>
                          )}
                        </div>
                      );
                    })}

                    {/* Add step */}
                    {editing && (
                      <button onClick={() => addStep(section.id)}
                        className="w-full flex items-center gap-2 px-4 py-2 text-xs text-muted hover:text-[#d4ff2e] hover:bg-surface-2 transition-colors border-t border-border/50">
                        <Plus size={12} /> Add task
                      </button>
                    )}
                  </div>
                )}
              </div>
            );
          })}

          {/* Final add section divider at bottom */}
          {editing && sections.length > 0 && (
            <div className="flex items-center justify-center py-3">
              <button onClick={addSection} className="flex items-center gap-1.5 px-3 py-1.5 rounded-full border border-dashed border-border text-xs text-muted hover:text-[#d4ff2e] hover:border-[#d4ff2e] transition-colors">
                <Plus size={12} /> Add Section
              </button>
            </div>
          )}
        </div>
      </div>

      {/* ===== RIGHT PANEL: Step Detail ===== */}
      {selectedStep && selectedStepObj && (
        <div className="w-[45%] overflow-y-auto">
          {/* Panel Header */}
          <div className="flex items-center justify-between p-3 border-b border-border bg-surface">
            <span className="text-xs text-muted">Step Details</span>
            <div className="flex items-center gap-1">
              {editing && (
                <Button variant="ghost" size="icon" className="h-6 w-6 text-red-400" onClick={() => { removeStep(selectedStep.sectionId, selectedStep.stepId); }}>
                  <Trash2 size={12} />
                </Button>
              )}
              <Button variant="ghost" size="icon" className="h-6 w-6 text-muted" onClick={() => setSelectedStep(null)}>
                <X size={14} />
              </Button>
            </div>
          </div>

          <div className="p-4 space-y-4">
            {/* Step Title */}
            {editing ? (
              <Input value={selectedStepObj.title} onChange={(e) => updateStep(selectedStep.sectionId, selectedStep.stepId, { title: e.target.value })}
                placeholder="Step title..." className="text-lg font-semibold border-none p-0 h-auto focus-visible:ring-0" />
            ) : (
              <h3 className="text-lg font-semibold">{selectedStepObj.title || "Untitled step"}</h3>
            )}

            {/* Type Selector */}
            <div className="flex items-center gap-2">
              {(["task", "approval"] as const).map((t) => (
                <button key={t} disabled={!editing}
                  onClick={() => editing && updateStep(selectedStep.sectionId, selectedStep.stepId, { type: t })}
                  className={`px-3 py-1 rounded-full text-xs font-medium transition-colors ${
                    selectedStepObj.type === t
                      ? t === "approval" ? "bg-amber-500/20 text-amber-400 border border-amber-500/30" : "bg-[rgba(212,255,46,0.12)] text-[#d4ff2e] border border-[rgba(212,255,46,0.3)]"
                      : "bg-surface-2 text-muted border border-transparent hover:border-border"
                  }`}>
                  {t === "task" ? "Task" : "Needs Approval"}
                </button>
              ))}
            </div>

            {/* Description */}
            <div className="space-y-1">
              <Label className="text-xs text-muted uppercase tracking-wider">Description</Label>
              {editing ? (
                <Textarea value={selectedStepObj.description || ""} onChange={(e) => updateStep(selectedStep.sectionId, selectedStep.stepId, { description: e.target.value })}
                  placeholder="Describe what needs to be done in this step..." rows={3} className="text-sm" />
              ) : (
                <p className="text-sm text-muted">{selectedStepObj.description || "No description"}</p>
              )}
            </div>

            {/* Content Blocks */}
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <Label className="text-xs text-muted uppercase tracking-wider">Content</Label>
                {editing && (
                  <div className="relative">
                    <Button variant="ghost" size="sm" className="h-6 text-[10px] gap-1 text-muted" onClick={() => setShowContentPicker(!showContentPicker)}>
                      <Type size={10} /> Add Content
                    </Button>
                    {showContentPicker && (
                      <div className="absolute right-0 top-full mt-1 z-10 bg-surface border border-border rounded-lg p-1.5 shadow-xl min-w-[140px]">
                        {CONTENT_TYPES.map((ct) => (
                          <button key={ct.value} className="w-full flex items-center gap-2 px-2 py-1.5 text-xs text-muted hover:text-foreground hover:bg-surface-2 rounded transition-colors"
                            onClick={() => addContentBlock(ct.value)}>
                            <ct.icon size={12} /> {ct.label}
                          </button>
                        ))}
                      </div>
                    )}
                  </div>
                )}
              </div>
              {selectedStepObj.contentBlocks.map((cb) => (
                <div key={cb.id} className="flex items-start gap-2">
                  {cb.type === "horizontal_line" ? <hr className="flex-1 border-border my-2" /> :
                   cb.type === "text" ? (
                    editing ? <Textarea value={cb.content} onChange={(e) => updateContentBlock(cb.id, e.target.value)} placeholder="Enter text..." rows={2} className="flex-1 text-xs" />
                    : <p className="flex-1 text-xs text-muted whitespace-pre-wrap">{cb.content}</p>
                   ) : (
                    editing ? <Input value={cb.content} onChange={(e) => updateContentBlock(cb.id, e.target.value)} placeholder={cb.type === "image" ? "Image URL..." : "Video URL..."} className="flex-1 h-7 text-xs" />
                    : cb.content ? (cb.type === "image" ? <img src={cb.content} alt="" loading="lazy" decoding="async" className="max-w-full rounded border border-border" /> : <video src={cb.content} controls preload="metadata" className="max-w-full rounded" />) : null
                   )}
                  {editing && <Button variant="ghost" size="icon" className="h-6 w-6 text-red-400 shrink-0" onClick={() => removeContentBlock(cb.id)}><X size={10} /></Button>}
                </div>
              ))}
            </div>

            {/* Form Inputs */}
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <Label className="text-xs text-muted uppercase tracking-wider">Form Inputs</Label>
                {editing && (
                  <div className="relative">
                    <Button variant="ghost" size="sm" className="h-6 text-[10px] gap-1 text-muted" onClick={() => setShowInputPicker(!showInputPicker)}>
                      <Hash size={10} /> Add Input
                    </Button>
                    {showInputPicker && (
                      <div className="absolute right-0 top-full mt-1 z-10 bg-surface border border-border rounded-lg p-1.5 shadow-xl min-w-[160px] max-h-[240px] overflow-y-auto">
                        {INPUT_TYPES.map((it) => (
                          <button key={it.value} className="w-full flex items-center gap-2 px-2 py-1.5 text-xs text-muted hover:text-foreground hover:bg-surface-2 rounded transition-colors"
                            onClick={() => selectedStep && addInput(selectedStep.sectionId, selectedStep.stepId, it.value)}>
                            <it.icon size={12} /> {it.label}
                          </button>
                        ))}
                      </div>
                    )}
                  </div>
                )}
              </div>
              {selectedStepObj.inputs.length === 0 && !editing && (
                <p className="text-xs text-muted-2">No form inputs</p>
              )}
              {selectedStepObj.inputs.map((input) => (
                <div key={input.id} className="flex items-start gap-2 p-2 rounded border border-border bg-surface-3">
                  <div className="flex items-center justify-center w-6 h-6 rounded bg-blue-500/10 text-blue-400 shrink-0 mt-0.5">
                    {(() => { const Icon = INPUT_TYPES.find((t) => t.value === input.type)?.icon || Hash; return <Icon size={12} />; })()}
                  </div>
                  <div className="flex-1 min-w-0 space-y-1.5">
                    {editing ? (
                      <>
                        <div className="flex items-center gap-2">
                          <Input value={input.label} onChange={(e) => updateInput(input.id, { label: e.target.value })} placeholder="Field label..." className="bg-transparent border-border h-7 text-xs flex-1" />
                          <label className="flex items-center gap-1 text-[10px] text-muted shrink-0 cursor-pointer">
                            <input type="checkbox" checked={input.required} onChange={(e) => updateInput(input.id, { required: e.target.checked })} className="rounded" />
                            Required
                          </label>
                        </div>
                        {(input.type === "dropdown" || input.type === "multichoice") && (
                          <Textarea value={(input.options || []).join("\n")} onChange={(e) => updateInput(input.id, { options: e.target.value.split("\n") })}
                            rows={3} placeholder="One option per line" className="bg-transparent border-border text-xs" />
                        )}
                      </>
                    ) : (
                      <div className="flex items-center gap-2">
                        <span className="text-xs">{input.label}</span>
                        <span className="text-[10px] text-muted-2">({INPUT_TYPES.find((t) => t.value === input.type)?.label})</span>
                        {input.required && <span className="text-[10px] text-red-400">*Required</span>}
                      </div>
                    )}
                  </div>
                  {editing && <Button variant="ghost" size="icon" className="h-6 w-6 text-red-400 shrink-0" onClick={() => removeInput(input.id)}><X size={10} /></Button>}
                </div>
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
