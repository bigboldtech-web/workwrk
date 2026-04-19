import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { blogPosts, getBlogPost } from "@/data/blog-posts";
import { ArrowLeft, Clock, ArrowRight } from "lucide-react";
import { Reveal } from "@/components/bento";

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

  const related = blogPosts
    .filter((p) => p.slug !== slug)
    .slice(0, 3);

  const htmlContent = post.content
    .split("\n")
    .map((line) => {
      if (line.startsWith("## ")) return `<h2>${line.slice(3)}</h2>`;
      if (line.startsWith("### ")) return `<h3>${line.slice(4)}</h3>`;
      if (line.startsWith("- **")) return `<li>${line.slice(2)}</li>`;
      if (line.startsWith("- ")) return `<li>${line.slice(2)}</li>`;
      if (line.startsWith("|")) return "";
      if (line.trim() === "") return "<br />";
      return `<p>${line}</p>`;
    })
    .join("\n")
    .replace(/\*\*(.*?)\*\*/g, "<strong>$1</strong>")
    .replace(/(<li>.*?<\/li>\n?)+/g, (match) => `<ul>${match}</ul>`);

  return (
    <>
      <article className="bento-section" style={{ paddingTop: 56 }}>
        <div className="bento-container" style={{ maxWidth: 760 }}>
          <Reveal>
            <Link href="/blog" className="bp-back">
              <ArrowLeft size={14} /> Back to blog
            </Link>
          </Reveal>

          <Reveal>
            <div className="bp-meta">
              <span className="bp-category">{post.category}</span>
              <span className="bp-dot" aria-hidden />
              <span className="bp-meta-item">
                <Clock size={12} /> {post.readTime}
              </span>
              <span className="bp-dot" aria-hidden />
              <span className="bp-meta-item">{post.date}</span>
            </div>
          </Reveal>

          <Reveal>
            <h1 className="bp-title">{post.title}</h1>
          </Reveal>

          <Reveal>
            <div className="bp-author">
              <div className="bp-author-avatar" aria-hidden>
                {post.author.charAt(0)}
              </div>
              <div>
                <div className="bp-author-name">{post.author}</div>
                <div className="bp-author-role">{post.authorRole}</div>
              </div>
            </div>
          </Reveal>

          <Reveal>
            <div
              className="bp-body"
              dangerouslySetInnerHTML={{ __html: htmlContent }}
            />
          </Reveal>

          <Reveal>
            <div className="bp-tags">
              {post.tags.map((tag) => (
                <span key={tag} className="bp-tag">
                  {tag}
                </span>
              ))}
            </div>
          </Reveal>
        </div>
      </article>

      <section className="bento-section" style={{ borderTop: "1px solid var(--b-line)" }}>
        <div className="bento-container">
          <Reveal>
            <h2 className="bp-more-title">
              More <span className="hi">articles.</span>
            </h2>
          </Reveal>
          <Reveal stagger className="bp-more-grid">
            {related.map((r) => (
              <Link key={r.slug} href={`/blog/${r.slug}`} className="bp-more-card">
                <span className="bp-category">{r.category}</span>
                <h3>{r.title}</h3>
                <p>{r.excerpt.slice(0, 120)}…</p>
                <span className="bp-more-cta">
                  Read <ArrowRight size={12} />
                </span>
              </Link>
            ))}
          </Reveal>
        </div>
      </section>

      <style>{`
        .bp-back {
          display: inline-flex; align-items: center; gap: 8px;
          font-size: 13px;
          color: var(--b-t2);
          text-decoration: none;
          margin-bottom: 28px;
          transition: color 0.2s;
          font-family: var(--font-geist-mono), monospace;
          letter-spacing: 0.04em;
        }
        .bp-back:hover { color: var(--b-lime); }
        .bp-meta {
          display: flex;
          align-items: center;
          gap: 12px;
          margin-bottom: 22px;
          flex-wrap: wrap;
        }
        .bp-category {
          padding: 5px 12px;
          background: rgba(212, 255, 46, 0.08);
          border: 1px solid rgba(212, 255, 46, 0.25);
          color: var(--b-lime);
          font-family: var(--font-geist-mono), monospace;
          font-size: 10.5px;
          letter-spacing: 0.16em;
          text-transform: uppercase;
          border-radius: 100px;
        }
        .bp-meta-item {
          display: inline-flex;
          align-items: center;
          gap: 5px;
          font-family: var(--font-geist-mono), monospace;
          font-size: 11px;
          color: var(--b-t3);
          letter-spacing: 0.08em;
        }
        .bp-dot {
          width: 3px;
          height: 3px;
          border-radius: 50%;
          background: var(--b-t4);
        }
        .bp-title {
          font-size: clamp(32px, 5vw, 56px);
          font-weight: 600;
          letter-spacing: -0.038em;
          line-height: 1.05;
          color: var(--b-fg);
          margin: 0 0 32px;
        }
        .bp-author {
          display: flex;
          align-items: center;
          gap: 12px;
          padding-bottom: 32px;
          margin-bottom: 40px;
          border-bottom: 1px solid var(--b-line);
        }
        .bp-author-avatar {
          width: 40px; height: 40px;
          border-radius: 50%;
          background: var(--b-lime);
          color: var(--b-bg);
          display: inline-flex;
          align-items: center;
          justify-content: center;
          font-weight: 700;
          font-size: 15px;
          font-family: var(--font-geist-mono), monospace;
        }
        .bp-author-name {
          font-size: 14px;
          font-weight: 600;
          color: var(--b-fg);
        }
        .bp-author-role {
          font-family: var(--font-geist-mono), monospace;
          font-size: 11px;
          color: var(--b-t3);
          letter-spacing: 0.06em;
          margin-top: 2px;
        }

        .bp-body {
          color: var(--b-off);
          font-size: 17px;
          line-height: 1.75;
        }
        .bp-body h2 {
          font-size: 30px !important;
          font-weight: 600;
          letter-spacing: -0.03em;
          color: var(--b-fg);
          margin: 48px 0 16px;
          line-height: 1.15;
        }
        .bp-body h3 {
          font-size: 22px !important;
          font-weight: 600;
          letter-spacing: -0.025em;
          color: var(--b-fg);
          margin: 36px 0 14px;
        }
        .bp-body p {
          color: var(--b-off);
          margin: 0 0 20px;
        }
        .bp-body ul {
          margin: 20px 0;
          padding-left: 24px;
          list-style: none;
        }
        .bp-body li {
          color: var(--b-off);
          margin: 10px 0;
          position: relative;
          padding-left: 18px;
        }
        .bp-body li::before {
          content: "—";
          position: absolute;
          left: 0;
          color: var(--b-lime);
          font-weight: 700;
        }
        .bp-body strong {
          color: var(--b-fg);
          font-weight: 600;
        }
        .bp-body br { display: block; margin: 4px 0; }

        .bp-tags {
          display: flex;
          flex-wrap: wrap;
          gap: 8px;
          margin-top: 56px;
          padding-top: 32px;
          border-top: 1px solid var(--b-line);
        }
        .bp-tag {
          padding: 6px 12px;
          background: var(--b-card);
          border: 1px solid var(--b-line);
          border-radius: 100px;
          font-size: 11.5px;
          color: var(--b-t2);
          font-family: var(--font-geist-mono), monospace;
          letter-spacing: 0.04em;
        }

        .bp-more-title {
          font-size: clamp(32px, 4vw, 44px);
          font-weight: 600;
          letter-spacing: -0.035em;
          margin: 0 0 32px;
        }
        .bp-more-title :global(.hi) { color: var(--b-lime); }
        .bp-more-grid {
          display: grid;
          grid-template-columns: repeat(3, 1fr);
          gap: 14px;
        }
        .bp-more-card {
          padding: 28px 26px;
          background: var(--b-card);
          border: 1px solid var(--b-line);
          border-radius: 20px;
          display: flex;
          flex-direction: column;
          text-decoration: none;
          transition: all 0.3s cubic-bezier(0.2, 0.9, 0.3, 1);
        }
        .bp-more-card:hover {
          transform: translateY(-3px);
          border-color: rgba(212, 255, 46, 0.35);
          background: var(--b-card-2);
        }
        .bp-more-card .bp-category {
          width: max-content;
          margin-bottom: 12px;
        }
        .bp-more-card h3 {
          font-size: 19px;
          font-weight: 600;
          letter-spacing: -0.025em;
          line-height: 1.2;
          color: var(--b-fg);
          margin: 0 0 10px;
          transition: color 0.2s;
        }
        .bp-more-card:hover h3 { color: var(--b-lime); }
        .bp-more-card p {
          font-size: 14px;
          color: var(--b-t2);
          line-height: 1.55;
          margin: 0;
          flex: 1;
        }
        .bp-more-cta {
          display: inline-flex;
          align-items: center;
          gap: 6px;
          font-family: var(--font-geist-mono), monospace;
          font-size: 11px;
          letter-spacing: 0.12em;
          color: var(--b-lime);
          text-transform: uppercase;
          margin-top: 20px;
          transition: gap 0.2s;
        }
        .bp-more-card:hover .bp-more-cta { gap: 10px; }

        @media (max-width: 900px) {
          .bp-more-grid { grid-template-columns: 1fr; }
        }
      `}</style>
    </>
  );
}
