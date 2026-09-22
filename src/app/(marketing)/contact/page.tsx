// /contact, rewritten down to what is true.
//
// What was here: five mailboxes (sales, support, press, partners, security)
// of which two are in the site's own mailbox list, a "we respond within 4
// business hours" commitment on one and a 24 hour commitment on another
// with no status page or support rota behind either, "PGP available" with no
// key published, and three office addresses in Bengaluru, Dubai and
// Singapore, given down to the floor, for a company that does not have them.
//
// The site has two mailboxes, in src/components/marketing/config.ts, and
// this page hands out those two.

import type { Metadata } from "next";

import { mailboxes, routes } from "@/components/marketing/config";
import { Band, Claim, Close, Eyebrow, Headline, Page, Stack, Sub } from "@/components/marketing/iconic/iconic";
import { OG_DEFAULT_IMAGE, OG_DEFAULT_TWITTER_IMAGE } from "@/components/marketing/og";

export const metadata: Metadata = {
  title: "Contact",
  description:
    "Two mailboxes and a demo form. No published response time, because there is no status page to be held to, and no office addresses we do not have.",
  alternates: { canonical: "https://workwrk.com/contact" },
  openGraph: {
    images: [OG_DEFAULT_IMAGE],
    title: "Contact",
    description: "Two mailboxes and a demo form. No commitments we cannot keep.",
  },
  // The root layout's twitter:description still reads "Replaces 15 tools",
  // which collides with the fourteen this site counts everywhere else.
  twitter: { images: [OG_DEFAULT_TWITTER_IMAGE], card: "summary_large_image", description: "Two mailboxes and a demo form. No commitments we cannot keep." },
};

export default function ContactPage() {
  return (
    <Page>
      <Band air="hero" labelledBy="contact-h1" still>
        <Eyebrow>Contact</Eyebrow>
        <Claim id="contact-h1">Two addresses and a form.</Claim>
        <Sub>
          We read everything that arrives, and we will not publish a response time we have nothing to be held to on.
        </Sub>
      </Band>

      {/* The three doors. The address IS the name, which is the thing a
          visitor came for, so it is set at display size rather than buried
          in the third paragraph of a bordered card. */}
      <Band ground="quiet" labelledBy="contact-ways">
        <Eyebrow>Three doors</Eyebrow>
        <Headline id="contact-ways">Which one to use.</Headline>
        <Stack
          items={[
            {
              title: mailboxes.general,
              body: "Product questions, a problem with an account, a bug, a security report, or telling us the site is wrong about something.",
              href: `mailto:${mailboxes.general}`,
              cta: "contact-general",
            },
            {
              title: mailboxes.sales,
              body: "Pricing in your currency, a quote for the top tier, or the security questionnaire. Read the security page first: most questionnaires are answered there, including the noes.",
              href: `mailto:${mailboxes.sales}`,
              cta: "contact-sales",
            },
            {
              title: "Book a demo",
              body: "A call with a person, on your own operation rather than a script. The form takes a minute and tells you honestly if it could not send.",
              href: routes.demo,
              cta: "contact-demo",
            },
          ]}
        />
      </Band>

      <Close headline="Or just start using it." placement="contact-close" />
    </Page>
  );
}
