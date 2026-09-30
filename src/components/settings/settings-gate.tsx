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
import { sessionIsSettingsReader, sessionIsWorkspaceAdmin, sessionMayManageOwnerPage } from "@/lib/access/workspace-admin";
import { SETTINGS_PAGES } from "@/lib/settings-registry";
import { LEGACY_SETTINGS_RULES, OWNER_SETTINGS_PAGES as OWNER_PAGES, type LegacySettingsRule } from "@/lib/access/settings-legacy";
import type { SettingsPageKey } from "@/lib/access/types";
import { can, viewerFromSession } from "@/lib/access/index";
import { accessV2Resolver, delegateOn, settingsGateLogOnly } from "@/lib/access/flags";
import { SETTINGS_PAGE_GATES } from "@/lib/access/settings";
import { engineWithOwnerFloor, logSettingsGateDisagreement, settingsGateDecision, settingsGateMode } from "@/lib/access/settings-gate-engine";
import AccountProfilePage from "@/app/(dashboard)/account/profile/page";
import { ActiveSettingsRow } from "./settings-active-row";

export type { LegacySettingsRule };
export { LEGACY_SETTINGS_RULES };

async function legacySettingsGate(page: SettingsPageKey): Promise<boolean> {
  const rule = LEGACY_SETTINGS_RULES[page];
  if (!rule) return true;
  const ok = rule === "admin" ? await isOrgAdminViewer() : await requireManagerTierViewer();
  if (!ok || !OWNER_PAGES.has(page)) return ok;
  // With SETTINGS_OWNER_SPLIT on, an Admin who is not an Owner gets the
  // AdminOnly card on these three; off (the default), every Admin opens them.
  return sessionMayManageOwnerPage(await getServerSession(authOptions));
}

/**
 * The door gate. Today's table while the flags are off; with
 * SETTINGS_GATE_LOG_ONLY on the engine is asked too and every disagreement
 * is logged (today still decides); with ACCESS_V2_RESOLVER on (log-only off)
 * the engine decides, the Owner split's floor kept (settings-gate-engine.ts).
 */
export async function settingsGateAllows(page: SettingsPageKey): Promise<boolean> {
  const legacy = await legacySettingsGate(page);
  const mode = settingsGateMode({ resolver: accessV2Resolver(), logOnly: settingsGateLogOnly() });
  if (mode === "legacy" || !LEGACY_SETTINGS_RULES[page]) return legacy;
  const session = await getServerSession(authOptions);
  const viewer = await viewerFromSession();
  if (!viewer) return legacy;
  const decision = await can(viewer, "view", { type: "settings", page });
  const ownerPage = OWNER_PAGES.has(page);
  const inputs = {
    legacy,
    engine: decision.allowed,
    ownerPage,
    workspaceAdmin: sessionIsWorkspaceAdmin(session),
    mayManageOwnerPage: ownerPage ? await sessionMayManageOwnerPage(session) : false,
  };
  const verdict = settingsGateDecision(mode, inputs);
  if (verdict.disagree) {
    logSettingsGateDisagreement({ userId: viewer.userId, organizationId: viewer.organizationId, page, legacy, engine: engineWithOwnerFloor(inputs), mode });
  }
  return verdict.allowed;
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
  // A reader below Admin (the manager tier) is told which Workspace pages
  // they DO open, so the strip is never a dead end (sidebar-map 8a).
  // Under the engine gate the reader's pages are the People team's four
  // (the manager tier opens none); under today's table the manager-tier three.
  let openable: { label: string; href: string }[] | undefined;
  if (delegateOn("settings")) {
    const viewer = await viewerFromSession();
    openable = viewer?.peopleTeam
      ? (Object.entries(SETTINGS_PAGE_GATES) as [SettingsPageKey, { peopleTeamRead?: boolean }][])
          .filter(([, g]) => g.peopleTeamRead === true)
          .map(([k]) => ({ label: SETTINGS_PAGES[k].label, href: SETTINGS_PAGES[k].href }))
      : undefined;
  } else {
    openable = sessionIsSettingsReader(session)
      ? (Object.entries(LEGACY_SETTINGS_RULES) as [SettingsPageKey, LegacySettingsRule][])
          .filter(([, r]) => r === "manager-tier")
          .map(([k]) => ({ label: SETTINGS_PAGES[k].label, href: SETTINGS_PAGES[k].href }))
      : undefined;
  }
  return (
    <>
      <ActiveSettingsRow pageKey="account/profile" />
      <AskAnAdminStrip pageLabel={label === SETTINGS_PAGES.overview.label ? "Workspace settings" : label} admins={admins} openable={openable} />
      <AccountProfilePage />
    </>
  );
}

export async function SettingsGate({ page, children }: { page: SettingsPageKey; children: ReactNode }) {
  if (!(await settingsGateAllows(page))) return <SettingsDenied page={page} />;
  return <>{children}</>;
}
