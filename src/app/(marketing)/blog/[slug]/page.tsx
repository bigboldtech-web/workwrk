import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { blogPosts, getBlogPost } from "@/data/blog-posts";
import { Band, Close, Eyebrow, Page, Stack } from "@/components/marketing/iconic/iconic";

import { OG_DEFAULT_IMAGE, OG_DEFAULT_TWITTER_IMAGE } from "@/components/marketing/og";

export async function generateStaticParams() {
  return blogPosts.map((post) => ({ slug: post.slug }));
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ slug: string }>;
}): Promise<Metadata> {
  const { slug } = await params;
  const post = getBlogPost(slug);
  if (!post) return { title: "Post Not Found" };

  return {
    title: post.title,
    description: post.excerpt,
    keywords: post.tags,
    alternates: { canonical: `https://workwrk.com/blog/${slug}` },
    openGraph: {
      images: [OG_DEFAULT_IMAGE],
      title: post.title,
      description: post.excerpt,
      type: "article",
      publishedTime: post.date,
      authors: [post.author],
      tags: post.tags,
    },
    twitter: {
      images: [OG_DEFAULT_TWITTER_IMAGE],
      card: "summary_large_image",
      title: post.title,
      description: post.excerpt,
    },
  };
}

// Minimal markdown -> HTML pass. Same logic as before; rendered with
// our prose styles applied to the surrounding container.
function renderMarkdown(content: string): string {
  return content
    .split("\n")
    .map((line) => {
      if (line.startsWith("## "))   return `<h2>${line.slice(3)}</h2>`;
      if (line.startsWith("### "))  return `<h3>${line.slice(4)}</h3>`;
      if (line.startsWith("- **")) {
        const m = line.match(/^- \*\*([^*]+)\*\*\s*(.*)$/);
        if (m) return `<li><strong>${m[1]}</strong>${m[2] ? ` ${m[2]}` : ""}</li>`;
        return `<li>${line.slice(2)}</li>`;
      }
      if (line.startsWith("- ")) return `<li>${line.slice(2)}</li>`;
      if (line.startsWith("> "))  return `<blockquote>${line.slice(2)}</blockquote>`;
      const bolded = line.replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>");
      const italic = bolded.replace(/(?<!\*)\*(?!\*)([^*]+)\*/g, "<em>$1</em>");
      if (line.trim() === "") return "";
      return `<p>${italic}</p>`;
    })
    .join("\n")
    .replace(/(<li>[\s\S]*?<\/li>\n?)+/g, (m) => `<ul>${m}</ul>`);
}

export default async function BlogPostPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const post = getBlogPost(slug);
  if (!post) notFound();

  const related = blogPosts.filter((p) => p.slug !== slug).slice(0, 3);
  const html = renderMarkdown(post.content);

  return (
    <Page>
      {/* The article. It opened with a left column hero at up to 54px and a
          byline row of two lucide glyphs, then a tag strip of bordered
          uppercase pills in a per category hue, then a three card "Keep
          reading" grid with a hover transform on it. A post is a document:
          one reading column, one title, one byline, the prose, then the
          three names of what to read next. */}
      <Band air="hero" width="read" align="start" still labelledBy="post-h1">
        <div className="ic-article">
          <Eyebrow>{post.category}</Eyebrow>
          <h1 className="ic-doctitle" id="post-h1">
            {post.title}
          </h1>
          <p className="ic-articlelede">{post.excerpt}</p>
          <p className="ic-byline">
            {post.author}, {post.authorRole}. {post.date}. {post.readTime}.
          </p>
        </div>
      </Band>

      <Band air="tight" width="read" align="start">
        {/* `mk-prose`, not `prose`. The class string that used to be here
            was twelve @tailwindcss/typography variants, and that plugin is
            not installed anywhere in this repo: every one of them was
            inert, so the whole article collapsed to the inherited body size
            with headings indistinguishable from paragraphs and lists with
            no markers, on six routes that are in the sitemap. The rules now
            live in marketing.css, on the --os-* tokens. */}
        <article className="mk-prose ic-article" dangerouslySetInnerHTML={{ __html: html }} />
        {post.tags && post.tags.length > 0 ? (
          <p className="ic-byline ic-article">Filed under {post.tags.join(", ")}.</p>
        ) : null}
        <p className="ic-byline ic-article">
          <Link className="ic-a mk-focus" href="/blog">
            All posts
          </Link>
        </p>
      </Band>

      {related.length > 0 ? (
        <Band ground="quiet" labelledBy="post-related">
          <Eyebrow>Next</Eyebrow>
          <h2 className="ic-h2" id="post-related">
            Keep reading.
          </h2>
          <Stack
            items={related.map((r) => ({
              title: r.title,
              body: r.excerpt,
              href: `/blog/${r.slug}`,
              cta: `blog-related-${r.slug}`,
            }))}
          />
        </Band>
      ) : null}

      <Close headline="Open it on your own work." placement="blog-post" />
    </Page>
  );
}
