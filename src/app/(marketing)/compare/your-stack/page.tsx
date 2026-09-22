// /compare/your-stack: the Stack Receipt landing (marketing-concept.md
// section 5, "A fourth page, /compare/your-stack, is the Stack Receipt
// landing for ads").
//
// It is not a competitor page and it names nobody. It is the home page's
// money section given its own address, so a paid click can land directly on
// the calculator instead of scrolling nine sections to reach it: the
// fourteen category tiles, the seat slider, the receipt, Copy my receipt,
// and the tier cards underneath in the same currency.
//
// It shares ONE component with Home, `MoneyBand`, so the arithmetic, the
// share link, the stored receipt and the escalation above the quoted seat
// cap are the same code in both places. A second calculator written for the
// ad landing is a second set of numbers, and the whole point of the pricing
// source is that there is one.
//
// A shared receipt lands on /pricing rather than here, because that route
// already reads the query and unfurls the sharer's own receipt as its social
// card. This page is the door in, not the door out.

import type { Metadata } from "next";
import Link from "next/link";
import type { ReactNode } from "react";

import { MarketingCta, PrimaryCta } from "@/components/marketing/cta";
import { routes, secondaryCta } from "@/components/marketing/config";
import { pricing } from "@/components/marketing/data/pricing";
import { detectCurrency } from "@/components/marketing/geo";
import { MoneyBand } from "@/components/marketing/home/money-band.client";
import { MkIcon } from "@/components/marketing/shell/marketing-shell";
import { Band, Claim, Eyebrow, Headline, Line, Note, Page, Sub } from "@/components/marketing/iconic/iconic";
import "../compare.css";
import { OG_DEFAULT_IMAGE, OG_DEFAULT_TWITTER_IMAGE } from "@/components/marketing/og";

const SITE = "https://workwrk.com";

const DESCRIPTION = `Add up what your current tools cost per seat, in your own currency, and see what one system would cost instead. ${pricing.categories.length} categories, your seat count, and a receipt you can copy.`;

export const metadata: Metadata = {
  title: "Price your stack",
  description: DESCRIPTION,
  alternates: { canonical: `${SITE}/compare/your-stack` },
  openGraph: { images: [OG_DEFAULT_IMAGE], title: "Price your stack", description: DESCRIPTION },
  twitter: { images: [OG_DEFAULT_TWITTER_IMAGE], card: "summary_large_image", description: DESCRIPTION },
};

export default async function YourStackPage() {
  const currency = await detectCurrency();

  // The fourteen chip glyphs, rendered here on the server and handed to the
  // calculator: Lucide inside a client island would be fourteen more icon
  // components in the browser bundle for pictures that never change.
  const glyphs: Record<string, ReactNode> = Object.fromEntries(
    pricing.categories.map((c) => [c.id, <MkIcon key={c.id} name={c.icon} size={16} />]),
  );


  return (
    <Page>
      <Band air="hero" labelledBy="ys-h1" still>
        <Eyebrow>Price your stack</Eyebrow>
        <Claim id="ys-h1">What are the gaps costing you?</Claim>
        <Sub>
          Tick the categories your team pays for today, set your seat count, and the receipt does the arithmetic in
          your own currency.
        </Sub>
      </Band>

      {/* The calculator is this page's one object, and it is dense for the
          same reason the pricing matrix is: somebody reads it line by line
          and edits it, which is the opposite of skimming. It keeps its own
          sheet; everything around it is the kit. */}
      <MoneyBand
        initialCurrency={currency}
        glyphs={glyphs}
        pricingHref={routes.pricing}
        receiptCta={<PrimaryCta placement="your-stack-receipt" template />}
        escalateCta={
          <MarketingCta
            cta={secondaryCta("your-stack-escalate", { label: "Book a migration call" })}
            variant="primary"
          />
        }
      />

      <Band air="wide" labelledBy="ys-close">
        <Headline id="ys-close">The number is half the argument.</Headline>
        <Line>
          The other half is what the tools cannot do separately: read{" "}
          <Link className="ic-a mk-focus" href={routes.tuesday} data-cta="your-stack-tuesday">
            one Tuesday
          </Link>{" "}
          end to end, or look at{" "}
          <Link className="ic-a mk-focus" href="/how-it-connects" data-cta="your-stack-map">
            the map
          </Link>
          .
        </Line>
        <Note>
          Nothing is submitted and nothing is stored on our side. The receipt is yours, and the copy button puts it on
          your clipboard as a link you can send to whoever signs the invoices.
        </Note>
      </Band>
    </Page>
  );
}
