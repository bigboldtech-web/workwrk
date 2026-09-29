import { describe, expect, it } from "vitest";
import {
  CONSOLE_NAV,
  activeConsoleNav,
  consoleCrumbs,
  isAdminHost,
  productHref,
  shippedConsoleNav,
} from "./console-nav";

describe("activeConsoleNav (longest whole-segment prefix)", () => {
  it("lights Overview on /admin only", () => {
    expect(activeConsoleNav("/admin")).toBe("overview");
    expect(activeConsoleNav("/admin/")).toBe("overview");
    expect(activeConsoleNav("/admin?x=1")).toBe("overview");
  });
  it("lights Companies on the list and on a company page", () => {
    expect(activeConsoleNav("/admin/companies")).toBe("companies");
    expect(activeConsoleNav("/admin/companies/cmspt7e8r0000hdxphubg5nqj")).toBe("companies");
    expect(activeConsoleNav("/admin/companies?view=trials")).toBe("companies");
  });
  it("never matches a partial segment", () => {
    expect(activeConsoleNav("/admin/companies-archive")).toBeNull();
    expect(activeConsoleNav("/administrator")).toBeNull();
  });
  it("lights every other row by its own href", () => {
    expect(activeConsoleNav("/admin/analytics")).toBe("analytics");
    expect(activeConsoleNav("/admin/appsumo")).toBe("appsumo");
    expect(activeConsoleNav("/admin/staff")).toBe("staff");
    expect(activeConsoleNav("/admin/audit")).toBe("audit");
  });
  it("lights nothing on an unknown console path or outside the console", () => {
    expect(activeConsoleNav("/admin/nope")).toBeNull();
    expect(activeConsoleNav("/work")).toBeNull();
    expect(activeConsoleNav("")).toBeNull();
    expect(activeConsoleNav(null)).toBeNull();
  });
  it("lights nothing on an unclaimed path below a real page, so it agrees with the Not found crumb", () => {
    expect(activeConsoleNav("/admin/staff/extra")).toBeNull();
    expect(activeConsoleNav("/admin/audit/extra")).toBeNull();
    expect(activeConsoleNav("/admin/analytics/x/y")).toBeNull();
    expect(activeConsoleNav("/admin/appsumo/extra?x=1")).toBeNull();
    expect(activeConsoleNav("/admin/companies/cmumwko6o0061f5xp3hk4bewo/extra")).toBeNull();
    // A company page is still Companies.
    expect(activeConsoleNav("/admin/companies/cmumwko6o0061f5xp3hk4bewo")).toBe("companies");
    expect(activeConsoleNav("/admin/companies/cmumwko6o0061f5xp3hk4bewo/")).toBe("companies");
  });
  it("lights a row exactly when its crumb is not Not found", () => {
    const paths = [
      "/admin",
      "/admin/companies",
      "/admin/companies/abc123def",
      "/admin/companies/abc123def/extra",
      "/admin/staff",
      "/admin/staff/extra",
      "/admin/audit/extra",
      "/admin/nope",
    ];
    for (const p of paths) {
      const notFound = consoleCrumbs(p).at(-1)?.label === "Not found";
      expect(activeConsoleNav(p) === null, p).toBe(notFound);
    }
  });
});

describe("consoleCrumbs", () => {
  it("starts every route with Staff console linking to /admin", () => {
    expect(consoleCrumbs("/admin/staff")).toEqual([
      { label: "Staff console", href: "/admin" },
      { label: "Staff" },
    ]);
    expect(consoleCrumbs("/admin")).toEqual([
      { label: "Staff console", href: "/admin" },
      { label: "Overview" },
    ]);
  });
  it("names the company on its page, and never shows the raw id", () => {
    const id = "cmspt7e8r0000hdxphubg5nqj";
    expect(consoleCrumbs(`/admin/companies/${id}`, { companyName: "Acme" })).toEqual([
      { label: "Staff console", href: "/admin" },
      { label: "Companies", href: "/admin/companies" },
      { label: "Acme" },
    ]);
    expect(consoleCrumbs(`/admin/companies/${id}`).at(-1)).toEqual({ label: "Company" });
    expect(consoleCrumbs(`/admin/companies/${id}`, { companyName: "   " }).at(-1)).toEqual({ label: "Company" });
  });
  it("uses the naming canon, so no label names two destinations", () => {
    const labels = CONSOLE_NAV.map((r) => r.label);
    expect(new Set(labels).size).toBe(labels.length);
    expect(labels).toEqual(["Overview", "Companies", "Analytics", "AppSumo codes", "Staff", "Staff activity"]);
    expect(consoleCrumbs("/admin/appsumo").at(-1)).toEqual({ label: "AppSumo codes" });
  });
  it("says Not found on a path no console page owns", () => {
    const nf = [{ label: "Staff console", href: "/admin" }, { label: "Not found" }];
    expect(consoleCrumbs("/admin/nope")).toEqual(nf);
    expect(consoleCrumbs("/admin/audit/extra")).toEqual(nf);
    expect(consoleCrumbs("/admin/companies/abc123def/extra")).toEqual(nf);
    expect(consoleCrumbs("/admin/staff/extra")).toEqual(nf);
  });
});

describe("shippedConsoleNav", () => {
  it("keeps sidebar order, Staff activity included now its page exists", () => {
    const keys = shippedConsoleNav().map((r) => r.key);
    expect(keys).toEqual(["overview", "companies", "analytics", "appsumo", "staff", "audit"]);
    expect(consoleCrumbs("/admin/audit")).toEqual([{ label: "Staff console", href: "/admin" }, { label: "Staff activity" }]);
  });
});

describe("isAdminHost", () => {
  it("compares without the port, case-insensitively", () => {
    expect(isAdminHost("admin.workwrk.com", "admin.workwrk.com")).toBe(true);
    expect(isAdminHost("ADMIN.workwrk.com:443", "admin.workwrk.com")).toBe(true);
    expect(isAdminHost("app.workwrk.com", "admin.workwrk.com")).toBe(false);
  });
  it("is false when ADMIN_HOST is unset (local development)", () => {
    expect(isAdminHost("localhost:3013", undefined)).toBe(false);
    expect(isAdminHost("localhost:3013", "  ")).toBe(false);
    expect(isAdminHost(null, "admin.workwrk.com")).toBe(false);
  });
});

describe("productHref", () => {
  it("is absolute whenever the app URL is known", () => {
    expect(productHref("/account/preferences?tab=appearance", "https://app.workwrk.com/", true)).toBe(
      "https://app.workwrk.com/account/preferences?tab=appearance",
    );
    expect(productHref("/work", "https://app.workwrk.com", false)).toBe("https://app.workwrk.com/work");
  });
  it("is null on the admin host without an app URL, so no link loops back to /admin", () => {
    expect(productHref("/work", "", true)).toBeNull();
    expect(productHref("/work", undefined, true)).toBeNull();
  });
  it("is relative off the admin host (local development)", () => {
    expect(productHref("/work", "", false)).toBe("/work");
  });
});
