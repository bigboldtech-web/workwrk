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

  it("formats a record exactly: grouping, cents only when there are any", () => {
    expect(formatOrgMoney(2899, "USD", "en-US", { exact: true })).toBe("$2,899");
    expect(formatOrgMoney(1234.5, "USD", "en-US", { exact: true })).toBe("$1,234.50");
    expect(formatOrgMoney(12_400, "USD", "en-US", { exact: true })).toBe("$12,400");
    expect(formatOrgMoney(950, "USD", "en-US", { exact: true })).toBe("$950");
    expect(formatOrgMoney(0.99, "USD", "en-US", { exact: true })).toBe("$0.99");
  });
});
