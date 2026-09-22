// The marketing host's 404 (spec-shell 2.5): the marketing header and footer
// come from the (marketing) layout; this is the body. One sentence, a way
// back, nothing about the app. Reached by a notFound() inside the marketing
// group (an unknown blog slug) and, under the hard host split, by the
// proxy's rewrite of every unknown path on the marketing host to /404, so a
// typo on workwrk.com never lands in the app's frame.
//
// ON THE TOKEN LAYER, like every other page. It was the one marketing file
// still rendering raw Tailwind slate and blue-600 at text-2xl, so the
// heading on the page a lost visitor lands on sat at a different weight and
// a different scale from every other H1 on the site, in a fourth near
// black. It is a short page and it is still short; it is just made of the
// same material now.
//
// The links are the two a lost visitor actually wants: the home page, and
// the map of what the product is. No search box, because there is no search
// on the marketing site and a box that does nothing is worse than no box.

import Link from "next/link";

import { Band, Claim, Eyebrow, Page, Sub } from "@/components/marketing/iconic/iconic";

export default function MarketingNotFound() {
  return (
    <Page>
      <Band air="hero" labelledBy="nf-h1" still>
        <Eyebrow>404</Eyebrow>
        <Claim id="nf-h1">That page is not here.</Claim>
        <Sub>The address may have changed, or it may never have existed, and nothing is broken on your side.</Sub>
        <p className="ic-note">
          <Link className="ic-a mk-focus" href="/">
            Back to the home page
          </Link>
        </p>
      </Band>
    </Page>
  );
}
