// A source contract for PATCH/DELETE /api/boards/[id]/views/[viewId].
//
// That route is a write path, and bug 7.2 was that SAVING a view was gated on
// `canEditSpace` (the Space MANAGEMENT ladder), so a member who may create
// every task on a List got a 403 the moment they renamed a tab or saved a
// filter on it. The gate now splits: saving asks `canSaveView` over the
// CONTRIBUTE ladder, deleting still asks `canManageView` over the management
// one, because a shared view is other people's saved work.
//
// The route itself cannot be imported here: it pulls in next-auth and prisma,
// which the node unit environment deliberately does not carry. So this reads
// the file and asserts the two properties that matter and that a future edit
// could silently undo:
//
//   1. the gates are the right ones, and `canEditSpace` is gone;
//   2. the PATCH body stays a PARTIAL update. `prisma.view.update` is handed
//      exactly the keys zod parsed out of the request. If anyone ever spreads
//      a defaults object into it instead, renaming a view would wipe the
//      `config` blob that holds its filters, grouping and sort, and that
//      configuration is user data.

import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const ROUTE = join(
  process.cwd(),
  "src/app/api/boards/[id]/views/[viewId]/route.ts",
);
const src = readFileSync(ROUTE, "utf8");

describe("views/[viewId] route gates", () => {
  it("no longer gates anything on the Space MANAGEMENT ladder", () => {
    // The prose above the gate still names canEditSpace, deliberately, so the
    // next reader knows what it replaced. What must be gone is the CALL and
    // the import.
    expect(src).not.toMatch(/canEditSpace\(/);
    expect(src).not.toMatch(/import\s*\{[^}]*canEditSpace/);
  });

  it("gates PATCH on canSaveView (contribute plus the view's owner)", () => {
    expect(src).toMatch(/canSaveView\(/);
    const patch = src.slice(src.indexOf("export async function PATCH"));
    expect(patch.slice(0, patch.indexOf("prisma.view.update"))).toMatch(/canSaveView\(/);
  });

  it("keeps DELETE on canManageView, so a contributor cannot remove a shared view", () => {
    const del = src.slice(src.indexOf("export async function DELETE"));
    expect(del).toMatch(/canManageView\(/);
    expect(del).not.toMatch(/canSaveView\(/);
  });

  it("reads the contribute and manage answers from the board, not the Space", () => {
    expect(src).toMatch(/canContributeBoard\(/);
    expect(src).toMatch(/canEditBoard\(/);
  });
});

describe("views/[viewId] PATCH preserves the view's existing data", () => {
  it("builds the update payload from the parsed body alone", () => {
    // `{ ...parsed.data }` and nothing else: zod strips unknown keys and every
    // field is optional, so a rename carries `name` only and Prisma leaves
    // config, isShared, isDefault, displayOrder and type exactly as they were.
    expect(src).toMatch(/const data: Record<string, unknown> = \{ \.\.\.parsed\.data \};/);
  });

  it("never writes a default config, type or isShared into that payload", () => {
    const body = src.slice(
      src.indexOf("const data: Record<string, unknown>"),
      src.indexOf("export async function DELETE"),
    );
    // A literal default assigned into `data` would clobber a saved view.
    expect(body).not.toMatch(/data\.config\s*=\s*(\{\}|null)/);
    expect(body).not.toMatch(/data\.isShared\s*=/);
    expect(body).not.toMatch(/data\.type\s*=\s*"/);
    // The one conditional write that IS there only re-casts a value the
    // caller supplied.
    expect(body).toMatch(/if \(parsed\.data\.config !== undefined\) data\.config =/);
  });

  it("demotes the previous default in the same transaction as the promotion", () => {
    // Promoting a view to default must not be able to leave a board with two
    // defaults or none if the second write fails.
    const tx = src.slice(src.indexOf("if (parsed.data.isDefault)"));
    expect(tx.slice(0, tx.indexOf("} else"))).toMatch(/\$transaction/);
  });
});
