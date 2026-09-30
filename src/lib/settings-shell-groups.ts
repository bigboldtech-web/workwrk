// The settings takeover's sidebar list, as a pure function of the door and
// the viewer (settings spec 1.2, spec-account-auth "My settings door
// sidebar"). SettingsShell renders it; the vitest suite proves it.
//
// Workspace door (Owners and Admins only): the ungrouped Overview, the five
// groups in order, All settings last under a rule. Every row the registry
// marks navigable today (Workspace Security waits for S5).
// My settings: seven flat rows; Owners and Admins get one more under a rule,
// "Workspace settings", so the two doors are one click apart. Anyone else on
// a Workspace URL sees this list too, so the Workspace door's shape never
// leaks to someone who cannot open it.

import {
  DOOR_LABELS,
  WORKSPACE_GROUP_ORDER,
  settingsSidebar,
  type SettingsIconName,
  type SettingsPage,
} from "./settings-registry";
import type { SettingsPageKey } from "./access/types";

export type SettingsDoorProp = "me" | "workspace";
export type SettingsShellIconName = SettingsIconName;

export interface SettingsShellRow {
  key: string;
  label: string;
  href: string;
  icon: SettingsShellIconName;
  /** The page this row is; null for the cross-door row. */
  pageKey: SettingsPageKey | null;
}

export interface SettingsShellGroup {
  label?: string;
  /** A 1px rule above the group (All settings, the cross-door row). */
  ruleAbove?: boolean;
  rows: SettingsShellRow[];
}

function rowOf(p: SettingsPage): SettingsShellRow {
  return { key: p.key, label: p.label, href: p.href, icon: p.icon, pageKey: p.key };
}

/**
 * The Workspace pages a reader below Admin opens today (settings-gate.tsx
 * LEGACY_SETTINGS_RULES "manager-tier"; sidebar-map 8a lists the People
 * team's rows as Members, Structure, Access and Scoring, and Structure
 * joins when the engine gate gives it to the People team).
 */
export const SETTINGS_READER_PAGES: readonly SettingsPageKey[] = ["members", "access", "scoring"];

/**
 * The reader list (sidebar-map 8a): a first row "My settings" so the list is
 * never an orphan, then the reader's pages under their own group labels
 * (PEOPLE, WORK) and no others.
 */
export function readerShellGroups(readerPages: readonly SettingsPageKey[] = SETTINGS_READER_PAGES): SettingsShellGroup[] {
  const pages = settingsSidebar("workspace").filter((p) => readerPages.includes(p.key));
  const groups: SettingsShellGroup[] = [
    { rows: [{ key: "me-door", label: DOOR_LABELS.me, href: "/account/profile", icon: "CircleUser", pageKey: null }] },
  ];
  for (const g of WORKSPACE_GROUP_ORDER) {
    const rows = pages.filter((p) => p.group === g).map(rowOf);
    if (rows.length) groups.push({ label: g, rows });
  }
  return groups;
}

export function settingsShellGroups(door: SettingsDoorProp, isAdmin: boolean, reader = false, readerPages: readonly SettingsPageKey[] = SETTINGS_READER_PAGES): SettingsShellGroup[] {
  if (door === "workspace" && !isAdmin && reader) return readerShellGroups(readerPages);
  if (door === "workspace" && isAdmin) {
    const pages = settingsSidebar("workspace");
    const groups: SettingsShellGroup[] = [{ rows: pages.filter((p) => !p.group && p.key !== "all").map(rowOf) }];
    for (const g of WORKSPACE_GROUP_ORDER) {
      const rows = pages.filter((p) => p.group === g).map(rowOf);
      if (rows.length) groups.push({ label: g, rows });
    }
    const last = pages.filter((p) => p.key === "all").map(rowOf);
    if (last.length) groups.push({ ruleAbove: true, rows: last });
    return groups;
  }
  const groups: SettingsShellGroup[] = [{ rows: settingsSidebar("me").map(rowOf) }];
  if (isAdmin) {
    groups.push({
      ruleAbove: true,
      rows: [{ key: "workspace-door", label: DOOR_LABELS.workspace, href: "/settings", icon: "Building2", pageKey: null }],
    });
  }
  return groups;
}
