"use client";

// The Structure tabs (see page.tsx). Departments and Job titles are the same
// DepartmentsManager and JobTitlesList the Teams hub renders, each with its
// own toolbar and create button; Offices is real CRUD with the tab's one
// blue button; Profile fields keeps the custom person-record fields where
// they were; Org chart is a link card to the one chart at /organization.

import { Suspense, useState } from "react";
import Link from "next/link";
import { SettingsPage, type SettingsTab } from "@/components/settings/settings-page";
import { DepartmentsManager } from "@/components/people/departments-manager";
import { JobTitlesList } from "@/components/people/job-titles-list";
import { ProfileFieldsManager } from "@/components/people/profile-fields-manager";
import { OfficesManager } from "@/components/settings/offices-manager";
import { DotsArt } from "@/components/ui/dots-art";
import { SETTINGS_PAGES, settingsTabs } from "@/lib/settings-registry";
import type { RoleCounts } from "@/lib/access/role-counts";

export function StructureClient({ counts, unlinked, canEdit }: { counts: RoleCounts; unlinked: number; canEdit: boolean }) {
  const [createOffice, setCreateOffice] = useState(0);
  const tabs: SettingsTab[] = settingsTabs("structure").map((t) =>
    t.key === "offices" && canEdit ? { ...t, primary: { label: "New office", onClick: () => setCreateOffice((n) => n + 1) } } : t,
  );
  return (
    <SettingsPage pageKey="structure" tabs={tabs} width="list">
      {(tab) => (
        <div className="flex flex-col gap-6">
          <RoleStrip counts={counts} />
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
      )}
    </SettingsPage>
  );
}

function RoleStrip({ counts }: { counts: RoleCounts }) {
  const items: { label: string; n: number; line: string; filter: string }[] = [
    { label: "Owners", n: counts.owners, line: "Runs the company account", filter: "role:owner" },
    { label: "Admins", n: counts.admins, line: "Runs the workspace", filter: "role:admin" },
    { label: "Members", n: counts.members, line: "Works here", filter: "role:member" },
    { label: "Guests", n: counts.guests, line: "Sees only what is shared", filter: "role:guest" },
    { label: "People team", n: counts.peopleTeam, line: "Looks after everyone's people information", filter: "peopleteam" },
  ];
  return (
    <section aria-label="Roles" className="flex flex-wrap items-stretch gap-x-6 gap-y-3 rounded-lg border border-line bg-raised px-4 py-3">
      {items.map((it) => (
        <Link key={it.label} href={`/settings/members?filter=${it.filter}`} className="min-w-[150px] flex-1 rounded-md px-2 py-1 hover:bg-hover">
          <div className="text-base text-ink">
            {it.label} <span className="font-semibold tabular-nums">{it.n}</span>
          </div>
          <div className="text-sm text-ink-2">{it.line}</div>
        </Link>
      ))}
      <Link href="/settings/access" className="self-center whitespace-nowrap text-sm font-medium text-brand-deep hover:underline">
        How access works
      </Link>
    </section>
  );
}

function OrgChartCard({ unlinked }: { unlinked: number }) {
  return (
    <section className="flex max-w-[760px] items-start gap-4 rounded-lg border border-line bg-raised p-6">
      <DotsArt arrangement="cluster" size={96} />
      <div className="flex flex-col gap-2">
        <p className="text-base text-ink">Your reporting lines live in the org chart, with the people directory beside them.</p>
        <Link href="/organization" className="text-sm font-medium text-brand-deep hover:underline">Open the org chart</Link>
        <p className="text-sm text-ink-2">
          No manager: {unlinked} {unlinked === 1 ? "person" : "people"} ·{" "}
          <Link href="/settings/members?filter=unlinked" className="font-medium text-brand-deep hover:underline">fix in {SETTINGS_PAGES.members.label}</Link>
        </p>
      </div>
    </section>
  );
}
