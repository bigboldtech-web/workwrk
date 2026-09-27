// The Ask AI tool set, as names only. Pure and client safe, so the chat
// thread's verb map (tool-verbs.ts) and the server registry (tools.ts) are
// typed against the same list and a tool with no sentence is a compile error.
//
// spec-ai-automation.md section 2 `/sidekick`, "Tool calls": the registry had
// 42 names, 14 of them CRM, helpdesk and marketing verbs that left the
// product with the PPMS scope (create_lead, create_opportunity,
// create_ticket, create_support_ticket, create_campaign, search_leads,
// search_opportunities, search_tickets, update_lead_status,
// update_ticket_status, move_opportunity_stage, apply_macro, search_kb,
// assign_ticket). These 28 remain.

export const PPMS_TOOL_NAMES = [
  "create_contract",
  "create_data_table",
  "create_doc",
  "create_form",
  "create_kpi",
  "create_kra",
  "create_meeting",
  "create_okr",
  "create_sop",
  "create_sprint",
  "create_task",
  "create_workspace",
  "get_team_alignment_rollup",
  "invite_person_with_role",
  "list_data_tables",
  "list_forms",
  "list_my_kpi_status",
  "list_my_kras",
  "list_my_sops",
  "list_my_weekly_reviews",
  "search_contracts",
  "search_employees",
  "search_meetings",
  "search_okrs",
  "search_sops",
  "search_tasks",
  "send_kudos",
  "update_contract",
] as const;

export type ToolName = (typeof PPMS_TOOL_NAMES)[number];

const NAME_SET: ReadonlySet<string> = new Set(PPMS_TOOL_NAMES);

export function isToolName(name: string): name is ToolName {
  return NAME_SET.has(name);
}
