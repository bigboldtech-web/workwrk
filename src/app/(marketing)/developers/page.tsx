// /developers, rewritten against the repository.
//
// The old page sold a product that does not exist: a GraphQL endpoint
// (there is no GraphQL anywhere in this codebase), type safe SDKs in
// TypeScript, Python and Go published under an MIT licence on a GitHub
// organisation, an interactive documentation playground, and rate limits of
// "1000 req/min on Growth, 10,000 on Scale" against a schema whose defaults
// are 120 a minute and 50,000 a day and are not plan aware at all. It also
// printed three code samples against endpoints and payload shapes the API
// does not serve.
//
// What is real: a v1 REST API over eight resources, an OpenAPI 3.1
// document generated from the running app, API keys with three scopes and a
// per-key rate limiter, and a signed outbound webhook on a handful
// of events. That is a smaller page, and it is one an engineer can act on
// without finding out on day two.

import type { Metadata } from "next";

import { mailboxes } from "@/components/marketing/config";
import { Band, Claim, Close, Eyebrow, Headline, Line, Note, Page, Stack, Sub } from "@/components/marketing/iconic/iconic";
import { OG_DEFAULT_IMAGE, OG_DEFAULT_TWITTER_IMAGE } from "@/components/marketing/og";

export const metadata: Metadata = {
  title: "Developers",
  description:
    "A v1 REST API over eight resources, an OpenAPI 3.1 document, scoped API keys and a per-key rate limiter. No GraphQL and no SDKs, and this page says so.",
  alternates: { canonical: "https://workwrk.com/developers" },
  openGraph: {
    images: [OG_DEFAULT_IMAGE],
    title: "Developers",
    description: "A v1 REST API, an OpenAPI document, scoped keys. The real surface, including its edges.",
  },
  // The root layout's twitter:description still reads "Replaces 15 tools",
  // which collides with the fourteen this site counts everywhere else.
  twitter: { images: [OG_DEFAULT_TWITTER_IMAGE], card: "summary_large_image", description: "A v1 REST API, an OpenAPI document, scoped keys. The real surface, including its edges." },
};

/** The v1 resources, from src/app/api/v1. */
const RESOURCES: readonly [string, string][] = [
  ["/api/v1/people", "The directory: a person with their role, department and manager."],
  ["/api/v1/tasks", "Work items, with their status, owner, dates and links."],
  ["/api/v1/sops", "Processes, with their kind, version and acknowledgement state."],
  ["/api/v1/kras", "Result areas, with their weight and the role that owns them."],
  ["/api/v1/kpis", "Measures, with their target, unit and direction."],
  ["/api/v1/kpi-records", "Readings against a period. This is the write path for a measure."],
  ["/api/v1/kudos", "Recognitions, with the value each one names."],
  ["/api/v1/openapi.json", "The OpenAPI 3.1 document for everything above, generated from the running app."],
];

const FACTS: readonly { title: string; body: string }[] = [
  {
    title: "Keys, with three scopes",
    body: "Read, write and admin. A key is shown once at creation and stored only as a hash, with the first twelve characters kept so you can tell two keys apart in a list.",
  },
  {
    title: "Rate limits you can read",
    // THE WINDOW IS FIXED, AND THE PAGE NOW SAYS SO. This line used to read
    // "a rolling window rather than a fixed bucket", which is the opposite of
    // what src/lib/api-auth.ts does: it keys a bucket on the calendar minute
    // (now.toISOString().slice(0, 16)) and the calendar day, and computes
    // retryAfter as 60 minus the current second, which only makes sense for a
    // fixed bucket. An engineer sizing burst behaviour against the old
    // sentence would have designed for 120 in any 60 seconds and got 240
    // across a minute boundary. The numbers themselves are right, from
    // prisma/schema.prisma.
    body: "120 requests a minute and 50,000 a day per key by default, counted in fixed calendar minute and calendar day buckets, so a burst can straddle a boundary. They are per key and adjustable, not a plan tier.",
  },
  {
    title: "A signed webhook, on some events",
    body: "An outbound POST with an HMAC signature header, on a handful of events including a review finalising, a process changing and an invitation going out. It is not an event bus over every entity.",
  },
  {
    title: "CSV, both directions",
    body: "Import into a table from a spreadsheet, and export activity, compliance, people, reviews and the whole of your own data.",
  },
  {
    title: "No GraphQL",
    body: "There is no GraphQL endpoint. If you need one, say so and it goes on the roadmap where you can see it.",
  },
  {
    title: "No published SDKs",
    body: "There is no client library in any language. Generate one from the OpenAPI document, which is the reason that document is served.",
  },
];

export default function DevelopersPage() {
  return (
    <Page>
      <Band air="hero" labelledBy="dev-h1" still>
        <Eyebrow>Developers</Eyebrow>
        <Claim id="dev-h1">A small API, described accurately.</Claim>
        <Sub>Everything this page does not list does not exist, which is the part of an API page that usually costs somebody a week.</Sub>
      </Band>

      {/* The surface. A reference table is the one dense object this sheet
          allows, for the reason /pricing gives: an engineer reads it row by
          row, which is the opposite of skimming, so it gets its own screen
          and the air around it rather than a smaller size. */}
      <Band ground="quiet" labelledBy="dev-res">
        <Eyebrow>Reference</Eyebrow>
        <Headline id="dev-res">The whole v1 surface.</Headline>
        <Line>Eight resources over REST, and an OpenAPI document you can generate a client from.</Line>
        <div className="ic-matrix" tabIndex={0} role="group" aria-label="The v1 resources">
          <table>
            <thead>
              <tr>
                <th scope="col">Path</th>
                <th scope="col">What it is</th>
              </tr>
            </thead>
            <tbody>
              {RESOURCES.map(([path, body]) => (
                <tr key={path}>
                  <th scope="row">
                    <code>{path}</code>
                  </th>
                  <td style={{ textAlign: "start" }}>{body}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <Note>
          <a className="ic-a mk-focus" href="/api/v1/openapi.json" data-cta="developers-openapi">
            Read the OpenAPI document
          </a>
          . Keys are created in workspace settings by an admin.
        </Note>
      </Band>

      <Band labelledBy="dev-facts">
        <Eyebrow>Limits</Eyebrow>
        <Headline id="dev-facts">What to design around.</Headline>
        <Stack items={FACTS} />
        <Note>
          Building something and hitting an edge? Write to{" "}
          <a className="ic-a mk-focus" href={`mailto:${mailboxes.general}`}>
            {mailboxes.general}
          </a>
          .
        </Note>
      </Band>

      <Close headline="Get a key and try it." placement="developers-close" />
    </Page>
  );
}
