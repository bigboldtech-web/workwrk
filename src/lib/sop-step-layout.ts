// A step-by-step SOP holds its steps twice: as the list (content.steps) and
// as the flow (content.flow.steps), whichever layout it is shown in. Saving
// in the flow layout rebuilds the list from the flow, saving in the list
// layout rebuilds the flow from the list, and switching layouts converts one
// into the other, so every field a step carries has to survive both ways or
// it is lost on the next save, with no warning.
//
// Two losses this module closes:
// - A step's image. It now lives in the list copy only (the flow canvas
//   never draws it, and a pasted image is a data URL that would double the
//   saved content); a list rebuilt from the flow takes it back from the list
//   step of the same id.
// - A flow step's own fields: its type (Decision, Handoff), branches, actor
//   and expected minutes. The list cannot show them, so a list step carries
//   them untouched, and a flow rebuilt from the list starts from the flow
//   step of the same id, so nothing the list cannot show is ever dropped.
//
// Pure: the editor (src/components/sops/sop-steps-editor.tsx) and the SOP
// page (src/components/sops/sop-editor-page.tsx) call these, and
// sop-step-layout.test.ts covers every field.

import type { ProcessFlow, ProcessFlowBranch, ProcessFlowStep, ProcessFlowStepType } from "@/components/process-flow-builder";
import { stepJobTitle, type StepJobTitle } from "./sop-step-owner";

export interface LayoutStep {
  id: string;
  title: string;
  description?: string;
  image?: string;
  /** The step's owner, by job title (src/lib/sop-step-owner.ts). */
  jobTitle?: StepJobTitle | null;
  /** Running the SOP creates a task for this step. */
  createsTask?: boolean;
  /** Flow-only fields, carried as they are: the list does not show them. */
  type?: ProcessFlowStepType;
  actor?: string;
  durationMinutes?: number;
  branches?: ProcessFlowBranch[];
}

/** The owner fields a step carries in both layouts, only when set. */
export function ownerFields(s: { jobTitle?: unknown; createsTask?: unknown }): Pick<LayoutStep, "jobTitle" | "createsTask"> {
  const jobTitle = stepJobTitle(s);
  return { ...(jobTitle ? { jobTitle } : {}), ...(s.createsTask === true ? { createsTask: true } : {}) };
}

function imageOf(s: unknown): string | undefined {
  const image = (s as { image?: unknown } | null)?.image;
  return typeof image === "string" && image ? image : undefined;
}

const FLOW_TYPES: readonly ProcessFlowStepType[] = ["action", "decision", "handoff"];

/** The flow-only fields of a step, only those set with a usable value. */
function flowFields(s: unknown): Pick<LayoutStep, "type" | "actor" | "durationMinutes" | "branches"> {
  const o = (s && typeof s === "object" ? s : {}) as { type?: unknown; actor?: unknown; durationMinutes?: unknown; branches?: unknown };
  return {
    ...(typeof o.type === "string" && (FLOW_TYPES as readonly string[]).includes(o.type) ? { type: o.type as ProcessFlowStepType } : {}),
    ...(typeof o.actor === "string" && o.actor ? { actor: o.actor } : {}),
    ...(typeof o.durationMinutes === "number" && Number.isFinite(o.durationMinutes) ? { durationMinutes: o.durationMinutes } : {}),
    ...(Array.isArray(o.branches) ? { branches: o.branches as ProcessFlowBranch[] } : {}),
  };
}

/**
 * The list as a flow. `priorFlow` is the flow as it was loaded or last
 * edited: each step starts from the flow step of the same id, so a key only
 * the flow knows survives; the title, description and owner fields always
 * come from the list (an owner removed in the list is removed), the list
 * step's flow fields win over the prior ones, and a step new to the flow is
 * an Action card. No image is written into the flow.
 */
export function flowFromSteps(steps: LayoutStep[], priorFlow?: ProcessFlow | null): ProcessFlow {
  const prior = new Map<string, ProcessFlowStep>();
  for (const p of priorFlow?.steps ?? []) if (p && typeof p.id === "string") prior.set(p.id, p);
  return {
    type: "process_flow",
    steps: steps.map((s) => {
      const before = prior.get(s.id);
      const base: Record<string, unknown> = before ? { ...before } : {};
      delete base.image;
      delete base.jobTitle;
      delete base.createsTask;
      const fields = { ...flowFields(before), ...flowFields(s) };
      return {
        ...base,
        id: s.id,
        title: s.title || "Untitled",
        description: s.description,
        ...fields,
        type: fields.type ?? "action",
        ...ownerFields(s),
      } as ProcessFlowStep;
    }),
  };
}

/**
 * The flow as a list. `prior` is the list as it was loaded or last edited: a
 * flow step with no image of its own (every flow written by this module) keeps
 * the image of the prior list step with the same id. The flow's own fields
 * ride along on the list step, untouched, for the way back.
 */
export function stepsFromFlow(flow: ProcessFlow | null | undefined, prior: readonly LayoutStep[] = []): LayoutStep[] {
  const priorImage = new Map<string, string>();
  for (const p of prior) {
    const image = imageOf(p);
    if (p && typeof p.id === "string" && image) priorImage.set(p.id, image);
  }
  return (flow?.steps ?? []).map((s) => {
    const image = imageOf(s) ?? priorImage.get(s.id);
    const fields = flowFields(s);
    // A plain Action is the default both ways, so it is not written onto the list step.
    if (fields.type === "action") delete fields.type;
    return { id: s.id, title: s.title, description: s.description, ...(image ? { image } : {}), ...fields, ...ownerFields(s as { jobTitle?: unknown; createsTask?: unknown }) };
  });
}
