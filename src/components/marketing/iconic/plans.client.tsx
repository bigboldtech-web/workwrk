"use client";

// The three plans on /pricing, as three ROWS and not three cards.
//
// A card grid is rule 5, and it is also what every rival on this shelf
// ships. The thing a buyer came to this page for is one number, so the
// number is set at display size with nothing boxed around it, and the words
// under it are the short answer to "what do I get".
//
// WHY THIS IS A CLIENT ISLAND AT ALL, on a page that is otherwise static:
// the currency switch. The page's own answer to "which currencies do you
// price in" is that prices are authored per currency rather than converted,
// so the number you see is the number you pay. A page that could not switch
// would be making that answer untrue for five of the six.
//
// What crosses the boundary is the pricing JSON, which is arithmetic this
// component has to do, and nothing else. Every button is a server rendered
// node handed in as a prop, so the config, the flags and the fixture stay on
// the server.
//
// WHAT CAME OFF THE CARD, and it is worth saying why rather than just
// doing it:
//
//   "Replaces roughly X per seat of tools, across N categories." The
//   category prices behind that number are authored in USD and shown in
//   other currencies through a flat presentation multiplier that
//   pricing.json itself says is "never an FX quote". It is a good line for a
//   calculator the visitor is driving, which is what /compare/your-stack is,
//   and a soft claim on a page whose headline is that the arithmetic is
//   plain. The calculator keeps it.

import { type ReactNode } from "react";

import { CURRENCY_CODES, formatMoney, pricing, tierBullets, tierPerSeat } from "../data/pricing";
import { useMarketingCurrency } from "../pricing-currency.client";
import "./iconic.css";

/**
 * The currency switch: six words in a row, not six pills.
 *
 * It is written here rather than reusing the shared `CurrencyToggle` for one
 * reason that is not taste. That component always carries its own
 * `mk-currency` class, whose pill skin lives in home.css, and home.css is on
 * this page anyway because the currency provider imports it. Two rules of
 * equal specificity then decide the look by whichever sheet the bundler put
 * last, which is not a thing to leave to chance on the money page. Same
 * state, same context, same behaviour: only the skin is this file's.
 */
function CurrencySwitch() {
  const { currency, setCurrency } = useMarketingCurrency();
  return (
    <div className="ic-currency" role="group" aria-label="Currency">
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

export function IconicPlans({
  tierCtas,
}: {
  /** Server rendered, one per tier id. */
  tierCtas: Record<string, ReactNode>;
}) {
  const { currency } = useMarketingCurrency();

  return (
    <>
      <CurrencySwitch />

      <ul className="ic-plans">
        {pricing.tiers.map((t) => {
          const perSeat = tierPerSeat(t.id, currency);
          const quoted = perSeat === null;
          const price = t.free || quoted ? t.priceLabel : formatMoney(perSeat, currency);
          // Free says how many people. Quoted says to ask. A listed price
          // says what the number is per and how it is billed, which used to
          // be split between the card and the lede a screen above it.
          const sub = t.free
            ? `Up to ${t.seatCap} people, forever`
            : quoted
              ? t.priceSubLabel
              : `${t.priceLabel}, ${t.priceSubLabel.toLowerCase()}`;
          return (
            <li key={t.id} className="ic-plan">
              <span className="ic-planname">{t.name}</span>
              <span className="ic-planprice">{price}</span>
              <span className="ic-plansub">{sub}</span>
              <span className="ic-planfor">{t.forWhom}</span>
              {t.recommended && t.recommendedNote ? (
                <span className="ic-planpick">{t.recommendedNote}</span>
              ) : null}
              <ul className="ic-planwhat">
                {tierBullets(t.id).map((b) => (
                  <li key={b}>{b}</li>
                ))}
              </ul>
              {/* Pushed to the bottom of the row by the sheet, so three
                  plans with three different bullet counts still put their
                  three buttons on one line. */}
              <span className="ic-plancta">{tierCtas[t.id]}</span>
            </li>
          );
        })}
      </ul>

      <p className="ic-note">
        Showing {currency}. Prices are authored per currency, never converted from a stale rate.
      </p>
    </>
  );
}
