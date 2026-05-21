"use client";

import { SessionProvider } from "next-auth/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { ThemeProvider } from "next-themes";
import { useState } from "react";
import { CurrencyProvider } from "./currency-provider";
import { ConsentProvider } from "./consent-provider";
import { ConsentBanner } from "./consent-banner";
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
      <ThemeProvider
        attribute="class"
        defaultTheme="dark"
        enableSystem
        themes={["light", "dark", "night"]}
        value={{
          light: "light",
          dark: "dark",
          // Night = dark + an additional `night` class so Tailwind's
          // dark: modifier still fires while .night overrides surface
          // tokens to true-OLED-black.
          night: "dark night",
        }}
      >
        <QueryClientProvider client={queryClient}>
          <CurrencyProvider initial={initialCurrency}>
            <ConsentProvider>
              {children}
              <ConsentBanner />
            </ConsentProvider>
          </CurrencyProvider>
        </QueryClientProvider>
      </ThemeProvider>
    </SessionProvider>
  );
}
