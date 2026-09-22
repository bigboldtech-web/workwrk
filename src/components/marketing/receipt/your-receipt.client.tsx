"use client";

// The visitor's OWN receipt, carried from Home to /pricing.
//
// Concept 5 asks the pricing page to be "prefilled from Home (localStorage
// or query string)". Only the query string half was built, so the funnel
// leaked on the likelier of the two paths: a visitor who tapped their
// categories on the home page and clicked the money band's own "See full
// pricing" link kept their number, because that link carries the query, but
// a visitor who used the sticky nav's Pricing link, which is on screen the
// whole time, arrived at a pricing page with no receipt on it at all and no
// sign that anything had been lost.
//
// /pricing is a Server Component and localStorage is a browser fact, so the
// read has to happen in an island. The mechanism already existed one file
// over: the sticky bar reads the same record with `readStoredReceipt` and
// recomputes with `stackReceipt`, edits included, and this does exactly
// that and hands the result to the same Receipt the shared path renders.
//
// It renders NOTHING until the effect has run. That is deliberate rather
// than lazy: the server cannot know what is in a visitor's browser, so a
// first paint that guessed would be a hydration mismatch, and a placeholder
// would reserve a band on the page for most visitors, who have no stored
// receipt at all.

import { useEffect, useState } from "react";

import { PERSONAL_NUMBER_EVENT, readStoredReceipt } from "../personal-number";
import { stackReceipt } from "../data/pricing";
import { receiptShareQuery, stackReceiptModelFrom, type ReceiptModel } from "./stack-model";
import { Receipt } from "./receipt";

export function YourReceipt() {
  const [model, setModel] = useState<ReceiptModel | null>(null);
  const [href, setHref] = useState<string>("/");

  useEffect(() => {
    const read = () => {
      const stored = readStoredReceipt();
      if (!stored || stored.selected.length === 0) {
        setModel(null);
        return;
      }
      const receipt = stackReceipt({
        selected: stored.selected,
        seats: stored.seats,
        currency: stored.currency,
        overrides: stored.overrides,
      });
      setModel(stackReceiptModelFrom(receipt));
      setHref(
        `/?${receiptShareQuery({
          selected: stored.selected,
          seats: stored.seats,
          currency: stored.currency,
          overrides: stored.overrides,
        })}#stack-receipt`,
      );
    };
    read();
    // The calculator lives on Home, so this listener matters only where the
    // two share a page. It costs nothing and it keeps the two readers of
    // this record behaving the same way.
    document.addEventListener(PERSONAL_NUMBER_EVENT, read);
    return () => document.removeEventListener(PERSONAL_NUMBER_EVENT, read);
  }, []);

  if (!model) return null;

  return (
    <section className="mk-band" data-tone="plain" aria-labelledby="mk-your-stack">
      <div className="mk-wrap">
        <p className="mk-eyebrow">Your stack</p>
        <h2 id="mk-your-stack" className="mk-title-lg" style={{ maxWidth: "18ch" }}>
          The number you built on the home page.
        </h2>
        <div style={{ marginTop: 18, maxWidth: 520 }}>
          <Receipt model={model} className="mk-lift" />
        </div>
        <p className="mk-note" style={{ marginTop: 14 }}>
          <a className="mk-focus" style={{ color: "var(--os-brand-deep)" }} href={href}>
            Change the categories or the seat count
          </a>
        </p>
      </div>
    </section>
  );
}
