import type { Metadata } from "next";

import { LEGAL_COPY } from "@/components/marketing/iconic/copy";
import { LegalDoc } from "@/components/marketing/iconic/legal-doc";
import { mailboxes } from "@/components/marketing/config";
import { OG_DEFAULT_IMAGE, OG_DEFAULT_TWITTER_IMAGE } from "@/components/marketing/og";

const COOKIES_DESCRIPTION =
  "What cookies we set, why, and how you control them. Plain English, and every row traced to the line of code that sets it.";

export const metadata: Metadata = {
  title: "Cookie policy",
  description: COOKIES_DESCRIPTION,
  alternates: { canonical: "https://workwrk.com/cookies" },
  openGraph: { images: [OG_DEFAULT_IMAGE], title: "Cookie policy", description: COOKIES_DESCRIPTION },
  twitter: { images: [OG_DEFAULT_TWITTER_IMAGE], card: "summary_large_image", description: COOKIES_DESCRIPTION },
};

/**
 * The cookies this deployment actually sets, each traced to the line that
 * sets it.
 *
 * THE TABLE THIS REPLACED WAS FABRICATED END TO END, on the one page whose
 * entire job is a factual disclosure. Its six rows, ww_session, ww_csrf,
 * ww_preferences, ww_attrib, ww_consent and "_ga / _ga_*", appeared exactly
 * once each in this whole repository: on that page. The last of those
 * disclosed Google Analytics, and there is no gtag and no googletagmanager
 * anywhere in src, so the page named an analytics vendor the site does not
 * load and described a retention period for data it never collects.
 *
 * A disclosure that over-states what is collected is still a false
 * disclosure, and it is the kind a regulator reads first.
 *
 * Sources, so the next person can check rather than trust:
 *   next-auth.session-token  src/lib/auth.ts (12h idle)
 *   next-auth.callback-url   src/lib/auth.ts
 *   next-auth.csrf-token     NextAuth's own default, set on the sign-in POST
 *   wwrk_consent             src/app/api/consent/route.ts, 180 days
 *   NEXT_LOCALE              src/i18n/request.ts, 365 days
 *   NEXT_CURRENCY            src/lib/currency-server.ts, 365 days
 *
 * There is no analytics row and no marketing row because nothing in the
 * codebase sets one. The banner still asks, because the consent record is
 * what makes adding one later lawful, and the day an analytics script does
 * land it gets a row here in the same commit.
 */
const COOKIES = [
  {
    name: "next-auth.session-token",
    purpose: "Keeps you signed in. Set only after you log in.",
    duration: "12 hours idle",
    type: "Essential",
  },
  {
    name: "next-auth.callback-url",
    purpose: "Returns you to the page you were on after login.",
    duration: "Session",
    type: "Essential",
  },
  {
    name: "next-auth.csrf-token",
    purpose: "Protects the login form against cross site request forgery.",
    duration: "Session",
    type: "Essential",
  },
  {
    name: "wwrk_consent",
    purpose: "Records the cookie choice you made on the banner.",
    duration: "180 days",
    type: "Essential",
  },
  { name: "NEXT_LOCALE", purpose: "Remembers the language you picked.", duration: "365 days", type: "Functional" },
  {
    name: "NEXT_CURRENCY",
    purpose: "Remembers the currency you picked on the pricing page.",
    duration: "365 days",
    type: "Functional",
  },
];

export default function CookiesPage() {
  return (
    <LegalDoc
      eyebrow={LEGAL_COPY.cookies.eyebrow}
      title={LEGAL_COPY.cookies.h1}
      updated={LEGAL_COPY.cookies.updated}
      // The count comes from the table this page renders, so the sentence
      // cannot say six while the table shows seven.
      lede={LEGAL_COPY.cookies.sub(COOKIES.length)}
      sections={[
        {
          id: "what",
          title: "1. What cookies are",
          // "Nothing on this site measures you" used to end this paragraph as
          // an absolute, and it over-reached by one fact: answering the banner
          // POSTs to /api/consent, which writes a ConsentRecord row carrying
          // your IP, user agent, country and region, keyed to a random token
          // for a visitor who is not signed in. That is consent proof rather
          // than measurement, and it is defensible, but an absolute sentence
          // with an undisclosed exception behind it is the shape of claim this
          // page exists to refuse. The claim is now scoped to what it can
          // carry, and the record is disclosed in the same breath rather than
          // left for a reader to find in the network tab.
          body: (
            <>
            <p>
              Cookies are small text files stored in your browser. Ours do two things: keep you logged in, and remember
              the language and currency you picked. No analytics vendor, no ad network and no pixel runs on this site.
            </p>
            <p>
              One thing is written on our side rather than yours. When you answer the cookie banner we store the answer
              as proof of it, with the time, your country and region, your IP address and your browser's user agent
              string. It records the choice you made; it does not follow what you read.
            </p>
            </>
          ),
        },
        {
          id: "list",
          title: "2. The cookies we use",
          body: (
            <div
              className="ic-doctable"
              tabIndex={0}
              role="region"
              aria-label="The cookies we set, scrolls sideways"
            >
              <table>
                <thead>
                  <tr>
                    <th scope="col">Name</th>
                    <th scope="col">Purpose</th>
                    <th scope="col">Duration</th>
                    <th scope="col">Type</th>
                  </tr>
                </thead>
                <tbody>
                  {COOKIES.map((c) => (
                    <tr key={c.name}>
                      <th scope="row">{c.name}</th>
                      <td>{c.purpose}</td>
                      <td>{c.duration}</td>
                      {/* A word, not a tinted pill. The pill was the one
                          place colour appeared inside a legal document. */}
                      <td>{c.type}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ),
        },
        {
          id: "control",
          title: "3. How you control them",
          body: (
            <>
              <p>
                Essential cookies are required for the service to work and cannot be disabled. Everything else is opt
                in: you answer the banner on your first visit, and you can change the answer at any time by clearing
                cookies and reloading.
              </p>
              <p>
                You can also block all cookies in your browser settings. The service will not work properly without
                essential cookies.
              </p>
            </>
          ),
        },
        {
          // This section used to read "The only third-party cookies we set
          // are Google Analytics". There is no gtag and no googletagmanager
          // anywhere in src: the page disclosed a vendor the site does not
          // load. What is true is the stronger sentence.
          id: "third",
          title: "4. Third party cookies",
          body: (
            <>
              <p>
                None. Every cookie in the table above is set by workwrk itself. We load no analytics vendor, no ad tech,
                no retargeting pixel and no social network tracker on this site or in the product.
              </p>
              <p>
                The banner still asks, because the record of your answer is what lets us add one later without asking
                you again to catch up. If we ever do add one, it gets a row in the table above in the same release, and
                the banner will be asking about something real.
              </p>
            </>
          ),
        },
        {
          id: "contact",
          title: "5. Contact",
          body: (
            <p>
              Questions about cookies: <a href={`mailto:${mailboxes.privacy}`}>{mailboxes.privacy}</a>.
            </p>
          ),
        },
      ]}
    />
  );
}
