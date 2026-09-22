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
  // `manager`, matching the gate on the hub's own default href: /people
  // calls requireManagerPage(). sidebar-map section 5 wants this tier gone
  // and the Directory opened to every Member; that is a change to two page
  // gates, not to this table, and it belongs to the Teams unit.
  { key: "teams", label: "Teams", defaultHref: "/people", requiredAccess: "manager" },
  { key: "docs", label: "Docs", defaultHref: "/docs" },
  { key: "tables", label: "Tables", defaultHref: "/tables" },
  { key: "library", label: "Files", defaultHref: "/files" },
  { key: "forms", label: "Forms", defaultHref: "/forms" },
  { key: "clips", label: "Notetaker", defaultHref: "/notetaker" },
  { key: "goals", label: "Goals", defaultHref: "/okrs" },
  { key: "timesheets", label: "Timesheets", defaultHref: "/timesheets" },
  { key: "meetings", label: "Meetings", defaultHref: "/meetings" },
  { key: "clock", label: "Clock in/out", defaultHref: "/clock" },
  { key: "reviews", label: "Review cycles", defaultHref: "/reviews", requiredAccess: "hr-admin" },
  { key: "candor", label: "Candor", defaultHref: "/candor", requiredAccess: "hr-admin" },
  { key: "announcements", label: "Announcements", defaultHref: "/announcements" },
  { key: "kudos", label: "Kudos", defaultHref: "/kudos", requiredAccess: "hr-admin" },
  { key: "surveys", label: "Surveys", defaultHref: "/surveys", requiredAccess: "hr-admin" },
  { key: "tools", label: "Tools", defaultHref: "/tools", requiredAccess: "hr-admin" },
  { key: "assets", label: "Assets", defaultHref: "/assets", requiredAccess: "hr-admin" },
  { key: "sops", label: "SOPs", defaultHref: "/sops" },
  { key: "policies", label: "Policies", defaultHref: "/policies", requiredAccess: "hr-admin" },
  { key: "agreements", label: "Contracts", defaultHref: "/agreements", requiredAccess: "hr-admin" },
  { key: "build", label: "Build apps", defaultHref: "/build" },
  { key: "store", label: "Marketplace", defaultHref: "/store" },
  { key: "automation", label: "Automation", defaultHref: "/automation/workflows", requiredAccess: "manager" },
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
