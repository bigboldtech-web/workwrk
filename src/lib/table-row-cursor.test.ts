import { describe, expect, it } from "vitest";
import { decodeRowCursor, encodeRowCursor } from "./table-row-cursor";

// Helper: mint a cursor the way an attacker would, from arbitrary JSON text.
const b64url = (s: string) => Buffer.from(s, "utf8").toString("base64url");

describe("encodeRowCursor", () => {
  it("round-trips an integer position and cuid id", () => {
    const c = { position: 4999, id: "cmemvv2a4000108l7ajxo0fw9" };
    expect(decodeRowCursor(encodeRowCursor(c))).toEqual(c);
  });

  it("round-trips a float position (transport is float-capable by contract)", () => {
    const c = { position: 12.5, id: "abc123" };
    expect(decodeRowCursor(encodeRowCursor(c))).toEqual(c);
  });

  it("round-trips position 0 and negative positions", () => {
    expect(decodeRowCursor(encodeRowCursor({ position: 0, id: "x" }))).toEqual({ position: 0, id: "x" });
    expect(decodeRowCursor(encodeRowCursor({ position: -3, id: "x" }))).toEqual({ position: -3, id: "x" });
  });

  it("emits only URL-safe characters (no +, /, = to percent-encode)", () => {
    // Position/id chosen so plain base64 WOULD contain '+' or '/' padding.
    const out = encodeRowCursor({ position: 63, id: "??>>~~substantial-id-with-length" });
    expect(out).toMatch(/^[A-Za-z0-9_-]+$/);
  });
});

describe("decodeRowCursor", () => {
  it("rejects the empty string", () => {
    expect(decodeRowCursor("")).toBeNull();
  });

  it("rejects oversize cursors before parsing", () => {
    expect(decodeRowCursor("A".repeat(513))).toBeNull();
  });

  it("rejects plain garbage that is not JSON after decode", () => {
    expect(decodeRowCursor("not-a-cursor!!!")).toBeNull();
    expect(decodeRowCursor(b64url("hello world"))).toBeNull();
  });

  it("rejects valid JSON of the wrong shape", () => {
    expect(decodeRowCursor(b64url("123"))).toBeNull();
    expect(decodeRowCursor(b64url("null"))).toBeNull();
    expect(decodeRowCursor(b64url("\"str\""))).toBeNull();
    expect(decodeRowCursor(b64url("[1,2]"))).toBeNull();
    expect(decodeRowCursor(b64url("{}"))).toBeNull();
  });

  it("rejects a missing or non-numeric position", () => {
    expect(decodeRowCursor(b64url('{"i":"abc"}'))).toBeNull();
    expect(decodeRowCursor(b64url('{"p":"5","i":"abc"}'))).toBeNull();
    expect(decodeRowCursor(b64url('{"p":null,"i":"abc"}'))).toBeNull();
  });

  it("rejects crafted non-finite positions (JSON 1e999 parses to Infinity)", () => {
    expect(decodeRowCursor(b64url('{"p":1e999,"i":"abc"}'))).toBeNull();
    expect(decodeRowCursor(b64url('{"p":-1e999,"i":"abc"}'))).toBeNull();
  });

  it("rejects a missing, empty, non-string, or oversize id", () => {
    expect(decodeRowCursor(b64url('{"p":1}'))).toBeNull();
    expect(decodeRowCursor(b64url('{"p":1,"i":""}'))).toBeNull();
    expect(decodeRowCursor(b64url('{"p":1,"i":7}'))).toBeNull();
    expect(decodeRowCursor(b64url(`{"p":1,"i":"${"a".repeat(129)}"}`))).toBeNull();
  });

  it("tolerates extra keys (forward compatibility, only p and i are read)", () => {
    expect(decodeRowCursor(b64url('{"p":2,"i":"abc","v":9}'))).toEqual({ position: 2, id: "abc" });
  });
});
