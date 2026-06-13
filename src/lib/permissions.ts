// ============================================
// Permission System
// ============================================
// Modules and actions that can be permission-controlled.
// Permissions are stored in Organization.settings.permissions and can be
// edited by COMPANY_ADMIN / SUPER_ADMIN via the Access Control settings UI.

export type AccessLevel =
  | "SUPER_ADMIN"
  | "COMPANY_ADMIN"
  | "C_LEVEL"
  | "VP"
  | "DIRECTOR"
  | "MANAGER"
  | "TEAM_LEAD"
  | "HR"
  | "EMPLOYEE"
  | "AGENT";

export const ACCESS_LEVELS: { value: AccessLevel; label: string; description: string }[] = [
  { value: "SUPER_ADMIN", label: "Super Admin", description: "System owner — full access (cannot be modified)" },
  { value: "COMPANY_ADMIN", label: "Company Admin", description: "Org owner — full access (cannot be modified)" },
  { value: "C_LEVEL", label: "C-Level", description: "Executives (CEO, CFO, CTO)" },
  { value: "VP", label: "VP", description: "Vice Presidents" },
  { value: "DIRECTOR", label: "Director", description: "Department directors" },
  { value: "HR", label: "HR", description: "HR personnel" },
  { value: "MANAGER", label: "Manager", description: "Team managers" },
  { value: "TEAM_LEAD", label: "Team Lead", description: "Team leads" },
  { value: "EMPLOYEE", label: "Employee", description: "Standard employees" },
  { value: "AGENT", label: "Agent", description: "External agents (limited access)" },
];

// Roles that always have full access (cannot be restricted)
export const PROTECTED_ADMIN_ROLES: AccessLevel[] = ["SUPER_ADMIN", "COMPANY_ADMIN"];

// Modules and their actions
export const PERMISSION_MODULES = {
  people: {
    label: "People",
    actions: {
      view: "View people directory",
      create: "Add new people / invite",
      edit: "Edit people details",
      delete: "Remove people",
      bulkActions: "Bulk operations (assign KRA/SOP, change dept)",
    },
  },
  organization: {
    label: "Organization",
    actions: {
      view: "View org chart and structure",
      edit: "Edit company profile (mission, vision, values)",
      manageDepartments: "Create/edit/delete departments",
      manageRoles: "Create/edit/delete roles",
      manageOffices: "Manage office locations",
    },
  },
  kras: {
    label: "KRAs & KPIs",
    actions: {
      view: "View KRAs and KPIs",
      create: "Create KRAs and KPIs",
      edit: "Edit KRAs and KPIs",
      delete: "Delete KRAs and KPIs",
      assign: "Assign KRAs to people",
      recordKpi: "Record KPI values",
      aiGenerate: "Use AI to generate KRAs",
    },
  },
  sops: {
    label: "SOPs",
    actions: {
      view: "View SOPs",
      create: "Create SOPs",
      edit: "Edit SOPs",
      publish: "Publish SOPs",
      delete: "Delete SOPs",
      assign: "Assign SOPs to people",
      aiGenerate: "Use AI to generate SOPs",
    },
  },
  reviews: {
    label: "Reviews",
    actions: {
      view: "View reviews",
      create: "Create review cycles",
      launch: "Launch review cycles",
      finalize: "Finalize reviews",
      delete: "Delete reviews",
    },
  },
  okrs: {
    label: "OKRs",
    actions: {
      view: "View OKRs",
      create: "Create OKRs",
      edit: "Edit OKRs",
      delete: "Delete OKRs",
      checkIn: "Check in on OKRs",
    },
  },
  tasks: {
    label: "Tasks",
    actions: {
      view: "View tasks",
      create: "Create tasks",
      edit: "Edit tasks",
      delete: "Delete tasks",
      assignToOthers: "Assign tasks to other people",
    },
  },
  meetings: {
    label: "Meetings",
    actions: {
      view: "View meetings",
      create: "Create meetings",
      edit: "Edit meetings",
      delete: "Delete meetings",
    },
  },
  policies: {
    label: "Policies",
    actions: {
      view: "View policies",
      create: "Create policies",
      edit: "Edit policies",
      delete: "Delete policies",
      publish: "Publish policies",
    },
  },
  announcements: {
    label: "Announcements",
    actions: {
      view: "View announcements",
      create: "Create announcements",
      edit: "Edit announcements",
      delete: "Delete announcements",
    },
  },
  assets: {
    label: "Assets",
    actions: {
      view: "View all assets",
      viewOwn: "View only own assets",
      create: "Add new assets",
      edit: "Edit assets",
      delete: "Delete assets",
      assign: "Assign assets to people",
    },
  },
  surveys: {
    label: "Surveys",
    actions: {
      view: "View surveys",
      create: "Create surveys",
      respond: "Respond to surveys",
      viewResults: "View survey results",
    },
  },
  ideas: {
    label: "Ideas",
    actions: {
      view: "View ideas board",
      submit: "Submit ideas",
      review: "Review and approve ideas",
      delete: "Delete ideas",
    },
  },
  analytics: {
    label: "Analytics",
    actions: {
      view: "View analytics dashboards",
      viewOrgWide: "View org-wide analytics",
      export: "Export analytics data",
    },
  },
  tools: {
    label: "Tools & Credentials",
    actions: {
      view: "View shared tools",
      create: "Add new tools",
      edit: "Edit tool credentials",
      delete: "Delete tools",
      share: "Share tools with people",
    },
  },
  onboarding: {
    label: "Onboarding",
    actions: {
      view: "View onboarding instances",
      manage: "Manage onboarding templates and assignments",
    },
  },
  settings: {
    label: "Settings",
    actions: {
      viewGeneral: "View general settings",
      editGeneral: "Edit general settings",
      manageBilling: "Manage billing",
      manageIntegrations: "Manage integrations",
      manageAccessControl: "Manage access control (this page)",
    },
  },
} as const;

export type PermissionModule = keyof typeof PERMISSION_MODULES;
export type PermissionAction<M extends PermissionModule> = keyof (typeof PERMISSION_MODULES)[M]["actions"];

export type PermissionMatrix = {
  [level in AccessLevel]?: {
    [module in PermissionModule]?: {
      [action: string]: boolean;
    };
  };
};

// ============================================
// DEFAULT PERMISSIONS
// ============================================
// These are the defaults applied when a permission isn't explicitly set
// in the org's permission matrix. They define the baseline behavior.

const allTrue = (mod: PermissionModule): Record<string, boolean> => {
  const actions = Object.keys(PERMISSION_MODULES[mod].actions);
  return Object.fromEntries(actions.map((a) => [a, true]));
};

const allFalse = (mod: PermissionModule): Record<string, boolean> => {
  const actions = Object.keys(PERMISSION_MODULES[mod].actions);
  return Object.fromEntries(actions.map((a) => [a, false]));
};

// SUPER_ADMIN and COMPANY_ADMIN: full access to everything
const fullAccess: PermissionMatrix[AccessLevel] = Object.fromEntries(
  Object.keys(PERMISSION_MODULES).map((m) => [m, allTrue(m as PermissionModule)])
) as any;

// EMPLOYEE: view-only with self-service
const employeeAccess: PermissionMatrix[AccessLevel] = {
  people: { view: true, create: false, edit: false, delete: false, bulkActions: false },
  organization: { view: true, edit: false, manageDepartments: false, manageRoles: false, manageOffices: false },
  kras: { view: true, create: false, edit: false, delete: false, assign: false, recordKpi: true, aiGenerate: false },
  sops: { view: true, create: false, edit: false, publish: false, delete: false, assign: false, aiGenerate: false },
  reviews: { view: true, create: false, launch: false, finalize: false, delete: false },
  okrs: { view: true, create: true, edit: true, delete: false, checkIn: true },
  tasks: { view: true, create: true, edit: true, delete: true, assignToOthers: false },
  meetings: { view: true, create: true, edit: true, delete: true },
  policies: { view: true, create: false, edit: false, delete: false, publish: false },
  announcements: { view: true, create: false, edit: false, delete: false },
  assets: { view: false, viewOwn: true, create: false, edit: false, delete: false, assign: false },
  surveys: { view: true, create: false, respond: true, viewResults: false },
  ideas: { view: true, submit: true, review: false, delete: false },
  analytics: { view: false, viewOrgWide: false, export: false },
  tools: { view: true, create: false, edit: false, delete: false, share: false },
  onboarding: { view: true, manage: false },
  settings: { viewGeneral: false, editGeneral: false, manageBilling: false, manageIntegrations: false, manageAccessControl: false },
};

// MANAGER: can manage their team and most operational stuff
const managerAccess: PermissionMatrix[AccessLevel] = {
  people: { view: true, create: true, edit: true, delete: false, bulkActions: true },
  organization: { view: true, edit: false, manageDepartments: false, manageRoles: false, manageOffices: false },
  kras: allTrue("kras"),
  sops: { view: true, create: true, edit: true, publish: true, delete: false, assign: true, aiGenerate: true },
  reviews: { view: true, create: true, launch: true, finalize: true, delete: false },
  okrs: allTrue("okrs"),
  tasks: { ...allTrue("tasks"), delete: false },
  meetings: allTrue("meetings"),
  policies: { view: true, create: true, edit: true, delete: false, publish: true },
  announcements: { view: true, create: true, edit: true, delete: false },
  assets: { view: true, viewOwn: true, create: true, edit: true, delete: false, assign: true },
  surveys: { view: true, create: true, respond: true, viewResults: true },
  ideas: { view: true, submit: true, review: true, delete: false },
  analytics: { view: true, viewOrgWide: false, export: true },
  tools: { view: true, create: false, edit: false, delete: false, share: false },
  onboarding: { view: true, manage: true },
  settings: { viewGeneral: true, editGeneral: false, manageBilling: false, manageIntegrations: false, manageAccessControl: false },
};

// HR: similar to manager but more people-focused
const hrAccess: PermissionMatrix[AccessLevel] = {
  ...managerAccess,
  people: allTrue("people"),
  organization: { view: true, edit: false, manageDepartments: true, manageRoles: true, manageOffices: true },
  reviews: allTrue("reviews"),
  policies: allTrue("policies"),
  onboarding: allTrue("onboarding"),
};

// C-Level / VP / Director: same as manager + more organization access
const executiveAccess: PermissionMatrix[AccessLevel] = {
  ...managerAccess,
  organization: allTrue("organization"),
  people: allTrue("people"),
  analytics: allTrue("analytics"),
  settings: { viewGeneral: true, editGeneral: true, manageBilling: false, manageIntegrations: true, manageAccessControl: false },
};

// AGENT: minimal access
const agentAccess: PermissionMatrix[AccessLevel] = {
  ...employeeAccess,
  tasks: { view: true, create: true, edit: true, delete: false, assignToOthers: false },
  assets: { view: false, viewOwn: true, create: false, edit: false, delete: false, assign: false },
};

export const DEFAULT_PERMISSIONS: PermissionMatrix = {
  SUPER_ADMIN: fullAccess,
  COMPANY_ADMIN: fullAccess,
  C_LEVEL: executiveAccess,
  VP: executiveAccess,
  DIRECTOR: executiveAccess,
  HR: hrAccess,
  MANAGER: managerAccess,
  TEAM_LEAD: managerAccess,
  EMPLOYEE: employeeAccess,
  AGENT: agentAccess,
};

// ============================================
// Permission resolution
// ============================================

/**
 * Resolves whether a given access level has permission for a module/action,
 * checking the org's custom matrix first and falling back to defaults.
 */
export function checkPermission(
  accessLevel: AccessLevel,
  matrix: PermissionMatrix | null | undefined,
  module: PermissionModule,
  action: string
): boolean {
  // Protected admin roles always have access (cannot be locked out)
  if (PROTECTED_ADMIN_ROLES.includes(accessLevel)) return true;

  // Check custom matrix first
  const custom = matrix?.[accessLevel]?.[module]?.[action];
  if (custom !== undefined) return custom;

  // Fall back to defaults
  return DEFAULT_PERMISSIONS[accessLevel]?.[module]?.[action] ?? false;
}

/**
 * Returns the full effective permission set for an access level (custom + defaults merged)
 */
export function getEffectivePermissions(
  accessLevel: AccessLevel,
  matrix: PermissionMatrix | null | undefined
): Record<PermissionModule, Record<string, boolean>> {
  const result: any = {};
  for (const mod of Object.keys(PERMISSION_MODULES) as PermissionModule[]) {
    result[mod] = {};
    for (const action of Object.keys(PERMISSION_MODULES[mod].actions)) {
      result[mod][action] = checkPermission(accessLevel, matrix, mod, action);
    }
  }
  return result;
}
