import type { Metadata } from "next";
import Link from "next/link";
import { blogPosts, getAllCategories } from "@/data/blog-posts";
import { ArrowRight, Clock, Tag } from "lucide-react";

export const metadata: Metadata = {
  title: "Blog — WorkwrK | Insights on Business Operations, Performance & Growth",
  description:
    "Practical guides on business operations, performance management, KPI tracking, SOP compliance, employee recognition, and AI intelligence for growing companies.",
  openGraph: {
    title: "WorkwrK Blog — Business Operations Insights",
    description:
      "Guides on performance management, KPIs, SOPs, employee recognition, and AI for growing businesses.",
  },
};

export default function BlogPage() {
  const categories = getAllCategories();
  const featured = blogPosts[0];
  const rest = blogPosts.slice(1);

  return (
    <>
      {/* Hero */}
      <section className="pb-16 pt-36">
        <div className="mx-auto max-w-[1200px] px-6">
          <p className="mkt-label">Blog</p>
          <h1 className="mkt-title mb-4 text-[clamp(2.2rem,5vw,3.5rem)]">
            Insights for growing<br />
            <span className="text-gradient">businesses.</span>
          </h1>
          <p className="max-w-[520px] text-lg text-muted">
            Practical guides on performance management, business operations,
            KPIs, SOPs, and building data-driven organizations.
          </p>
        </div>
      </section>

      {/* Categories */}
      <section className="pb-12">
        <div className="mx-auto max-w-[1200px] px-6">
          <div className="flex flex-wrap gap-3">
            {categories.map((cat) => (
              <span
                key={cat}
                className="rounded-full border border-border bg-surface px-4 py-1.5 text-xs text-muted"
              >
                {cat}
              </span>
            ))}
          </div>
        </div>
      </section>

      {/* Featured post */}
      <section className="pb-12">
        <div className="mx-auto max-w-[1200px] px-6">
          <Link href={`/blog/${featured.slug}`} className="group block">
            <article className="blog-card grid gap-8 p-8 md:grid-cols-2 md:items-center">
              <div className="flex aspect-[16/10] items-center justify-center rounded-xl border border-border bg-surface-2">
                <span className="text-gradient font-[family-name:var(--font-syne)] text-4xl font-extrabold">
                  Featured
                </span>
              </div>
              <div>
                <div className="mb-3 flex items-center gap-3">
                  <span className="rounded-full bg-[#6C5CE7]/10 px-3 py-1 text-xs font-medium text-[#A29BFE]">
                    {featured.category}
                  </span>
                  <span className="flex items-center gap-1 text-xs text-muted">
                    <Clock size={12} /> {featured.readTime}
                  </span>
                </div>
                <h2 className="mb-3 font-[family-name:var(--font-syne)] text-2xl font-bold leading-tight text-foreground transition-colors group-hover:text-[#A29BFE]">
                  {featured.title}
                </h2>
                <p className="mb-4 text-sm leading-relaxed text-muted">
                  {featured.excerpt}
                </p>
                <div className="flex items-center gap-2 text-sm font-semibold text-[#A29BFE]">
                  Read article <ArrowRight size={14} />
                </div>
              </div>
            </article>
          </Link>
        </div>
      </section>

      {/* Post grid */}
      <section className="pb-28">
        <div className="mx-auto max-w-[1200px] px-6">
          <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
            {rest.map((post) => (
              <Link key={post.slug} href={`/blog/${post.slug}`} className="group block">
                <article className="blog-card flex h-full flex-col">
                  <div className="flex aspect-[16/9] items-center justify-center border-b border-border bg-surface-2">
                    <Tag size={32} className="text-border" />
                  </div>
                  <div className="flex flex-1 flex-col p-6">
                    <div className="mb-3 flex items-center gap-3">
                      <span className="rounded-full bg-[#6C5CE7]/10 px-3 py-1 text-xs font-medium text-[#A29BFE]">
                        {post.category}
                      </span>
                      <span className="flex items-center gap-1 text-xs text-muted">
                        <Clock size={12} /> {post.readTime}
                      </span>
                    </div>
                    <h3 className="mb-2 font-[family-name:var(--font-syne)] text-lg font-bold leading-snug text-foreground transition-colors group-hover:text-[#A29BFE]">
                      {post.title}
                    </h3>
                    <p className="mb-4 flex-1 text-sm leading-relaxed text-muted">
                      {post.excerpt}
                    </p>
                    <div className="flex items-center justify-between text-xs text-muted">
                      <span>{post.date}</span>
                      <span className="font-semibold text-[#A29BFE]">Read →</span>
                    </div>
                  </div>
                </article>
              </Link>
            ))}
          </div>
        </div>
      </section>

      {/* CTA */}
      <section className="pb-28">
        <div className="mx-auto max-w-[1200px] px-6">
          <div className="mkt-highlight text-center">
            <h2 className="mkt-title mb-4 text-[clamp(1.8rem,3vw,2.5rem)]">
              Ready to put these ideas into practice?
            </h2>
            <p className="mx-auto mb-8 max-w-[440px] text-base text-muted">
              Start your free trial and experience the business operating system.
            </p>
            <Link href="/register" className="btn-primary px-8 py-3.5">
              Start Free Trial
            </Link>
          </div>
        </div>
      </section>
    </>
  );
}
