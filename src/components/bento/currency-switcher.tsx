"use client";

import { useState } from "react";
import { useCurrency } from "@/components/layout/currency-provider";
import { currencies, type Currency } from "@/lib/currency";

export function CurrencySwitcher() {
  const { currency, setCurrency, info } = useCurrency();
  const [open, setOpen] = useState(false);

  const onSelect = (next: Currency) => {
    setOpen(false);
    if (next !== currency) setCurrency(next);
  };

  return (
    <div className="bento-curr-wrap">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-label="Change currency"
        aria-expanded={open}
        className="bento-curr-btn"
      >
        <span aria-hidden className="bento-curr-sym">
          {info.symbol}
        </span>
        <span className="bento-curr-code">{currency}</span>
      </button>
      {open && (
        <>
          <button
            type="button"
            aria-label="Close currency menu"
            className="bento-pop-scrim"
            onClick={() => setOpen(false)}
          />
          <div role="menu" className="bento-pop bento-pop-right">
            {(Object.keys(currencies) as Currency[]).map((code) => {
              const c = currencies[code];
              return (
                <button
                  key={code}
                  role="menuitem"
                  type="button"
                  className={`bento-pop-item${code === currency ? " is-active" : ""}`}
                  onClick={() => onSelect(code)}
                >
                  <span className="bento-pop-item-code">{c.symbol}</span>
                  <span className="bento-pop-item-name">
                    {code} · {c.name}
                  </span>
                </button>
              );
            })}
          </div>
        </>
      )}
      <style jsx>{`
        .bento-curr-wrap {
          position: relative;
        }
        .bento-curr-btn {
          display: inline-flex;
          align-items: center;
          gap: 6px;
          padding: 7px 12px;
          border-radius: 100px;
          font-size: 12px;
          color: var(--b-t2);
          background: var(--b-card);
          border: 1px solid var(--b-line);
          cursor: pointer;
          font-family: inherit;
          transition: all 0.2s;
        }
        .bento-curr-btn:hover {
          color: var(--b-fg);
          border-color: var(--b-line-2);
        }
        .bento-curr-sym {
          font-family: var(--font-geist), sans-serif;
          color: var(--b-lime);
          font-weight: 600;
        }
        .bento-curr-code {
          font-family: var(--font-geist-mono), monospace;
          letter-spacing: 0.04em;
        }
      `}</style>
    </div>
  );
}
