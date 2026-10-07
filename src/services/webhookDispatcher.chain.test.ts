// What an automation's AI teammate dispatches counts toward the automation's
// chain (review round 3): dispatchEvent stamps the depth it runs at, never
// over a depth the event already carries, and nothing outside a step.

import { describe, expect, it, vi } from "vitest";

const seen = vi.hoisted(() => ({ payloads: [] as unknown[] }));
vi.mock("@/lib/prisma", () => ({ prisma: { webhookSubscription: { findMany: async () => [] } } }));
vi.mock("@/lib/automation/engine", () => ({ runAutomationsForEvent: async (a: { payload: unknown }) => void seen.payloads.push(a.payload) }));

import { withAutomationDepth } from "@/lib/automation/chain-depth";
import { dispatchEvent } from "./webhookDispatcher";

describe("dispatchEvent and the automation chain", () => {
  it("stamps the depth of the teammate step it runs inside", async () => {
    await withAutomationDepth(2, () => dispatchEvent({ organizationId: "org1", event: "task.field_changed", payload: { id: "i1" } }));
    expect(seen.payloads.at(-1)).toEqual({ id: "i1", __automationDepth: 2 });
  });

  it("keeps a depth the event already carries, and stamps nothing outside a step", async () => {
    await withAutomationDepth(2, () => dispatchEvent({ organizationId: "org1", event: "task.created", payload: { id: "i2", __automationDepth: 1 } }));
    expect(seen.payloads.at(-1)).toEqual({ id: "i2", __automationDepth: 1 });
    await dispatchEvent({ organizationId: "org1", event: "task.created", payload: { id: "i3" } });
    expect(seen.payloads.at(-1)).toEqual({ id: "i3" });
  });
});
