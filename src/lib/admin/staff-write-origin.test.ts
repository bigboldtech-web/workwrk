import { describe, it, expect } from "vitest";
import { staffWriteOriginRefused } from "./staff-write-origin";

const h = (o: Record<string, string>) => new Headers(o);

describe("staffWriteOriginRefused", () => {
  it("never blocks reads", () => {
    expect(staffWriteOriginRefused("GET", h({ origin: "https://evil.example", "sec-fetch-site": "cross-site", host: "admin.workwrk.com" }))).toBe(false);
  });

  it("accepts the console's own JSON write", () => {
    expect(
      staffWriteOriginRefused(
        "PATCH",
        h({ origin: "https://admin.workwrk.com", "sec-fetch-site": "same-origin", host: "admin.workwrk.com", "content-type": "application/json" }),
      ),
    ).toBe(false);
    expect(staffWriteOriginRefused("DELETE", h({ origin: "http://localhost:3013", host: "localhost:3013", "sec-fetch-site": "same-origin" }))).toBe(false);
  });

  it("refuses a sibling subdomain (same-site, not same-origin)", () => {
    expect(
      staffWriteOriginRefused(
        "POST",
        h({ origin: "https://app.workwrk.com", "sec-fetch-site": "same-site", host: "admin.workwrk.com", "content-type": "application/json" }),
      ),
    ).toBe(true);
  });

  it("refuses a foreign Origin even without Sec-Fetch-Site", () => {
    expect(staffWriteOriginRefused("POST", h({ origin: "https://evil.example", host: "admin.workwrk.com", "content-type": "application/json" }))).toBe(true);
    expect(staffWriteOriginRefused("POST", h({ origin: "null", host: "admin.workwrk.com" }))).toBe(true);
  });

  it("refuses a form-style body type", () => {
    expect(staffWriteOriginRefused("POST", h({ host: "admin.workwrk.com", "content-type": "text/plain" }))).toBe(true);
    expect(staffWriteOriginRefused("POST", h({ host: "admin.workwrk.com", "content-type": "application/x-www-form-urlencoded" }))).toBe(true);
  });

  it("lets a non-browser caller through to the staff gate", () => {
    expect(staffWriteOriginRefused("POST", h({ host: "admin.workwrk.com", "content-type": "application/json" }))).toBe(false);
  });
});
