// The tool set, as names only: the 28 Ask AI tools and the 10 AI teammate
// tools. Pure and client safe, so the chat thread's verb map
// (tool-verbs.ts), the approval policy (tool-policy.ts) and the server
// registry (tools.ts) are typed against the same list and a tool with no
// sentence or no risk is a compile error.
//
// spec-ai-automation.md section 2 `/sidekick`, "Tool calls": the registry had
// 42 names, 14 of them CRM, helpdesk and marketing verbs that left the
// product with the PPMS scope (create_lead, create_opportunity,
// create_ticket, create_support_ticket, create_campaign, search_leads,
// search_opportunities, search_tickets, update_lead_status,
// update_ticket_status, move_opportunity_stage, apply_macro, search_kb,
// assign_ticket). These 28 remain.
//
// AI teammates (docs/plans/ai-teammates.md 3.4) add 10 that only a teammate
// may use (src/lib/agents/teammate-tools.ts). They are in no Ask AI set below
// (CROSS_TOOL_NAMES, PRODUCT_TOOL_NAMES), so Ask AI is offered exactly what it
// was offered before.

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

export const TEAMMATE_TOOL_NAMES = [
  "update_task",
  "comment_on_task",
  "move_task",
  "post_in_talk",
  "update_doc",
  "remember",
  "forget",
  "create_routine",
  "list_my_inbox",
  "read_talk",
] as const;

export type AskAiToolName = (typeof PPMS_TOOL_NAMES)[number];

export type TeammateToolName = (typeof TEAMMATE_TOOL_NAMES)[number];

export type ToolName = AskAiToolName | TeammateToolName;

const NAME_SET: ReadonlySet<string> = new Set<string>([...PPMS_TOOL_NAMES, ...TEAMMATE_TOOL_NAMES]);

const TEAMMATE_SET: ReadonlySet<string> = new Set<string>(TEAMMATE_TOOL_NAMES);

export function isToolName(name: string): name is ToolName {
  return NAME_SET.has(name);
}

export function isTeammateToolName(name: string): name is TeammateToolName {
  return TEAMMATE_SET.has(name);
}

// Tools every Ask AI session can use, regardless of agent (or no agent).
// Spelled here, beside the names, so the teammate tool set
// (teammate-tools.ts teammateToolNames) reads the legacy set without
// importing the server registry; tools.ts re-exports both lists. Typed by
// the Ask AI names alone, so a teammate tool added to either list is a
// compile error rather than a tool Ask AI runs without asking.
export const CROSS_TOOL_NAMES: AskAiToolName[] = [
  "create_task", "search_tasks", "send_kudos", "search_employees",
  "search_meetings", "search_okrs", "search_sops",
  "create_meeting", "create_okr", "create_sop",
  // System-building tools: workspaces and invitations
  "create_workspace", "invite_person_with_role",
  // Lego primitives: Forms, DataTables, Docs
  "create_form", "list_forms",
  "create_data_table", "list_data_tables",
  "create_doc",
  // Read-only org awareness
  "list_my_kras", "list_my_kpi_status", "list_my_sops",
  "list_my_weekly_reviews", "get_team_alignment_rollup",
];

// Tools per agent product. When a chat session is scoped to an agent,
// the agent's productSlug determines which create-tools light up in
// addition to the cross-product ones. The CRM, ITSM, campaigns and helpdesk
// rows left with their tools (PPMS scope); an agent bound to one of those
// products gets the cross-product set only.
export const PRODUCT_TOOL_NAMES: Record<string, AskAiToolName[]> = {
  "workwrk-contracts": ["create_contract", "search_contracts", "update_contract"],
  "workwrk-dev": ["create_sprint"],
  // HR / Goals: KRAs and KPIs are org-design primitives, surfaced via the
  // People product's agent.
  "workwrk-people": ["create_kra", "create_kpi"],
  "workwrk-goals": ["create_okr"],
  "workwrk-sops": ["create_sop"],
  "workwrk-meetings": ["create_meeting"],
};

/**
 * The tools one Ask AI chat offers (tools.ts toolsForSession): the cross set,
 * the chat's product's own, and no Tables tools without Tables. Names only,
 * so an approval can check its tool is still offered without loading the
 * registry. A product slug is read as an own key only: "constructor" is no
 * product.
 */
export function askAiToolNames(opts: { agentProductSlug?: string | null; tablesOn?: boolean }): AskAiToolName[] {
  const available = new Set<AskAiToolName>(CROSS_TOOL_NAMES);
  const slug = opts.agentProductSlug;
  if (slug && Object.prototype.hasOwnProperty.call(PRODUCT_TOOL_NAMES, slug)) {
    for (const name of PRODUCT_TOOL_NAMES[slug]) available.add(name);
  }
  if (opts.tablesOn === false) {
    available.delete("create_data_table");
    available.delete("list_data_tables");
  }
  return [...available];
}
