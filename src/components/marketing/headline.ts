// The claim, in one place.
//
// It is six words: "Every task knows who owns it." The page renders it, the
// social card renders it, and neither of them types it. A headline that is
// typed twice is a headline that drifts, and this one is the site's whole
// argument compressed to a line.
//
// WHY THERE IS NO LONGER AN A/B HERE. This module used to hold two hero
// headlines and a variant switch, so a deploy could run "Your people,
// processes, work and goals. Snapped together." against "Cancel 14 tools.
// Keep one." Both are gone with the concept they belonged to, and the
// mechanism goes with them: the page's first rule is one idea per screen,
// and a hero that says two things depending on a cookie is two ideas
// wearing one slot. The variant letter still exists in headline-variant.ts,
// which is a leaf that instrumentation.ts stamps onto events, so a future
// test can be run without this module growing a second opinion again.
//
// The number that is NOT here any more: the old eyebrow read "A 280-person
// services firm replaced 14 tools in one quarter", sourced from a quote
// that exists in this repo as hardcoded JSX on our own login page and
// nowhere else. No CRM record, no signed permission, no customer file. The
// site does not claim a customer it cannot evidence, so the eyebrow is
// gone rather than reworded.

export interface Headline {
  /** The claim, whole. Six words. */
  h1: string;
  /** The claim split where it breaks, so a card can set it on two lines. */
  h1Parts: string[];
  /** One sentence under it. Never two. */
  sub: string;
}

const H1_PARTS = ["Every task knows", "who owns it."];

export function heroHeadline(): Headline {
  return {
    h1: H1_PARTS.join(" "),
    h1Parts: [...H1_PARTS],
    sub: "The owner, the standard and the goal travel with the work.",
  };
}
