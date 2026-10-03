// What a tool call reads as in the Ask AI thread: a past-tense sentence with
// the real subject, and the concept it touched (which picks the one icon that
// concept carries app-wide). Pure, so the page, the panel and the agent run
// detail all print the same words.
//
// Typed against the 28 names in tool-names.ts: a tool with no sentence is a
// compile error, so no call ever prints its raw name again.

import type { ToolName } from "./tool-names";
import { objectHref } from "../nav/object-href";

export type ToolConcept =
  | "task"
  | "doc"
  | "form"
  | "table"
  | "sop"
  | "goal"
  | "kra"
  | "kpi"
  | "meeting"
  | "contract"
  | "sprint"
  | "person"
  | "kudos"
  | "workspace"
  | "review"
  | "team"
  | "search";

export interface ToolVerb {
  concept: ToolConcept;
  /** Past tense, done: "Created task". The subject is appended when known. */
  done: string;
  /** What a failure reads as: "Couldn't create the task". */
  failed: string;
}

export const TOOL_VERBS: Record<ToolName, ToolVerb> = {
  create_contract: { concept: "contract", done: "Created contract", failed: "Couldn't create the contract" },
  create_data_table: { concept: "table", done: "Created table", failed: "Couldn't create the table" },
  create_doc: { concept: "doc", done: "Created doc", failed: "Couldn't create the doc" },
  create_form: { concept: "form", done: "Created form", failed: "Couldn't create the form" },
  create_kpi: { concept: "kpi", done: "Created KPI", failed: "Couldn't create the KPI" },
  create_kra: { concept: "kra", done: "Created KRA", failed: "Couldn't create the KRA" },
  create_meeting: { concept: "meeting", done: "Scheduled meeting", failed: "Couldn't schedule the meeting" },
  create_okr: { concept: "goal", done: "Created goal", failed: "Couldn't create the goal" },
  create_sop: { concept: "sop", done: "Created SOP", failed: "Couldn't create the SOP" },
  create_sprint: { concept: "sprint", done: "Created sprint", failed: "Couldn't create the sprint" },
  create_task: { concept: "task", done: "Created task", failed: "Couldn't create the task" },
  create_workspace: { concept: "workspace", done: "Created workspace", failed: "Couldn't create the workspace" },
  get_team_alignment_rollup: { concept: "team", done: "Looked at your team's progress", failed: "Couldn't load your team's progress" },
  invite_person_with_role: { concept: "person", done: "Invited", failed: "Couldn't send the invitation" },
  list_data_tables: { concept: "table", done: "Looked up tables", failed: "Couldn't look up tables" },
  list_forms: { concept: "form", done: "Looked up forms", failed: "Couldn't look up forms" },
  list_my_kpi_status: { concept: "kpi", done: "Checked your KPIs", failed: "Couldn't check your KPIs" },
  list_my_kras: { concept: "kra", done: "Looked up your KRAs", failed: "Couldn't look up your KRAs" },
  list_my_sops: { concept: "sop", done: "Looked up your SOPs", failed: "Couldn't look up your SOPs" },
  list_my_weekly_reviews: { concept: "review", done: "Looked up your weekly reviews", failed: "Couldn't look up your weekly reviews" },
  search_contracts: { concept: "search", done: "Searched contracts", failed: "Couldn't search contracts" },
  search_employees: { concept: "search", done: "Searched people", failed: "Couldn't search people" },
  search_meetings: { concept: "search", done: "Searched meetings", failed: "Couldn't search meetings" },
  search_okrs: { concept: "search", done: "Searched goals", failed: "Couldn't search goals" },
  search_sops: { concept: "search", done: "Searched SOPs", failed: "Couldn't search SOPs" },
  search_tasks: { concept: "search", done: "Searched tasks", failed: "Couldn't search tasks" },
  send_kudos: { concept: "kudos", done: "Sent kudos", failed: "Couldn't send the kudos" },
  update_contract: { concept: "contract", done: "Updated contract", failed: "Couldn't update the contract" },
};

const SUBJECT_KEYS = ["title", "name", "query", "titleContains", "nameContains", "email", "receiverEmail"] as const;

/** The subject a sentence names, from the call's own input. */
export function toolSubject(input: Record<string, unknown> | null | undefined): string | null {
  if (!input) return null;
  for (const key of SUBJECT_KEYS) {
    const v = input[key];
    if (typeof v === "string" && v.trim()) return v.trim().slice(0, 80);
  }
  return null;
}

/**
 * One sentence for a call. A tool the registry no longer has (an old chat
 * that ran a retired verb) reads as a plain description instead of its code
 * name, so history stays readable after the trim.
 */
export function toolSentence(name: string, input?: Record<string, unknown> | null, failed = false): {
  concept: ToolConcept;
  text: string;
} {
  const verb = (TOOL_VERBS as Record<string, ToolVerb | undefined>)[name];
  if (!verb) {
    return { concept: "search", text: failed ? "An action didn't finish" : "Used an older action" };
  }
  if (failed) return { concept: verb.concept, text: verb.failed };
  const subject = toolSubject(input);
  return { concept: verb.concept, text: subject ? `${verb.done} "${subject}"` : verb.done };
}

/**
 * What a finished call reports (spec-ai-automation section 2, "Tool calls"):
 * a search reads as a count ("Searched 42 tasks"), a create links to the
 * object it made, a failure carries the server's own message for the second
 * line. Read from the persisted call log, so it is only known once the turn
 * is saved; while streaming a row is the plain sentence.
 */
export interface ToolOutcome {
  failed: boolean;
  /** The server's message on a failed call. */
  message: string | null;
  /** Where the created object opens, when the tool returned its id. */
  href: string | null;
  /** How many rows a search or list call found. */
  count: number | null;
  /** A search cut short at its cap: how many of the newest candidates it read (null when it read them all). */
  searched: number | null;
}

const COUNT_NOUN: Partial<Record<ToolName, [string, string]>> = {
  search_tasks: ["task", "tasks"],
  search_employees: ["person", "people"],
  search_meetings: ["meeting", "meetings"],
  search_okrs: ["goal", "goals"],
  search_sops: ["SOP", "SOPs"],
  search_contracts: ["contract", "contracts"],
  list_forms: ["form", "forms"],
  list_data_tables: ["table", "tables"],
  list_my_kras: ["KRA", "KRAs"],
  list_my_sops: ["SOP", "SOPs"],
  list_my_weekly_reviews: ["weekly review", "weekly reviews"],
};

// The tools whose result names an object with an address of its own. Tasks
// open at /item/[id]; docs, tables, forms and SOPs go through objectHref
// (src/lib/nav/object-href.ts), opened from the AI hub.
const CREATED: Partial<Record<ToolName, { key: string; href: (id: string) => string }>> = {
  create_task: { key: "task", href: (id) => `/item/${encodeURIComponent(id)}` },
  create_doc: { key: "doc", href: (id) => objectHref("doc", id, "ai") },
  create_data_table: { key: "table", href: (id) => objectHref("table", id, "ai") },
  create_form: { key: "form", href: (id) => objectHref("form", id, "ai") },
  create_sop: { key: "sop", href: (id) => objectHref("sop", id, "ai") },
};

function asRecord(v: unknown): Record<string, unknown> | null {
  return v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : null;
}

export function toolOutcome(name: string, result: unknown, errorText?: string | null): ToolOutcome {
  const r = asRecord(result);
  const resultErr = typeof r?.error === "string" && r.error.trim() ? r.error.trim() : null;
  const message = (errorText && errorText.trim()) || resultErr;
  if (message) return { failed: true, message: message.slice(0, 240), href: null, count: null, searched: null };
  let count: number | null = null;
  if (r && (name as ToolName) in COUNT_NOUN) {
    if (typeof r.count === "number") count = r.count;
    else {
      const arr = Object.values(r).find(Array.isArray);
      if (Array.isArray(arr)) count = arr.length;
    }
  }
  const created = CREATED[name as ToolName];
  const obj = created && r ? asRecord(r[created.key]) : null;
  const id = obj && typeof obj.id === "string" ? obj.id : null;
  const searched = count !== null && r?.partial === true && typeof r.searched === "number" ? r.searched : null;
  return { failed: false, message: null, href: created && id ? created.href(id) : null, count, searched };
}

/** The sentence once the outcome is known: a counted search reads "Searched 42 tasks". */
export function toolOutcomeSentence(name: string, input: Record<string, unknown> | null | undefined, outcome: ToolOutcome): { concept: ToolConcept; text: string } {
  const base = toolSentence(name, input, outcome.failed);
  const noun = COUNT_NOUN[name as ToolName];
  if (outcome.failed || outcome.count === null || !noun) return base;
  const verb = (TOOL_VERBS as Record<string, ToolVerb | undefined>)[name];
  const lead = verb ? verb.done.split(" ")[0] : "Found";
  const words = verb ? verb.done.split(" ") : [];
  // "Looked up your SOPs" keeps its "your": "Looked up 3 of your SOPs".
  if (words.includes("your")) return { concept: base.concept, text: `${words.slice(0, words.indexOf("your")).join(" ")} ${outcome.count} of your ${outcome.count === 1 ? noun[0] : noun[1]}` };
  const phrase = words.length > 2 && words[1] === "up" ? `${lead} up` : lead;
  // A search cut short says so, so a capped "0" never reads as "none":
  // "Searched the 1,000 most recently updated tasks, found 0" (the tools
  // read in order of the last change, not of creation).
  if (outcome.searched) return { concept: base.concept, text: `${phrase} the ${outcome.searched.toLocaleString("en-US")} most recently updated ${noun[1]}, found ${outcome.count}` };
  return { concept: base.concept, text: `${phrase} ${outcome.count} ${outcome.count === 1 ? noun[0] : noun[1]}` };
}
