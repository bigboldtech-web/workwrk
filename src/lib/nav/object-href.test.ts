import { describe, expect, it } from "vitest";

import {
  OBJECT_SEGMENT,
  SPACE_SCOPED,
  addressHref,
  canonicalHref,
  closedObjectHref,
  interceptDecision,
  objectHref,
  objectHrefFor,
  openedObject,
  sameAddress,
  sectionHref,
  sectionHrefFor,
  shareHref,
  splitHref,
  type InterceptInput,
  type ObjectKind,
} from "./object-href";
import { resolveHub } from "./route-hub";

const KINDS: ObjectKind[] = ["doc", "table", "canvas", "sop", "form"];

describe("objectHref", () => {
  it("opens a Space item at its Space-scoped Work address from Work", () => {
    expect(objectHref("doc", "d1", "home", "design-team")).toBe("/spaces/design-team/docs/d1");
    expect(objectHref("table", "t1", "home", "design-team")).toBe("/spaces/design-team/tables/t1");
    expect(objectHref("canvas", "c1", "home", "design-team")).toBe("/spaces/design-team/canvas/c1");
  });

  it("opens the Work door from Work when no Space is known", () => {
    expect(objectHref("doc", "d1", "home")).toBe("/work/docs/d1");
    expect(objectHref("doc", "d1", "home", null)).toBe("/work/docs/d1");
    expect(objectHref("table", "t1", "home", "")).toBe("/work/tables/t1");
  });

  it("gives SOPs and forms the door only, even with a slug", () => {
    expect(objectHref("sop", "s1", "home", "design-team")).toBe("/work/sops/s1");
    expect(objectHref("form", "f1", "home", "design-team")).toBe("/work/forms/f1");
  });

  it("opens today's canonical URL from every other hub", () => {
    for (const hub of ["docs", "tables", "planner", "ai", "chat", "teams", "settings"] as const) {
      expect(objectHref("doc", "d1", hub, "design-team")).toBe("/docs/d1");
      expect(objectHref("canvas", "c1", hub)).toBe("/canvas/c1");
      expect(objectHref("form", "f1", hub)).toBe("/forms/f1");
    }
  });

  it("encodes the slug and the id", () => {
    expect(objectHref("doc", "a/b", "home", "x y")).toBe("/spaces/x%20y/docs/a%2Fb");
    expect(objectHref("doc", "a b", "docs")).toBe("/docs/a%20b");
  });

  it("builds addresses every one of which resolves to the right hub", () => {
    for (const kind of KINDS) {
      expect(resolveHub(objectHref(kind, "x", "home"))).toBe("home");
      expect(resolveHub(objectHref(kind, "x", "home", "s"))).toBe("home");
      expect(resolveHub(canonicalHref(kind, "x"))).not.toBe("home");
    }
  });
});

describe("addressHref and closedObjectHref", () => {
  it("rebuilds a Work route's own address from its params", () => {
    expect(addressHref("doc", "d1", { scope: "space", slug: "design-team" })).toBe("/spaces/design-team/docs/d1");
    expect(addressHref("form", "f1", { scope: "work" })).toBe("/work/forms/f1");
  });

  it("lands a Trash outside Work on the object's own list", () => {
    expect(closedObjectHref("doc")).toBe("/docs");
    expect(closedObjectHref("table")).toBe("/tables");
    expect(closedObjectHref("canvas")).toBe("/canvas");
    expect(closedObjectHref("sop")).toBe("/sops");
    expect(closedObjectHref("form")).toBe("/forms");
  });

  it("mirrors the canonical segments and scopes only the three tree kinds", () => {
    expect(OBJECT_SEGMENT).toEqual({ doc: "docs", table: "tables", canvas: "canvas", sop: "sops", form: "forms" });
    expect([...SPACE_SCOPED].sort()).toEqual(["canvas", "doc", "table"]);
  });
});

describe("openedObject", () => {
  it("parses all three forms", () => {
    expect(openedObject("/docs/d1")).toEqual({ kind: "doc", id: "d1", scope: "canonical", spaceSlug: null });
    expect(openedObject("/work/tables/t1")).toEqual({ kind: "table", id: "t1", scope: "work", spaceSlug: null });
    expect(openedObject("/spaces/design-team/canvas/c1")).toEqual({ kind: "canvas", id: "c1", scope: "space", spaceSlug: "design-team" });
    expect(openedObject("/work/sops/s1")?.kind).toBe("sop");
    expect(openedObject("/forms/f1")?.kind).toBe("form");
  });

  it("ignores the query, the hash and a trailing slash, and decodes segments", () => {
    expect(openedObject("/docs/d1?peek=d2#b-9")?.id).toBe("d1");
    expect(openedObject("/docs/d1/")?.id).toBe("d1");
    expect(openedObject("/spaces/x%20y/docs/a%2Fb")).toEqual({ kind: "doc", id: "a/b", scope: "space", spaceSlug: "x y" });
  });

  it("rejects static children, deeper paths and non-objects", () => {
    expect(openedObject("/docs/trash")).toBeNull();
    for (const s of ["new", "my-sops", "compliance", "manage"]) {
      expect(openedObject(`/sops/${s}`)).toBeNull();
      expect(openedObject(`/work/sops/${s}`)).toBeNull();
    }
    expect(openedObject("/forms/f1/respond")).toBeNull();
    expect(openedObject("/sops/new/text")).toBeNull();
    expect(openedObject("/docs")).toBeNull();
    expect(openedObject("/work/docs")).toBeNull();
    expect(openedObject("/work")).toBeNull();
    expect(openedObject("/spaces/design-team")).toBeNull();
    expect(openedObject("/spaces/design-team/docs")).toBeNull();
    expect(openedObject("/boards/tasks")).toBeNull();
    expect(openedObject("/item/i1")).toBeNull();
    expect(openedObject("/")).toBeNull();
    expect(openedObject("")).toBeNull();
  });

  it("never reads a Space-scoped SOP or form, which do not exist", () => {
    expect(openedObject("/spaces/design-team/sops/s1")).toBeNull();
    expect(openedObject("/spaces/design-team/forms/f1")).toBeNull();
  });

  it("rejects doubled slashes and undecodable segments", () => {
    expect(openedObject("//docs/d1")).toBeNull();
    expect(openedObject("/docs//d1")).toBeNull();
    expect(openedObject("/docs/%E0%A4%A")).toBeNull();
  });
});

describe("sectionHref", () => {
  it("maps a stored canonical href to the door in Work, keeping the query and hash", () => {
    expect(sectionHref("/docs/d1", "home")).toBe("/work/docs/d1");
    expect(sectionHref("/docs/d1#b-12", "home")).toBe("/work/docs/d1#b-12");
    expect(sectionHref("/tables/t1?row=r2", "home")).toBe("/work/tables/t1?row=r2");
    expect(sectionHref("/sops/s1?edit=1", "home")).toBe("/work/sops/s1?edit=1");
  });

  it("keeps a Work href as it is in Work, slug hint included", () => {
    expect(sectionHref("/spaces/design-team/docs/d1?peek=d2", "home")).toBe("/spaces/design-team/docs/d1?peek=d2");
    expect(sectionHref("/work/canvas/c1", "home")).toBe("/work/canvas/c1");
  });

  it("maps every form back to canonical in any other hub", () => {
    expect(sectionHref("/spaces/design-team/docs/d1", "docs")).toBe("/docs/d1");
    expect(sectionHref("/work/tables/t1?new=1", "tables")).toBe("/tables/t1?new=1");
    expect(sectionHref("/docs/d1", "docs")).toBe("/docs/d1");
  });

  it("leaves everything that is not an object href untouched", () => {
    for (const h of ["", "/boards/tasks", "/item/i1", "/docs", "/docs/trash", "https://example.com/docs/d1", "//evil.example/docs/d1", "mailto:a@b.c", "docs/d1", "#b-1", "?x=1"]) {
      expect(sectionHref(h, "home")).toBe(h);
      expect(sectionHref(h, "docs")).toBe(h);
    }
  });

  it("is idempotent in every hub", () => {
    const hrefs = ["/docs/d1", "/work/docs/d1#x", "/spaces/s/tables/t1?row=1", "/forms/f1?tab=responses", "/boards/b"];
    for (const hub of ["home", "docs", "tables", "teams"] as const) {
      for (const h of hrefs) {
        const once = sectionHref(h, hub);
        expect(sectionHref(once, hub)).toBe(once);
      }
    }
  });
});

describe("shareHref", () => {
  it("copies the door from Work and never a slug", () => {
    expect(shareHref("/spaces/design-team/docs/d1", "home")).toBe("/work/docs/d1");
    expect(shareHref("/docs/d1#b-1", "home")).toBe("/work/docs/d1#b-1");
    expect(shareHref("/work/tables/t1?row=r1", "home")).toBe("/work/tables/t1?row=r1");
  });

  it("copies the canonical URL from every other hub", () => {
    expect(shareHref("/spaces/design-team/docs/d1", "docs")).toBe("/docs/d1");
    expect(shareHref("/tables/t1", "tables")).toBe("/tables/t1");
  });

  it("leaves non-object hrefs alone", () => {
    expect(shareHref("/boards/tasks", "home")).toBe("/boards/tasks");
  });
});

describe("sameAddress", () => {
  it("compares decoded paths without the query, hash or trailing slash", () => {
    expect(sameAddress("/spaces/x%20y/docs/d1", "/spaces/x y/docs/d1")).toBe(true);
    expect(sameAddress("/work/docs/d1/", "/work/docs/d1?peek=2#h")).toBe(true);
    expect(sameAddress("/work/docs/d1", "/spaces/s/docs/d1")).toBe(false);
    expect(sameAddress("/spaces/a/docs/d1", "/spaces/b/docs/d1")).toBe(false);
  });

  it("never calls two broken paths equal", () => {
    expect(sameAddress("/docs/%E0%A4%A", "/docs/%E0%A4%A")).toBe(false);
    expect(sameAddress("//x", "//x")).toBe(false);
  });
});

describe("objectHrefFor and sectionHrefFor", () => {
  const open = { kind: "doc" as const, id: "d1", self: "/spaces/design-team/docs/d1" };

  it("reads the hub from the current path", () => {
    expect(objectHrefFor("doc", "d2", "/home", null)).toBe("/work/docs/d2");
    expect(objectHrefFor("doc", "d2", "/spaces/design-team", null, "design-team")).toBe("/spaces/design-team/docs/d2");
    expect(objectHrefFor("doc", "d2", "/docs/d9", null)).toBe("/docs/d2");
    expect(objectHrefFor("table", "t2", "/tables", null)).toBe("/tables/t2");
  });

  it("answers the open object with the address it is mounted at", () => {
    expect(objectHrefFor("doc", "d1", "/spaces/design-team/docs/d1", open)).toBe(open.self);
    // Under the task drawer the URL is /item/<task>, and the doc is still mounted.
    expect(objectHrefFor("doc", "d1", "/item/i1", open)).toBe(open.self);
    expect(objectHrefFor("table", "d1", "/item/i1", open)).toBe("/work/tables/d1");
  });

  it("keeps the query and hash of a link to the open object", () => {
    expect(sectionHrefFor("/docs/d1?peek=d2", "/item/i1", open)).toBe("/spaces/design-team/docs/d1?peek=d2");
    expect(sectionHrefFor("/docs/d1#b-3", "/spaces/design-team/docs/d1", open)).toBe("/spaces/design-team/docs/d1#b-3");
  });

  it("maps any other object into the current section", () => {
    expect(sectionHrefFor("/docs/d2", "/spaces/design-team/docs/d1", open)).toBe("/work/docs/d2");
    expect(sectionHrefFor("/work/docs/d2", "/docs", null)).toBe("/docs/d2");
    expect(sectionHrefFor("/boards/tasks", "/home", open)).toBe("/boards/tasks");
    expect(sectionHrefFor("https://x.example/docs/d1", "/home", open)).toBe("https://x.example/docs/d1");
  });
});

describe("splitHref", () => {
  it("splits at the first ? or #", () => {
    expect(splitHref("/docs/d1?a=1#b")).toEqual({ path: "/docs/d1", tail: "?a=1#b" });
    expect(splitHref("/docs/d1#b?c")).toEqual({ path: "/docs/d1", tail: "#b?c" });
    expect(splitHref("/docs/d1")).toEqual({ path: "/docs/d1", tail: "" });
  });
});

describe("interceptDecision", () => {
  const base: InterceptInput = {
    href: "http://localhost:3007/docs/d2",
    origin: "http://localhost:3007",
    pathname: "/spaces/design-team/docs/d1",
    button: 0,
    metaKey: false,
    ctrlKey: false,
    shiftKey: false,
    altKey: false,
    defaultPrevented: false,
    isContentEditable: false,
    download: false,
    target: null,
    optOut: false,
    open: { kind: "doc", id: "d1", self: "/spaces/design-team/docs/d1" },
  };

  it("keeps a canonical link clicked in Work inside Work", () => {
    expect(interceptDecision(base)).toEqual({ action: "push", href: "/work/docs/d2" });
    expect(interceptDecision({ ...base, href: "/tables/t1?row=r1" })).toEqual({ action: "push", href: "/work/tables/t1?row=r1" });
  });

  it("keeps a Work link clicked in the Docs hub inside Docs", () => {
    expect(interceptDecision({ ...base, pathname: "/docs/d9", open: null, href: "/work/docs/d2" })).toEqual({ action: "push", href: "/docs/d2" });
    expect(interceptDecision({ ...base, pathname: "/docs", open: null, href: "/spaces/s/docs/d2#h" })).toEqual({ action: "push", href: "/docs/d2#h" });
  });

  it("opens a target=_blank link in a new tab in the mapped form", () => {
    expect(interceptDecision({ ...base, target: "_blank" })).toEqual({ action: "open", href: "/work/docs/d2" });
  });

  it("leaves a link that already has the section's form alone", () => {
    expect(interceptDecision({ ...base, href: "/work/docs/d2" })).toEqual({ action: "none" });
    expect(interceptDecision({ ...base, href: "/spaces/design-team/docs/d1#b-1" })).toEqual({ action: "none" });
    expect(interceptDecision({ ...base, pathname: "/docs/d9", open: null })).toEqual({ action: "none" });
  });

  it("leaves modified, middle, prevented, editable, download and opted-out clicks to the browser", () => {
    expect(interceptDecision({ ...base, metaKey: true })).toEqual({ action: "none" });
    expect(interceptDecision({ ...base, ctrlKey: true })).toEqual({ action: "none" });
    expect(interceptDecision({ ...base, shiftKey: true })).toEqual({ action: "none" });
    expect(interceptDecision({ ...base, altKey: true })).toEqual({ action: "none" });
    expect(interceptDecision({ ...base, button: 1 })).toEqual({ action: "none" });
    expect(interceptDecision({ ...base, defaultPrevented: true })).toEqual({ action: "none" });
    expect(interceptDecision({ ...base, isContentEditable: true })).toEqual({ action: "none" });
    expect(interceptDecision({ ...base, download: true })).toEqual({ action: "none" });
    expect(interceptDecision({ ...base, optOut: true })).toEqual({ action: "none" });
    expect(interceptDecision({ ...base, target: "other-frame" })).toEqual({ action: "none" });
  });

  it("never touches another origin or a non-object path", () => {
    expect(interceptDecision({ ...base, href: "https://example.com/docs/d2" })).toEqual({ action: "none" });
    expect(interceptDecision({ ...base, href: "/boards/tasks" })).toEqual({ action: "none" });
    expect(interceptDecision({ ...base, href: "mailto:x@y.z" })).toEqual({ action: "none" });
  });

  it("sends a link to the open object to the address it is mounted at", () => {
    expect(interceptDecision({ ...base, href: "/docs/d1?peek=d2", pathname: "/item/i1" })).toEqual({
      action: "push",
      href: "/spaces/design-team/docs/d1?peek=d2",
    });
  });
});
