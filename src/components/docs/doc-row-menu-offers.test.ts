// The doc row menu offers Duplicate and Move to… only when their write can
// pass (walk finding: a Can edit grant on one doc was offered a copy, "No
// location" and every Space, and each was refused with a bare code). The
// pure rule is docMenuOffers; the routes' side is pinned over their source,
// because they need a database the unit suite does not have.

import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { docMenuOffers, type DocMenuCaps } from "./doc-row-menu";

const ROOT = fileURLToPath(new URL("../../../", import.meta.url));
const read = (rel: string) => readFileSync(path.join(ROOT, rel), "utf8");

const space = { id: "s1", name: "Design", slug: "design", icon: null, color: null };
const caps = (over: Partial<DocMenuCaps> = {}): DocMenuCaps => ({ canDuplicate: true, move: { none: true, spaces: [space] }, ...over });

describe("docMenuOffers", () => {
  it("offers nothing below Can edit, whatever the caps say", () => {
    expect(docMenuOffers(false, caps())).toEqual({ duplicate: false, move: false, moveNone: false, moveSpaces: [] });
  });

  it("offers nothing while the caps load", () => {
    expect(docMenuOffers(true, "pending")).toEqual({ duplicate: false, move: false, moveNone: false, moveSpaces: [] });
  });

  it("a doc-only editor (no place to add docs, no way out) gets neither row", () => {
    const o = docMenuOffers(true, caps({ canDuplicate: false, move: { none: false, spaces: [] } }));
    expect(o.duplicate).toBe(false);
    expect(o.move).toBe(false);
  });

  it("Move to… stays for the Spaces that take it, without No location", () => {
    const o = docMenuOffers(true, caps({ canDuplicate: false, move: { none: false, spaces: [space] } }));
    expect(o).toEqual({ duplicate: false, move: true, moveNone: false, moveSpaces: [space] });
  });

  it("No location alone still opens the picker", () => {
    const o = docMenuOffers(true, caps({ move: { none: true, spaces: [] } }));
    expect(o.move).toBe(true);
    expect(o.moveNone).toBe(true);
    expect(o.moveSpaces).toEqual([]);
  });

  it("Full access keeps everything the role gave before", () => {
    expect(docMenuOffers(true, caps())).toEqual({ duplicate: true, move: true, moveNone: true, moveSpaces: [space] });
  });

  it("a failed caps read keeps the rows the role gave, and the picker reads the Spaces itself", () => {
    expect(docMenuOffers(true, "unknown")).toEqual({ duplicate: true, move: true, moveNone: true, moveSpaces: null });
  });
});

describe("the doc routes answer the menu with the write's own rules", () => {
  const route = read("src/app/api/docs/[id]/route.ts");
  const dup = read("src/app/api/docs/[id]/duplicate/route.ts");

  it("GET ?menu=1 builds the caps on canCreateDocAt and the move rule's own destinations", () => {
    expect(route).toMatch(/searchParams\.get\("menu"\) === "1"/);
    expect(route).toMatch(/const canDuplicate = await canCreateDocAt\(nodeCtx, anchor, doc\.parentId\)/);
    // The places the menu offers are moveDestinations', the same verdict
    // (moveVerdict) the PUT's checkMove asks, so nothing offered can fail.
    expect(route).toMatch(/const dests = await moveDestinations\(nodeCtx, \{ kind: "doc", id: doc\.id \}\)/);
    expect(route).toMatch(/if \(!access\.canManage \|\| doc\.entityType === "NOTEPAD"\) return \{ canDuplicate, move: nothing \}/);
  });

  it("PUT refuses through treeMoveRefusal, which is checkMove", () => {
    expect(route).toMatch(/const refused = await treeMoveRefusal\(ctx, nodeCtx, id, existing, after\)/);
    expect(route).toMatch(/const check = await checkMove\(nodeCtx, \{ kind: "doc", id \}, dest\)/);
  });

  it("a refusal the menu toasts carries its sentence in error, the code in code", () => {
    expect(route).toMatch(/body: \{ error: message, code, message \}/);
    expect(route).not.toMatch(/\{ error: "forbidden", message:/);
    expect(dup).toMatch(/\{ error: message, code: "forbidden", message \}/);
  });

  it("the menu reads ?menu=1 and gates both rows on docMenuOffers", () => {
    const menu = read("src/components/docs/doc-row-menu.tsx");
    expect(menu).toMatch(/\/api\/docs\/\$\{doc\.id\}\?menu=1/);
    expect(menu).toMatch(/\{offers\.duplicate \? <MenuItem icon=\{Copy\} label="Duplicate"/);
    expect(menu).toMatch(/\{offers\.move \? <MenuItem icon=\{FolderInput\} label="Move to…"/);
    // "No location": the caps' answer when they were read, else the move
    // rule's own answer (GET /api/move/destinations?kind=doc), never a guess.
    expect(menu).toMatch(/\.\.\.\(\(offers\.moveSpaces \? offers\.moveNone : rootPick\) \? \[\{ options: \[\{ value: "none", label: "No location"/);
    expect(menu).toMatch(/setRootPick\(r\.ok && r\.data\.root\?\.pickable === true\);/);
  });
});
