/* Notes templates — opinionated starting blocks for the ClickUp-Notes
 * style "pick a template, start writing" flow.
 *
 * Each template returns a fresh array of Block, so call sites should
 * invoke `t.blocks()` to get unique block ids per new note. Templates
 * are intentionally small — three to six blocks — so the writer sees
 * scaffolding without a wall of pre-filled text to delete.
 */

import type { Block } from "./block-editor";

function newId() { return Math.random().toString(36).slice(2, 10); }
function P(text = ""): Block       { return { id: newId(), kind: "paragraph", text }; }
function H1(text = ""): Block      { return { id: newId(), kind: "h1", text }; }
function H2(text = ""): Block      { return { id: newId(), kind: "h2", text }; }
function H3(text = ""): Block      { return { id: newId(), kind: "h3", text }; }
function Bul(text = ""): Block     { return { id: newId(), kind: "bullet", text }; }
function Num(text = ""): Block     { return { id: newId(), kind: "numbered", text }; }
function Todo(text = ""): Block    { return { id: newId(), kind: "todo", text, done: false }; }
function Q(text = ""): Block       { return { id: newId(), kind: "quote", text }; }
function HR(): Block               { return { id: newId(), kind: "divider" }; }
function Call(text = "", tone: "info" | "warn" | "success" = "info"): Block {
  return { id: newId(), kind: "callout", text, tone };
}
function Tog(text = "", body = ""): Block {
  return { id: newId(), kind: "toggle", text, open: true, body };
}

export type NoteTemplate = {
  key: string;
  label: string;
  emoji: string;
  hint: string;
  title: string;
  blocks: () => Block[];
};

export const NOTE_TEMPLATES: NoteTemplate[] = [
  {
    key: "blank", label: "Blank", emoji: "📝", hint: "Start from scratch.",
    title: "Untitled note",
    blocks: () => [P("")],
  },

  {
    key: "meeting", label: "Meeting Notes", emoji: "🗒️",
    hint: "Attendees, agenda, decisions, action items.",
    title: "Meeting notes",
    blocks: () => [
      Call("Meeting notes — fill the gaps as the conversation goes.", "info"),
      H2("Attendees"),
      Bul("@ Add who's in the room"),
      H2("Agenda"),
      Num("Topic 1"),
      Num("Topic 2"),
      H2("Decisions"),
      Bul(""),
      H2("Action items"),
      Todo("Owner — task — due"),
      Todo(""),
      H2("Notes"),
      P(""),
    ],
  },

  {
    key: "one-on-one", label: "1:1 Meeting", emoji: "🤝",
    hint: "Manager↔report sync. Career, blockers, feedback.",
    title: "1:1 with …",
    blocks: () => [
      Call("Confidential between manager and report.", "warn"),
      H2("What's on your mind?"),
      P(""),
      H2("Blockers / where I need help"),
      Bul(""),
      H2("Highlights this week"),
      Bul(""),
      H2("Feedback for me"),
      P(""),
      H2("Goals & next steps"),
      Todo(""),
    ],
  },

  {
    key: "project-brief", label: "Project Brief", emoji: "🚀",
    hint: "Goal, scope, deliverables, milestones, risks.",
    title: "Project brief — ",
    blocks: () => [
      Call("One-page brief. If it doesn't fit, it's not a brief.", "info"),
      H2("Goal"),
      P("In one sentence — what does success look like?"),
      H2("Scope"),
      Tog("In scope", ""),
      Tog("Out of scope", ""),
      H2("Deliverables"),
      Bul(""),
      H2("Milestones"),
      Num(""),
      H2("Risks & assumptions"),
      Bul(""),
      H2("Owners"),
      P("Project owner: @\nReviewers: @\nStakeholders: @"),
    ],
  },

  {
    key: "weekly-review", label: "Weekly Review", emoji: "📈",
    hint: "Wins, lowlights, KPIs, next-week plan.",
    title: "Weekly review — week of ",
    blocks: () => [
      Call("Be specific. Numbers > adjectives.", "info"),
      H2("Wins"),
      Bul(""),
      H2("Lowlights"),
      Bul(""),
      H2("Numbers that matter"),
      P("KPI 1: … (last week → this week)\nKPI 2: …"),
      H2("Next week's plan"),
      Num(""),
      H2("Help needed"),
      P(""),
    ],
  },

  {
    key: "standup", label: "Daily Standup", emoji: "⏰",
    hint: "Yesterday, today, blockers.",
    title: "Standup — ",
    blocks: () => [
      H3("Yesterday"),
      Bul(""),
      H3("Today"),
      Bul(""),
      H3("Blockers"),
      P("Nothing right now."),
    ],
  },

  {
    key: "sop", label: "SOP Draft", emoji: "📚",
    hint: "Process, steps, owners, when to use.",
    title: "SOP — ",
    blocks: () => [
      Call("Draft an SOP here, publish to the SOP module when ready.", "info"),
      H2("When to use this"),
      P(""),
      H2("Owners"),
      P("Process owner: @\nApprover: @"),
      H2("Steps"),
      Num("Step one"),
      Num("Step two"),
      Num("Step three"),
      H2("Pitfalls"),
      Bul(""),
      H2("Related"),
      P("Links to boards / KRAs / tasks (use the @ menu)."),
    ],
  },

  {
    key: "decision", label: "Decision Log", emoji: "🧭",
    hint: "Context, options, recommendation, decision.",
    title: "Decision — ",
    blocks: () => [
      H2("Context"),
      P("What problem are we deciding on?"),
      H2("Options considered"),
      Tog("Option A — pros / cons", ""),
      Tog("Option B — pros / cons", ""),
      Tog("Option C — pros / cons", ""),
      H2("Recommendation"),
      Q(""),
      H2("Decision"),
      P("Decided by: @\nDate:\nReview by:"),
      H2("Follow-ups"),
      Todo(""),
    ],
  },

  {
    key: "post-mortem", label: "Post-mortem", emoji: "🛠️",
    hint: "Incident → timeline → root cause → fix.",
    title: "Post-mortem — ",
    blocks: () => [
      Call("Blameless. Focus on systems, not people.", "warn"),
      H2("Summary"),
      P(""),
      H2("Timeline"),
      Num("HH:MM — event"),
      H2("Root cause"),
      P(""),
      H2("What worked"),
      Bul(""),
      H2("What didn't"),
      Bul(""),
      H2("Action items"),
      Todo(""),
    ],
  },
];
