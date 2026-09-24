import { describe, expect, it } from "vitest";
import { INTAKE_TEMPLATES, INTAKE_TEMPLATE_BY_ID } from "./intake-templates";
import { isQuestion, readFormFields, WENT_KEY } from "./fields";
import { isChoiceType } from "./builder";

describe("intake form templates", () => {
  it("has unique template ids, each findable by id", () => {
    const ids = INTAKE_TEMPLATES.map((t) => t.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const id of ids) expect(INTAKE_TEMPLATE_BY_ID.get(id)?.id).toBe(id);
  });
  for (const t of INTAKE_TEMPLATES) {
    it(`${t.name}: fields are well formed and survive the stored shape`, () => {
      const ids = t.fields.map((f) => f.id);
      expect(new Set(ids).size).toBe(ids.length);
      expect(ids.some((id) => id === WENT_KEY || id.startsWith("$"))).toBe(false);
      expect(readFormFields(t.fields)).toHaveLength(t.fields.length);
      expect(t.fields.some(isQuestion)).toBe(true);
      for (const f of t.fields) {
        expect(f.label.trim()).not.toBe("");
        if (isChoiceType(f.type)) expect((f.options ?? []).length).toBeGreaterThan(1);
        if (f.type === "section") expect(f.required).toBe(false);
      }
      // No copy hygiene slips in shipped text.
      const text = JSON.stringify(t);
      expect(text.includes("—")).toBe(false);
      expect(text.includes("--")).toBe(false);
    });
  }
});
