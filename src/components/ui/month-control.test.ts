// MonthControl (spec-goals section 3), generalised for repeating goals
// (docs/plans/recurring-goals.md E2). KPI reviews pass a "YYYY-MM" month and
// must get exactly the month control they always had; the goal page passes
// its periods and steps through those.

import { describe, expect, it } from "vitest";
import { createElement as h } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { MonthControl } from "./month-control";

const render = (p: Partial<Parameters<typeof MonthControl>[0]>) =>
  renderToStaticMarkup(h(MonthControl, { value: "2026-09", onChange: () => {}, ...p }));
const disabled = (html: string, label: string) => new RegExp(`disabled=""[^>]*aria-label="${label}"`).test(html);

describe("the month default is unchanged for KPI reviews", () => {
  it("reads the month, names the group Month and its arrows month by month", () => {
    const html = render({});
    expect(html).toContain("September 2026");
    expect(html).toContain('role="group" aria-label="Month"');
    expect(html).toContain('aria-label="Previous month"');
    expect(html).toContain('aria-label="Next month"');
    expect(disabled(html, "Previous month")).toBe(false);
    expect(disabled(html, "Next month")).toBe(false);
  });

  it("disables Next beyond max and Previous before min, as before", () => {
    expect(disabled(render({ max: "2026-09" }), "Next month")).toBe(true);
    expect(disabled(render({ max: "2026-10" }), "Next month")).toBe(false);
    expect(disabled(render({ min: "2026-09" }), "Previous month")).toBe(true);
    expect(disabled(render({ min: "2026-08" }), "Previous month")).toBe(false);
  });
});

describe("periods: a repeating goal's own periods", () => {
  const periods = [
    { key: "2026-08-01", label: "August 2026" },
    { key: "2026-09-01", label: "September 2026" },
    { key: "2026-10-01", label: "October 2026" },
  ];

  it("shows the period's label and steps through the list, not the calendar", () => {
    const html = render({ periods, value: "2026-09-01" });
    expect(html).toContain("September 2026");
    expect(html).toContain('role="group" aria-label="Period"');
    expect(html).toContain('aria-label="Previous period"');
    expect(disabled(html, "Previous period")).toBe(false);
    expect(disabled(html, "Next period")).toBe(false);
  });

  it("Next stops at the period running now (the last), Previous at the first", () => {
    expect(disabled(render({ periods, value: "2026-10-01" }), "Next period")).toBe(true);
    expect(disabled(render({ periods, value: "2026-08-01" }), "Previous period")).toBe(true);
  });

  it("a quarter or a week reads its own label", () => {
    expect(render({ periods: [{ key: "2026-10-01", label: "Q3 FY27" }], value: "2026-10-01" })).toContain("Q3 FY27");
  });
});
