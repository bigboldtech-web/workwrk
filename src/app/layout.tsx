import type { Metadata } from "next";
import { Outfit, JetBrains_Mono, Syne, Geist, Geist_Mono, Instrument_Serif } from "next/font/google";
import { NextIntlClientProvider } from "next-intl";
import { getLocale, getMessages } from "next-intl/server";
import { Providers } from "@/components/layout/providers";
import { rtlLocales, type Locale } from "@/i18n/config";
import { resolveCurrency } from "@/lib/currency-server";
import "./globals.css";

const outfit = Outfit({
  variable: "--font-outfit",
  subsets: ["latin"],
  weight: ["300", "400", "500", "600", "700"],
});

const jetbrainsMono = JetBrains_Mono({
  variable: "--font-mono",
  subsets: ["latin"],
  weight: ["400", "500"],
});

const syne = Syne({
  variable: "--font-syne",
  subsets: ["latin"],
  weight: ["400", "500", "600", "700", "800"],
});

const geist = Geist({
  variable: "--font-geist",
  subsets: ["latin"],
  weight: ["300", "400", "500", "600", "700", "800", "900"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
  weight: ["400", "500", "600"],
});

const instrumentSerif = Instrument_Serif({
  variable: "--font-instrument-serif",
  subsets: ["latin"],
  weight: ["400"],
  style: ["normal", "italic"],
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
      className={`${outfit.variable} ${jetbrainsMono.variable} ${syne.variable} ${geist.variable} ${geistMono.variable} ${instrumentSerif.variable}`}
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
