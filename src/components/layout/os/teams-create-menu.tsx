"use client";

// TeamsCreateMenu — the Teams app's "+" menu. Replaces the global create menu
// (Task/List/Space/Doc…) with people-operation creates, each routing to the
// surface that owns it (with ?new=1 to auto-open its create dialog where one
// exists). Wired via AppEntry.CreateMenu on the Teams app entry.

import { useRef, type RefObject } from "react";
import { useRouter } from "next/navigation";
import { UserPlus, Briefcase, Target, Gauge, FileText, ClipboardCheck, type LucideIcon } from "lucide-react";
import { MorePortal } from "./more-portal";
import { MenuList, MenuItem, MenuSectionLabel } from "@/components/ui/menu";

interface Row { label: string; description: string; icon: LucideIcon; href: string; iconColor: string }

const SECTIONS: { label: string; rows: Row[] }[] = [
  {
    label: "People",
    rows: [
      { label: "Invite person", description: "Add someone + set access & manager", icon: UserPlus, href: "/settings/members?invite=1", iconColor: "#0073EA" },
      { label: "New role", description: "Define a role (owns, KRAs, KPIs, SOPs)", icon: Briefcase, href: "/people/roles?new=1", iconColor: "#F59E0B" },
    ],
  },
  {
    label: "Alignment",
    rows: [
      { label: "New KRA", description: "A key result area", icon: Target, href: "/kra-kpi?new=1", iconColor: "#a78b6c" },
      { label: "New KPI", description: "A metric under a KRA", icon: Gauge, href: "/kra-kpi", iconColor: "#16a34a" },
      { label: "New SOP", description: "A procedure attached to a role", icon: FileText, href: "/sops/new", iconColor: "#3b82f6" },
    ],
  },
  {
    label: "Performance",
    rows: [
      { label: "Start review cycle", description: "Kick off a formal review", icon: ClipboardCheck, href: "/reviews?new=1", iconColor: "#dc2626" },
    ],
  },
];

export function TeamsCreateMenu({ anchorRef, open, onClose }: { anchorRef: RefObject<HTMLButtonElement | null>; open: boolean; onClose: () => void }) {
  const router = useRouter();
  const panelRef = useRef<HTMLDivElement>(null);
  if (!open) return null;

  const go = (href: string) => { onClose(); router.push(href); };

  return (
    <>
      <div className="fixed inset-0 z-30" onClick={onClose} aria-hidden />
      <MorePortal anchorRef={anchorRef} panelRef={panelRef} width={288} open={open} placement="below">
        <div className="overflow-hidden rounded-xl border border-zinc-200 bg-white shadow-[0_14px_34px_rgba(0,0,0,0.14)] p-2">
          {SECTIONS.map((section) => (
            <div key={section.label} className="pb-1 last:pb-0">
              <MenuSectionLabel className="px-2">{section.label}</MenuSectionLabel>
              <MenuList>
                {section.rows.map((r) => (
                  <MenuItem
                    key={r.label}
                    variant="inset"
                    leading={
                      <span className="inline-flex h-6 w-6 items-center justify-center rounded-md shrink-0" style={{ background: `${r.iconColor}1a` }}>
                        <r.icon className="h-3.5 w-3.5" style={{ color: r.iconColor }} />
                      </span>
                    }
                    label={r.label}
                    description={r.description}
                    onClick={() => go(r.href)}
                  />
                ))}
              </MenuList>
            </div>
          ))}
        </div>
      </MorePortal>
    </>
  );
}
