"use client";

// The currency, as one piece of state for the whole pricing page.
//
// The defect this exists to fix: the toggle lived inside PricingTiers, so
// switching to INR changed the three cards and nothing else. The hero lede
// one screen above them is server rendered from `detectCurrency()`, so the
// money page contradicted itself two lines apart, reading
// "$8 per member per month after that" directly above a Growth card showing
// the rupee price. The toggle also carried no URL parameter, so the state
// could not be linked, shared, or reloaded into.
//
// So the currency is a context, this provider owns it, and everything that
// prints money on the page reads the same value. The provider wraps server
// rendered children, which is allowed and is the point: the CTAs, the
// comparison table and the FAQ stay on the server and only the few nodes
// that show a price are client.
//
// The URL is written with replaceState rather than a router push. A price
// toggle is not navigation: it should not add a history entry a visitor has
// to press Back through, and it must not re-run the server component (which
// would re-read the geo header and fight the visitor's own choice). The
// parameter is read once, on the server, to seed this provider.

import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";

import { CURRENCY_CODES, formatMoney, isMarketingCurrency, type MarketingCurrency } from "./data/pricing";
import { trackReceipt } from "./instrumentation";
import "./home/home.css";

interface CurrencyState {
  currency: MarketingCurrency;
  setCurrency: (next: MarketingCurrency) => void;
}

const Ctx = createContext<CurrencyState | null>(null);

export function useMarketingCurrency(): CurrencyState {
  const value = useContext(Ctx);
  if (!value) {
    throw new Error("useMarketingCurrency must be used inside PricingCurrencyProvider");
  }
  return value;
}

export function PricingCurrencyProvider({
  initialCurrency,
  children,
}: {
  initialCurrency: MarketingCurrency;
  children: ReactNode;
}) {
  const [currency, setCurrencyState] = useState<MarketingCurrency>(initialCurrency);

  // A shared link carries ?currency=, and the server already seeds from it.
  // This is the belt for a back or forward navigation inside the page.
  useEffect(() => {
    const onPop = () => {
      const fromUrl = new URLSearchParams(window.location.search).get("currency");
      if (fromUrl && isMarketingCurrency(fromUrl)) setCurrencyState(fromUrl);
    };
    window.addEventListener("popstate", onPop);
    return () => window.removeEventListener("popstate", onPop);
  }, []);

  const setCurrency = useCallback((next: MarketingCurrency) => {
    setCurrencyState(next);
    trackReceipt("currency", { currency: next, page: "pricing" });
    try {
      const url = new URL(window.location.href);
      url.searchParams.set("currency", next);
      window.history.replaceState(window.history.state, "", url);
    } catch {
      // A sandboxed frame can refuse replaceState. The toggle still works;
      // only the shareable URL is lost, which is the lesser half.
    }
  }, []);

  const value = useMemo(() => ({ currency, setCurrency }), [currency, setCurrency]);
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

/** The six buttons. One group, wherever the page wants to put it. */
export function CurrencyToggle({ className, style }: { className?: string; style?: React.CSSProperties }) {
  const { currency, setCurrency } = useMarketingCurrency();
  return (
    <div className={`mk-currency${className ? ` ${className}` : ""}`} role="group" aria-label="Currency" style={style}>
      {CURRENCY_CODES.map((code) => (
        <button
          key={code}
          type="button"
          className="mk-focus"
          aria-pressed={code === currency}
          onClick={() => setCurrency(code)}
        >
          {code}
        </button>
      ))}
    </div>
  );
}

/**
 * One money amount, in whatever the toggle currently says.
 *
 * `amounts` is the per currency table straight from the pricing source, so
 * this component converts nothing: it picks. A tier with no number in a
 * currency (the quoted tier) renders `fallback`.
 */
export function Money({
  amounts,
  fallback,
}: {
  amounts: Partial<Record<MarketingCurrency, number | null>>;
  fallback: string;
}) {
  const { currency } = useMarketingCurrency();
  const amount = amounts[currency];
  if (amount === null || amount === undefined) return <>{fallback}</>;
  return <>{formatMoney(amount, currency)}</>;
}
