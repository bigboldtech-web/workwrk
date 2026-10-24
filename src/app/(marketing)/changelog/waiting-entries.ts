// WRITTEN, NOT LISTED: changelog entries for work that is built and off in
// production. Nothing imports this into the page (page.tsx), so nothing here
// is rendered: a line a visitor reads is a claim that it runs, and none of
// these does yet.
//
// TEACHING AI TEAMMATES BY SHOWING (docs/plans/ai-teammates-phase5.md step 5,
// Decision 29). It ships only when Founder actions 1 to 4 are done (the
// provider's answers on the live view's input, counsel's review of the
// privacy text, BROWSER_SKILLS_OFFERED set, the founder's own try) and it is
// on in production (Founder action 5): then this entry goes at the top of
// ENTRIES in page.tsx, dated the day production was turned on, in the same
// commit that sets flags.teammateSkills to true, and is deleted here.
//
// Made truer than the spec's words: "run it again from your chat or a daily
// reminder" became "or from a reminder", since a skill's routine reminds at
// most once a day, weekly or monthly too; "A recording keeps the pages, the
// buttons and links you click" became "which pages you visit, the words on
// the buttons and links you click", as the privacy policy's section 3 says
// it, since a step keeps a page's site and the start of its address and a
// control's words, never a page's text.

// AI APPS THROUGH THE WORKWRK MCP SERVER (docs/plans/mcp-server.md 6.4,
// step 4). It ships only when the founder has set MCP_OFFERED in production
// and counsel has read the privacy text (Founder actions 1 and 2): then this
// entry goes at the top of ENTRIES in page.tsx, dated the day production was
// turned on, and is deleted here (Founder action 1, "Publish the changelog
// entry").

/** The changelog's kinds of line (page.tsx EntryType). */
type WaitingEntryType = "feature" | "improvement" | "fix" | "security" | "docs";

export interface WaitingEntry {
  date: string;
  title: string;
  items: ReadonlyArray<{ type: WaitingEntryType; text: string }>;
}

/** Teaching AI teammates by showing: written now, listed once it is on in production. */
export const TEAMMATE_SKILLS_ENTRY: WaitingEntry = {
  date: "<the day production is turned on>",
  title: "Teach AI teammates by showing",
  items: [
    {
      type: "feature",
      text: "On Growth and above, where an Owner or Admin turns it on, show a teammate a job once in its browser, review the steps, and run it again from your chat or from a reminder.",
    },
    {
      type: "security",
      text: "A recording's steps keep which pages you visit, the words on the buttons and links you click and which fields you use, never what you type or choose; its pictures, kept for you alone for 24 hours, can show it. Every click still asks first, and a form's fields are filled in on one card that shows every word first.",
    },
  ],
};

/** AI apps through the MCP server: written now, listed once MCP_OFFERED is set in production. */
export const MCP_ENTRY: WaitingEntry = {
  date: "<the day production is turned on>",
  title: "Connect your AI apps to WorkwrK (MCP)",
  items: [
    {
      type: "feature",
      text: "Connect Claude, ChatGPT, Cursor or VS Code to WorkwrK and ask it to find, create and change your work, as you, where an Owner or Admin turns it on.",
    },
    {
      type: "security",
      text: "An app sees only what you can, never deletes anything, and every change it makes is recorded with its name in the audit log, and named in a task's activity. Disconnect it any time in My settings.",
    },
  ],
};
