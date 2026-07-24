// Role Definition — the Block-B view of a role: identity/scope, ownership
// boundary (owns / can-request / cannot-touch), KRAs, KPIs (owned vs shared,
// baseline→target), SOPs, and escalation thresholds; plus the role's instances
// (Role × Scope) held by people. Definition lives at the role (template) level
// and is cloneable per scope. Mirrors the Space-detail chrome.

import { notFound, redirect } from "next/navigation";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import Link from "next/link";
import { ChevronDown } from "lucide-react";
import { EntityTile } from "@/components/ui/entity-tile";
import { RoleWorkspace } from "./role-workspace";

export const dynamic = "force-dynamic";

const MANAGER_LEVELS = new Set(["SUPER_ADMIN", "COMPANY_ADMIN", "C_LEVEL", "VP", "DIRECTOR", "MANAGER", "TEAM_LEAD", "HR"]);

export default async function RolePage(props: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ view?: string }>;
}) {
  const { id } = await props.params;
  const sp = await props.searchParams;
  const view = sp.view === "instances" ? "instances" : "overview";

  const session = await getServerSession(authOptions);
  if (!session?.user) redirect("/login");
  const u = session.user as { id?: string; organizationId?: string; accessLevel?: string };
  if (!u.id || !u.organizationId) redirect("/login");
  const orgId = u.organizationId;
  const canEdit = MANAGER_LEVELS.has(u.accessLevel ?? "EMPLOYEE");

  const role = await prisma.role.findFirst({
    where: { id, organizationId: orgId },
    include: {
      department: { select: { id: true, name: true } },
      kraTemplates: {
        orderBy: { name: "asc" },
        include: {
          kpis: {
            orderBy: { name: "asc" },
            select: {
              id: true, name: true, description: true, unit: true, frequency: true, type: true,
              ownership: true, formula: true, baselineValue: true, baselineLabel: true,
              targetValue: true, targetLabel: true, lowerIsBetter: true,
            },
          },
          sops: { select: { id: true, title: true, status: true } },
        },
      },
      ownedAreas: { select: { id: true, name: true, description: true } },
      boundaries: {
        include: { area: { select: { id: true, name: true, ownerRole: { select: { id: true, title: true } } } } },
      },
      thresholds: { orderBy: { createdAt: "asc" } },
      instances: {
        orderBy: { createdAt: "asc" },
        include: {
          scope: { select: { id: true, name: true, dimension: true } },
          user: { select: { id: true, firstName: true, lastName: true, email: true, avatar: true } },
        },
      },
      users: { select: { id: true, firstName: true, lastName: true, email: true, avatar: true }, orderBy: { firstName: "asc" } },
    },
  });
  if (!role) notFound();

  const [allAreas, allRoles, allKras, scopes, orgUsers] = await Promise.all([
    prisma.ownershipArea.findMany({
      where: { organizationId: orgId },
      select: { id: true, name: true, ownerRole: { select: { id: true, title: true } } },
      orderBy: { name: "asc" },
    }),
    prisma.role.findMany({ where: { organizationId: orgId }, select: { id: true, title: true }, orderBy: { title: "asc" } }),
    prisma.kRA.findMany({ where: { organizationId: orgId }, select: { id: true, name: true, category: true }, orderBy: { name: "asc" } }),
    prisma.scope.findMany({ where: { organizationId: orgId }, select: { id: true, name: true, dimension: true }, orderBy: [{ dimension: "asc" }, { name: "asc" }] }),
    prisma.user.findMany({ where: { organizationId: orgId, status: "ACTIVE" }, select: { id: true, firstName: true, lastName: true, email: true, avatar: true }, orderBy: { firstName: "asc" } }),
  ]);

  // Serialize into plain shapes the client workspace renders.
  const bundle = {
    role: {
      id: role.id,
      title: role.title,
      description: role.description,
      level: role.level as string,
      department: role.department,
    },
    kras: role.kraTemplates.map((k) => ({
      id: k.id,
      name: k.name,
      category: k.category,
      kpis: k.kpis.map((p) => ({ ...p, ownership: p.ownership as string, type: p.type as string, frequency: p.frequency as string })),
      sops: k.sops.map((s) => ({ id: s.id, title: s.title, status: s.status as string })),
    })),
    ownedAreas: role.ownedAreas,
    boundaries: role.boundaries.map((b) => ({ id: b.id, relation: b.relation as string, area: b.area })),
    thresholds: role.thresholds.map((t) => ({ id: t.id, label: t.label, trigger: t.trigger, value: t.value, unit: t.unit, businessHoursOnly: t.businessHoursOnly })),
    instances: role.instances.map((i) => ({ id: i.id, name: i.name, status: i.status, scope: i.scope, user: i.user })),
    people: role.users,
    allAreas,
    allRoles,
    allKras,
    scopes,
    orgUsers,
  };

  return (
    <div className="flex flex-col h-full bg-white">
      {/* Breadcrumb + title row */}
      <div className="px-6 pt-4 pb-3">
        <div className="flex items-center gap-1.5 text-xs text-zinc-500 mb-2">
          <Link href="/people/roles" className="hover:text-zinc-900">Roles</Link>
          {role.department ? (
            <>
              <span className="text-zinc-300">/</span>
              <span className="text-zinc-500">{role.department.name}</span>
            </>
          ) : null}
        </div>
        <div className="flex items-center gap-3">
          <EntityTile size="lg" color="#0073EA" name={role.title} />
          <h1 className="text-base font-semibold text-zinc-900 flex items-center gap-1.5 min-w-0">
            <span className="truncate" title={role.title}>{role.title}</span>
            <span className="text-[11px] font-medium text-zinc-500 px-1.5 py-0.5 rounded bg-zinc-100 uppercase tracking-wide">{role.level}</span>
            <ChevronDown className="w-3.5 h-3.5 text-zinc-400" />
          </h1>
        </div>
      </div>

      <RoleWorkspace bundle={bundle} canEdit={canEdit} view={view} />
    </div>
  );
}
