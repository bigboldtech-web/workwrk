// /product/[module]: the eight module pages (marketing-concept.md section 5
// and section 12 Phase 4 item 16).
//
// "Each page is that module's chapter of the same Tuesday, same cast, same
// clock." That sentence is the whole design, and it is why this file is
// short: every word on the page comes from `module-page.ts`, which reads the
// Tuesday fixture through the gated readers and the pricing source. There is
// no copy in this file that a truth gate cannot reach.
//
// The five sections are the concept's, in its order:
//
//   1. hero: the block's own surface in the navy chrome, the clock at its
//      beat time, the headline in the module's voice
//   2. "What happened at [time]": the beats this block appears in, expanded,
//      each with the real surface beside it
//   3. "What it connects to": the neighbouring blocks, with the wire the
//      storyboard draws between them, plus the Connects to dot row
//   4. the capability pages under /features, in plain rows, with the unbuilt
//      mechanisms hidden behind "Show upcoming features"
//   5. the Replaces strip, the tier row, and the close
//
// The proof slot the concept asks for is section 4's absent sibling: there
// is one real customer quote on this site and it belongs to the home page's
// trust line, so a per module proof slot would have to be invented. It is
// not rendered rather than filled, which is the social proof policy (7.6).
//
// WHAT THIS PAGE DOES NOT REPLACE. The twelve capability pages under
// /features stay exactly where they are and keep their URLs. A chapter of a
// story and a capability list are two different documents for two different
// visitors, and the capability pages carry the detail a buyer checks: every
// view type, column resize and freeze, per list statuses, saved views, bulk
// actions. Section 4 links to them; nothing is folded in and nothing is
// redirected away.

import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";

import { routes } from "@/components/marketing/config";
import { tuesday } from "@/components/marketing/data/tuesday";
import {
  MODULE_ORDER,
  isModuleId,
  moduleChapter,
  moduleDescription,
  moduleHref,
  clockLabel,
  spellCount,
} from "@/components/marketing/product/module-page";
import { MarketingShell } from "@/components/marketing/shell/marketing-shell";
import { MkSidebar, SURFACES } from "@/components/marketing/shell/surfaces";
import {
  Band,
  Claim,
  Close,
  Eyebrow,
  Headline,
  Line,
  Note,
  Obj,
  Page,
  Stack,
  Sub,
  Terms,
} from "@/components/marketing/iconic/iconic";
import "../product.css";
import { OG_DEFAULT_IMAGE, OG_DEFAULT_TWITTER_IMAGE } from "@/components/marketing/og";

const SITE = "https://workwrk.com";

interface ModulePageProps {
  params: Promise<{ module: string }>;
}

/** Eight routes, one per block in the fixture. A ninth cannot appear. */
export function generateStaticParams(): Array<{ module: string }> {
  return MODULE_ORDER.map((module) => ({ module }));
}

export async function generateMetadata({ params }: ModulePageProps): Promise<Metadata> {
  const { module: id } = await params;
  if (!isModuleId(id)) return {};
  const chapter = moduleChapter(id);
  if (!chapter) return {};
  const description = moduleDescription(id);
  const title = `${chapter.hub.label}`;
  return {
    title,
    description,
    alternates: { canonical: `${SITE}${moduleHref(id)}` },
    openGraph: { images: [OG_DEFAULT_IMAGE], title: `${chapter.hub.label}: one block of one system`, description },
    twitter: { images: [OG_DEFAULT_TWITTER_IMAGE], card: "summary_large_image", description },
  };
}

/** The label of a neighbouring block, for a caption. */
function hubLabel(id: string): string {
  return tuesday.hubs.find((h) => h.id === id)?.label ?? id;
}

export default async function ModulePage({ params }: ModulePageProps) {
  const { module: id } = await params;
  if (!isModuleId(id)) notFound();
  const chapter = moduleChapter(id);
  if (!chapter) notFound();

  const { hub } = chapter;
  // hub.features is one sentence of comma separated surface names, which is
  // a run of terms rather than a paragraph, so it is set as one.
  const inside = hub.features
    .split(/[.,]\s*/)
    .map((part) => part.trim())
    .filter(Boolean);

  return (
    <Page>
      {/* 1. The claim. Type only.
          THE "REPLACES" LINE IS GONE FROM HERE, for the reason the site
          navigation lost its eight: the decided argument is a chain of
          ownership, which is a claim a rival cannot say back, whereas a
          replaces line invites the feature by feature comparison the
          direction was chosen to avoid. The vocabulary lives on /compare,
          which is the page that names names on purpose. */}
      <Band air="hero" labelledBy="mod-h1" still>
        <Eyebrow>{hub.label}</Eyebrow>
        <Claim id="mod-h1">{chapter.headline}</Claim>
        <Sub>{chapter.storyLine}</Sub>
      </Band>

      {/* 2. The block itself, in the product's own chrome. */}
      <Band ground="quiet" labelledBy="mod-frame">
        <Eyebrow>The screen</Eyebrow>
        <Headline id="mod-frame">This is the real product surface</Headline>
        <Obj>
          <MarketingShell
            hub={hub.id}
            breadcrumb={[hub.label]}
            clock={chapter.firstClock ? clockLabel(chapter.firstClock) : undefined}
            sidebar={<MkSidebar hub={hub.id} />}
            label={`The ${hub.label} block in the WorkwrK shell: ${chapter.storyLine}`}
          >
            {SURFACES[hub.surface]?.() ?? null}
          </MarketingShell>
        </Obj>
      </Band>

      {/* 3. The chapter: this block's beats of the one Tuesday. ONE BAND PER
          BEAT, because a beat is one idea and the layout it replaces put the
          narration in a column beside its frame, two objects abreast. */}
      {chapter.moments.length > 0 ? (
        <>
          <Band labelledBy="mod-day">
            <Eyebrow>One Tuesday</Eyebrow>
            <Headline id="mod-day">
              {chapter.moments.length === 1
                ? `What happened at ${chapter.firstClock}.`
                : `What happened from ${chapter.firstClock}.`}
            </Headline>
            <Line>The same day the home page tells, read from this block.</Line>
          </Band>

          {chapter.moments.map((moment) => (
            <Band key={moment.n} ground="quiet" labelledBy={`mod-moment-${moment.n}`}>
              <Eyebrow>{moment.clock}</Eyebrow>
              <Headline id={`mod-moment-${moment.n}`}>{moment.headline}</Headline>
              <Line>{moment.narration}</Line>
              <Obj>
                <MarketingShell
                  hub={hub.id}
                  breadcrumb={[hub.label]}
                  clock={clockLabel(moment.clock)}
                  sidebar={<MkSidebar hub={hub.id} />}
                  label={`${hub.label} at ${moment.clock}: ${moment.narration}`}
                >
                  {SURFACES[moment.surface]?.() ?? null}
                </MarketingShell>
              </Obj>
              {moment.withHubs.length > 0 ? (
                <Note>With {moment.withHubs.map(hubLabel).join(" and ")}.</Note>
              ) : null}
            </Band>
          ))}
        </>
      ) : null}

      {/* 4. The wires. */}
      {chapter.neighbours.length > 0 ? (
        <Band labelledBy="mod-connects">
          <Eyebrow>The wires</Eyebrow>
          <Headline id="mod-connects">What {hub.label} connects to</Headline>
          <Line>
            A block is a neighbour here because one stop of Tuesday puts the two of them on the ends of the same wire.
          </Line>
          <Stack
            items={chapter.neighbours.map((n) => ({
              title: `${hub.label} and ${n.label}`,
              body: n.wire,
              href: n.href,
              cta: `product-${id}-wire-${n.id}`,
            }))}
          />
          <Note>
            The whole map, with every node and every edge, is on{" "}
            <Link className="ic-a mk-focus" href="/how-it-connects" data-cta={`product-${id}-map`}>
              how it connects
            </Link>
            .
          </Note>
        </Band>
      ) : null}

      {/* 5. What is in the block, and what is not yet. */}
      <Band ground="quiet" labelledBy="mod-inside">
        <Eyebrow>Inside it</Eyebrow>
        <Headline id="mod-inside">What is inside {hub.label}</Headline>
        <Terms items={inside} />

        {chapter.capabilities.length > 0 ? (
          <Stack
            items={chapter.capabilities.map((cap) => ({
              title: cap.label,
              body: cap.note,
              href: cap.href,
              cta: `product-${id}-cap`,
            }))}
          />
        ) : null}

        {/* The unbuilt half, closed by default and named honestly. Every row
            is a storyboard truth gate that says shipped: false, so the list
            empties itself as the mechanisms land. */}
        {chapter.upcoming.length > 0 ? (
          <details className="ic-qa" style={{ marginTop: 44 }}>
            <summary className="mk-focus">Not built yet</summary>
            <div className="ic-qa__a">
              <p>
                Listed because the story above describes the day they will make possible, and the narration you have
                read is the version that is true today.
              </p>
              {chapter.upcoming.map((item) => (
                <p key={item.stop}>
                  <strong style={{ fontWeight: 600, color: "var(--os-ink)" }}>{item.mechanism}. </strong>
                  {item.status}
                </p>
              ))}
            </div>
          </details>
        ) : null}
      </Band>

      {/* 6. The close. One line, one button. */}
      <Band labelledBy="mod-point">
        <Eyebrow>{chapter.tierLine}</Eyebrow>
        <Headline id="mod-point">The point is what it connects to</Headline>
        <Line>
          {hub.label} is one of {spellCount(tuesday.hubs.length, true)}, and the whole day is at{" "}
          <Link className="ic-a mk-focus" href={routes.tuesday} data-cta={`product-${id}-tuesday`}>
            one Tuesday
          </Link>
          .
        </Line>
      </Band>

      <Close headline="Open it on your own work." placement={`product-${id}-close`} />
    </Page>
  );
}
