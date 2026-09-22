// /pricing, rebuilt on the iconic sheet.
//
// THE ARGUMENT OF THE PAGE IS THE NUMBER, and it still is: the price is the
// loudest thing in each plan. What has changed since this note was written
// is that the plans are bordered CARDS again, with the recommended one
// marked by a border and a filled button. That is the category's pattern
// (ClickUp, Asana, monday.com), it is the register the founder asked for,
// and it is the same three card shape the rebuilt home page uses, so the
// two pages read as one site. The six currency pills are still six words,
// and the notes under the tier grid are still one line.
//
// WHAT IS UNCHANGED, and must stay unchanged: every commercial fact on this
// page is READ from the pricing source or from the constant the server
// enforces. Not one price, seat cap, SOP allowance or AI allowance is typed
// into this file. The comparison matrix is still gated row by row on the
// flags and on the storyboard's own truth gates, so a capability that has
// not shipped cannot get a tick by somebody being in a hurry, and a support
// or connector commitment cannot appear because a column looked empty.
//
// WHAT CHANGED BESIDES THE STYLE:
//
//   The dead link is fixed. The page carried "Tap what you pay on the home
//   page" pointing at /#stack-receipt, and the home page rebuild removed the
//   calculator and that anchor with it. The calculator lives at
//   /compare/your-stack, so that is where the line points.
//
//   `YourReceipt` is off this page for the same reason. It read a receipt
//   the home page no longer writes and rendered it above the hero, so on the
//   rare visit where it fired it put a bordered card above the page's own
//   claim. A shared receipt still unfurls and still renders, because that
//   link is a promise somebody made when they copied it.
//
//   The two "add on" style notes under the cards are gone: every plan
//   includes email support and export, which is a fact that belongs in the
//   matrix, and the matrix has it.

import Link from "next/link";
import type { Metadata } from "next";

import { MarketingCta, PrimaryCta } from "@/components/marketing/cta";
import { flags, moduleNames, tierCta, tierCtaIsPrimary } from "@/components/marketing/config";
import {
  pricing,
  isMarketingCurrency,
  softwareApplicationJsonLd,
  stackReceipt,
  starterSeatCap,
  tier,
} from "@/components/marketing/data/pricing";
import { detectCurrency } from "@/components/marketing/geo";
import { PRICING_COPY } from "@/components/marketing/iconic/copy";
import { Band, Claim, Eyebrow, Headline, Line, Note, Obj, Page, Sub } from "@/components/marketing/iconic/iconic";
import { IconicPlans } from "@/components/marketing/iconic/plans.client";
import { PricingCurrencyProvider } from "@/components/marketing/pricing-currency.client";
import { Receipt } from "@/components/marketing/receipt/receipt";
import {
  parseReceiptQuery,
  stackReceiptModelFrom,
  receiptShareQuery,
} from "@/components/marketing/receipt/receipt-model";
import { stopShipped } from "@/components/marketing/data/tuesday";
// The enforced limits, straight from the constant the server reads. It is a
// pure object with zero imports, so a page can read it without pulling
// prisma in behind it.
import { PLAN_LIMITS } from "@/lib/plan-limits-data";

const SITE = "https://workwrk.com";
const STARTER = tier("starter");
const GROWTH = tier("growth");
const SCALE = tier("scale");
const SCALE_FROM = GROWTH.seatCap + 1;
const PRICING_DESCRIPTION = `Free up to ${starterSeatCap} people, then one price per person per month. Three plans: ${STARTER.name}, ${GROWTH.name}, ${SCALE.name}.`;

/* The copy lives in iconic/copy.ts with the other seven pages. */
const COPY = PRICING_COPY;

/**
 * The comparison table, with every row either shipped or behind a flag.
 *
 * The module rows are read from the same eight blocks the rail and the tour
 * read, so a ninth cannot appear here alone, and the two premium modules are
 * the two the price list puts on a tier.
 */
type CompareValue = boolean | string;

/**
 * The AI allowance, read from the constant the server enforces.
 *
 * THE PAGE'S PROMISE IS THAT THE ARITHMETIC IS PLAIN, and this was the one
 * enforced limit it did not disclose. src/lib/plan-limits.ts refuses the
 * next Ask at `current >= limit` counted from `org._count.aiQueries`, and
 * that count has NO period filter: it is a lifetime total, so a free
 * workspace's Ask stops permanently at 50. Read from PLAN_LIMITS rather
 * than typed into the pricing JSON for the same reason the seat cap is: a
 * number on this page has to be the number the server checks.
 */
const AI_CAP = {
  starter: PLAN_LIMITS.STARTER.ai,
  growth: PLAN_LIMITS.GROWTH.ai,
  scale: PLAN_LIMITS.SCALE.ai,
} as const;

/** "50" or "2,000", in the page's own locale-free grouping. */
function cap(n: number): string {
  return n.toLocaleString("en-US");
}

const MODULE_ROWS: Array<[string, CompareValue, CompareValue, CompareValue]> = moduleNames.map((name) => {
  const premium = pricing.premiumModules.find((m) => m.name === name);
  if (name === "AI") {
    // Not a tick. The allowance is a number per tier and it is a total, not
    // a monthly refill, so the row says so in the row.
    return [
      "AI (questions in total, not per month)",
      `${cap(AI_CAP.starter)}`,
      `${cap(AI_CAP.growth)}`,
      `${cap(AI_CAP.scale)}`,
    ];
  }
  return premium ? [name, false, true, true] : [name, true, true, true];
});

const COMPARE_GROUPS: Array<{ name: string; rows: Array<[string, CompareValue, CompareValue, CompareValue]> }> = [
  { name: "The eight parts", rows: MODULE_ROWS },
  {
    // The SOP allowance is NOT a row here: it is a number per tier, it
    // lives in each tier's own bullets in the pricing source, and a yes/no
    // column would have to invent one.
    name: "Process and goals",
    rows: [
      ["Roles, KRAs and KPIs", true, true, true],
      ["Reviews, kudos and surveys", false, true, true],
    ],
  },
  {
    name: "AI",
    // "Ask, across everything you can see" was wrong in the risky
    // direction, which is worse than wrong: the retrieval filters by
    // organizationId and by nothing else, so the Ask reads the whole
    // workspace regardless of who is asking. A buyer choosing this product
    // on the strength of that row would be choosing it for a scoping
    // guarantee that does not exist. It says what the endpoint does.
    //
    // "Answers sourced from the entities they read" is stop 6's declared
    // unbuilt mechanism word for word, so it is gated on the stop.
    rows: [
      ["Ask, across the workspace (not yet scoped per person)", true, true, true],
      ...(stopShipped(6)
        ? ([["Answers sourced from the entities they read", true, true, true]] as Array<
            [string, CompareValue, CompareValue, CompareValue]
          >)
        : []),
      ...(flags.aiPeopleRecommendations
        ? ([
            ["AI promotion and compensation recommendations", false, false, true],
            ["Uncapped AI usage", false, "Capped", true],
          ] as Array<[string, CompareValue, CompareValue, CompareValue]>)
        : []),
    ],
  },
  ...(flags.thirdPartyIntegrations
    ? [
        {
          name: "Integrations",
          rows: [
            ["Slack and Google Workspace", false, true, true], // copy-gate: thirdPartyIntegrations
            ["Microsoft 365 and Teams", false, true, true], // copy-gate: thirdPartyIntegrations
            ["Webhook events", false, true, true], // copy-gate: thirdPartyIntegrations
          ] as Array<[string, CompareValue, CompareValue, CompareValue]>,
        },
      ]
    : []),
  {
    name: "Admin and security",
    rows: [
      ["Two step verification at login", true, true, true],
      ["Roles, scopes and per-space visibility", true, true, true],
      // Nothing in the product gates either of these by plan: /api/audit
      // checks isManager and no plan, /api/me/security-activity is per user
      // and ungated, and src/lib/plan-limits.ts knows about users, sops and
      // AI queries and nothing else. So they are capabilities every tier
      // has, and the matrix says so rather than inventing a ladder.
      ["Security activity log", true, true, true],
      ["Audit log for managers", true, true, true],
      ...(flags.enterpriseIdentity
        ? ([["SSO via Google or Microsoft", false, true, true]] as Array<
            [string, CompareValue, CompareValue, CompareValue]
          >)
        : []),
    ],
  },
  {
    name: "Support and data",
    // "Priority support" and "Named contact" came off this group and have
    // not come back. Nothing in this repo gates support by plan: there is no
    // ticketing system, no queue with a priority field and no account
    // assignment. A procurement team reads a tick in a matrix as a
    // commitment, and a support commitment is the one a customer escalates
    // on. They return the day a support tier exists, with a response time
    // beside each one, which is what the tick was standing in for.
    rows: [
      ["Email support", true, true, true],
      ["Export everything, any time", true, true, true],
    ],
  },
];

/** The pricing FAQ. Every answer is checkable against this repo. */
const FAQ: Array<{ q: string; a: string }> = [
  {
    q: "Is the free plan really forever?",
    a: `Yes. Up to ${starterSeatCap} people, no time limit, no card. There is no 14 day clock pressuring you to pay before you have decided.`,
  },
  {
    q: "How does per-user billing work?",
    a: `${GROWTH.name} is priced per member per month, billed annually. A member is anyone with an account on the workspace: the seat count the product enforces is the number of people in it, so that is the number the price is built on.`,
  },
  {
    q: "Which currencies do you price in?",
    a: `Prices are authored per currency in ${pricing.currencies
      .map((c) => c.code)
      .join(", ")}, not converted from a stale exchange rate, so the number you see is the number you pay. The switch above the plans changes them.`,
  },
  {
    q: `What happens above ${GROWTH.seatCap} people?`,
    a: `${SCALE.name} is quoted rather than listed, because at that size the answer depends on how many workspaces, how much history you are bringing and which modules you turn on. From ${SCALE_FROM} people, talk to sales.`,
  },
  {
    q: "Can we leave, and take our data?",
    a: "Yes, on every tier including the free one. Export is available any time, and deleted items sit in a trash window before they go.",
  },
  {
    q: "Are Talk and Tables extra?",
    a: `No. They are included from ${pricing.tiers.find((t) => t.id === pricing.premiumModules[0]?.fromTier)?.name ?? GROWTH.name} at no surcharge. There is no per-module pricing.`,
  },
];

interface PricingPageProps {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}

function toParams(raw: Record<string, string | string[] | undefined>): URLSearchParams {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(raw)) {
    if (typeof value === "string") params.set(key, value);
    else if (Array.isArray(value) && value[0]) params.set(key, value[0]);
  }
  return params;
}

export async function generateMetadata({ searchParams }: PricingPageProps): Promise<Metadata> {
  const shared = parseReceiptQuery(toParams(await searchParams));
  // A shared receipt unfurls as THAT receipt, from the route that already
  // renders it, rather than as the site's generic card.
  const image =
    shared.selected.length > 0
      ? `/api/og/receipt?${receiptShareQuery({
          selected: shared.selected,
          seats: shared.seats,
          currency: shared.currency,
          overrides: shared.overrides,
        })}`
      : "/opengraph-image";
  return {
    title: "Pricing",
    description: PRICING_DESCRIPTION,
    alternates: { canonical: `${SITE}/pricing` },
    openGraph: { images: [{ url: image, width: 1200, height: 630 }] },
    twitter: { card: "summary_large_image", images: [{ url: image }] },
  };
}

function Cell({ value }: { value: CompareValue }) {
  if (value === true) {
    return (
      <span className="ic-yes" aria-label="Included">
        Yes
      </span>
    );
  }
  if (value === false) {
    return (
      <span className="ic-no" aria-label="Not included">
        No
      </span>
    );
  }
  // A STRING IS AN ALLOWANCE, NOT A REFUSAL, and it used to fall through to
  // the "No" class. The AI row's real entitlements therefore painted as
  // 50 / 500 / 2,000 in the same grey as the noes beside them, so a reader
  // scanning the column read three escalating allowances as three gaps.
  return <span className="ic-val">{value}</span>;
}

export default async function PricingPage({ searchParams }: PricingPageProps) {
  const params = toParams(await searchParams);
  const shared = parseReceiptQuery(params);
  // Precedence: an explicit ?currency= the visitor chose and shared, then a
  // shared receipt's own currency, then the geo guess. The switch writes
  // that parameter with replaceState, so a reload keeps the choice instead
  // of snapping back to whatever the edge header says.
  const chosen = params.get("currency");
  const currency =
    chosen && isMarketingCurrency(chosen)
      ? chosen
      : shared.selected.length > 0
        ? shared.currency
        : await detectCurrency();
  const sharedReceipt =
    shared.selected.length > 0
      ? stackReceiptModelFrom(
          stackReceipt({
            selected: shared.selected,
            seats: shared.seats,
            currency: shared.currency,
            // The prices the sharer corrected, so this page shows the
            // receipt they copied and not the list prices they had just
            // edited away.
            overrides: shared.overrides,
          }),
        )
      : null;

  // The offers graph, from the pricing source, and the FAQ graph from the
  // FAQ this page renders. Both are mapped from the same constants the page
  // shows, so the structured answer and the visible answer are one string
  // and cannot drift into the mismatch that gets a rich result withdrawn.
  // `@context` comes off the node: the graph declares it once, and a node
  // repeating it is noise in the one document a crawler reads literally.
  const software = { ...softwareApplicationJsonLd(currency, SITE) } as Record<string, unknown>;
  delete software["@context"];
  const jsonLd = {
    "@context": "https://schema.org",
    "@graph": [
      software,
      {
        "@type": "FAQPage",
        mainEntity: FAQ.map((entry) => ({
          "@type": "Question",
          name: entry.q,
          acceptedAnswer: { "@type": "Answer", text: entry.a },
        })),
      },
    ],
  };

  // THE RECOMMENDED PLAN'S BUTTON IS FILLED AGAIN.
  //
  // This was ghost, and the note that made it ghost said why: "`TierCta`
  // fills the recommended plan, which was right on a page of three bordered
  // cards competing for the eye". The cards had been taken away at the time,
  // so the fill had nothing to anchor and read as a loose blue button on a
  // list.
  //
  // The cards are back (see plans.client.tsx), which restores exactly the
  // condition that note names, and a filled button on the recommended card
  // is the category's own pattern: the rebuilt home page's price strip does
  // the same thing.
  //
  // The "two blues" worry does not apply. The plans and the closing band are
  // a long way apart on this page and are never on screen together, so the
  // rule being protected, one filled button per VIEWPORT, still holds.
  const tierCtas: Record<string, React.ReactNode> = Object.fromEntries(
    pricing.tiers.map((t) => [
      t.id,
      <MarketingCta
        key={t.id}
        cta={tierCta(t.id, "pricing")}
        variant={tierCtaIsPrimary(t.id) ? "primary" : "ghost"}
      />,
    ]),
  );

  return (
    <Page>
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }} />

      {/* 1. The claim. */}
      <Band air="hero" labelledBy="pricing-h1" still>
        <Eyebrow>{COPY.hero.eyebrow}</Eyebrow>
        <Claim id="pricing-h1">{COPY.hero.h1}</Claim>
        <Sub>{COPY.hero.sub}</Sub>
      </Band>

      {/* 2. The plans. One object: three rows and the switch above them. */}
      <Band ground="quiet" labelledBy="pricing-plans">
        <Eyebrow>{COPY.plans.eyebrow}</Eyebrow>
        <Headline id="pricing-plans">{COPY.plans.h2}</Headline>
        <PricingCurrencyProvider initialCurrency={currency}>
          <IconicPlans tierCtas={tierCtas} />
        </PricingCurrencyProvider>
      </Band>

      {/* A shared receipt, and only when somebody shared one. The link is a
          promise its sender made, and the card it unfurls as is generated
          from these same numbers, so the page has to render what the card
          showed. */}
      {sharedReceipt ? (
        <Band labelledBy="pricing-shared">
          <Eyebrow>A shared receipt</Eyebrow>
          <Headline id="pricing-shared">Someone priced their stack.</Headline>
          <Line>
            {`${shared.selected.length} ${shared.selected.length === 1 ? "category" : "categories"} at ${shared.seats} seats, in ${shared.currency}.`}
          </Line>
          <Obj>
            <div style={{ margin: "0 auto", maxWidth: 520, textAlign: "start" }}>
              <Receipt model={sharedReceipt} />
            </div>
          </Obj>
        </Band>
      ) : null}

      {/* 3. The matrix. The one dense object on the sheet, and it gets its
          own screen rather than a smaller size: a procurement team reads it
          row by row, which is the opposite of skimming. */}
      <Band labelledBy="pricing-matrix">
        <Eyebrow>{COPY.matrix.eyebrow}</Eyebrow>
        <Headline id="pricing-matrix">{COPY.matrix.h2}</Headline>
        <Line>{COPY.matrix.line}</Line>
        {/* This table scrolls sideways on a phone and holds nothing
            focusable, so without a tabindex and a name a keyboard or switch
            user cannot reach its right hand columns. WCAG 2.1.1. */}
        <div className="ic-matrix" tabIndex={0} role="region" aria-label="What each plan includes, scrolls sideways">
          <table>
            <thead>
              <tr>
                <th scope="col">Capability</th>
                {/* Names only. The price belongs to the plans above, which
                    follow the currency switch; a second copy here is
                    rendered on the server in the server's currency, so the
                    page would print dollars in the table while the plans
                    showed rupees. One number, one place. */}
                {pricing.tiers.map((t) => (
                  <th key={t.id} scope="col">
                    {t.name}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {COMPARE_GROUPS.flatMap((group) => [
                <tr key={`g-${group.name}`} className="ic-group">
                  <th scope="colgroup" colSpan={4}>
                    {group.name}
                  </th>
                </tr>,
                ...group.rows.map(([label, ...values]) => (
                  <tr key={`${group.name}-${String(label)}`}>
                    <th scope="row">{label}</th>
                    {values.map((v, i) => (
                      <td key={i}>
                        <Cell value={v} />
                      </td>
                    ))}
                  </tr>
                )),
              ])}
            </tbody>
          </table>
        </div>
        <Note>
          Comparing against what you pay now?{" "}
          <Link className="ic-a mk-focus" href="/compare/your-stack" data-cta="pricing-your-stack">
            Price your current stack
          </Link>
          .
        </Note>
      </Band>

      {/* 4. The questions. */}
      <Band ground="quiet" labelledBy="pricing-faq">
        <Headline id="pricing-faq">{COPY.questions.h2}</Headline>
        <div className="ic-qa">
          {FAQ.map((entry) => (
            <details key={entry.q}>
              <summary className="mk-focus">{entry.q}</summary>
              <div className="ic-qa__a">
                <p>{entry.a}</p>
              </div>
            </details>
          ))}
        </div>
      </Band>

      {/* 5. One line. One button. The page's only blue. */}
      <Band air="wide" labelledBy="pricing-close">
        <Headline id="pricing-close">{COPY.close.h2}</Headline>
        <div className="ic-cta">
          <PrimaryCta placement="pricing-close" />
        </div>
      </Band>
    </Page>
  );
}
