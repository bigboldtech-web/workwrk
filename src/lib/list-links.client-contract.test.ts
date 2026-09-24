import { describe, expect, it } from "vitest";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { LIST_LINK_CANVAS_LIVE } from "./list-links";

// The promise LIST_LINK_CANVAS_LIVE makes, held from both sides.
//
// A List page that receives LINKED rows (GET /api/boards/[id]/items?links=1)
// and writes them back WITHOUT naming the List it is in would edit those tasks
// as if they were at home there: the wrong status vocabulary, the wrong field
// namespace, a reorder of the home List. So:
//   * while the switch is OFF, no client may ask for the union at all; and
//   * the day it is ON, the canvas must honour the item event's `listIds` and
//     the table and kanban views must send `contextBoardId` on their writes.
// Source is read with comments stripped, the item-gate.personal.test.ts way,
// so an explanation that names the parameter never fails the guard.

const SRC = join(__dirname, "..");

function stripComments(text: string): string {
  return text.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");
}

function code(file: string): string {
  return stripComments(readFileSync(file, "utf8"));
}

function filesUnder(dir: string): string[] {
  if (!existsSync(dir)) return [];
  const out: string[] = [];
  for (const d of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, d.name);
    if (d.isDirectory()) out.push(...filesUnder(p));
    else if (/\.(tsx?|jsx?)$/.test(d.name) && !/\.test\./.test(d.name)) out.push(p);
  }
  return out;
}

/** The client files that ask for linked rows. */
export function clientsRequestingLinks(files: ReadonlyArray<{ path: string; source: string }>): string[] {
  return files.filter((f) => /links=1/.test(f.source)).map((f) => f.path);
}

describe("the linked-row client contract", () => {
  const clientFiles = [...filesUnder(join(SRC, "components")), ...filesUnder(join(SRC, "app/(dashboard)"))].map((path) => ({ path, source: code(path) }));

  it("finds the client files it guards", () => {
    expect(clientFiles.length).toBeGreaterThan(50);
    expect(clientFiles.some((f) => f.path.endsWith("board-view/board-canvas.tsx"))).toBe(true);
  });

  if (!LIST_LINK_CANVAS_LIVE) {
    it("while the switch is off, no client requests links=1", () => {
      expect(clientsRequestingLinks(clientFiles)).toEqual([]);
    });
  } else {
    it("once the switch is on, the canvas honours listIds and the views send contextBoardId", () => {
      const canvas = code(join(SRC, "components/board-view/board-canvas.tsx"));
      expect(canvas).toMatch(/listIds/);
      for (const view of ["board-table-view.tsx", "board-kanban-view.tsx"]) {
        expect(code(join(SRC, "components/board-view", view))).toMatch(/contextBoardId/);
      }
    });
  }

  it("the detector itself sees a request and ignores a comment", () => {
    expect(clientsRequestingLinks([{ path: "a.tsx", source: "fetch(`/api/boards/${id}/items?links=1`)" }])).toEqual(["a.tsx"]);
    expect(clientsRequestingLinks([{ path: "b.tsx", source: stripComments("// the poll asks for ?links=1 once the switch flips\nconst a = 1;") }])).toEqual([]);
  });
});
