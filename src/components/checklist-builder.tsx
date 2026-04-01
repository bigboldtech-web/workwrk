"use client";

import { useState } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Plus,
  X,
  GripVertical,
  ChevronDown,
  ChevronRight,
  Trash2,
  AlertCircle,
  Copy,
  // Content block icons
  Type,
  Minus,
  Image,
  Video,
  // Input field icons
  Hash,
  AlignLeft,
  AlignJustify,
  CheckSquare,
  Mail,
  Globe,
  Calendar,
  List,
  ListChecks,
  Upload,
  Settings2,
  Sparkles,
} from "lucide-react";

// ============================================
// Types
// ============================================

export interface ChecklistInputField {
  id: string;
  type:
    | "number"
    | "short_text"
    | "long_text"
    | "checkbox"
    | "email"
    | "website"
    | "date"
    | "dropdown"
    | "multichoice"
    | "file_upload";
  label: string;
  required: boolean;
  placeholder?: string;
  options?: string[]; // For dropdown/multichoice
}

export interface ChecklistContentBlock {
  id: string;
  type: "text" | "horizontal_line" | "image" | "video";
  content: string; // text content, image URL, or video URL
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

// ============================================
// Helpers
// ============================================

function genId(prefix: string) {
  return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
}

const INPUT_TYPES: {
  value: ChecklistInputField["type"];
  label: string;
  icon: typeof Hash;
}[] = [
  { value: "number", label: "Number", icon: Hash },
  { value: "short_text", label: "Short Text", icon: AlignLeft },
  { value: "long_text", label: "Long Text", icon: AlignJustify },
  { value: "checkbox", label: "Checkbox", icon: CheckSquare },
  { value: "email", label: "Email", icon: Mail },
  { value: "website", label: "Website", icon: Globe },
  { value: "date", label: "Date", icon: Calendar },
  { value: "dropdown", label: "Dropdown", icon: List },
  { value: "multichoice", label: "Multichoice", icon: ListChecks },
  { value: "file_upload", label: "File Upload", icon: Upload },
];

const CONTENT_TYPES: {
  value: ChecklistContentBlock["type"];
  label: string;
  icon: typeof Type;
}[] = [
  { value: "text", label: "Text", icon: Type },
  { value: "horizontal_line", label: "Horizontal Line", icon: Minus },
  { value: "image", label: "Image", icon: Image },
  { value: "video", label: "Video", icon: Video },
];

// ============================================
// Component
// ============================================

interface ChecklistBuilderProps {
  sections: ChecklistSection[];
  onChange: (sections: ChecklistSection[]) => void;
  editing: boolean;
  onAiGenerate?: () => void;
}

export function ChecklistBuilder({
  sections,
  onChange,
  editing,
  onAiGenerate,
}: ChecklistBuilderProps) {
  const [expandedSections, setExpandedSections] = useState<Set<string>>(
    new Set(sections.map((s) => s.id))
  );
  const [expandedSteps, setExpandedSteps] = useState<Set<string>>(new Set());
  const [showInputPicker, setShowInputPicker] = useState<string | null>(null);
  const [showContentPicker, setShowContentPicker] = useState<string | null>(null);

  // Section operations
  function addSection() {
    const id = genId("sec");
    onChange([
      ...sections,
      { id, title: "", steps: [] },
    ]);
    setExpandedSections((prev) => new Set(prev).add(id));
  }

  function removeSection(sectionId: string) {
    onChange(sections.filter((s) => s.id !== sectionId));
  }

  function updateSectionTitle(sectionId: string, title: string) {
    onChange(
      sections.map((s) => (s.id === sectionId ? { ...s, title } : s))
    );
  }

  function duplicateSection(sectionId: string) {
    const section = sections.find((s) => s.id === sectionId);
    if (!section) return;
    const newId = genId("sec");
    const newSection: ChecklistSection = {
      ...section,
      id: newId,
      title: `${section.title} (Copy)`,
      steps: section.steps.map((step) => ({
        ...step,
        id: genId("step"),
        inputs: step.inputs.map((i) => ({ ...i, id: genId("inp") })),
        contentBlocks: step.contentBlocks.map((c) => ({ ...c, id: genId("cb") })),
      })),
    };
    const idx = sections.findIndex((s) => s.id === sectionId);
    const newSections = [...sections];
    newSections.splice(idx + 1, 0, newSection);
    onChange(newSections);
    setExpandedSections((prev) => new Set(prev).add(newId));
  }

  // Step operations
  function addStep(sectionId: string) {
    const stepId = genId("step");
    onChange(
      sections.map((s) =>
        s.id === sectionId
          ? {
              ...s,
              steps: [
                ...s.steps,
                {
                  id: stepId,
                  title: "",
                  description: "",
                  type: "task" as const,
                  inputs: [],
                  contentBlocks: [],
                },
              ],
            }
          : s
      )
    );
    setExpandedSteps((prev) => new Set(prev).add(stepId));
  }

  function removeStep(sectionId: string, stepId: string) {
    onChange(
      sections.map((s) =>
        s.id === sectionId
          ? { ...s, steps: s.steps.filter((st) => st.id !== stepId) }
          : s
      )
    );
  }

  function updateStep(
    sectionId: string,
    stepId: string,
    updates: Partial<ChecklistStep>
  ) {
    onChange(
      sections.map((s) =>
        s.id === sectionId
          ? {
              ...s,
              steps: s.steps.map((st) =>
                st.id === stepId ? { ...st, ...updates } : st
              ),
            }
          : s
      )
    );
  }

  // Input field operations
  function addInput(sectionId: string, stepId: string, type: ChecklistInputField["type"]) {
    const inputId = genId("inp");
    const defaultLabel =
      INPUT_TYPES.find((t) => t.value === type)?.label || "Field";
    const newInput: ChecklistInputField = {
      id: inputId,
      type,
      label: defaultLabel,
      required: false,
      ...(type === "dropdown" || type === "multichoice"
        ? { options: ["Option 1", "Option 2"] }
        : {}),
    };
    onChange(
      sections.map((s) =>
        s.id === sectionId
          ? {
              ...s,
              steps: s.steps.map((st) =>
                st.id === stepId
                  ? { ...st, inputs: [...st.inputs, newInput] }
                  : st
              ),
            }
          : s
      )
    );
    setShowInputPicker(null);
  }

  function removeInput(sectionId: string, stepId: string, inputId: string) {
    onChange(
      sections.map((s) =>
        s.id === sectionId
          ? {
              ...s,
              steps: s.steps.map((st) =>
                st.id === stepId
                  ? { ...st, inputs: st.inputs.filter((i) => i.id !== inputId) }
                  : st
              ),
            }
          : s
      )
    );
  }

  function updateInput(
    sectionId: string,
    stepId: string,
    inputId: string,
    updates: Partial<ChecklistInputField>
  ) {
    onChange(
      sections.map((s) =>
        s.id === sectionId
          ? {
              ...s,
              steps: s.steps.map((st) =>
                st.id === stepId
                  ? {
                      ...st,
                      inputs: st.inputs.map((i) =>
                        i.id === inputId ? { ...i, ...updates } : i
                      ),
                    }
                  : st
              ),
            }
          : s
      )
    );
  }

  // Content block operations
  function addContentBlock(
    sectionId: string,
    stepId: string,
    type: ChecklistContentBlock["type"]
  ) {
    const cbId = genId("cb");
    const newBlock: ChecklistContentBlock = {
      id: cbId,
      type,
      content: "",
    };
    onChange(
      sections.map((s) =>
        s.id === sectionId
          ? {
              ...s,
              steps: s.steps.map((st) =>
                st.id === stepId
                  ? { ...st, contentBlocks: [...st.contentBlocks, newBlock] }
                  : st
              ),
            }
          : s
      )
    );
    setShowContentPicker(null);
  }

  function removeContentBlock(
    sectionId: string,
    stepId: string,
    cbId: string
  ) {
    onChange(
      sections.map((s) =>
        s.id === sectionId
          ? {
              ...s,
              steps: s.steps.map((st) =>
                st.id === stepId
                  ? {
                      ...st,
                      contentBlocks: st.contentBlocks.filter(
                        (c) => c.id !== cbId
                      ),
                    }
                  : st
              ),
            }
          : s
      )
    );
  }

  function updateContentBlock(
    sectionId: string,
    stepId: string,
    cbId: string,
    content: string
  ) {
    onChange(
      sections.map((s) =>
        s.id === sectionId
          ? {
              ...s,
              steps: s.steps.map((st) =>
                st.id === stepId
                  ? {
                      ...st,
                      contentBlocks: st.contentBlocks.map((c) =>
                        c.id === cbId ? { ...c, content } : c
                      ),
                    }
                  : st
              ),
            }
          : s
      )
    );
  }

  function toggleSection(id: string) {
    setExpandedSections((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function toggleStep(id: string) {
    setExpandedSteps((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  // ============================================
  // Render
  // ============================================

  return (
    <div className="space-y-4">
      {/* Header */}
      {editing && (
        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" onClick={addSection} className="gap-1.5">
            <Plus size={14} /> Add Section
          </Button>
          {onAiGenerate && (
            <Button variant="outline" size="sm" onClick={onAiGenerate} className="gap-1.5">
              <Sparkles size={14} /> AI Generate
            </Button>
          )}
        </div>
      )}

      {sections.length === 0 && (
        <div className="text-center py-12 border border-dashed border-[#2A2A3A] rounded-lg">
          <ListChecks size={40} className="mx-auto text-[#8888A0] mb-3" />
          <p className="text-sm text-[#8888A0] mb-1">No sections yet</p>
          <p className="text-xs text-[#6B6B80] mb-4">
            Add sections and steps to build your checklist process
          </p>
          {editing && (
            <div className="flex items-center justify-center gap-2">
              <Button variant="outline" size="sm" onClick={addSection} className="gap-1.5">
                <Plus size={14} /> Add Section
              </Button>
              {onAiGenerate && (
                <Button variant="outline" size="sm" onClick={onAiGenerate} className="gap-1.5">
                  <Sparkles size={14} /> AI Generate
                </Button>
              )}
            </div>
          )}
        </div>
      )}

      {/* Sections */}
      {sections.map((section, sIdx) => {
        const isExpanded = expandedSections.has(section.id);
        return (
          <Card key={section.id} className="border-[#2A2A3A] overflow-hidden">
            {/* Section Header */}
            <div className="flex items-center gap-2 p-3 bg-[#0D0D14]">
              {editing && (
                <GripVertical
                  size={14}
                  className="text-[#6B6B80] shrink-0 cursor-grab"
                />
              )}
              <button
                onClick={() => toggleSection(section.id)}
                className="shrink-0 text-[#8888A0] hover:text-[#E8E8F0]"
              >
                {isExpanded ? (
                  <ChevronDown size={16} />
                ) : (
                  <ChevronRight size={16} />
                )}
              </button>
              <div className="flex items-center justify-center w-6 h-6 rounded bg-purple-500/10 text-purple-400 text-xs font-bold shrink-0">
                {sIdx + 1}
              </div>
              {editing ? (
                <Input
                  value={section.title}
                  onChange={(e) =>
                    updateSectionTitle(section.id, e.target.value)
                  }
                  placeholder="Section title..."
                  className="bg-transparent border-[#2A2A3A] h-8 text-sm font-medium flex-1"
                />
              ) : (
                <span className="text-sm font-medium flex-1">
                  {section.title || (
                    <span className="text-[#8888A0] italic">
                      Untitled section
                    </span>
                  )}
                </span>
              )}
              <span className="text-xs text-[#6B6B80] shrink-0">
                {section.steps.length} step{section.steps.length !== 1 ? "s" : ""}
              </span>
              {editing && (
                <div className="flex items-center gap-1 shrink-0">
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-6 w-6 text-[#8888A0] hover:text-[#E8E8F0]"
                    onClick={() => duplicateSection(section.id)}
                  >
                    <Copy size={12} />
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-6 w-6 text-red-400 hover:text-red-300"
                    onClick={() => removeSection(section.id)}
                  >
                    <Trash2 size={12} />
                  </Button>
                </div>
              )}
            </div>

            {/* Steps */}
            {isExpanded && (
              <CardContent className="p-3 space-y-2">
                {section.steps.map((step, stIdx) => {
                  const isStepExpanded = expandedSteps.has(step.id);
                  const hasInputs = step.inputs.length > 0;
                  const hasContent = step.contentBlocks.length > 0;

                  return (
                    <div
                      key={step.id}
                      className="rounded-lg border border-[#2A2A3A] bg-[#0A0A0F] overflow-hidden"
                    >
                      {/* Step Header */}
                      <div className="flex items-start gap-2 p-3">
                        {editing && (
                          <GripVertical
                            size={14}
                            className="text-[#6B6B80] mt-1 shrink-0 cursor-grab"
                          />
                        )}
                        <button
                          onClick={() => toggleStep(step.id)}
                          className="mt-1 shrink-0 text-[#8888A0] hover:text-[#E8E8F0]"
                        >
                          {isStepExpanded ? (
                            <ChevronDown size={14} />
                          ) : (
                            <ChevronRight size={14} />
                          )}
                        </button>
                        <div className="flex items-center justify-center w-5 h-5 rounded-full bg-purple-500/10 text-purple-400 text-[10px] font-bold shrink-0 mt-0.5">
                          {stIdx + 1}
                        </div>
                        <div className="flex-1 min-w-0">
                          {editing ? (
                            <Input
                              value={step.title}
                              onChange={(e) =>
                                updateStep(section.id, step.id, {
                                  title: e.target.value,
                                })
                              }
                              placeholder="Step title..."
                              className="bg-transparent border-[#2A2A3A] h-7 text-sm"
                            />
                          ) : (
                            <p className="text-sm mt-0.5">
                              {step.title || (
                                <span className="text-[#8888A0] italic">
                                  Untitled step
                                </span>
                              )}
                            </p>
                          )}
                        </div>
                        <div className="flex items-center gap-1.5 shrink-0">
                          {step.type === "approval" && (
                            <span className="text-[10px] px-1.5 py-0.5 rounded bg-amber-500/10 text-amber-400 border border-amber-500/20">
                              Approval
                            </span>
                          )}
                          {hasInputs && (
                            <span className="text-[10px] px-1.5 py-0.5 rounded bg-blue-500/10 text-blue-400 border border-blue-500/20">
                              {step.inputs.length} field{step.inputs.length !== 1 ? "s" : ""}
                            </span>
                          )}
                          {editing && (
                            <Button
                              variant="ghost"
                              size="icon"
                              className="h-6 w-6 text-red-400 hover:text-red-300"
                              onClick={() => removeStep(section.id, step.id)}
                            >
                              <X size={12} />
                            </Button>
                          )}
                        </div>
                      </div>

                      {/* Step Expanded Content */}
                      {isStepExpanded && (
                        <div className="border-t border-[#2A2A3A] p-3 space-y-3">
                          {/* Description */}
                          {editing ? (
                            <div className="space-y-1">
                              <Label className="text-[10px] text-[#8888A0] uppercase tracking-wider">
                                Description
                              </Label>
                              <Textarea
                                value={step.description || ""}
                                onChange={(e) =>
                                  updateStep(section.id, step.id, {
                                    description: e.target.value,
                                  })
                                }
                                placeholder="Describe what needs to be done..."
                                rows={2}
                                className="bg-transparent border-[#2A2A3A] text-sm"
                              />
                            </div>
                          ) : step.description ? (
                            <p className="text-xs text-[#8888A0]">
                              {step.description}
                            </p>
                          ) : null}

                          {/* Step Type */}
                          {editing && (
                            <div className="space-y-1">
                              <Label className="text-[10px] text-[#8888A0] uppercase tracking-wider">
                                Step Type
                              </Label>
                              <Select
                                value={step.type}
                                onValueChange={(v) =>
                                  updateStep(section.id, step.id, {
                                    type: v as "task" | "approval",
                                  })
                                }
                              >
                                <SelectTrigger className="w-40 h-8 text-xs">
                                  <SelectValue />
                                </SelectTrigger>
                                <SelectContent>
                                  <SelectItem value="task">Task</SelectItem>
                                  <SelectItem value="approval">
                                    Approval Required
                                  </SelectItem>
                                </SelectContent>
                              </Select>
                            </div>
                          )}

                          {/* Content Blocks */}
                          {(hasContent || editing) && (
                            <div className="space-y-2">
                              <div className="flex items-center justify-between">
                                <Label className="text-[10px] text-[#8888A0] uppercase tracking-wider">
                                  Content
                                </Label>
                                {editing && (
                                  <div className="relative">
                                    <Button
                                      variant="ghost"
                                      size="sm"
                                      className="h-6 text-[10px] gap-1 text-[#8888A0]"
                                      onClick={() =>
                                        setShowContentPicker(
                                          showContentPicker === step.id
                                            ? null
                                            : step.id
                                        )
                                      }
                                    >
                                      <Type size={10} /> Add Content
                                    </Button>
                                    {showContentPicker === step.id && (
                                      <div className="absolute right-0 top-full mt-1 z-10 bg-[#12121A] border border-[#2A2A3A] rounded-lg p-2 shadow-xl min-w-[160px]">
                                        <p className="text-[10px] text-[#6B6B80] uppercase tracking-wider px-2 pb-1">
                                          Content
                                        </p>
                                        {CONTENT_TYPES.map((ct) => (
                                          <button
                                            key={ct.value}
                                            className="w-full flex items-center gap-2 px-2 py-1.5 text-xs text-[#8888A0] hover:text-[#E8E8F0] hover:bg-[#1A1A26] rounded transition-colors"
                                            onClick={() =>
                                              addContentBlock(
                                                section.id,
                                                step.id,
                                                ct.value
                                              )
                                            }
                                          >
                                            <ct.icon size={14} />
                                            {ct.label}
                                          </button>
                                        ))}
                                      </div>
                                    )}
                                  </div>
                                )}
                              </div>
                              {step.contentBlocks.map((cb) => (
                                <div
                                  key={cb.id}
                                  className="flex items-start gap-2"
                                >
                                  {cb.type === "horizontal_line" ? (
                                    <hr className="flex-1 border-[#2A2A3A] my-2" />
                                  ) : cb.type === "text" ? (
                                    editing ? (
                                      <Textarea
                                        value={cb.content}
                                        onChange={(e) =>
                                          updateContentBlock(
                                            section.id,
                                            step.id,
                                            cb.id,
                                            e.target.value
                                          )
                                        }
                                        placeholder="Enter text..."
                                        rows={2}
                                        className="flex-1 bg-transparent border-[#2A2A3A] text-xs"
                                      />
                                    ) : (
                                      <p className="flex-1 text-xs text-[#8888A0] whitespace-pre-wrap">
                                        {cb.content}
                                      </p>
                                    )
                                  ) : (
                                    editing ? (
                                      <Input
                                        value={cb.content}
                                        onChange={(e) =>
                                          updateContentBlock(
                                            section.id,
                                            step.id,
                                            cb.id,
                                            e.target.value
                                          )
                                        }
                                        placeholder={
                                          cb.type === "image"
                                            ? "Image URL..."
                                            : "Video URL..."
                                        }
                                        className="flex-1 bg-transparent border-[#2A2A3A] h-7 text-xs"
                                      />
                                    ) : cb.content ? (
                                      cb.type === "image" ? (
                                        <img
                                          src={cb.content}
                                          alt=""
                                          className="max-w-full rounded border border-[#2A2A3A]"
                                        />
                                      ) : (
                                        <video
                                          src={cb.content}
                                          controls
                                          className="max-w-full rounded"
                                        />
                                      )
                                    ) : null
                                  )}
                                  {editing && (
                                    <Button
                                      variant="ghost"
                                      size="icon"
                                      className="h-6 w-6 text-red-400 hover:text-red-300 shrink-0"
                                      onClick={() =>
                                        removeContentBlock(
                                          section.id,
                                          step.id,
                                          cb.id
                                        )
                                      }
                                    >
                                      <X size={10} />
                                    </Button>
                                  )}
                                </div>
                              ))}
                            </div>
                          )}

                          {/* Input Fields */}
                          {(hasInputs || editing) && (
                            <div className="space-y-2">
                              <div className="flex items-center justify-between">
                                <Label className="text-[10px] text-[#8888A0] uppercase tracking-wider">
                                  Input Fields
                                </Label>
                                {editing && (
                                  <div className="relative">
                                    <Button
                                      variant="ghost"
                                      size="sm"
                                      className="h-6 text-[10px] gap-1 text-[#8888A0]"
                                      onClick={() =>
                                        setShowInputPicker(
                                          showInputPicker === step.id
                                            ? null
                                            : step.id
                                        )
                                      }
                                    >
                                      <Hash size={10} /> Add Input
                                    </Button>
                                    {showInputPicker === step.id && (
                                      <div className="absolute right-0 top-full mt-1 z-10 bg-[#12121A] border border-[#2A2A3A] rounded-lg p-2 shadow-xl min-w-[160px]">
                                        <p className="text-[10px] text-[#6B6B80] uppercase tracking-wider px-2 pb-1">
                                          Inputs
                                        </p>
                                        {INPUT_TYPES.map((it) => (
                                          <button
                                            key={it.value}
                                            className="w-full flex items-center gap-2 px-2 py-1.5 text-xs text-[#8888A0] hover:text-[#E8E8F0] hover:bg-[#1A1A26] rounded transition-colors"
                                            onClick={() =>
                                              addInput(
                                                section.id,
                                                step.id,
                                                it.value
                                              )
                                            }
                                          >
                                            <it.icon size={14} />
                                            {it.label}
                                          </button>
                                        ))}
                                      </div>
                                    )}
                                  </div>
                                )}
                              </div>
                              {step.inputs.map((input) => (
                                <div
                                  key={input.id}
                                  className="flex items-start gap-2 p-2 rounded border border-[#1A1A26] bg-[#0D0D14]"
                                >
                                  <div className="flex items-center justify-center w-6 h-6 rounded bg-blue-500/10 text-blue-400 shrink-0 mt-0.5">
                                    {(() => {
                                      const Icon =
                                        INPUT_TYPES.find(
                                          (t) => t.value === input.type
                                        )?.icon || Hash;
                                      return <Icon size={12} />;
                                    })()}
                                  </div>
                                  <div className="flex-1 min-w-0 space-y-1.5">
                                    {editing ? (
                                      <>
                                        <div className="flex items-center gap-2">
                                          <Input
                                            value={input.label}
                                            onChange={(e) =>
                                              updateInput(
                                                section.id,
                                                step.id,
                                                input.id,
                                                { label: e.target.value }
                                              )
                                            }
                                            placeholder="Field label..."
                                            className="bg-transparent border-[#2A2A3A] h-7 text-xs flex-1"
                                          />
                                          <label className="flex items-center gap-1 text-[10px] text-[#8888A0] shrink-0 cursor-pointer">
                                            <input
                                              type="checkbox"
                                              checked={input.required}
                                              onChange={(e) =>
                                                updateInput(
                                                  section.id,
                                                  step.id,
                                                  input.id,
                                                  {
                                                    required: e.target.checked,
                                                  }
                                                )
                                              }
                                              className="rounded"
                                            />
                                            Required
                                          </label>
                                        </div>
                                        {(input.type === "dropdown" ||
                                          input.type === "multichoice") && (
                                          <div className="space-y-1">
                                            <Label className="text-[10px] text-[#6B6B80]">
                                              Options (one per line)
                                            </Label>
                                            <Textarea
                                              value={(
                                                input.options || []
                                              ).join("\n")}
                                              onChange={(e) =>
                                                updateInput(
                                                  section.id,
                                                  step.id,
                                                  input.id,
                                                  {
                                                    options:
                                                      e.target.value.split(
                                                        "\n"
                                                      ),
                                                  }
                                                )
                                              }
                                              rows={3}
                                              className="bg-transparent border-[#2A2A3A] text-xs"
                                            />
                                          </div>
                                        )}
                                      </>
                                    ) : (
                                      <div className="flex items-center gap-2">
                                        <span className="text-xs">
                                          {input.label}
                                        </span>
                                        <span className="text-[10px] text-[#6B6B80]">
                                          ({INPUT_TYPES.find((t) => t.value === input.type)?.label})
                                        </span>
                                        {input.required && (
                                          <span className="text-[10px] text-red-400">
                                            *Required
                                          </span>
                                        )}
                                      </div>
                                    )}
                                  </div>
                                  {editing && (
                                    <Button
                                      variant="ghost"
                                      size="icon"
                                      className="h-6 w-6 text-red-400 hover:text-red-300 shrink-0"
                                      onClick={() =>
                                        removeInput(
                                          section.id,
                                          step.id,
                                          input.id
                                        )
                                      }
                                    >
                                      <X size={10} />
                                    </Button>
                                  )}
                                </div>
                              ))}
                            </div>
                          )}
                        </div>
                      )}
                    </div>
                  );
                })}

                {/* Add Step Button */}
                {editing && (
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => addStep(section.id)}
                    className="w-full border border-dashed border-[#2A2A3A] text-[#8888A0] hover:text-[#E8E8F0] gap-1.5"
                  >
                    <Plus size={14} /> Add Step
                  </Button>
                )}
              </CardContent>
            )}
          </Card>
        );
      })}
    </div>
  );
}
