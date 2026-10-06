import { describe, expect, it } from "vitest";
import { badInputSentence, checkToolInput } from "./input-check";

const createTask = {
  type: "object",
  properties: {
    title: { type: "string" },
    assigneeEmail: { type: "string" },
    estimateHours: { type: "number" },
    tags: { type: "array", items: { type: "string" } },
    done: { type: "boolean" },
  },
};

describe("checkToolInput", () => {
  it("passes the declared properties of the declared types", () => {
    expect(checkToolInput(createTask, { title: "Call Acme", estimateHours: 2, tags: ["sales"], done: false })).toEqual({
      ok: true,
      input: { title: "Call Acme", estimateHours: 2, tags: ["sales"], done: false },
    });
  });

  it("refuses an object where a string belongs: the filter a planted instruction needs", () => {
    // Before: {"equals": "ceo@acme.com"} reached a Prisma where clause.
    expect(checkToolInput(createTask, { title: "Wire $5k", assigneeEmail: { equals: "ceo@acme.com" } })).toEqual({ ok: false, field: "assigneeEmail" });
    expect(checkToolInput(createTask, { title: { contains: "x" } })).toEqual({ ok: false, field: "title" });
    expect(checkToolInput(createTask, { tags: ["ok", { not: "" }] })).toEqual({ ok: false, field: "tags" });
    expect(checkToolInput(createTask, { estimateHours: Number.NaN })).toEqual({ ok: false, field: "estimateHours" });
  });

  it("drops what the schema does not declare, and reads null as absent", () => {
    expect(checkToolInput(createTask, { title: "x", ownerId: "someone-else", assigneeEmail: null })).toEqual({ ok: true, input: { title: "x" } });
    expect(checkToolInput(createTask, { constructor: "x", __proto__: { a: 1 } })).toEqual({ ok: true, input: {} });
  });

  it("refuses an input that is not an object, and takes no input as empty", () => {
    expect(checkToolInput(createTask, "Call Acme")).toEqual({ ok: false, field: "input" });
    expect(checkToolInput(createTask, [{ title: "x" }])).toEqual({ ok: false, field: "input" });
    expect(checkToolInput(createTask, undefined)).toEqual({ ok: true, input: {} });
  });

  it("takes only plain values for a property with no declared type", () => {
    const loose = { properties: { note: {} } };
    expect(checkToolInput(loose, { note: "hi" })).toEqual({ ok: true, input: { note: "hi" } });
    expect(checkToolInput(loose, { note: { in: ["a"] } })).toEqual({ ok: false, field: "note" });
  });

  it("says what went wrong in plain words", () => {
    expect(badInputSentence("assigneeEmail")).toBe("That request's assigneeEmail wasn't in a form the tool can use, so nothing was done.");
    expect(badInputSentence("input")).not.toMatch(/—|--/);
  });
});
