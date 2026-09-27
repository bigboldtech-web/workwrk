import { describe, expect, it } from "vitest";
import { dashboardMessage } from "./dashboard-messages";

const CODES = [
  "not_dashboard_owner",
  "space_read_only",
  "space_manage_only",
  "version_required",
  "conflict",
  "widget_missing",
  "unknown_widget",
  "duplicate_widget",
  "widget_locked",
  "source_locked",
  "too_many_lists",
  "too_many_rules",
  "overview_exists",
  "overview_pinned",
  "overview_not_archivable",
  "overview_source",
  "invalid_schedule",
  "invalid_recipients",
  "private_view_recipients",
  "target_immutable",
  "needs_database_update",
  "Not found",
  "Invalid body",
];

describe("dashboardMessage", () => {
  it("turns every code the routes answer into a sentence, never the code", () => {
    for (const c of CODES) {
      const msg = dashboardMessage({ error: c }, "FALLBACK");
      expect(msg, c).not.toBe("FALLBACK");
      expect(msg, c).not.toContain(c.includes("_") ? c : "\u0000");
      expect(msg.endsWith("."), c).toBe(true);
      expect(msg, c).not.toMatch(/\u2014|--/);
    }
  });
  it("reads the reason of a no_access refusal before its generic code", () => {
    expect(dashboardMessage({ error: "no_access", reason: "space_manage_only" }, "x")).toBe(
      "Only this Space's owners and admins can change its Overview widgets.",
    );
    expect(dashboardMessage({ error: "no_access", reason: "not_dashboard_owner" }, "x")).toContain("made this dashboard");
  });
  it("falls back to the item routes' table, then to the caller's sentence", () => {
    expect(dashboardMessage({ error: "no_access", reason: "list_read_only" }, "x")).toBe("You can read this List but not change what's in it.");
    expect(dashboardMessage({ error: "no_access" }, "x")).toBe("You don't have permission to do that.");
    expect(dashboardMessage({ error: "some_new_code" }, "Couldn't save.")).toBe("Couldn't save.");
    expect(dashboardMessage(null, "Couldn't save.")).toBe("Couldn't save.");
    expect(dashboardMessage("oops", "Couldn't save.")).toBe("Couldn't save.");
  });
});
