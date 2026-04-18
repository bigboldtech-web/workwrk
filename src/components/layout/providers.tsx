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
      <ThemeProvider attribute="class" defaultTheme="dark" enableSystem>
        <QueryClientProvider client={queryClient}>
          <CurrencyProvider initial={initialCurrency}>{children}</CurrencyProvider>
        </QueryClientProvider>
      </ThemeProvider>
    </SessionProvider>
  );
}
