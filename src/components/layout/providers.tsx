"use client";

import { SessionProvider } from "next-auth/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { ThemeProvider } from "next-themes";
import { useState } from "react";
import { CurrencyProvider } from "./currency-provider";
import type { Currency } from "@/lib/currency";

export function Providers({
  children,
  initialCurrency,
}: {
  children: React.ReactNode;
  initialCurrency?: Currency;
}) {
  const [queryClient] = useState(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: {
            staleTime: 60 * 1000,
            refetchOnWindowFocus: false,
          },
        },
      })
  );

  return (
    <SessionProvider>
      {/* next-themes stamps `.dark` AND data-theme="light|dark" before
          hydration from its localStorage key, which ThemeApplier keeps in
          sync with the stored preference (setTheme light / dark / system).
          A first visit follows the OS: the token layer's
          prefers-color-scheme guard (:root:not([data-theme="light"])) and
          the class then agree. The product default is LIGHT; a "dark"
          default here painted every light user a full dark frame on each
          cold load. Marketing and auth force bg-white on their own roots
          and are unaffected. */}
      <ThemeProvider
        attribute={["class", "data-theme"]}
        defaultTheme="system"
        enableSystem
        themes={["light", "dark"]}
      >
        <QueryClientProvider client={queryClient}>
          {/* ConsentProvider is NOT mounted here (spec-shell 1.13): the
              marketing and auth layouts mount it with their banner, and the
              app mounts it lazily inside Help > Privacy & cookies, so the
              authenticated app never fetches /api/consent at boot. */}
          <CurrencyProvider initial={initialCurrency}>{children}</CurrencyProvider>
        </QueryClientProvider>
      </ThemeProvider>
    </SessionProvider>
  );
}
