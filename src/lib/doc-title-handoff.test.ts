import { describe, expect, it } from "vitest";

import { handOffDocTitle, registerDocTitleWriter } from "./doc-title-handoff";

describe("handOffDocTitle", () => {
  it("is not handled when no editor has the doc open", async () => {
    expect(await handOffDocTitle("nobody", "New")).toBe(false);
  });

  it("hands the rename to the open editor of that doc, and only that doc", async () => {
    const got: string[] = [];
    const off = registerDocTitleWriter("d1", async (t) => { got.push(t); return true; });
    expect(await handOffDocTitle("d2", "Other")).toBe(false);
    expect(await handOffDocTitle("d1", "Renamed")).toBe(true);
    expect(got).toEqual(["Renamed"]);
    off();
    expect(await handOffDocTitle("d1", "Again")).toBe(false);
    expect(got).toEqual(["Renamed"]);
  });

  it("uses the most recently opened editor and falls back when it closes", async () => {
    const got: string[] = [];
    const offA = registerDocTitleWriter("d1", async (t) => { got.push(`a:${t}`); return true; });
    const offB = registerDocTitleWriter("d1", async (t) => { got.push(`b:${t}`); return true; });
    await handOffDocTitle("d1", "one");
    offB();
    await handOffDocTitle("d1", "two");
    offA();
    expect(got).toEqual(["b:one", "a:two"]);
  });

  it("reports an editor that cannot write, or throws, as not handled", async () => {
    const offRo = registerDocTitleWriter("ro", async () => false);
    expect(await handOffDocTitle("ro", "x")).toBe(false);
    offRo();
    const offBad = registerDocTitleWriter("bad", async () => { throw new Error("boom"); });
    expect(await handOffDocTitle("bad", "x")).toBe(false);
    offBad();
  });

  it("passes a conflict through so the caller neither saves nor says renamed", async () => {
    const off = registerDocTitleWriter("c1", async () => "conflict");
    expect(await handOffDocTitle("c1", "x")).toBe("conflict");
    off();
  });

  it("unregistering twice is harmless", () => {
    const off = registerDocTitleWriter("d9", async () => true);
    off();
    expect(() => off()).not.toThrow();
  });
});
