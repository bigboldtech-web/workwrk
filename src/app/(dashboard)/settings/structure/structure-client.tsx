"use client";

// The Structure tabs (see page.tsx). Departments and Job titles are the same
// DepartmentsManager and JobTitlesList the Teams hub renders, each drawing
// its own toolbar (Filter, the Sort chip, its create button) into the page
// header's toolbar row (the tabs say ownToolbar, SettingsToolbar); Offices
// is real CRUD with the tab's one blue button and its "..." in that same
// row; Profile fields draws its own New field there (who may add one is its
// read's answer); Org chart is a link card to the one chart at /organization.
// Every tab holds that row, so the first card starts at one height on all
// five (final Settings review, M3).
//
// Body order on every tab (settings-cleanup Phase 4; spec-settings-workspace
// `/settings/structure`, "the first element of the body"): the role strip at
// the page's width, then the tab's own content, 24px apart. The header stack
// above them is the same on every tab (title, subtitle, tabs, toolbar).

import { Suspense, useState } from "react";
import Link from "next/link";
import { Download } from "lucide-react";
import { SettingsPage, type SettingsTab } from "@/components/settings/settings-page";
import { SettingsCard } from "@/components/settings/settings-card";
import { DepartmentsManager } from "@/components/people/departments-manager";
import { JobTitlesList } from "@/components/people/job-titles-list";
import { ProfileFieldsManager } from "@/components/people/profile-fields-manager";
import { OfficesManager, downloadOfficesCsv } from "@/components/settings/offices-manager";
import { btn } from "@/components/settings/settings-form";
import { useOsToast } from "@/components/layout/os/toast";
import { SETTINGS_PAGES, settingsTabs } from "@/lib/settings-registry";
import type { RoleCounts } from "@/lib/access/role-counts";

/** Job titles' one caption (spec-settings-workspace): the role strip's last line on that tab, never a line floating over the table. */
export const JOB_TITLES_NOTE = "Job titles describe the work. They never change what someone can open.";

/**
 * The heights Departments' and Job titles' toolbars really take at each
 * width, held by the header before they arrive (settings-cleanup Phase 4
 * review, L3). Measured at 1px steps from 300 to 960 in the settings
 * takeover, rail included, with and without the create button (an editor's
 * "New department" or "New job title"):
 *
 *   Departments  44 from 565 (397 without New), 88 from 353, 128 below
 *                (Filter and Sort, the Table and Tree switch, then New and
 *                "...")
 *   Job titles   44 from 445 (306 without New), 88 below
 *
 * The create button arrives with the list's answer, after the toolbar, so
 * the row is held for the toolbar the viewer ends with. Literal strings, so
 * the stylesheet holds every class.
 */
export const STRUCTURE_TOOLBAR_ROW = {
  departments: { edit: "min-h-11 max-[565px]:min-h-[88px] max-[353px]:min-h-[128px]", read: "min-h-11 max-[397px]:min-h-[88px] max-[353px]:min-h-[128px]" },
  titles: { edit: "min-h-11 max-[445px]:min-h-[88px]", read: "min-h-11 max-[306px]:min-h-[88px]" },
} as const;

/**
 * The Structure tabs with what each puts in the header's toolbar row (pure;
 * tested): Departments and Job titles draw their own toolbar (their filter
 * panel, sort and create live in them), held at their measured heights;
 * Offices hands "New office" and its "..." (Export CSV) to the header for an
 * editor, the shape of the other two; Profile fields draws its own New
 * field (ownToolbar, one 44px line); Org chart has none, and holds the row
 * empty (SettingsPage).
 */
export function structureTabs(canEdit: boolean, onNewOffice: () => void, onExportOffices: () => void = () => {}): SettingsTab[] {
  return settingsTabs("structure").map((t) =>
    t.key === "departments" || t.key === "titles"
      ? { ...t, ownToolbar: true, toolbarRow: STRUCTURE_TOOLBAR_ROW[t.key === "titles" ? "titles" : "departments"][canEdit ? "edit" : "read"] }
      : t.key === "fields"
        ? { ...t, ownToolbar: true }
        : t.key === "offices" && canEdit
          ? { ...t, primary: { label: "New office", onClick: onNewOffice }, menu: [{ label: "Export CSV", icon: Download, onClick: onExportOffices }] }
          : t,
  );
}

export function StructureClient({ counts, unlinked, canEdit }: { counts: RoleCounts; unlinked: number; canEdit: boolean }) {
  const [createOffice, setCreateOffice] = useState(0);
  const { toast } = useOsToast();
  const tabs = structureTabs(
    canEdit,
    () => setCreateOffice((n) => n + 1),
    () => { void downloadOfficesCsv().then((ok) => { if (!ok) toast("Couldn't export the offices. Try again."); }); },
  );
  return (
    <SettingsPage pageKey="structure" tabs={tabs} width="list">
      {(tab) => (
        <div className="flex flex-col gap-6">
          <RoleStrip counts={counts} note={tab === "titles" ? JOB_TITLES_NOTE : undefined} />
          {/* One block: the managers render several siblings (a picker
              anchor, the filter panel and its table), which must not each
              take this column's 24px gap. */}
          <div className="flex flex-col">
            <Suspense>
              {tab === "titles" ? (
                <JobTitlesList door="settings" />
              ) : tab === "offices" ? (
                <OfficesManager canEdit={canEdit} createSignal={createOffice} />
              ) : tab === "fields" ? (
                <ProfileFieldsManager />
              ) : tab === "chart" ? (
                <OrgChartCard unlinked={unlinked} />
              ) : (
                <DepartmentsManager door="settings" />
              )}
            </Suspense>
          </div>
        </div>
      )}
    </SettingsPage>
  );
}

export function RoleStrip({ counts, note }: { counts: RoleCounts; note?: string }) {
  const items: { label: string; n: number; line: string; filter: string }[] = [
    { label: "Owners", n: counts.owners, line: "Runs the company account", filter: "role:owner" },
    { label: "Admins", n: counts.admins, line: "Runs the workspace", filter: "role:admin" },
    { label: "Members", n: counts.members, line: "Works here", filter: "role:member" },
    { label: "Guests", n: counts.guests, line: "Sees only what is shared", filter: "role:guest" },
    { label: "People team", n: counts.peopleTeam, line: "Looks after everyone's people information", filter: "peopleteam" },
  ];
  return (
    // The one card (24px padding, the page's width), kept to the spec's one
    // line of counters: from 1000px each counter is as wide as its words
    // (a grid of content-sized columns, spread across the card, which give
    // way only if the card is narrower than the words), so no line wraps at
    // 1440; narrower, the counters sit three to a line, and two on a phone,
    // never one tall column. A counter's hover is its underline, so the
    // words start on the card's own edge.
    <SettingsCard>
      <div role="group" aria-label="Roles" className="grid grid-cols-2 items-start gap-x-4 gap-y-3 min-[640px]:grid-cols-3 min-[1000px]:grid-cols-none min-[1000px]:grid-flow-col min-[1000px]:justify-between">
        {items.map((it) => (
          <Link key={it.label} href={`/settings/members?filter=${it.filter}`} className="group min-w-0">
            <div className="text-base text-ink group-hover:underline">
              {it.label} <span className="font-semibold tabular-nums">{it.n}</span>
            </div>
            <div className="text-sm text-ink-2">{it.line}</div>
          </Link>
        ))}
        <Link href="/settings/access" className="self-center whitespace-nowrap text-sm font-medium text-brand-deep hover:underline">
          How access works
        </Link>
      </div>
      {note ? <p className="m-0 border-t border-line-soft pt-4 text-sm text-ink-2">{note}</p> : null}
    </SettingsCard>
  );
}

// A link card (B4): a title, one line, the text link as the card's title
// action (as Templates, API and Connections put theirs; final Settings
// review, M5), no illustration; the body is the one live status line, who
// has no manager and where that is fixed.
export function OrgChartCard({ unlinked }: { unlinked: number }) {
  return (
    <SettingsCard
      title="Org chart"
      description="Your reporting lines live in the org chart, with the people directory beside them."
      actions={<Link href="/organization" className={btn.link}>Open the org chart</Link>}
    >
      <p className="m-0 text-sm text-ink-2">
        No manager: {unlinked} {unlinked === 1 ? "person" : "people"} ·{" "}
        <Link href="/settings/members?filter=unlinked" className="font-medium text-brand-deep underline underline-offset-2">Fix in {SETTINGS_PAGES.members.label}</Link>
      </p>
    </SettingsCard>
  );
}
