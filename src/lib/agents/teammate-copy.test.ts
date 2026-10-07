import { describe, expect, it } from "vitest";
import * as copy from "./teammate-copy";
import { TEAMMATE_HUES } from "./hues";
import { ROUTINE_REASON_TEXT } from "./routines";
import { PPMS_TOOL_NAMES, TEAMMATE_TOOL_NAMES } from "./tool-names";

// The copy rule (docs/plans/ai-teammates.md 5.6): no em dash (U+2014), no en
// dash (U+2013), no double hyphen in anything a person reads. The two dashes
// are written by code point so this file holds neither.
const BANNED = new RegExp(`[${String.fromCharCode(0x2014, 0x2013)}]|--`);

const AT = new Date("2026-10-15T12:00:00Z");

// Every builder, called as the product calls it, with the sentence the spec
// documents. A new builder fails "every builder is listed" until it is here.
const BUILDERS: Record<string, [unknown[], string]> = {
  chatWith: [["Priya"], "Chat with Priya"],
  worksAsYou: [["Priya"], "Priya works as you and can only see what you can."],
  composerPlaceholder: [["Priya"], "Message Priya…"],
  pausedComposer: [["Priya"], "Priya is paused."],
  removedComposer: [["Priya"], "Priya was removed. Its chat is kept."],
  // The chat header's menu and its toasts (the Agents page's own words).
  actionsFor: [["Priya"], "Actions for Priya"],
  turnedOnToast: [["Priya"], "Priya is on"],
  pausedToast: [["Priya"], "Priya is paused"],
  removedToast: [["Priya"], "Priya removed"],
  backToast: [["Priya"], "Priya is back"],
  waitingForApprovalLine: [["Post in #general"], "Waiting for your approval: Post in #general"],
  wouldDoLine: [["Post in #proof"], "Would post in #proof"],
  reportHeader: [["Daily brief", "9:00"], "Daily brief · 9:00"],
  andMore: [[3], "And 3 more"],
  lastLineYou: [["What is due?"], "You: What is due?"],
  lastLineReport: [["Daily brief", "Three things today"], "Daily brief: Three things today"],
  memoryUpdatedLine: [["I prefer reports on Mondays"], "Memory updated: I prefer reports on Mondays"],
  forgotLine: [["report day"], "Forgot: report day"],
  routineCreatedLine: [["Daily brief", "Weekdays at 9:00"], "Created routine: Daily brief · Weekdays at 9:00"],
  routinePausedLine: [["Daily brief", "This teammate was removed."], "Routine paused: Daily brief. This teammate was removed."],
  routineSkippedLine: [["Daily brief", "This teammate is paused."], "Routine skipped: Daily brief. This teammate is paused."],
  youApprovedLine: [["Post in #general", { always: true }], "You approved: Post in #general. It won't ask again for this."],
  youSaidNoLine: [["Comment on Call Acme"], "You said no: Comment on Call Acme"],
  expiredWithoutAnswerLine: [["Post in #general"], "Expired without an answer: Post in #general"],
  didntWorkLine: [["Post in #general", "The channel is archived."], "Didn't work: Post in #general. The channel is archived."],
  // The Inbox rows the routine runner writes (3.14).
  approvalNoticeTitle: [["Status Reporter"], "Status Reporter is waiting for your approval"],
  approvalNoticeMessage: [[3, "Weekly status", "Post in #team"], "3 things from Weekly status"],
  routinePausedNoticeTitle: [["Status Reporter"], "Status Reporter paused a routine"],
  routinePausedNoticeMessage: [["Weekly status", "This teammate was removed."], "Weekly status: This teammate was removed."],
  thingsWaiting: [[12], "12 things are waiting for your approval"],
  approveCount: [[12], "Approve 12"],
  denyCount: [[2], "Deny 2"],
  approveAlwaysInChannel: [["general"], "Approve and don't ask again in #general"],
  waitsUntil: [["Oct 13"], "Waits until Oct 13"],
  approvedAt: [["10:42"], "Approved · 10:42"],
  deniedAt: [["10:42"], "Denied · 10:42"],
  expiredAt: [["Oct 13", "Priya"], "Expired · Oct 13. Ask Priya again if you still want this."],
  cardFailedLine: [["The channel is archived."], "Didn't work: The channel is archived."],
  unconfirmedLine: [["#general"], "Couldn't confirm it finished. Check #general before asking again."],
  cancelledRemovedLine: [["Priya"], "Cancelled: Priya was removed."],
  peopleCanRead: [[34], "34 people can read it."],
  ownerTold: [["Max"], "Max is told it's theirs now."],
  statusBecomes: [["To Do"], "Its status becomes To Do there."],
  personTold: [["Max"], "Max is told."],
  personalListOf: [["Max"], "It goes on Max's Personal list."],
  teammateLimitMessage: [[3, "STARTER"], "You have 3 teammates, the most the Starter plan allows. An Owner or Admin can change the plan in Settings, Plan & billing."],
  settingsCrumb: [["Priya"], "AI teammates › Priya"],
  pauseTeammate: [["Priya"], "Pause Priya"],
  turnOnTeammate: [["Priya"], "Turn on Priya"],
  removeTeammateTitle: [["Priya"], "Remove Priya?"],
  nextRunLine: [["Mon 9:00"], "Next run Mon 9:00"],
  pausedBecause: [["This teammate was removed."], "Paused: This teammate was removed."],
  monthName: [[AT], "October"],
  usageLine: [[12, 40, AT], "Used 12 of 40 AI questions in October."],
  agentCapMessage: [["Status Reporter", 40, AT], "Status Reporter has used its 40 AI questions for October. It can answer again on November 1 (UTC), or whoever manages it can raise the limit in its settings."],
  pausedNotSent: [["Priya"], "Priya is paused, so your message wasn't sent."],
  routineLimitMessage: [[10, "teammate"], "You have 10 routines with this teammate, the most one person can have."],
  tooManyDecisions: [[12], "Too many decisions at once. Try again in 12 seconds."],
  // Card titles, change lines and the tools' refusals (previews.ts, teammate-tools.ts).
  quotedTitle: [["Create task", "Call Acme"], 'Create task "Call Acme"'],
  placeTitle: [["Post in", "#general"], "Post in #general"],
  moveTitle: [["Call Acme", "Backlog"], 'Move "Call Acme" to Backlog'],
  forPersonTitle: [['Create task "Call Acme"', "Max Chen"], 'Create task "Call Acme" for Max Chen'],
  channelPlace: [["general"], "#general"],
  dmPlace: [["Max Chen"], "your chat with Max Chen"],
  approveAlwaysIn: [["your chat with Max Chen"], "Approve and don't ask again in your chat with Max Chen"],
  changeLine: [["Status", "Done"], "Status: Done"],
  meetingAtLine: [["Mon 12 Oct, 14:00, Kolkata time"], "On Mon 12 Oct, 14:00, Kolkata time."],
  withPeopleLine: [[["Max Chen", "Lea Alpha"]], "With Max Chen and Lea Alpha."],
  kraHoldersLine: [["Account Executive"], "Everyone with the job title Account Executive gets it."],
  kpiUnderLine: [["Pipeline health"], "It sits under the KRA Pipeline health."],
  agentForPerson: [["Chief of Staff", "Priya Shah"], "Chief of Staff for Priya Shah"],
  statusesSentence: [[["To Do", "In Progress", "Done"]], "That isn't a status in this List. Its statuses are: To Do, In Progress, Done."],
  unknownPerson: [["max@x.com"], "There's nobody with the email max@x.com in this workspace."],
  noListNamed: [["Backlog"], "There's no List called Backlog that you can add tasks to."],
  severalLists: [["Backlog"], "More than one List is called Backlog. Say which one by its id."],
  alreadyInList: [["Backlog"], "That task is already in Backlog."],
  noConversationNamed: [["design"], "There's no channel or group called design that you're in."],
  severalConversations: [["design"], "More than one conversation is called design. Say which one by its id."],
  noDmWith: [["Max Chen"], "You don't have a direct message with Max Chen yet. Start one in Talk first."],
  cantPostIn: [["#general"], "You can't post in #general."],
  memoryFull: [[100, "person"], "I already remember 100 things for you. Forget some first."],
  nothingRemembered: [["report day"], 'Nothing is remembered as "report day".'],
  // Running a call and deciding one (executor.ts, actions.ts).
  tooManyWaiting: [["Priya"], "Too many things are waiting for Priya's approval."],
  cancelledToolOffLine: [["Priya"], "Cancelled: Priya can no longer use this tool."],
  titleList: [[["Post in #general", "Post in #proof", "Send kudos to Max", "Invite lea@x.com", "Comment on Call Acme"]], "Post in #general, Post in #proof, Send kudos to Max and 2 more"],
  agentAuditLine: [["Chief of Staff", "Priya Shah", 'Created task "Call Acme"'], 'Chief of Staff (for Priya Shah): Created task "Call Acme"'],
  // The tool picker and the Tools and approvals tab (5.5).
  approvalFor: [["Create tasks"], "Approval for Create tasks"],
  dontAskInLine: [["#general"], "Doesn't ask in #general"],
  asksFirstInLine: [["your chat with Max Chen"], "Asks first in your chat with Max Chen"],
  askEveryoneFor: [["Create tasks"], "Ask everyone first: Create tasks"],
  removeChoice: [["Doesn't ask in #general"], "Remove: Doesn't ask in #general"],
  // The Routines tab's Run now and Practice run.
  routineRanToast: [["Morning brief"], "Morning brief ran. Its report is in the chat."],
  routinePracticeToast: [["Morning brief"], "Practice run of Morning brief done. Nothing was changed."],
  routineDidntFinish: [["Morning brief"], "Morning brief didn't finish. Try again."],
};

const builders = copy as unknown as Record<string, unknown>;

function call(name: string, args: unknown[]): string {
  return (builders[name] as (...a: unknown[]) => string)(...args);
}

function strings(v: unknown, path: string, out: Array<[string, string]>): void {
  if (typeof v === "string") out.push([path, v]);
  else if (Array.isArray(v)) v.forEach((x, i) => strings(x, `${path}[${i}]`, out));
  else if (v && typeof v === "object") for (const [k, x] of Object.entries(v)) strings(x, `${path}.${k}`, out);
}

describe("the copy rule", () => {
  it("holds for every exported string", () => {
    const all: Array<[string, string]> = [];
    for (const [name, value] of Object.entries(copy)) if (typeof value !== "function") strings(value, name, all);
    strings(ROUTINE_REASON_TEXT, "ROUTINE_REASON_TEXT", all);
    expect(all.length).toBeGreaterThan(150);
    expect(all.filter(([, s]) => BANNED.test(s))).toEqual([]);
  });
  it("holds for every sentence a builder makes", () => {
    const made = Object.entries(BUILDERS).map(([name, [args]]) => [name, call(name, args)] as const);
    expect(made.filter(([, s]) => BANNED.test(s))).toEqual([]);
  });
});

describe("the builders", () => {
  it("every builder is listed", () => {
    const exported = Object.entries(copy).filter(([, v]) => typeof v === "function").map(([k]) => k).sort();
    expect(exported).toEqual(Object.keys(BUILDERS).sort());
  });
  for (const [name, [args, sentence]] of Object.entries(BUILDERS)) {
    it(`${name} says what the spec says`, () => {
      expect(call(name, args)).toBe(sentence);
    });
  }
  it("count one thing as one", () => {
    expect(copy.thingsWaiting(1)).toBe("1 thing is waiting for your approval");
    expect(copy.peopleCanRead(1)).toBe("1 person can read it.");
    expect(copy.usageLine(1, null, AT)).toBe("Used 1 AI question in October.");
    expect(copy.usageLine(5, null, AT)).toBe("Used 5 AI questions in October.");
    expect(copy.routineLimitMessage(30, "person")).toBe("You have 30 routines, the most one person can have.");
    expect(copy.withPeopleLine(["Max"])).toBe("With Max.");
    expect(copy.withPeopleLine(["A", "B", "C"], 2)).toBe("With A, B, C and 2 more.");
    expect(copy.memoryFull(1, "agent")).toBe("This teammate already remembers 1 thing for everyone. Delete some first.");
    expect(copy.titleList(["Post in #general"])).toBe("Post in #general");
    expect(copy.titleList(["A", "B"])).toBe("A and B");
    expect(copy.titleList(["A", "B", "C"])).toBe("A, B and C");
    expect(copy.titleList(["A", "B", "C", "D"])).toBe("A, B, C and 1 more");
  });
  it("name the workspace when it is the workspace's limit", () => {
    expect(copy.teammateLimitMessage(30, "GROWTH", "workspace")).toBe(
      "This workspace has 30 workspace teammates, the most the Growth plan allows. An Owner or Admin can change the plan in Settings, Plan & billing.",
    );
  });
  it("roll a December limit over to January, in UTC", () => {
    expect(copy.agentCapMessage("Priya", 1, new Date("2026-12-31T23:30:00Z"))).toBe(
      "Priya has used its 1 AI question for December. It can answer again on January 1 (UTC), or whoever manages it can raise the limit in its settings.",
    );
    // 00:30 on 1 November in Kolkata is still 31 October in UTC.
    expect(copy.monthName(new Date("2026-10-31T19:00:00Z"))).toBe("October");
  });
  it("name the one request a routine left waiting by its own title", () => {
    expect(copy.approvalNoticeMessage(1, "Weekly status", "Post in #team")).toBe("Post in #team");
    expect(copy.routinePausedNoticeMessage("Weekly status", "")).toBe("Weekly status");
  });
  it("lower only a word's first letter, never an acronym's", () => {
    expect(copy.wouldDoLine("SOP draft for onboarding")).toBe("Would SOP draft for onboarding");
    expect(copy.wouldDoLine("  Create task \"Call Acme\"")).toBe("Would create task \"Call Acme\"");
  });
  it("end a line cleanly when there is no reason or error", () => {
    expect(copy.youApprovedLine("Post in #general")).toBe("You approved: Post in #general");
    expect(copy.routinePausedLine("Daily brief", "")).toBe("Routine paused: Daily brief.");
    expect(copy.routineSkippedLine("Daily brief", "")).toBe("Routine skipped: Daily brief.");
    expect(copy.didntWorkLine("Post in #general", "")).toBe("Didn't work: Post in #general.");
  });
});

describe("labels", () => {
  const TEAMMATE_TOOLS = ["update_task", "comment_on_task", "move_task", "post_in_talk", "update_doc", "remember", "forget", "create_routine", "list_my_inbox", "read_talk", "ask_teammate"];

  it("name every tool a teammate may be given", () => {
    expect(Object.keys(copy.TOOL_PICKER_COPY).sort()).toEqual([...PPMS_TOOL_NAMES, ...TEAMMATE_TOOLS].sort());
    expect([...TEAMMATE_TOOL_NAMES].sort()).toEqual([...TEAMMATE_TOOLS].sort());
    for (const c of Object.values(copy.TOOL_PICKER_COPY)) expect(c.label.trim()).not.toBe("");
  });
  it("give every tool but the reads a card verb", () => {
    const reads = ["search_tasks", "search_employees", "search_meetings", "search_okrs", "search_sops", "search_contracts", "list_forms", "list_data_tables", "list_my_kras", "list_my_kpi_status", "list_my_sops", "list_my_weekly_reviews", "get_team_alignment_rollup", "list_my_inbox", "read_talk", "ask_teammate"];
    // move_task's title is its own builder (moveTitle).
    const expected = [...PPMS_TOOL_NAMES, ...TEAMMATE_TOOLS].filter((t) => !reads.includes(t) && t !== "move_task").sort();
    expect(Object.keys(copy.ACTION_VERB).sort()).toEqual(expected);
  });
  it("name every colour", () => {
    expect(Object.keys(copy.HUE_LABEL)).toEqual([...TEAMMATE_HUES]);
  });
});

describe("the invitation card", () => {
  it("names everything the invitation gives, in plain words", () => {
    expect(copy.INVITE_CARD.level("Admin")).toBe("Joins as: Admin.");
    expect(copy.INVITE_CARD.role("Account Executive")).toBe("Role: Account Executive. Its KRAs and published SOPs are assigned when they accept.");
    expect(copy.INVITE_CARD.manager("Priya Shah")).toBe("Reports to Priya Shah.");
    expect(copy.INVITE_CARD.kras(["Pipeline", "Renewals", "Upsell", "Churn"])).toBe("KRAs assigned when they accept: Pipeline, Renewals, Upsell and 1 more.");
    expect(copy.INVITE_CARD.sops(["Onboarding"])).toBe("SOPs assigned when they accept: Onboarding.");
    expect(copy.INVITE_CARD.unknown("role")).toBe("That role isn't in this workspace, so the invitation wasn't prepared.");
    const all = [
      copy.INVITE_CARD.level("x"), copy.INVITE_CARD.role("x"), copy.INVITE_CARD.manager("x"), copy.INVITE_CARD.department("x"),
      copy.INVITE_CARD.office("x"), copy.INVITE_CARD.kras(["x"]), copy.INVITE_CARD.sops(["x"]), copy.INVITE_CARD.unknown("x"), copy.NEW_OPEN_TO_ALL,
      copy.INVITE_CARD.roleListedOnly("x"), copy.INVITE_CARD.roleKrasListedSops("x"), copy.INVITE_CARD.existingAccount, copy.TEAMMATE_SETTINGS.scheduleStopped,
    ];
    for (const line of all) expect(line).not.toMatch(/\u2014|\u2013|--/);
  });
});


describe("GROUP_COPY (group chats, Phase 2)", () => {
  const SAID: Record<string, [unknown[], string]> = {
    removedCantJoin: [["Triage"], "Triage was removed, so it can't join a group."],
    limit: [[20], "You have 20 group chats, the most one person can have. Leave one first."],
    noOneCanAnswer: [["Triage and Project Manager"], "Triage and Project Manager can't answer now."],
    skippedLine: [["Triage", "it is paused."], "Triage didn't answer: it is paused."],
    renamedLine: [["Offsite crew"], "Renamed to Offsite crew"],
    addedLine: [["Triage"], "Added Triage"],
    removedLine: [["Triage"], "Removed Triage"],
    membersButton: [[3], "3 teammates"],
    leaveTitle: [["Offsite crew"], "Leave Offsite crew?"],
    answersFrom: [["Triage and Project Manager"], "Answers: Triage and Project Manager"],
    placeholder: [["Offsite crew"], "Message Offsite crew…"],
    lastLineAgent: [["Triage", "Two are late."], "Triage: Two are late."],
    groupDefaultName: [[["Chief of Staff", "Market Analyst", "Triage"]], "Chief of Staff, Market Analyst and Triage"],
    leftToast: [["Offsite crew"], "You left Offsite crew"],
    composerHintLead: [["Chief of Staff"], "Name a teammate with @ to ask it. Otherwise Chief of Staff answers."],
    removeTitle: [["Triage"], "Remove Triage from this group chat?"],
    cantContinue: [["Triage", "it was removed."], "Triage can't continue here: it was removed."],
  };
  const g = copy.GROUP_COPY as unknown as Record<string, unknown>;
  it("lists every builder", () => {
    expect(Object.keys(g).filter((k) => typeof g[k] === "function").sort()).toEqual(Object.keys(SAID).sort());
  });
  for (const [name, [args, sentence]] of Object.entries(SAID)) {
    it(`${name} says what the spec says`, () => {
      const made = (g[name] as (...a: unknown[]) => string)(...args);
      expect(made).toBe(sentence);
      expect(BANNED.test(made)).toBe(false);
    });
  }
});

describe("LEGACY_COPY (old schedules moved onto routines, Phase 2)", () => {
  const SAID: Record<string, [unknown[], string]> = {
    movedLine: [["Triage", "Weekdays at 9:00"], "The schedule Triage had in Workspace agents is now your routine: Scheduled check · Weekdays at 9:00. It works as you and asks before anything other people will see."],
    routineFor: [["Olivia"], "Routine for Olivia"],
    scheduleLine: [["Olivia"], "Now a routine for Olivia"],
    stopped: [["when schedules moved to routines, the person who set it up was a guest."], "Its schedule stopped: when schedules moved to routines, the person who set it up was a guest. Anyone who wants it on a schedule can set up a routine in its chat."],
    runNowWaiting: [["Deal desk"], "Deal desk is waiting for your approval"],
    movedLineKept: [["Triage", "Weekdays at 9:00"], "The schedule Triage had in Workspace agents is now your routine: Scheduled check · Weekdays at 9:00. It works as you and asks before anything other people will see, except what you chose not to be asked about."],
    routinePausedFor: [["Olivia"], "Routine for Olivia, paused"],
    scheduleLinePaused: [["Olivia", "Olivia is no longer in this workspace."], "Now a routine for Olivia, paused: Olivia is no longer in this workspace."],
    scheduleLinePausedYou: [[null], "Now your routine, paused."],
  };
  const l = copy.LEGACY_COPY as unknown as Record<string, unknown>;
  it("lists every builder", () => {
    expect(Object.keys(l).filter((k) => typeof l[k] === "function").sort()).toEqual(Object.keys(SAID).sort());
  });
  for (const [name, [args, sentence]] of Object.entries(SAID)) {
    it(`${name} says what the spec says`, () => {
      const made = (l[name] as (...a: unknown[]) => string)(...args);
      expect(made).toBe(sentence);
      expect(BANNED.test(made)).toBe(false);
    });
  }
  it("ends a stop with no reason cleanly", () => {
    expect(copy.LEGACY_COPY.stopped("")).toBe("Its schedule stopped. Anyone who wants it on a schedule can set up a routine in its chat.");
  });
  it("gives every reason the database allows a sentence", () => {
    expect(Object.keys(copy.LEGACY_COPY.stopReason).sort()).toEqual(
      ["agent_account", "agent_removed", "guest", "no_access", "no_creator", "no_schedule", "person_gone", "unsupported_schedule"],
    );
  });
});

describe("TALK_TEAMMATE_COPY (teammates in Talk, Phase 2)", () => {
  const SAID: Record<string, [unknown[], string]> = {
    working: [["Chief of Staff"], "Chief of Staff is working on it"],
    didntAnswer: [["Chief of Staff"], "Chief of Staff didn't answer here. See your chat with it."],
    didntAnswerHere: [["Chief of Staff"], "Chief of Staff didn't answer here."],
    askedLine: [["#proof", "Sum this up"], "Asked in #proof: Sum this up"],
    answeredIn: [["#proof"], "Answered in #proof"],
    tooMany: [[12], "You've tried to ask teammates 5 times in a minute. Try again in 12 seconds."],
    noticeSender: [["Chief of Staff", "Ola Owner"], "Chief of Staff for Ola Owner"],
  };
  it("says one second as one (review round 1)", () => {
    expect(copy.TALK_TEAMMATE_COPY.tooMany(1)).toBe("You've tried to ask teammates 5 times in a minute. Try again in 1 second.");
  });
  const t = copy.TALK_TEAMMATE_COPY as unknown as Record<string, unknown>;
  it("lists every builder", () => {
    expect(Object.keys(t).filter((k) => typeof t[k] === "function").sort()).toEqual(Object.keys(SAID).sort());
  });
  for (const [name, [args, sentence]] of Object.entries(SAID)) {
    it(`${name} says what the spec says`, () => {
      const made = (t[name] as (...a: unknown[]) => string)(...args);
      expect(made).toBe(sentence);
      expect(BANNED.test(made)).toBe(false);
    });
  }
});

describe("DELEGATION_COPY (one teammate asking another, Phase 2; review round 6)", () => {
  const SAID: Record<string, [unknown[], string]> = {
    askedByLine: [["Chief of Staff", "Which tasks are stuck?"], "Asked by Chief of Staff: Which tasks are stuck?"],
    delegateWaitingLine: [["Project Manager", "Move \"Call Acme\" to Backlog"], "Project Manager is waiting for your approval: Move \"Call Acme\" to Backlog"],
    askTitle: [["Project Manager"], "Ask Project Manager"],
    noTeammateNamed: [["Planner"], "You don't have a teammate called Planner."],
    severalNamed: [["Planner"], "More than one of your teammates is called Planner, so it isn't clear which to ask. One needs another name: the person can rename their own, and an Owner or Admin can rename a workspace one."],
    delegatePaused: [["Planner"], "Planner is paused, so it can't be asked."],
    delegateNoAnswer: [["Planner"], "Planner didn't answer."],
    requestTooLong: [[4000], "That request is longer than 4,000 characters, so nothing was asked. Shorten it or split it into parts."],
    waitingNote: [["Priya", "Planner"], "These wait for Priya's approval in Planner's chat. Don't ask for them again."],
    endedEarlyNote: [["Planner"], "Planner's answer stopped part way, so it may be missing something. Say so, and don't pass it on as complete."],
  };
  const d = copy.DELEGATION_COPY as unknown as Record<string, unknown>;
  it("lists every builder", () => {
    expect(Object.keys(d).filter((k) => typeof d[k] === "function").sort()).toEqual(Object.keys(SAID).sort());
  });
  for (const [name, [args, sentence]] of Object.entries(SAID)) {
    it(`${name} says what the spec says`, () => {
      const made = (d[name] as (...a: unknown[]) => string)(...args);
      expect(made).toBe(sentence);
      expect(BANNED.test(made)).toBe(false);
    });
  }
  it("writes every fixed sentence without a dash", () => {
    for (const v of Object.values(d)) if (typeof v === "string") expect(BANNED.test(v)).toBe(false);
  });
});

describe("AUTOMATION_TEAMMATE_COPY (teammates in Automations, Phase 2)", () => {
  const SAID: Record<string, [unknown[], string]> = {
    dailyCap: [[20], "This automation has asked its teammates 20 times today, the most one automation may, so this run's request was not asked. Runs from tomorrow (UTC) ask again."],
    creatorOnlyPublish: [["Max Member"], "Its live version has an AI teammate step that works as Max Member, so only they can publish a new version. You can still save the draft."],
    creatorGoneRemove: [["Max Member"], "Its AI teammate step works as Max Member, who can no longer be acted for here, so it can't run. Remove that step to change or publish this automation."],
    pausedLabel: [["Triage"], "Triage (paused: it won't run until it is turned back on)"],
    askedLine: [["Support triage", "Summarise [title]"], 'Asked by the automation "Support triage": Summarise [title]'],
  };
  const t = copy.AUTOMATION_TEAMMATE_COPY as unknown as Record<string, unknown>;
  it("lists every builder", () => {
    expect(Object.keys(t).filter((k) => typeof t[k] === "function").sort()).toEqual(Object.keys(SAID).sort());
  });
  for (const [name, [args, sentence]] of Object.entries(SAID)) {
    it(`${name} says what the spec says`, () => {
      const made = (t[name] as (...a: unknown[]) => string)(...args);
      expect(made).toBe(sentence);
      expect(BANNED.test(made)).toBe(false);
    });
  }
  it("writes every fixed sentence without a dash", () => {
    for (const v of Object.values(t)) if (typeof v === "string") expect(BANNED.test(v)).toBe(false);
  });
});
