import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft, ArrowRight, Clock, Calendar } from "lucide-react";
import { blogPosts, getBlogPost } from "@/data/blog-posts";
import {
  Section,
  Container,
  Eyebrow,
  CTABand,
  GradientText,
  HUES,
  type Hue,
} from "@/components/marketing/primitives";

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
    alternates: { canonical: `https://workwrk.com/blog/${slug}` },
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

// Deterministic hue per category so each post has its own accent color.
function hueForCategory(cat: string): Hue {
  const map: Record<string, Hue> = {
    Product:     "violet",
    Engineering: "sky",
    Category:    "fuchsia",
    AI:          "indigo",
    People:      "rose",
    Operations:  "emerald",
    Culture:     "pink",
    Growth:      "amber",
  };
  return map[cat] ?? "violet";
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

  const hue = hueForCategory(post.category);
  const t = HUES[hue];
  const related = blogPosts.filter((p) => p.slug !== slug).slice(0, 3);
  const html = renderMarkdown(post.content);

  return (
    <>
      <Section variant="mesh" py="md" className="pt-10 lg:pt-14">
        <Container>
          <Link
            href="/blog"
            className="inline-flex items-center gap-1.5 text-sm font-semibold text-slate-600 hover:text-slate-900 transition"
          >
            <ArrowLeft size={14} /> All posts
          </Link>
          <div className="mt-7 max-w-3xl">
            <Eyebrow hue={hue} className="mb-5">{post.category}</Eyebrow>
            <h1
              className="font-extrabold tracking-[-0.03em] text-slate-900"
              style={{ fontSize: "clamp(2rem, 4.4vw, 3.4rem)", lineHeight: 1.06 }}
            >
              {post.title}
            </h1>
            <p className="mt-6 text-lg text-slate-600 leading-relaxed">{post.excerpt}</p>
            <div className="mt-7 flex flex-wrap items-center gap-x-5 gap-y-2 text-sm text-slate-500">
              <span className="font-semibold text-slate-900">{post.author}</span>
              <span>·</span>
              <span>{post.authorRole}</span>
              <span className="inline-flex items-center gap-1.5"><Calendar size={12} /> {post.date}</span>
              <span className="inline-flex items-center gap-1.5"><Clock size={12} /> {post.readTime}</span>
            </div>
          </div>
        </Container>
      </Section>

      <Section py="md">
        <Container>
          <article
            className={`prose prose-slate max-w-3xl mx-auto
              prose-headings:font-extrabold prose-headings:tracking-tight prose-headings:text-slate-900
              prose-h2:text-2xl prose-h2:mt-12 prose-h2:mb-4
              prose-h3:text-xl prose-h3:mt-8 prose-h3:mb-3
              prose-p:text-[16px] prose-p:leading-[1.75] prose-p:text-slate-700
              prose-li:text-[16px] prose-li:leading-[1.75] prose-li:text-slate-700
              prose-ul:list-disc prose-ul:pl-6 prose-ul:space-y-2
              prose-blockquote:border-l-4 prose-blockquote:pl-5 prose-blockquote:italic prose-blockquote:text-slate-600
              prose-strong:text-slate-900 prose-strong:font-bold
              prose-a:text-violet-700 prose-a:font-semibold prose-a:no-underline hover:prose-a:underline`}
            dangerouslySetInnerHTML={{ __html: html }}
          />
        </Container>
      </Section>

      {/* Tag strip */}
      {post.tags && post.tags.length > 0 && (
        <Section py="sm">
          <Container>
            <div className="max-w-3xl mx-auto flex flex-wrap gap-2">
              {post.tags.map((tag) => (
                <span key={tag} className={`inline-flex items-center text-xs font-bold uppercase tracking-[0.14em] px-3 h-7 rounded-full ${t.bgTint} ${t.text} border ${t.border}`}>
                  {tag}
                </span>
              ))}
            </div>
          </Container>
        </Section>
      )}

      {/* Related */}
      {related.length > 0 && (
        <Section variant="tint" py="lg">
          <Container>
            <h3 className="text-2xl font-extrabold text-slate-900 tracking-tight mb-8">Keep reading</h3>
            <div className="grid md:grid-cols-3 gap-5">
              {related.map((r) => {
                const rt = HUES[hueForCategory(r.category)];
                return (
                  <Link
                    key={r.slug}
                    href={`/blog/${r.slug}`}
                    className="group p-6 bg-white border border-slate-200 rounded-2xl hover:border-slate-300 hover:-translate-y-0.5 transition shadow-sm"
                  >
                    <span className={`inline-flex items-center text-[10px] font-bold uppercase tracking-[0.16em] px-2.5 h-6 rounded-full ${rt.bgTint} ${rt.text} border ${rt.border}`}>
                      {r.category}
                    </span>
                    <p className="mt-4 font-bold text-slate-900 text-lg tracking-tight leading-snug">{r.title}</p>
                    <p className="mt-3 text-sm text-slate-600 line-clamp-2">{r.excerpt}</p>
                    <span className={`mt-4 inline-flex items-center gap-1 text-sm font-semibold ${rt.text} group-hover:gap-2 transition-all`}>
                      Read <ArrowRight size={13} />
                    </span>
                  </Link>
                );
              })}
            </div>
          </Container>
        </Section>
      )}

      <CTABand
        hue={hue}
        title={<>Run your business <GradientText hue="amber">like a product</GradientText>.</>}
        body="Start free under 5 people. No credit card. All 7 hubs unlocked."
      />
    </>
  );
}
