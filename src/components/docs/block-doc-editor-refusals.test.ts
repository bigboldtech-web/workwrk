import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

// The doc editor's two "the server said no for good" rules. The editor is a
// React module (BlockNote, next/navigation) that the node test environment
// cannot load, so the pure helpers are evaluated from its source text: the
// same functions the component calls, not a copy of them.
//
//   docLoadHidden   GET answered 404 or 400: the in-shell not-found, never
//                   "Couldn't open this doc" with a Retry that reloads into
//                   the same refusal.
//   docSaveRefusal  PUT answered 404 (access removed while the tab was open)
//                   or 410 (archived): final, no network retry loop and no
//                   "Check your connection" toast.

const SRC = readFileSync(fileURLToPath(new URL("./block-doc-editor.tsx", import.meta.url)), "utf8");

/** Pull one exported top-level function out of the source and evaluate it. */
function load<T>(name: string): T {
  const start = SRC.indexOf(`export function ${name}(`);
  if (start < 0) throw new Error(`${name} is not in block-doc-editor.tsx`);
  const end = SRC.indexOf("\n}\n", start);
  const body = SRC.slice(start, end + 2)
    .replace(/^export /, "")
    // Strip the few type annotations these helpers carry.
    .replace(/\(status: number\): [^{]+\{/, "(status) {");
  return new Function(`${body}; return ${name};`)() as T;
}

const docLoadHidden = load<(s: number) => boolean>("docLoadHidden");
const docSaveRefusal = load<(s: number) => string | null>("docSaveRefusal");

describe("docLoadHidden (opening a doc)", () => {
  it("treats 404 and 400 as not found", () => {
    expect(docLoadHidden(404)).toBe(true);
    expect(docLoadHidden(400)).toBe(true);
  });
  it("keeps the error and its Retry for real failures", () => {
    for (const s of [500, 502, 503, 504, 401, 429]) expect(docLoadHidden(s)).toBe(false);
  });
  it("never hides a doc that loaded", () => {
    expect(docLoadHidden(200)).toBe(false);
  });
});

describe("docSaveRefusal (saving a doc)", () => {
  it("is final when access is gone (404)", () => {
    expect(docSaveRefusal(404)).toBe("no-access");
  });
  it("is final when the doc was archived (410)", () => {
    expect(docSaveRefusal(410)).toBe("archived");
  });
  it("leaves 5xx and everything else to the retry path", () => {
    for (const s of [500, 502, 503, 504, 429, 200]) expect(docSaveRefusal(s)).toBeNull();
  });
  it("leaves 403 and 409 to their own branches", () => {
    expect(docSaveRefusal(403)).toBeNull();
    expect(docSaveRefusal(409)).toBeNull();
  });
});

describe("the editor wires them in", () => {
  it("checks the load status before the generic throw", () => {
    const load = SRC.indexOf("if (docLoadHidden(res.status))");
    const thrown = SRC.indexOf("if (!res.ok) throw new Error(`HTTP ${res.status}`);", load);
    expect(load).toBeGreaterThan(0);
    expect(thrown).toBeGreaterThan(load);
  });
  it("checks the save refusal before the throw that feeds the retry loop", () => {
    const refusal = SRC.indexOf("const refusal = docSaveRefusal(res.status);");
    const thrown = SRC.indexOf("if (!res.ok) throw new Error(`HTTP ${res.status}`);", refusal);
    const retryToast = SRC.indexOf("Not saved. Check your connection");
    expect(refusal).toBeGreaterThan(0);
    expect(thrown).toBeGreaterThan(refusal);
    expect(retryToast).toBeGreaterThan(thrown);
  });
  it("renders the in-shell not-found for a hidden doc", () => {
    expect(SRC).toMatch(/if \(notFound\) \{[\s\S]*?<NotFoundView \/>/);
  });
  it("copy has no em dashes or double hyphens", () => {
    const copy = SRC.slice(SRC.indexOf("export const DOC_SAVE_REFUSAL_COPY"), SRC.indexOf("};", SRC.indexOf("export const DOC_SAVE_REFUSAL_COPY")));
    expect(copy).not.toMatch(/\u2014|-{2}/);
  });
});
