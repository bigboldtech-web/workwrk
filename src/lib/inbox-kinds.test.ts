import { describe, it, expect } from "vitest";
import {
  KINDS,
  TYPE_ALIASES,
  FILTER_GROUPS,
  INBOX_TABS,
  fallbackKind,
  isMentionType,
  kindFor,
  mentionTypes,
  normaliseNotificationType,
  parseTab,
  tabFor,
  typesForFilterGroup,
  typesForTab,
} from "./inbox-kinds";

describe("normaliseNotificationType", () => {
  it("lowercases the four SCREAMING_CASE types the app writes", () => {
    expect(normaliseNotificationType("KUDOS")).toBe("kudos");
    expect(normaliseNotificationType("SURVEY")).toBe("survey");
    expect(normaliseNotificationType("REVIEW")).toBe("review");
    expect(normaliseNotificationType("POLICY")).toBe("policy");
  });

  it("maps the two-word uppercase forms to their underscore kind", () => {
    expect(normaliseNotificationType("TASK_ESCALATED")).toBe("task_escalated");
    expect(normaliseNotificationType("SOP")).toBe("sop");
  });

  it("maps the dotted access forms onto the underscore kinds", () => {
    expect(normaliseNotificationType("access.request")).toBe("access_request");
    expect(normaliseNotificationType("access.granted")).toBe("access_granted");
    expect(normaliseNotificationType("access.expiring")).toBe("access_expiring");
  });

  it("leaves an already canonical type alone", () => {
    expect(normaliseNotificationType("task_assigned")).toBe("task_assigned");
  });

  it("answers empty string for null, undefined and whitespace", () => {
    expect(normaliseNotificationType(null)).toBe("");
    expect(normaliseNotificationType(undefined)).toBe("");
    expect(normaliseNotificationType("   ")).toBe("");
  });
});

describe("kindFor", () => {
  it("is total: an unknown type still gets words, never a bare bell", () => {
    const kind = kindFor("some_automation_type");
    expect(kind.label).toBe("Some automation type");
    expect(kind.icon).toBe("Bell");
    expect(kind.tab).toBe("other");
  });

  it("routes a null type to a named fallback rather than throwing", () => {
    expect(kindFor(null).label).toBe("Notification");
  });

  it("resolves an alias to its real row, not the fallback", () => {
    expect(kindFor("KUDOS")).toBe(KINDS.kudos);
    expect(kindFor("kudos").label).toBe("Kudos");
  });

  it("gives every row user words: no snake_case label survives", () => {
    for (const kind of Object.values(KINDS)) {
      expect(kind.label).not.toMatch(/_/);
      expect(kind.label[0]).toBe(kind.label[0].toUpperCase());
    }
  });

  it("keys every row by its own normalised type", () => {
    for (const [key, kind] of Object.entries(KINDS)) {
      expect(kind.type).toBe(key);
      expect(normaliseNotificationType(key)).toBe(key);
    }
  });
});

describe("fallbackKind", () => {
  it("turns dots, dashes and underscores into words", () => {
    expect(fallbackKind("po.status-changed_now").label).toBe("Po status changed now");
  });
});

describe("tabs", () => {
  it("puts the task and people kinds in Primary", () => {
    expect(tabFor("task_assigned")).toBe("primary");
    expect(tabFor("mention")).toBe("primary");
    expect(tabFor("reminder")).toBe("primary");
    expect(tabFor("kpi_score_due")).toBe("primary");
  });

  it("puts the read-later kinds in Other", () => {
    expect(tabFor("kudos")).toBe("other");
    expect(tabFor("announcement")).toBe("other");
    expect(tabFor("task_status_changed")).toBe("other");
    expect(tabFor("chat_message")).toBe("other");
  });

  it("every kind lands in exactly one of the two unread tabs", () => {
    const primary = new Set(typesForTab("primary"));
    const other = new Set(typesForTab("other"));
    for (const type of Object.keys(KINDS)) {
      expect(primary.has(type) !== other.has(type)).toBe(true);
    }
    // The lists also carry every alias spelling of a routed kind, so a row
    // stored under the dotted form is queried into the same tab.
    const aliasCount = Object.entries(TYPE_ALIASES).filter(([, target]) => target in KINDS).length;
    expect(primary.size + other.size).toBe(Object.keys(KINDS).length + aliasCount);
    expect(primary.has("run.assigned")).toBe(true);
    expect(other.has("run.assigned")).toBe(false);
  });

  it("mention is the only kind that is also in the Mentions tab", () => {
    expect(mentionTypes()).toEqual(["mention"]);
    expect(isMentionType("mention")).toBe(true);
    expect(isMentionType("task_comment")).toBe(false);
  });
});

describe("parseTab", () => {
  it("defaults to primary for anything it does not know", () => {
    expect(parseTab(null)).toBe("primary");
    expect(parseTab("")).toBe("primary");
    expect(parseTab("nonsense")).toBe("primary");
  });

  it("accepts every declared tab", () => {
    for (const t of INBOX_TABS) expect(parseTab(t.key)).toBe(t.key);
  });

  it("keeps the old ?tab=later links working on the renamed Snoozed tab", () => {
    expect(parseTab("later")).toBe("snoozed");
  });
});

describe("filter groups", () => {
  it("every kind belongs to a declared Filter row", () => {
    const declared = new Set(FILTER_GROUPS.map((g) => g.key));
    for (const kind of Object.values(KINDS)) {
      expect(declared.has(kind.filterGroup)).toBe(true);
    }
  });

  it("every declared Filter row has at least one kind behind it", () => {
    for (const group of FILTER_GROUPS) {
      expect(typesForFilterGroup(group.key).length).toBeGreaterThan(0);
    }
  });
});

describe("the phantom kinds are gone", () => {
  it("does not map `approval`, which nothing in the app ever writes", () => {
    // The old TYPE_VISUAL map routed `approval` into Primary. No writer exists,
    // so the row could never appear; boundary_request is the real one.
    expect(KINDS.approval).toBeUndefined();
    expect(KINDS.boundary_request).toBeDefined();
  });
});

describe("aliases", () => {
  it("every alias points at a real row", () => {
    for (const target of Object.values(TYPE_ALIASES)) {
      expect(KINDS[target]).toBeDefined();
    }
  });
});
