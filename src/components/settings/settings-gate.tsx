// SettingsGate: the ONE gate for Workspace settings pages, as a server
// component each page segment's layout renders (spec-settings-workspace 1.4).
//
// Why a component in each segment and not one check in settings/layout.tsx:
// Next.js layouts do not re-render on client navigation and cannot read the
// pathname (node_modules/next/dist/docs/01-app/03-api-reference/03-file-
// conventions/layout.md, "Layouts do not rerender"). A single path-keyed
// check in the parent layout would run once, on the first settings page a
// person opened, and then let a client-side hop to any sibling page through
// ungated. A segment layout DOES render when its segment is entered, so the
// check lives there, and every segment's layout is the same two lines over
// this one table.
//
// THE RULE TABLE IS TODAY'S, UNCHANGED (Stage A of Phase 8 consolidates, it
// does not move anyone's access). `admin` is route-guard isOrgAdminViewer
// (SUPER_ADMIN, COMPANY_ADMIN); `manager-tier` is requireManagerTierViewer
// (everyone above Employee and Agent). The engine gate (gatePage over
// SETTINGS_PAGE_GATES, first week log-only under SETTINGS_GATE_LOG_ONLY) is
// the next stage and replaces this table, not the call sites.
//
// Denial is the AdminOnly card at the same URL: never a redirect, never a
// 404 (nothing under /settings 404s for a signed-in person).

import type { ReactNode } from "react";
import { isOrgAdminViewer, requireManagerTierViewer } from "@/lib/route-guard";
import { AdminOnly } from "@/components/access";
import { SHELL_LABELS } from "@/lib/nav/labels";
import { SETTINGS_PAGES } from "@/lib/settings-registry";
import type { SettingsPageKey } from "@/lib/access/types";

export type LegacySettingsRule = "admin" | "manager-tier";

/** Today's rule per Workspace page (the per-directory layouts it replaces). */
export const LEGACY_SETTINGS_RULES: Readonly<Partial<Record<SettingsPageKey, LegacySettingsRule>>> = {
  overview: "admin",
  identity: "admin",
  locale: "admin",
  apps: "admin",
  // Members, Access and Scoring admitted the manager tier (read-only below
  // Admin; the invitations API admits the tier). Kept until the engine gate
  // narrows them to Owner, Admin and the People team with its logged week.
  members: "manager-tier",
  access: "manager-tier",
  scoring: "manager-tier",
  tasks: "admin",
  data: "admin",
  audit: "admin",
  api: "admin",
  billing: "admin",
  all: "admin",
};

export async function settingsGateAllows(page: SettingsPageKey): Promise<boolean> {
  const rule = LEGACY_SETTINGS_RULES[page];
  if (!rule) return true;
  return rule === "admin" ? isOrgAdminViewer() : requireManagerTierViewer();
}

export async function SettingsGate({ page, children }: { page: SettingsPageKey; children: ReactNode }) {
  if (!(await settingsGateAllows(page))) {
    return (
      <AdminOnly
        page={SETTINGS_PAGES[page]?.label ?? "This page"}
        back={{ fallbackHref: "/account/profile", label: SHELL_LABELS.mySettings }}
      />
    );
  }
  return <>{children}</>;
}
