import { describe, expect, it } from "vitest";
import {
  ACTIVITY_FAMILY_LABEL,
  FALLBACK_TARGET,
  familiesOf,
  familyFor,
  normaliseTargetType,
  targetFor,
  targetHref,
  typesInFamily,
  verbFor,
} from "./activity-targets";

/**
 * Every distinct `targetType` string written anywhere in src, collected with
 *   grep -rn 'targetType:' src | grep -o 'targetType: *"[^"]*"' | sort -u
 * plus the four rows the local database already holds ("KRA", "sop", "okr",
 * "task", "ReviewCycle", "Policy", "user"). This is the list the old
 * ten-entry TARGET_VISUAL map was measured against and failed.
 */
const WRITTEN = [
  "Announcement", "Asset", "DOC", "DataTable", "FILE", "FormDefinition", "GlAccount",
  "Invitation", "JournalEntry", "KRA", "NOTE", "Organization", "OwnershipArea", "Policy",
  "ReviewCycle", "SOP", "TABLE", "TASK", "USER", "Vendor", "WHITEBOARD",
  "accounting-period", "api_key", "appsumo_code", "budget_plan", "export", "fiscal_year",
  "identity_provider", "invoice", "meeting", "office", "okr", "organization", "process_run",
  "purchase_order", "review_cycle", "scim_token", "sop", "talent_assessment", "task",
  "timesheet", "tool", "user", "webhook_subscription", "workflow",
] as const;

describe("normaliseTargetType", () => {
  it("collapses the four casings the app writes into one key", () => {
    expect(normaliseTargetType("TASK")).toBe("task");
    expect(normaliseTargetType("task")).toBe("task");
    expect(normaliseTargetType("ReviewCycle")).toBe("review_cycle");
    expect(normaliseTargetType("review_cycle")).toBe("review_cycle");
    expect(normaliseTargetType("accounting-period")).toBe("accounting_period");
    expect(normaliseTargetType("DataTable")).toBe("data_table");
    expect(normaliseTargetType("FormDefinition")).toBe("form_definition");
  });

  it("is empty for a null or blank type rather than throwing", () => {
    expect(normaliseTargetType(null)).toBe("");
    expect(normaliseTargetType("  ")).toBe("");
  });
});

describe("the target table covers what the app writes", () => {
  it("has a row for every targetType string written anywhere in src", () => {
    const missing = WRITTEN.filter((t) => targetFor(t) === FALLBACK_TARGET);
    expect(missing, `unmapped targetTypes: ${missing.join(", ")}`).toEqual([]);
  });

  it("renders an unknown type rather than hiding the row", () => {
    const def = targetFor("some_future_thing");
    expect(def).toBe(FALLBACK_TARGET);
    expect(def.family).toBe("other");
    expect(ACTIVITY_FAMILY_LABEL[def.family]).toBe("Other");
  });

  it("gives every family a label", () => {
    for (const t of WRITTEN) {
      expect(ACTIVITY_FAMILY_LABEL[familyFor(t)]).toBeTruthy();
    }
  });
});

describe("targetHref", () => {
  it("sends a task to /item/[id], never to the dead /tasks?id=", () => {
    expect(targetHref("task", "i1")).toBe("/item/i1");
    expect(targetHref("TASK", "i1")).toBe("/item/i1");
    expect(targetHref("task", "i1")).not.toContain("/tasks?");
  });

  it("links the families that have a page", () => {
    expect(targetHref("sop", "s1")).toBe("/sops/s1");
    expect(targetHref("SOP", "s1")).toBe("/sops/s1");
    expect(targetHref("okr", "o1")).toBe("/okrs/o1");
    expect(targetHref("KRA", "k1")).toBe("/kra-kpi?kra=k1");
    expect(targetHref("user", "u1")).toBe("/people/u1");
    expect(targetHref("folder", "f1")).toBe("/folders/f1");
    expect(targetHref("DOC", "d1")).toBe("/docs/d1");
    expect(targetHref("WHITEBOARD", "w1")).toBe("/canvas/w1");
    expect(targetHref("kudos", "anything")).toBe("/kudos");
  });

  it("renders a Space as text, because /spaces/[slug] cannot take an id", () => {
    // ActivityLog stores an ID in targetId, and /spaces/[slug] is a SLUG
    // route with no id door (unlike /boards/[slug], which 308s an id to its
    // slug). A link here would be guaranteed to render the in-shell 404 the
    // first time a writer emits targetType "space", so the chip is plain text.
    expect(targetHref("space", "design")).toBeNull();
    expect(targetHref("space", "cmsfz98mz0000p3xp51wy97id")).toBeNull();
  });

  it("returns null rather than a broken link when there is no id", () => {
    expect(targetHref("task", null)).toBeNull();
    expect(targetHref("task", "")).toBeNull();
  });

  it("returns null when the viewer can no longer read the target", () => {
    expect(targetHref("task", "i1", false)).toBeNull();
  });

  it("returns null for the families that genuinely have no page", () => {
    expect(targetHref("organization", "o1")).toBeNull();
    expect(targetHref("invoice", "i1")).toBeNull();
    expect(targetHref("api_key", "k1")).toBeNull();
  });
});

describe("families", () => {
  it("lists the families present, in a fixed order, with no duplicates", () => {
    expect(familiesOf(["task", "TASK", "sop", "okr", "user"])).toEqual([
      "tasks", "sops", "goals", "people",
    ]);
  });

  it("collects every stored spelling a family covers, for the query filter", () => {
    expect(typesInFamily("tasks", ["task", "TASK", "item", "sop"]).sort()).toEqual(["TASK", "item", "task"]);
  });

  it("is empty for no rows", () => {
    expect(familiesOf([])).toEqual([]);
  });
});

describe("verbFor", () => {
  it("turns the stored type into the word a person would say", () => {
    expect(verbFor("okr_created")).toBe("created");
    expect(verbFor("kra.create")).toBe("created");
    expect(verbFor("policy.publish")).toBe("published");
    expect(verbFor("user_removed")).toBe("removed");
    expect(verbFor("task_created")).toBe("created");
    expect(verbFor("login")).toBe("signed in");
  });

  it("falls back to the tail of the type rather than to nothing", () => {
    expect(verbFor("widget_frobnicated")).toBe("frobnicated");
  });

  it("says something for an empty type", () => {
    expect(verbFor(null)).toBe("did something");
    expect(verbFor("")).toBe("did something");
  });
});
