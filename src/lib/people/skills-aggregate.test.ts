import { describe, expect, it } from "vitest";
import { cleanSkillName, isRating, ratingLabel, summariseSkills } from "./skills-aggregate";

const rows = [
  { id: "1", name: "Figma", userId: "me", selfRating: 4, managerRating: null },
  { id: "2", name: "figma ", userId: "report", selfRating: 2, managerRating: 2 },
  { id: "3", name: "Figma", userId: "stranger", selfRating: 5, managerRating: 5 },
  { id: "4", name: "SQL", userId: "stranger", selfRating: 5, managerRating: 5 },
];

describe("summariseSkills", () => {
  const visible = new Set(["me", "report"]);
  const s = summariseSkills(rows, (id) => visible.has(id));
  const figma = s.find((x) => x.name === "Figma")!;
  const sql = s.find((x) => x.name === "SQL")!;

  it("counts every holder but averages only the visible ones", () => {
    expect(figma.holders).toBe(3);
    expect(figma.avgSelf).toBe(3);
    // One visible manager rating: divided by 1, not by all three holders.
    expect(figma.avgManager).toBe(2);
  });
  it("never leaks a stranger's rating", () => {
    const stranger = figma.people.find((p) => p.userId === "stranger")!;
    expect(stranger.selfRating).toBeNull();
    expect(stranger.managerRating).toBeNull();
    expect(sql.avgSelf).toBeNull();
    expect(sql.expert).toBe(false);
    expect(sql.gap).toBe(false);
  });
  it("marks Expert when a visible holder is at 4 or more, and never both chips", () => {
    expect(figma.expert).toBe(true);
    expect(figma.gap).toBe(false);
  });
  it("marks a Gap when nobody visible is at 4 or more", () => {
    const g = summariseSkills([{ id: "9", name: "Go", userId: "me", selfRating: 2, managerRating: null }], () => true)[0];
    expect(g.gap).toBe(true);
  });
});

describe("rating helpers", () => {
  it("labels 1 to 5 and keeps a legacy 10-scale value on its own scale", () => {
    expect(ratingLabel(4)).toBe("4/5");
    expect(ratingLabel(8)).toBe("8/10");
    expect(ratingLabel(0)).toBeNull();
  });
  it("validates names and ratings", () => {
    expect(cleanSkillName("  Data   modelling ")).toBe("Data modelling");
    expect(cleanSkillName("")).toBeNull();
    expect(cleanSkillName("x".repeat(61))).toBeNull();
    expect(isRating(3)).toBe(true);
    expect(isRating(6)).toBe(false);
    expect(isRating(2.5)).toBe(false);
  });
});
