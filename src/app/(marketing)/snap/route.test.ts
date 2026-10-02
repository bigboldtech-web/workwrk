import { describe, expect, it } from "vitest";
import { GET } from "./route";

describe("/snap", () => {
  it("is a 301 to /tuesday with a relative Location, never the upstream host", () => {
    const res = GET();
    expect(res.status).toBe(301);
    expect(res.headers.get("location")).toBe("/tuesday");
  });
});
