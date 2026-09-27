import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

// The read-only banner on a task open in a List it is only SHOWN in (Phase 5b,
// ?list= on a linked List), held from both hosts and the body.
//
// A link grants Can view at most, whatever the viewer holds on the linked
// List, so nobody on that List (its manager included) can give edit on the
// task. The banner used to say "Ask the list owner for edit access" and its
// Request access opened THAT List's Share dialog: a door to people who cannot
// help. Edit comes from the task's home List, which a linked-only reader may
// not even be allowed to know about. So:
//   * neither host wires Request access (the linked List's Share dialog) in a
//     linked context;
//   * the body gives the linked context its own banner, which never offers
//     Request access, never names the list owner, and names the home List
//     only when the viewer may read it.
// Source is read with comments stripped, the list-links.client-contract.test.ts
// way, so an explanation that names a prop never fails the guard.

const SRC = join(__dirname, "../..");

function stripComments(text: string): string {
  return text.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");
}

function code(rel: string): string {
  return stripComments(readFileSync(join(SRC, rel), "utf8"));
}

/** The value expression a JSX prop is given, up to the end of its line. */
function propLine(source: string, prop: string): string {
  const m = source.match(new RegExp(`\\b${prop}=\\{([^\\n]*)`));
  return m ? m[1] : "";
}

/** The JSX of the linked-context banner branch, between its test and the next branch. */
function linkedBannerBranch(body: string): string {
  const start = body.indexOf("readOnly && linkedHome ?");
  if (start < 0) return "";
  const end = body.indexOf(") : readOnly ?", start);
  return end < 0 ? "" : body.slice(start, end);
}

describe("the linked-context read-only banner", () => {
  const drawer = code("components/board-view/item-drawer-host.tsx");
  const page = code("app/(dashboard)/item/[id]/page.tsx");
  const body = code("components/board-view/task-detail-body.tsx");

  it("neither host opens the linked List's Share dialog as Request access", () => {
    for (const host of [drawer, page]) {
      const wiring = propLine(host, "onRequestAccess");
      expect(wiring).not.toBe("");
      expect(wiring).toMatch(/!linkedHere/);
    }
  });

  it("both hosts offer the home List only when the viewer may read it", () => {
    expect(propLine(drawer, "onOpenInHome")).toMatch(/linkedHere\?\.home\.readable/);
    // The page host breaks the prop over lines.
    expect(page).toMatch(/onOpenInHome=\{\s*linkedHere\?\.home\.readable/);
  });

  it("the body has its own banner for a linked context, ahead of the generic one", () => {
    expect(linkedBannerBranch(body)).not.toBe("");
    expect(body).toMatch(/const linkedHome = context\?\.kind === "linked" \? context\.home : null/);
  });

  it("that banner never offers Request access and never names the list owner", () => {
    const branch = linkedBannerBranch(body);
    expect(branch).not.toBe("");
    expect(branch).not.toMatch(/onRequestAccess/);
    expect(branch).not.toMatch(/ownerName|listOwner|list owner/);
    expect(branch).not.toMatch(/Request access/);
  });

  it("names the home List only behind home.readable", () => {
    const branch = linkedBannerBranch(body);
    // The hidden-home sentence is the ternary's else arm: it must not carry the name.
    const hidden = branch.match(/:\s*`([^`]*another List[^`]*)`/);
    expect(hidden).not.toBeNull();
    expect(hidden![1]).not.toMatch(/linkedHome\.name/);
    expect(branch).toMatch(/linkedHome\.readable && onOpenInHome/);
  });
});
