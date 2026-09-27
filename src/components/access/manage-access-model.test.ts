import { describe, expect, it } from "vitest";
import type {
  AccessDirectEntry, AccessInheritedEntry, AccessPanel, AccessPerson, AccessVia, GrantChange, GrantErrorCode, PanelRole,
} from "@/lib/access/access-panel";
import {
  adminsLine, alsoViaText, canEditEntry, canManageHere, canRemoveEntry, capText, defaultRole, dialogSubtitle, dialogTitle,
  entryRoleOptions, errorText, everyoneHint, everyoneLine, generalErrorText, grantsUnavailableText, groupInherited, hasOlderRule,
  strayFailureText,
  inheritedHeader, LAST_FULL_TEXT, lowersOwnManage, manageableSpaceVia, managesViaNode, notepadText, OLDER_RULE_FOOTNOTE,
  orgWideLine, parseGrantError, pickUrl, removalNotice, removeConfirm, roleOptions, SELF_LOWER_CONFIRM,
  sentenceNoun, spaceOrgLine, viaText, FOLDER_RESTRICTED_BLURB,
  keptHigherText, refusedByOwnAccess, restrictDocConfirm, restrictedAboveLine,
} from "./manage-access-model";

const GRANT_CONFLICT = "Someone else just changed this person's access. Check the list and try again.";

const ALL_CODES: GrantErrorCode[] = [
  "not_found", "forbidden", "invalid_body", "invalid_role", "not_in_org", "owner_fixed",
  "last_full", "above_own_role", "private_note", "conflict", "grants_unavailable", "server_error",
];

function person(id: string, name = id): AccessPerson {
  return { id, name, email: `${id}@acme.test`, avatar: null, active: true };
}

function direct(id: string, role: PanelRole, extra: Partial<AccessDirectEntry> = {}): AccessDirectEntry {
  return {
    person: person(id), role, owner: false, source: "FolderMember", editable: true, removable: true,
    lastFull: false, cap: false, alsoVia: null, ...extra,
  };
}

const viaFolder: AccessVia = { type: "node", kind: "folder", id: "f1", name: "Brand refresh", href: "/folders/f1", canManage: true };
const viaSpace: AccessVia = { type: "node", kind: "space", id: "s1", name: "Design Team", href: "/spaces/s1", canManage: false };
const viaHidden: AccessVia = { type: "hidden" };
const viaEveryone: AccessVia = { type: "everyone", orgName: "Acme", from: { kind: "space", name: "Design Team" } };
const viaAdmin: AccessVia = { type: "org_admin", orgName: "Acme" };
const viaOwner: AccessVia = { type: "owner" };
const viaOlder: AccessVia = { type: "older_rule", from: { kind: "folder", name: "Brand refresh" } };

function inherited(id: string, role: PanelRole, via: AccessVia): AccessInheritedEntry {
  return { person: person(id), role, via };
}

function panel(over: Partial<AccessPanel> = {}): AccessPanel {
  return {
    node: { kind: "list", id: "l1", name: "Launch plan", noun: "List", href: "/boards/launch-plan", space: { id: "s1", name: "Design Team", slug: "design", href: "/spaces/s1" }, notepadOwner: null },
    viewer: { role: "FULL", canManage: true, maxGrant: "FULL", isAgent: false },
    roles: ["FULL", "EDIT", "VIEW"],
    general: { visibility: "WORKSPACE", restricted: null, publicLink: null, orgWideSpace: null, privateRule: "legacy" },
    direct: [],
    inherited: [],
    inheritedMore: [],
    hiddenInherited: [],
    everyone: null,
    admins: null,
    orgName: "Acme",
    grantsAvailable: true,
    ...over,
  };
}

function change(over: Partial<GrantChange> = {}): GrantChange {
  return { userId: "u1", role: null, previousRole: "EDIT", noChange: false, stillReaches: null, keepsInside: [], ...over };
}

describe("groupInherited", () => {
  it("groups by where the access comes from and keeps the server's order", () => {
    const p = panel({
      inherited: [
        inherited("a", "EDIT", viaFolder),
        inherited("b", "VIEW", viaSpace),
        inherited("c", "FULL", viaFolder),
        inherited("d", "VIEW", viaHidden),
        inherited("e", "VIEW", viaSpace),
      ],
    });
    const groups = groupInherited(p);
    expect(groups.map((g) => g.entries.map((e) => e.person.id))).toEqual([["a", "c"], ["b", "e"], ["d"]]);
    expect(groups[0].via).toEqual(viaFolder);
    expect(groups[1].via).toEqual(viaSpace);
    expect(groups.every((g) => g.more === 0)).toBe(true);
  });

  it("attaches the server's 'and n more' to its group, and keeps a count with no names", () => {
    const p = panel({
      inherited: [inherited("a", "EDIT", viaFolder)],
      inheritedMore: [
        { via: { ...viaFolder }, more: 4 },
        { via: viaSpace, more: 12 },
      ],
    });
    const groups = groupInherited(p);
    expect(groups.map((g) => [g.entries.length, g.more])).toEqual([[1, 4], [0, 12]]);
    expect(groups[1].via).toEqual(viaSpace);
  });

  it("keeps two older-rule sources apart", () => {
    const p = panel({
      inherited: [
        inherited("a", "VIEW", viaOlder),
        inherited("b", "VIEW", { type: "older_rule", from: { kind: "space", name: "Design Team" } }),
        inherited("c", "VIEW", viaOlder),
      ],
    });
    expect(groupInherited(p).map((g) => g.entries.length)).toEqual([2, 1]);
  });
});

describe("defaultRole", () => {
  it("picks Can edit when it is offered", () => {
    expect(defaultRole(["FULL", "EDIT", "VIEW"])).toBe("EDIT");
    expect(defaultRole(["OWNER", "FULL", "EDIT", "VIEW"])).toBe("EDIT");
  });
  it("picks the lowest offered role otherwise", () => {
    expect(defaultRole(["FULL", "VIEW"])).toBe("VIEW");
    expect(defaultRole(["FULL", "COMMENT"])).toBe("COMMENT");
    expect(defaultRole(["FULL"])).toBe("FULL");
  });
  it("has nothing to pick from an empty list", () => {
    expect(defaultRole([])).toBeNull();
  });
});

describe("roleOptions", () => {
  it("never offers a role above what the viewer may grant", () => {
    const doc = panel({ roles: ["FULL", "EDIT", "COMMENT", "VIEW"], viewer: { role: "EDIT", canManage: true, maxGrant: "EDIT", isAgent: false } });
    expect(roleOptions(doc)).toEqual(["EDIT", "COMMENT", "VIEW"]);
    const space = panel({ roles: ["OWNER", "FULL", "EDIT", "VIEW"], viewer: { role: "FULL", canManage: true, maxGrant: "FULL", isAgent: false } });
    expect(roleOptions(space)).toEqual(["FULL", "EDIT", "VIEW"]);
    const owner = panel({ roles: ["OWNER", "FULL", "EDIT", "VIEW"], viewer: { role: "OWNER", canManage: true, maxGrant: "OWNER", isAgent: false } });
    expect(roleOptions(owner)).toEqual(["OWNER", "FULL", "EDIT", "VIEW"]);
  });
  it("offers nothing when the viewer may grant nothing", () => {
    expect(roleOptions(panel({ viewer: { role: "VIEW", canManage: false, maxGrant: null, isAgent: false } }))).toEqual([]);
  });
  it("keeps a row's current role in its own select even when it is above the viewer's grant", () => {
    const p = panel({ roles: ["FULL", "EDIT", "COMMENT", "VIEW"], viewer: { role: "EDIT", canManage: true, maxGrant: "EDIT", isAgent: false } });
    expect(entryRoleOptions(p, direct("a", "FULL"))).toEqual(["FULL", "EDIT", "COMMENT", "VIEW"]);
    expect(entryRoleOptions(p, direct("a", "VIEW"))).toEqual(["EDIT", "COMMENT", "VIEW"]);
  });
});

describe("canEditEntry and canRemoveEntry", () => {
  it("allow an ordinary row the server marks editable and removable", () => {
    expect(canEditEntry(direct("a", "EDIT"), false)).toBe(true);
    expect(canRemoveEntry(direct("a", "EDIT"), false)).toBe(true);
  });
  it("are false for the owner, the last Full holder and a read-only dialog", () => {
    for (const e of [direct("a", "FULL", { owner: true, source: "Owner" }), direct("a", "FULL", { lastFull: true })]) {
      expect(canEditEntry(e, false)).toBe(false);
      expect(canRemoveEntry(e, false)).toBe(false);
    }
    expect(canEditEntry(direct("a", "EDIT"), true)).toBe(false);
    expect(canRemoveEntry(direct("a", "EDIT"), true)).toBe(false);
  });
  it("follow the server when it says a row cannot change", () => {
    expect(canEditEntry(direct("a", "EDIT", { editable: false }), false)).toBe(false);
    expect(canRemoveEntry(direct("a", "EDIT", { removable: false }), false)).toBe(false);
  });
});

describe("viaText", () => {
  it("names every source in words the viewer may see", () => {
    expect(viaText(viaFolder)).toBe("from Brand refresh");
    expect(viaText(viaHidden)).toBe("from a place you cannot open");
    expect(viaText(viaEveryone)).toBe("as everyone at Acme");
    expect(viaText(viaAdmin)).toBe("as an admin");
    expect(viaText(viaOwner)).toBe("as the person who made it");
    expect(viaText(viaOlder)).toBe("under the older rule for Private items");
  });
  it("builds the also-line of a direct row per type", () => {
    expect(alsoViaText({ role: "EDIT", via: viaFolder })).toBe("Also Can edit from Brand refresh");
    expect(alsoViaText({ role: "VIEW", via: viaHidden })).toBe("Also Can view from a place you cannot open");
    expect(alsoViaText({ role: "VIEW", via: viaEveryone })).toBe("Also Can view as everyone at Acme");
    expect(alsoViaText({ role: "FULL", via: viaAdmin })).toBe("Also Full access as an admin");
    expect(alsoViaText({ role: "VIEW", via: viaOlder })).toBe("Also Can view under the older rule for Private items");
    expect(alsoViaText({ role: "FULL", via: viaOwner })).toBe("Also Full access as the person who made it");
  });
  it("reads an admin's or the maker's reach as Full access, whatever role rode along", () => {
    expect(alsoViaText({ role: "VIEW", via: viaAdmin })).toBe("Also Full access as an admin");
    expect(alsoViaText({ role: "EDIT", via: viaOwner })).toBe("Also Full access as the person who made it");
  });
  it("heads each inherited group", () => {
    expect(inheritedHeader(viaFolder)).toBe("Access from Brand refresh");
    expect(inheritedHeader(viaHidden)).toBe("Access from a place you cannot open");
    expect(inheritedHeader(viaOlder)).toBe("From Brand refresh, under the older rule for Private items");
    expect(inheritedHeader({ type: "older_rule", from: null })).toBe("Under the older rule for Private items");
    expect(inheritedHeader(viaAdmin)).toBe("Admins at Acme");
    expect(inheritedHeader(viaEveryone)).toBe("Everyone at Acme");
  });
});

describe("removalNotice", () => {
  it("says where a removed person still reaches the node from", () => {
    expect(removalNotice(change({ stillReaches: { role: "VIEW", via: viaSpace } }), "Priya")).toBe("Removed. Priya still has Can view from Design Team.");
    expect(removalNotice(change({ stillReaches: { role: "EDIT", via: viaHidden } }), "Priya")).toBe("Removed. Priya still has Can edit from a place you cannot open.");
  });
  it("adds what they keep inside through their own grants", () => {
    const one = removalNotice(change({ keepsInside: [{ kind: "list", id: "l2", name: "Q3 plan", role: "EDIT" }] }), "Priya");
    expect(one).toBe("Removed Priya. They keep access to 1 thing shared with them directly: Q3 plan.");
    const two = removalNotice(change({
      stillReaches: { role: "VIEW", via: viaSpace },
      keepsInside: [{ kind: "list", id: "l2", name: "Q3 plan", role: "EDIT" }, { kind: "doc", id: "d1", name: "Brief", role: "VIEW" }],
    }), "Priya");
    expect(two).toBe("Removed. Priya still has Can view from Design Team. They keep access to 2 things shared with them directly: Q3 plan, Brief.");
  });
  it("says Already removed when there was nothing to remove", () => {
    expect(removalNotice(change({ noChange: true, previousRole: null }), "Priya")).toBe("Already removed.");
  });
  it("says Removed <name> in the plain case", () => {
    expect(removalNotice(change(), "Priya")).toBe("Removed Priya.");
  });
});

describe("errorText", () => {
  it("has a sentence for every error code on every kind", () => {
    for (const kind of ["space", "folder", "list", "doc", "table", "canvas", "form"] as const) {
      for (const code of ALL_CODES) {
        const t = errorText(code, kind);
        expect(t.length, `${kind} ${code}`).toBeGreaterThan(10);
        expect(t).toMatch(/[.!?]$/);
      }
    }
  });
  it("says a conflict plainly", () => {
    expect(errorText("conflict", "folder")).toBe("Someone else just changed this person's access. Check the list and try again.");
  });
  it("names the bar a doc needs, and Full access elsewhere", () => {
    expect(errorText("forbidden", "doc")).toBe("You need Can edit to change who can open this doc.");
    expect(errorText("forbidden", "folder")).toBe("You need Full access to change who can open this Folder.");
    expect(errorText("forbidden", "table")).toBe("You need Full access to change who can open this table.");
  });
  it("names the kind when grants are not on this server", () => {
    expect(errorText("grants_unavailable", "canvas")).toBe("Adding people to a canvas is not available on this server yet.");
    expect(grantsUnavailableText("form")).toBe("Adding people to a form is not available on this server yet.");
  });
});

describe("strayFailureText", () => {
  it("says who a failed change was for, and what Retry does for a role change", () => {
    const m = GRANT_CONFLICT;
    expect(strayFailureText("Priya", m, "EDIT")).toBe(`Priya: ${m} Retry gives them Can edit.`);
    expect(strayFailureText("Priya", m, null)).toBe(`Priya: ${m}`);
  });
});

describe("generalErrorText", () => {
  const fallback = "Couldn't change who can open this Folder.";
  it("never shows a bare word the route answered with", () => {
    expect(generalErrorText(403, { error: "Forbidden" }, "folder", fallback)).toBe("You need Full access to change who can open this Folder.");
    expect(generalErrorText(403, { error: "Forbidden" }, "doc", fallback)).toBe("You need Can edit to change who can open this doc.");
    expect(generalErrorText(404, { error: "Not found" }, "list", fallback)).toBe("This is not there any more, or you cannot open it.");
    expect(generalErrorText(400, { error: "Invalid body" }, "space", fallback)).toBe(fallback);
    expect(generalErrorText(500, null, "space", fallback)).toBe(fallback);
  });
  it("keeps a sentence the route sends", () => {
    expect(generalErrorText(403, { message: "Only Full access can do that." }, "folder", fallback)).toBe("Only Full access can do that.");
    expect(generalErrorText(400, { error: "You need Full access where this folder is going." }, "folder", fallback)).toBe("You need Full access where this folder is going.");
  });
});

describe("parseGrantError", () => {
  it("reads the route's error body", () => {
    const fresh = panel();
    expect(parseGrantError(409, { error: "conflict", message: "x", panel: fresh })).toEqual({ code: "conflict", panel: fresh });
    expect(parseGrantError(400, { error: "last_full", message: "x" })).toEqual({ code: "last_full", panel: undefined });
  });
  it("falls back on the status when the body is not the route's", () => {
    expect(parseGrantError(409, null).code).toBe("conflict");
    expect(parseGrantError(403, { error: "read-only" }).code).toBe("forbidden");
    expect(parseGrantError(404, "gone").code).toBe("not_found");
    expect(parseGrantError(400, {}).code).toBe("invalid_body");
    expect(parseGrantError(500, {}).code).toBe("server_error");
    expect(parseGrantError(0, null).code).toBe("server_error");
  });
});

describe("everyoneLine and orgWideLine", () => {
  it("says what everyone at the org can do, and from where", () => {
    expect(everyoneLine(panel({ everyone: { role: "VIEW", via: viaEveryone } }))).toBe("Everyone at Acme can view, from Design Team");
    expect(everyoneLine(panel({ everyone: { role: "EDIT", via: { type: "everyone", orgName: "Acme", from: null } } }))).toBe("Everyone at Acme can edit");
    expect(everyoneLine(panel())).toBeNull();
  });
  it("does not name the node itself as where everyone's access comes from", () => {
    const space = panel({
      node: { ...panel().node, kind: "space", noun: "Space", name: "Design Team" },
      everyone: { role: "VIEW", via: viaEveryone },
    });
    expect(everyoneLine(space)).toBe("Everyone at Acme can view");
  });
  it("hints that a role at or below everyone's adds nothing for Members", () => {
    const p = panel({ everyone: { role: "EDIT", via: { type: "everyone", orgName: "Acme", from: null } } });
    expect(everyoneHint(p, "VIEW")).toBe("Everyone at Acme can already edit this, so this role adds nothing for Members.");
    expect(everyoneHint(p, "EDIT")).toBe("Everyone at Acme can already edit this, so this role adds nothing for Members.");
    expect(everyoneHint(p, "FULL")).toBeNull();
    expect(everyoneHint(panel(), "VIEW")).toBeNull();
  });
  it("says a share inside an org-wide Space cannot hide the rest of it", () => {
    const p = panel({ node: { ...panel().node, kind: "folder", noun: "Folder", name: "Brand refresh" }, general: { ...panel().general, orgWideSpace: { id: "s1", name: "Design Team" } } });
    expect(orgWideLine(p)).toBe(
      "Everyone at Acme can already open everything in Design Team. Sharing this Folder adds rights here; it cannot hide the rest of Design Team. To keep people to this Folder, set Design Team to Space members.",
    );
    expect(orgWideLine(panel())).toBeNull();
  });
  it("never shows the org-wide line on the Space itself (its visibility says it)", () => {
    const space = panel({
      node: { ...panel().node, kind: "space", noun: "Space", name: "Design Team" },
      general: { ...panel().general, visibility: "ORG", orgWideSpace: { id: "s1", name: "Design Team" } },
    });
    expect(orgWideLine(space)).toBeNull();
  });
  it("reads the org-wide Space line and the admins line", () => {
    expect(spaceOrgLine("Acme")).toBe("Everyone at Acme can open everything in this Space, including Folders shared with only some people.");
    expect(adminsLine(panel({ admins: { count: 2 } }))).toBe("Admins at Acme have Full access to everything.");
    expect(adminsLine(panel())).toBeNull();
  });
});

describe("the dialog's words", () => {
  it("titles the dialog by what the viewer can do here", () => {
    expect(dialogTitle(panel(), false)).toBe("Manage access");
    expect(dialogTitle(panel(), true)).toBe("Who has access");
    expect(dialogTitle(panel({ viewer: { role: "VIEW", canManage: false, maxGrant: null, isAgent: false } }), false)).toBe("Who has access");
    expect(dialogTitle(null, false)).toBe("Who has access");
    expect(dialogSubtitle(panel())).toBe("List · Launch plan");
  });
  it("renders the write controls only for a manager, never read only or on a note; an Agent manager manages as before", () => {
    expect(canManageHere(panel(), false)).toBe(true);
    expect(canManageHere(panel(), true)).toBe(false);
    expect(canManageHere(null, false)).toBe(false);
    expect(canManageHere(panel({ viewer: { role: "EDIT", canManage: false, maxGrant: null, isAgent: false } }), false)).toBe(false);
    expect(canManageHere(panel({ viewer: { role: "FULL", canManage: true, maxGrant: "FULL", isAgent: true } }), false)).toBe(true);
    expect(canManageHere(panel({ node: { ...panel().node, notepadOwner: person("u", "Priya") } }), false)).toBe(false);
  });
  it("uses capitalised container nouns and plain object nouns in sentences", () => {
    expect(["space", "folder", "list", "doc", "table", "canvas", "form"].map((k) => sentenceNoun(k as never))).toEqual(
      ["Space", "Folder", "List", "doc", "table", "canvas", "form"],
    );
  });
  it("reads a private note, a cap and the last Full holder", () => {
    expect(notepadText(person("u", "Priya"))).toBe("This is Priya's private note. Only they can open it.");
    expect(notepadText(person("u", "Priya"), "someone-else")).toBe("This is Priya's private note. Only they can open it.");
    expect(notepadText(person("u", "Priya"), "u")).toBe("This is your private note. Only you can open it.");
    expect(capText(direct("u", "VIEW", { cap: true, person: person("u", "Priya") }))).toBe("Set before the new sharing: limits Priya to Can view here.");
    expect(LAST_FULL_TEXT).toBe("A Space needs at least one person with Full access.");
  });
  it("asks before a removal, and before lowering your own access", () => {
    expect(removeConfirm("Priya", panel(), false)).toEqual({ title: "Remove Priya from Launch plan?", description: "They lose the access this List gives them." });
    expect(removeConfirm("you", panel({ node: { ...panel().node, kind: "doc", noun: "Doc" } }), true).description).toBe("You will not be able to change who can open this doc any more.");
    expect(SELF_LOWER_CONFIRM("canvas")).toEqual({ title: "Lower your own access?", description: "You will not be able to change who can open this canvas any more." });
  });
  it("points at the Space a canvas's access comes from, only when the viewer can manage it", () => {
    const managed: AccessVia = { ...viaSpace, canManage: true };
    expect(manageableSpaceVia(panel({ inherited: [inherited("a", "EDIT", viaFolder), inherited("b", "EDIT", managed)] }))).toEqual(managed);
    expect(manageableSpaceVia(panel({ inherited: [inherited("b", "EDIT", viaSpace)] }))).toBeNull();
    expect(manageableSpaceVia(panel({ inheritedMore: [{ via: managed, more: 3 }] }))).toEqual(managed);
  });
  it("knows from a via whether the viewer manages an ancestor, and says so when it cannot tell", () => {
    const managed: AccessVia = { ...viaSpace, canManage: true };
    expect(managesViaNode(panel({ inherited: [inherited("a", "EDIT", managed)] }), "space", "s1")).toBe(true);
    expect(managesViaNode(panel({ inherited: [inherited("a", "EDIT", viaSpace)] }), "space", "s1")).toBe(false);
    expect(managesViaNode(panel({ inherited: [inherited("a", "EDIT", viaFolder)] }), "space", "s1")).toBeNull();
    expect(managesViaNode(panel(), "space", "s1")).toBeNull();
  });
  it("notices an older-rule reach anywhere in the panel", () => {
    expect(hasOlderRule(panel())).toBe(false);
    expect(hasOlderRule(panel({ inherited: [inherited("a", "VIEW", viaOlder)] }))).toBe(true);
    expect(hasOlderRule(panel({ direct: [direct("a", "EDIT", { alsoVia: { role: "VIEW", via: viaOlder } })] }))).toBe(true);
    expect(OLDER_RULE_FOOTNOTE).toBe("Private items in this workspace keep today's reach until an admin applies the new rule.");
  });
  it("asks the picker for signed-in people, minus those already listed", () => {
    expect(pickUrl("pri ya", ["a", "b"])).toBe("/api/people/pick?reach=signin&q=pri+ya&limit=20&exclude=a%2Cb");
    expect(pickUrl("", [])).toBe("/api/people/pick?reach=signin&q=&limit=20");
  });
  it("asks before you lower your own access below the manage bar, and only then", () => {
    const me = direct("me", "FULL");
    expect(lowersOwnManage(panel(), me, "EDIT", "me")).toBe(true);
    expect(lowersOwnManage(panel(), me, "EDIT", "someone-else")).toBe(false);
    expect(lowersOwnManage(panel(), me, "FULL", "me")).toBe(false);
    // Still Full through the Space: nothing is lost.
    expect(lowersOwnManage(panel(), direct("me", "FULL", { alsoVia: { role: "FULL", via: viaSpace } }), "VIEW", "me")).toBe(false);
    // A doc's bar is Can edit: going to Can comment loses it, going to Can edit does not.
    const doc = panel({ node: { ...panel().node, kind: "doc", noun: "Doc" } });
    expect(lowersOwnManage(doc, direct("me", "FULL"), "EDIT", "me")).toBe(false);
    expect(lowersOwnManage(doc, direct("me", "EDIT"), "COMMENT", "me")).toBe(true);
  });
});

describe("no double hyphen and no em dash", () => {
  it("in any string the model writes", () => {
    const samples: string[] = [
      FOLDER_RESTRICTED_BLURB, LAST_FULL_TEXT, OLDER_RULE_FOOTNOTE, spaceOrgLine("Acme"),
      grantsUnavailableText("table"), notepadText(person("u", "Priya")),
      ...ALL_CODES.flatMap((c) => (["space", "doc", "form"] as const).map((k) => errorText(c, k))),
      ...[viaFolder, viaHidden, viaEveryone, viaAdmin, viaOwner, viaOlder].flatMap((v) => [viaText(v), inheritedHeader(v), alsoViaText({ role: "VIEW", via: v })]),
      removalNotice(change({ stillReaches: { role: "VIEW", via: viaSpace }, keepsInside: [{ kind: "doc", id: "d", name: "Brief", role: "VIEW" }] }), "Priya"),
      everyoneLine(panel({ everyone: { role: "VIEW", via: viaEveryone } })) ?? "",
      everyoneHint(panel({ everyone: { role: "VIEW", via: viaEveryone } }), "VIEW") ?? "",
      orgWideLine(panel({ general: { ...panel().general, orgWideSpace: { id: "s", name: "Design" } } })) ?? "",
      adminsLine(panel({ admins: { count: 1 } })) ?? "",
      capText(direct("u", "VIEW", { cap: true })),
      removeConfirm("Priya", panel(), false).title, removeConfirm("Priya", panel(), true).description,
      SELF_LOWER_CONFIRM("doc").title, SELF_LOWER_CONFIRM("doc").description,
      dialogTitle(panel(), false), dialogTitle(panel(), true), dialogSubtitle(panel()),
      strayFailureText("Priya", GRANT_CONFLICT, "EDIT"),
      generalErrorText(403, { error: "Forbidden" }, "folder", "Couldn't change who can open this Folder."),
    ];
    for (const s of samples) expect(s, s).not.toMatch(/-{2}|\u2014|\u2013/);
  });
});

describe("Add never lowers (keptHigherText)", () => {
  it("says the person kept the higher role someone else gave them meanwhile", () => {
    expect(keptHigherText(change({ noChange: true, role: "FULL", previousRole: "FULL" }), "Access Two", "VIEW")).toBe("Access Two already has Full access, so it was kept.");
  });
  it("says nothing when the Add did what it asked", () => {
    expect(keptHigherText(change({ noChange: false, role: "VIEW", previousRole: null }), "Access Two", "VIEW")).toBeNull();
    expect(keptHigherText(change({ noChange: true, role: "VIEW", previousRole: "VIEW" }), "Access Two", "VIEW")).toBeNull();
    expect(keptHigherText(change({ noChange: true, role: "VIEW", previousRole: "VIEW" }), "Access Two", "EDIT")).toBeNull();
  });
});

describe("a refusal about the viewer's own access (refusedByOwnAccess)", () => {
  it("is forbidden, not found and above their own role: the panel is fetched again", () => {
    expect(ALL_CODES.filter(refusedByOwnAccess)).toEqual(["not_found", "forbidden", "above_own_role"]);
  });
});

describe("restrictedAboveLine", () => {
  const general = (over: Partial<AccessPanel["general"]>) => ({ ...panel().general, ...over });
  it("names the Restricted Folder above a List that inherits", () => {
    const p = panel({ general: general({ restrictedAbove: { id: "q", name: "Folder Q" } }) });
    expect(restrictedAboveLine(p)).toBe("Folder Q is Restricted, so only people who can open it inherit access to this List.");
  });
  it("is quiet when the node is Restricted itself or nothing above it is", () => {
    expect(restrictedAboveLine(panel({ general: general({ visibility: "PRIVATE", restrictedAbove: { id: "q", name: "Folder Q" } }) }))).toBeNull();
    expect(restrictedAboveLine(panel())).toBeNull();
    const doc = panel({ node: { ...panel().node, kind: "doc" }, general: general({ restricted: true, restrictedAbove: { id: "q", name: "Folder Q" } }) });
    expect(restrictedAboveLine(doc)).toBeNull();
  });
});

describe("restrictDocConfirm", () => {
  const docPanel = (over: Partial<AccessPanel> = {}) =>
    panel({ node: { ...panel().node, kind: "doc", noun: "Doc" }, roles: ["FULL", "EDIT", "COMMENT", "VIEW"], ...over });
  const general = (over: Partial<AccessPanel["general"]>) => ({ ...panel().general, restricted: false, ...over });
  it("warns a manager who reaches the doc only through its place that they lock themselves out", () => {
    const c = restrictDocConfirm(docPanel({ general: general({ viewerKeepsIfRestricted: false }), inherited: [inherited("me", "FULL", viaFolder), inherited("b", "EDIT", viaFolder)] }), "me");
    expect(c?.title).toBe("Restrict this doc and lose your access?");
    expect(c?.description).toContain("1 person who reaches it through where it lives will lose access.");
    expect(c?.description).toContain("you will lose access too");
    expect(c?.confirmLabel).toBe("Restrict and lose access");
    const alone = restrictDocConfirm(docPanel({ general: general({ viewerKeepsIfRestricted: false }) }), "me");
    expect(alone?.description).toBe("You reach it only through where it lives, so you will lose access, and only its owner or an Admin can turn this back. Only the people listed here, the person who made it and Admins keep it.");
  });
  it("counts the others who lose it, and the whole org when everyone opens it", () => {
    const c = restrictDocConfirm(docPanel({ general: general({ viewerKeepsIfRestricted: true }), inherited: [inherited("b", "EDIT", viaFolder)], inheritedMore: [{ via: viaFolder, more: 2 }] }), "me");
    expect(c?.title).toBe("Restrict this doc?");
    expect(c?.description).toContain("3 people who reach it through where it lives will lose access.");
    const org = restrictDocConfirm(docPanel({ general: general({ viewerKeepsIfRestricted: true }), everyone: { role: "EDIT", via: viaEveryone } }), "me");
    expect(org?.description).toContain("Everyone at Acme who is not listed here will lose access.");
  });
  it("asks nothing when nobody loses it, or it is already Restricted", () => {
    expect(restrictDocConfirm(docPanel({ general: general({ viewerKeepsIfRestricted: true }), direct: [direct("b", "EDIT")], inherited: [inherited("b", "EDIT", viaFolder)] }), "me")).toBeNull();
    expect(restrictDocConfirm(docPanel({ general: general({ restricted: true, viewerKeepsIfRestricted: false }) }), "me")).toBeNull();
  });
});
