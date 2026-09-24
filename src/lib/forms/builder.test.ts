import { describe, expect, it } from "vitest";
import {
  FORM_FIELD_TYPES, audienceLine, changeFieldType, columnDisplayName, duplicateFieldAt, fieldFromDestination, fieldTypeLabel,
  isChoiceType, moveFieldTo, newField, questionNumbers, questionTypeForColumn, questionTypeForListField, unmappedDestinationFields,
} from "./builder";
import { readFormFields, type FormField } from "./fields";

const q = (id: string, type = "short_text", extra: Partial<FormField> = {}): FormField => ({ id, type, label: id, required: false, ...extra });

describe("the Add-a-field catalogue", () => {
  it("lists the spec's nine first, in the spec's order, then the parity types", () => {
    expect(FORM_FIELD_TYPES.slice(0, 7).map((d) => d.label)).toEqual(["Short text", "Long text", "Number", "Email", "Link", "Date", "Single choice"]);
    const types = FORM_FIELD_TYPES.map((d) => d.type);
    for (const t of ["dropdown", "multi_select", "checkbox", "rating", "people", "file", "section"]) expect(types).toContain(t);
    expect(new Set(types).size).toBe(types.length);
  });
  it("labels an unknown type as Short text, the renderer's own fallback", () => {
    expect(fieldTypeLabel("url")).toBe("Link");
    expect(fieldTypeLabel("mystery")).toBe("Short text");
  });
  it("knows which types carry options", () => {
    expect(["select", "dropdown", "multi_select"].every(isChoiceType)).toBe(true);
    expect(isChoiceType("checkbox")).toBe(false);
  });
});

describe("newField", () => {
  it("starts a question with an empty label and a section with a heading", () => {
    expect(newField("short_text", "a")).toEqual({ id: "a", type: "short_text", label: "", required: false });
    expect(newField("section", "s").label).toBe("Section");
  });
  it("gives a choice field two options and a rating a five-star scale", () => {
    expect(newField("dropdown", "d").options).toEqual(["Option 1", "Option 2"]);
    expect(newField("rating", "r").max).toBe(5);
  });
  it("survives the stored shape (readFormFields keeps every new property)", () => {
    const f = { ...newField("select", "x"), allowOther: true };
    expect(readFormFields([f])[0]).toMatchObject({ id: "x", type: "select", allowOther: true, options: ["Option 1", "Option 2"] });
  });
});

describe("changeFieldType", () => {
  it("keeps options between choice types and loses nothing", () => {
    const r = changeFieldType(q("a", "select", { options: ["Red", "Blue"], allowOther: true }), "multi_select");
    expect(r.loses).toBeNull();
    expect(r.field).toMatchObject({ type: "multi_select", options: ["Red", "Blue"], allowOther: true });
  });
  it("names what a choice-to-text change throws away", () => {
    const r = changeFieldType(q("a", "dropdown", { options: ["A", "B", "C"] }), "short_text");
    expect(r.loses).toBe("its 3 options");
    expect(r.field.options).toBeUndefined();
  });
  it("keeps the label, help text and id, and a section is never required", () => {
    const r = changeFieldType(q("a", "short_text", { required: true, placeholder: "hint" }), "section");
    expect(r.field).toMatchObject({ id: "a", label: "a", placeholder: "hint", required: false, type: "section" });
  });
  it("is a no-op for the same type", () => {
    const f = q("a");
    expect(changeFieldType(f, "short_text").field).toBe(f);
  });
});

describe("moving and duplicating", () => {
  const fields = [q("a"), q("b"), q("c")];
  it("moves a field and clamps the target", () => {
    expect(moveFieldTo(fields, 0, 2).map((f) => f.id)).toEqual(["b", "c", "a"]);
    expect(moveFieldTo(fields, 2, -5).map((f) => f.id)).toEqual(["c", "a", "b"]);
  });
  it("returns the same array for a no-op or a bad index", () => {
    expect(moveFieldTo(fields, 1, 1)).toBe(fields);
    expect(moveFieldTo(fields, 9, 0)).toBe(fields);
  });
  it("duplicates directly under the source with a fresh id and its own options", () => {
    const src = [q("a", "select", { options: ["x"] }), q("b")];
    const out = duplicateFieldAt(src, 0, "copy");
    expect(out.map((f) => f.id)).toEqual(["a", "copy", "b"]);
    expect(out[1].label).toBe("a (copy)");
    out[1].options!.push("y");
    expect(src[0].options).toEqual(["x"]);
  });
});

describe("questionNumbers", () => {
  it("numbers questions and skips sections", () => {
    const n = questionNumbers([q("a"), q("s", "section"), q("b")]);
    expect([...n.entries()]).toEqual([["a", 1], ["b", 2]]);
  });
});

describe("map-to-existing-field", () => {
  it("picks a question type for the List field types a form can fill", () => {
    expect(questionTypeForListField("DROPDOWN")).toBe("dropdown");
    expect(questionTypeForListField("PEOPLE")).toBe("people");
    expect(questionTypeForListField("FILES")).toBe("file");
    expect(questionTypeForListField("FORMULA")).toBeNull();
    expect(questionTypeForListField("ROLLUP")).toBeNull();
  });
  it("picks a question type for table columns and refuses computed ones", () => {
    expect(questionTypeForColumn("currency")).toBe("number");
    expect(questionTypeForColumn("person")).toBe("people");
    expect(questionTypeForColumn("formula")).toBeNull();
    expect(questionTypeForColumn("lookup")).toBeNull();
  });
  it("builds a question from a destination field, carrying its choices", () => {
    const f = fieldFromDestination({ label: "Priority", type: "dropdown", options: ["High", "Low"] }, "p");
    expect(f).toMatchObject({ id: "p", label: "Priority", type: "dropdown", options: ["High", "Low"] });
  });
  it("offers only the fields nothing maps to yet", () => {
    const all = [{ key: "a" }, { key: "b" }, { key: "c" }];
    expect(unmappedDestinationFields(all, { q1: "b" }).map((x) => x.key)).toEqual(["a", "c"]);
    expect(unmappedDestinationFields(all, undefined)).toHaveLength(3);
  });
  it("names a column by its name or, on a sheet-born table, its letter", () => {
    expect(columnDisplayName("Email", 0)).toBe("Email");
    expect(columnDisplayName("  ", 0)).toBe("Column A");
    expect(columnDisplayName(null, 27)).toBe("Column AB");
  });
});

describe("audienceLine", () => {
  // The rule the API enforces today (api/forms/[id] canEditForm): every Member
  // edits and reads responses, a Guest only their own form, whatever the
  // destination. The copy must not promise a narrower audience than that.
  it("tells the owner the whole workspace can edit and read, with or without a destination", () => {
    const none = audienceLine(null);
    expect(none).toBe("Every member of this workspace can edit this form and read its responses. A guest can only if they made the form.");
    expect(audienceLine({ kind: "list", name: "Sales · Q4 leads" })).toBe(none);
    expect(audienceLine({ kind: "table", name: "Pipeline" })).toBe(none);
  });
  it("never claims only the owner and admins can edit, or that editors come from the destination", () => {
    for (const d of [null, { kind: "list" as const, name: "Sales" }, { kind: "table" as const, name: "" }]) {
      const line = audienceLine(d);
      expect(line).not.toMatch(/only you/i);
      expect(line).not.toMatch(/editors of/i);
      expect(line).not.toMatch(/\u2014|-{2}/);
    }
  });
});
