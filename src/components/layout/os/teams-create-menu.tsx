"use client";

// TeamsCreateMenu: the Teams hub's "+" (spec-teams-people section 1 and
// sidebar-map section 5). Each row routes to the surface that owns the
// create, with a `?new=` latch that opens its dialog there. A row renders
// only for the viewer whose create would succeed (no control without a
// handler), and a section with no renderable row is not rendered.
//
//   People       Invite person      /settings/members?invite=1   Owner, Admin (the workspace menu's rule)
//                New job title      /people/roles?new=1          Owner, Admin, People team
//                New department     /people/departments?new=1    Owner, Admin
//   Alignment    New KRA            /kra-kpi?new=kra             the kras.create permission POST /api/kras asks
//                New KPI            /kra-kpi?new=kpi             the same permission
//   Performance  Start review cycle /reviews?new=1               reports (at the manager tier POST /api/reviews asks), People team, Admin
//   Culture      Give kudos         /kudos?new=1                 every Member
//
// "New SOP" left this menu for the Docs hub "+" (its "New SOP" kind chooser),
// one create per hub. Neutral icons, no coloured tiles, no TAUPE.

import { useMemo, useRef, type RefObject } from "react";
import { useRouter } from "next/navigation";
import { Briefcase, Building2, ClipboardList, Gauge, Heart, Target, UserPlus, type LucideIcon } from "lucide-react";
import { MorePortal } from "./more-portal";
import { MenuList, MenuItem, MenuSectionLabel } from "@/components/ui/menu";
import { usePermission } from "@/hooks/use-permission";
import { useSettingsNav } from "@/hooks/use-settings-nav";
import { useBoot } from "./boot-context";
import { leaveThen } from "@/lib/dirty-guard";

interface Row { label: string; description: string; icon: LucideIcon; href: string; settings?: boolean }

export function TeamsCreateMenu({ anchorRef, open, onClose }: { anchorRef: RefObject<HTMLButtonElement | null>; open: boolean; onClose: () => void }) {
  const router = useRouter();
  const panelRef = useRef<HTMLDivElement>(null);
  const { openSettings } = useSettingsNav();
  const { boot } = useBoot();
  const canCreateKra = usePermission("kras", "create") === true;

  const v = boot.viewer;
  const isAdmin = v.orgRole === "OWNER" || v.orgRole === "ADMIN";
  const isGuest = v.orgRole === "GUEST";
  // The create rule of Review cycles (spec-teams-people section 1): anyone
  // with reports runs a cycle over their chain, the People team and Admin
  // over the org. POST /api/reviews asks the same facts
  // (mayStartReviewCycles), so the row never opens a dialog whose save 403s.
  const canStartCycle = isAdmin || v.peopleTeam || v.hasReports;

  const sections = useMemo(() => {
    const out: { label: string; rows: Row[] }[] = [];
    const people: Row[] = [];
    if (isAdmin) people.push({ label: "Invite person", description: "Add someone and set their access and manager", icon: UserPlus, href: "/settings/members?invite=1", settings: true });
    if (isAdmin || v.peopleTeam) people.push({ label: "New job title", description: "What the role owns, its KRAs, KPIs and SOPs", icon: Briefcase, href: "/people/roles?new=1" });
    if (isAdmin) people.push({ label: "New department", description: "A department and its head", icon: Building2, href: "/people/departments?new=1" });
    if (people.length) out.push({ label: "People", rows: people });
    if (canCreateKra) {
      out.push({
        label: "Alignment",
        rows: [
          { label: "New KRA", description: "A key result area on a job title", icon: Target, href: "/kra-kpi?new=kra" },
          { label: "New KPI", description: "A measured number under a KRA", icon: Gauge, href: "/kra-kpi?new=kpi" },
        ],
      });
    }
    if (canStartCycle) out.push({ label: "Performance", rows: [{ label: "Start review cycle", description: "Kick off a formal review", icon: ClipboardList, href: "/reviews?new=1" }] });
    if (!isGuest) out.push({ label: "Culture", rows: [{ label: "Give kudos", description: "Thank someone for their work", icon: Heart, href: "/kudos?new=1" }] });
    return out;
  }, [isAdmin, isGuest, v.peopleTeam, canCreateKra, canStartCycle]);

  if (!open || sections.length === 0) return null;

  const go = (r: Row) => {
    onClose();
    // Both kinds of row ask before leaving unsaved work: openSettings asks
    // on its own, and a page row goes through the same leaveThen.
    if (r.settings) openSettings(r.href);
    else void leaveThen(() => router.push(r.href));
  };

  return (
    <>
      <div className="fixed inset-0 z-30" onClick={onClose} aria-hidden />
      <MorePortal anchorRef={anchorRef} panelRef={panelRef} width={288} open={open} placement="below">
        <MenuList className="px-1">
          {sections.map((section) => (
            <div key={section.label} className="pb-1 last:pb-0">
              <MenuSectionLabel>{section.label}</MenuSectionLabel>
              {section.rows.map((r) => (
                <MenuItem key={r.label} icon={r.icon} label={r.label} description={r.description} onClick={() => go(r)} />
              ))}
            </div>
          ))}
        </MenuList>
      </MorePortal>
    </>
  );
}
