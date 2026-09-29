// Settings · Structure: the Admin-door hub for how the company is
// shaped: Departments, Job titles, the Org chart link, Offices, and the
// Levels ladder. ?tab=departments and ?tab=titles render the Teams hub's own
// DepartmentsManager and JobTitlesList in this door.
//
// Server component: it resolves the session, gates to org admins, and runs
// the real counts (one groupBy for level holders, plus cheap counts for the
// building blocks) so every number on the page is live, never invented.
//
// Levels are deliberately READ-ONLY here: AccessLevel is a fixed Prisma enum
// that drives the permission matrix, so this page explains the ladder and
// shows who sits on each rung; it does not pretend the rungs are editable.

import { redirect } from "next/navigation";
import Link from "next/link";
import { getServerSession } from "next-auth";
import {
  Building2, Briefcase, ShieldCheck, ChevronRight, ListPlus, Users, Lock,
  type LucideIcon,
} from "lucide-react";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { ACCESS_LEVELS } from "@/lib/access-levels";
import { ComingSoonRow, UpcomingOnly } from "@/components/ui/coming-soon-row";
import { AdminOnly } from "@/components/access";
import { SHELL_LABELS } from "@/lib/nav/labels";
import { Suspense } from "react";
import { SettingsPage, type SettingsTab } from "@/components/settings/settings-page";
import { SETTINGS_PAGES } from "@/lib/settings-registry";
import { DepartmentsManager } from "@/components/people/departments-manager";
import { JobTitlesList } from "@/components/people/job-titles-list";
import { ProfileFieldsManager } from "@/components/people/profile-fields-manager";

export const dynamic = "force-dynamic";

const ADMIN_LEVELS = new Set(["SUPER_ADMIN", "COMPANY_ADMIN"]);

/** The full ladder, seniority-first. The two admin rungs are granted
 *  manually (never via a Role dropdown) so access-levels.ts omits them;
 *  we prepend them here because they are the tiers that unlock the Admin
 *  door, which is exactly what this explainer is about. */
type Tier = { value: string; label: string; adminDoor: boolean; sees: string };
const TIERS: Tier[] = [
  { value: "SUPER_ADMIN",   label: "Super Admin",   adminDoor: true,  sees: "Everything: the Admin door (all org settings), the Personal door, and every workspace org-wide. Held by WorkwrK staff, granted manually." },
  { value: "COMPANY_ADMIN", label: "Company Admin", adminDoor: true,  sees: "The Admin door (all org settings), the Personal door, and the whole workspace org-wide. The org owner; granted manually." },
  { value: "C_LEVEL",       label: "C-Level",       adminDoor: false, sees: "Org-wide workspace and analytics; the Personal door. No Admin door." },
  { value: "VP",            label: "VP",            adminDoor: false, sees: "Org-wide workspace across their function; the Personal door. No Admin door." },
  { value: "DIRECTOR",      label: "Director",      adminDoor: false, sees: "Org-wide within their function, incl. managing departments, roles and offices; the Personal door. No Admin door." },
  { value: "HR",            label: "HR",            adminDoor: false, sees: "People-ops across the org: members, departments, reviews and policies; the Personal door. No Admin door." },
  { value: "MANAGER",       label: "Manager",       adminDoor: false, sees: "Their team's work, reviews and people; the Personal door. No Admin door." },
  { value: "TEAM_LEAD",     label: "Team Lead",     adminDoor: false, sees: "Their team's work and reviews; the Personal door. No Admin door." },
  { value: "EMPLOYEE",      label: "Employee",      adminDoor: false, sees: "Their own work, goals and profile; the org directory read-only; the Personal door." },
  { value: "AGENT",         label: "Agent",         adminDoor: false, sees: "Limited frontline: assigned tasks and their own profile; the Personal door." },
];

// Sanity guard: keep this explainer honest against the canonical ladder: if
// access-levels.ts ever grows a rung we don't describe, surface it plainly
// rather than silently dropping it.
const KNOWN = new Set(TIERS.map((t) => t.value));
for (const lvl of ACCESS_LEVELS) {
  if (!KNOWN.has(lvl.value)) {
    TIERS.push({ value: lvl.value, label: lvl.label, adminDoor: false, sees: lvl.hint ?? "Assignable access level." });
  }
}

const STRUCTURE_TABS: SettingsTab[] = [
  { key: "overview", label: "Overview" },
  { key: "departments", label: "Departments" },
  { key: "titles", label: "Job titles" },
  { key: "fields", label: "Profile fields" },
];

export default async function StructurePage({ searchParams }: { searchParams?: Promise<{ tab?: string }> }) {
  const tab = (await searchParams)?.tab;
  const session = await getServerSession(authOptions);
  const u = session?.user as { id?: string; organizationId?: string; accessLevel?: string } | undefined;
  if (!u?.id || !u.organizationId) redirect("/login");
  const orgId = u.organizationId;
  const isAdmin = ADMIN_LEVELS.has(u.accessLevel ?? "");

  // The denial family, not a bespoke card (spec-shell 1.6, 2.8): a non-admin
  // at this URL gets the AdminOnly card with the rail and bar intact.
  if (!isAdmin) {
    return <AdminOnly page="Structure" back={{ fallbackHref: "/account/profile", label: SHELL_LABELS.mySettings }} />;
  }

  // The Structure tabs (spec-teams-people section 3): the same
  // DepartmentsManager and JobTitlesList the Teams pages render, inside the
  // settings door. The org chart is a link card, never embedded (one chart).
  // Tabs, not sub-pages with a Back button (no BackButton inside a door,
  // settings-architecture 8.3): Overview is the landing below.
  if (tab === "departments" || tab === "titles" || tab === "fields") {
    return (
      <SettingsPage pageKey="structure" tabs={STRUCTURE_TABS} width="list">
        <Suspense>
          {tab === "departments" ? <DepartmentsManager door="settings" /> : tab === "titles" ? <JobTitlesList door="settings" /> : <ProfileFieldsManager />}
        </Suspense>
      </SettingsPage>
    );
  }

  // Live counts. One groupBy for the level holders; cheap counts for blocks.
  const [deptCount, roleCount, officeCount, levelGroups] = await Promise.all([
    prisma.department.count({ where: { organizationId: orgId } }),
    prisma.role.count({ where: { organizationId: orgId } }),
    prisma.office.count({ where: { organizationId: orgId } }),
    prisma.user.groupBy({
      by: ["accessLevel"],
      where: { organizationId: orgId, deletedAt: null },
      _count: { _all: true },
    }),
  ]);

  const holders = new Map<string, number>();
  for (const g of levelGroups) holders.set(String(g.accessLevel), g._count._all);
  const totalPeople = [...holders.values()].reduce((a, b) => a + b, 0);

  return (
    <SettingsPage pageKey="structure" tabs={STRUCTURE_TABS} width="list">
      <p className="mb-6 max-w-2xl text-base leading-relaxed text-ink-2">
        How the company is shaped: the departments people belong to, the job titles they hold, the
        offices they work from, and the access ladder that decides what each person can reach.
      </p>

      {/* Building blocks */}
      <section className="mb-8">
        <h2 className="mb-2.5 text-xs font-semibold uppercase tracking-wide text-zinc-400">Building blocks</h2>
        <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-2">
          <BlockTile
            href="/settings/structure?tab=departments"
            Icon={Building2}
            grad="linear-gradient(135deg, var(--os-brand), var(--os-c-blue))"
            title="Departments"
            meta={`${deptCount} department${deptCount === 1 ? "" : "s"}`}
            desc="Departments people belong to. Route policies, announcements and ownership."
          />
          <BlockTile
            href="/settings/structure?tab=titles"
            Icon={Briefcase}
            grad="linear-gradient(135deg, var(--os-c-blue), var(--os-brand-deep))"
            title="Job titles"
            meta={`${roleCount} job title${roleCount === 1 ? "" : "s"}`}
            desc="Job definitions with KRA and KPI templates that seed onto every holder. Seniority on a title is display only."
          />
          <BlockTile
            href="/settings/structure?tab=fields"
            Icon={ListPlus}
            grad="linear-gradient(135deg, var(--os-brand-deep), var(--os-c-teal))"
            title="Profile fields"
            meta="Custom fields on every record"
            desc="Extra fields on each person's record, like Employee ID or Pronouns."
          />
          <BlockTile
            href="/organization"
            Icon={Users}
            grad="linear-gradient(135deg, var(--os-c-teal), var(--os-brand))"
            title="Org chart"
            meta="Open the org chart"
            desc="Who reports to whom. Edit reporting lines there."
          />
          <BlockTile
            href="#levels"
            Icon={ShieldCheck}
            grad="linear-gradient(135deg, var(--os-c-teal), var(--os-c-green))"
            title="Access levels"
            meta={`${TIERS.length} tiers · ${totalPeople} people`}
            desc="The fixed ladder that drives permissions. Read-only, see below."
          />
          {/* Offices: the model and API exist, the directory UI does not yet
              (spec-shell 1.15: absent, or a ComingSoonRow behind Show upcoming). */}
          <UpcomingOnly>
            <ComingSoonRow label={`Offices${officeCount > 0 ? ` · ${officeCount} location${officeCount === 1 ? "" : "s"} on file` : ""}`} />
          </UpcomingOnly>
        </div>
      </section>

      {/* Access levels explainer */}
      <section id="levels" className="scroll-mt-6">
        <h2 className="mb-2 text-xs font-semibold uppercase tracking-wide text-zinc-400">Access levels</h2>

        <div className="mb-4 flex items-start gap-2.5 rounded-xl border border-[#0073EA]/20 bg-[#0073EA]/[0.04] p-3.5">
          <Lock className="mt-0.5 h-4 w-4 shrink-0 text-[#0073EA]" />
          <p className="text-base leading-relaxed text-zinc-600">
            <span className="font-semibold text-zinc-800">Levels are a fixed ladder, not org-editable.</span>{" "}
            Each level is a value of the <code className="rounded bg-zinc-100 px-1 py-0.5 text-xs text-zinc-700">AccessLevel</code> enum
            that the permission matrix is built on, so the rungs can&apos;t be renamed, reordered or added from here.
            You place people on a rung (on their profile or via a role); you tune what a rung can do in{" "}
            <Link href="/settings/access" className="font-medium text-[#0073EA] hover:underline">{SETTINGS_PAGES.access.label}</Link>.
          </p>
        </div>

        <ol className="overflow-hidden rounded-xl border border-zinc-200 bg-white">
          {TIERS.map((t, i) => {
            const count = holders.get(t.value) ?? 0;
            return (
              <li
                key={t.value}
                className={`flex items-start gap-3 px-4 py-3 ${i > 0 ? "border-t border-zinc-100" : ""}`}
              >
                <span className="mt-0.5 grid h-6 w-6 shrink-0 place-items-center rounded-md bg-zinc-100 text-xs font-semibold text-zinc-500">
                  {i + 1}
                </span>
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="text-base font-semibold text-zinc-900">{t.label}</span>
                    {t.adminDoor && (
                      <span className="rounded bg-[#0073EA]/10 px-1.5 py-0.5 text-xs font-semibold text-[#0073EA]">Admin door</span>
                    )}
                    <span className="inline-flex items-center gap-1 rounded bg-zinc-100 px-1.5 py-0.5 text-xs font-medium text-zinc-500">
                      <Users className="h-3 w-3" />
                      {count} {count === 1 ? "person" : "people"}
                    </span>
                  </div>
                  <p className="mt-0.5 text-base leading-relaxed text-zinc-500">{t.sees}</p>
                </div>
              </li>
            );
          })}
        </ol>
        <p className="mt-2 text-xs text-zinc-400">
          Everyone, on every rung, gets <Link href="/account/profile" className="text-[#0073EA] hover:underline">{SHELL_LABELS.mySettings}</Link>: profile, notifications, preferences and their own security.
        </p>
      </section>
    </SettingsPage>
  );
}

function BlockTile({
  href, Icon, grad, title, meta, desc,
}: {
  href: string;
  Icon: LucideIcon;
  grad: string;
  title: string;
  meta: string;
  desc: string;
}) {
  return (
    <Link
      href={href}
      className="group flex items-start gap-3 rounded-xl border border-zinc-200 bg-white p-4 transition hover:border-zinc-300 hover:shadow-sm"
    >
      <div className="grid h-9 w-9 shrink-0 place-items-center rounded-lg text-white" style={{ background: grad }}>
        <Icon className="h-[18px] w-[18px]" />
      </div>
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-1.5">
          <span className="text-base font-semibold text-zinc-900">{title}</span>
          <ChevronRight className="h-3.5 w-3.5 text-zinc-300 transition-colors group-hover:text-zinc-500" />
        </div>
        <div className="mt-0.5 text-sm font-medium text-zinc-400">{meta}</div>
        <p className="mt-1 text-sm leading-relaxed text-zinc-500">{desc}</p>
      </div>
    </Link>
  );
}
