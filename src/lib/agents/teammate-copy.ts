// Every word the AI teammates surfaces show (docs/plans/ai-teammates.md 5.6),
// spelled once here and imported by the page, the chat, the approval card,
// the dialog, the settings drawer and the server lines (EVENT rows, previews,
// limit sentences). One file, so one test (teammate-copy.test.ts) reads every
// string and holds the copy rule: no em dash, no en dash, no double hyphen.
//
// Constants are grouped by surface; a sentence with a name or a number in it
// is a builder, so the words around the value are spelled here too.
//
// Pure: no imports but a type.

import type { TeammateHue } from "./hues";

function count(n: number, one: string, many: string): string {
  return `${n} ${n === 1 ? one : many}`;
}

/** "Post in #general" as "post in #general"; an acronym ("SOP draft") keeps its case. */
function lowerFirst(s: string): string {
  return /^[A-Z](?![A-Z])/.test(s) ? `${s[0].toLowerCase()}${s.slice(1)}` : s;
}

// ── Page and list ────────────────────────────────────────────────────

export const TEAMMATES_PAGE = {
  title: "AI teammates",
  tabChats: "Chats",
  tabWaiting: "Waiting for you",
  tabWorkspace: "Workspace agents",
  tabRuns: "Run history",
  search: "Search teammates",
  newTeammate: "New teammate",
} as const;

export const TEAMMATE_LIST = {
  emptyTitle: "No teammates yet",
  emptyHint: "A teammate is an AI helper with one job. It works as you, sees only what you can, and by default asks before anything other people will see.",
  emptyLink: "Start from a template",
  searchEmpty: "No teammates match",
  clearSearch: "Clear search",
  waitingEmpty: "Nothing is waiting for you",
  loadError: "Couldn't load your teammates",
  tryAgain: "Try again",
  showRemoved: "Show removed",
} as const;

/** The chips on a row and in the chat header. */
export const TEAMMATE_CHIPS = {
  waiting: "Waiting",
  paused: "Paused",
  removed: "Removed",
  private: "Just you",
  workspace: "Workspace",
} as const;

// ── Chat ─────────────────────────────────────────────────────────────

export const TEAMMATE_CHAT = {
  pick: "Pick a teammate to chat with",
  practice: "Practice run",
  practiceTooltip: "Shows what it would do. Nothing changes.",
  practiceOn: "Practice run is on. Nothing will change.",
  composerHint: "Works as you. Sees only what you can see.",
  send: "Send",
  working: "Working",
  practiceFooter: "Practice run · nothing was changed",
  loadError: "Couldn't load this chat.",
  tryAgain: "Try again",
  back: "Back",
  settings: "Settings",
  copyLink: "Copy link",
  turnOn: "Turn on",
  pause: "Pause",
  remove: "Remove",
  addBack: "Add back",
  askAdminToTurnOn: "Ask an Owner or Admin to turn it on.",
  aiOff: "AI is turned off for this workspace.",
  // Ask AI's two not-set-up sentences, naming AI rather than Ask AI: the
  // same key powers both, and this page is not Ask AI.
  notSetUp: "AI isn't set up for this workspace yet.",
  notSetUpAdmin: "It needs an AI key before it can answer.",
  notSetUpMember: "Ask a workspace admin to set it up.",
  contactSupport: "Contact support",
  // Ask AI's send failures (src/components/ai/ask-ai-thread.tsx ERROR_TEXT).
  notSent: "Your message wasn't sent. Check your connection and try again.",
  stopped: "The answer stopped.",
  /** The links on an EVENT line. */
  seeMemory: "See memory",
  routineSettings: "Settings",
  /** Ask AI's agent_off link. */
  seeAiTeammates: "See AI teammates",
} as const;

export function chatWith(name: string): string {
  return `Chat with ${name}`;
}

export function worksAsYou(name: string): string {
  return `${name} works as you and can only see what you can.`;
}

export function composerPlaceholder(name: string): string {
  return `Message ${name}…`;
}

/** The composer of a paused teammate. */
export function pausedComposer(name: string): string {
  return `${name} is paused.`;
}

/** The composer of a removed teammate. */
export function removedComposer(name: string): string {
  return `${name} was removed. Its chat is kept.`;
}

/** A tool row that asked first. */
export function waitingForApprovalLine(title: string): string {
  return `Waiting for your approval: ${title}`;
}

/** A tool row in a practice run. */
export function wouldDoLine(title: string): string {
  return `Would ${lowerFirst(title.trim())}`;
}

export function reportHeader(routine: string, time: string): string {
  return `${routine} · ${time}`;
}

export function andMore(n: number): string {
  return `And ${n} more`;
}

/** A list row's last line when the person spoke last. */
export function lastLineYou(text: string): string {
  return `You: ${text}`;
}

/** A list row's last line when a routine reported last. */
export function lastLineReport(routine: string, text: string): string {
  return `${routine}: ${text}`;
}

/** A report row whose routine name was not saved with it. */
export const ROUTINE_FALLBACK_NAME = "Routine";

// ── The centred lines (EVENT rows; the content IS this sentence) ─────

export function memoryUpdatedLine(value: string): string {
  return `Memory updated: ${value}`;
}

export function forgotLine(key: string): string {
  return `Forgot: ${key}`;
}

export function routineCreatedLine(name: string, when: string): string {
  return `Created routine: ${name} · ${when}`;
}

export function routinePausedLine(name: string, reason: string): string {
  return reason ? `Routine paused: ${name}. ${reason}` : `Routine paused: ${name}.`;
}

export function routineSkippedLine(name: string, reason: string): string {
  return reason ? `Routine skipped: ${name}. ${reason}` : `Routine skipped: ${name}.`;
}

export function youApprovedLine(title: string, opts: { always?: boolean } = {}): string {
  return opts.always ? `You approved: ${title}. It won't ask again for this.` : `You approved: ${title}`;
}

export function youSaidNoLine(title: string): string {
  return `You said no: ${title}`;
}

export function expiredWithoutAnswerLine(title: string): string {
  return `Expired without an answer: ${title}`;
}

export function didntWorkLine(title: string, error: string): string {
  return error ? `Didn't work: ${title}. ${error}` : `Didn't work: ${title}.`;
}

// ── Approval card ────────────────────────────────────────────────────

export const APPROVAL_CARD = {
  waitingForYou: "Waiting for you",
  approve: "Approve",
  edit: "Edit",
  deny: "Deny",
  selectAll: "Select all",
  approveAlways: "Approve and don't ask again",
  approveWithChanges: "Approve with changes",
  cancel: "Cancel",
  approving: "Approving…",
  showAll: "Show all",
  open: "Open",
  approveFailed: "Couldn't approve. Try again.",
  denyFailed: "Couldn't deny. Try again.",
  /** A stored action with no title (it always has one; this is the floor). */
  untitled: "An action",
} as const;

export function thingsWaiting(n: number): string {
  return n === 1 ? "1 thing is waiting for your approval" : `${n} things are waiting for your approval`;
}

export function approveCount(k: number): string {
  return `Approve ${k}`;
}

export function denyCount(k: number): string {
  return `Deny ${k}`;
}

/** "Approve and don't ask again in #general": the one Talk conversation the choice covers. */
export function approveAlwaysInChannel(name: string): string {
  return `Approve and don't ask again in #${name}`;
}

export function waitsUntil(date: string): string {
  return `Waits until ${date}`;
}

export function approvedAt(time: string): string {
  return `Approved · ${time}`;
}

export function deniedAt(time: string): string {
  return `Denied · ${time}`;
}

export function expiredAt(date: string, name: string): string {
  return `Expired · ${date}. Ask ${name} again if you still want this.`;
}

/** A decided card whose tool failed. */
export function cardFailedLine(error: string): string {
  return `Didn't work: ${error}`;
}

/** A card stuck RUNNING past the sweep: it may or may not have happened. */
export function unconfirmedLine(target: string): string {
  return `Couldn't confirm it finished. Check ${target} before asking again.`;
}

export function cancelledRemovedLine(name: string): string {
  return `Cancelled: ${name} was removed.`;
}

// ── Preview lines (the facts on a card, built by previews.ts) ────────

export const PREVIEW_LINES = {
  anyoneCanOpenChannel: "Anyone in the workspace can open this channel.",
  notifiedBySettings: "People get notified based on their own settings.",
  commentAudience: "The task's assignees and watchers are told.",
  statusAudience: "The task's owner and watchers are told.",
  automations: "It can start automations set up on this List.",
  subtasksMove: "Its subtasks move with it.",
  docAudience: "Everyone who can open the doc sees it.",
  docUndo: "Earlier versions are kept in the doc's history.",
  kudosAudience: "Everyone in the workspace can see kudos.",
  inviteSent: "The invitation email is sent at once.",
  invitePending: "It shows under Pending invites in Members.",
} as const;

export function peopleCanRead(n: number): string {
  return n === 1 ? "1 person can read it." : `${n} people can read it.`;
}

export function ownerTold(name: string): string {
  return `${name} is told it's theirs now.`;
}

export function statusBecomes(status: string): string {
  return `Its status becomes ${status} there.`;
}

export function personTold(name: string): string {
  return `${name} is told.`;
}

export function personalListOf(name: string): string {
  return `It goes on ${name}'s Personal list.`;
}

// ── New teammate dialog ──────────────────────────────────────────────

export const NEW_TEAMMATE_DIALOG = {
  title: "New teammate",
  intro: "Start from a template or from scratch. You can change everything later.",
  scratch: "Start from scratch",
  scratchHint: "You write the job and the instructions.",
  name: "Name",
  namePlaceholder: "For example, Weekly reporter",
  colour: "Colour",
  job: "One job",
  jobPlaceholder: "What it does, in one line",
  instructions: "Instructions",
  instructionsHelper: "Tell it how to do the job. It reads this before every chat.",
  tools: "Tools",
  toolsHelper: "What it may use. Things other people will see ask you first unless you choose Don't ask.",
  groupLookUp: "Look things up",
  groupOwnWork: "Make and change your own work",
  groupOthersSee: "Things other people will see",
  groupAlwaysAsks: "Always asks first",
  askMeFirst: "Ask me first",
  dontAsk: "Don't ask",
  alwaysAsksFirst: "Always asks first",
  talkNote: "You can let it post without asking in one conversation, from an approval card.",
  whoCanUse: "Who can use it",
  justMe: "Just me",
  everyone: "Everyone in the workspace",
  everyoneHelper: "Everyone gets their own chat with it. Nobody reads anyone else's chat.",
  back: "Back",
  cancel: "Cancel",
  create: "Create teammate",
  createFailed: "Couldn't create the teammate. Try again.",
  talkOff: "Talk is off in this workspace, so it can't read or post in Talk.",
  tablesOff: "Tables is off in this workspace.",
} as const;

/** The colour swatches' accessible names. */
export const HUE_LABEL: Record<TeammateHue, string> = {
  sky: "Sky",
  teal: "Teal",
  moss: "Moss",
  sand: "Sand",
  clay: "Clay",
  rose: "Rose",
  slate: "Slate",
  stone: "Stone",
};

const PLAN_NAME: Record<string, string> = { STARTER: "Starter", GROWTH: "Growth", SCALE: "Scale", ENTERPRISE: "Enterprise" };

/**
 * The plan's teammate limit (TEAMMATE_LIMITS) is reached. `personal` counts
 * the person's own teammates; `workspace` counts the ones the workspace
 * shares, so an Admin with none of their own is not told "You have 3".
 */
export function teammateLimitMessage(n: number, plan: string, scope: "personal" | "workspace" = "personal"): string {
  const what = scope === "workspace" ? `This workspace has ${count(n, "workspace teammate", "workspace teammates")}` : `You have ${count(n, "teammate", "teammates")}`;
  return `${what}, the most the ${PLAN_NAME[plan] ?? plan} plan allows. An Owner or Admin can change the plan in Settings, Plan & billing.`;
}

// ── Settings drawer ──────────────────────────────────────────────────

export const TEAMMATE_SETTINGS = {
  tabInstructions: "Instructions",
  tabTools: "Tools and approvals",
  tabMemory: "Memory",
  tabRoutines: "Routines",
  tabActivity: "Activity",
  on: "On",
  monthlyLimit: "Monthly limit",
  monthlyLimitHelper: "Most AI questions it may use in a month, on top of the plan. Leave empty for no limit of its own.",
  save: "Save",
  cancel: "Cancel",
  close: "Close",
  removeTeammate: "Remove teammate",
  removeConfirmBody: "It stops working and its routines pause. Its chat and activity are kept.",
  /** The confirm button, and a "Don't ask" conversation's Remove on the tools tab. */
  remove: "Remove",
  managedByAdmins: "An Owner or Admin manages this teammate.",
  toolsFooter: "Reading never asks. Anything other people will see asks first unless you choose Don't ask. Inviting people always asks.",
  askEveryoneFirst: "Ask everyone first",
} as const;

export function settingsCrumb(name: string): string {
  return `AI teammates › ${name}`;
}

export function pauseTeammate(name: string): string {
  return `Pause ${name}`;
}

export function turnOnTeammate(name: string): string {
  return `Turn on ${name}`;
}

export function removeTeammateTitle(name: string): string {
  return `Remove ${name}?`;
}

export const MEMORY_COPY = {
  add: "Add memory",
  onlyYou: "Only you",
  everyone: "Everyone",
  edit: "Edit",
  delete: "Delete",
  empty: "Nothing remembered yet.",
  emptyHint: "Ask it to remember something in the chat, or add it here.",
  deleteTitle: "Delete this memory?",
  deleteBody: "It stops using it from the next message.",
} as const;

export const ROUTINE_COPY = {
  newRoutine: "New routine",
  name: "Name",
  whatToDo: "What to do each time",
  when: "When",
  whenHelper: "Each run uses one AI question.",
  runNow: "Run now",
  practiceRun: "Practice run",
  pause: "Pause",
  resume: "Resume",
  edit: "Edit",
  delete: "Delete",
  empty: "No routines yet.",
  emptyHint: "Ask in the chat, for example: Every Monday at 9:00, send me a status report.",
  deleteTitle: "Delete this routine?",
  deleteBody: "It stops running. Its past reports stay in the chat.",
} as const;

export function nextRunLine(time: string): string {
  return `Next run ${time}`;
}

export function pausedBecause(reason: string): string {
  return `Paused: ${reason}`;
}

export const ACTIVITY_COPY = {
  recentRuns: "Recent runs",
  approvals: "Approvals",
  nothingYet: "Nothing yet.",
} as const;

// ── Months (UTC: a teammate's monthly limit is a UTC calendar month) ──

const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];

export function monthName(at: Date): string {
  return MONTHS[at.getUTCMonth()];
}

/** The drawer's usage line for the month of `at`. */
export function usageLine(used: number, cap: number | null, at: Date): string {
  const month = monthName(at);
  return cap === null
    ? `Used ${count(used, "AI question", "AI questions")} in ${month}.`
    : `Used ${used} of ${count(cap, "AI question", "AI questions")} in ${month}.`;
}

/** A teammate at its own monthly limit (AgentRun questions this UTC month). */
export function agentCapMessage(name: string, cap: number, now: Date): string {
  const month = MONTHS[now.getUTCMonth()];
  const next = MONTHS[(now.getUTCMonth() + 1) % 12];
  return `${name} has used its ${count(cap, "AI question", "AI questions")} for ${month}. It can answer again on ${next} 1 (UTC), or whoever manages it can raise the limit in its settings.`;
}

// ── Errors ───────────────────────────────────────────────────────────

export const TEAMMATE_ERRORS = {
  useTeammateChat: "This chat is with an AI teammate. Open it from AI teammates.",
  routineInRoutine: "A routine can't set up another routine.",
  routineTooOften: "Routines run at most once an hour.",
  /** A schedule routineScheduleProblem calls "invalid". */
  routineInvalid: "That isn't a schedule a routine can run on. Pick a day and a time, or every few hours.",
} as const;

export function pausedNotSent(name: string): string {
  return `${name} is paused, so your message wasn't sent.`;
}

/** ROUTINE_LIMITS reached: per teammate, or across every teammate. */
export function routineLimitMessage(n: number, scope: "teammate" | "person"): string {
  return scope === "teammate"
    ? `You have ${count(n, "routine", "routines")} with this teammate, the most one person can have.`
    : `You have ${count(n, "routine", "routines")}, the most one person can have.`;
}

// ── Tool picker (labels and the one-line notes) ──────────────────────

export interface ToolPickerCopy {
  label: string;
  description?: string;
}

/**
 * Every tool a teammate may be given, by name: the 28 Ask AI tools and the 10
 * teammate tools (tool-names.ts gains the ten in step 3). Typed by string
 * until then; teammate-copy.test.ts holds it to every Ask AI tool name.
 */
export const TOOL_PICKER_COPY: Readonly<Record<string, ToolPickerCopy>> = {
  search_tasks: { label: "Find tasks" },
  search_employees: { label: "Find people" },
  search_meetings: { label: "Find meetings" },
  search_okrs: { label: "Find goals" },
  search_sops: { label: "Find SOPs" },
  search_contracts: { label: "Find contracts" },
  list_forms: { label: "Find forms" },
  list_data_tables: { label: "Find tables" },
  list_my_kras: { label: "Read your KRAs" },
  list_my_kpi_status: { label: "Read your KPIs" },
  list_my_sops: { label: "Read your assigned SOPs" },
  list_my_weekly_reviews: { label: "Read your weekly reviews" },
  get_team_alignment_rollup: { label: "Read your team's progress" },
  list_my_inbox: { label: "Read your Inbox" },
  read_talk: { label: "Read your Talk messages", description: "Only conversations you are in. It never marks anything read." },
  create_task: { label: "Create tasks", description: "Asks first when it is for someone else." },
  update_task: { label: "Change tasks", description: "Status, due date, priority and owner." },
  move_task: { label: "Move tasks between Lists" },
  comment_on_task: { label: "Comment on tasks" },
  create_doc: { label: "Create docs" },
  update_doc: { label: "Add to docs", description: "Adds a section at the end. Earlier versions are kept." },
  create_form: { label: "Create forms" },
  create_data_table: { label: "Create tables" },
  create_sop: { label: "Draft SOPs" },
  create_meeting: { label: "Schedule meetings" },
  create_okr: { label: "Create goals" },
  create_kra: { label: "Create KRAs" },
  create_kpi: { label: "Create KPIs" },
  create_contract: { label: "Track contracts" },
  update_contract: { label: "Change contracts" },
  create_sprint: { label: "Plan sprints" },
  create_workspace: { label: "Create workspaces" },
  send_kudos: { label: "Send kudos" },
  post_in_talk: { label: "Post in Talk" },
  invite_person_with_role: { label: "Invite people" },
  remember: { label: "Remember things" },
  forget: { label: "Forget things" },
  create_routine: { label: "Set up routines", description: "Runs on a schedule you choose. Each run uses one AI question." },
};
