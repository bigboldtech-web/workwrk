import { describe, expect, it } from "vitest";

import {
  CANONICAL_APP,
  CANONICAL_HUB,
  OBJECT_SEGMENT,
  SPACE_SCOPED,
  STORAGE_HUBS,
  addressHref,
  canonicalHref,
  canonicalRedirect,
  closedObjectHref,
  editorLinkHref,
  interceptDecision,
  newTabHref,
  objectHref,
  objectHrefFor,
  openedObject,
  opensInWork,
  sameAddress,
  sectionHref,
  sectionHrefFor,
  shareHref,
  splitHref,
  workDoorHref,
  type InterceptInput,
  type NewTabInput,
  type ObjectKind,
} from "./object-href";
import { FOLDED_APP_HUB, HUB_KEYS, resolveHub, type HubKey } from "./route-hub";

const KINDS: ObjectKind[] = ["doc", "table", "canvas", "sop", "form"];
/** Every hub that is not a storage browser: Work, Planner, AI, Talk, Teams and Settings. */
const WORK_OPENERS: HubKey[] = ["home", "planner", "ai", "chat", "teams", "settings"];
const STORAGE: HubKey[] = ["docs", "tables"];

describe("the storage hubs", () => {
  it("are Docs and Tables and nothing else", () => {
    expect([...STORAGE_HUBS].sort()).toEqual(["docs", "tables"]);
  });

  it("are the only hubs whose links do not open in Work", () => {
    for (const hub of HUB_KEYS) expect(opensInWork(hub), hub).toBe(!STORAGE.includes(hub));
    expect([...STORAGE, ...WORK_OPENERS].sort()).toEqual([...HUB_KEYS].sort());
  });
});

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

  it("keeps the canonical URL inside the two storage hubs, for every kind", () => {
    for (const hub of STORAGE) {
      for (const kind of KINDS) {
        expect(objectHref(kind, "x", hub, "design-team"), `${hub} ${kind}`).toBe(canonicalHref(kind, "x"));
        expect(objectHref(kind, "x", hub), `${hub} ${kind}`).toBe(canonicalHref(kind, "x"));
      }
    }
    expect(objectHref("doc", "d1", "docs", "design-team")).toBe("/docs/d1");
    expect(objectHref("form", "f1", "tables")).toBe("/forms/f1");
  });

  it("opens the Work address from every other hub: Space-scoped with a slug, else the door", () => {
    for (const hub of WORK_OPENERS) {
      expect(objectHref("doc", "d1", hub, "design-team"), hub).toBe("/spaces/design-team/docs/d1");
      expect(objectHref("table", "t1", hub, "design-team"), hub).toBe("/spaces/design-team/tables/t1");
      expect(objectHref("canvas", "c1", hub, "design-team"), hub).toBe("/spaces/design-team/canvas/c1");
      expect(objectHref("doc", "d1", hub), hub).toBe("/work/docs/d1");
      expect(objectHref("canvas", "c1", hub, null), hub).toBe("/work/canvas/c1");
      expect(objectHref("sop", "s1", hub, "design-team"), hub).toBe("/work/sops/s1");
      expect(objectHref("form", "f1", hub, "design-team"), hub).toBe("/work/forms/f1");
    }
  });

  it("encodes the slug and the id", () => {
    expect(objectHref("doc", "a/b", "home", "x y")).toBe("/spaces/x%20y/docs/a%2Fb");
    expect(objectHref("doc", "a b", "docs")).toBe("/docs/a%20b");
    expect(objectHref("doc", "a b", "chat")).toBe("/work/docs/a%20b");
  });

  it("builds addresses every one of which resolves to the right hub", () => {
    for (const kind of KINDS) {
      for (const hub of WORK_OPENERS) {
        expect(resolveHub(objectHref(kind, "x", hub))).toBe("home");
        expect(resolveHub(objectHref(kind, "x", hub, "s"))).toBe("home");
      }
      expect(resolveHub(canonicalHref(kind, "x"))).not.toBe("home");
    }
  });
});

describe("workDoorHref", () => {
  it("is the id-only Work address of every kind", () => {
    expect(KINDS.map((k) => workDoorHref(k, "x"))).toEqual([
      "/work/docs/x", "/work/tables/x", "/work/canvas/x", "/work/sops/x", "/work/forms/x",
    ]);
    expect(workDoorHref("doc", "a/b")).toBe("/work/docs/a%2Fb");
  });

  it("is what addressHref builds for the door, and parses back as the door", () => {
    for (const kind of KINDS) {
      expect(workDoorHref(kind, "x")).toBe(addressHref(kind, "x", { scope: "work" }));
      expect(openedObject(workDoorHref(kind, "x"))).toEqual({ kind, id: "x", scope: "work", spaceSlug: null });
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

  it("maps a stored canonical href to the door from every hub that is not a storage browser", () => {
    for (const hub of WORK_OPENERS) {
      expect(sectionHref("/docs/d1#b-12", hub), hub).toBe("/work/docs/d1#b-12");
      expect(sectionHref("/tables/t1?row=r2", hub), hub).toBe("/work/tables/t1?row=r2");
      expect(sectionHref("/canvas/c1", hub), hub).toBe("/work/canvas/c1");
      expect(sectionHref("/sops/s1?edit=1", hub), hub).toBe("/work/sops/s1?edit=1");
      expect(sectionHref("/forms/f1?tab=responses#top", hub), hub).toBe("/work/forms/f1?tab=responses#top");
    }
  });

  it("keeps a Work href as it is outside the storage hubs, slug hint, query and hash included", () => {
    for (const hub of WORK_OPENERS) {
      expect(sectionHref("/spaces/design-team/docs/d1?peek=d2#b-1", hub), hub).toBe("/spaces/design-team/docs/d1?peek=d2#b-1");
      expect(sectionHref("/work/canvas/c1", hub), hub).toBe("/work/canvas/c1");
      expect(sectionHref("/work/forms/f1?tab=responses", hub), hub).toBe("/work/forms/f1?tab=responses");
    }
  });

  it("maps every form back to canonical inside the two storage hubs", () => {
    for (const hub of STORAGE) {
      expect(sectionHref("/spaces/design-team/docs/d1", hub), hub).toBe("/docs/d1");
      expect(sectionHref("/work/tables/t1?new=1", hub), hub).toBe("/tables/t1?new=1");
      expect(sectionHref("/work/sops/s1#step-2", hub), hub).toBe("/sops/s1#step-2");
      expect(sectionHref("/docs/d1", hub), hub).toBe("/docs/d1");
      expect(sectionHref("/forms/f1?tab=responses", hub), hub).toBe("/forms/f1?tab=responses");
    }
  });

  it("leaves everything that is not an object href untouched", () => {
    for (const h of ["", "/boards/tasks", "/item/i1", "/docs", "/docs/trash", "/forms/f1/respond", "https://example.com/docs/d1", "//evil.example/docs/d1", "mailto:a@b.c", "docs/d1", "#b-1", "?x=1"]) {
      for (const hub of HUB_KEYS) expect(sectionHref(h, hub), `${hub} ${h}`).toBe(h);
    }
  });

  it("is idempotent in every hub", () => {
    const hrefs = ["/docs/d1", "/work/docs/d1#x", "/spaces/s/tables/t1?row=1", "/forms/f1?tab=responses", "/sops/s1", "/canvas/c1#f", "/boards/b"];
    for (const hub of HUB_KEYS) {
      for (const h of hrefs) {
        const once = sectionHref(h, hub);
        expect(sectionHref(once, hub), `${hub} ${h}`).toBe(once);
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

  it("copies the door from every hub, the storage hubs included", () => {
    for (const hub of HUB_KEYS) {
      expect(shareHref("/spaces/design-team/docs/d1", hub), hub).toBe("/work/docs/d1");
      expect(shareHref("/docs/d1#b-1", hub), hub).toBe("/work/docs/d1#b-1");
      expect(shareHref("/tables/t1?row=r1", hub), hub).toBe("/work/tables/t1?row=r1");
      expect(shareHref("/canvas/c1", hub), hub).toBe("/work/canvas/c1");
      expect(shareHref("/sops/s1", hub), hub).toBe("/work/sops/s1");
      expect(shareHref("/forms/f1", hub), hub).toBe("/work/forms/f1");
    }
    expect(shareHref("/tables/t1", "tables")).toBe("/work/tables/t1");
    expect(shareHref("/docs/d1", "docs")).toBe("/work/docs/d1");
  });

  it("leaves non-object hrefs alone, the public form address included", () => {
    for (const hub of HUB_KEYS) {
      expect(shareHref("/boards/tasks", hub)).toBe("/boards/tasks");
      expect(shareHref("/forms/f1/respond", hub)).toBe("/forms/f1/respond");
      expect(shareHref("https://example.com/docs/d1", hub)).toBe("https://example.com/docs/d1");
    }
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
    expect(objectHrefFor("form", "f2", "/forms/f1", null)).toBe("/forms/f2");
  });

  it("opens in Work from Talk, Planner, Teams, AI and the Settings takeover", () => {
    expect(objectHrefFor("doc", "d2", "/tlk/c1", null)).toBe("/work/docs/d2");
    expect(objectHrefFor("table", "t2", "/planner", null, "design-team")).toBe("/spaces/design-team/tables/t2");
    expect(objectHrefFor("sop", "s2", "/people/roles/r1", null)).toBe("/work/sops/s2");
    expect(objectHrefFor("canvas", "c2", "/sidekick", null)).toBe("/work/canvas/c2");
    expect(objectHrefFor("table", "t2", "/imports", null)).toBe("/work/tables/t2");
    expect(objectHrefFor("form", "f2", "/settings/data", null)).toBe("/work/forms/f2");
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
    expect(sectionHrefFor("/docs/d2", "/people", null)).toBe("/work/docs/d2");
    expect(sectionHrefFor("/forms/f2?tab=responses", "/tlk/c1", null)).toBe("/work/forms/f2?tab=responses");
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

  it("opens a canonical link clicked in Talk in Work, in this tab or a new one", () => {
    const talk = { ...base, pathname: "/tlk/c1", open: null, href: "/docs/d1" };
    expect(interceptDecision(talk)).toEqual({ action: "push", href: "/work/docs/d1" });
    expect(interceptDecision({ ...talk, target: "_blank" })).toEqual({ action: "open", href: "/work/docs/d1" });
    expect(interceptDecision({ ...talk, href: "http://localhost:3007/sops/s1" })).toEqual({ action: "push", href: "/work/sops/s1" });
  });

  it("opens canonical links in Work from Planner, Teams, AI and Settings", () => {
    for (const pathname of ["/planner", "/people/roles/r1", "/sidekick", "/imports", "/settings/data"]) {
      expect(interceptDecision({ ...base, pathname, open: null, href: "/forms/f1" }), pathname).toEqual({ action: "push", href: "/work/forms/f1" });
    }
  });

  it("keeps a Work link clicked in the Docs hub inside Docs", () => {
    expect(interceptDecision({ ...base, pathname: "/docs", open: null, href: "/work/docs/d1" })).toEqual({ action: "push", href: "/docs/d1" });
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
    expect(interceptDecision({ ...base, pathname: "/tlk/c1", open: null, href: "/work/docs/d2" })).toEqual({ action: "none" });
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

describe("newTabHref", () => {
  const talk: NewTabInput = {
    href: "http://localhost:3007/docs/d1",
    origin: "http://localhost:3007",
    pathname: "/tlk/c1",
    gesture: "press",
    button: 0,
    metaKey: true,
    ctrlKey: false,
    shiftKey: false,
    altKey: false,
    isContentEditable: false,
    download: false,
    optOut: false,
    open: null,
  };

  it("gives a cmd-click on a canonical link in Talk the Work form, query and hash kept", () => {
    expect(newTabHref(talk)).toBe("/work/docs/d1");
    expect(newTabHref({ ...talk, href: "/tables/t1?row=r1#c" })).toBe("/work/tables/t1?row=r1#c");
    expect(newTabHref({ ...talk, href: "/forms/f1" })).toBe("/work/forms/f1");
  });

  it("maps every new-tab gesture: cmd, ctrl and shift clicks, a middle press and the context menu", () => {
    expect(newTabHref({ ...talk, metaKey: false, ctrlKey: true })).toBe("/work/docs/d1");
    expect(newTabHref({ ...talk, metaKey: false, shiftKey: true })).toBe("/work/docs/d1");
    expect(newTabHref({ ...talk, metaKey: false, button: 1 })).toBe("/work/docs/d1");
    expect(newTabHref({ ...talk, metaKey: false, gesture: "menu" })).toBe("/work/docs/d1");
    expect(newTabHref({ ...talk, metaKey: false, gesture: "menu", button: 2 })).toBe("/work/docs/d1");
  });

  it("leaves a plain primary press to the click listener, and alt (a download) and other buttons to the browser", () => {
    expect(newTabHref({ ...talk, metaKey: false })).toBeNull();
    expect(newTabHref({ ...talk, metaKey: false, altKey: true })).toBeNull();
    expect(newTabHref({ ...talk, metaKey: false, button: 2 })).toBeNull();
    expect(newTabHref({ ...talk, metaKey: false, button: 3 })).toBeNull();
  });

  it("gives null inside the Docs hub, where the canonical link is already the section form", () => {
    expect(newTabHref({ ...talk, pathname: "/docs" })).toBeNull();
    expect(newTabHref({ ...talk, pathname: "/docs/d9", gesture: "menu" })).toBeNull();
    expect(newTabHref({ ...talk, pathname: "/docs", href: "/work/docs/d1" })).toBe("/docs/d1");
  });

  it("gives null for a link that already has the section form", () => {
    expect(newTabHref({ ...talk, href: "/work/docs/d1" })).toBeNull();
    expect(newTabHref({ ...talk, href: "/spaces/design-team/docs/d1#b-1" })).toBeNull();
  });

  it("honours the interceptor's opt-outs: opted out, download, editable and foreign links give null", () => {
    expect(newTabHref({ ...talk, optOut: true })).toBeNull();
    expect(newTabHref({ ...talk, download: true })).toBeNull();
    expect(newTabHref({ ...talk, isContentEditable: true })).toBeNull();
    expect(newTabHref({ ...talk, href: "https://example.com/docs/d1" })).toBeNull();
    expect(newTabHref({ ...talk, href: "mailto:x@y.z" })).toBeNull();
    expect(newTabHref({ ...talk, href: "/boards/tasks" })).toBeNull();
    expect(newTabHref({ ...talk, href: "/forms/f1/respond" })).toBeNull();
  });

  it("sends a link to the open object to the address it is mounted at", () => {
    const open = { kind: "doc" as const, id: "d1", self: "/spaces/design-team/docs/d1" };
    expect(newTabHref({ ...talk, pathname: "/item/i1", open, href: "/docs/d1?peek=d2" })).toBe("/spaces/design-team/docs/d1?peek=d2");
  });
});

describe("canonicalRedirect", () => {
  const shown = (hidden: { hubs?: HubKey[]; apps?: string[] } = {}) => ({
    hub: (h: HubKey) => !(hidden.hubs ?? []).includes(h),
    app: (k: string) => !(hidden.apps ?? []).includes(k),
  });

  it("names the storage hub that owns each kind's canonical address, as ROUTE_HUB does", () => {
    expect(CANONICAL_HUB).toEqual({ doc: "docs", canvas: "docs", sop: "docs", table: "tables", form: "tables" });
    for (const kind of KINDS) expect(resolveHub(canonicalHref(kind, "x")), kind).toBe(CANONICAL_HUB[kind]);
    for (const hub of Object.values(CANONICAL_HUB)) expect(STORAGE_HUBS.has(hub)).toBe(true);
  });

  it("names the folded app a form and an SOP also need, folded into that same hub", () => {
    expect(CANONICAL_APP).toEqual({ sop: "sops", form: "forms" });
    for (const [kind, app] of Object.entries(CANONICAL_APP) as [ObjectKind, string][]) {
      expect(FOLDED_APP_HUB[app], app).toBe(CANONICAL_HUB[kind]);
    }
  });

  it("sends a doc to the door when the Docs hub is hidden, and nowhere when it is shown", () => {
    expect(canonicalRedirect("/docs/d1", shown({ hubs: ["docs"] }))).toBe("/work/docs/d1");
    expect(canonicalRedirect("/docs/d1", shown())).toBeNull();
    expect(canonicalRedirect("/docs/d1?x=1#b-2", shown({ hubs: ["docs"] }))).toBe("/work/docs/d1");
    expect(canonicalRedirect("/docs/a%2Fb/", shown({ hubs: ["docs"] }))).toBe("/work/docs/a%2Fb");
  });

  it("moves a canvas with the Docs hub and a table with the Tables hub", () => {
    expect(canonicalRedirect("/canvas/c1", shown({ hubs: ["docs"] }))).toBe("/work/canvas/c1");
    expect(canonicalRedirect("/canvas/c1", shown({ hubs: ["tables"] }))).toBeNull();
    expect(canonicalRedirect("/tables/t1", shown({ hubs: ["tables"] }))).toBe("/work/tables/t1");
    expect(canonicalRedirect("/tables/t1", shown({ hubs: ["docs"] }))).toBeNull();
    expect(canonicalRedirect("/tables/t1", shown({ apps: ["forms", "sops"] }))).toBeNull();
  });

  it("keeps a form canonical only with the Tables hub AND the Forms app", () => {
    expect(canonicalRedirect("/forms/f1", shown())).toBeNull();
    expect(canonicalRedirect("/forms/f1", shown({ apps: ["forms"] }))).toBe("/work/forms/f1");
    expect(canonicalRedirect("/forms/f1", shown({ hubs: ["tables"] }))).toBe("/work/forms/f1");
    expect(canonicalRedirect("/forms/f1", shown({ hubs: ["docs"], apps: ["sops"] }))).toBeNull();
  });

  it("keeps an SOP canonical only with the Docs hub AND the SOPs app", () => {
    expect(canonicalRedirect("/sops/s1", shown())).toBeNull();
    expect(canonicalRedirect("/sops/s1", shown({ apps: ["sops"] }))).toBe("/work/sops/s1");
    expect(canonicalRedirect("/sops/s1", shown({ hubs: ["docs"] }))).toBe("/work/sops/s1");
    expect(canonicalRedirect("/sops/s1", shown({ hubs: ["tables"], apps: ["forms"] }))).toBeNull();
  });

  it("never moves a Work address, a public form, a static child or a non-object", () => {
    const nothing = shown({ hubs: ["docs", "tables"], apps: ["forms", "sops"] });
    for (const p of [
      "/work/docs/d1", "/spaces/s/docs/d1", "/spaces/s/tables/t1", "/work/forms/f1", "/work/sops/s1",
      "/forms/f1/respond", "/docs/trash", "/sops/new", "/sops/my-sops", "/sops/compliance", "/sops/manage",
      "/docs", "/tables", "/forms", "/sops", "/canvas", "/boards/b1", "/item/i1", "/", "",
    ]) {
      expect(canonicalRedirect(p, nothing), p).toBeNull();
    }
  });

  it("moves only the kinds it is asked about", () => {
    const nothing = shown({ hubs: ["docs", "tables"], apps: ["forms", "sops"] });
    expect(canonicalRedirect("/docs/d1", nothing, ["doc"])).toBe("/work/docs/d1");
    expect(canonicalRedirect("/docs/d1", nothing, ["table", "canvas"])).toBeNull();
    expect(canonicalRedirect("/forms/f1", nothing, ["form"])).toBe("/work/forms/f1");
    expect(canonicalRedirect("/forms/f1", nothing, [])).toBeNull();
  });

  it("never sends anyone to a canonical address, so the door can never send them back", () => {
    const nothing = shown({ hubs: ["docs", "tables"], apps: ["forms", "sops"] });
    for (const kind of KINDS) {
      const to = canonicalRedirect(canonicalHref(kind, "x"), nothing);
      expect(to).toBe(workDoorHref(kind, "x"));
      expect(openedObject(to!)?.scope).toBe("work");
      expect(canonicalRedirect(to!, nothing)).toBeNull();
    }
  });
});

describe("editorLinkHref: a link clicked in a doc being edited", () => {
  const origin = "http://localhost:3011";
  it("opens a doc link at its Work address from a doc opened in Work, as a read-only doc does", () => {
    const open = { kind: "doc" as const, id: "d1", self: "/work/docs/d1" };
    expect(editorLinkHref({ href: `${origin}/docs/d2`, origin, pathname: "/work/docs/d1", open })).toBe("/work/docs/d2");
    expect(editorLinkHref({ href: `${origin}/tables/t1#r`, origin, pathname: "/work/docs/d1", open })).toBe("/work/tables/t1#r");
    expect(interceptDecision({
      href: `${origin}/docs/d2`, origin, pathname: "/work/docs/d1", button: 0, metaKey: false, ctrlKey: false, shiftKey: false,
      altKey: false, defaultPrevented: false, isContentEditable: false, download: false, target: "_blank", optOut: false, open,
    })).toEqual({ action: "open", href: editorLinkHref({ href: `${origin}/docs/d2`, origin, pathname: "/work/docs/d1", open }) });
  });
  it("keeps the canonical form inside the Docs hub (B2), and leaves other links as written", () => {
    expect(editorLinkHref({ href: `${origin}/docs/d2`, origin, pathname: "/docs/d1", open: null })).toBe("/docs/d2");
    expect(editorLinkHref({ href: "https://example.com/x", origin, pathname: "/work/docs/d1", open: null })).toBe("https://example.com/x");
  });
});
