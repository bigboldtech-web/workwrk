export type PresetId =
  | "starter"
  | "people-hr"
  | "engineering"
  | "marketing"
  | "operations";

export type ViewKey =
  | "LIST"
  | "BOARD"
  | "CALENDAR"
  | "TEAM"
  | "GANTT"
  | "TIMELINE"
  | "MAP"
  | "ACTIVITY"
  | "TABLE"
  | "MIND_MAP"
  | "WORKLOAD";

export type StatusGroup = "ACTIVE" | "DONE" | "CLOSED";

export interface StatusDef {
  key: string;
  label: string;
  group: StatusGroup;
  color: string;
}

export type ModuleKey =
  // WorkwrK-native
  | "KRA"
  | "KPI"
  | "SOP"
  | "REVIEWS"
  | "KUDOS"
  | "CANDOR"
  | "SURVEYS"
  | "ANNOUNCEMENTS"
  | "COMPENSATION"
  | "ORG_CHART"
  | "NOTES"
  | "WHITEBOARDS"
  | "TIME_TRACKING"
  | "CALENDAR_VIEW"
  // Generic project mgmt
  | "PRIORITY"
  | "TAGS"
  | "CUSTOM_FIELDS"
  | "TIME_ESTIMATES"
  | "SPRINTS"
  | "SPRINT_POINTS"
  | "DEPENDENCIES"
  | "MULTIPLE_ASSIGNEES"
  | "WIP_LIMITS"
  | "INCOMPLETE_WARNING"
  | "EMAIL"
  | "HIRING";

export interface WorkflowConfig {
  preset: PresetId;
  ownerId: string | null;
  linkedKraIds: string[];
  defaultViews: ViewKey[];
  defaultViewKey: ViewKey;
  statuses: StatusDef[];
  modules: ModuleKey[];
}
