import { describe, expect, it } from "vitest";
import {
  COMPLEXITIES,
  COMPLEXITY_LABEL,
  STORED_TEMPLATE_KINDS,
  TEMPLATE_KINDS,
  TEMPLATE_KIND_BY_KEY,
  appliedToast,
  isStoredKind,
  kindFromParam,
  kindParam,
  navigationFor,
  type TemplateKindKey,
} from "./kinds";

describe("the template kind table", () => {
  it("covers every stored TemplateKind plus the one pseudo-kind", () => {
    // If prisma gains a TemplateKind value this list is what has to grow, and
    // the API's own enum is asserted against it in template-center.test.ts.
    expect(STORED_TEMPLATE_KINDS).toEqual(["TASK", "LIST", "FOLDER", "SPACE", "DOC", "VIEW", "WHITEBOARD"]);
    expect(TEMPLATE_KINDS).toHaveLength(8);
    expect(TEMPLATE_KIND_BY_KEY.KIT.label).toBe("Starter kit");
  });

  it("gives every kind its own line drawing, so no two cards look alike", () => {
    const arts = TEMPLATE_KINDS.map((k) => k.art);
    expect(new Set(arts).size).toBe(arts.length);
  });

  it("names a container for exactly the kinds that live inside one", () => {
    const needs = TEMPLATE_KINDS.filter((k) => k.target !== "none").map((k) => k.key);
    expect(needs.sort()).toEqual(["DOC", "FOLDER", "LIST", "VIEW", "WHITEBOARD"]);
  });

  it("uses the naming canon: Canvas, never Whiteboard; List, never Board", () => {
    expect(TEMPLATE_KIND_BY_KEY.WHITEBOARD.label).toBe("Canvas");
    expect(TEMPLATE_KIND_BY_KEY.LIST.label).toBe("List");
    for (const k of TEMPLATE_KINDS) {
      expect(k.label).not.toMatch(/board|whiteboard/i);
    }
  });
});

describe("kindFromParam", () => {
  it("reads the lower-case link form every href in the product writes", () => {
    expect(kindFromParam("task")).toBe("TASK");
    expect(kindFromParam("doc")).toBe("DOC");
    expect(kindFromParam("list")).toBe("LIST");
  });

  it("accepts the canon word and the stored word for a canvas", () => {
    expect(kindFromParam("canvas")).toBe("WHITEBOARD");
    expect(kindFromParam("whiteboard")).toBe("WHITEBOARD");
  });

  it("lands an old ?kind=board link on Lists rather than on nothing", () => {
    expect(kindFromParam("board")).toBe("LIST");
  });

  it("falls back to everything for all, empty and unknown values", () => {
    expect(kindFromParam("all")).toBeNull();
    expect(kindFromParam("")).toBeNull();
    expect(kindFromParam(null)).toBeNull();
    expect(kindFromParam("nonsense")).toBeNull();
  });

  it("round-trips every kind through the link form", () => {
    for (const k of TEMPLATE_KINDS) {
      expect(kindFromParam(kindParam(k.key))).toBe(k.key);
    }
  });

  it("isStoredKind rejects the pseudo-kind", () => {
    expect(isStoredKind("KIT")).toBe(false);
    expect(isStoredKind("LIST")).toBe(true);
  });
});

describe("navigationFor: every kind arrives somewhere", () => {
  const cases: Array<[TemplateKindKey, Parameters<typeof navigationFor>[0], string | null]> = [
    ["LIST", { kind: "LIST", slug: "q4-leads" }, "/boards/q4-leads"],
    ["SPACE", { kind: "SPACE", slug: "design" }, "/spaces/design"],
    ["FOLDER", { kind: "FOLDER", folderId: "f1" }, "/folders/f1"],
    ["DOC", { kind: "DOC", docId: "d1" }, "/docs/d1"],
    ["WHITEBOARD", { kind: "WHITEBOARD", whiteboardId: "w1" }, "/canvas/w1"],
    ["VIEW", { kind: "VIEW", boardSlug: "q4-leads", viewId: "v1" }, "/boards/q4-leads?view=v1"],
    ["TASK", { kind: "TASK", config: {} }, null],
    ["KIT", { kind: "KIT", created: [] }, null],
  ];

  for (const [name, result, expected] of cases) {
    it(`${name} lands on ${expected ?? "its own modal or toast"}`, () => {
      expect(navigationFor(result)).toBe(expected);
    });
  }

  it("navigates nowhere rather than to a broken URL when the id is missing", () => {
    expect(navigationFor({ kind: "LIST" })).toBeNull();
    expect(navigationFor({ kind: "VIEW", boardSlug: "x" })).toBeNull();
  });
});

describe("appliedToast", () => {
  it("names the three things a starter kit created", () => {
    expect(
      appliedToast({
        kind: "KIT",
        created: [
          { label: "Runbook", href: "/docs/1" },
          { label: "Intake", href: "/forms/2" },
          { label: "Tracker", href: "/tables/3" },
        ],
      }),
    ).toBe("Created Runbook, Intake, Tracker");
  });

  it("does not claim a kit created something when it created nothing", () => {
    expect(appliedToast({ kind: "KIT", created: [] })).toBe("Starter kit applied");
  });
});

describe("complexity words", () => {
  it("prints the spec's three words over the three stored values", () => {
    expect(COMPLEXITIES.map((c) => COMPLEXITY_LABEL[c])).toEqual(["Simple", "Standard", "Advanced"]);
  });
});
