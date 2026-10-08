import { describe, it, expect } from "vitest";
import {
  TARGET_NOUN,
  UNREADABLE_SENTENCE,
  notificationTarget,
  parseNotificationLink,
  resolveLegacyItemParam,
} from "./notification-target";

describe("parseNotificationLink", () => {
  it("reads a task link", () => {
    expect(parseNotificationLink("/item/abc123")).toMatchObject({ kind: "item", id: "abc123", href: "/item/abc123" });
  });

  // AI teammates Phase 3, review of step 2: a Google connection notice names
  // its workspace in ?ws=, and still opens the Connections card itself.
  it("keeps a connection notice's workspace and anchor in its href", () => {
    expect(parseNotificationLink("/account/connections?ws=org1#ai-google")).toMatchObject({
      kind: "external",
      href: "/account/connections?ws=org1#ai-google",
    });
  });

  it("reads every route prefix the app writes into a link", () => {
    const cases: Array<[string, string, string | null]> = [
      ["/boards/q4-leads", "board", "q4-leads"],
      ["/spaces/design", "space", "design"],
      ["/folders/f1", "folder", "f1"],
      ["/docs/d1", "doc", "d1"],
      ["/sops/s1", "sop", "s1"],
      ["/okrs/o1", "okr", "o1"],
      ["/people/u1", "person", "u1"],
      ["/surveys/sv1", "survey", "sv1"],
      ["/reviews/r1", "review", "r1"],
      ["/policies/p1", "policy", "p1"],
      ["/meetings/m1", "meeting", "m1"],
      ["/tlk/c1", "talk", "c1"],
    ];
    for (const [href, kind, id] of cases) {
      expect(parseNotificationLink(href), href).toMatchObject({ kind, id });
    }
  });

  it("does not let /kra-kpi lose to a shorter prefix", () => {
    expect(parseNotificationLink("/kra-kpi?kra=abc")).toMatchObject({ kind: "kra", id: null });
  });

  it("reads an AI teammate's request by the ?action= its card is opened with", () => {
    expect(parseNotificationLink("/agents?chat=t-planner-abc123&action=act1")).toMatchObject({
      kind: "agent",
      id: "act1",
      href: "/agents?chat=t-planner-abc123&action=act1",
    });
    // A paused routine links to the chat's settings: the page, no request.
    expect(parseNotificationLink("/agents?chat=planner&settings=routines")).toMatchObject({ kind: "agent", id: null });
    expect(parseNotificationLink("/agents")).toMatchObject({ kind: "agent", id: null });
    expect(TARGET_NOUN.agent).toBe("chat");
  });

  it("keeps the query string on the href but never in the id", () => {
    const t = parseNotificationLink("/item/abc?tab=comments");
    expect(t.id).toBe("abc");
    expect(t.href).toBe("/item/abc?tab=comments");
  });

  it("pulls a block anchor out of a doc mention link", () => {
    const t = parseNotificationLink("/docs/d1#b-block9");
    expect(t).toMatchObject({ kind: "doc", id: "d1", anchor: "block9", anchorIsComment: false });
  });

  it("pulls a comment anchor out of a task link and flags it", () => {
    const t = parseNotificationLink("/item/abc#c-42");
    expect(t).toMatchObject({ kind: "item", id: "abc", anchor: "42", anchorIsComment: true });
  });

  it("reads the ?comment= form, which is what task comments actually write", () => {
    // lib/notify-item.ts and the item comment route both write this shape. A
    // parser that only knew the hash form would open every comment
    // notification at the top of the task instead of at the comment.
    const t = parseNotificationLink("/item/abc?comment=u9");
    expect(t).toMatchObject({ kind: "item", id: "abc", anchor: "u9", anchorIsComment: true });
  });

  it("does not mistake another query parameter for a comment anchor", () => {
    expect(parseNotificationLink("/item/abc?tab=comments").anchorIsComment).toBe(false);
  });

  it("parses an absolute URL by its path", () => {
    expect(parseNotificationLink("https://app.workwrk.com/item/abc")).toMatchObject({ kind: "item", id: "abc" });
  });

  it("is none for an empty, null or undefined link", () => {
    for (const v of ["", "   ", null, undefined]) {
      expect(parseNotificationLink(v as string | null)).toMatchObject({ kind: "none", href: null });
    }
  });

  it("keeps an unrecognised path openable rather than dropping it", () => {
    const t = parseNotificationLink("/timesheets/t1");
    expect(t.kind).toBe("external");
    expect(t.href).toBe("/timesheets/t1");
  });

  it("never throws on a malformed absolute URL", () => {
    const t = parseNotificationLink("https://");
    expect(t.kind).toBe("external");
  });

  it("treats a protocol-relative or scheme-less string as external, not a path", () => {
    expect(parseNotificationLink("mailto:a@b.com").kind).toBe("external");
  });
});

describe("every object address is its object", () => {
  it("reads the Work door and the Space-scoped address as the object, never the Space", () => {
    expect(parseNotificationLink("/work/docs/d1")).toMatchObject({ kind: "doc", id: "d1", href: "/work/docs/d1" });
    expect(parseNotificationLink("/work/sops/s1")).toMatchObject({ kind: "sop", id: "s1" });
    expect(parseNotificationLink("/spaces/design-team/docs/d1")).toMatchObject({ kind: "doc", id: "d1" });
    expect(parseNotificationLink("/work/canvas/c1")).toMatchObject({ kind: "canvas", id: "c1" });
    expect(parseNotificationLink("/work/tables/t1")).toMatchObject({ kind: "table", id: "t1" });
    expect(parseNotificationLink("/work/forms/f1")).toMatchObject({ kind: "form", id: "f1" });
  });

  it("keeps a Space address a Space", () => {
    expect(parseNotificationLink("/spaces/cmabc")).toMatchObject({ kind: "space", id: "cmabc" });
    expect(parseNotificationLink("/spaces/design-team")).toMatchObject({ kind: "space", id: "design-team" });
  });

  it("reads the canonical table, canvas and form addresses", () => {
    expect(parseNotificationLink("/tables/t1")).toMatchObject({ kind: "table", id: "t1" });
    expect(parseNotificationLink("/canvas/c1")).toMatchObject({ kind: "canvas", id: "c1" });
    expect(parseNotificationLink("/forms/f1?tab=responses")).toMatchObject({ kind: "form", id: "f1", href: "/forms/f1?tab=responses" });
    expect(parseNotificationLink("/work/forms/f1?tab=responses")).toMatchObject({ kind: "form", id: "f1" });
  });

  it("leaves the public form responder external", () => {
    expect(parseNotificationLink("/forms/f1/respond")).toMatchObject({ kind: "external", href: "/forms/f1/respond" });
  });

  it("keeps anchors and ?comment on the new forms", () => {
    expect(parseNotificationLink("/work/docs/d1#b-block9")).toMatchObject({ kind: "doc", id: "d1", anchor: "block9", anchorIsComment: false });
    expect(parseNotificationLink("/spaces/s/docs/d1#c-7")).toMatchObject({ kind: "doc", id: "d1", anchor: "7", anchorIsComment: true });
    expect(parseNotificationLink("/work/docs/d1?comment=u9")).toMatchObject({ kind: "doc", id: "d1", anchor: "u9", anchorIsComment: true });
    expect(parseNotificationLink("https://app.workwrk.com/work/docs/d1")).toMatchObject({ kind: "doc", id: "d1" });
  });

  it("has a noun for the new kinds", () => {
    expect(TARGET_NOUN.table).toBe("table");
    expect(TARGET_NOUN.canvas).toBe("canvas");
    expect(TARGET_NOUN.form).toBe("form");
  });
});

describe("resolveLegacyItemParam", () => {
  it("resolves the old ?item= drawer form to the one task URL", () => {
    expect(resolveLegacyItemParam("/boards/q4-leads?item=abc")).toMatchObject({
      kind: "item",
      id: "abc",
      href: "/item/abc",
    });
  });

  it("ignores a link with no item param", () => {
    expect(resolveLegacyItemParam("/boards/q4-leads?view=board")).toBeNull();
    expect(resolveLegacyItemParam("/item/abc")).toBeNull();
    expect(resolveLegacyItemParam(null)).toBeNull();
  });

  it("decodes the id", () => {
    expect(resolveLegacyItemParam("/boards/x?item=a%2Fb")?.id).toBe("a/b");
  });
});

describe("notificationTarget", () => {
  it("prefers the legacy item param so both link shapes reach one task URL", () => {
    expect(notificationTarget("/boards/q4?item=abc").href).toBe("/item/abc");
    expect(notificationTarget("/item/abc").href).toBe("/item/abc");
  });
});

describe("the words the pane prints", () => {
  it("names all three unreadable cases in user words, with no jargon", () => {
    expect(Object.keys(UNREADABLE_SENTENCE).sort()).toEqual(["deleted", "moved", "no_access"]);
    for (const sentence of Object.values(UNREADABLE_SENTENCE)) {
      expect(sentence).not.toMatch(/_/);
      expect(sentence.length).toBeGreaterThan(8);
    }
  });

  it("has a noun for every kind, and none for the two that have no object", () => {
    expect(TARGET_NOUN.item).toBe("task");
    expect(TARGET_NOUN.external).toBe("");
    expect(TARGET_NOUN.none).toBe("");
  });
});
