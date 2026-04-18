"use client";

import { createContext, useContext, useState, useCallback } from "react";
import { useRouter } from "next/navigation";
import {
  currencies,
  defaultCurrency,
  formatFromUSD,
  formatMoney,
  type Currency,
} from "@/lib/currency";

interface CurrencyContextValue {
  currency: Currency;
  setCurrency: (next: Currency) => void;
  format: (amount: number) => string;
  formatFromUSD: (amountUsd: number) => string;
  info: (typeof currencies)[Currency];
}

const CurrencyContext = createContext<CurrencyContextValue | null>(null);

export function CurrencyProvider({
  initial,
  children,
}: {
  initial?: Currency;
  children: React.ReactNode;
}) {
  const [currency, setCurrencyState] = useState<Currency>(
    initial ?? defaultCurrency,
  );
  const router = useRouter();

  const setCurrency = useCallback(
    (next: Currency) => {
      setCurrencyState(next);
      fetch("/api/currency", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ currency: next }),
      })
        .catch(() => {})
        .finally(() => router.refresh());
    },
    [router],
  );

  const value: CurrencyContextValue = {
    currency,
    setCurrency,
    format: (amount: number) => formatMoney(amount, currency),
    formatFromUSD: (amountUsd: number) => formatFromUSD(amountUsd, currency),
    info: currencies[currency],
  };

  return (
    <CurrencyContext.Provider value={value}>{children}</CurrencyContext.Provider>
  );
}

export function useCurrency() {
  const ctx = useContext(CurrencyContext);
  if (!ctx) throw new Error("useCurrency must be used within CurrencyProvider");
  return ctx;
}
