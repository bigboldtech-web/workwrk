// /tuesday: the share route (decision 14).
//
// It exists because the home page's story is the thing people send each
// other, and a story you can only reach by scrolling someone else's home
// page is not shareable. Until now it did not exist at all: /tuesday fell
// through to the dashboard catch-all locally, and the nav carried it with
// shipped:false so nothing linked to it. This page is the same eight beats
// the home page renders, from the same component, with its own metadata and
// its own card.
//
// CREATING THIS FILE IS NOT THE WHOLE FIX, and an earlier version of this
// comment said it was. Under HARD_HOST_SPLIT the proxy decides what the
// marketing host will serve BEFORE routing: src/proxy.ts rewrites any path
// whose first segment is not in MARKETING_PREFIXES to /404, and that set
// does not contain "tuesday", "snap", "how-it-connects", "product" or
// "roadmap". So on workwrk.com this route, and eleven others this phase
// added, still answer with the marketing 404 no matter what is in this
// directory. Locally there is no host split, which is why every one of them
// returns 200 here and nothing caught it.
//
// src/proxy.ts belongs to another unit this run, so it is reported rather
// than edited. It is a blocking dependency for /tuesday, /snap,
// /how-it-connects, /roadmap and all eight /product/[module] pages: the nav
// rows, the footer rows, the "Share this Tuesday" link, the 404 page's own
// recovery link and eleven sitemap URLs all point into that set.
//
// NOTHING NEW IS CLAIMED HERE. <Spine /> reads the same fixture through the
// same truth gates, so every beat whose mechanism is not built prints its
// shipped fallback narration on this route exactly as it does on the home
// page. This route adds a title, a heading and the receipt's own OG card.
//
// The card is /api/og/receipt with no query, which is the Work Receipt: the
// artefact the story ends on, rendered from the model the page renders.
//
// THE PAGE SAID ITS OWN NAME TWICE. The hero read "One Tuesday." over the
// description, and the section immediately under it opened "One Tuesday. One
// task. One trail." over a sentence that means the same thing, so the first
// two screens carried five text blocks and one idea between them. <Spine />
// now takes `intro={false}` on this route and the claim is made once, here,
// in the hero that carries the page's h1.

import type { Metadata } from "next";

import { Band, Claim, Close, Eyebrow, Note, Page, Sub } from "@/components/marketing/iconic/iconic";
import { Spine } from "@/components/marketing/home/spine";
import { tuesday } from "@/components/marketing/data/tuesday";
import "@/components/marketing/home/home.css";

const SITE = "https://workwrk.com";
const TITLE = "One Tuesday, from nine to six, in one system";
const DESCRIPTION =
  "Follow one task through one day: the row, the role, the SOP, the thread, the contract, the call, the goal and the answer. Every block does one thing to it, and the trail is the receipt.";

export const metadata: Metadata = {
  title: TITLE,
  description: DESCRIPTION,
  alternates: { canonical: `${SITE}/tuesday` },
  openGraph: {
    type: "article",
    title: TITLE,
    description: DESCRIPTION,
    url: `${SITE}/tuesday`,
    siteName: "WorkwrK",
    images: [{ url: "/api/og/receipt", width: 1200, height: 630, alt: "The Tuesday work receipt" }],
  },
  twitter: {
    card: "summary_large_image",
    title: TITLE,
    description: DESCRIPTION,
    images: [{ url: "/api/og/receipt" }],
  },
};

export default function TuesdayPage() {
  return (
    <Page>
      <Band air="hero" labelledBy="tue-h1" still>
        <Eyebrow>The share route</Eyebrow>
        <Claim id="tue-h1">One task. One day. One trail.</Claim>
        <Sub>
          Follow one task from nine to six and watch every block of the system do exactly one thing to it.
        </Sub>
        <Note>
          {tuesday.workspace.sidebarLabel}. Cast: {tuesday.cast.map((c) => `${c.name}, ${c.jobTitle}`).join(". ")}.{" "}
          {tuesday.client.name} is the new client. The cast and the client are a template, not a customer.
        </Note>
      </Band>

      {/* This page IS the share route, so the story's close offers the
          replay and not a link to where the visitor already is. */}
      <Spine shareHref={null} intro={false} labelledBy="tue-h1" />

      <Close headline="Run your own Tuesday." placement="tuesday-close" />
    </Page>
  );
}
