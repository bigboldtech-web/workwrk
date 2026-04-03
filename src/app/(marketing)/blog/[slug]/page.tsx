import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { blogPosts, getBlogPost } from "@/data/blog-posts";
import { ArrowLeft, Clock, ArrowRight } from "lucide-react";

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
    title: `${post.title} — WorkwrK Blog`,
    description: post.excerpt,
    keywords: post.tags,
    openGraph: {
      title: post.title,
      description: post.excerpt,
      type: "article",
      publishedTime: post.date,
      authors: [post.author],
      tags: post.tags,
    },
    twitter: {
      card: "summary_large_image",
      title: post.title,
      description: post.excerpt,
    },
  };
}

export default async function BlogPostPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const post = getBlogPost(slug);
  if (!post) notFound();

  // Find related posts
  const related = blogPosts
    .filter((p) => p.slug !== slug)
    .slice(0, 3);

  // Simple markdown-to-HTML (handles headings, bold, lists, tables, paragraphs)
  const htmlContent = post.content
    .split("\n")
    .map((line) => {
      if (line.startsWith("## ")) return `<h2>${line.slice(3)}</h2>`;
      if (line.startsWith("### ")) return `<h3>${line.slice(4)}</h3>`;
      if (line.startsWith("- **")) return `<li>${line.slice(2)}</li>`;
      if (line.startsWith("- ")) return `<li>${line.slice(2)}</li>`;
      if (line.startsWith("|")) return ""; // skip table rendering for simplicity
      if (line.trim() === "") return "<br />";
      return `<p>${line}</p>`;
    })
    .join("\n")
    // Bold
    .replace(/\*\*(.*?)\*\*/g, "<strong>$1</strong>")
    // Wrap consecutive <li> in <ul>
    .replace(/(<li>.*?<\/li>\n?)+/g, (match) => `<ul>${match}</ul>`);

  return (
    <>
      {/* Article */}
      <article className="pb-20 pt-32">
        <div className="mx-auto max-w-[720px] px-6">
          {/* Back */}
          <Link
            href="/blog"
            className="mb-8 inline-flex items-center gap-2 text-sm text-muted transition-colors hover:text-foreground"
          >
            <ArrowLeft size={14} /> Back to blog
          </Link>

          {/* Meta */}
          <div className="mb-4 flex flex-wrap items-center gap-3">
            <span className="rounded-full bg-[#6C5CE7]/10 px-3 py-1 text-xs font-medium text-[#A29BFE]">
              {post.category}
            </span>
            <span className="flex items-center gap-1 text-xs text-muted">
              <Clock size={12} /> {post.readTime}
            </span>
            <span className="text-xs text-muted">{post.date}</span>
          </div>

          {/* Title */}
          <h1 className="mb-6 font-[family-name:var(--font-syne)] text-[clamp(2rem,4vw,3rem)] font-bold leading-tight tracking-tight text-foreground">
            {post.title}
          </h1>

          {/* Author */}
          <div className="mb-10 flex items-center gap-3 border-b border-border pb-8">
            <div className="flex h-10 w-10 items-center justify-center rounded-full bg-[#6C5CE7]/20 text-sm font-bold text-[#A29BFE]">
              {post.author.charAt(0)}
            </div>
            <div>
              <div className="text-sm font-medium text-foreground">{post.author}</div>
              <div className="text-xs text-muted">{post.authorRole}</div>
            </div>
          </div>

          {/* Content */}
          <div
            className="prose-custom"
            dangerouslySetInnerHTML={{ __html: htmlContent }}
          />

          {/* Tags */}
          <div className="mt-12 flex flex-wrap gap-2 border-t border-border pt-8">
            {post.tags.map((tag) => (
              <span
                key={tag}
                className="rounded-full border border-border bg-surface px-3 py-1 text-xs text-muted"
              >
                {tag}
              </span>
            ))}
          </div>
        </div>
      </article>

      {/* Related posts */}
      <section className="border-t border-border pb-28 pt-16">
        <div className="mx-auto max-w-[1200px] px-6">
          <h2 className="mkt-title mb-8 text-2xl">More articles</h2>
          <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
            {related.map((r) => (
              <Link key={r.slug} href={`/blog/${r.slug}`} className="group block">
                <div className="blog-card flex flex-col p-6">
                  <span className="mb-3 text-xs text-[#A29BFE]">{r.category}</span>
                  <h3 className="mb-2 font-[family-name:var(--font-syne)] text-base font-bold text-foreground transition-colors group-hover:text-[#A29BFE]">
                    {r.title}
                  </h3>
                  <p className="flex-1 text-sm text-muted">{r.excerpt.slice(0, 100)}...</p>
                  <div className="mt-4 flex items-center gap-1 text-xs font-semibold text-[#A29BFE]">
                    Read <ArrowRight size={12} />
                  </div>
                </div>
              </Link>
            ))}
          </div>
        </div>
      </section>
    </>
  );
}
