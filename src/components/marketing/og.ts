// The site's default social card, in one place.
//
// WHY THIS FILE EXISTS.
//
// Next resolves `metadata.openGraph` by REPLACEMENT, not by deep merge. The
// file convention at src/app/opengraph-image.tsx supplies an `images` entry
// to every route underneath it, but the moment a page exports an
// `openGraph` object of its own WITHOUT an `images` key, that inferred entry
// is dropped and the page unfurls as a bare text link.
//
// Every marketing page sets its own openGraph title and description, because
// the root layout still carries the pre-refresh positioning as the site-wide
// fallback. So every one of those pages needs this image handed back to it
// explicitly. Forty one of them were missing it.
//
// The URL is the file convention's own route, which answers without the
// content hash. It is relative on purpose: `metadataBase` in the root layout
// is https://workwrk.com, so Next renders it absolute in the served HTML and
// a preview host never sees a relative og:image.
//
// Pages with a card of their OWN (the home page, /pricing, /tuesday) pass
// their own images array and never import this.

/** Alt text for the default card: the beat 6 pull-back frame. */
export const OG_DEFAULT_ALT =
  "WorkwrK: people, processes, work and goals in one system";

/** The default og:image entry. Spread into a page's `openGraph.images`. */
export const OG_DEFAULT_IMAGE = {
  url: "/opengraph-image",
  width: 1200,
  height: 630,
  alt: OG_DEFAULT_ALT,
} as const;

/** The same card for the twitter block, which wants no dimensions. */
export const OG_DEFAULT_TWITTER_IMAGE = {
  url: "/opengraph-image",
  alt: OG_DEFAULT_ALT,
} as const;
