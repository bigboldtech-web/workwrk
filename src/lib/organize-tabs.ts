// /sops/manage, "Organize" (spec-process section 2): the five tabs, which of
// them a viewer may hold, and the `?tab=` contract. An unknown or missing
// value falls back to SOP folders silently; a known value the viewer cannot
// hold is shape 2 of the denial convention (section 1 "Views a viewer
// cannot hold"): SOP folders renders, the parameter is stripped, and one
// notice line reads "That tab is for the People team and admins." Pure.

export type OrganizeTab = "sop-folders" | "tags" | "policy-categories" | "contract-folders" | "defaults";
export const ORGANIZE_TABS: readonly OrganizeTab[] = ["sop-folders", "tags", "policy-categories", "contract-folders", "defaults"];
export const ORGANIZE_TAB_LABEL: Record<OrganizeTab, string> = {
  "sop-folders": "SOP folders",
  tags: "Tags",
  "policy-categories": "Policy categories",
  "contract-folders": "Contract folders",
  defaults: "Defaults",
};
export const ORGANIZE_TAB_NOTICE = "That tab is for the People team and admins.";

export interface OrganizeViewer {
  /** Owner, Admin, People team: the manage_process rule. */
  manageProcess: boolean;
  /** Can create SOPs (a manager): SOP folders and Tags. */
  manageSops: boolean;
}

export function allowedOrganizeTabs(v: OrganizeViewer): OrganizeTab[] {
  if (v.manageProcess) return [...ORGANIZE_TABS];
  if (v.manageSops) return ["sop-folders", "tags"];
  return [];
}

export function resolveOrganizeTab(raw: string | null | undefined, v: OrganizeViewer): { tab: OrganizeTab; strip: boolean; notice: string | null } {
  if (!raw) return { tab: "sop-folders", strip: false, notice: null };
  const known = ORGANIZE_TABS.includes(raw as OrganizeTab) ? (raw as OrganizeTab) : null;
  if (!known) return { tab: "sop-folders", strip: true, notice: null };
  if (allowedOrganizeTabs(v).includes(known)) return { tab: known, strip: false, notice: null };
  return { tab: "sop-folders", strip: true, notice: ORGANIZE_TAB_NOTICE };
}
