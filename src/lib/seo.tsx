import type { Metadata } from "next";
import { locales, type Locale } from "@/i18n/config";

export const SITE_URL = "https://workwrk.com";
export const SITE_NAME = "WorkwrK";
export const SITE_TAGLINE = "The operating system for teams that mean business";

interface PageMetaOpts {
  title: string;
  description: string;
  path: string;
  keywords?: string[];
  ogImage?: string;
  noIndex?: boolean;
}

export function buildPageMetadata(opts: PageMetaOpts): Metadata {
  const { title, description, path, keywords, ogImage, noIndex } = opts;
  const url = `${SITE_URL}${path}`;
  const languages = Object.fromEntries(
    locales.map((loc) => [loc, url]),
  ) as Record<Locale, string>;

  return {
    title,
    description,
    keywords,
    alternates: {
      canonical: url,
      languages: { ...languages, "x-default": url },
    },
    openGraph: {
      type: "website",
      url,
      title,
      description,
      siteName: SITE_NAME,
      images: ogImage ? [{ url: ogImage }] : undefined,
    },
    twitter: {
      card: "summary_large_image",
      title,
      description,
      images: ogImage ? [ogImage] : undefined,
      creator: "@workwrk",
    },
    robots: noIndex
      ? { index: false, follow: false }
      : { index: true, follow: true },
  };
}

interface JsonLdFaq {
  q: string;
  a: string;
}

export function faqJsonLd(faqs: JsonLdFaq[]) {
  return {
    "@context": "https://schema.org",
    "@type": "FAQPage",
    mainEntity: faqs.map((f) => ({
      "@type": "Question",
      name: f.q,
      acceptedAnswer: { "@type": "Answer", text: f.a },
    })),
  };
}

export function organizationJsonLd() {
  return {
    "@context": "https://schema.org",
    "@type": "Organization",
    name: SITE_NAME,
    url: SITE_URL,
    logo: `${SITE_URL}/icon.png`,
    description:
      "WorkwrK is the Business Operating System that unifies people, performance, KPIs, SOPs, reviews, kudos and AI in one platform.",
    sameAs: [
      "https://twitter.com/workwrk",
      "https://www.linkedin.com/company/workwrk",
    ],
    contactPoint: {
      "@type": "ContactPoint",
      email: "hello@workwrk.com",
      contactType: "sales",
      areaServed: "Worldwide",
      availableLanguage: [
        "English",
        "Hindi",
        "Spanish",
        "French",
        "German",
        "Portuguese",
        "Arabic",
        "Japanese",
        "Chinese",
      ],
    },
  };
}

export function softwareApplicationJsonLd() {
  return {
    "@context": "https://schema.org",
    "@type": "SoftwareApplication",
    name: SITE_NAME,
    applicationCategory: "BusinessApplication",
    operatingSystem: "Web",
    description:
      "Business Operating System: people, KPIs, KRAs, SOPs, reviews, OKRs, tasks, kudos, and AI in one system.",
    url: SITE_URL,
    offers: [
      {
        "@type": "Offer",
        name: "Starter",
        price: "0",
        priceCurrency: "USD",
        description: "Free up to 10 users",
      },
      {
        "@type": "Offer",
        name: "Growth",
        price: "4",
        priceCurrency: "USD",
        description: "Per user / month — unlimited modules",
      },
    ],
    aggregateRating: {
      "@type": "AggregateRating",
      ratingValue: "4.8",
      ratingCount: "284",
      bestRating: "5",
      worstRating: "1",
    },
    featureList: [
      "Performance scoring",
      "KRA / KPI management",
      "SOP library with AI extraction (Scribe)",
      "360° performance reviews",
      "OKR cascading",
      "Task auto-escalation",
      "Peer kudos & recognition",
      "AI business reasoning engine",
      "Analytics & exports",
      "40+ integrations",
      "Role-based access control",
      "GDPR / CCPA compliance",
    ],
  };
}

interface BreadcrumbItem {
  name: string;
  path: string;
}

export function breadcrumbJsonLd(items: BreadcrumbItem[]) {
  return {
    "@context": "https://schema.org",
    "@type": "BreadcrumbList",
    itemListElement: items.map((item, idx) => ({
      "@type": "ListItem",
      position: idx + 1,
      name: item.name,
      item: `${SITE_URL}${item.path}`,
    })),
  };
}

export function productJsonLd(opts: {
  name: string;
  description: string;
  path: string;
}) {
  return {
    "@context": "https://schema.org",
    "@type": "Product",
    name: opts.name,
    description: opts.description,
    url: `${SITE_URL}${opts.path}`,
    brand: { "@type": "Brand", name: SITE_NAME },
  };
}

export function JsonLd({ data }: { data: object | object[] }) {
  const payload = Array.isArray(data) ? data : [data];
  return (
    <>
      {payload.map((d, i) => (
        <script
          key={i}
          type="application/ld+json"
          dangerouslySetInnerHTML={{ __html: JSON.stringify(d) }}
        />
      ))}
    </>
  );
}
