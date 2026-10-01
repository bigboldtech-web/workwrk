// Contracts over the SOURCE of the routes and components the node access
// review found holes in, because each needs a database, a session or a
// browser the unit suite does not have. Every pure rule they call is tested
// in its own file (node-rules, legacy-floor, node-tree, access-activity,
// entity-link-ends, object-href, manage-access-model); these pin that the
// routes call those rules at all.

import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const ROOT = fileURLToPath(new URL("../../../", import.meta.url));
const read = (rel: string) => readFileSync(path.join(ROOT, rel), "utf8");

/** The source from a marker to the end of its top-level declaration (the next column-zero close). */
function block(src: string, marker: string): string {
  const start = src.indexOf(marker);
  expect(start, `${marker} is missing`).toBeGreaterThanOrEqual(0);
  const end = src.slice(start).search(/\n\};?\n/);
  return end < 0 ? src.slice(start) : src.slice(start, start + end + 3);
}

describe("the doc move gate (finding 1)", () => {
  const route = read("src/app/api/docs/[id]/route.ts");
  it("asks the placement rule (Full access on the doc and where it is, Can edit where it goes) before any move, one that could open a doc to the org included", () => {
    expect(route).toMatch(/const refused = await treeMoveRefusal\(ctx, nodeCtx, id, existing, after\)/);
    expect(route).toMatch(/await checkMove\(nodeCtx, \{ kind: "doc", id \}, dest\)/);
    expect(route).toMatch(/docHomeOf\(ctx\.orgId, existing\), docHomeOf\(ctx\.orgId, after\)/);
    expect(read("src/lib/access/node-placement.ts")).toMatch(/const verdict = moveVerdict\(rows, grants, ref, dest\)/);
  });
});

describe("the canvas routes (findings 2 and 9)", () => {
  const route = read("src/app/api/whiteboards/[id]/route.ts");
  it("move through the one move helper, which is moveVerdict", () => {
    expect(route).toMatch(/const moved = await moveCanvas\(nodeCtx, id, \{/);
    expect(read("src/lib/access/node-placement.ts")).toMatch(/const check = await checkMove\(ctx, \{ kind: "canvas", id: canvas\.id \}, dest\)/);
  });
  it("keep the Trash for today's readers through the legacy floor", () => {
    expect(route).toMatch(/!roleAtLeast\(role, "EDIT"\) && !roleAtLeast\(await legacyFloorRole\(nodeCtx, \{ kind: "canvas", id \}\), "VIEW"\)/);
  });
});

describe("the Ask AI tools (finding 3)", () => {
  const tools = read("src/lib/agents/tools.ts");
  it("search_tasks and list_data_tables filter through the resolver", () => {
    const search = block(tools, "const searchTasks: ToolDefinition");
    expect(search).toMatch(/readableIds\(ctx, candidates\.map\(\(r\) => \(\{ kind: "list" as const, id: r\.boardId \}\)\)\)/);
    const tables = block(tools, "const listDataTables: ToolDefinition");
    expect(tables).toMatch(/readableIds\(ctx, candidates\.map\(\(t\) => \(\{ kind: "table" as const, id: t\.id \}\)\)\)/);
  });
});

describe("doc duplicate (finding 5)", () => {
  it("asks canCreateDocAt for the place the copy lands, as POST /api/docs does", () => {
    const route = read("src/app/api/docs/[id]/duplicate/route.ts");
    const gate = route.indexOf("canCreateDocAt(nodeCtx,");
    expect(gate).toBeGreaterThan(0);
    // The copy is written inside a transaction (tx.doc.create), after the gate.
    const write = route.indexOf(".doc.create(");
    expect(write).toBeGreaterThan(0);
    expect(gate).toBeLessThan(write);
  });
});

describe("entity links (finding 6)", () => {
  it("filter every row through linkVisible, both ends", () => {
    const route = read("src/app/api/entity-links/route.ts");
    expect(route).toMatch(/\.filter\(\(r\) => linkVisible\(r, facts\)\)/);
    expect(route).not.toMatch(/if \(!kind\) return true/);
  });
});

describe("GET /api/spaces keeps its shape (finding 11)", () => {
  it("counts and the Spaces on the way to a shared Folder are on unless a caller opts out", () => {
    const route = read("src/app/api/spaces/route.ts");
    expect(route).toMatch(/paths: url\.searchParams\.get\("paths"\) !== "0"/);
    expect(route).toMatch(/counts: url\.searchParams\.get\("counts"\) !== "0"/);
  });
});

describe("the Manage access dialog (findings 12 and 13)", () => {
  const dialog = read("src/components/access/manage-access-dialog.tsx");
  it("Add only raises, so a Retry never lowers what someone else gave", () => {
    expect(dialog).toMatch(/body: \{ userId: p\.id, role: roleNow, expected: expected\[p\.id\] \?\? null, mode: "raise" \}/);
  });
  it("a refusal about the viewer's own access fetches the panel again, on every write path", () => {
    expect(dialog.match(/if \(refusedByOwnAccess\(out\.code\)\) onRefused\(\);/g)?.length).toBe(3);
    expect(dialog).toMatch(/onRefused=\{\(\) => void refetchAfterRefusal\(\)\}/);
  });
});

describe("the doc Restricted switch (finding 15)", () => {
  it("confirms before it locks anyone out", () => {
    const modal = read("src/components/docs/doc-share-modal.tsx");
    expect(modal).toMatch(/if \(next && restrictConfirm && !\(await confirm\(\{ \.\.\.restrictConfirm, destructive: true \}\)\)\) return;/);
    expect(read("src/components/access/general-access.tsx")).toMatch(/restrictConfirm=\{restrictDocConfirm\(panel, meId\)\}/);
  });
});

describe("the audit surface (finding 16)", () => {
  it("reads metadata and writes a summary line for access rows", () => {
    const route = read("src/app/api/audit/route.ts");
    expect(route).toMatch(/metadata: true/);
    expect(route).toMatch(/accessAuditSentence\(/);
    // The Audit log prints the access sentence before the raw description
    // (Phase 8 rebuilt the page on TableCard: `r.summary ?? r.description`).
    expect(read("src/app/(dashboard)/settings/audit/page.tsx")).toMatch(/\b\w+\.summary (\?\?|\|\|) \w+\.description/);
  });
});

describe("email invitations (finding 17)", () => {
  it("record the invite and the grant it becomes", () => {
    expect(read("src/app/api/spaces/[id]/invitations/route.ts")).toMatch(/await recordSpaceInvite\(tx, \{/);
    const accept = read("src/app/api/auth/accept-invite/route.ts");
    const upsert = accept.indexOf("tx.spaceMember.upsert(");
    const record = accept.indexOf("recordSpaceInviteAccepted(tx, {");
    expect(upsert).toBeGreaterThan(0);
    expect(record).toBeGreaterThan(upsert);
  });
});

describe("placement for org admins (findings 18 and 19)", () => {
  it("names the chain above a node even for an org admin", () => {
    const access = read("src/lib/access/node-access.ts");
    expect(block(access, "export async function nodePathWorld(")).toMatch(/loadWorld\(ctx, \[ref\], \{ chain: true \}\)/);
    expect(read("src/lib/access/node-world.ts")).toMatch(/rowsOnly: ctx\.orgAdmin && !opts\.chain/);
  });
});

describe("links in a doc being edited (finding 20)", () => {
  it("open at their section form through BlockNote's link click handler", () => {
    const canvas = read("src/components/docs/blocknote-canvas.tsx");
    expect(canvas).toMatch(/links: \{\s*onClick: \(event\) => \{/);
    expect(canvas).toMatch(/editorLinkHref\(\{/);
  });
});
