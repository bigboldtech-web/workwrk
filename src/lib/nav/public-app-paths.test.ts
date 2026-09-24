import { describe, expect, it } from "vitest";
import { isSignedOutAppPath } from "./public-app-paths";

describe("isSignedOutAppPath (the edge gate's exception list)", () => {
  it("lets the public form responder through", () => {
    expect(isSignedOutAppPath("/forms/abc123/respond")).toBe(true);
    expect(isSignedOutAppPath("/forms/abc123/respond/")).toBe(true);
  });
  it("keeps the list, the builder and anything deeper gated", () => {
    expect(isSignedOutAppPath("/forms")).toBe(false);
    expect(isSignedOutAppPath("/forms/abc123")).toBe(false);
    expect(isSignedOutAppPath("/forms/abc123/respond/extra")).toBe(false);
    expect(isSignedOutAppPath("/forms//respond")).toBe(false);
    expect(isSignedOutAppPath("/tables/abc/respond")).toBe(false);
  });
});
