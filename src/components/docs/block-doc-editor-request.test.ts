import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import ts from "typescript";
import { describe, expect, it } from "vitest";

// The Request link on a doc's Can view and Can comment strips. It used to
// open the read-only "Who has access" dialog, which has no way to ask, so a
// viewer believed they had asked and the owner never heard. It now posts an
// access request, and these two helpers decide where the strip starts (from
// the person's own outgoing requests) and what it says at each step.
//
// The editor is a React module (BlockNote, next/navigation) that the node
// test environment cannot load, so, as in block-doc-editor-refusals.test.ts,
// the helpers are taken from its source text and evaluated: the same
// functions the component calls, not a copy of them.

const SRC = readFileSync(fileURLToPath(new URL("./block-doc-editor.tsx", import.meta.url)), "utf8");

function slice(name: string): string {
  const start = SRC.indexOf(`export function ${name}(`);
  if (start < 0) throw new Error(`${name} is not in block-doc-editor.tsx`);
  const end = SRC.indexOf("\n}\n", start);
  return SRC.slice(start, end + 2).replace(/^export /, "");
}

function load<T>(name: string): T {
  const js = ts.transpileModule(slice(name), { compilerOptions: { target: ts.ScriptTarget.ES2020 } }).outputText;
  return new Function(`${js}; return ${name};`)() as T;
}

type Ask = { state: "idle" } | { state: "pending"; since: string } | { state: "declined"; decidedAt: string | null };
type Row = { objectType: string; objectId: string; role: string; status: string; createdAt: string; decidedAt: string | null };
const docAccessAsk = load<(rows: Row[] | null | undefined, docId: string, myRole: "comment" | "view") => Ask>("docAccessAsk");
const docRequestStrip = load<
  (ask: Ask, send: "idle" | "busy" | "sent" | "failed", myRole: "comment" | "view", owner: string | null | undefined, when: (iso: string) => string) => { message: string; label: string | null }
>("docRequestStrip");

const DOC = "doc1";
const row = (over: Partial<Row>): Row => ({ objectType: "doc", objectId: DOC, role: "EDIT", status: "PENDING", createdAt: "2026-10-01T08:00:00.000Z", decidedAt: null, ...over });
const when = (iso: string) => `D(${iso.slice(0, 10)})`;

describe("docAccessAsk (where the strip starts)", () => {
  it("is idle with no rows, a failed read, or rows on other objects", () => {
    expect(docAccessAsk(undefined, DOC, "view")).toEqual({ state: "idle" });
    expect(docAccessAsk([], DOC, "view")).toEqual({ state: "idle" });
    expect(docAccessAsk([row({ objectId: "other" }), row({ objectType: "goal" })], DOC, "view")).toEqual({ state: "idle" });
  });
  it("reads a pending edit request as pending, so no second ask is offered", () => {
    expect(docAccessAsk([row({})], DOC, "view")).toEqual({ state: "pending", since: "2026-10-01T08:00:00.000Z" });
    expect(docAccessAsk([row({})], DOC, "comment")).toEqual({ state: "pending", since: "2026-10-01T08:00:00.000Z" });
  });
  it("reads a declined request as declined, with the date", () => {
    expect(docAccessAsk([row({ status: "DENIED", decidedAt: "2026-10-02T00:00:00.000Z" })], DOC, "view")).toEqual({ state: "declined", decidedAt: "2026-10-02T00:00:00.000Z" });
  });
  it("uses the newest row only (the API lists newest first)", () => {
    expect(docAccessAsk([row({ status: "APPROVED" }), row({ status: "DENIED" })], DOC, "view")).toEqual({ state: "idle" });
  });
  it("lets a person ask again once they hold what an open request asked for", () => {
    // Asked for Can comment, then given it from the share dialog: the row is
    // still PENDING until the owner opens their requests, but it is not this
    // person's to wait on any more.
    expect(docAccessAsk([row({ role: "COMMENT" })], DOC, "comment")).toEqual({ state: "idle" });
    expect(docAccessAsk([row({ role: "VIEW" })], DOC, "view")).toEqual({ state: "idle" });
    expect(docAccessAsk([row({ role: "COMMENT" })], DOC, "view")).toEqual({ state: "pending", since: "2026-10-01T08:00:00.000Z" });
  });
});

describe("docRequestStrip (what the strip says)", () => {
  const idle: Ask = { state: "idle" };
  it("offers Request with the owner's name before anything is asked", () => {
    expect(docRequestStrip(idle, "idle", "view", "Owen Owner", when)).toEqual({ message: "View only. Ask Owen Owner for edit access.", label: "Request" });
    expect(docRequestStrip(idle, "idle", "view", null, when)).toEqual({ message: "View only. Ask the owner for edit access.", label: "Request" });
    expect(docRequestStrip(idle, "idle", "comment", "Owen Owner", when)).toEqual({ message: "You can read and comment on this doc.", label: "Request" });
  });
  it("says the request was sent and offers no second click", () => {
    expect(docRequestStrip(idle, "sent", "view", "Owen Owner", when)).toEqual({ message: "View only. Request sent to Owen Owner.", label: null });
    expect(docRequestStrip(idle, "sent", "comment", "", when)).toEqual({ message: "You can read and comment on this doc. Request sent.", label: null });
    expect(docRequestStrip(idle, "busy", "view", "Owen Owner", when).label).toBeNull();
  });
  it("keeps a Retry when the POST failed", () => {
    expect(docRequestStrip(idle, "failed", "view", "Owen Owner", when)).toEqual({ message: "View only. Couldn't send your request for edit access.", label: "Retry" });
  });
  it("starts from a pending or declined request", () => {
    expect(docRequestStrip({ state: "pending", since: "2026-10-01T08:00:00.000Z" }, "idle", "view", "Owen Owner", when)).toEqual({
      message: "View only. Edit request pending since D(2026-10-01). Owen Owner has it.",
      label: null,
    });
    expect(docRequestStrip({ state: "declined", decidedAt: "2026-10-02T00:00:00.000Z" }, "idle", "view", "Owen Owner", when)).toEqual({
      message: "View only. Your edit request was declined on D(2026-10-02). You can ask again.",
      label: "Request",
    });
  });
  it("never writes an em dash or a double hyphen", () => {
    const asks: Ask[] = [idle, { state: "pending", since: "2026-10-01T00:00:00.000Z" }, { state: "declined", decidedAt: null }];
    for (const a of asks) for (const s of ["idle", "busy", "sent", "failed"] as const) for (const r of ["view", "comment"] as const) {
      expect(docRequestStrip(a, s, r, "Owen Owner", when).message).not.toMatch(/—|--/);
    }
  });
});
