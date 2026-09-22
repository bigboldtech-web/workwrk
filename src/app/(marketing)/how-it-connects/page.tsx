// /how-it-connects: the spine as an explorable map (marketing-concept.md
// section 5 and section 12 Phase 4 item 17).
//
// Three blocks, in the concept's order:
//
//   1. the map: twelve records on one stage, blue wires as edges, a right
//      pane that says what a record is, what it connects to and where the
//      connection is made, plus a Follow Tuesday toggle that plays the six
//      stops with a step nav;
//   2. "Why one system, not integrations", three paragraphs, naming no
//      connector, because none ships and a connector named on a marketing
//      page is a commitment a buyer quotes back;
//   3. the governance layer for admins: roles, scoped visibility, the audit
//      and security logs.
//
// The page's own door is the demo, pre-filled. Concept 5: "Book a demo from
// this page pre-fills 'Walk me through how it connects'." It is a query
// parameter the demo page reads into the form's message field, so the
// request arrives saying what the visitor wanted, and nothing here needs the
// form to exist on this page.
//
// EVERY CLAIM ON THE MAP IS AN EDGE IN connect-graph.ts, and every edge is
// either a relation this repo has today or a shipped relation plus a second
// sentence, marked "in build", behind the storyboard's truth gate. There is
// no sentence on this page that a gate cannot reach.

import type { Metadata } from "next";
import Link from "next/link";

import { routes } from "@/components/marketing/config";
import { DOT_HEX, tuesday } from "@/components/marketing/data/tuesday";
import {
  CONNECT_NODES,
  mapSurfaceKeys,
  nodeBlockLabel,
  nodeDot,
  nodeModuleHref,
  tourSteps,
} from "@/components/marketing/connect/connect-graph";
import { ConnectMap, type MapNodeView } from "@/components/marketing/connect/connect-map.client";
import { MarketingShell } from "@/components/marketing/shell/marketing-shell";
import { MkSidebar, SURFACES } from "@/components/marketing/shell/surfaces";
import { Band, Claim, Close, Eyebrow, Headline, Line, Note, Page, Stack, Sub } from "@/components/marketing/iconic/iconic";
import "./connects.css";
import { OG_DEFAULT_IMAGE, OG_DEFAULT_TWITTER_IMAGE } from "@/components/marketing/og";

const SITE = "https://workwrk.com";

const DESCRIPTION =
  "The twelve records WorkwrK runs on, and every wire between them: the role, the KRA, the KPI, the SOP, the task, the doc, the channel, the table row, the goal, the review. What is connected today, and what is still in build.";

export const metadata: Metadata = {
  title: "How it connects",
  description: DESCRIPTION,
  alternates: { canonical: `${SITE}/how-it-connects` },
  openGraph: { images: [OG_DEFAULT_IMAGE], title: "How it connects", description: DESCRIPTION },
  twitter: { images: [OG_DEFAULT_TWITTER_IMAGE], card: "summary_large_image", description: DESCRIPTION },
};

/**
 * The three paragraphs. They name no vendor and no connector, which is the
 * integrations strategy stated plainly rather than sold around: connectors
 * are demand driven, none ships, and the honest argument for one system is
 * that a connector cannot carry the thing this page is about.
 */
const WHY: Array<{ title: string; body: string }> = [
  {
    title: "An integration copies a record. It does not share one.",
    body: "Two tools joined by a connector hold two copies of the same thing and a job that reconciles them. The copy is behind by however long the job takes, and the moment either side is edited by hand the two disagree with nobody being told. Everything on the map above is one record with one id, read by every block that needs it.",
  },
  {
    title: "The connection a stack cannot make is the one you want.",
    body: "A connector can post a message when a task changes. It cannot make the process that produced the task, the role accountable for it and the goal it moves the same objects, because those live in four products that each model them differently. That is the gap the map is drawing, and it is the gap a monthly reconciliation meeting exists to close.",
  },
  {
    title: "So we build the blocks, and connectors when someone needs one.",
    body: "No third party connector ships today, and this page will name one when it does rather than promise a directory of them. What is here instead is the part that cannot be added later: one data model, so a record moves once and every block that reads it is already current.",
  },
];

/**
 * The governance block. Every row is a control this repo has, in the words
 * /features/access uses for the same thing, so the two pages cannot drift.
 */
const GOVERNANCE: Array<{ title: string; body: string }> = [
  {
    title: "One ladder, then grants",
    body: "Every person holds one workspace level. On top of it, a Space, a Folder, a List, a Board or a Doc can be shared directly. A grant only ever adds reach, so the answer to who can open this is the strongest thing the person holds.",
  },
  {
    title: "Scoped visibility",
    body: "An admin can narrow what a level sees rather than only widen it, per Space and per object, and assigning someone a task grants them that task so work is never invisible to the person doing it.",
  },
  {
    title: "The logs",
    body: "A security activity log on each account (sign-ins, password changes, sign-out everywhere, live sessions) and an org-wide audit view behind the manager gate.",
  },
  {
    title: "Sign-in hardening",
    body: "Two step verification at login, lockout after repeated failures, hashed reset tokens, a password policy, idle session expiry, and a sign-out that actually invalidates the token.",
  },
];

export default function HowItConnectsPage() {
  const nodes: MapNodeView[] = CONNECT_NODES.map((node) => ({
    id: node.id,
    label: node.label,
    blockLabel: nodeBlockLabel(node),
    dotHex: DOT_HEX[nodeDot(node)],
    what: node.what,
    surfaceName: node.surfaceName,
    moduleHref: nodeModuleHref(node),
    moduleLabel: nodeBlockLabel(node),
    surfaceKey: node.surface,
  }));

  // One frame per distinct surface, rendered here on the server. The island
  // reveals one and hides the rest, so choosing a record is instant and the
  // Tuesday fixture never enters the browser bundle.
  const frames = Object.fromEntries(
    mapSurfaceKeys().map((key) => {
      const owner = CONNECT_NODES.find((n) => n.surface === key);
      const hub = owner?.block ?? "work";
      return [
        key,
        <MarketingShell
          key={key}
          hub={hub}
          breadcrumb={[nodeBlockLabel(owner ?? CONNECT_NODES[0])]}
          scale={0.72}
          width={1180}
          height={620}
          sidebar={<MkSidebar hub={hub} />}
          label={`${owner?.surfaceName ?? "The surface"}: where the connection is made.`}
        >
          {SURFACES[key]?.() ?? null}
        </MarketingShell>,
      ];
    }),
  );

  return (
    <Page>
      {/* 1. The claim.
          The lede here was the worst sentence on the site: 56 words across
          two sentences with a colon clause, under a 64px headline. One
          sentence now, and the argument it was making is the band below. */}
      <Band air="hero" labelledBy="hic-h1" still>
        <Eyebrow>How it connects</Eyebrow>
        <Claim id="hic-h1">One data model, drawn out.</Claim>
        <Sub>Every block on this site is made of the same handful of records, and this is all of them.</Sub>
      </Band>

      {/* 2. The map. This page's one object. */}
      <Band ground="quiet" labelledBy="hic-map">
        <Eyebrow>The map</Eyebrow>
        <Headline id="hic-map">Every record, and every wire between them</Headline>
        <Line>
          {CONNECT_NODES.length} records across the {tuesday.hubs.length} blocks, and a solid wire is a relation you
          can open today.
        </Line>
        <div style={{ marginTop: 44, textAlign: "start" }}>
          <ConnectMap nodes={nodes} steps={tourSteps()} frames={frames} />
        </div>
      </Band>

      {/* 3. Why one system. Names, not a three column card grid. */}
      <Band labelledBy="hic-why">
        <Eyebrow>The reason</Eyebrow>
        <Headline id="hic-why">One system, not a pile of integrations</Headline>
        <Stack items={WHY} />
      </Band>

      {/* 4. The administrator's half of the same argument. */}
      <Band ground="quiet" labelledBy="hic-gov">
        <Eyebrow>For whoever signs it off</Eyebrow>
        <Headline id="hic-gov">One model, one place to govern it</Headline>
        <Line>If a record exists once, permission on it is decided once.</Line>
        <Stack items={GOVERNANCE} />
        <Note>
          The{" "}
          <Link className="ic-a mk-focus" href="/features/access">
            access page
          </Link>{" "}
          says what we do not have, in the same words.
        </Note>
      </Band>

      <Band labelledBy="hic-walk">
        <Eyebrow>Or ask</Eyebrow>
        <Headline id="hic-walk">Have it walked through</Headline>
        <Line>
          Book twenty minutes and we will follow one of your own processes from the SOP to the task to the goal, or
          read{" "}
          <Link className="ic-a mk-focus" href={routes.tuesday} data-cta="connects-tuesday">
            the whole Tuesday
          </Link>{" "}
          first.
        </Line>
      </Band>

      <Close headline="Open it and follow one." placement="connects-close" />
    </Page>
  );
}
