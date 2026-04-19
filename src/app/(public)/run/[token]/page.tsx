"use client";

import { useState, useEffect } from "react";
import { useParams } from "next/navigation";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Progress } from "@/components/ui/progress";
import {
  CheckCircle2,
  Circle,
  AlertCircle,
  Clock,
  ChevronDown,
  ChevronRight,
  Upload,
} from "lucide-react";

// ============================================
// Types
// ============================================

interface InputField {
  id: string;
  type: string;
  label: string;
  required: boolean;
  placeholder?: string;
  options?: string[];
}

interface ContentBlock {
  id: string;
  type: "text" | "horizontal_line" | "image" | "video";
  content: string;
}

interface Step {
  id: string;
  title: string;
  description?: string;
  type: "task" | "approval";
  inputs?: InputField[];
  contentBlocks?: ContentBlock[];
}

interface Section {
  id: string;
  title: string;
  steps: Step[];
}

interface StepData {
  [stepId: string]: {
    completedAt?: string;
    completedBy?: string;
    inputValues?: Record<string, unknown>;
  };
}

interface RunData {
  id: string;
  title: string;
  sopTitle: string;
  description: string;
  progress: number;
  status: string;
  dueDate: string | null;
  sections: Section[];
  completedSteps: string[];
  stepData: StepData;
}

// ============================================
// Component
// ============================================

export default function ProcessRunPage() {
  const { token } = useParams();
  const [data, setData] = useState<RunData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [completing, setCompleting] = useState<string | null>(null);
  const [expandedSections, setExpandedSections] = useState<Set<string>>(new Set());
  // Track input values per step
  const [inputValues, setInputValues] = useState<Record<string, Record<string, unknown>>>({});

  useEffect(() => {
    fetch(`/api/public/run/${token}`)
      .then((res) => {
        if (!res.ok) throw new Error("Process not found or link expired");
        return res.json();
      })
      .then((json) => {
        const d = json.data || json;
        setData(d);
        setExpandedSections(new Set(d.sections?.map((s: Section) => s.id) || []));
        // Load existing input values from stepData
        if (d.stepData) {
          const existing: Record<string, Record<string, unknown>> = {};
          for (const [stepId, sd] of Object.entries(d.stepData as StepData)) {
            if (sd.inputValues) {
              existing[stepId] = sd.inputValues as Record<string, unknown>;
            }
          }
          setInputValues(existing);
        }
      })
      .catch((err) => setError(err.message))
      .finally(() => setLoading(false));
  }, [token]);

  function setStepInputValue(stepId: string, fieldId: string, value: unknown) {
    setInputValues((prev) => ({
      ...prev,
      [stepId]: { ...(prev[stepId] || {}), [fieldId]: value },
    }));
  }

  function validateRequiredInputs(step: Step): boolean {
    if (!step.inputs || step.inputs.length === 0) return true;
    const vals = inputValues[step.id] || {};
    for (const input of step.inputs) {
      if (input.required) {
        const v = vals[input.id];
        if (v === undefined || v === null || v === "") return false;
      }
    }
    return true;
  }

  async function toggleStep(step: Step) {
    if (!data) return;
    const stepId = step.id;
    setCompleting(stepId);

    const isCompleted = data.completedSteps.includes(stepId);
    const action = isCompleted ? "uncomplete_step" : "complete_step";

    // Validate required inputs before completing
    if (!isCompleted && !validateRequiredInputs(step)) {
      setCompleting(null);
      return;
    }

    try {
      const res = await fetch(`/api/public/run/${token}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action,
          stepId,
          inputValues: inputValues[stepId] || null,
        }),
      });

      if (res.ok) {
        const result = await res.json();
        const r = result.data || result;
        setData({
          ...data,
          progress: r.progress,
          completedSteps: r.completedSteps,
          status: r.status,
        });
      }
    } catch {} finally {
      setCompleting(null);
    }
  }

  function toggleSection(sectionId: string) {
    setExpandedSections((prev) => {
      const next = new Set(prev);
      if (next.has(sectionId)) next.delete(sectionId);
      else next.add(sectionId);
      return next;
    });
  }

  // ============================================
  // Loading / Error states
  // ============================================

  if (loading) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <div className="h-8 w-8 animate-spin rounded-full border-2 border-[#d4ff2e] border-t-transparent" />
      </div>
    );
  }

  if (error || !data) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center px-4">
        <Card className="max-w-md w-full border-border bg-surface">
          <CardContent className="p-8 text-center">
            <AlertCircle size={40} className="mx-auto text-red-400 mb-4" />
            <h1 className="text-lg font-semibold mb-2">Process Not Found</h1>
            <p className="text-sm text-muted">{error || "This link may have expired or been removed."}</p>
          </CardContent>
        </Card>
      </div>
    );
  }

  const isComplete = data.status === "COMPLETED";

  // ============================================
  // Render input field
  // ============================================

  function renderInput(stepId: string, input: InputField, isStepComplete: boolean) {
    const value = (inputValues[stepId] || {})[input.id] ?? "";
    const disabled = isStepComplete;

    const common = {
      disabled,
      className: `bg-transparent border-border text-sm ${disabled ? "opacity-50" : ""}`,
    };

    switch (input.type) {
      case "short_text":
        return (
          <Input
            {...common}
            value={value as string}
            onChange={(e) => setStepInputValue(stepId, input.id, e.target.value)}
            placeholder={input.placeholder || input.label}
          />
        );
      case "long_text":
        return (
          <Textarea
            {...common}
            value={value as string}
            onChange={(e) => setStepInputValue(stepId, input.id, e.target.value)}
            placeholder={input.placeholder || input.label}
            rows={3}
          />
        );
      case "number":
        return (
          <Input
            {...common}
            type="number"
            value={value as string}
            onChange={(e) => setStepInputValue(stepId, input.id, e.target.value)}
            placeholder={input.placeholder || "0"}
          />
        );
      case "email":
        return (
          <Input
            {...common}
            type="email"
            value={value as string}
            onChange={(e) => setStepInputValue(stepId, input.id, e.target.value)}
            placeholder={input.placeholder || "email@example.com"}
          />
        );
      case "website":
        return (
          <Input
            {...common}
            type="url"
            value={value as string}
            onChange={(e) => setStepInputValue(stepId, input.id, e.target.value)}
            placeholder={input.placeholder || "https://"}
          />
        );
      case "date":
        return (
          <Input
            {...common}
            type="date"
            value={value as string}
            onChange={(e) => setStepInputValue(stepId, input.id, e.target.value)}
          />
        );
      case "checkbox":
        return (
          <label className="flex items-center gap-2 text-sm cursor-pointer">
            <input
              type="checkbox"
              disabled={disabled}
              checked={!!value}
              onChange={(e) => setStepInputValue(stepId, input.id, e.target.checked)}
              className="rounded"
            />
            <span className={disabled ? "opacity-50" : ""}>{input.label}</span>
          </label>
        );
      case "dropdown":
        return (
          <select
            disabled={disabled}
            value={value as string}
            onChange={(e) => setStepInputValue(stepId, input.id, e.target.value)}
            className={`w-full rounded-md border px-3 py-2 text-sm bg-transparent border-border ${disabled ? "opacity-50" : ""}`}
          >
            <option value="">Select...</option>
            {(input.options || []).map((opt) => (
              <option key={opt} value={opt}>
                {opt}
              </option>
            ))}
          </select>
        );
      case "multichoice": {
        const selected = (value || []) as string[];
        return (
          <div className="space-y-1">
            {(input.options || []).map((opt) => (
              <label key={opt} className="flex items-center gap-2 text-sm cursor-pointer">
                <input
                  type="checkbox"
                  disabled={disabled}
                  checked={selected.includes(opt)}
                  onChange={(e) => {
                    const newVal = e.target.checked
                      ? [...selected, opt]
                      : selected.filter((s) => s !== opt);
                    setStepInputValue(stepId, input.id, newVal);
                  }}
                  className="rounded"
                />
                <span className={disabled ? "opacity-50" : ""}>{opt}</span>
              </label>
            ))}
          </div>
        );
      }
      case "file_upload": {
        const fileUrl = value as string;
        return (
          <div className={`${disabled ? "opacity-50" : ""}`}>
            {fileUrl ? (
              <div className="flex items-center gap-2 p-2 rounded border border-border bg-surface">
                <Upload size={14} className="text-green-400" />
                <a href={fileUrl} target="_blank" rel="noopener" className="text-xs text-[#d4ff2e] hover:underline truncate flex-1">
                  {fileUrl.split("/").pop()}
                </a>
              </div>
            ) : (
              <label className={`flex items-center gap-2 p-3 rounded border border-dashed border-border cursor-pointer hover:border-[#d4ff2e] transition-colors ${disabled ? "pointer-events-none" : ""}`}>
                <Upload size={16} className="text-muted" />
                <span className="text-xs text-muted">Click to upload file (max 10MB)</span>
                <input type="file" className="hidden" disabled={disabled} onChange={async (e) => {
                  const file = e.target.files?.[0];
                  if (!file) return;
                  const fd = new FormData();
                  fd.append("file", file);
                  try {
                    const res = await fetch("/api/upload", { method: "POST", body: fd });
                    if (res.ok) {
                      const data = await res.json();
                      setStepInputValue(stepId, input.id, data.url);
                    }
                  } catch {}
                }} />
              </label>
            )}
          </div>
        );
      }
      default:
        return (
          <Input
            {...common}
            value={value as string}
            onChange={(e) => setStepInputValue(stepId, input.id, e.target.value)}
            placeholder={input.placeholder || input.label}
          />
        );
    }
  }

  // ============================================
  // Main render
  // ============================================

  return (
    <div className="min-h-screen bg-background text-foreground">
      {/* Header */}
      <div className="border-b border-border bg-surface">
        <div className="mx-auto max-w-3xl px-6 py-6">
          <div className="flex items-center gap-2 text-xs text-muted mb-2">
            <span className="bg-gradient-to-r text-[#d4ff2e] font-bold text-sm">
              WorkwrK
            </span>
            <span>/</span>
            <span>{data.sopTitle}</span>
          </div>
          <h1 className="text-xl font-bold text-foreground">{data.title}</h1>
          {data.description && (
            <p className="text-sm text-muted mt-1">{data.description}</p>
          )}
          <div className="flex items-center gap-4 mt-4">
            <div className="flex-1">
              <Progress value={data.progress} className="h-2.5" />
            </div>
            <span className="text-sm font-bold text-[#d4ff2e]">{data.progress}%</span>
          </div>
          {data.dueDate && (
            <div className="flex items-center gap-1 mt-2 text-xs text-muted">
              <Clock size={12} />
              Due: {new Date(data.dueDate).toLocaleDateString()}
            </div>
          )}
          {isComplete && (
            <div className="mt-3 rounded-lg bg-green-500/10 border border-green-500/20 p-3 text-sm text-green-400 text-center">
              Process completed!
            </div>
          )}
        </div>
      </div>

      {/* Sections & Steps */}
      <div className="mx-auto max-w-3xl px-6 py-6 space-y-4">
        {data.sections?.map((section) => {
          const sectionCompleted = section.steps.every((s) =>
            data.completedSteps.includes(s.id)
          );
          const completedCount = section.steps.filter((s) =>
            data.completedSteps.includes(s.id)
          ).length;
          const sectionProgress =
            section.steps.length > 0
              ? Math.round((completedCount / section.steps.length) * 100)
              : 0;
          const isExpanded = expandedSections.has(section.id);

          return (
            <Card key={section.id} className="border-border bg-surface overflow-hidden">
              <button
                onClick={() => toggleSection(section.id)}
                className="w-full flex items-center justify-between p-4 hover:bg-surface-2 transition-colors"
              >
                <div className="flex items-center gap-3">
                  {sectionCompleted ? (
                    <CheckCircle2 size={20} className="text-green-400" />
                  ) : (
                    <div className="h-5 w-5 rounded-full border-2 border-muted-2 flex items-center justify-center">
                      <span className="text-[10px] text-muted">{sectionProgress}%</span>
                    </div>
                  )}
                  <span className="font-medium text-sm">{section.title}</span>
                  <span className="text-xs text-muted-2">
                    {completedCount}/{section.steps.length}
                  </span>
                </div>
                {isExpanded ? (
                  <ChevronDown size={16} className="text-muted" />
                ) : (
                  <ChevronRight size={16} className="text-muted" />
                )}
              </button>

              {isExpanded && (
                <div className="border-t border-border">
                  {section.steps.map((step, idx) => {
                    const isStepComplete = data.completedSteps.includes(step.id);
                    const isApproval = step.type === "approval";
                    const hasInputs = step.inputs && step.inputs.length > 0;
                    const hasContent = step.contentBlocks && step.contentBlocks.length > 0;
                    const hasRequiredInputs = step.inputs?.some((i) => i.required) || false;
                    const canComplete = !hasRequiredInputs || validateRequiredInputs(step);

                    return (
                      <div
                        key={step.id}
                        className={`border-b border-surface-2 last:border-b-0 ${
                          isStepComplete ? "bg-surface-3/50" : ""
                        }`}
                      >
                        {/* Step header */}
                        <div className="flex items-start gap-3 px-4 py-3">
                          <button
                            onClick={() => toggleStep(step)}
                            disabled={completing === step.id || (!isStepComplete && !canComplete)}
                            className="mt-0.5 shrink-0"
                            title={
                              !canComplete && !isStepComplete
                                ? "Fill in required fields first"
                                : undefined
                            }
                          >
                            {completing === step.id ? (
                              <div className="h-5 w-5 animate-spin rounded-full border-2 border-[#d4ff2e] border-t-transparent" />
                            ) : isStepComplete ? (
                              <CheckCircle2 size={20} className="text-green-400" />
                            ) : isApproval ? (
                              <AlertCircle size={20} className="text-amber-400" />
                            ) : (
                              <Circle
                                size={20}
                                className={`transition-colors ${
                                  canComplete
                                    ? "text-border hover:text-[#d4ff2e]"
                                    : "text-border"
                                }`}
                              />
                            )}
                          </button>
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center gap-2">
                              <p
                                className={`text-sm ${
                                  isStepComplete
                                    ? "line-through text-muted-2"
                                    : "text-foreground"
                                }`}
                              >
                                {step.title}
                              </p>
                              {isApproval && !isStepComplete && (
                                <span className="text-[10px] px-1.5 py-0.5 rounded bg-amber-500/10 text-amber-400 border border-amber-500/20">
                                  Approval
                                </span>
                              )}
                              {hasRequiredInputs && !isStepComplete && (
                                <span className="text-[10px] px-1.5 py-0.5 rounded bg-blue-500/10 text-blue-400 border border-blue-500/20">
                                  Has required fields
                                </span>
                              )}
                            </div>
                            {step.description && (
                              <p className="text-xs text-muted-2 mt-0.5">
                                {step.description}
                              </p>
                            )}
                          </div>
                          <span className="text-xs text-muted-2 mt-0.5 shrink-0">
                            {idx + 1}
                          </span>
                        </div>

                        {/* Content blocks */}
                        {hasContent && (
                          <div className="px-12 pb-3 space-y-2">
                            {step.contentBlocks!.map((cb) => {
                              if (cb.type === "horizontal_line") {
                                return (
                                  <hr
                                    key={cb.id}
                                    className="border-border"
                                  />
                                );
                              }
                              if (cb.type === "text") {
                                return (
                                  <p
                                    key={cb.id}
                                    className="text-xs text-muted whitespace-pre-wrap"
                                  >
                                    {cb.content}
                                  </p>
                                );
                              }
                              if (cb.type === "image" && cb.content) {
                                return (
                                  <img
                                    key={cb.id}
                                    src={cb.content}
                                    alt=""
                                    className="max-w-full rounded border border-border"
                                  />
                                );
                              }
                              if (cb.type === "video" && cb.content) {
                                return (
                                  <video
                                    key={cb.id}
                                    src={cb.content}
                                    controls
                                    className="max-w-full rounded"
                                  />
                                );
                              }
                              return null;
                            })}
                          </div>
                        )}

                        {/* Input fields */}
                        {hasInputs && (
                          <div className="px-12 pb-4 space-y-3">
                            {step.inputs!.map((input) => (
                              <div key={input.id} className="space-y-1">
                                {input.type !== "checkbox" && (
                                  <Label className="text-xs text-muted">
                                    {input.label}
                                    {input.required && (
                                      <span className="text-red-400 ml-0.5">*</span>
                                    )}
                                  </Label>
                                )}
                                {renderInput(step.id, input, isStepComplete)}
                              </div>
                            ))}
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}
            </Card>
          );
        })}
      </div>
    </div>
  );
}
