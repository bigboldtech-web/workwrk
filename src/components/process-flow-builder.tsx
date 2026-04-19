"use client";

import { useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  ArrowDown, ArrowUp, Plus, Trash2, GitBranch, Timer, User, ChevronRight, ChevronDown,
} from "lucide-react";

export type ProcessFlowStepType = "action" | "decision" | "handoff";

export interface ProcessFlowBranch {
  label: string;
  nextStepId: string | null;
}

export interface ProcessFlowStep {
  id: string;
  title: string;
  description?: string;
  type: ProcessFlowStepType;
  actor?: string;
  durationMinutes?: number;
  branches?: ProcessFlowBranch[];
}

export interface ProcessFlow {
  type: "process_flow";
  steps: ProcessFlowStep[];
}

function genId() {
  return `s_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
}

const TYPE_META: Record<ProcessFlowStepType, { label: string; tone: string }> = {
  action: { label: "Action", tone: "#d4ff2e" },
  decision: { label: "Decision", tone: "#ff9933" },
  handoff: { label: "Handoff", tone: "#4a9eff" },
};

export function ProcessFlowBuilder({
  flow,
  onChange,
  editing,
}: {
  flow: ProcessFlow;
  onChange: (next: ProcessFlow) => void;
  editing: boolean;
}) {
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const steps = flow.steps ?? [];

  const nextIds = useMemo(
    () => new Map(steps.map((s, i) => [s.id, steps[i + 1]?.id ?? null])),
    [steps],
  );

  function updateStep(id: string, patch: Partial<ProcessFlowStep>) {
    onChange({ ...flow, steps: steps.map((s) => (s.id === id ? { ...s, ...patch } : s)) });
  }

  function addStep() {
    const s: ProcessFlowStep = {
      id: genId(),
      title: `Step ${steps.length + 1}`,
      type: "action",
    };
    onChange({ ...flow, steps: [...steps, s] });
    setExpandedId(s.id);
  }

  function removeStep(id: string) {
    onChange({ ...flow, steps: steps.filter((s) => s.id !== id) });
  }

  function moveStep(id: string, dir: -1 | 1) {
    const idx = steps.findIndex((s) => s.id === id);
    const target = idx + dir;
    if (idx < 0 || target < 0 || target >= steps.length) return;
    const next = [...steps];
    [next[idx], next[target]] = [next[target], next[idx]];
    onChange({ ...flow, steps: next });
  }

  function toggleType(id: string, type: ProcessFlowStepType) {
    const step = steps.find((s) => s.id === id);
    if (!step) return;
    const patch: Partial<ProcessFlowStep> = { type };
    if (type === "decision" && (!step.branches || step.branches.length < 2)) {
      patch.branches = [
        { label: "Yes", nextStepId: nextIds.get(id) ?? null },
        { label: "No", nextStepId: null },
      ];
    }
    if (type !== "decision") {
      patch.branches = undefined;
    }
    updateStep(id, patch);
  }

  function addBranch(id: string) {
    const step = steps.find((s) => s.id === id);
    if (!step) return;
    const branches = [...(step.branches ?? []), { label: "Path", nextStepId: null }];
    updateStep(id, { branches });
  }

  function updateBranch(id: string, bIdx: number, patch: Partial<ProcessFlowBranch>) {
    const step = steps.find((s) => s.id === id);
    if (!step || !step.branches) return;
    const branches = step.branches.map((b, i) => (i === bIdx ? { ...b, ...patch } : b));
    updateStep(id, { branches });
  }

  function removeBranch(id: string, bIdx: number) {
    const step = steps.find((s) => s.id === id);
    if (!step || !step.branches) return;
    updateStep(id, { branches: step.branches.filter((_, i) => i !== bIdx) });
  }

  if (steps.length === 0) {
    return (
      <div className="rounded-xl border border-dashed border-border p-8 text-center">
        <GitBranch className="mx-auto mb-3 text-muted" size={28} />
        <p className="text-sm text-muted">No steps yet. Add one to start your process flow.</p>
        {editing && (
          <Button onClick={addStep} className="mt-4 gap-1.5" size="sm">
            <Plus size={14} /> Add first step
          </Button>
        )}
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {steps.map((step, idx) => {
        const meta = TYPE_META[step.type];
        const expanded = expandedId === step.id;
        const branches = step.type === "decision" ? step.branches ?? [] : [];

        return (
          <div key={step.id}>
            <div
              className="rounded-xl border border-border bg-surface-2 overflow-hidden"
              style={{ borderLeftColor: meta.tone, borderLeftWidth: 3 }}
            >
              <div className="flex items-start gap-3 p-4">
                <div className="flex flex-col items-center gap-1 shrink-0 pt-1">
                  {editing && idx > 0 && (
                    <button
                      type="button"
                      className="text-muted hover:text-foreground"
                      onClick={() => moveStep(step.id, -1)}
                      aria-label="Move up"
                    >
                      <ArrowUp size={14} />
                    </button>
                  )}
                  <div
                    className="flex items-center justify-center w-8 h-8 rounded-full text-sm font-bold"
                    style={{ background: `${meta.tone}14`, color: meta.tone }}
                  >
                    {idx + 1}
                  </div>
                  {editing && idx < steps.length - 1 && (
                    <button
                      type="button"
                      className="text-muted hover:text-foreground"
                      onClick={() => moveStep(step.id, 1)}
                      aria-label="Move down"
                    >
                      <ArrowDown size={14} />
                    </button>
                  )}
                </div>

                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 mb-1 flex-wrap">
                    <Badge
                      variant="outline"
                      style={{ borderColor: `${meta.tone}55`, color: meta.tone }}
                      className="text-[10px] uppercase tracking-wide"
                    >
                      {meta.label}
                    </Badge>
                    {step.actor && (
                      <span className="text-[11px] text-muted flex items-center gap-1">
                        <User size={11} /> {step.actor}
                      </span>
                    )}
                    {step.durationMinutes ? (
                      <span className="text-[11px] text-muted flex items-center gap-1">
                        <Timer size={11} /> {step.durationMinutes} min
                      </span>
                    ) : null}
                  </div>

                  {editing ? (
                    <Input
                      value={step.title}
                      onChange={(e) => updateStep(step.id, { title: e.target.value })}
                      placeholder="Step title"
                      className="font-medium mb-2"
                    />
                  ) : (
                    <p className="font-medium mb-1">{step.title}</p>
                  )}
                  {step.description && !editing && (
                    <p className="text-xs text-muted whitespace-pre-wrap">{step.description}</p>
                  )}

                  {editing && (
                    <button
                      type="button"
                      className="text-xs text-muted hover:text-foreground flex items-center gap-1 mt-1"
                      onClick={() => setExpandedId(expanded ? null : step.id)}
                    >
                      {expanded ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
                      {expanded ? "Hide details" : "Edit details"}
                    </button>
                  )}

                  {editing && expanded && (
                    <div className="mt-3 space-y-3 border-t border-border pt-3">
                      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
                        <div>
                          <Label className="text-[11px]">Type</Label>
                          <Select
                            value={step.type}
                            onValueChange={(v) => toggleType(step.id, v as ProcessFlowStepType)}
                          >
                            <SelectTrigger><SelectValue /></SelectTrigger>
                            <SelectContent>
                              <SelectItem value="action">Action</SelectItem>
                              <SelectItem value="decision">Decision</SelectItem>
                              <SelectItem value="handoff">Handoff</SelectItem>
                            </SelectContent>
                          </Select>
                        </div>
                        <div>
                          <Label className="text-[11px]">Actor / role</Label>
                          <Input
                            value={step.actor ?? ""}
                            onChange={(e) => updateStep(step.id, { actor: e.target.value })}
                            placeholder="e.g. Account Manager"
                          />
                        </div>
                        <div>
                          <Label className="text-[11px]">Expected (min)</Label>
                          <Input
                            type="number"
                            min={0}
                            value={step.durationMinutes ?? ""}
                            onChange={(e) => {
                              const n = Number(e.target.value);
                              updateStep(step.id, { durationMinutes: Number.isFinite(n) && n > 0 ? n : undefined });
                            }}
                          />
                        </div>
                      </div>

                      <div>
                        <Label className="text-[11px]">Description</Label>
                        <Textarea
                          rows={2}
                          value={step.description ?? ""}
                          onChange={(e) => updateStep(step.id, { description: e.target.value })}
                          placeholder="What happens here? Include inputs, outputs, and acceptance criteria."
                        />
                      </div>

                      {step.type === "decision" && (
                        <div className="space-y-2">
                          <div className="flex items-center justify-between">
                            <Label className="text-[11px]">Branches</Label>
                            <Button
                              type="button"
                              variant="outline"
                              size="sm"
                              onClick={() => addBranch(step.id)}
                              className="gap-1 text-xs h-7"
                            >
                              <Plus size={12} /> Add branch
                            </Button>
                          </div>
                          {branches.map((b, bIdx) => (
                            <div key={bIdx} className="flex items-center gap-2">
                              <Input
                                value={b.label}
                                onChange={(e) => updateBranch(step.id, bIdx, { label: e.target.value })}
                                placeholder="Condition (e.g. Approved)"
                                className="flex-1"
                              />
                              <Select
                                value={b.nextStepId ?? "__end"}
                                onValueChange={(v) =>
                                  updateBranch(step.id, bIdx, { nextStepId: v === "__end" ? null : v })
                                }
                              >
                                <SelectTrigger className="w-40"><SelectValue /></SelectTrigger>
                                <SelectContent>
                                  <SelectItem value="__end">End process</SelectItem>
                                  {steps
                                    .filter((s) => s.id !== step.id)
                                    .map((s, i) => (
                                      <SelectItem key={s.id} value={s.id}>
                                        → Step {steps.findIndex((ss) => ss.id === s.id) + 1}: {s.title.slice(0, 24)}
                                      </SelectItem>
                                    ))}
                                </SelectContent>
                              </Select>
                              {branches.length > 1 && (
                                <button
                                  type="button"
                                  className="text-muted hover:text-red-400"
                                  onClick={() => removeBranch(step.id, bIdx)}
                                  aria-label="Remove branch"
                                >
                                  <Trash2 size={14} />
                                </button>
                              )}
                            </div>
                          ))}
                        </div>
                      )}

                      <div className="flex justify-end pt-1">
                        <Button
                          type="button"
                          variant="ghost"
                          size="sm"
                          onClick={() => removeStep(step.id)}
                          className="text-red-400 hover:text-red-300 gap-1 text-xs"
                        >
                          <Trash2 size={12} /> Delete step
                        </Button>
                      </div>
                    </div>
                  )}

                  {step.type === "decision" && !editing && branches.length > 0 && (
                    <div className="mt-3 space-y-1 border-t border-border pt-2">
                      {branches.map((b, i) => {
                        const targetIdx = b.nextStepId ? steps.findIndex((s) => s.id === b.nextStepId) : -1;
                        return (
                          <div key={i} className="flex items-center gap-2 text-xs">
                            <GitBranch size={11} className="text-muted" />
                            <span className="font-medium">{b.label}</span>
                            <span className="text-muted">
                              →{" "}
                              {targetIdx >= 0
                                ? `Step ${targetIdx + 1}`
                                : "End process"}
                            </span>
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>
              </div>
            </div>

            {idx < steps.length - 1 && (
              <div className="flex justify-center py-1">
                <ArrowDown size={14} className="text-muted/50" />
              </div>
            )}
          </div>
        );
      })}

      {editing && (
        <Button onClick={addStep} variant="outline" className="w-full gap-1.5" size="sm">
          <Plus size={14} /> Add step
        </Button>
      )}
    </div>
  );
}
