import { describe, expect, it } from "vitest";
import { getRequestContext } from "./request-context";

describe("getRequestContext", () => {
  it("reads the IP and user agent off a plain Request", () => {
    const req = new Request("http://localhost/api/x", { headers: { "x-forwarded-for": "203.0.113.9, 10.0.0.1", "user-agent": "StageD-UA/1.0" } });
    expect(getRequestContext(req)).toEqual({ ipAddress: "203.0.113.9", userAgent: "StageD-UA/1.0" });
  });

  it("falls back to x-real-ip", () => {
    const req = new Request("http://localhost/api/x", { headers: { "x-real-ip": "198.51.100.7" } });
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
