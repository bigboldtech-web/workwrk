// What a reader of an automation is sent of its AI teammate steps (review
// round 2): the creator reads the teammate; anyone else never gets its slug.

import { describe, expect, it, vi } from "vitest";

vi.mock("./places-server", () => ({ scopeReadable: async () => new Set(), livePlaces: async () => new Set() }));

import type { Viewer } from "@/lib/access/types";
import { definitionForViewer, withoutTeammateSlugs } from "./definition-view";

const def = { actions: [{ key: "ask_teammate", params: { teammate: "t-job-search-coach-k3x9q1", request: "Summarise {{title}}" } }, { key: "add_comment", params: { body: "x" } }] };

describe("an automation's teammate steps as each reader receives them", () => {
  it("sends the creator their teammate, and anyone else none", async () => {
    const max = { userId: "u-max", organizationId: "org1" } as Viewer;
    const mia = { userId: "u-mia", organizationId: "org1" } as Viewer;
    expect(JSON.stringify((await definitionForViewer(max, def, "u-max")).definition)).toContain("t-job-search-coach-k3x9q1");
    const forMia = (await definitionForViewer(mia, def, "u-max")).definition;
    expect(JSON.stringify(forMia)).not.toContain("job-search");
    expect((forMia.actions as Array<{ params: { request: string } }>)[0].params.request).toBe("Summarise {{title}}");
    expect(JSON.stringify((await definitionForViewer(max, def)).definition)).not.toContain("job-search");
  });

  it("reads the config shape too, and leaves other steps alone", () => {
    expect(withoutTeammateSlugs({ actions: [{ action: "ask_teammate", config: { teammate: "t-a" } }, { key: "x", params: { teammate: "kept" } }] })).toEqual({
      actions: [{ action: "ask_teammate", config: { teammate: null } }, { key: "x", params: { teammate: "kept" } }],
    });
  });
});
