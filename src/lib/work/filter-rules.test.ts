import { describe, expect, it } from "vitest";
import type { BoardItemRow } from "../board-items-shared";
import type { RowColorRule } from "../list-comfort";
import { matchesRule, rowAssigneeIds, rowColorFor, ruleActive, type FilterRule } from "./filter-rules";

// Local dates on purpose: matchesRule compares due days in the RUNTIME's zone
// when no zone is given, and this suite runs under TZ=UTC in CI and anywhere
// on a laptop, so every instant is built from local wall-clock parts.
function localDue(y: number, m: number, d: number, h = 10): Date {
  return new Date(y, m - 1, d, h, 0, 0, 0);
}

function row(over: Partial<BoardItemRow> = {}): BoardItemRow {
  return {
    id: "r1",
    title: "Quarterly report",
    status: "TO_DO",
    ownerId: "u1",
    assigneeIds: ["u1", "u2"],
    groupKey: null,
    position: 1,
    metadata: { team: "Design", size: "l" },
    dueAt: localDue(2026, 9, 24),
    priority: "HIGH",
    itemTypeId: "type-bug",
    tags: [{ id: "tag-a", name: "Alpha", color: null }],
    archivedAt: null,
    createdAt: new Date(0),
    updatedAt: new Date(0),
    ...over,
  };
}

const rule = (field: string, operator: FilterRule["operator"], value = ""): FilterRule => ({ id: `${field}-${operator}`, field, operator, value });

describe("matchesRule (moved verbatim from board-filter-bar.tsx)", () => {
  it("reads due on, before and after as whole local days", () => {
    const r = row();
    expect(matchesRule(r, rule("due", "on", "2026-09-24"))).toBe(true);
    expect(matchesRule(r, rule("due", "on", "2026-09-23"))).toBe(false);
    expect(matchesRule(r, rule("due", "before", "2026-09-25"))).toBe(true);
    expect(matchesRule(r, rule("due", "before", "2026-09-24"))).toBe(false);
    expect(matchesRule(r, rule("due", "after", "2026-09-23"))).toBe(true);
    // "after the 24th" means after the END of the 24th.
    expect(matchesRule(r, rule("due", "after", "2026-09-24"))).toBe(false);
    expect(matchesRule(r, rule("due", "isSet"))).toBe(true);
    expect(matchesRule(row({ dueAt: null }), rule("due", "isNotSet"))).toBe(true);
    expect(matchesRule(row({ dueAt: null }), rule("due", "on", "2026-09-24"))).toBe(false);
    // An unparsable value filters nothing out.
    expect(matchesRule(r, rule("due", "on", "not-a-date"))).toBe(true);
  });

  it("reads a midnight due date as its own day, never the previous one", () => {
    const midnight = row({ dueAt: localDue(2026, 9, 24, 0) });
    expect(matchesRule(midnight, rule("due", "on", "2026-09-24"))).toBe(true);
    expect(matchesRule(midnight, rule("due", "on", "2026-09-23"))).toBe(false);
  });

  it("matches the whole assignee set, not just the primary", () => {
    const r = row({ ownerId: "u1", assigneeIds: ["u1", "u2"] });
    expect(matchesRule(r, rule("assignee", "is", "u2"))).toBe(true);
    expect(matchesRule(r, rule("assignee", "isNot", "u2"))).toBe(false);
    expect(matchesRule(r, rule("assignee", "is", "u3"))).toBe(false);
    expect(matchesRule(row({ ownerId: null, assigneeIds: [] }), rule("assignee", "isNotSet"))).toBe(true);
    expect(rowAssigneeIds(row({ ownerId: "u9", assigneeIds: ["u1"], assignees: [{ id: "u5", firstName: "", lastName: "", avatar: null }] })).sort()).toEqual(["u1", "u5", "u9"]);
  });

  it("matches tags by id", () => {
    expect(matchesRule(row(), rule("tags", "is", "tag-a"))).toBe(true);
    expect(matchesRule(row(), rule("tags", "isNot", "tag-a"))).toBe(false);
    expect(matchesRule(row({ tags: [] }), rule("tags", "isNotSet"))).toBe(true);
  });

  it("reads custom fields as text for contains and is", () => {
    expect(matchesRule(row(), rule("team", "contains", "sig"))).toBe(true);
    expect(matchesRule(row(), rule("team", "is", "design"))).toBe(true);
    expect(matchesRule(row(), rule("team", "is", "Des"))).toBe(false);
    expect(matchesRule(row(), rule("team", "isNot", "Ops"))).toBe(true);
    expect(matchesRule(row(), rule("missing", "isNotSet"))).toBe(true);
    expect(matchesRule(row(), rule("title", "contains", "REPORT"))).toBe(true);
    expect(matchesRule(row(), rule("status", "is", "to_do"))).toBe(true);
    expect(matchesRule(row(), rule("priority", "is", "HIGH"))).toBe(true);
    expect(matchesRule(row(), rule("type", "is", "type-bug"))).toBe(true);
  });

  // An older List may hold a custom field keyed "status" or "due" beside the
  // built-ins; its rule names it "field:status" (field-keys.ts ruleFieldIdOf).
  it("reads a field keyed like a built-in from the field, and the built-in from the task", () => {
    const r = row({ metadata: { status: "Blocked on vendor", due: "2027-01-01" } });
    expect(matchesRule(r, rule("field:status", "is", "blocked on vendor"))).toBe(true);
    expect(matchesRule(r, rule("field:status", "is", "to_do"))).toBe(false);
    expect(matchesRule(r, rule("status", "is", "to_do"))).toBe(true);
    expect(matchesRule(r, rule("status", "is", "blocked on vendor"))).toBe(false);
    expect(matchesRule(r, rule("field:due", "contains", "2027"))).toBe(true);
    expect(matchesRule(row({ metadata: {} }), rule("field:status", "isNotSet"))).toBe(true);
  });
});

describe("ruleActive", () => {
  it("needs a value except for set and not set", () => {
    expect(ruleActive(rule("status", "is", ""))).toBe(false);
    expect(ruleActive(rule("status", "is", "  "))).toBe(false);
    expect(ruleActive(rule("status", "isSet"))).toBe(true);
    expect(ruleActive(rule("status", "is", "DONE"))).toBe(true);
  });
});

describe("rowColorFor", () => {
  const colour = (id: string, field: string, operator: RowColorRule["operator"], value: string, color: RowColorRule["color"]): RowColorRule => ({ id, field, operator, value, color });

  it("returns null with no rules", () => {
    expect(rowColorFor(row(), [])).toBeNull();
  });

  it("returns the first matching active rule's colour", () => {
    const rules = [
      colour("1", "priority", "is", "URGENT", "red"),
      colour("2", "priority", "is", "HIGH", "orange"),
      colour("3", "team", "contains", "Des", "blue"),
    ];
    expect(rowColorFor(row(), rules)).toBe("orange");
    expect(rowColorFor(row({ priority: "URGENT" }), rules)).toBe("red");
    expect(rowColorFor(row({ priority: null }), rules)).toBe("blue");
    expect(rowColorFor(row({ priority: null, metadata: {} }), rules)).toBeNull();
  });

  it("skips an incomplete rule rather than matching everything", () => {
    // "team is <nothing>" would match an empty team; unfinished, it must not
    // colour anything.
    const rules = [colour("1", "missing", "is", "", "red"), colour("2", "priority", "is", "HIGH", "green")];
    expect(rowColorFor(row(), rules)).toBe("green");
  });

  it("evaluates a linked row's status through the supplied statusOf", () => {
    const linked = row({ status: "SHIPPED" });
    const rules = [colour("1", "status", "is", "DONE", "green")];
    expect(rowColorFor(linked, rules)).toBeNull();
    expect(rowColorFor(linked, rules, () => "DONE")).toBe("green");
  });
});
