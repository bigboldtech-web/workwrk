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
// does not move anyone's access). `admin` is SUPER_ADMIN and COMPANY_ADMIN; `manager-tier` is everyone
// above Employee and Agent (settings-legacy.ts; route-guard.ts, which held
// the same two answers, is deleted). The engine gate (gatePage over
// SETTINGS_PAGE_GATES, first week log-only under SETTINGS_GATE_LOG_ONLY) is
// the next stage and replaces this table, not the call sites.
//
// Denial is the AdminOnly card at the same URL: never a redirect, never a
// 404 (nothing under /settings 404s for a signed-in person).

import type { ReactNode } from "react";
import { getServerSession } from "next-auth";
import { redirect } from "next/navigation";
import { authOptions } from "@/lib/auth";
import { AdminOnly, AskAnAdminStrip } from "@/components/access";
import { listOrgAdmins } from "@/lib/access/admins";
import { sessionIsSettingsReader, sessionIsWorkspaceAdmin } from "@/lib/access/workspace-admin";
import { settingsDoorAllows, settingsReaderPagesFor } from "@/lib/access/settings-door";
import { SETTINGS_PAGES } from "@/lib/settings-registry";
import { LEGACY_SETTINGS_RULES, type LegacySettingsRule } from "@/lib/access/settings-legacy";
import type { SettingsPageKey } from "@/lib/access/types";
import { delegateOn } from "@/lib/access/flags";
import AccountProfilePage from "@/app/(dashboard)/account/profile/page";
import { ActiveSettingsRow } from "./settings-active-row";

export type { LegacySettingsRule };
export { LEGACY_SETTINGS_RULES };

/**
 * The door gate: ONE decision shared with the reader sidebar in /api/boot and
 * the data APIs behind the reader pages (src/lib/access/settings-door.ts).
 * Today's table while the flags are off; with SETTINGS_GATE_LOG_ONLY on the
 * engine is asked too and every disagreement is logged (today still decides);
 * with ACCESS_V2_RESOLVER on (log-only off) the engine decides, the Owner
 * split's floor kept (settings-gate-engine.ts).
 */
export async function settingsGateAllows(page: SettingsPageKey): Promise<boolean> {
  const session = await getServerSession(authOptions);
  // Signed out: the sign-in page, as the route-guard gates this replaced did.
  if (!session?.user) redirect("/login");
  return settingsDoorAllows(page, session, { visit: true });
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
    // The pages the one door decision opens for them (settings-door.ts), the
    // same list the frame's reader sidebar draws.
    const pages = await settingsReaderPagesFor(session);
    openable = pages.length > 0 ? pages.map((k) => ({ label: SETTINGS_PAGES[k].label, href: SETTINGS_PAGES[k].href })) : undefined;
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
      <AskAnAdminStrip
        pageLabel={label === SETTINGS_PAGES.overview.label ? "Workspace settings" : label}
        admins={admins}
        openable={openable}
        // Data > Import took over /imports, whose card pointed a Member at
        // the table importer: that pointer stays, so an old bookmark is
        // never a dead end.
        instead={page === "data" ? { label: "Import a CSV into a table", href: "/tables?import=1" } : undefined}
      />
      <AccountProfilePage />
    </>
  );
}

export async function SettingsGate({ page, children }: { page: SettingsPageKey; children: ReactNode }) {
  if (!(await settingsGateAllows(page))) return <SettingsDenied page={page} />;
  return <>{children}</>;
}
