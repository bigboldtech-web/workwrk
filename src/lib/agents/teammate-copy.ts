// Every word the AI teammates surfaces show (docs/plans/ai-teammates.md 5.6),
// spelled once here and imported by the page, the chat, the approval card,
// the dialog, the settings drawer and the server lines (EVENT rows, previews,
// limit sentences). One file, so one test (teammate-copy.test.ts) reads every
// string and holds the copy rule: no em dash, no en dash, no double hyphen.
//
// Constants are grouped by surface; a sentence with a name or a number in it
// is a builder, so the words around the value are spelled here too.
//
// Pure: no imports but types.

import type { TeammateHue } from "./hues";
import type { ToolName } from "./tool-names";

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

// ── Card titles and change lines (previews.ts) ───────────────────────
//
// A card's title is what the action does, in the imperative, from the input
// the server cleaned and resolved: 'Create task "Call Acme"', "Post in
// #general". A practice run prints it after "Would" (wouldDoLine).

/** The verb each tool's card title starts with. */
export const ACTION_VERB: Readonly<Partial<Record<ToolName, string>>> = {
  create_task: "Create task",
  update_task: "Change task",
  comment_on_task: "Comment on",
  post_in_talk: "Post in",
  update_doc: "Add to",
  remember: "Remember",
  forget: "Forget",
  create_routine: "Set up routine",
  create_doc: "Create doc",
  create_form: "Create form",
  create_data_table: "Create table",
  create_sop: "Draft SOP",
  create_sprint: "Plan sprint",
  create_contract: "Track contract",
  update_contract: "Change contract",
  create_workspace: "Create workspace",
  create_meeting: "Schedule meeting",
  create_okr: "Create goal",
  create_kra: "Create KRA",
  create_kpi: "Create KPI",
  send_kudos: "Send kudos to",
  invite_person_with_role: "Invite",
};

/** 'Create task "Call Acme"' */
export function quotedTitle(verb: string, subject: string): string {
  return `${verb} "${subject}"`;
}

/** "Post in #general", "Send kudos to Max Chen" */
export function placeTitle(verb: string, place: string): string {
  return `${verb} ${place}`;
}

/** 'Move "Call Acme" to Backlog' */
export function moveTitle(task: string, list: string): string {
  return `Move "${task}" to ${list}`;
}

/** 'Create task "Call Acme" for Max Chen' */
export function forPersonTitle(title: string, name: string): string {
  return `${title} for ${name}`;
}

/** Where a channel post goes: "#general". */
export function channelPlace(name: string): string {
  return `#${name}`;
}

/** Where a direct message goes: "your chat with Max Chen". */
export function dmPlace(name: string): string {
  return `your chat with ${name}`;
}

/** A group chat with no name. */
export const GROUP_FALLBACK = "a group chat";

/** "Don't ask again" for one conversation that is not a channel. */
export function approveAlwaysIn(place: string): string {
  return `Approve and don't ask again in ${place}`;
}

/** What a task change card lists, one line per field. */
export const CHANGE_LABELS = {
  status: "Status",
  dueDate: "Due date",
  priority: "Priority",
  owner: "Owner",
} as const;

export const NO_DUE_DATE = "No due date";
export const NO_PRIORITY = "No priority";

/** "Status: Done" */
export function changeLine(label: string, value: string): string {
  return `${label}: ${value}`;
}

/** "On Mon 12 Oct, 14:00, Kolkata time." */
export function meetingAtLine(when: string): string {
  return `On ${when}.`;
}

/** "With Max Chen and Lea Alpha.", "With A, B, C and 2 more." */
export function withPeopleLine(names: readonly string[], more = 0): string {
  const all = more > 0 ? [...names, `${more} more`] : [...names];
  if (all.length === 0) return "";
  if (all.length === 1) return `With ${all[0]}.`;
  return `With ${all.slice(0, -1).join(", ")} and ${all[all.length - 1]}.`;
}

/** Why a goal card asks: its level reaches past the person. */
export const GOAL_LEVEL_LINES = {
  COMPANY: "It's a Company goal.",
  DEPARTMENT: "It's a Department goal.",
} as const;

/** A KRA is seeded to every holder of its job title (POST /api/kras). */
export function kraHoldersLine(role: string): string {
  return `Everyone with the job title ${role} gets it.`;
}

/** A KPI measures one KRA (POST /api/kpis). */
export function kpiUnderLine(kra: string): string {
  return `It sits under the KRA ${kra}.`;
}

/** The label of the one field a card lets the person edit (tool-policy.ts EDITABLE_FIELD). */
export const EDIT_FIELD_LABELS = {
  title: "Title",
  message: "Message",
  comment: "Comment",
  text: "Text",
} as const;

/** The audit row's actorLabel (acting.ts actorLabelFor): "Chief of Staff for Priya Shah". */
export function agentForPerson(agent: string, person: string): string {
  return `${agent} for ${person}`;
}

// ── What a teammate tool answers when it cannot (teammate-tools.ts) ──
//
// The teammate reads these and tells the person; a tool row shows them on
// its second line. Plain sentences, in the person's terms.

export const TEAMMATE_TOOL_ERRORS = {
  teammateOnly: "Only an AI teammate can use this tool.",
  personCant: "The person this teammate works for can't do that in this workspace now.",
  taskNotFound: "I can't find that task.",
  cantChangeTask: "You can't change this task.",
  cantCommentTask: "You can't comment on this task.",
  cantMoveTask: "You can't move this task.",
  nothingToChange: "Say what to change: the status, the due date, the priority or the owner.",
  badDueDate: "A due date is a day written like 2026-10-12, or none.",
  listNotFound: "I can't find that List.",
  needList: "Say which List to move it to.",
  personalListTarget: "A task can't be moved onto a Personal list.",
  cantAddToList: "You can't add tasks to that List.",
  cantMoveOut: "You can't move tasks out of the List it's in.",
  docNotFound: "I can't find that doc.",
  cantEditDoc: "You can't change this doc.",
  docLocked: "This doc is locked. Ask the person who locked it to unlock it.",
  docArchived: "This doc is in Trash.",
  docFormat: "I can't add to this doc's format yet. Open it and paste the text.",
  docChanged: "The doc changed while I was adding to it. Try again.",
  talkOff: "Talk is off in this workspace.",
  conversationNotFound: "I can't find that conversation.",
  needPlace: "Say where to post: a channel, a group or a person's email.",
  needsApproval: "A post in Talk runs only from its approval.",
  emptyText: "There's nothing left to send once links and @ signs are taken out.",
  memoryEmpty: "Say what to remember: a short name and the fact.",
  taskTitle: "A task needs a title.",
  goalTitle: "A goal needs a title.",
  inviteEmail: "Say who to invite, by their email.",
  kudosMessage: "Say who the kudos is for, by their email, and write the message.",
  kudosSelf: "You can't give kudos to yourself.",
  notAllowed: "That didn't work. Check it in the app and try again.",
} as const;

export function statusesSentence(labels: readonly string[]): string {
  return `That isn't a status in this List. Its statuses are: ${labels.join(", ")}.`;
}

export function unknownPerson(email: string): string {
  return `There's nobody with the email ${email} in this workspace.`;
}

export function noListNamed(name: string): string {
  return `There's no List called ${name} that you can add tasks to.`;
}

export function severalLists(name: string): string {
  return `More than one List is called ${name}. Say which one by its id.`;
}

export function alreadyInList(list: string): string {
  return `That task is already in ${list}.`;
}

export function noConversationNamed(name: string): string {
  return `There's no channel or group called ${name} that you're in.`;
}

export function severalConversations(name: string): string {
  return `More than one conversation is called ${name}. Say which one by its id.`;
}

export function noDmWith(name: string): string {
  return `You don't have a direct message with ${name} yet. Start one in Talk first.`;
}

export function cantPostIn(place: string): string {
  return `You can't post in ${place}.`;
}

/** MEMORY_LIMITS reached (memory.ts): the person's memories, or a workspace teammate's shared ones. */
export function memoryFull(n: number, scope: "person" | "agent"): string {
  return scope === "person"
    ? `I already remember ${count(n, "thing", "things")} for you. Forget some first.`
    : `This teammate already remembers ${count(n, "thing", "things")} for everyone. Delete some first.`;
}

export function nothingRemembered(key: string): string {
  return `Nothing is remembered as "${key}".`;
}

// ── Running a call and deciding one (executor.ts, actions.ts) ────────

export const ACTION_ERRORS = {
  /** A tool outside the teammate's tool set this turn, or no tool at all. */
  toolOff: "This teammate can't use that tool.",
  /** MAX_TOOL_CALLS_PER_TURN reached. */
  tooManyCalls: "That's the most actions one turn can take. Send another message to carry on.",
  /** A request left RUNNING past the sweep: it may or may not have happened, and it never runs again. */
  unconfirmed: "Couldn't confirm it finished.",
  /** The person deciding is not someone a teammate may act for now (resolveActingPerson refused). */
  personCannot: "A teammate can't act for you in this workspace now.",
} as const;

/** MAX_PROPOSALS_PER_TURN or MAX_PENDING_PER_PERSON reached. */
export function tooManyWaiting(first: string): string {
  return `Too many things are waiting for ${first}'s approval.`;
}

/** A card cancelled because its teammate can no longer use the tool. */
export function cancelledToolOffLine(name: string): string {
  return `Cancelled: ${name} can no longer use this tool.`;
}

/** Up to `shown` titles, then how many more: "A, B and 2 more" (one line for several requests). */
export function titleList(titles: readonly string[], shown = 3): string {
  const head = titles.slice(0, shown);
  const more = titles.length - head.length;
  const all = more > 0 ? [...head, `${more} more`] : head;
  if (all.length <= 1) return all[0] ?? "";
  return `${all.slice(0, -1).join(", ")} and ${all[all.length - 1]}`;
}

/** The audit log's sentence for what a teammate did: 'Chief of Staff (for Priya Shah): Created task "Call Acme"'. */
export function agentAuditLine(agent: string, person: string, what: string): string {
  return `${agent} (for ${person}): ${what}`;
}

// ── A turn that ended early (engine.ts) ──────────────────────────────

/** Why a teammate's turn ended before its answer did (the stream's done event and the run's error). */
export const TURN_ERRORS = {
  /** The answer reached its length limit: what it said is kept, and no tool from it ran. */
  cutShort: "The answer was cut short.",
  /** The model declined to answer: nothing from that answer ran or was kept. */
  declined: "The AI declined to answer that. Try asking another way.",
  /** The AI service failed, or nothing came back. */
  noAnswer: "The AI service didn't answer. Try again.",
  /** The turn ran, but its answer could not be written to the chat. */
  notSaved: "The answer couldn't be saved. Check what it did before asking again.",
} as const;

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

// ── The teammate routes' refusals (src/app/api/agents/...) ───────────
//
// Each route answers { error: <sentence>, code }. A teammate that does not
// exist and another person's private one read the same, so the words never
// say which.

export const TEAMMATE_ROUTE_ERRORS = {
  teammateNotFound: "That teammate can't be found.",
  invalid: "Check the details and try again.",
  needsAdmin: "Only an Owner or Admin can make a teammate for the whole workspace.",
  agentAccount: "An agent account can't have AI teammates.",
  /** A continue with no decision the teammate has not heard yet. */
  nothingToContinue: "There's nothing new to continue from.",
  /** The person's message could not be written, so no turn ran. */
  messageNotSaved: "Your message couldn't be saved. Try again.",
  memoryNotFound: "That memory can't be found.",
  /** A memory for everyone, asked of a teammate that is one person's own. */
  privateMemoryScope: "A teammate that's just yours keeps only your own memories.",
  routineNotFound: "That routine can't be found.",
  actionNotFound: "That request can't be found.",
} as const;

/** The approval routes' per-minute limit (POST /api/agents/actions/decide). */
export function tooManyDecisions(retryAfter: number): string {
  return `Too many decisions at once. Try again in ${retryAfter} seconds.`;
}

// ── Tool picker (labels and the one-line notes) ──────────────────────

export interface ToolPickerCopy {
  label: string;
  description?: string;
}

/**
 * Every tool a teammate may be given, by name: the 28 Ask AI tools and the 10
 * teammate tools (tool-names.ts). Typed by ToolName, so a tool with no label
 * is a compile error; teammate-copy.test.ts holds it to every name too.
 */
export const TOOL_PICKER_COPY: Readonly<Record<ToolName, ToolPickerCopy>> = {
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
