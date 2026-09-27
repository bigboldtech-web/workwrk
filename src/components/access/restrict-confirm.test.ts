// restrictConfirm (manage-access-model.ts): the one confirm before
// Restricted goes on, for a doc, a Folder and a List. The doc keeps its
// wording word for word; a Folder and a List ask with the numbers the server
// worked out (general.restrictLoses), so a Full holder is never cut off, or
// cuts others off, without being told first.

import { describe, expect, it } from "vitest";
import type { AccessInheritedEntry, AccessPanel, AccessVia, PanelRole } from "@/lib/access/access-panel";
import { restrictConfirm, restrictDocConfirm, restrictLosesOf } from "./manage-access-model";

const viaFolder: AccessVia = { type: "node", kind: "folder", id: "f1", name: "Folder A", href: "/folders/f1", canManage: true };

function inherited(id: string, role: PanelRole): AccessInheritedEntry {
  return { person: { id, name: id, email: `${id}@acme.test`, avatar: null, active: true }, role, via: viaFolder };
}

type General = AccessPanel["general"] & { restrictLoses?: { others: number; everyone: boolean } };

function panel(kind: "folder" | "list" | "doc" | "space" | "canvas", general: Partial<General> = {}, over: Partial<AccessPanel> = {}): AccessPanel {
  return {
    node: { kind, id: "n1", name: "Sub A1", noun: kind, href: "/x", space: { id: "s1", name: "Space S", slug: "s", href: "/spaces/s" }, notepadOwner: null },
    viewer: { role: "FULL", canManage: true, maxGrant: "FULL", isAgent: false },
    roles: ["FULL", "EDIT", "VIEW"],
    general: {
      visibility: kind === "doc" ? null : "WORKSPACE", restricted: kind === "doc" ? false : null, publicLink: null, orgWideSpace: null,
      privateRule: "legacy", inheritsFrom: { kind: "folder", id: "f1", name: "Folder A" }, ...general,
    } as General,
    direct: [], inherited: [], inheritedMore: [], hiddenInherited: [], everyone: null, admins: { count: 1 }, orgName: "Acme",
    grantsAvailable: true,
    ...over,
  };
}

describe("restrictConfirm: Folder and List", () => {
  it("warns a Full holder who reaches the Folder only through its parent that they lock themselves out", () => {
    const c = restrictConfirm(panel("folder", { viewerKeepsIfRestricted: false, restrictLoses: { others: 1, everyone: false } }), "me");
    expect(c).toEqual({
      title: "Restrict this Folder and lose your access?",
      description: "1 person who reaches it through Folder A will lose access to it and everything inside it. You reach it only through Folder A, so you will lose access too, and you will not be able to turn this back. Only the people listed here, the person who made it and Admins keep it.",
      confirmLabel: "Restrict and lose access",
    });
  });

  it("asks an admin restricting a List, with the count of people who lose it", () => {
    const c = restrictConfirm(panel("list", { viewerKeepsIfRestricted: true, restrictLoses: { others: 2, everyone: false } }), "me");
    expect(c?.title).toBe("Restrict this List?");
    expect(c?.description).toBe("2 people who reach it through Folder A will lose access to it and everything inside it. Only the people listed here, the person who made it, the Space owner and Admins keep it.");
    expect(c?.confirmLabel).toBe("Restrict");
  });

  it("names the whole org when everyone at it opens the node today", () => {
    const c = restrictConfirm(panel("folder", { viewerKeepsIfRestricted: true, restrictLoses: { others: 3, everyone: true } }), "me");
    expect(c?.description).toContain("Everyone at Acme who is not listed here will lose access to it and everything inside it.");
    expect(c?.description).not.toContain("3 people");
  });

  it("the viewer alone, at the Space root, reads whole", () => {
    const c = restrictConfirm(panel("list", { viewerKeepsIfRestricted: false, inheritsFrom: null, restrictLoses: { others: 0, everyone: false } }), "me");
    expect(c?.description).toBe("You reach it only through where it lives, so you will lose access, and you will not be able to turn this back. Only the people listed here, the person who made it, the Space owner and Admins keep it.");
  });

  it("trusts the server's count over the panel's rows (the legacy floor can keep people the rows would count)", () => {
    const p = panel("folder", { viewerKeepsIfRestricted: true, restrictLoses: { others: 0, everyone: false } }, { inherited: [inherited("b", "EDIT")] });
    expect(restrictConfirm(p, "me")).toBeNull();
  });

  it("falls back to the panel's inherited people when the server sent no count", () => {
    const p = panel("folder", { viewerKeepsIfRestricted: true }, { inherited: [inherited("b", "EDIT"), inherited("me", "FULL")], inheritedMore: [{ via: viaFolder, more: 2 }] });
    expect(restrictConfirm(p, "me")?.description).toContain("3 people who reach it through Folder A will lose access");
  });

  it("asks nothing when nobody loses it, when it is already Restricted, and for kinds with no switch", () => {
    expect(restrictConfirm(panel("folder", { viewerKeepsIfRestricted: true, restrictLoses: { others: 0, everyone: false } }), "me")).toBeNull();
    expect(restrictConfirm(panel("list", { visibility: "PRIVATE", viewerKeepsIfRestricted: false, restrictLoses: { others: 4, everyone: false } }), "me")).toBeNull();
    expect(restrictConfirm(panel("space", { viewerKeepsIfRestricted: false }), "me")).toBeNull();
    expect(restrictConfirm(panel("canvas", { viewerKeepsIfRestricted: false }), "me")).toBeNull();
  });
});

describe("restrictConfirm: a doc keeps its own confirm word for word", () => {
  it("is restrictDocConfirm for a doc", () => {
    const p = panel("doc", { viewerKeepsIfRestricted: false }, { inherited: [inherited("me", "FULL"), inherited("b", "EDIT")] });
    expect(restrictConfirm(p, "me")).toEqual(restrictDocConfirm(p, "me"));
    expect(restrictConfirm(p, "me")?.title).toBe("Restrict this doc and lose your access?");
    expect(restrictConfirm(p, "me")?.description).toBe("1 person who reaches it through where it lives will lose access. You reach it only through where it lives, so you will lose access too, and only its owner or an Admin can turn this back. Only the people listed here, the person who made it and Admins keep it.");
  });
});

describe("restrictLosesOf", () => {
  it("reads the server's numbers and nothing malformed", () => {
    expect(restrictLosesOf(panel("folder", { restrictLoses: { others: 2, everyone: false } }).general)).toEqual({ others: 2, everyone: false });
    expect(restrictLosesOf(panel("folder").general)).toBeNull();
    expect(restrictLosesOf({ ...panel("folder").general, restrictLoses: { others: "2" } } as unknown as AccessPanel["general"])).toBeNull();
  });
});
