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
    default: "WorkwrK: the work platform your whole company runs on",
    template: "%s · WorkwrK",
  },
  description:
    "Tasks, plans, docs, spreadsheets, chat, people and goals in one workspace, so the work and the record of the work are the same thing.",
  applicationName: "WorkwrK",
  // NO COUNTRY IS NAMED. These read "performance management software India",
  // "OKR software India", "HR operations India" and "SaaS for Indian SMBs"
  // until 2026-09-22. The site sells in six currencies, the target market was
  // reset to ENTERPRISE, and the marketing unit's own keyword set (see
  // positioning.ts) deliberately names no geography. This one contradicted it
  // on every route that does not set its own.
  keywords: [
    "work management platform",
    "project management software",
    "task management software",
    "KPI tracking",
    "OKR software",
    "SOP management software",
    "360 review platform",
    "employee recognition kudos",
    "enterprise work platform",
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
    locale: "en_US",
    siteName: "WorkwrK",
    title: "WorkwrK: the work platform your whole company runs on",
    description:
      "Tasks, plans, docs, spreadsheets, chat, people and goals in one workspace.",
    url: "https://workwrk.com",
  },
  twitter: {
    card: "summary_large_image",
    title: "WorkwrK: one platform your whole company runs on",
    description:
      "Tasks, plans, docs, spreadsheets, chat, people and goals in one workspace.",
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
