"use client";

// SettingsShell — the full-screen "settings mode" chrome. When the user
// is anywhere under /settings or /account, OsShell steps aside (no app
// rail, no Home sidebar, no topbar) and renders this instead: a slim top
// bar with a back/close affordance + workspace breadcrumb, a categorized
// settings nav on the left, and the page in the content area.
//
// Back/Close are <Link>s (not <button>s) on purpose — the global
// `.workwrk-os button { padding:0; border:none; background:none }` reset
// would otherwise strip their chrome. Esc also closes (→ /today).

import { useEffect, useState, type ReactNode } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useSession } from "next-auth/react";
import {
  ArrowLeft, X, ChevronRight, LayoutGrid, Building2, Tag, Shapes, Users,
  Globe, CreditCard, Boxes, Key, Calendar, FileCheck, Plug, Download,
  BarChart3, Shield, ShieldCheck, Network, User, Bell, Palette,
  Landmark, CircleUser, Blocks, Database, Lock, type LucideIcon,
} from "lucide-react";

// The org-config door is gated to the same two tiers as the server guards
// (requireOrgAdminOrRedirect / isOrgAdmin). Managers see only the Personal
// door; SUPER_ADMIN / COMPANY_ADMIN also see the Admin door.
const ORG_ADMIN_LEVELS = new Set(["SUPER_ADMIN", "COMPANY_ADMIN"]);

type NavItem = {
  label: string;
  icon: LucideIcon;
  /** Omitted → rendered as a disabled "Soon" row. */
  href?: string;
  /** Highlight only on an exact pathname match (used for the overview). */
  exact?: boolean;
};
/** A labeled cluster of rows. Omit `label` for an unlabeled cluster. */
type NavGroup = { label?: string; items: NavItem[] };
/**
 * A top-level "door". `adminOnly` doors are hidden entirely for non-admins —
 * the same split the founder locked: Admin (org config) vs Personal (/account).
 * Regrouping only: every route below is one that already had a nav entry, plus
 * the three new admin pages (structure / data / defaults) siblings are building.
 */
type NavDoor = {
  key: string;
  label: string;
  icon: LucideIcon;
  adminOnly: boolean;
  groups: NavGroup[];
};

const DOORS: NavDoor[] = [
  {
    key: "admin",
    label: "Admin",
    icon: Landmark,
    adminOnly: true,
    groups: [
      {
        label: "Organization",
        items: [
          { label: "Overview", icon: LayoutGrid, href: "/settings", exact: true },
          { label: "Identity & profile", icon: Building2, href: "/settings/identity" },
          { label: "Locale & finance", icon: Globe, href: "/settings/locale" },
          { label: "Enabled modules", icon: Boxes, href: "/settings/modules" },
          { label: "Tags & labels", icon: Tag, href: "/settings/tags" },
          { label: "Task types", icon: Shapes, href: "/settings/task-types" },
        ],
      },
      {
        label: "People & structure",
        items: [
          { label: "Members", icon: Users, href: "/settings/members" },
          { label: "Org structure", icon: Blocks, href: "/settings/structure" },
          { label: "Reporting hierarchy", icon: Network, href: "/settings/hierarchy" },
          { label: "Roles & permissions", icon: ShieldCheck, href: "/settings/permissions" },
        ],
      },
      {
        label: "Governance",
        items: [
          { label: "Audit log", icon: FileCheck, href: "/settings/audit" },
          { label: "Data & compliance", icon: Database, href: "/settings/data" },
          { label: "Defaults & locks", icon: Lock, href: "/settings/defaults" },
        ],
      },
      {
        label: "Platform",
        items: [
          { label: "API keys", icon: Key, href: "/settings/api" },
          { label: "Calendar feeds", icon: Calendar, href: "/settings/calendar" },
          { label: "Integrations", icon: Plug, href: "/settings/integrations" },
          { label: "Import / Export", icon: Download, href: "/settings/import-export" },
        ],
      },
      {
        label: "Billing & performance",
        items: [
          { label: "Plan & billing", icon: CreditCard, href: "/settings/billing" },
          { label: "Scoring & reviews", icon: BarChart3, href: "/settings/scoring" },
        ],
      },
    ],
  },
  {
    key: "personal",
    label: "Personal",
    icon: CircleUser,
    adminOnly: false,
    groups: [
      {
        items: [
          { label: "Profile", icon: User, href: "/account/profile" },
          { label: "Notifications", icon: Bell, href: "/settings/notifications" },
          { label: "Appearance", icon: Palette, href: "/account/appearance" },
          { label: "Security", icon: Shield, href: "/account/security" },
        ],
      },
    ],
  },
];

export function SettingsShell({ children }: { children: ReactNode }) {
  const pathname = usePathname() || "";
  const router = useRouter();
  const { data: session } = useSession();
  const accessLevel = (session?.user as { accessLevel?: string } | undefined)?.accessLevel;
  const isOrgAdmin = !!accessLevel && ORG_ADMIN_LEVELS.has(accessLevel);
  const [org, setOrg] = useState<string | null>(null);

  // Esc closes settings.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") router.push("/today");
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [router]);

  // Workspace name for the breadcrumb.
  useEffect(() => {
    let alive = true;
    fetch("/api/settings")
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => { if (alive && d?.organization?.name) setOrg(d.organization.name); })
      .catch(() => {});
    return () => { alive = false; };
  }, []);

  return (
    <div className="flex h-full flex-col bg-white text-zinc-900">
      <header className="flex h-12 shrink-0 items-center gap-2 border-b border-zinc-200 px-3">
        <Link
          href="/today"
          className="inline-flex h-8 items-center gap-1.5 rounded-lg px-2 text-[14px] font-medium text-zinc-600 hover:bg-zinc-100 hover:text-zinc-900"
          title="Back to workspace (Esc)"
        >
          <ArrowLeft className="h-4 w-4" />
          Back
        </Link>
        <span className="mx-1 h-5 w-px bg-zinc-200" />
        <div className="flex min-w-0 items-center gap-1.5 text-[14px]">
          <span className="truncate font-medium text-zinc-900">{org ?? "Workspace"}</span>
          <ChevronRight className="h-3.5 w-3.5 shrink-0 text-zinc-400" />
          <span className="text-zinc-500">Settings</span>
        </div>
        <div className="flex-1" />
        <Link
          href="/today"
          aria-label="Close settings"
          title="Close (Esc)"
          className="inline-flex h-8 w-8 items-center justify-center rounded-lg text-zinc-500 hover:bg-zinc-100 hover:text-zinc-900"
        >
          <X className="h-4 w-4" />
        </Link>
      </header>

      <div className="flex min-h-0 flex-1">
        {/* ClickUp settings nav: white column, "All settings" header,
            sentence-case section labels, compact stadium-pill rows. */}
        <nav className="flex w-[248px] shrink-0 flex-col border-r border-zinc-200 bg-white px-2 py-2">
          <div className="px-2.5 pb-2 pt-2 text-[15px] font-bold text-zinc-900">All settings</div>
          <div className="flex-1 overflow-y-auto">
            {DOORS.map((door) => {
              // Admin door is hidden entirely for non-admins.
              if (door.adminOnly && !isOrgAdmin) return null;
              const DoorIcon = door.icon;
              return (
                <div
                  key={door.key}
                  className="mt-4 border-t border-zinc-100 pt-3 first:mt-0 first:border-t-0 first:pt-0"
                >
                  <div className="flex items-center gap-1.5 px-2.5 pb-0.5">
                    <DoorIcon className="h-3.5 w-3.5 shrink-0 text-zinc-400" />
                    <span className="text-[12px] font-semibold uppercase tracking-wide text-zinc-500">
                      {door.label}
                    </span>
                  </div>
                  {door.groups.map((group, gi) => (
                    <div key={group.label ?? `g${gi}`}>
                      {group.label ? (
                        <div className="px-2.5 pb-1 pt-3 text-[12px] font-medium text-zinc-400">
                          {group.label}
                        </div>
                      ) : (
                        <div className="pt-1.5" />
                      )}
                      <ul className="space-y-0.5">
                        {group.items.map((item) => {
                          const Icon = item.icon;
                          if (!item.href) {
                            return (
                              <li key={item.label}>
                                <span className="flex h-7 cursor-default select-none items-center gap-2.5 rounded-full px-2.5 text-[14px] text-zinc-400">
                                  <Icon className="h-3.5 w-3.5 shrink-0 text-zinc-300" />
                                  <span className="min-w-0 flex-1 truncate">{item.label}</span>
                                  <span className="rounded bg-zinc-100 px-1.5 py-0.5 text-[11px] font-medium text-zinc-400">Soon</span>
                                </span>
                              </li>
                            );
                          }
                          const active = item.exact ? pathname === item.href : pathname.startsWith(item.href);
                          return (
                            <li key={item.label}>
                              <Link
                                href={item.href}
                                className={`flex h-7 items-center gap-2.5 rounded-full px-2.5 text-[14px] transition-colors ${
                                  active
                                    ? "bg-zinc-100 font-medium text-zinc-900"
                                    : "text-zinc-600 hover:bg-zinc-50 hover:text-zinc-900"
                                }`}
                              >
                                <Icon className={`h-3.5 w-3.5 shrink-0 ${active ? "text-zinc-700" : "text-zinc-400"}`} />
                                <span className="min-w-0 flex-1 truncate">{item.label}</span>
                              </Link>
                            </li>
                          );
                        })}
                      </ul>
                    </div>
                  ))}
                </div>
              );
            })}
          </div>
        </nav>

        <main className="min-w-0 flex-1 overflow-y-auto">{children}</main>
      </div>
    </div>
  );
}
