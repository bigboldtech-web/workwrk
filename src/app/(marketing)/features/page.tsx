// /features, rebuilt on the eight blocks.
//
// The page it replaces was still organised around the OLD seven hub
// taxonomy: Home, People, Work, Money, Talent, Culture, Growth. Three of
// those are not the product. "Money" offered expense approvals, vendor and
// procurement and budgets against actuals; "Growth" offered a sales
// pipeline, Customer 360 and pipeline analytics; and the Money hub's one
// sub-feature card was "Integrations: Slack, Google, Microsoft, Stripe,
// Razorpay, QuickBooks" while `flags.thirdPartyIntegrations` is false.
// WorkwrK is a people and project management system: CRM, finance and
// helpdesk were removed from its scope, so a features page selling them is
// selling three products that do not exist.
//
// What the page is now: the eight blocks the whole site names, read from the
// same fixture the rail, the tour and the comparison table read, each with
// the categories it replaces and the line the Tuesday story gives it. A
// ninth cannot appear here alone, and a block cannot describe itself
// differently here than it does on the home page.
//
// It links to /tuesday, to /pricing and, now, to the twelve module pages
// under /features. Those pages were held back from this hub while they were
// still on the old copy, which left them live, indexable and reachable from
// the footer with nothing pointing at them from the page that owns them.
// They have since been rewritten against the product, so the link list is
// back and the sitemap submits them again. A block card carries its own id
// so "Part of the Work block" on a sub-page lands on the right card.

import type { Metadata } from "next";
import Link from "next/link";

import {
  Band,
  Claim,
  Close,
  Eyebrow,
  Headline,
  Line,
  Obj,
  Page,
  Stack,
  Sub,
} from "@/components/marketing/iconic/iconic";
import { routes } from "@/components/marketing/config";
import { tourLineFor, tuesday } from "@/components/marketing/data/tuesday";
import { CAPABILITY_PAGES, moduleHref } from "@/components/marketing/product/module-page";
import { MarketingShell } from "@/components/marketing/shell/marketing-shell";
import { MkSidebar, MyWorkSurface } from "@/components/marketing/shell/surfaces";
import { OG_DEFAULT_IMAGE, OG_DEFAULT_TWITTER_IMAGE } from "@/components/marketing/og";

const BLOCKS = tuesday.hubs;

/**
 * The twelve capability pages under this one.
 *
 * The list moved to src/components/marketing/product/module-page.ts, where
 * each entry also names the BLOCK that owns it, so a module chapter can list
 * its own and this index can still list all twelve from one array. It was
 * inline here while /features was the only page that linked them; two copies
 * of a page list is one of them keeping a retired page alive.
 */
const SUB_PAGES = CAPABILITY_PAGES;

const FEATURES_DESCRIPTION = `Every capability in WorkwrK, organised by the ${BLOCKS.length} blocks: ${BLOCKS.map((b) => b.label).join(", ")}. One data model underneath all of them.`;

export const metadata: Metadata = {
  title: "Features",
  description: FEATURES_DESCRIPTION,
  alternates: { canonical: "https://workwrk.com/features" },
  // Its own card. This page is the destination of the nav's Product row and
  // was the one rebuilt page with no openGraph or twitter block, so it
  // unfurled with the root layout's retired line: "Replaces 15 tools. Built
  // for Indian SMBs." The site's arithmetic is fourteen everywhere and D25
  // settled the positioning as a people and project management system sold
  // globally, so the wrong number and the wrong geography went out together
  // on the most-shared feature link.
  openGraph: { images: [OG_DEFAULT_IMAGE], title: "Features", description: FEATURES_DESCRIPTION },
  twitter: { images: [OG_DEFAULT_TWITTER_IMAGE], card: "summary_large_image", description: FEATURES_DESCRIPTION },
};

export default function FeaturesPage() {
  return (
    <Page>
      <Band air="hero" labelledBy="feat-h1" still>
        <Eyebrow>Features</Eyebrow>
        <Claim id="feat-h1">{BLOCKS.length} parts, all on one data model</Claim>
        <Sub>
          One task, one role and one goal, referenced by every block instead of copied between them.
        </Sub>
      </Band>

      {/* The product, on the page that sells the blocks. */}
      <Band ground="quiet" labelledBy="feat-shell">
        <Eyebrow>The screen</Eyebrow>
        <Headline id="feat-shell">All {BLOCKS.length} of them on one rail</Headline>
        <Obj>
          <MarketingShell
            hub="work"
            breadcrumb={["Work", "My work"]}
            clock="8:47 AM"
            sidebar={<MkSidebar hub="work" />}
            label="The WorkwrK shell showing Maya's My work list, with the navy rail carrying all eight blocks."
          >
            <MyWorkSurface />
          </MarketingShell>
        </Obj>
      </Band>

      {/* The blocks. It was a three column grid of bordered cards, each with
          a dot, an icon, a "Replaces:" line and a coloured "See X" line. The
          replaces vocabulary belongs on /compare and has been taken off the
          navigation and the module chapters for the same reason: it invites
          the feature by feature comparison this argument was chosen to
          avoid. What a block IS is the line that stays. */}
      <Band labelledBy="feat-blocks">
        <Eyebrow>The blocks</Eyebrow>
        <Headline id="feat-blocks">What each part of the platform does</Headline>
        <Stack
          items={BLOCKS.map((block) => ({
            title: block.label,
            body: block.features,
            href: moduleHref(block.id),
            cta: `features-block-${block.id}`,
          }))}
        />
      </Band>

      <Band ground="quiet" labelledBy="feat-pages">
        <Eyebrow>In detail</Eyebrow>
        <Headline id="feat-pages">One page for every capability</Headline>
        <Line>Each one describes a capability against the product today, including the parts that do not exist yet.</Line>
        <Stack
          items={SUB_PAGES.map((page) => ({
            title: page.label,
            body: page.note,
            href: page.href,
            cta: `features-${page.href.split("/").pop()}`,
          }))}
        />
      </Band>

      <Band labelledBy="feat-day">
        <Eyebrow>The argument</Eyebrow>
        <Headline id="feat-day">A feature list is not the point</Headline>
        <Line>Every block above does exactly one thing to one task on one Tuesday.</Line>
        <ol className="ic-steps">
          {BLOCKS.map((block) => (
            <li key={block.id}>{tourLineFor(block)}</li>
          ))}
        </ol>
        <p className="ic-note">
          <Link className="ic-a mk-focus" href={routes.tuesday} data-cta="features-tuesday">
            Read the whole Tuesday
          </Link>
        </p>
      </Band>

      <Close headline="Open it on your own work." placement="features-close" />
    </Page>
  );
}
