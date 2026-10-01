import { describe, expect, it } from "vitest";
import { getRequestContext } from "./request-context";

describe("getRequestContext", () => {
  it("reads the IP and user agent off a plain Request", () => {
    const req = new Request("http://localhost/api/x", { headers: { "x-forwarded-for": "203.0.113.9", "user-agent": "StageD-UA/1.0" } });
    expect(getRequestContext(req)).toEqual({ ipAddress: "203.0.113.9", userAgent: "StageD-UA/1.0" });
  });

  it("records the hop our proxy added, never the client's own first hop", () => {
    const req = new Request("http://localhost/api/x", { headers: { "x-forwarded-for": "6.6.6.6, 203.0.113.9" } });
    expect(getRequestContext(req).ipAddress).toBe("203.0.113.9");
  });

  it("takes x-real-ip first", () => {
    const req = new Request("http://localhost/api/x", { headers: { "x-real-ip": "198.51.100.7", "x-forwarded-for": "6.6.6.6, 198.51.100.7" } });
    expect(getRequestContext(req).ipAddress).toBe("198.51.100.7");
  });

  it("answers nulls with no request or no headers", () => {
    expect(getRequestContext(null)).toEqual({ ipAddress: null, userAgent: null });
    expect(getRequestContext(undefined)).toEqual({ ipAddress: null, userAgent: null });
    expect(getRequestContext(new Request("http://localhost/api/x"))).toEqual({ ipAddress: null, userAgent: null });
  });

  it("caps an oversized user agent", () => {
    const req = new Request("http://localhost/api/x", { headers: { "user-agent": "x".repeat(2000) } });
    expect(getRequestContext(req).userAgent?.length).toBe(512);
  });
});
