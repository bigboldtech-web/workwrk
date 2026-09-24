import { describe, expect, it } from "vitest";
import {
  SUBMISSION_KEY_RE, WENT_KEY, answerText, coerceAnswer, draftHash, formDraftKey, isEmptyAnswer, isQuestion, missingRequired, missingSummary,
  newSubmissionKey, numberAnswer, pickKnownAnswers, ratingMax, readDraftHash, readFileAnswer, readFormDraft, readFormFields, readWentTo, writeFormDraft,
  type FormField,
} from "./fields";

const text: FormField = { id: "a", type: "short_text", label: "Name", required: true };
const num: FormField = { id: "b", type: "number", label: "Age", required: true };
const multi: FormField = { id: "c", type: "multi_select", label: "Tags", required: true, options: ["x", "y"] };
const box: FormField = { id: "d", type: "checkbox", label: "I agree", required: true };
const optional: FormField = { id: "e", type: "long_text", label: "Notes" };

describe("the one empty-answer rule (responder and submit route agree)", () => {
  it("treats blanks, whitespace, empty lists and null as unanswered", () => {
    expect(isEmptyAnswer(text, undefined)).toBe(true);
    expect(isEmptyAnswer(text, "   ")).toBe(true);
    expect(isEmptyAnswer(multi, [])).toBe(true);
    expect(isEmptyAnswer(num, null)).toBe(true);
    expect(isEmptyAnswer(num, 0)).toBe(false);
  });
  it("needs a tick for a required checkbox", () => {
    expect(isEmptyAnswer(box, false)).toBe(true);
    expect(isEmptyAnswer(box, true)).toBe(false);
  });
  it("lists missing required fields in order and ignores optional ones", () => {
    expect(missingRequired([text, num, multi, box, optional], { b: 3 })).toEqual(["a", "c", "d"]);
    expect(missingRequired([optional], {})).toEqual([]);
  });
  it("counts in words", () => {
    expect(missingSummary(1)).toBe("1 question needs an answer");
    expect(missingSummary(2)).toBe("2 questions need an answer");
  });
});

describe("numberAnswer", () => {
  it("stores null when cleared, never an empty string", () => {
    expect(numberAnswer("")).toBeNull();
    expect(numberAnswer("  ")).toBeNull();
    expect(numberAnswer("12.5")).toBe(12.5);
    expect(numberAnswer("abc")).toBeNull();
  });
});

describe("readFormFields and pickKnownAnswers", () => {
  it("drops malformed fields instead of crashing a public page", () => {
    expect(readFormFields([{ id: "a", type: "short_text", label: "A" }, null, { type: "x" }, { id: "b" }]).map((f) => f.id)).toEqual(["a"]);
    expect(readFormFields("nope")).toEqual([]);
  });
  it("keeps only answers to fields the form has", () => {
    expect(pickKnownAnswers([text, num], { a: "x", b: 1, evil: "y" })).toEqual({ a: "x", b: 1 });
    expect(pickKnownAnswers([text], null)).toEqual({});
  });
});

describe("the draft that rides across sign-in", () => {
  it("round-trips and expires after a day", () => {
    const now = 1_000_000_000_000;
    const raw = writeFormDraft({ a: "hi" }, now);
    expect(readFormDraft(raw, now + 1000)).toEqual({ a: "hi" });
    expect(readFormDraft(raw, now + 86_400_001)).toBeNull();
    expect(readFormDraft("{not json", now)).toBeNull();
    expect(readFormDraft(null, now)).toBeNull();
  });
  it("keys per form", () => expect(formDraftKey("f1")).toBe("workwrk:form-draft:f1"));
});

describe("answers are coerced to their field's type (nothing hostile reaches a Table or a List)", () => {
  const sel: FormField = { id: "s", type: "select", label: "Pick", options: ["x"] };
  it("drops objects, including a formula cell", () => {
    expect(pickKnownAnswers([text], { a: { "=": "SUM(A:A)" } })).toEqual({});
    expect(pickKnownAnswers([sel], { s: { nested: true } })).toEqual({});
    expect(pickKnownAnswers([multi], { c: ["x", { "=": "1" }, 3] })).toEqual({ c: ["x"] });
  });
  it("keeps each type's own shape", () => {
    expect(coerceAnswer(num, "12")).toBe(12);
    expect(coerceAnswer(num, "")).toBeNull();
    expect(coerceAnswer(num, "abc")).toBeUndefined();
    expect(coerceAnswer(box, true)).toBe(true);
    expect(coerceAnswer(box, "true")).toBeUndefined();
    expect(coerceAnswer(text, 5)).toBe("5");
    // A type this build does not know keeps primitives only.
    expect(coerceAnswer({ id: "z", type: "signature", label: "" }, 4)).toBe("4");
    expect(coerceAnswer({ id: "z", type: "signature", label: "" }, true)).toBe(true);
  });
  it("caps a very long text answer", () => {
    expect((coerceAnswer(text, "x".repeat(50_000)) as string).length).toBe(20_000);
  });
});

describe("the embed's draft hand-off through the URL fragment", () => {
  it("round-trips unicode answers", () => {
    const now = 1_000_000_000_000;
    const h = draftHash({ a: "Zoë 日本 ✓", c: ["x"] }, now);
    expect(h.startsWith("#draft=")).toBe(true);
    expect(readDraftHash(h, now + 5)).toEqual({ a: "Zoë 日本 ✓", c: ["x"] });
  });
  it("carries nothing when there is nothing, and ignores junk and old drafts", () => {
    expect(draftHash({})).toBe("");
    expect(readDraftHash("#draft=%%%")).toBeNull();
    expect(readDraftHash("#other")).toBeNull();
    const now = 1_000_000_000_000;
    expect(readDraftHash(draftHash({ a: "x" }, now), now + 86_400_001)).toBeNull();
  });
  it("leaves an oversized draft in the embed rather than a giant URL", () => {
    expect(draftHash({ a: "x".repeat(40_000) })).toBe("");
  });
});

describe("the submission key that makes one Submit idempotent", () => {
  it("is 32 hex characters and fresh each time", () => {
    const a = newSubmissionKey();
    expect(SUBMISSION_KEY_RE.test(a)).toBe(true);
    expect(newSubmissionKey()).not.toBe(a);
    expect(SUBMISSION_KEY_RE.test("c" + "x".repeat(24))).toBe(false);
  });
});

describe("form builder parity types (Phase 5 decided addition c)", () => {
  const rating: FormField = { id: "r", type: "rating", label: "Score", max: 5 };
  const people: FormField = { id: "p", type: "people", label: "Who" };
  const file: FormField = { id: "f", type: "file", label: "CV", required: true };
  const section: FormField = { id: "s", type: "section", label: "About you", required: true };
  const drop: FormField = { id: "d", type: "dropdown", label: "Size", options: ["S", "M"] };

  it("a rating is a whole number inside its scale", () => {
    expect(coerceAnswer(rating, 4)).toBe(4);
    expect(coerceAnswer(rating, "3")).toBe(3);
    expect(coerceAnswer(rating, 6)).toBeUndefined();
    expect(coerceAnswer(rating, 0)).toBeUndefined();
    expect(coerceAnswer({ ...rating, max: 10 }, 9.6)).toBe(10);
    expect(ratingMax({ ...rating, max: 50 })).toBe(5);
  });
  it("a people answer is a de-duplicated, capped list of ids", () => {
    expect(coerceAnswer(people, ["u1", "u1", 7, "u2"])).toEqual(["u1", "u2"]);
    expect(coerceAnswer(people, "u1")).toBeUndefined();
    expect((coerceAnswer(people, Array.from({ length: 40 }, (_, i) => `u${i}`)) as string[]).length).toBe(20);
  });
  it("a file answer keeps only uploads this app wrote", () => {
    const ok = { name: "cv.pdf", url: "/api/uploads/file-1.pdf", size: 10 };
    const s3 = { name: "a.png", url: "https://bucket.example/a.png", s3Key: "orgs/o/notes/a.png" };
    const bad = { name: "x", url: "javascript:alert(1)" };
    expect(coerceAnswer(file, [ok, s3, bad, "str"])).toEqual([
      { name: "cv.pdf", url: "/api/uploads/file-1.pdf", s3Key: null, size: 10, mimeType: null },
      { name: "a.png", url: "https://bucket.example/a.png", s3Key: "orgs/o/notes/a.png", size: null, mimeType: null },
    ]);
    expect(readFileAnswer({ name: "", url: "/api/uploads/x" })).toBeNull();
  });
  it("a section is never an answer and never required", () => {
    expect(isQuestion(section)).toBe(false);
    expect(pickKnownAnswers([section], { s: "hello" })).toEqual({});
    expect(missingRequired([section, file], {})).toEqual(["f"]);
    expect(missingRequired([file], { f: [] })).toEqual(["f"]);
  });
  it("a dropdown and a single choice are trimmed, blank is no answer", () => {
    expect(coerceAnswer(drop, "  M ")).toBe("M");
    expect(coerceAnswer(drop, "   ")).toBeNull();
    expect(coerceAnswer({ id: "m", type: "multi_select", label: "" }, ["A", "  ", " Other text "])).toEqual(["A", "Other text"]);
  });
  it("answerText reads every type as one line", () => {
    expect(answerText(rating, 4)).toBe("4 of 5");
    expect(answerText(people, ["u1", "u2"], (id) => (id === "u1" ? "Ada" : null))).toBe("Ada, u2");
    expect(answerText(file, [{ name: "cv.pdf", url: "/api/uploads/x" }])).toBe("cv.pdf");
    expect(answerText({ id: "c", type: "checkbox", label: "" }, false)).toBe("No");
    expect(answerText(drop, undefined)).toBe("");
    expect(answerText(drop, { "=": "1" })).toBe("");
  });
});

describe("where a response went ($went)", () => {
  it("reads a landed task and a failed row, and ignores junk", () => {
    const data = { a: "x", [WENT_KEY]: { list: { boardId: "b", itemId: "i" }, table: { tableId: "t", error: "The row could not be added" } } };
    expect(readWentTo(data)).toEqual({ list: { boardId: "b", itemId: "i" }, table: { tableId: "t", error: "The row could not be added" } });
    expect(readWentTo({ [WENT_KEY]: "nope" })).toEqual({});
    expect(readWentTo(null)).toEqual({});
  });
  it("a client can never write it", () => {
    expect(pickKnownAnswers([{ id: "a", type: "short_text", label: "" }], { a: "x", [WENT_KEY]: { list: { boardId: "b", itemId: "i" } } })).toEqual({ a: "x" });
  });
});
