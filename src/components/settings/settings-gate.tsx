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
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { isOrgAdminViewer, requireManagerTierViewer } from "@/lib/route-guard";
import { AdminOnly, AskAnAdminStrip } from "@/components/access";
import { listOrgAdmins } from "@/lib/access/admins";
import { sessionIsWorkspaceAdmin, sessionMayManageOwnerPage } from "@/lib/access/workspace-admin";
import { SETTINGS_PAGES } from "@/lib/settings-registry";
import type { SettingsPageKey } from "@/lib/access/types";
import AccountProfilePage from "@/app/(dashboard)/account/profile/page";
import { ActiveSettingsRow } from "./settings-active-row";

export type LegacySettingsRule = "admin" | "manager-tier";

/** Today's rule per Workspace page (the per-directory layouts it replaces). */
export const LEGACY_SETTINGS_RULES: Readonly<Partial<Record<SettingsPageKey, LegacySettingsRule>>> = {
  overview: "admin",
  identity: "admin",
  locale: "admin",
  apps: "admin",
  // Structure gated inside its page before; the same admin rule, now here.
  structure: "admin",
  // Members, Access and Scoring admitted the manager tier (read-only below
  // Admin; the invitations API admits the tier). Kept until the engine gate
  // narrows them to Owner, Admin and the People team with its logged week.
  members: "manager-tier",
  access: "manager-tier",
  scoring: "manager-tier",
  tasks: "admin",
  security: "admin",
  data: "admin",
  audit: "admin",
  api: "admin",
  billing: "admin",
  all: "admin",
};

/** The Owner-or-scope pages (settings spec 1.2 rows 10, 13, 14). */
const OWNER_PAGES: ReadonlySet<SettingsPageKey> = new Set<SettingsPageKey>(["security", "api", "billing"]);

export async function settingsGateAllows(page: SettingsPageKey): Promise<boolean> {
  const rule = LEGACY_SETTINGS_RULES[page];
  if (!rule) return true;
  const ok = rule === "admin" ? await isOrgAdminViewer() : await requireManagerTierViewer();
  if (!ok || !OWNER_PAGES.has(page)) return ok;
  // With SETTINGS_OWNER_SPLIT on, an Admin who is not an Owner gets the
  // AdminOnly card on these three; off (the default), every Admin opens them.
  return sessionMayManageOwnerPage(await getServerSession(authOptions));
}

/**
 * What a signed-in person who may not open a Workspace page sees at the URL
 * they typed (spec-settings-workspace 1.4, the two denial views):
 *
 *   an Admin (a page an Owner-only scope holds)  the AdminOnly card, inside
 *                                                the Workspace door
 *   everyone else                                the Ask-an-admin strip over
 *                                                their own My settings >
 *                                                Profile, fully working
 *
 * Never a redirect, never a 404.
 */
export async function SettingsDenied({ page }: { page: SettingsPageKey }) {
  const label = SETTINGS_PAGES[page]?.label ?? "This page";
  const session = await getServerSession(authOptions);
  if (sessionIsWorkspaceAdmin(session)) {
    return <AdminOnly page={label} managedBy="Owners" back={{ fallbackHref: "/settings", label: "Back to Overview" }} />;
  }
  const orgId = (session?.user as { organizationId?: string } | undefined)?.organizationId ?? null;
  const admins = orgId ? await listOrgAdmins(orgId, 5) : [];
  return (
    <>
      <ActiveSettingsRow pageKey="account/profile" />
      <AskAnAdminStrip pageLabel={label === SETTINGS_PAGES.overview.label ? "Workspace settings" : label} admins={admins} />
      <AccountProfilePage />
    </>
  );
}

export async function SettingsGate({ page, children }: { page: SettingsPageKey; children: ReactNode }) {
  if (!(await settingsGateAllows(page))) return <SettingsDenied page={page} />;
  return <>{children}</>;
}
