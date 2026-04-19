import type { Metadata } from "next";
import Link from "next/link";

import { Reveal, SectionHeader } from "@/components/bento";
import { blogPosts, getAllCategories } from "@/data/blog-posts";

export const metadata: Metadata = {
  title: "Blog — WorkwrK | Insights on business operations, performance, and growth",
  description:
    "Practical guides on performance management, KPIs, SOPs, recognition, and AI for teams scaling past 25 people.",
  alternates: { canonical: "https://workwrk.com/blog" },
  openGraph: {
    title: "WorkwrK Blog — Business operations insights",
    description:
      "Guides on performance management, KPIs, SOPs, recognition, and AI for growing businesses.",
    url: "https://workwrk.com/blog",
  },
};

export default function BlogPage() {
  const categories = getAllCategories();
  const featured = blogPosts[0];
  const rest = blogPosts.slice(1);

  return (
    <>
      <section className="bento-section" style={{ paddingTop: 40 }}>
        <div className="bento-container">
          <Reveal>
            <SectionHeader
              label="Blog"
              title={
                <>
                  Notes for <span className="hi">growing businesses.</span>
                </>
              }
              subtitle="Practical writing on performance, process, KPIs, reviews, and AI. Written by operators, not marketers."
              aside={{
                label: "Categories",
                stat: String(categories.length),
                text: "Grouped by what you care about. Read one, not all.",
              }}
            />
          </Reveal>

          {featured ? (
            <Reveal>
              <Link
                href={`/blog/${featured.slug}`}
                style={{
                  display: "block",
                  background: "var(--b-lime)",
                  color: "var(--b-bg)",
                  borderRadius: 36,
                  padding: "48px 44px",
                  marginBottom: 24,
                  position: "relative",
                  overflow: "hidden",
                  textDecoration: "none",
                  transition: "all 0.3s",
                }}
                className="blog-featured"
              >
                <span
                  aria-hidden
                  style={{
                    position: "absolute", inset: 0,
                    backgroundImage: "radial-gradient(circle at 1px 1px, rgba(0,0,0,0.08) 1px, transparent 0)",
                    backgroundSize: "18px 18px", opacity: 0.35, pointerEvents: "none",
                  }}
                />
                <div style={{ position: "relative" }}>
                  <span className="bento-label" style={{ opacity: 0.7 }}>
                    Featured · {featured.category}
                  </span>
                  <h2
                    style={{
                      fontSize: "clamp(32px, 4vw, 52px)",
                      fontWeight: 600,
                      letterSpacing: "-0.03em",
                      lineHeight: 1.05,
                      margin: "14px 0 14px",
                      maxWidth: 780,
                    }}
                  >
                    {featured.title}
                  </h2>
                  <p style={{ fontSize: 16, fontWeight: 500, maxWidth: 640, lineHeight: 1.55 }}>
                    {featured.excerpt}
                  </p>
                  <div
                    style={{
                      marginTop: 24,
                      display: "flex",
                      gap: 14,
                      fontFamily: "var(--font-geist-mono), monospace",
                      fontSize: 11,
                      letterSpacing: "0.06em",
                      textTransform: "uppercase",
                      opacity: 0.75,
                    }}
                  >
                    <span>{featured.readTime}</span>
                    <span>·</span>
                    <span>Read →</span>
                  </div>
                </div>
              </Link>
            </Reveal>
          ) : null}

          <Reveal stagger className="blog-grid">
            {rest.map((p) => (
              <Link
                key={p.slug}
                href={`/blog/${p.slug}`}
                className="blog-card"
              >
                <div>
                  <span className="bento-label" style={{ color: "var(--b-t3)" }}>
                    {p.category}
                  </span>
                  <h3 className="blog-card-title">{p.title}</h3>
                  <p className="blog-card-excerpt">{p.excerpt}</p>
                </div>
                <div className="blog-card-meta">
                  <span>{p.readTime}</span>
                  <span className="arr">→</span>
                </div>
              </Link>
            ))}
          </Reveal>
        </div>

        <style>{`
          .blog-featured:hover { transform: translateY(-3px); box-shadow: var(--b-shadow-lime); }
          .blog-grid { display: grid; grid-template-columns: repeat(3, 1fr); gap: 14px; }
          .blog-card {
            background: var(--b-card); border: 1px solid var(--b-line);
            color: var(--b-fg);
            border-radius: 24px; padding: 28px;
            min-height: 260px;
            display: flex; flex-direction: column; justify-content: space-between;
            transition: all 0.3s;
            text-decoration: none;
          }
          .blog-card:hover { transform: translateY(-3px); border-color: var(--b-line-2); background: var(--b-card-2); }
          .blog-card-title { font-size: 20px; font-weight: 600; letter-spacing: -0.025em; line-height: 1.2; margin: 12px 0 10px; }
          .blog-card-excerpt { font-size: 13.5px; color: var(--b-t2); line-height: 1.55; }
          .blog-card-meta {
            margin-top: 20px; padding-top: 14px;
            border-top: 1px solid var(--b-line);
            display: flex; justify-content: space-between; align-items: center;
            font-family: var(--font-geist-mono), monospace;
            font-size: 11px; color: var(--b-t3);
            letter-spacing: 0.04em; text-transform: uppercase;
          }
          .blog-card-meta .arr { color: var(--b-lime); transition: transform 0.2s; }
          .blog-card:hover .blog-card-meta .arr { transform: translateX(3px); }
          @media (max-width: 900px) { .blog-grid { grid-template-columns: repeat(2, 1fr); } }
          @media (max-width: 560px) { .blog-grid { grid-template-columns: 1fr; } }
        `}</style>
      </section>
    </>
  );
}
