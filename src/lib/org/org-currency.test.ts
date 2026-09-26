import { describe, expect, it } from "vitest";
import { formatOrgMoney, orgCurrencyFromSettings } from "./org-currency";

describe("the org currency", () => {
  it("reads settings.currency and falls back to USD", () => {
    expect(orgCurrencyFromSettings({ currency: "inr" })).toBe("INR");
    expect(orgCurrencyFromSettings({ currency: "rupees" })).toBe("USD");
    expect(orgCurrencyFromSettings(null)).toBe("USD");
    expect(orgCurrencyFromSettings({})).toBe("USD");
  });

  it("formats in that currency, compact above a thousand", () => {
    expect(formatOrgMoney(950, "USD", "en-US")).toBe("$950");
    expect(formatOrgMoney(12_400, "USD", "en-US")).toBe("$12.4K");
    expect(formatOrgMoney(1500, "INR", "en-IN")).toMatch(/₹/);
    expect(formatOrgMoney(10, "ZZZ", "en-US")).toMatch(/ZZZ/);
  });
});
