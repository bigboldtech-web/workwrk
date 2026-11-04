// A job title's People tab (docs/plans/workspace-status-2.md, the final
// review, product L3): a holder here through a membership is given no KRA
// here (the step 5 review M1), so the slot where everyone else's row says
// "Up to date" or "Missing N of M KRAs" says so in words, never nothing, so
// HR does not read their silence as fine.

import { describe, expect, it, vi } from "vitest";
import { createElement as h } from "react";
import { renderToStaticMarkup } from "react-dom/server";

vi.mock("next/navigation", () => ({ useRouter: () => ({ push: () => {}, refresh: () => {}, replace: () => {}, back: () => {} }), usePathname: () => "/people/roles/r1" }));
vi.mock("@/components/layout/os/toast", () => ({ useOsToast: () => ({ toast: () => {} }) }));
vi.mock("@/components/layout/os/boot-context", () => ({ useBoot: () => ({ boot: { prefs: {} } }) }));
// The page's frame is its own components' (tested there).
vi.mock("@/components/layout/os/top-bar/breadcrumb", () => ({ Breadcrumb: () => null }));
vi.mock("@/components/layout/os/page-header", () => ({ OsPageHeader: () => null }));

import { KRAS_NOT_HERE, RoleWorkspace, SEED_NOT_HERE, type RoleBundle } from "./role-workspace";
import { ALIGNMENT_NOT_HERE } from "@/lib/people/person-fields";

const holder = (id: string, missingKras: number | null, elsewhere?: boolean) => ({
  id, firstName: id[0].toUpperCase() + id.slice(1), lastName: "Ng", email: `${id}@x.test`, avatar: null, missingKras, ...(elsewhere ? { elsewhere } : {}),
});
const bundle = (kras: number, people: RoleBundle["people"]): RoleBundle => ({
  role: { id: "r1", title: "Designer", description: null, level: "MID", department: null },
  kras: Array.from({ length: kras }, (_, i) => ({ id: `k${i}`, name: `KRA ${i}`, description: null, category: null, weight: 50, kpis: [], sops: [] })),
  ownedAreas: [], boundaries: [], thresholds: [], instances: [], people, allAreas: [], allRoles: [], allKras: [], scopes: [], orgUsers: [],
});
const rowOf = (markup: string, name: string) => {
  const at = markup.indexOf(`>${name}<`);
  return markup.slice(markup.lastIndexOf("<li", at), markup.indexOf("</li>", at));
};

describe("a job title's People tab", () => {
  it("says a holder here through a membership has no KRAs assigned here, where Lee's says Up to date and Bea's what she misses", () => {
    const markup = renderToStaticMarkup(h(RoleWorkspace, { bundle: bundle(2, [holder("lee", 0), holder("bea", 1), holder("pat", null)]), canEdit: true, tab: "people" }));
    expect(rowOf(markup, "Lee Ng")).toContain("Up to date");
    expect(rowOf(markup, "Bea Ng")).toContain("Missing 1 of 2 KRAs");
    // Before: Pat's row said nothing at all.
    expect(rowOf(markup, "Pat Ng")).toContain(KRAS_NOT_HERE);
    expect(rowOf(markup, "Pat Ng")).not.toMatch(/Up to date|Missing|Seed/);
    expect(KRAS_NOT_HERE).toBe("KRAs not assigned here");
  });

  // The fixes review, finding 8: the page now counts what a holder here
  // through a membership holds of the title's KRAs (role-page-drift.test.ts),
  // so the row says the real state, and never offers a Seed the server
  // refuses for them.
  it("shows a holder here through a membership what she holds: Up to date, what she misses with no Seed, or none assigned here", () => {
    const markup = renderToStaticMarkup(h(RoleWorkspace, { bundle: bundle(2, [holder("pat", 0, true), holder("ivy", 1, true), holder("zoe", 2, true), holder("bea", 1)]), canEdit: true, tab: "people" }));
    // Before: the count was ignored for them, so every row read "KRAs not assigned here" (or, sent a count, offered a Seed that is refused).
    expect(rowOf(markup, "Pat Ng")).toContain("Up to date");
    expect(rowOf(markup, "Pat Ng")).not.toContain(KRAS_NOT_HERE);
    expect(rowOf(markup, "Ivy Ng")).toContain("Missing 1 of 2 KRAs");
    const escaped = (words: string) => words.replace(/'/g, "&#x27;");
    expect(rowOf(markup, "Ivy Ng")).toContain(escaped(SEED_NOT_HERE));
    expect(rowOf(markup, "Ivy Ng")).toContain(`title="${escaped(ALIGNMENT_NOT_HERE)}"`);
    expect(rowOf(markup, "Ivy Ng")).not.toMatch(/<button[^>]*>Seed<\/button>/);
    expect(rowOf(markup, "Zoe Ng")).toContain(KRAS_NOT_HERE);
    expect(rowOf(markup, "Zoe Ng")).not.toMatch(/Missing|<button/);
    // Someone anchored here keeps the Seed.
    expect(rowOf(markup, "Bea Ng")).toMatch(/<button[^>]*>Seed<\/button>/);
    expect(SEED_NOT_HERE).toBe("Can't be seeded here");
  });

  it("says nothing of KRAs for a job title that carries none, or to someone who can't edit it, as for everyone", () => {
    expect(rowOf(renderToStaticMarkup(h(RoleWorkspace, { bundle: bundle(0, [holder("pat", null)]), canEdit: true, tab: "people" })), "Pat Ng")).not.toContain(KRAS_NOT_HERE);
    expect(rowOf(renderToStaticMarkup(h(RoleWorkspace, { bundle: bundle(2, [holder("pat", null)]), canEdit: false, tab: "people" })), "Pat Ng")).not.toContain(KRAS_NOT_HERE);
  });
});
