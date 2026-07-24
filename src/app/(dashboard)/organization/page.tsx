"use client";

/* Organization — bespoke settings hub + compact org chart preview.
 *
 *  GET /api/users?limit=500
 *  GET /api/departments
 *  GET /api/offices
 *  GET /api/roles
 *
 * Layout:
 *   OsTitleBar with People link in actions.
 *   Hero: gradient cover + org identity card (name, plan tag, member count).
 *   4-tile KPI strip: People · Departments · Offices · Roles.
 *   8-card launchpad to org-config sub-areas.
 *   Compact org tree preview (top 3 levels).
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import {
  Building2, Users, MapPin, Briefcase, Palette, Globe, Shield, FileText,
  Sparkles, Network, ChevronDown, ChevronRight, ArrowRight, CreditCard,
  Settings as SettingsIcon, GraduationCap,
} from "lucide-react";
import { OsTitleBar } from "@/components/layout/os/title-bar";
import { OsEmptyView } from "@/components/layout/os/empty-view";
import { C, GRAD, PEOPLE } from "@/components/layout/os/catalog";
import { useOsShell } from "@/components/layout/os/shell-context";
import { TeamStatTile, TeamCard, TeamAvatar } from "@/components/team/ui";

type ApiUser = {
  id: string;
  firstName?: string | null;
  lastName?: string | null;
  managerId?: string | null;
  role?: { id: string; title: string } | null;
  department?: { id: string; name: string } | null;
};

type ApiDept = { id: string; name: string; color?: string | null; _count?: { members?: number }; parentId?: string | null };
type ApiOffice = { id: string; name?: string | null; city?: string | null; country?: string | null; isHeadquarters?: boolean };
type ApiRole = { id: string; title: string; level?: string };

type ApiOrg = {
  name?: string;
  legalName?: string | null;
  plan?: string | null;
  logoUrl?: string | null;
  primaryColor?: string | null;
  industry?: string | null;
  size?: string | null;
};

const AV_PALETTE = [C.purple, C.green, C.orange, C.pink, C.teal, C.indigo, C.blue, C.red];
function avColor(s: string) { let h = 0; for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0; return AV_PALETTE[h % AV_PALETTE.length]; }
function initials(f?: string | null, l?: string | null) {
  const fa = (f ?? "")[0] ?? "";
  const la = (l ?? "")[0] ?? "";
  return ((fa + la) || "?").toUpperCase();
}

type TreeNode = { user: ApiUser; reports: TreeNode[] };
function buildTree(users: ApiUser[]): TreeNode[] {
  const byId = new Map<string, TreeNode>();
  for (const u of users) byId.set(u.id, { user: u, reports: [] });
  const roots: TreeNode[] = [];
  for (const u of users) {
    const node = byId.get(u.id)!;
    if (u.managerId && byId.has(u.managerId)) byId.get(u.managerId)!.reports.push(node);
    else roots.push(node);
  }
  const sortFn = (a: TreeNode, b: TreeNode) =>
    b.reports.length - a.reports.length ||
    (a.user.firstName ?? "").localeCompare(b.user.firstName ?? "");
  function walk(n: TreeNode) { n.reports.sort(sortFn); n.reports.forEach(walk); }
  roots.sort(sortFn);
  roots.forEach(walk);
  return roots;
}

export default function OrganizationPage() {
  const [users, setUsers] = useState<ApiUser[] | null>(null);
  const [depts, setDepts] = useState<ApiDept[] | null>(null);
  const [offices, setOffices] = useState<ApiOffice[] | null>(null);
  const [roles, setRoles] = useState<ApiRole[] | null>(null);
  const [org, setOrg] = useState<ApiOrg | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [collapsedNodes, setCollapsedNodes] = useState<Set<string>>(new Set());
  const { rowVersion } = useOsShell();

  const load = useCallback(async () => {
    try {
      const [uRes, dRes, oRes, rRes, orgRes] = await Promise.all([
        fetch("/api/users?limit=500"),
        fetch("/api/departments"),
        fetch("/api/offices"),
        fetch("/api/roles"),
        fetch("/api/organization/branding"),
      ]);
      if (uRes.ok) {
        const u = await uRes.json();
        setUsers(u?.data?.items ?? u?.data ?? (Array.isArray(u) ? u : []));
      }
      if (dRes.ok) {
        const d = await dRes.json();
        setDepts(d?.data ?? (Array.isArray(d) ? d : []));
      }
      if (oRes.ok) {
        const o = await oRes.json();
        setOffices(o?.data ?? (Array.isArray(o) ? o : []));
      }
      if (rRes.ok) {
        const r = await rRes.json();
        setRoles(r?.data ?? (Array.isArray(r) ? r : []));
      }
      if (orgRes.ok) {
        const orgData = await orgRes.json();
        setOrg(orgData?.data ?? orgData ?? null);
      }
      setLoadError(null);
    } catch (e) {
      setLoadError(e instanceof Error ? e.message : "load failed");
    }
  }, []);
  useEffect(() => { void load(); }, [load]);
  const v = rowVersion("people");
  useEffect(() => { if (v > 0) void load(); }, [v, load]);

  const tree = useMemo(() => buildTree(users ?? []), [users]);

  function toggleNode(id: string) {
    setCollapsedNodes((prev) => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  }

  const stats = useMemo(() => {
    return {
      people: users?.length ?? 0,
      depts: depts?.length ?? 0,
      offices: offices?.length ?? 0,
      roles: roles?.length ?? 0,
      withManager: (users ?? []).filter((u) => u.managerId).length,
      topLayer: tree.length,
      hq: offices?.find((o) => o.isHeadquarters)?.name ?? offices?.[0]?.name ?? null,
    };
  }, [users, depts, offices, roles, tree]);

  const orgName = org?.name || "Your organization";
  const heroGrad = org?.primaryColor
    ? `linear-gradient(135deg, ${org.primaryColor}, color-mix(in srgb, ${org.primaryColor} 60%, var(--os-c-purple)))`
    : GRAD.purpleIndigo;
  const orgInitials = orgName.split(/\s+/).slice(0, 2).map((p) => p[0] ?? "").join("").toUpperCase() || "OR";

  return (
    <div className="flex flex-col h-full bg-white">
      <div className="px-6 pt-4 pb-3">
        <div className="flex items-center gap-1.5 text-xs text-zinc-500 mb-2">
          <Link href="/team" className="hover:text-zinc-900">Teams</Link>
          <span className="text-zinc-300">/</span>
          <span>Org chart</span>
        </div>
        <div className="flex items-center gap-3">
          <span className="inline-flex h-9 w-9 items-center justify-center rounded-lg bg-[#6366F1]/10 shrink-0">
            <Building2 className="h-5 w-5 text-[#6366F1]" />
          </span>
          <h1 className="text-base font-semibold text-zinc-900">Org chart</h1>
          <span className="text-xs text-zinc-400 hidden sm:inline">{orgName} — reporting hierarchy</span>
          <div className="flex-1" />
          <Link href="/people" className="inline-flex items-center gap-1.5 h-8 px-3 rounded-md text-[13px] text-zinc-700 border border-zinc-200 hover:bg-zinc-50">
            <Users className="w-3.5 h-3.5 text-zinc-400" /> Directory
          </Link>
          <Link href="/settings" className="inline-flex items-center gap-1.5 h-8 px-3 rounded-md text-[13px] text-zinc-700 border border-zinc-200 hover:bg-zinc-50">
            <SettingsIcon className="w-3.5 h-3.5 text-zinc-400" /> Org settings
          </Link>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto px-6 py-4 space-y-4 max-w-[1100px]">
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
          <TeamStatTile icon={Users} label="People" value={stats.people} accent="#0073EA" sub={`${stats.withManager} reporting`} />
          <TeamStatTile icon={Building2} label="Departments" value={stats.depts} accent="#6366F1" sub="org units" />
          <TeamStatTile icon={MapPin} label="Offices" value={stats.offices} accent="#f59e0b" sub={stats.hq ? `HQ: ${stats.hq}` : "no HQ set"} />
          <TeamStatTile icon={Briefcase} label="Roles" value={stats.roles} accent="#16a34a" sub="job titles" />
        </div>

        {loadError ? (
          <div className="border border-zinc-200 rounded-xl px-6 py-12 text-center text-sm text-zinc-500">Couldn&rsquo;t load org chart — {loadError}</div>
        ) : users === null ? (
          <div className="text-sm text-zinc-400 py-8 text-center">Loading hierarchy…</div>
        ) : tree.length > 0 ? (
          <TeamCard
            title="Reporting hierarchy"
            subtitle={`${stats.topLayer} at the top · ${stats.people} total`}
            action={<Link href="/people" className="inline-flex items-center gap-1 text-[12px] text-[var(--os-brand)] hover:underline">All people <ArrowRight className="w-3 h-3" /></Link>}
          >
            <div className="space-y-0.5">
              {tree.slice(0, 8).map((node) => (
                <TreeNodeView key={node.user.id} node={node} depth={0} maxDepth={2} collapsed={collapsedNodes} toggle={toggleNode} />
              ))}
              {tree.length > 8 ? (
                <div className="pt-1.5">
                  <Link href="/people" className="text-[12px] text-zinc-500 hover:text-zinc-800">+ {tree.length - 8} more top-level → see all people</Link>
                </div>
              ) : null}
            </div>
          </TeamCard>
        ) : (
          <div className="border border-zinc-200 rounded-xl px-6 py-12 text-center text-sm text-zinc-500">
            No hierarchy yet — set reporting managers in <Link href="/settings/members" className="text-[var(--os-brand)] hover:underline">Members</Link>.
          </div>
        )}
      </div>
    </div>
  );
}

function TreeNodeView({
  node, depth, maxDepth, collapsed, toggle,
}: {
  node: TreeNode;
  depth: number;
  maxDepth: number;
  collapsed: Set<string>;
  toggle: (id: string) => void;
}) {
  const id = node.user.id;
  const isCollapsed = collapsed.has(id) || depth >= maxDepth;
  const hasReports = node.reports.length > 0;
  const name = [node.user.firstName, node.user.lastName].filter(Boolean).join(" ") || "Unknown";
  return (
    <div>
      <div className="flex items-center gap-1 rounded-lg hover:bg-zinc-50 pr-2" style={{ paddingLeft: depth * 20 }}>
        <button
          type="button"
          onClick={() => hasReports && toggle(id)}
          className="h-6 w-6 inline-flex items-center justify-center text-zinc-400 hover:text-zinc-700 shrink-0"
          aria-label={isCollapsed ? "Expand" : "Collapse"}
        >
          {hasReports ? (isCollapsed ? <ChevronRight className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />) : <span className="w-1.5 h-1.5 rounded-full bg-zinc-200" />}
        </button>
        <Link href={`/people/${id}`} className="flex items-center gap-2.5 flex-1 min-w-0 py-1.5">
          <TeamAvatar name={name} size={30} />
          <div className="min-w-0">
            <div className="text-[13px] font-medium text-zinc-900 truncate">{name}</div>
            <div className="text-[11px] text-zinc-500 truncate">
              {node.user.role?.title ?? "—"}{node.user.department?.name ? ` · ${node.user.department.name}` : ""}
            </div>
          </div>
        </Link>
        {hasReports ? <span className="text-[11px] text-zinc-400 shrink-0 tabular-nums">{node.reports.length}</span> : null}
      </div>
      {hasReports && !isCollapsed ? (
        <div>
          {node.reports.map((r) => (
            <TreeNodeView key={r.user.id} node={r} depth={depth + 1} maxDepth={maxDepth} collapsed={collapsed} toggle={toggle} />
          ))}
        </div>
      ) : null}
    </div>
  );
}
