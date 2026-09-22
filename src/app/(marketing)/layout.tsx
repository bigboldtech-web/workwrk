// The marketing layout.
//
// Light only. The navy chrome inside a product frame is the only dark
// element anywhere on the public site (concept 10, design-system 13.14), so
// there is no dark block here and no theme attribute to honour.
//
// Three things this layout owns:
//
//   1. The token scope. `mk-tokens` carries the product's --os-* aliases,
//      light locked, and `mk-type` carries the marketing display ramp.
//      `mk-os` is the third class in that file and is NOT applied here: it
//      adds the product's 14px reading scale and 4px spacing unit on top of
//      the values, which belongs inside a product frame and would re-scale
//      every page on a 16px marketing document. They are classes rather
//      than an imported product stylesheet for the reasons written at the
//      top of marketing-shell.css.
//   2. The one underline navigation and the footer. Pages render content
//      only; they never re-render the chrome.
//   3. The cookie banner. It mounts on the marketing and auth hosts and
//      nowhere else in the app (spec-shell 1.13). The one remaining in-app
//      mount is the Help menu's reopen door, which is deliberate and is not
//      an auto-appearing banner.

import type { Metadata } from "next";

import { MarketingNav } from "@/components/marketing/nav";
import { MarketingFooterV2 } from "@/components/marketing/footer";
import { ConsentBanner } from "@/components/layout/consent-banner";
import { ConsentProvider } from "@/components/layout/consent-provider";
import "@/components/marketing/shell/marketing-shell.css";
import "./marketing.css";
import {
  SITE_KEYWORDS,
  SITE_TITLE_DEFAULT,
  SITE_TITLE_TEMPLATE,
  siteDescription,
} from "@/components/marketing/positioning";
import { OG_DEFAULT_IMAGE, OG_DEFAULT_TWITTER_IMAGE } from "@/components/marketing/og";

/**
 * The positioning default for the marketing group (decision D25).
 *
 * The root layout is shared with the product and the auth host and still
 * carries the retired India-first positioning. A page that sets no keywords
 * inherited it, which was thirty nine of the forty marketing routes, and a
 * page that sets no title inherited "The operating system for teams that
 * mean business", which is both the retired line and the last em dash in a
 * marketing tab title.
 *
 * This export loses to any page that sets its own, so the pages that already
 * declare a title, a description, keywords or a card keep exactly what they
 * declare. It only fills the gaps, and the gaps were the problem.
 *
 * The card is declared WITH its images on purpose: Next resolves openGraph
 * by replacement rather than deep merge, so a segment that declares the
 * block without an images key drops the file convention's inferred one and
 * unfurls as a bare text link. That is the hazard og.ts was written for, and
 * it applies to a layout exactly as it applies to a page.
 */
export const metadata: Metadata = {
  // `absolute`, not `default`, and the difference is visible in a browser
  // tab. A layout's `default` is still poured into the closest PARENT
  // template, and the root layout's is "%s · WorkwrK", so the marketing 404
  // rendered "WorkwrK: your people, processes, work and goals, snapped
  // together · WorkwrK". `title.absolute` in a layout "defines the default
  // title for child segments" and "ignores title.template from parent
  // segments" (Next's generate-metadata reference), which is exactly the
  // pair wanted here: this string whole, and the template below still
  // applied to every child that sets a title of its own.
  title: { absolute: SITE_TITLE_DEFAULT, template: SITE_TITLE_TEMPLATE },
  description: siteDescription(),
  keywords: SITE_KEYWORDS,
  openGraph: {
    type: "website",
    locale: "en_US",
    siteName: "WorkwrK",
    title: SITE_TITLE_DEFAULT,
    description: siteDescription(),
    images: [OG_DEFAULT_IMAGE],
  },
  twitter: {
    card: "summary_large_image",
    title: SITE_TITLE_DEFAULT,
    description: siteDescription(),
    images: [OG_DEFAULT_TWITTER_IMAGE],
  },
};

export default function MarketingLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="mk-tokens mk-type mk-site">
      <a className="mk-skip" href="#main">
        Skip to content
      </a>
      <MarketingNav />
      {/* The banner is mounted BEFORE <main>, and that is an accessibility
          fix rather than a layout one.
          It renders fixed over the hero, so a sighted visitor meets it
          first; mounted after <main> it was the second to last focusable
          element on the page, so a keyboard or screen reader visitor had to
          traverse the entire home page, including five viewports of pinned
          Tuesday and a fourteen tile calculator, before they could answer
          it. Its position on screen is the stylesheet's; its position in the
          reading and tab order is this line. */}
      <ConsentProvider>
        <ConsentBanner />
      </ConsentProvider>
      <main id="main">{children}</main>
      <MarketingFooterV2 />
    </div>
  );
}
