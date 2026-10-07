// /changelog, rewritten so every line of it is true.
//
// What it used to carry: six releases of a product that does not exist.
// "Money hub expansion" with procurement, purchase orders and budget versus
// actual; a compensation band editor; onboarding journeys with mentor
// pairing; kudos counting into a composite review score; "Cross-page nav
// latency cut by 40%", a number nothing measured; "Marketing site rebuilt
// with a [two competitor names] aesthetic", which put two competitor names
// on a page that is not /compare; and, worst, a security row reading
// "SOC 2 Type II report available; refresh of penetration test from
// [a named vendor]". That row was live, indexable and linked from the
// footer of every page, on the same domain as a security page saying no
// certification is held.
//
// The entries below come from the repository's own history. A changelog is
// the one marketing page where the source of truth is a commit, so that is
// what it reads from, and the rule at the top of the page says so.

import Link from "next/link";
import type { Metadata } from "next";
import { Band, Claim, Close, Eyebrow, Headline, Note, Page, Sub } from "@/components/marketing/iconic/iconic";
import { OG_DEFAULT_IMAGE, OG_DEFAULT_TWITTER_IMAGE } from "@/components/marketing/og";

export const metadata: Metadata = {
  title: "Changelog",
  description:
    "What actually shipped, newest first, drawn from the repository rather than from a marketing calendar. Nothing here is a plan.",
  alternates: { canonical: "https://workwrk.com/changelog" },
  openGraph: {
    images: [OG_DEFAULT_IMAGE],
    title: "Changelog",
    description: "What actually shipped, newest first, drawn from the repository rather than a marketing calendar.",
  },
  // The root layout's twitter:description still reads "Replaces 15 tools",
  // which collides with the fourteen this site counts everywhere else.
  twitter: { images: [OG_DEFAULT_TWITTER_IMAGE], card: "summary_large_image", description: "What actually shipped, newest first, drawn from the repository rather than a marketing calendar." },
};

type EntryType = "feature" | "improvement" | "fix" | "security" | "docs";

// A LABEL, AND NOTHING ELSE. Each kind used to carry a hue and an icon, and
// they were painted as a bordered uppercase pill in front of every line:
// five hues of pill down one page, on a site whose rule is one blue at most
// once per screen. The word does the whole job.
const TYPE_META: Record<EntryType, { label: string }> = {
  feature:     { label: "New" },
  improvement: { label: "Improvement" },
  fix:         { label: "Fix" },
  security:    { label: "Security" },
  docs:        { label: "Docs" },
};

const ENTRIES: readonly { date: string; version?: string; title: string; items: readonly { type: EntryType; text: string }[] }[] = [
  // From main's merges since 2026-09-21. A release still behind a switch
  // that is off in production (the one share dialog, ACCESS_V2_TABLES) is
  // not listed until it is on.
  {
    date: "2026-10-07",
    title: "Agent schedules are routines",
    items: [
      { type: "security", text: "A scheduled agent in Workspace agents now runs as the person who set it up, as one of their routines, and asks before anything other people would see. Before, it acted without asking, and one with nobody on record as setting it up ran as the first admin it found: such a schedule now stops, with the reason shown. Schedules more often than hourly run hourly." },
      { type: "improvement", text: "Run now in Workspace agents runs the agent as you, in your own chat with it, so anything it asks to do waits there for your approval. To put an agent on a schedule, set up a routine in its chat." },
    ],
  },
  {
    date: "2026-10-07",
    title: "Ask AI asks first",
    items: [
      { type: "security", text: "Ask AI now asks before anything other people would see, such as kudos, an invitation, a new doc, form or table, or a task for someone else. It shows the approval card AI teammates use, and nothing happens until you approve it. A request nobody answers expires after 7 days. Your own work, like a task for yourself, still happens at once." },
      { type: "improvement", text: "When a teammate's routine asks for your approval, its Inbox row opens as the approval card, so you can approve, change or deny it without leaving the Inbox." },
      { type: "fix", text: "Ask AI keeps what you type: a message that didn't send comes back above anything you typed since, and each chat keeps its unsent words when you switch to another chat." },
    ],
  },
  {
    date: "2026-10-06",
    title: "AI teammates",
    items: [
      { type: "feature", text: "AI teammates: AI helpers with one job each that you chat with, under AI. Start from a template (Chief of Staff, Project Manager, People Ops, Meeting Prep, Talk and inbox triage, Status Reporter) or from scratch. A teammate works as you and can see and change only what you can." },
      { type: "feature", text: "Anything other people would see, such as a task for someone else, a comment on a shared task or a post in Talk, waits on an approval card in the chat until you approve, change or deny it, unless you chose Don't ask for it. A request nobody answers expires after 7 days. Inviting people always asks." },
      { type: "feature", text: "Teammates remember what you ask them to (each person sees and deletes their own in Memory), run routines on the schedule you set, at most once an hour, and have a practice run that shows what they would do without changing anything. Each chat turn and each routine run uses one of the plan's AI questions." },
    ],
  },
  {
    date: "2026-10-06",
    title: "Plans that count what they promise",
    items: [
      { type: "improvement", text: "Seats and AI questions are counted the way the pricing page says: people who can sign in and open invitations hold the seats, and Ask AI messages, agent runs and the AI actions people start in docs, files, forms, tables, whiteboards, SOPs, KRAs, meetings and the app builder use the plan's AI questions. Fill with AI and Talk updates have their own daily limit. On Starter, each person also has 50 free questions in total, counted across every free workspace they asked them in." },
      { type: "fix", text: "An AppSumo code moves the workspace onto the plan and seats it grants, and never lowers either." },
      { type: "fix", text: "A closed workspace no longer gets reminder emails, and the weekly digests reach every team in a large workspace." },
    ],
  },
  {
    date: "2026-10-05",
    title: "Launch security, and a deletion that keeps its promise",
    items: [
      { type: "security", text: "Rich text that people write is cleaned where it is shown, and uploaded files are served from outside the site's public folder." },
      { type: "security", text: "Security headers on every page." },
      { type: "fix", text: "A deleted workspace's data is removed for good 30 days later, as the privacy policy says." },
    ],
  },
  {
    date: "2026-10-04",
    title: "AI in Lists and Talk, and a public link for one task",
    items: [
      { type: "feature", text: "AI fields in Lists, turned on by the workspace." },
      { type: "feature", text: "A view-only public link for one task, where the workspace allows public links, and the workspace export carries the work." },
      { type: "feature", text: "Bird's eye shows linked tasks, gives a Folder its own view, and moves up and down in Focus." },
      { type: "improvement", text: "Drag tasks up and down to reorder them." },
    ],
  },
  {
    date: "2026-10-03",
    title: "Access and correctness",
    items: [
      { type: "fix", text: "People pickers list the whole company, not only your own team." },
      { type: "fix", text: "Fixes across access, Talk and the interface, found in the launch review." },
    ],
  },
  {
    date: "2026-10-01",
    title: "Settings and sign-in",
    items: [
      { type: "improvement", text: "Workspace settings, My settings, the sign-in screens and the access screens move onto the new frame." },
    ],
  },
  {
    date: "2026-09-29",
    title: "People",
    items: [
      { type: "improvement", text: "The Directory, org chart, My team, workload, goals and KPIs, reviews, talent, candor, surveys and kudos move onto the new frame." },
    ],
  },
  {
    date: "2026-09-27",
    title: "Share anything from its menu",
    items: [
      { type: "feature", text: "Share a Space, Folder, List or doc from its own menu. The person sees what you shared and the path to it, nothing more." },
      { type: "improvement", text: "AI, automation and add-ons move onto the new frame." },
    ],
  },
  {
    date: "2026-09-26",
    title: "Tasks in more than one List",
    items: [
      { type: "feature", text: "A task can live in more than one List, with connected and mirror columns, dashboards and a Space Overview." },
    ],
  },
  {
    date: "2026-09-25",
    title: "Bird's eye",
    items: [
      { type: "feature", text: "Bird's eye: a whole Space at a glance, one column per List." },
      { type: "improvement", text: "Board is every List's default view, and any view can be pinned as the default." },
    ],
  },
  {
    date: "2026-09-21",
    title: "The interface refresh reaches Knowledge",
    items: [
      { type: "feature", text: "Docs, SOPs, policies and contracts move onto the shared page frame and the token layer." },
      { type: "fix", text: "Restored the list and board options an earlier phase of the refresh had dropped, including the column that took a whole view down." },
      { type: "improvement", text: "One verification script that checks a commit the way the production build does." },
    ],
  },
  {
    date: "2026-09-18",
    title: "The frame, then Work",
    items: [
      { type: "feature", text: "One frame for every product page: the navy rail, the top bar, the secondary sidebar and one page header." },
      { type: "feature", text: "Work, lists and boards rebuilt on that frame, with the seven defects the team reported alongside it." },
      { type: "improvement", text: "The type scale moved up a step across the product, with a codemod rather than by hand." },
    ],
  },
  {
    date: "2026-09-17",
    title: "Tokens, navigation and the access engine",
    items: [
      { type: "feature", text: "One token layer for colour, type, spacing and radius, replacing the per page palettes." },
      { type: "improvement", text: "Navigation derived from the URL rather than from a hand kept map, so a route and its hub cannot disagree." },
      { type: "improvement", text: "The new access engine landed inert beside the old one, with a parity job comparing every answer." },
    ],
  },
  {
    date: "2026-09-10",
    title: "Eight hubs on the rail",
    items: [
      { type: "improvement", text: "The left rail went from about twenty five icons to eight hubs, with the rest folded into the hub sidebars." },
      { type: "fix", text: "Every link the consolidation had dropped was restored." },
      { type: "feature", text: "Boards poll for teammates' changes, so a task someone else moves appears without a refresh." },
    ],
  },
  {
    date: "2026-09-09",
    title: "Access that matches what people expect",
    items: [
      { type: "feature", text: "A Space or List member can add and edit the work in it without being able to manage the container." },
      { type: "fix", text: "Assigning someone a task grants them access to it, so assigned work is never invisible." },
      { type: "improvement", text: "The share dialog shows the real, additive grants rather than a guess at them." },
      { type: "feature", text: "Multiple assignees on a task, in the data model and in the picker." },
    ],
  },
  {
    date: "2026-09-08",
    title: "Sign-in hardening",
    items: [
      { type: "security", text: "Two step verification enforced at login, with authenticator codes and backup codes." },
      { type: "security", text: "Reset tokens hashed at rest, login timing equalised, and the org password policy enforced on signup, reset and invite." },
      { type: "security", text: "Rate limits on the public reset and signup endpoints." },
      { type: "feature", text: "Idle sessions expire, and a person can change their password, sign out everywhere and read their own security activity." },
    ],
  },
];

export default function ChangelogPage() {
  return (
    <Page>
      <Band air="hero" labelledBy="log-h1" still>
        <Eyebrow>Changelog</Eyebrow>
        <Claim id="log-h1">What actually shipped, and when</Claim>
        <Sub>
          Newest first, taken from the repository rather than from a release calendar, and nothing on this page is a
          plan or a preview.
        </Sub>
      </Band>

      {/* The log. It was a dashed timeline with a ringed dot per release and
          a coloured bordered pill in front of every line, five hues of pill
          down one page. The kind of change is now one grey word. */}
      <Band ground="quiet" labelledBy="log-list">
        <Eyebrow>The record</Eyebrow>
        <Headline id="log-list">Releases, newest first.</Headline>
        <ol className="ic-log">
          {ENTRIES.map((entry) => (
            <li key={`${entry.date}:${entry.title}`}>
              <span className="ic-logdate">{entry.date}</span>
              <span className="ic-logtitle">{entry.title}</span>
              <ul className="ic-logitems">
                {entry.items.map((item) => (
                  <li key={item.text}>
                    <span className="ic-logkind">{TYPE_META[item.type].label}</span>
                    <span>{item.text}</span>
                  </li>
                ))}
              </ul>
            </li>
          ))}
        </ol>
        <Note>
          What is next is on the{" "}
          <Link className="ic-a mk-focus" href="/roadmap" data-cta="changelog-roadmap">
            roadmap
          </Link>
          , and only its first column means you can use the thing today.
        </Note>
      </Band>

      <Close headline="Everything here is live now." placement="changelog" />
    </Page>
  );
}
