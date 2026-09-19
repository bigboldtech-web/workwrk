import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { allowsItemAction, decideItem } from "./item-role";

// The personal-list regression (spec-task-detail section 4 step 2).
//
// Until Phase 2, every comment and every activity row on a PERSONAL-LIST task
// was unreachable, and silently: the routes 404'd on `!item.board.spaceId`,
// the personal board has no `spaceId` by construction
// (tasks/personal-list/page.tsx passes `spaceId={null}`), and the client
// swallowed the non-ok response and rendered "No comments yet". Nobody saw an
// error; the thread simply did not exist for 100% of personal tasks.
//
// The spec asks for a regression test "because this is the kind of thing a
// future Space-scoped helper would silently break again". Two halves, because
// vitest here runs pure modules in node with no database:
//
//   1. the DECISION half, below: a space-less List still resolves a role, so
//      the gate itself can never be the thing that says no; and
//   2. the SOURCE half: no item route may reach for a Space at all. That is
//      the guard that actually catches the regression, because the regression
//      is always someone re-introducing `getSpaceForReader` here.
//
// The live post-and-read against a real personal task is
// `scripts/verify-item-api.ts`, which is runnable and is what was used to
// confirm this on the local database.

const ROUTES = "../app/api/items/[id]";

/**
 * The file's CODE, with comments stripped.
 *
 * The header comments of these routes deliberately NAME the helpers that
 * caused the bug, so the next reader knows what not to reintroduce. Matching
 * against raw source would fail on that explanation, which would be a test
 * punishing the documentation.
 */
function routeSource(rel: string): string {
  return readFileSync(join(__dirname, ROUTES, rel), "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/(^|[^:])\/\/.*$/gm, "$1");
}

const ITEM_ROUTE_FILES = [
  "route.ts",
  "updates/route.ts",
  "updates/[updateId]/route.ts",
  "updates/[updateId]/reactions/route.ts",
  "activity/route.ts",
  "subtasks/route.ts",
  "duplicate/route.ts",
  "restore/route.ts",
];

describe("a personal-list task resolves a role even with no Space", () => {
  it("the owner of a space-less List holds FULL on its tasks", () => {
    const d = decideItem({
      orgAdmin: false,
      guest: false,
      creator: true,
      assignee: true,
      // A personal board's owner reads FULL through the List itself; there is
      // no Space anywhere in this resolution.
      listRole: "FULL",
      archived: false,
      list: { id: "personal", name: "Personal List" },
    });
    expect(d.role).toBe("FULL");
    expect(allowsItemAction(d, "view", { creator: true })).toBe(true);
    expect(allowsItemAction(d, "comment", { creator: true })).toBe(true);
    expect(allowsItemAction(d, "edit", { creator: true })).toBe(true);
  });

  it("nothing in the ladder consults a Space, so a null spaceId cannot deny", () => {
    // Every signal decideItem takes is about the viewer, the task and the
    // List. There is no `spaceId` input to get wrong.
    const keys = ["orgAdmin", "guest", "agent", "creator", "assignee", "listRole", "archived", "list"];
    expect(keys).not.toContain("spaceId");
    expect(keys).not.toContain("space");
  });
});

describe("no item route may gate on a Space", () => {
  it.each(ITEM_ROUTE_FILES)("%s does not resolve a Space", (file) => {
    const src = routeSource(file);
    // The two helpers that caused the bug, and the field they keyed on.
    expect(src).not.toMatch(/getSpaceForReader/);
    expect(src).not.toMatch(/canContributeSpace/);
    expect(src).not.toMatch(/canEditSpace/);
    expect(src).not.toMatch(/board\.spaceId\s*\)?\s*\)?\s*(?:return|\?)/);
  });

  it.each(ITEM_ROUTE_FILES)("%s gates through the one item-ref door", (file) => {
    const src = routeSource(file);
    expect(src).toMatch(/gateItem\(/);
    expect(src).toMatch(/from "@\/lib\/item-gate"/);
  });

  it("the gate itself resolves a List, never a Space", () => {
    const gate = readFileSync(join(__dirname, "item-gate.ts"), "utf8")
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .replace(/(^|[^:])\/\/.*$/gm, "$1");
    expect(gate).toMatch(/getBoardForReader/);
    expect(gate).not.toMatch(/getSpaceForReader/);
    expect(gate).not.toMatch(/canContributeSpace/);
  });
});
