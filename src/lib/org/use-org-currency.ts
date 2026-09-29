"use client";

// useOrgCurrency: the workspace currency from the boot payload, and two
// formatters bound to it and to the viewer's locale: `format` (compact above
// a thousand, for totals) and `formatExact` (the full figure, for a record).

import { useCallback } from "react";
import { useBoot } from "@/components/layout/os/boot-context";
import { formatOrgMoney, ORG_CURRENCY_FALLBACK } from "./org-currency";

export function useOrgCurrency(): { currency: string; format: (amount: number) => string; formatExact: (amount: number) => string } {
  const { boot } = useBoot();
  const currency = boot.org.currency ?? ORG_CURRENCY_FALLBACK;
  const format = useCallback((amount: number) => formatOrgMoney(amount, currency), [currency]);
  const formatExact = useCallback((amount: number) => formatOrgMoney(amount, currency, undefined, { exact: true }), [currency]);
  return { currency, format, formatExact };
}
