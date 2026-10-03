// A step-by-step SOP holds its steps twice: as the list (content.steps) and
// as the flow (content.flow.steps), whichever layout it is shown in. Saving
// in the flow layout rebuilds the list from the flow, and switching layouts
// converts one into the other, so every field a step can carry has to ride
// along both ways or it is lost on the next save.
//
// An image was not carried: a step-by-step SOP with step images that was
// switched to "Show as flow", or saved while stored with the flow layout,
// lost every step image on its next save, with no warning. It now rides in
// the flow step too (the flow canvas ignores it), and when the flow came from
// an older save without it, the list step of the same id keeps its image.
//
// Pure: the editor (src/components/sops/sop-steps-editor.tsx) and the SOP
// page (src/components/sops/sop-editor-page.tsx) call these, and
// sop-step-layout.test.ts covers every field.

import type { ProcessFlow, ProcessFlowStep } from "@/components/process-flow-builder";
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

/** The list as a flow: every step an action card, carrying its image and owner fields. */
export function flowFromSteps(steps: LayoutStep[]): ProcessFlow {
  return {
    type: "process_flow",
    steps: steps.map((s) => {
      const image = imageOf(s);
      return { id: s.id, title: s.title || "Untitled", description: s.description, type: "action" as const, ...(image ? { image } : {}), ...ownerFields(s) } as ProcessFlowStep;
    }),
  };
}

/**
 * The flow as a list (branches do not survive the list). `prior` is the list
 * as it was loaded or last edited: a flow step with no image of its own keeps
 * the image of the prior list step with the same id.
 */
export function stepsFromFlow(flow: ProcessFlow | null | undefined, prior: readonly LayoutStep[] = []): LayoutStep[] {
  const priorImage = new Map<string, string>();
  for (const p of prior) {
    const image = imageOf(p);
    if (p && typeof p.id === "string" && image) priorImage.set(p.id, image);
  }
  return (flow?.steps ?? []).map((s) => {
    const image = imageOf(s) ?? priorImage.get(s.id);
    return { id: s.id, title: s.title, description: s.description, ...(image ? { image } : {}), ...ownerFields(s as { jobTitle?: unknown; createsTask?: unknown }) };
  });
}
