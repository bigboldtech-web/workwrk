import { describe, expect, it } from "vitest";
import { settingsShellGroups } from "./settings-shell-groups";

const labels = (door: "me" | "workspace", admin: boolean) =>
  settingsShellGroups(door, admin).map((g) => ({ label: g.label ?? null, rule: !!g.ruleAbove, rows: g.rows.map((r) => r.label) }));

describe("settingsShellGroups", () => {
  it("draws the Workspace door for Owners and Admins, in the spec's order, all fifteen rows (sidebar-map 8a)", () => {
    expect(labels("workspace", true)).toEqual([
      { label: null, rule: false, rows: ["Overview"] },
      { label: "Workspace", rule: false, rows: ["Identity & culture", "Locale & work week", "Apps & modules"] },
      { label: "People", rule: false, rows: ["Members", "Structure", "Access"] },
      { label: "Work", rule: false, rows: ["Task system", "Scoring & reviews"] },
      { label: "Security & data", rule: false, rows: ["Security", "Data", "Audit log", "API & webhooks"] },
      { label: "Billing", rule: false, rows: ["Plan & billing"] },
      { label: null, rule: true, rows: ["All settings"] },
    ]);
  });
  it("never shows the Workspace list to anyone else, even on a Workspace URL", () => {
    expect(labels("workspace", false)).toEqual(labels("me", false));
  });
  it("draws My settings as seven flat rows, and adds the Workspace settings row under a rule for admins only", () => {
    const me = ["Profile", "Preferences", "Notifications", "Security", "Calendar & connections", "Keyboard shortcuts", "All settings"];
    expect(labels("me", false)).toEqual([{ label: null, rule: false, rows: me }]);
    expect(labels("me", true)).toEqual([
      { label: null, rule: false, rows: me },
      { label: null, rule: true, rows: ["Workspace settings"] },
    ]);
    const cross = settingsShellGroups("me", true)[1].rows[0];
    expect(cross).toMatchObject({ href: "/settings", pageKey: null });
  });
  it("points every row at its canonical URL", () => {
    for (const g of settingsShellGroups("workspace", true)) for (const r of g.rows) expect(r.href.startsWith("/settings")).toBe(true);
    for (const r of settingsShellGroups("me", false)[0].rows) expect(r.href.startsWith("/account/")).toBe(true);
  });
});
