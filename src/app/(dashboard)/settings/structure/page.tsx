// Settings · Org structure — the Admin-door hub for how the company is
// shaped: Functions (Departments), Roles, Offices, and the Levels ladder.
//
// Server component: it resolves the session, gates to org admins, and runs
// the real counts (one groupBy for level holders, plus cheap counts for the
// building blocks) so every number on the page is live, never invented.
//
// Levels are deliberately READ-ONLY here: AccessLevel is a fixed Prisma enum
// that drives the permission matrix, so this page explains the ladder and
// shows who sits on each rung — it does not pretend the rungs are editable.

import { redirect } from "next/navigation";
import Link from "next/link";
import { getServerSession } from "next-auth";
import {
  Building2, Briefcase, MapPin, ShieldCheck, ChevronRight, Users, Layers, Lock,
  type LucideIcon,
} from "lucide-react";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { ACCESS_LEVELS } from "@/lib/access-levels";

export const dynamic = "force-dynamic";

const ADMIN_LEVELS = new Set(["SUPER_ADMIN", "COMPANY_ADMIN"]);

/** The full ladder, seniority-first. The two admin rungs are granted
 *  manually (never via a Role dropdown) so access-levels.ts omits them —
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

// Sanity guard: keep this explainer honest against the canonical ladder — if
// access-levels.ts ever grows a rung we don't describe, surface it plainly
// rather than silently dropping it.
const KNOWN = new Set(TIERS.map((t) => t.value));
for (const lvl of ACCESS_LEVELS) {
  if (!KNOWN.has(lvl.value)) {
    TIERS.push({ value: lvl.value, label: lvl.label, adminDoor: false, sees: lvl.hint ?? "Assignable access level." });
  }
}

export default async function StructurePage() {
  const session = await getServerSession(authOptions);
  const u = session?.user as { id?: string; organizationId?: string; accessLevel?: string } | undefined;
  if (!u?.id || !u.organizationId) redirect("/login");
  const orgId = u.organizationId;
  const isAdmin = ADMIN_LEVELS.has(u.accessLevel ?? "");

  if (!isAdmin) {
    return (
      <div className="mx-auto w-full max-w-3xl px-6 py-16">
        <div className="flex flex-col items-center gap-3 rounded-2xl border border-zinc-200 bg-white p-10 text-center">
          <div className="grid h-11 w-11 place-items-center rounded-xl bg-zinc-100 text-zinc-400">
            <Lock className="h-5 w-5" />
          </div>
          <h1 className="text-[15px] font-semibold text-zinc-900">Org structure is an admin area</h1>
          <p className="max-w-sm text-[14px] leading-relaxed text-zinc-500">
            Shaping functions, roles, offices and the access ladder is limited to Company Admins.
            You can still explore the org in{" "}
            <Link href="/people" className="font-medium text-[#0073EA] hover:underline">People</Link>.
          </p>
        </div>
      </div>
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
    <div className="mx-auto w-full max-w-4xl px-6 py-6">
      {/* Header */}
      <header className="mb-6">
        <div className="flex items-center gap-2 text-[12px] font-medium text-zinc-400">
          <Link href="/settings" className="hover:text-zinc-700">Settings</Link>
          <ChevronRight className="h-3 w-3" />
          <span>Org structure</span>
        </div>
        <h1 className="mt-1 flex items-center gap-2 text-[19px] font-semibold tracking-tight text-zinc-900">
          <Layers className="h-5 w-5 text-[#0073EA]" />
          Org structure
        </h1>
        <p className="mt-1 max-w-2xl text-[14px] leading-relaxed text-zinc-500">
          How the company is shaped: the functions people belong to, the roles they hold, the
          offices they work from, and the access ladder that decides what each person can reach.
        </p>
      </header>

      {/* Building blocks */}
      <section className="mb-8">
        <h2 className="mb-2.5 text-[12px] font-semibold uppercase tracking-wide text-zinc-400">Building blocks</h2>
        <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-2">
          <BlockTile
            href="/people/departments"
            Icon={Building2}
            grad="linear-gradient(135deg, var(--os-brand), var(--os-c-blue))"
            title="Functions"
            meta={`${deptCount} department${deptCount === 1 ? "" : "s"}`}
            desc="Departments people belong to. Route policies, announcements and ownership."
          />
          <BlockTile
            href="/people/roles"
            Icon={Briefcase}
            grad="linear-gradient(135deg, var(--os-c-blue), var(--os-brand-deep))"
            title="Roles"
            meta={`${roleCount} role${roleCount === 1 ? "" : "s"}`}
            desc="Job definitions with KRA/KPI templates that seed onto every holder."
          />
          <BlockTile
            href="#levels"
            Icon={ShieldCheck}
            grad="linear-gradient(135deg, var(--os-c-teal), var(--os-c-green))"
            title="Access levels"
            meta={`${TIERS.length} tiers · ${totalPeople} people`}
            desc="The fixed ladder that drives permissions. Read-only — see below."
          />
          {/* Offices: the model + API exist, the directory UI does not yet. Honest,
              non-clickable placeholder rather than a link to a page that isn't built. */}
          <div className="flex items-start gap-3 rounded-xl border border-dashed border-zinc-200 bg-zinc-50/60 p-4">
            <div className="grid h-9 w-9 shrink-0 place-items-center rounded-lg bg-zinc-200 text-zinc-500">
              <MapPin className="h-[18px] w-[18px]" />
            </div>
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2">
                <span className="text-[14px] font-semibold text-zinc-700">Offices</span>
                <span className="rounded bg-zinc-200 px-1.5 py-0.5 text-[11px] font-medium text-zinc-500">Coming soon</span>
              </div>
              <div className="mt-0.5 text-[13px] text-zinc-400">
                {officeCount > 0 ? `${officeCount} location${officeCount === 1 ? "" : "s"} on file` : "No locations yet"} · directory in progress
              </div>
              <p className="mt-1 text-[13px] leading-relaxed text-zinc-400">
                Where people work. The location viewer is not built yet.
              </p>
            </div>
          </div>
        </div>
      </section>

      {/* Access levels explainer */}
      <section id="levels" className="scroll-mt-6">
        <h2 className="mb-2 text-[12px] font-semibold uppercase tracking-wide text-zinc-400">Access levels</h2>

        <div className="mb-4 flex items-start gap-2.5 rounded-xl border border-[#0073EA]/20 bg-[#0073EA]/[0.04] p-3.5">
          <Lock className="mt-0.5 h-4 w-4 shrink-0 text-[#0073EA]" />
          <p className="text-[13.5px] leading-relaxed text-zinc-600">
            <span className="font-semibold text-zinc-800">Levels are a fixed ladder, not org-editable.</span>{" "}
            Each level is a value of the <code className="rounded bg-zinc-100 px-1 py-0.5 text-[12px] text-zinc-700">AccessLevel</code> enum
            that the permission matrix is built on, so the rungs can&apos;t be renamed, reordered or added from here.
            You place people on a rung (on their profile or via a role); you tune what a rung can do in{" "}
            <Link href="/settings/permissions" className="font-medium text-[#0073EA] hover:underline">Roles &amp; permissions</Link>.
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
                <span className="mt-0.5 grid h-6 w-6 shrink-0 place-items-center rounded-md bg-zinc-100 text-[12px] font-semibold text-zinc-500">
                  {i + 1}
                </span>
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="text-[14px] font-semibold text-zinc-900">{t.label}</span>
                    {t.adminDoor && (
                      <span className="rounded bg-[#0073EA]/10 px-1.5 py-0.5 text-[11px] font-semibold text-[#0073EA]">Admin door</span>
                    )}
                    <span className="inline-flex items-center gap-1 rounded bg-zinc-100 px-1.5 py-0.5 text-[11.5px] font-medium text-zinc-500">
                      <Users className="h-3 w-3" />
                      {count} {count === 1 ? "person" : "people"}
                    </span>
                  </div>
                  <p className="mt-0.5 text-[13.5px] leading-relaxed text-zinc-500">{t.sees}</p>
                </div>
              </li>
            );
          })}
        </ol>
        <p className="mt-2 text-[12.5px] text-zinc-400">
          Everyone, on every rung, gets the Personal door (<Link href="/account/profile" className="text-[#0073EA] hover:underline">/account</Link>): profile, notifications, appearance and their own security posture.
        </p>
      </section>
    </div>
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
          <span className="text-[14px] font-semibold text-zinc-900">{title}</span>
          <ChevronRight className="h-3.5 w-3.5 text-zinc-300 transition group-hover:translate-x-0.5 group-hover:text-zinc-500" />
        </div>
        <div className="mt-0.5 text-[13px] font-medium text-zinc-400">{meta}</div>
        <p className="mt-1 text-[13px] leading-relaxed text-zinc-500">{desc}</p>
      </div>
    </Link>
  );
}
