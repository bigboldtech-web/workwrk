// Server-safe mirror of the app catalog's ACCESS data.
//
// src/components/layout/os/apps-catalog.tsx is a "use client" module (it
// carries icons and sidebars), so a route handler cannot read `APPS` from it:
// inside the server bundle its exports are client references. /api/boot
// needs the same rail the client resolves (spec-shell section 2.1 `apps`),
// so this pure table carries exactly the fields `visibleRailApps` reads, in
// catalog order, and the vitest parity test (app-access.test.ts) parses the
// catalog SOURCE to prove the two never drift.
//
// Pure: imports only the folded-app table (no imports of its own).

import { FOLDED_APP_HUB, WORK_HOME_HREF } from "./nav/route-hub";
import type { AppLike } from "./rail-apps";

type Row = Omit<AppLike, "hubKey">;

const ROWS: readonly Row[] = [
  { key: "home", label: "Work", defaultHref: WORK_HOME_HREF, alwaysPinned: true },
  { key: "planner", label: "Planner", defaultHref: "/planner" },
  { key: "ai", label: "AI", defaultHref: "/sidekick" },
  { key: "chat", label: "Talk", defaultHref: "/tlk" },
  // Every Member (Phase 6): /people opens to every Member, so the pill can
  // never land on a locked page.
  { key: "teams", label: "Teams", defaultHref: "/people" },
  { key: "docs", label: "Docs", defaultHref: "/docs" },
  { key: "tables", label: "Tables", defaultHref: "/tables" },
  { key: "library", label: "Files", defaultHref: "/files" },
  { key: "forms", label: "Forms", defaultHref: "/forms" },
  { key: "clips", label: "Notetaker", defaultHref: "/notetaker" },
  { key: "goals", label: "Goals", defaultHref: "/okrs" },
  { key: "timesheets", label: "Timesheets", defaultHref: "/timesheets" },
  { key: "meetings", label: "Meetings", defaultHref: "/meetings" },
  { key: "clock", label: "Clock in/out", defaultHref: "/clock" },
  { key: "reviews", label: "Review cycles", defaultHref: "/reviews", requiredAccess: "manager" },
  { key: "candor", label: "Candor", defaultHref: "/candor", requiredAccess: "manager" },
  { key: "announcements", label: "Announcements", defaultHref: "/announcements" },
  { key: "kudos", label: "Kudos", defaultHref: "/kudos" },
  { key: "surveys", label: "Surveys", defaultHref: "/surveys", requiredAccess: "hr-admin" },
  // Tools: every Member. Assets: anyone with reports, the People team and
  // Admin, which no tier can express, so the row and the palette gate on
  // appAudienceAllows (src/lib/nav/app-audience.ts) and the page on gatePage.
  { key: "tools", label: "Tools", defaultHref: "/tools" },
  { key: "assets", label: "Assets", defaultHref: "/assets" },
  { key: "sops", label: "SOPs", defaultHref: "/sops" },
  { key: "policies", label: "Policies", defaultHref: "/policies", requiredAccess: "hr-admin" },
  { key: "agreements", label: "Contracts", defaultHref: "/agreements", requiredAccess: "hr-admin" },
  // APP_RULES.build is Owner and Admin.
  { key: "build", label: "Build apps", defaultHref: "/build", requiredAccess: "org-admin" },
  { key: "store", label: "Marketplace", defaultHref: "/store" },
  // APP_RULES.automation: every Member reads (the manager tier is retired).
  { key: "automation", label: "Automation", defaultHref: "/automation/workflows" },
  { key: "settings", label: "Settings", defaultHref: "/settings", alwaysPinned: true },
  // No tier: the manager gate came off when /api/trash moved onto the `trash`
  // app key and per-source accessibleIds(type, FULL) in Phase 2 stage E. Guests
  // are kept out by APP_RULES.trash (guest: "none"), not by a tier.
  { key: "trash", label: "Trash", defaultHref: "/trash" },
];

/** Catalog order, with `hubKey` stamped the way apps-catalog.tsx stamps it. */
export const APP_ACCESS: readonly AppLike[] = ROWS.map((r) => {
  const hub = FOLDED_APP_HUB[r.key];
  return hub ? { ...r, hubKey: hub } : { ...r };
});

export const APP_ACCESS_BY_KEY: Readonly<Record<string, AppLike>> = Object.fromEntries(APP_ACCESS.map((a) => [a.key, a]));
