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
        <Claim id="log-h1">What actually shipped.</Claim>
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
        <Headline id="log-list">Every release, with its date.</Headline>
        <ol className="ic-log">
          {ENTRIES.map((entry) => (
            <li key={entry.date}>
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
