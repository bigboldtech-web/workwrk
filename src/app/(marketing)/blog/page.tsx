// /blog, on the iconic sheet.
//
// THE INDEX READS ONE SOURCE. Eight posts were once hand-listed in this file
// and all eight slugs 404'd, because the posts that exist live in
// src/data/blog-posts.ts, which is what /blog/[slug] renders and what the
// sitemap submits. It reads that file now, so the index, the article route
// and the sitemap cannot disagree again.
//
// THE FILTERS ARE LINKS, not labelled spans. They once rendered as a
// selected pill and six unselected ones, which is the universal picture of a
// working filter, and they were <span> elements with no handler, no role, no
// href and tabIndex -1: unreachable by keyboard and silent when clicked. A
// link also means /blog?category=AI is a URL somebody can send.
//
// WHAT THE RESTYLE REMOVED:
//
//   The six colour rotation. Every post was assigned a hue from a cycle, so
//   a page of eight essays carried violet, sky, emerald, amber, fuchsia and
//   indigo pills at once. Colour is almost absent on this site.
//
//   The featured card and the three column card grid under it. One post in a
//   bordered box with a coloured top rule, then seven in tiles with
//   hover-lift shadows, is two card treatments on one page. It is one list
//   now: title, one line, date, hairline.
//
//   The closing sales band. An essay index that ends in a signup button is
//   an ad with reading material attached.

import type { Metadata } from "next";
import Link from "next/link";

import { blogPosts } from "@/data/blog-posts";
// The site's own date formatter, so a row prints "25 Mar 2026" rather than
// the raw ISO string the fixture stores.
import { formatDate } from "@/lib/utils";
import { BLOG_COPY } from "@/components/marketing/iconic/copy";
import { Band, Claim, Eyebrow, Headline, Page, Sub } from "@/components/marketing/iconic/iconic";
import { OG_DEFAULT_IMAGE, OG_DEFAULT_TWITTER_IMAGE } from "@/components/marketing/og";

const BLOG_DESCRIPTION =
  "Essays from the team building WorkwrK: how the parts connect, what the category words mean, and what we have decided not to build.";

export const metadata: Metadata = {
  title: "Blog",
  description: BLOG_DESCRIPTION,
  alternates: { canonical: "https://workwrk.com/blog" },
  openGraph: { images: [OG_DEFAULT_IMAGE], title: "Blog", description: BLOG_DESCRIPTION },
  twitter: { images: [OG_DEFAULT_TWITTER_IMAGE], card: "summary_large_image", description: BLOG_DESCRIPTION },
};

/* The copy lives in iconic/copy.ts with the other seven pages. */
const COPY = BLOG_COPY;

interface IndexPost {
  slug: string;
  title: string;
  excerpt: string;
  date: string;
  readMins: number;
  category: string;
}

const POSTS: readonly IndexPost[] = [...blogPosts]
  .sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0))
  .map((post) => ({
    slug: post.slug,
    title: post.title,
    excerpt: post.excerpt,
    date: post.date,
    readMins: Number.parseInt(post.readTime, 10) || 0,
    category: post.category,
  }));

/** Derived, so a filter can never offer a category with nothing behind it. */
const CATEGORIES = ["All", ...Array.from(new Set(POSTS.map((p) => p.category)))];

/** A category's own URL. "All" is the bare index, so it has no parameter. */
function categoryHref(category: string): string {
  return category === "All" ? "/blog" : `/blog?category=${encodeURIComponent(category)}`;
}

export default async function BlogPage({
  searchParams,
}: {
  searchParams: Promise<{ category?: string | string[] }>;
}) {
  const sp = await searchParams;
  const raw = Array.isArray(sp.category) ? sp.category[0] : sp.category;
  // An unknown category falls back to All rather than to an empty page.
  const active = raw && CATEGORIES.includes(raw) ? raw : "All";
  const visible = active === "All" ? POSTS : POSTS.filter((p) => p.category === active);

  return (
    <Page>
      <Band air="hero" labelledBy="blog-h1" still>
        <Eyebrow>{COPY.hero.eyebrow}</Eyebrow>
        <Claim id="blog-h1">{COPY.hero.h1}</Claim>
        <Sub>{COPY.hero.sub}</Sub>
      </Band>

      {/* The list continues the band above rather than opening a new idea,
          so it pays no top air: the claim and the posts are one screen and
          one screen after it. */}
      <Band air="tight">
        {CATEGORIES.length > 1 ? (
          <nav aria-label="Filter posts by category">
            <ul className="ic-filters">
              {CATEGORIES.map((c) => (
                <li key={c}>
                  <Link
                    className="ic-tab mk-focus"
                    href={categoryHref(c)}
                    aria-current={c === active ? "page" : undefined}
                  >
                    {c}
                  </Link>
                </li>
              ))}
            </ul>
          </nav>
        ) : null}

        {visible.length > 0 ? (
          <ul className="ic-posts">
            {visible.map((p) => (
              <li key={p.slug}>
                <Link className="ic-post mk-focus" href={`/blog/${p.slug}`}>
                  <span className="ic-posttitle">{p.title}</span>
                  <span className="ic-postexcerpt">{p.excerpt}</span>
                  <span className="ic-postmeta">
                    {p.category} &middot; {formatDate(p.date)} &middot; {p.readMins} min
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        ) : (
          <Headline id="blog-empty">{COPY.empty.h2}</Headline>
        )}
      </Band>
    </Page>
  );
}
