// The premium modules — the ONE registry the rail gate, the route gate, the
// entitlement resolver, and Settings → Modules all read. A module ties a rail
// app (by AppEntry.key in apps-catalog) to its Product (by slug, in
// lib/products/catalog + the ProductInstallation table) and carries the
// customer-facing copy for the toggle.
//
// Pure data, no imports — safe on the client (rail filter) and the server
// (entitlement resolver, route gate). Adding a module is a one-line change
// here plus a Product row in lib/products/catalog.ts.

export interface ModuleDef {
  /** AppEntry.key in src/components/layout/os/apps-catalog.tsx. */
  appKey: string;
  /** Product.slug in lib/products/catalog.ts and the ProductInstallation row. */
  productSlug: string;
  /** Shown on the Settings → Modules card. */
  label: string;
  /** "what it competes with", shown under the label. */
  competesWith: string;
  /** One-line description of what turning it on gives the org. */
  blurb: string;
}

export const MODULES: ModuleDef[] = [
  {
    appKey: "chat",
    productSlug: "workwrk-talk",
    label: "Talk",
    competesWith: "Slack + Zoom",
    blurb: "Channels, DMs, threads, reactions, huddles and calls on your own server.",
  },
  {
    appKey: "tables",
    productSlug: "workwrk-tables",
    label: "Tables",
    competesWith: "Google Sheets + Zoho Sheet",
    blurb: "A real spreadsheet: 78 formula functions, data validation, conditional formatting.",
  },
];

/** Rail app keys that are premium modules (everything else is core). */
export const MODULE_APP_KEYS: ReadonlySet<string> = new Set(MODULES.map((m) => m.appKey));

/** Product slugs that back a module. */
export const MODULE_SLUGS: readonly string[] = MODULES.map((m) => m.productSlug);

export const MODULE_BY_APP_KEY: Record<string, ModuleDef> = Object.fromEntries(
  MODULES.map((m) => [m.appKey, m]),
);

export const MODULE_BY_SLUG: Record<string, ModuleDef> = Object.fromEntries(
  MODULES.map((m) => [m.productSlug, m]),
);
