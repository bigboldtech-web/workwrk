// Round four of the placement rule (node-rules P1 to P7): the routes and
// pages keep the fixes the round three attackers proved missing. Each test
// reads the source it names and fails if the fix is taken out.

import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const read = (p: string) => readFileSync(new URL(`../../../${p}`, import.meta.url), "utf8");

describe("break 3: Space nesting asks the Space and where it goes, never the parent it leaves", () => {
  it("spaceReparentRefusal and the Space Move dialog hand spaceNestVerdict the current parent's id alone", () => {
    const lib = read("src/lib/space.ts");
    const refusal = lib.slice(lib.indexOf("export async function spaceReparentRefusal("), lib.indexOf("export interface SpaceNestDestinations"));
    expect(refusal).not.toMatch(/canEditSpace\(currentId/);
    expect(refusal).toMatch(/current: currentId \? \{ id: currentId \} : null/);
    const dests = lib.slice(lib.indexOf("export async function spaceNestDestinations("), lib.indexOf("export interface CreateSpaceInput"));
    expect(dests).not.toMatch(/canEditSpace\(currentId/);
    expect(dests).toMatch(/const current = currentId \? \{ id: currentId \} : null;/);
  });

  it("POST /api/spaces/[id]/move answers 404 for a Space the viewer cannot open, before any role is named", () => {
    const route = read("src/app/api/spaces/[id]/move/route.ts");
    const reader = route.indexOf("getSpaceForReader(id, c.userId, c.accessLevel)");
    const manage = route.indexOf("canEditSpace(id, c.userId, c.accessLevel)");
    expect(reader).toBeGreaterThan(0);
    expect(manage).toBeGreaterThan(reader);
    expect(route).toMatch(/You need Full access to this Space to move it\./);
    expect(route).not.toMatch(/You don't have permission to move this Space/);
  });

  it("the route carries no em dash or double hyphen", () => {
    expect(read("src/app/api/spaces/[id]/move/route.ts")).not.toMatch(/—|--/);
  });
});

describe("break 8: the Folder page offers create to Can edit, as the servers accept", () => {
  it("canCreateInFolder is Can edit, not Full", () => {
    const page = read("src/app/(dashboard)/folders/[id]/page.tsx");
    expect(page).toMatch(/const canCreateInFolder = canEdit;/);
    expect(page).not.toMatch(/const canCreateInFolder = canManage;/);
    expect(page.indexOf("const canEdit = roleAtLeast(decision.role, \"EDIT\")")).toBeGreaterThan(0);
  });

  it("the ghost rows the card renders are the ones gated by it", () => {
    const page = read("src/app/(dashboard)/folders/[id]/page.tsx");
    const gate = page.indexOf("{canCreateInFolder ? (");
    expect(gate).toBeGreaterThan(0);
    const block = page.slice(gate, gate + 600);
    expect(block).toMatch(/NewListGhostRow/);
    expect(block).toMatch(/NewFolderGhostRow/);
  });
});

describe("HEAD's stale contract: the doc duplicate gate reads the ctx it built once", () => {
  it("canCreateDocAt(nodeCtx, ...) runs before the copy is written", () => {
    const route = read("src/app/api/docs/[id]/duplicate/route.ts");
    const gate = route.indexOf("canCreateDocAt(nodeCtx,");
    const write = route.indexOf(".doc.create(");
    expect(gate).toBeGreaterThan(0);
    expect(write).toBeGreaterThan(gate);
  });
});
