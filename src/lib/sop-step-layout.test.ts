import { describe, expect, it } from "vitest";
import type { ProcessFlow } from "@/components/process-flow-builder";
import { flowFromSteps, stepsFromFlow, type LayoutStep } from "./sop-step-layout";

const owner = { roleId: "role-1", title: "Onboarding lead" };
const list: LayoutStep[] = [
  { id: "a", title: "Prepare", description: "<p>Do it.</p>", image: "https://img.example/a.png", jobTitle: owner, createsTask: true },
  { id: "b", title: "Hand over" },
];
const decisionFlow: ProcessFlow = {
  type: "process_flow",
  steps: [
    { id: "a", title: "Prepare", description: "<p>Do it.</p>", type: "action", actor: "Ops", durationMinutes: 15 },
    { id: "d", title: "Signed?", type: "decision", branches: [{ label: "Yes", nextStepId: "b" }, { label: "No", nextStepId: null }] },
    { id: "b", title: "Hand over", type: "handoff", actor: "Finance" },
  ],
};

describe("sop step layouts", () => {
  it("never writes the image into the flow, and the list gets it back by id", () => {
    const flow = flowFromSteps(list);
    expect(JSON.stringify(flow)).not.toContain("img.example");
    expect(flow.steps[0]).toMatchObject({ id: "a", type: "action", jobTitle: owner, createsTask: true });
    expect(stepsFromFlow(flow, list)).toEqual(list);
  });

  it("keeps a decision, its branches, the actor and the minutes through the list and back", () => {
    const asList = stepsFromFlow(decisionFlow);
    expect(asList[1]).toMatchObject({ id: "d", type: "decision", branches: decisionFlow.steps[1].branches });
    expect(asList[0]).toMatchObject({ actor: "Ops", durationMinutes: 15 });
    expect(asList[0]).not.toHaveProperty("type");
    const back = flowFromSteps(asList);
    expect(back.steps).toEqual(decisionFlow.steps.map((s) => ({ ...s, description: s.description })));
  });

  it("a flow rebuilt from the list keeps what only the flow knows, and takes the list's title and owners", () => {
    const priorFlow: ProcessFlow = { type: "process_flow", steps: [{ id: "a", title: "Old", type: "decision", branches: [{ label: "Yes", nextStepId: null }], jobTitle: owner, createsTask: true } as ProcessFlow["steps"][number]] };
    const edited: LayoutStep[] = [{ id: "a", title: "Prepare the pack" }]; // owner removed in the list
    const flow = flowFromSteps(edited, priorFlow);
    expect(flow.steps[0]).toMatchObject({ id: "a", title: "Prepare the pack", type: "decision", branches: [{ label: "Yes", nextStepId: null }] });
    expect(flow.steps[0]).not.toHaveProperty("jobTitle");
    expect(flow.steps[0]).not.toHaveProperty("createsTask");
  });

  it("an older flow that still holds an image is read, and a step new to the flow takes none", () => {
    const flow = { type: "process_flow" as const, steps: [{ id: "a", title: "Prepare", type: "action" as const, image: "https://img.example/old.png" }, { id: "z", title: "New", type: "action" as const }] };
    const back = stepsFromFlow(flow as ProcessFlow, list);
    expect(back[0].image).toBe("https://img.example/old.png");
    expect(back[1]).toEqual({ id: "z", title: "New", description: undefined });
  });

  it("writes no empty fields", () => {
    expect(flowFromSteps([{ id: "c", title: "" }]).steps[0]).toEqual({ id: "c", title: "Untitled", description: undefined, type: "action" });
    expect(stepsFromFlow(null)).toEqual([]);
  });
});
