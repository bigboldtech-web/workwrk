// /product: the module tour.
//
// THE ROUTE DID NOT EXIST. There were eight chapters under /product/[module]
// and no index above them, so /product itself fell through to the marketing
// 404 while the navigation's Product menu and the sitemap both pointed into
// the branch. This is the page those eight chapters hang off.
//
// WHAT IT IS, and it is the one idea worth keeping from the rejected
// "open the product" direction: a tab strip over ONE full density surface at
// a time. Eight tiles of eight surfaces is eight thumbnails nobody can read;
// one surface at the size the product actually renders at, with a strip that
// changes which one, is how seven or eight modules get shown without a grid.
//
// THE TABS ARE LINKS, not a client island, and that is deliberate:
//
//   * they work with JavaScript off, so the strip is never a control with no
//     handler, which is the one thing this site does not ship;
//   * every panel has a URL, so a sales mail can point at /product?m=goals;
//   * the page stays a Server Component and renders ONE frame rather than
//     eight, which is also why it is fast.
//
// `scroll={false}` keeps the viewport where it is when the panel changes, so
// switching parts feels like a tab and not like a navigation.
//
// Nothing on this page is a screenshot. Every frame is the marketing lite
// surface library rendering the product's own chrome from the sample
// fixture, at the scale where the product's real 14px stays above its own
// 10px caption floor, whole and legible at first paint.

import type { Metadata } from "next";
import Link from "next/link";

import { PrimaryCta } from "@/components/marketing/cta";
import { tuesday } from "@/components/marketing/data/tuesday";
import { PART_LINE, PRODUCT_COPY } from "@/components/marketing/iconic/copy";
import { Band, Claim, Eyebrow, Headline, Line, Obj, Page, Sub } from "@/components/marketing/iconic/iconic";
import { MODULE_ORDER, isModuleId, moduleHref } from "@/components/marketing/product/module-page";
import { MarketingShell } from "@/components/marketing/shell/marketing-shell";
import { MkSidebar, SURFACES } from "@/components/marketing/shell/surfaces";

const SITE = "https://workwrk.com";

/* The copy lives in iconic/copy.ts with the other seven pages, so the
 * whole site's voice reads in one screen and iconic.test.ts can count the
 * words in every headline and the sentences in every line. */
const COPY = PRODUCT_COPY;

/**
 * Which surface each part shows in the tour, and the crumbs above it.
 *
 * The surface names are the fixture's own, read through the SURFACES
 * registry, so a surface cannot be named here that the shell cannot render.
 *
 * WORK IS THE ONE OVERRIDE, and the registry says why: its default is
 * `my-work` rendered COMPACT, which was chosen for a small scaled frame
 * whose top left corner is the part a visitor reads, and the compact face
 * opens on an empty "Nothing overdue" bucket. This frame is 1,040px wide at
 * a desktop width, so it has the room for the board, and the board is also
 * the surface with an owner on every row, which is the argument.
 */
const TOUR: Record<string, { surface: string; breadcrumb: string[]; label: string }> = {
  work: {
    surface: "board-list",
    breadcrumb: [tuesday.board.space, tuesday.board.name],
    label: "The Onboarding board in a sample workspace, with an owner and a date on every task row.",
  },
  docs: {
    surface: "sop-doc",
    breadcrumb: ["SOPs", tuesday.sop.title],
    label: "A process document in a sample workspace, with an owner on every step and the measure it moves.",
  },
  talk: {
    surface: "talk-thread",
    breadcrumb: ["Channels", tuesday.thread.channel],
    label: "A channel in a sample workspace, with the decision from the thread recorded on the task it changed.",
  },
  tables: {
    surface: "table",
    breadcrumb: ["Tables", tuesday.table.name],
    label: "A table in a sample workspace, with a formula bar and a row written by a form.",
  },
  goals: {
    surface: "goal-detail",
    breadcrumb: ["Q3", tuesday.goal.title],
    label: "A goal in a sample workspace, with its progress ring and the tasks counted under it.",
  },
  teams: {
    surface: "role-page",
    breadcrumb: ["Roles", tuesday.role.title],
    label: "A role page in a sample workspace: who holds the role, the result it owns and the limits of it.",
  },
  planner: {
    surface: "planner-week",
    breadcrumb: ["Planner", "My week"],
    label: "A week in a sample workspace, with the calendar and the time logged against the work.",
  },
  ai: {
    surface: "ask-ai",
    breadcrumb: ["AI", "Ask"],
    label: "The Ask panel in a sample workspace, answering a question about the quarter.",
  },
};

/** The part a visitor is looking at. An unknown parameter opens the first. */
function activeModule(raw: string | string[] | undefined): string {
  const value = typeof raw === "string" ? raw : Array.isArray(raw) ? raw[0] : undefined;
  return value && isModuleId(value) ? value : MODULE_ORDER[0];
}

export const metadata: Metadata = {
  title: "Product",
  description:
    "Every part of WorkwrK on one page: Work, Docs, Talk, Tables, Goals, Teams, Planner and AI, each one a real surface of the same workspace.",
  alternates: { canonical: `${SITE}/product` },
};

interface ProductPageProps {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}

export default async function ProductIndexPage({ searchParams }: ProductPageProps) {
  const params = await searchParams;
  const active = activeModule(params.m);
  const hub = tuesday.hubs.find((h) => h.id === active) ?? tuesday.hubs[0];
  const tour = TOUR[hub.id] ?? TOUR.work;
  const surface = SURFACES[tour.surface] ?? SURFACES.shell;

  return (
    <Page>
      {/* 1. The claim. Type only: the tour below owns the page's first
          object, and two frames in the first two screens is one too many. */}
      <Band air="hero" labelledBy="product-h1" still>
        <Eyebrow>{COPY.hero.eyebrow}</Eyebrow>
        <Claim id="product-h1">{COPY.hero.h1}</Claim>
        <Sub>{COPY.hero.sub}</Sub>
      </Band>

      {/* 2. The tour. The part's name IS the headline, which is what makes
          the strip read as one idea changing rather than eight ideas at
          once. */}
      <Band ground="quiet" labelledBy="product-part">
        <Eyebrow>{COPY.tour.eyebrow}</Eyebrow>

        <nav aria-label="The eight parts">
          <ul className="ic-tabs">
            {MODULE_ORDER.map((id) => {
              const part = tuesday.hubs.find((h) => h.id === id);
              if (!part) return null;
              return (
                <li key={id}>
                  <Link
                    className="ic-tab mk-focus"
                    href={id === MODULE_ORDER[0] ? "/product" : `/product?m=${id}`}
                    scroll={false}
                    aria-current={id === hub.id ? "page" : undefined}
                    data-cta={`product-tab-${id}`}
                  >
                    {part.label}
                  </Link>
                </li>
              );
            })}
          </ul>
        </nav>

        <Headline id="product-part">{hub.label}</Headline>
        <Line>{PART_LINE[hub.id] ?? hub.features}</Line>

        <Obj>
          <MarketingShell hub={hub.id} breadcrumb={tour.breadcrumb} sidebar={<MkSidebar hub={hub.id} />} label={tour.label}>
            {surface()}
          </MarketingShell>
        </Obj>

        <p className="ic-note">
          <Link className="ic-a mk-focus" href={moduleHref(hub.id)} data-cta={`product-chapter-${hub.id}`}>
            Read the {hub.label} page
          </Link>
        </p>
      </Band>

      {/* 3. The chapters. Eight names, nothing under them: the tour above
          has just said what each one is, and a second line here would be the
          same sentence twice. */}
      <Band labelledBy="product-chapters">
        <Eyebrow>{COPY.chapters.eyebrow}</Eyebrow>
        <Headline id="product-chapters">{COPY.chapters.h2}</Headline>
        <ul className="ic-stack">
          {MODULE_ORDER.map((id) => {
            const part = tuesday.hubs.find((h) => h.id === id);
            if (!part) return null;
            return (
              <li key={id}>
                <Link
                  className="ic-stackname mk-focus"
                  href={moduleHref(id)}
                  data-cta={`product-index-${id}`}
                >
                  {part.label}
                </Link>
              </li>
            );
          })}
        </ul>
      </Band>

      {/* 4. One line. One button. The page's only filled element and its
          only blue: every other blue on the page is inside a product frame,
          where the product's own primary belongs. */}
      <Band air="wide" labelledBy="product-close">
        <Headline id="product-close">{COPY.close.h2}</Headline>
        <div className="ic-cta">
          <PrimaryCta placement="product-close" />
        </div>
      </Band>
    </Page>
  );
}
