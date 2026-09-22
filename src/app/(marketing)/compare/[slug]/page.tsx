// /compare/[slug]: one page per category we are put beside
// (marketing-concept.md section 5 and 12 Phase 4 item 19).
//
// Three of them: /compare/workday, /compare/clickup, /compare/monday. The
// fourth route the concept names, /compare/your-stack, is not a competitor
// page at all (it is the Stack Receipt landing for ads) and has its own file
// beside this one.
//
// Structure, in the concept's order: no logo in the hero, the factual rows
// about US, what this category is bought for and when it is the better
// answer, the connection map lit to show what a stack built on it leaves
// disconnected, then the close.
//
// THE ONE RULE THIS PAGE EXISTS UNDER. It is the only place on the site a
// vendor may be named, and nothing in a competitor's column is a claim about
// their product beyond the category a team buys it for. The "leaves
// disconnected" block is deliberately a statement about a STACK: a work
// management tool is not deficient for having no KRA model, it is a work
// management tool, and the claim is only that the record lives in a
// different product or in nobody's.

import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";

import { routes } from "@/components/marketing/config";
import { DOT_HEX } from "@/components/marketing/data/tuesday";
import { connectNode, nodeBlockLabel, nodeDot } from "@/components/marketing/connect/connect-graph";
import { StaticConnectMap } from "@/components/marketing/connect/static-map";
import { COMPARE_SLUGS, FACTS, compareEntry } from "../data";
import { Band, Claim, Close, Eyebrow, Headline, Line, Note, Page, Sub } from "@/components/marketing/iconic/iconic";
import "../compare.css";
import { OG_DEFAULT_IMAGE, OG_DEFAULT_TWITTER_IMAGE } from "@/components/marketing/og";

const SITE = "https://workwrk.com";

interface ComparePageProps {
  params: Promise<{ slug: string }>;
}

export function generateStaticParams(): Array<{ slug: string }> {
  return COMPARE_SLUGS.map((slug) => ({ slug }));
}

function description(name: string, boughtFor: string): string {
  return `What ${name} is bought for (${boughtFor.toLowerCase().replace(/\.$/, "")}), what WorkwrK does instead, and the case where ${name} is the better answer. Factual rows, no logos, and every row about us is checkable by opening ours.`;
}

export async function generateMetadata({ params }: ComparePageProps): Promise<Metadata> {
  const { slug } = await params;
  const entry = compareEntry(slug);
  if (!entry) return {};
  const desc = description(entry.name, entry.boughtFor);
  return {
    title: `WorkwrK and ${entry.name}`,
    description: desc,
    alternates: { canonical: `${SITE}/compare/${slug}` },
    openGraph: { images: [OG_DEFAULT_IMAGE], title: `WorkwrK and ${entry.name}`, description: desc },
    twitter: { images: [OG_DEFAULT_TWITTER_IMAGE], card: "summary_large_image", description: desc },
  };
}

export default async function CompareSlugPage({ params }: ComparePageProps) {
  const { slug } = await params;
  const entry = compareEntry(slug);
  if (!entry) notFound();

  const missing = entry.disconnected
    .map((id) => connectNode(id))
    .filter((n): n is NonNullable<typeof n> => Boolean(n));

  return (
    <Page>
      {/* No logo, no mark, no colour borrowed from anyone. A name set in our
          own type is nominative use; a logo is not. */}
      <Band air="hero" labelledBy="cs-h1" still>
        <Eyebrow>Compare</Eyebrow>
        <Claim id="cs-h1">WorkwrK and {entry.name}</Claim>
        <Sub>Bought for {entry.boughtFor}.</Sub>
        <Note>
          We are not going to summarise someone else&apos;s product for you in a tick box. What follows is what we
          are, what this category is for, and the case where it beats us.
        </Note>
      </Band>

      <Band ground="quiet" labelledBy="cs-ours">
        <Eyebrow>Our answer</Eyebrow>
        <Headline id="cs-ours">What we do instead</Headline>
        <Line>{entry.ours}</Line>
      </Band>

      <Band labelledBy="cs-facts">
        <Eyebrow>On the record</Eyebrow>
        <Headline id="cs-facts">The facts about us.</Headline>
        <Line>Every row is checkable by opening the product or the price list.</Line>
        <div className="ic-matrix" tabIndex={0} role="group" aria-label="The facts about us">
          <table>
            <tbody>
              {FACTS.map(([label, value]) => (
                <tr key={label}>
                  <th scope="row" style={{ width: "34%" }}>
                    {label}
                  </th>
                  <td style={{ textAlign: "start" }}>{value}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Band>

      <Band ground="quiet" air="wide" labelledBy="cs-when">
        <Eyebrow>Their case</Eyebrow>
        <Headline id="cs-when">When {entry.name} is the better answer</Headline>
        <Line>{entry.theirs}</Line>
      </Band>

      {/* The map, lit. The picture is the SAME graph as /how-it-connects, at
          rest, drawn by a server component with no controls. The list under
          it carries every record in words and is what a screen reader and a
          phone get. */}
      <Band labelledBy="cs-gap">
        <Eyebrow>The gap</Eyebrow>
        <Headline id="cs-gap">What it leaves disconnected.</Headline>
        <Line>{entry.disconnectedLede}</Line>
        <div style={{ marginTop: 44, textAlign: "start" }}>
          <StaticConnectMap
            litNodeIds={missing.map((n) => n.id)}
            dotFor={(id) => {
              const node = connectNode(id);
              return node ? DOT_HEX[nodeDot(node)] : DOT_HEX.blue;
            }}
            labelFor={(id) => connectNode(id)?.label ?? id}
            blockFor={(id) => {
              const node = connectNode(id);
              return node ? nodeBlockLabel(node) : "";
            }}
            caption={`Lit: the ${missing.length} records a stack built on ${entry.name} leaves to a person to carry. Dim: the rest of the same map.`}
          />
          <ul className="mk-cs-gaps">
            {missing.map((node) => (
              <li key={node.id} className="mk-cs-gap">
                <span
                  className="mk-cs-gap__dot"
                  style={{ background: DOT_HEX[nodeDot(node)] }}
                  aria-hidden="true"
                />
                <span className="mk-cs-gap__name">{node.label}</span>
                <span className="mk-cs-gap__block">{nodeBlockLabel(node)}</span>
                <span className="mk-cs-gap__what">{node.what}</span>
              </li>
            ))}
          </ul>
        </div>
        <Note>
          Every one of those is a record here, wired to the rest.{" "}
          <Link className="ic-a mk-focus" href="/how-it-connects" data-cta={`compare-${slug}-map`}>
            See the whole map
          </Link>
          .
        </Note>
      </Band>

      <Band ground="quiet" labelledBy="cs-tuesday">
        <Eyebrow>The test</Eyebrow>
        <Headline id="cs-tuesday">See the difference on one real day</Headline>
        <Line>
          Run one real process end to end in ours and see whether the trail it leaves is worth the move:{" "}
          <Link className="ic-a mk-focus" href={routes.tuesday} data-cta={`compare-${slug}-tuesday`}>
            read one first
          </Link>
          , or price your current stack on{" "}
          <Link className="ic-a mk-focus" href="/compare/your-stack" data-cta={`compare-${slug}-stack`}>
            your stack
          </Link>
          .
        </Line>
      </Band>

      <Close headline="Run one process in ours." placement={`compare-${slug}-close`} />
    </Page>
  );
}
