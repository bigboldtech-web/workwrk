// /demo, on the iconic sheet.
//
// THE FORM IS UNTOUCHED, and it is the reason this page exists. It posts to
// /api/demo-request, it never says "sent" unless something received it, and
// when the mailer answers 503 it hands the visitor a pre-filled mailto with
// everything they typed still in it. That contract is written at the top of
// demo-form.tsx and none of it changed here.
//
// WHAT CHANGED IS THE PAGE AROUND IT. It was two columns: a left rail of
// four bordered cards and a bulleted list, and a right rail holding the form
// inside a sticky bordered card with a shadow. Two objects competing in one
// viewport is rule 4, and a form behind a shadow on a page whose whole
// design is white space is the one element that looked like it came from a
// different site. The four facts are four rows on their own screen, the form
// is one centred column on the next, and neither has a border.
//
// THE LIST OF FIVE "what we cover" LINES CAME OFF. Four of the five say what
// the four facts above them already say, and the fifth, the price for your
// team size, is on the fourth fact. A page that says a thing twice is a page
// a reader stops reading.
//
// TRUTH GATES, unchanged: the sandbox line is still gated on flags.sandbox,
// so the page cannot promise a workspace a visitor can drive afterwards
// while there is not one, and nothing here says what a call will show beyond
// what is on a screen today.

import type { Metadata } from "next";

import { PrimaryCta } from "@/components/marketing/cta";
import { moduleNames } from "@/components/marketing/config";
import { flags } from "@/components/marketing/flags";
import { DEMO_COPY } from "@/components/marketing/iconic/copy";
import { Band, Claim, Eyebrow, Headline, Line, Page, Sub } from "@/components/marketing/iconic/iconic";
import { DemoForm } from "./demo-form";
import "./demo.css";
import { OG_DEFAULT_IMAGE, OG_DEFAULT_TWITTER_IMAGE } from "@/components/marketing/og";

const DEMO_DESCRIPTION =
  "A 20 minute walkthrough of WorkwrK on the parts that matter to your team, with your questions answered and the price for your size.";

export const metadata: Metadata = {
  title: "Book a demo",
  description: DEMO_DESCRIPTION,
  alternates: { canonical: "https://workwrk.com/demo" },
  openGraph: { images: [OG_DEFAULT_IMAGE], title: "Book a demo", description: DEMO_DESCRIPTION },
  twitter: { images: [OG_DEFAULT_TWITTER_IMAGE], card: "summary_large_image", description: DEMO_DESCRIPTION },
};

/* The copy lives in iconic/copy.ts with the other seven pages. */
const COPY = DEMO_COPY;

/** The four facts about a call. Each one is a thing we actually do. */
const FACTS: Array<[string, string]> = [
  ["20 minutes", "No slide deck. The product, on the parts you asked about."],
  ["Your team", "Bring one to five people. We answer the questions they bring."],
  [
    "The real product",
    flags.sandbox
      ? "A sandbox workspace you can drive yourself afterwards." // copy-gate: sandbox
      : `The eight parts: ${moduleNames.join(", ")}. A sample workspace, not a mock up.`,
  ],
  ["Follow up", "A written summary of what we showed and the price for your seat count."],
];

interface DemoPageProps {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}

export default async function DemoPage({ searchParams }: DemoPageProps) {
  // `topic` lets a page send a visitor here with the first line of their
  // message already written. The form maps it through a closed list, so an
  // unknown value pre-fills nothing.
  const params = await searchParams;
  const raw = params.topic;
  const topic = typeof raw === "string" ? raw : Array.isArray(raw) ? raw[0] : undefined;

  return (
    <Page>
      {/* 1. The claim. */}
      <Band air="hero" labelledBy="demo-h1" still>
        <Eyebrow>{COPY.hero.eyebrow}</Eyebrow>
        <Claim id="demo-h1">{COPY.hero.h1}</Claim>
        <Sub>{COPY.hero.sub}</Sub>
      </Band>

      {/* 2. What a call is. Four rows, no cards, no icon tiles. */}
      <Band ground="quiet" labelledBy="demo-call">
        <Eyebrow>{COPY.call.eyebrow}</Eyebrow>
        <Headline id="demo-call">{COPY.call.h2}</Headline>
        <ul className="ic-rows">
          {FACTS.map(([label, value]) => (
            <li key={label}>
              <span className="ic-rowlabel">{label}</span>
              <span className="ic-rowvalue">{value}</span>
            </li>
          ))}
        </ul>
      </Band>

      {/* 3. The form, and it is the section's one object. */}
      <Band labelledBy="demo-form">
        <Eyebrow>{COPY.form.eyebrow}</Eyebrow>
        <Headline id="demo-form">{COPY.form.h2}</Headline>
        <Line>{COPY.form.line}</Line>
        <div className="ic-form">
          {/* The form is a client component because it has to tell the truth
              about whether the message was sent, which needs a response. See
              the note at the top of demo-form.tsx. */}
          <DemoForm topic={topic} />
        </div>
      </Band>

      {/* 4. One line, one button, and it is the OTHER door: the page is the
          demo door, so a second button pointing back at /demo would be the
          page offering itself.
          GHOST, NOT FILLED, and this page is the one place on the site where
          that matters. The form's own submit is a filled blue, and measured
          at 390 the two sat 453px apart: inside one 844px viewport, which is
          two blues on one screen. The page's filled blue is the button that
          sends the request, and this is the quieter door beside it. Same
          destination, same label, same measurement id. */}
      <Band air="wide" ground="quiet" labelledBy="demo-close">
        <Headline id="demo-close">{COPY.close.h2}</Headline>
        <Line>{COPY.close.line}</Line>
        <div className="ic-cta">
          <PrimaryCta placement="demo-close" variant="ghost" />
        </div>
      </Band>
    </Page>
  );
}
