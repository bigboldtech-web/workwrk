"use client";

import { SessionProvider } from "next-auth/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { ThemeProvider, useTheme } from "next-themes";
import { useEffect, useState } from "react";
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
      >
        <NightModeSync />
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

// NightModeSync — keeps the `.dark` class on the html element when
// the active theme is "night", so every Tailwind `dark:` modifier
// keeps firing while `.night` overrides surface tokens to OLED black.
//
// We can't ask next-themes to apply two classes at once because its
// `value` map runs through `classList.add(value)` and DOMs throw on
// strings with spaces. So night-mode applies a single `.night` class,
// and this effect adds `.dark` alongside it.
function NightModeSync() {
  const { resolvedTheme } = useTheme();
  useEffect(() => {
    if (typeof document === "undefined") return;
    const root = document.documentElement;
    if (resolvedTheme === "night") {
      root.classList.add("dark");
    }
    // We deliberately don't strip `.dark` here when theme is "dark"
    // because next-themes already sets it. When the user switches
    // away from night back to light, next-themes removes `.dark` for
    // us. If the user switches night → dark, `.dark` stays — perfect.
    // If they switch night → light, next-themes removes `.dark` and
    // we manually remove `.night` below.
    if (resolvedTheme !== "night") {
      root.classList.remove("night");
    }
  }, [resolvedTheme]);
  return null;
}
