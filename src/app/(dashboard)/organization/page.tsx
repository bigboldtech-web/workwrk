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
    <>
      <OsTitleBar
        title="Organization"
        Icon={Building2}
        iconGradient={GRAD.purpleIndigo}
        description={users === null
          ? "Loading organization…"
          : `${stats.people} people · ${stats.depts} department${stats.depts === 1 ? "" : "s"} · ${stats.offices} office${stats.offices === 1 ? "" : "s"}`}
        people={[PEOPLE.bb, PEOPLE.sc, PEOPLE.mk]}
        morePeople={Math.max(0, stats.people - 3)}
        actions={
          <div className="orgh__head-actions">
            <Link href="/people" className="orgh__nav-link"><Users /> People</Link>
            <Link href="/people/departments" className="orgh__nav-link"><Building2 /> Departments</Link>
          </div>
        }
      />

      <div className="orgh">
        {/* Identity hero */}
        <section className="orgh__hero" style={{ ["--hero-cover" as unknown as string]: heroGrad }}>
          <div className="orgh__hero-cover" aria-hidden="true">
            <span className="orgh__hero-glow" />
          </div>
          <div className="orgh__hero-body">
            <div className="orgh__hero-logo" style={{ background: heroGrad }}>
              {org?.logoUrl ? (
                /* eslint-disable-next-line @next/next/no-img-element */
                <img src={org.logoUrl} alt="" />
              ) : (
                <span>{orgInitials}</span>
              )}
            </div>
            <div className="orgh__hero-info">
              <div className="orgh__hero-meta">
                {org?.plan && <span className="orgh__hero-plan">{org.plan}</span>}
                {org?.industry && <span className="orgh__hero-industry">{org.industry}</span>}
              </div>
              <h1 className="orgh__hero-name">{orgName}</h1>
              {org?.legalName && org.legalName !== orgName && (
                <div className="orgh__hero-legal">Legal: {org.legalName}</div>
              )}
              <div className="orgh__hero-stats">
                <span><Users /> {stats.people} member{stats.people === 1 ? "" : "s"}</span>
                {stats.hq && <span><MapPin /> HQ: {stats.hq}</span>}
                {stats.topLayer > 0 && <span><Network /> {stats.topLayer} at top</span>}
              </div>
            </div>
          </div>
        </section>

        {/* KPIs */}
        <div className="orgh__kpis">
          <KpiTile accent="var(--os-c-blue)"   Icon={Users}     label="People"      value={`${stats.people}`}  sub={`${stats.withManager} reporting`} />
          <KpiTile accent="var(--os-c-purple)" Icon={Building2} label="Departments" value={`${stats.depts}`}   sub="org units" />
          <KpiTile accent="var(--os-c-orange)" Icon={MapPin}    label="Offices"     value={`${stats.offices}`} sub={stats.hq ? `HQ: ${stats.hq}` : "no HQ set"} />
          <KpiTile accent="var(--os-c-green)"  Icon={Briefcase} label="Roles"       value={`${stats.roles}`}   sub="job titles" />
        </div>

        {/* Launchpad */}
        <section className="orgh__section">
          <header className="orgh__section-head">
            <h2>Settings</h2>
            <span className="orgh__section-sub">Configure how your organization runs</span>
          </header>
          <div className="orgh__launch">
            <LaunchTile href="/organization?tab=profile" Icon={Building2} gradient={GRAD.bluePurple}    title="Company profile"    sub="name, plan, industry" />
            <LaunchTile href="/organization?tab=branding" Icon={Palette}    gradient={GRAD.pinkPurple}    title="Branding"          sub="logo, colors, identity" />
            <LaunchTile href="/people/departments" Icon={Network}    gradient={GRAD.purpleIndigo}  title="Departments"        sub={`${stats.depts} units`} />
            <LaunchTile href="/people/roles" Icon={Briefcase}  gradient={GRAD.greenTeal}     title="Roles & levels"    sub={`${stats.roles} job titles`} />
            <LaunchTile href="/organization?tab=offices" Icon={MapPin}     gradient={GRAD.orangePink}    title="Offices"           sub={`${stats.offices} location${stats.offices === 1 ? "" : "s"}`} />
            <LaunchTile href="/organization?tab=sso" Icon={Shield}     gradient={GRAD.indigoBlue}    title="SSO & domains"     sub="auth, SCIM, audit" />
            <LaunchTile href="/organization?tab=billing" Icon={CreditCard} gradient={GRAD.yellowOrange}  title="Billing & plan"    sub="invoices, seats" />
            <LaunchTile href="/organization?tab=audit"   Icon={FileText}   gradient={GRAD.tealGreen}     title="Audit log"         sub="security events" />
          </div>
        </section>

        {/* Hierarchy preview */}
        {loadError ? (
          <OsEmptyView Icon={Network} iconGradient={GRAD.redPink} title="Couldn't load org chart" subtitle={`API error: ${loadError}.`} cta="Retry" />
        ) : users === null ? (
          <div className="orgh__loading">Loading hierarchy…</div>
        ) : stats.people > 0 && tree.length > 0 ? (
          <section className="orgh__section">
            <header className="orgh__section-head">
              <h2>Reporting hierarchy</h2>
              <span className="orgh__section-sub">{stats.topLayer} at the top · {stats.people} total</span>
              <Link href="/people" className="orgh__section-link">All people <ArrowRight /></Link>
            </header>
            <div className="orgh__tree">
              {tree.slice(0, 5).map((node) => (
                <TreeNodeView key={node.user.id} node={node} depth={0} maxDepth={2} collapsed={collapsedNodes} toggle={toggleNode} />
              ))}
              {tree.length > 5 && (
                <div className="orgh__tree-more">
                  <Link href="/people">+ {tree.length - 5} more top-level → see all people</Link>
                </div>
              )}
            </div>
          </section>
        ) : null}

        {/* Quick links */}
        <section className="orgh__section">
          <header className="orgh__section-head">
            <h2>Related areas</h2>
          </header>
          <div className="orgh__related">
            <Link href="/people/skills" className="orgh__related-link">
              <GraduationCap /> <span>Skills matrix</span>
            </Link>
            <Link href="/people" className="orgh__related-link">
              <Users /> <span>People directory</span>
            </Link>
            <Link href="/people/roles" className="orgh__related-link">
              <Briefcase /> <span>Role library</span>
            </Link>
            <Link href="/organization?tab=settings" className="orgh__related-link">
              <SettingsIcon /> <span>Workspace settings</span>
            </Link>
            <Link href="/organization?tab=domains" className="orgh__related-link">
              <Globe /> <span>Domains</span>
            </Link>
            <Link href="/organization?tab=ai" className="orgh__related-link">
              <Sparkles /> <span>AI profile</span>
            </Link>
          </div>
        </section>
      </div>
    </>
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
  const fullName = [node.user.firstName, node.user.lastName].filter(Boolean).join(" ") || "Unknown";
  return (
    <div className="orgh__node">
      <div
        className={`orgh__card${hasReports ? " has-reports" : ""}`}
        style={{ ["--depth" as unknown as string]: `${depth}` }}
        onClick={() => hasReports && toggle(id)}
      >
        <button
          type="button"
          className={`orgh__chev${!hasReports ? " is-leaf" : ""}${isCollapsed ? " is-collapsed" : ""}`}
          aria-label={isCollapsed ? "Expand" : "Collapse"}
          onClick={(e) => { e.stopPropagation(); if (hasReports) toggle(id); }}
        >
          {hasReports ? <ChevronDown /> : <span className="orgh__chev-dot" />}
        </button>
        <Link href={`/people/${id}`} className="orgh__card-link" onClick={(e) => e.stopPropagation()}>
          <span className="orgh__card-av" style={{ background: avColor(id) }}>
            {initials(node.user.firstName, node.user.lastName)}
          </span>
          <div className="orgh__card-info">
            <div className="orgh__card-name">{fullName}</div>
            <div className="orgh__card-meta">
              {node.user.role?.title ?? "—"}
              {node.user.department?.name && (
                <span className="orgh__card-dept">· {node.user.department.name}</span>
              )}
            </div>
          </div>
        </Link>
        {hasReports && (
          <span className="orgh__card-reports">
            {node.reports.length} report{node.reports.length === 1 ? "" : "s"}
            {isCollapsed ? <ChevronRight /> : <ChevronDown />}
          </span>
        )}
      </div>
      {hasReports && !isCollapsed && (
        <div className="orgh__children">
          {node.reports.map((r) => (
            <TreeNodeView key={r.user.id} node={r} depth={depth + 1} maxDepth={maxDepth} collapsed={collapsed} toggle={toggle} />
          ))}
        </div>
      )}
    </div>
  );
}

function LaunchTile({ href, Icon, gradient, title, sub }: { href: string; Icon: typeof Building2; gradient: string; title: string; sub: string }) {
  return (
    <Link href={href} className="orgh__launch-card">
      <div className="orgh__launch-icon" style={{ background: gradient }}><Icon /></div>
      <div className="orgh__launch-info">
        <span className="orgh__launch-title">{title}</span>
        <span className="orgh__launch-sub">{sub}</span>
      </div>
      <ChevronRight className="orgh__launch-arrow" />
    </Link>
  );
}

function KpiTile({ accent, Icon, label, value, sub }: { accent: string; Icon: typeof Building2; label: string; value: string; sub: string }) {
  return (
    <div className="orgh__kpi" style={{ ["--kpi-accent" as unknown as string]: accent }}>
      <span className="orgh__kpi-accent" aria-hidden="true" />
      <div className="orgh__kpi-row">
        <div className="orgh__kpi-icon"><Icon /></div>
        <div className="orgh__kpi-label">{label}</div>
      </div>
      <div className="orgh__kpi-value">{value}</div>
      <div className="orgh__kpi-sub">{sub}</div>
    </div>
  );
}
