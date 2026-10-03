import { describe, expect, it } from "vitest";
import { flowFromSteps, stepsFromFlow, type LayoutStep } from "./sop-step-layout";

const owner = { roleId: "role-1", title: "Onboarding lead" };
const list: LayoutStep[] = [
  { id: "a", title: "Prepare", description: "<p>Do it.</p>", image: "https://img.example/a.png", jobTitle: owner, createsTask: true },
  { id: "b", title: "Hand over" },
];

describe("sop step layouts", () => {
  it("carries the image, the job title and Creates a task from the list to the flow and back", () => {
    const flow = flowFromSteps(list);
    expect(flow.steps[0]).toMatchObject({ id: "a", type: "action", image: "https://img.example/a.png", jobTitle: owner, createsTask: true });
    expect(stepsFromFlow(flow)).toEqual(list);
  });

  it("keeps a list step's image when the flow came from an older save without it", () => {
    const oldFlow = { type: "process_flow" as const, steps: [{ id: "a", title: "Prepare", type: "action" as const }, { id: "b", title: "Hand over", type: "action" as const }] };
    const back = stepsFromFlow(oldFlow, list);
    expect(back[0].image).toBe("https://img.example/a.png");
    expect(back[1].image).toBeUndefined();
  });

  it("a step's own image wins over the prior one, and a step new to the flow takes none", () => {
    const flow = { type: "process_flow" as const, steps: [{ id: "a", title: "Prepare", type: "action" as const, image: "https://img.example/new.png" }, { id: "z", title: "New", type: "action" as const }] };
    const back = stepsFromFlow(flow as Parameters<typeof stepsFromFlow>[0], list);
    expect(back[0].image).toBe("https://img.example/new.png");
    expect(back[1]).toEqual({ id: "z", title: "New", description: undefined });
  });

  it("writes no empty fields", () => {
    expect(flowFromSteps([{ id: "c", title: "" }]).steps[0]).toEqual({ id: "c", title: "Untitled", description: undefined, type: "action" });
    expect(stepsFromFlow(null)).toEqual([]);
  });
});
