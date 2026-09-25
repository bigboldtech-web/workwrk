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

// Decision 9: "Pin as default view" and "Unpin". The route is the only writer
// of the List's default, so these are the properties a later edit must not
// silently undo: who may pin, what may not be pinned, and that no write can
// leave two defaults, lose a pin or forge one.
describe("views/[viewId] PATCH pins and unpins the List's default (decision 9)", () => {
  const patch = src.slice(src.indexOf("export async function PATCH"), src.indexOf("export async function DELETE"));

  it("gates a pin or an unpin on canSaveView, the gate Set as default had, before anything is written (decision 9)", () => {
    const guard = patch.indexOf("if (parsed.data.isDefault !== undefined && !canSaveView(gate.view, c.userId, gate.canContribute))");
    expect(guard).toBeGreaterThan(-1);
    expect(guard).toBeLessThan(patch.indexOf("$transaction"));
    expect(guard).toBeLessThan(patch.indexOf("view.update"));
    expect(patch.slice(guard, guard + 200)).toMatch(/PIN_DENIED/);
    // No stricter ladder for the pin than the one the save gate applies.
    expect(patch).not.toMatch(/isDefault !== undefined && !gate\.canContribute/);
  });

  it("refuses a stale unpin instead of sweeping someone else's newer pin", () => {
    const stale = patch.indexOf("parsed.data.isDefault === false && !row.isDefault && readPinnedDefault(row.config) === null");
    expect(stale).toBeGreaterThan(-1);
    expect(patch.slice(stale, stale + 600)).toMatch(/UNPIN_STALE/);
    // The refusal comes before the List-wide sweep of the unpin branch.
    const unpinBranch = patch.indexOf("} else if (parsed.data.isDefault === false || makesPrivate");
    const sweep = patch.indexOf("await clearOthers(tx);", unpinBranch);
    expect(stale).toBeGreaterThan(unpinBranch);
    expect(stale).toBeLessThan(sweep);
  });

  it("refuses to pin a private view on a Space List, reading the EFFECTIVE isShared twice (reviews #3, #31)", () => {
    // Once on the loaded view before the transaction, and again on the row
    // read FOR UPDATE inside it, so a concurrent "make private" cannot slip
    // between the check and the write.
    expect(patch).toMatch(/parsed\.data\.isShared \?\? gate\.view\.isShared/);
    expect(patch).toMatch(/parsed\.data\.isShared \?\? row\.isShared/);
    expect(patch.match(/PIN_PRIVATE_DENIED/g)?.length ?? 0).toBeGreaterThanOrEqual(2);
  });

  it("refuses to make the pinned default private", () => {
    expect(patch).toMatch(/countsAsPinnedDefault\(/);
    expect(patch).toMatch(/PINNED_PRIVATE_DENIED/);
  });

  it("serialises every default-changing write on the List's advisory lock and the row lock (review #30)", () => {
    expect(patch).toMatch(/pg_advisory_xact_lock\(hashtext\(\$\{`view-default:\$\{id\}`\}\)\)/);
    expect(patch).toMatch(/FOR UPDATE/);
    const pinBranch = patch.slice(patch.indexOf("if (parsed.data.isDefault)"));
    const pinBody = pinBranch.slice(0, pinBranch.indexOf("} else"));
    expect(pinBody.indexOf("defaultLock(tx)")).toBeGreaterThan(-1);
    expect(pinBody.indexOf("defaultLock(tx)")).toBeLessThan(pinBody.indexOf("lockedRow(tx)"));
  });

  it("clears the default AND the mark from the List's other views in the pin's own transaction", () => {
    expect(patch).toMatch(/SET "isDefault" = false/);
    expect(patch).toMatch(/"config" - 'pinned'/);
    expect(patch).toMatch(/WHERE "boardId" = \$\{id\} AND "id" <> \$\{viewId\}/);
    const pinBranch = patch.slice(patch.indexOf("if (parsed.data.isDefault)"));
    const pinBody = pinBranch.slice(0, pinBranch.indexOf("} else"));
    expect(pinBody.indexOf("clearOthers(tx)")).toBeGreaterThan(-1);
    expect(pinBody.indexOf("clearOthers(tx)")).toBeLessThan(pinBody.indexOf("tx.view.update"));
    expect(pinBody).toMatch(/withPinnedDefault\(/);
  });

  it("unpins the WHOLE List, so no leftover mark can surface as the default", () => {
    const unpin = patch.slice(patch.indexOf("if (parsed.data.isDefault === false) {"));
    expect(unpin.indexOf("clearOthers(tx)")).toBeGreaterThan(-1);
    expect(unpin.slice(0, unpin.indexOf("tx.view.update"))).toMatch(/withoutPinnedDefault\(/);
  });

  it("never lets a config write drop or forge a pin (reviews #5a, #29)", () => {
    // Every renderer PATCHes the config it mounted with.
    expect(patch).toMatch(/if \(parsed\.data\.config !== undefined\) data\.config = withoutPinnedDefault\(/);
    expect(patch).toMatch(/carryPinnedDefault\(/);
  });

  it("answers the same body it always did", () => {
    expect(patch).toMatch(/NextResponse\.json\(\{ view: updated \}\)/);
  });
});

describe("POST and GET /api/boards/[id]/views", () => {
  const listSrc = readFileSync(join(process.cwd(), "src/app/api/boards/[id]/views/route.ts"), "utf8");

  it("strips a copied mark from every created view (Duplicate copies config verbatim)", () => {
    expect(listSrc).toMatch(/withoutPinnedDefault\(parsed\.data\.config/);
  });

  it("pins on create under the same List lock, and never a private view on a Space List", () => {
    expect(listSrc).toMatch(/isDefault: z\.boolean\(\)\.optional\(\)/);
    expect(listSrc).toMatch(/pg_advisory_xact_lock\(hashtext\(\$\{`view-default:\$\{id\}`\}\)\)/);
    expect(listSrc).toMatch(/PIN_PRIVATE_DENIED/);
    expect(listSrc).toMatch(/withPinnedDefault\(/);
  });

  it("reports the resolved default the page uses, not the raw flag", () => {
    expect(listSrc).toMatch(/listViewsForViewer\(/);
    expect(listSrc).toMatch(/defaultViewId/);
    expect(listSrc).toMatch(/defaultPinned/);
    expect(listSrc).not.toMatch(/isDefault: "desc"/);
  });
});

describe("PATCH /api/boards/[id]/views/order", () => {
  const orderSrc = readFileSync(join(process.cwd(), "src/app/api/boards/[id]/views/order/route.ts"), "utf8");

  it("lets a contributor reorder a Space List's tabs, the same ladder that renders them draggable", () => {
    expect(orderSrc).toMatch(/canContributeBoard\(/);
    expect(orderSrc).not.toMatch(/canEditSpace\(/);
  });
});
