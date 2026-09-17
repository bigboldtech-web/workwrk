import type { Metadata } from "next";
import { Inter, JetBrains_Mono } from "next/font/google";
import { NextIntlClientProvider } from "next-intl";
import { getLocale, getMessages } from "next-intl/server";
import { Providers } from "@/components/layout/providers";
import { rtlLocales, type Locale } from "@/i18n/config";
import { resolveCurrency } from "@/lib/currency-server";
import "./globals.css";

// Two families only (design-system 2.1): Inter for everything, JetBrains
// Mono for code, formulas and IDs. Both self-hosted and subset by next/font;
// never a Google Fonts <link>. Outfit, Syne, Geist, Geist Mono, Instrument
// Serif and Figtree were dropped; globals.css aliases their old variables to
// these two for one release so no surface loses its font.
const inter = Inter({
  variable: "--font-inter",
  subsets: ["latin"],
  weight: ["400", "500", "600"],
  display: "swap",
});

const jetbrainsMono = JetBrains_Mono({
  variable: "--font-mono",
  subsets: ["latin"],
  weight: ["400", "500"],
  display: "swap",
});

export const metadata: Metadata = {
  metadataBase: new URL("https://workwrk.com"),
  title: {
    default: "WorkwrK — The operating system for teams that mean business",
    template: "%s · WorkwrK",
  },
  description:
    "One system for people, performance, KPIs, SOPs, and AI. Replaces 15 disconnected tools. Built for Indian SMBs scaling from 25 to 500 people.",
  applicationName: "WorkwrK",
  keywords: [
    "business operating system",
    "performance management software India",
    "KPI tracking",
    "SOP management software",
    "360 review platform",
    "employee recognition kudos",
    "OKR software India",
    "AI business intelligence",
    "HR operations India",
    "SaaS for Indian SMBs",
    "workwrk",
  ],
  authors: [{ name: "WorkwrK" }],
  creator: "WorkwrK",
  publisher: "WorkwrK",
  robots: {
    index: true,
    follow: true,
    googleBot: {
      index: true,
      follow: true,
      "max-video-preview": -1,
      "max-image-preview": "large",
      "max-snippet": -1,
    },
  },
  openGraph: {
    type: "website",
    locale: "en_IN",
    siteName: "WorkwrK",
    title: "WorkwrK — The operating system for teams that mean business",
    description:
      "People, performance, KPIs, SOPs, and AI in one system. Built for teams scaling past 25.",
    url: "https://workwrk.com",
  },
  twitter: {
    card: "summary_large_image",
    title: "WorkwrK — Business Operating System",
    description:
      "One system for people, performance, KPIs, SOPs, and AI. Replaces 15 tools. Built for Indian SMBs.",
    creator: "@workwrk",
  },
  alternates: {
    canonical: "https://workwrk.com",
  },
  category: "Business Software",
};

export default async function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  const locale = (await getLocale()) as Locale;
  const messages = await getMessages();
  const currency = await resolveCurrency();
  const dir = rtlLocales.includes(locale) ? "rtl" : "ltr";

  return (
    <html
      lang={locale}
      dir={dir}
      className={`${inter.variable} ${jetbrainsMono.variable}`}
      suppressHydrationWarning
    >
      <body className="min-h-screen bg-background font-sans text-foreground antialiased">
        <NextIntlClientProvider locale={locale} messages={messages}>
          <Providers initialCurrency={currency}>{children}</Providers>
        </NextIntlClientProvider>
      </body>
    </html>
  );
}
