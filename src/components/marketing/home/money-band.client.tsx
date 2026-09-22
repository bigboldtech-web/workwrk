"use client";

// Your Stack Receipt, the currency toggle, and the pricing preview
// (concept 3 rows 9 and 10, and section 9).
//
// These three are ONE island because they share one number. The receipt
// prices the visitor's own stack in their currency; the tier cards print
// the same currency and a "replaces roughly X per seat" line computed from
// the same table. Splitting them would mean two sources for one currency,
// which is how a page ends up quoting dollars in the receipt and rupees in
// the cards.
//
// What crosses the boundary, and what does not:
//
//   * The pricing source does cross. The calculator is arithmetic over it,
//     so it has to. It is one small JSON.
//   * The Tuesday fixture does NOT. Nothing here imports from data/tuesday,
//     and the receipt component reads its four dot hexes from ../dots for
//     exactly that reason.
//   * Every CTA is a server rendered node handed in as a prop, so the
//     config, the flags and the fixture stay on the server.
//
// Honesty in the arithmetic: prices are dated public list price midpoints
// for a CATEGORY, never for a vendor, they carry their `asOf` date in a
// footnote, and every line is editable, so the receipt is the visitor's
// number rather than ours. The WorkwrK line is the tier their seat count
// actually lands on, including the free one, at zero.

import { useEffect, useMemo, useState, type ReactNode } from "react";

import { Receipt } from "../receipt/receipt";
import { personalNumberLabel, receiptShareQuery, stackReceiptModelFrom } from "../receipt/stack-model";
import { CURRENCY_CODES, categoryPerSeat, formatMoney, pricing, stackReceipt, type MarketingCurrency } from "../data/pricing";
import { CategoryTiles } from "../category-tiles";
import { trackReceipt } from "../instrumentation";
import { writeStoredReceipt } from "../personal-number";
import "./home.css";

export interface MoneyBandProps {
  /** Server rendered. The one filled button in the receipt section. */
  receiptCta: ReactNode;
  /**
   * The door for a visitor the receipt cannot price.
   *
   * Above the top tier's seat cap the calculator stops guessing, and the
   * section used to keep offering the free tier's button to the largest
   * prospect on the page: someone who has just typed their seat count and
   * been told it is quote-only got "Start free" and no way to talk to
   * anyone. This replaces the primary in that branch, so the section still
   * has exactly one filled button.
   */
  escalateCta: ReactNode;
  /** Server rendered, one per tier, in pricing order. */
  /** The geo detected starting currency, decided on the server. */
  initialCurrency: MarketingCurrency;
  /** Icon nodes for the fourteen category chips, keyed by category id. */
  glyphs: Record<string, ReactNode>;
  /** The link to the full pricing page. */
  pricingHref: string;
}

/**
 * The seat slider's tick marks.
 *
 * The range is LINEAR from 1 to 500, so the old list (5, 10, 25, 50, 100,
 * 200, 500) put six of its seven marks inside the first 40 percent of the
 * track and left the right three fifths of it bare: the marks looked like
 * they had run out rather than like a scale. These keep the two numbers
 * that mean something, 10 and 50, which are the free tier's cap and the
 * point above which the page stops quoting a price, and then step evenly to
 * the end so the track is a scale all the way along it.
 */
const TICKS = [10, 50, 100, 150, 200, 250, 300, 350, 400, 450, 500];

const SR_ONLY: React.CSSProperties = {
  position: "absolute",
  width: 1,
  height: 1,
  padding: 0,
  margin: -1,
  overflow: "hidden",
  clip: "rect(0 0 0 0)",
  whiteSpace: "nowrap",
  border: 0,
};

export function MoneyBand({
  receiptCta,
  escalateCta,
  initialCurrency,
  glyphs,
  pricingHref,
}: MoneyBandProps) {
  const [currency, setCurrency] = useState<MarketingCurrency>(initialCurrency);
  const [seats, setSeats] = useState<number>(pricing.defaultSeats);
  const [selected, setSelected] = useState<string[]>([]);
  const [overrides, setOverrides] = useState<Record<string, number>>({});
  const [copied, setCopied] = useState(false);
  /** Set when the clipboard is refused, so the link can be shown instead. */
  const [shareUrl, setShareUrl] = useState<string | null>(null);

  const receipt = useMemo(
    () => stackReceipt({ selected, seats, currency, overrides }),
    [selected, seats, currency, overrides],
  );
  const model = useMemo(() => stackReceiptModelFrom(receipt), [receipt]);
  const personal = personalNumberLabel(receipt);

  // The personal number outlives this section: the sticky bar and the close
  // read it, and /pricing opens prefilled from it. Writing it here, from the
  // computed receipt, is what keeps those three consistent with what is on
  // screen. A receipt with nothing to keep clears the record instead.
  useEffect(() => {
    if (receipt.keepMonthly !== null && receipt.keepMonthly > 0 && selected.length > 0) {
      writeStoredReceipt({ selected, seats, currency, overrides, keep: receipt.keepMonthly });
    } else {
      writeStoredReceipt(null);
    }
  }, [receipt.keepMonthly, selected, seats, currency, overrides]);

  const toggle = (id: string) => {
    setCopied(false);
    setSelected((prev) => {
      const next = prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id];
      trackReceipt("chip", { id, on: !prev.includes(id), count: next.length });
      return next;
    });
  };

  const changeCurrency = (code: MarketingCurrency) => {
    setCurrency(code);
    // An override is a price in the OLD currency. Carrying it across would
    // print, say, 12 rupees a seat for a task tracker and call it the
    // visitor's own number. They are dropped, and the list prices for the
    // new currency take over.
    setOverrides({});
    setCopied(false);
    trackReceipt("currency", { currency: code });
  };

  const copy = async () => {
    const url = `${window.location.origin}/pricing?${receiptShareQuery({ selected, seats, currency, overrides })}`;
    setShareUrl(null);
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      trackReceipt("copy", { seats, currency, tools: selected.length, edited: Object.keys(overrides).length });
      window.setTimeout(() => setCopied(false), 4000);
    } catch {
      // A browser that refuses the clipboard, or a page served without a
      // secure context, still has to give the visitor the link rather than
      // claim a copy that did not happen. It goes into a field on the page.
      //
      // NOT `window.prompt`. That was the first version, and a native modal
      // blocks the whole page until it is dismissed: a permissions prompt
      // the visitor never sees, in a headless or embedded context, hangs
      // the page on a button press.
      setShareUrl(url);
    }
  };

  return (
    <>
      <section className="mk-band" id="stack-receipt" aria-labelledby="mk-calc">
        <div className="mk-wrap">
          {/* Six words, one sentence, on the kit's ramp. It read "What does
              your stack cost? Tap what you pay for." at 46px: nine words and
              two sentences, which is the headline rule broken twice in one
              line. The instruction moved to the sentence under it, which is
              where an instruction goes. */}
          <h2 id="mk-calc" className="ic-h2 mk-reveal">
            What does your stack cost?
          </h2>
          <p className="ic-line mk-reveal">Tap the categories you pay for and the receipt prints itself.</p>

          <div className="mk-calc" style={{ marginTop: 28 }}>
            <div>
              {/* The same grid /demo renders as its "tools you use today"
                  field. One component, so the two cannot drift. */}
              <CategoryTiles
                selected={selected}
                onToggle={toggle}
                glyphs={glyphs}
                priceFor={(id) => formatMoney(categoryPerSeat(id, currency), currency)}
                ariaLabel="Tool categories you pay for"
              />

              <div className="mk-seats">
                <label htmlFor="mk-seat-range" style={{ fontSize: 14, color: "var(--os-ink-2)" }}>
                  Seats
                </label>
                <input
                  id="mk-seat-range"
                  type="range"
                  min={1}
                  max={500}
                  step={1}
                  value={seats}
                  // The unit, spoken. Without it a screen reader announces
                  // a bare number across a 1 to 500 range and the listener
                  // has to infer what it counts from the label alone.
                  aria-valuetext={`${seats} ${seats === 1 ? "seat" : "seats"}`}
                  list="mk-seat-ticks"
                  onChange={(e) => {
                    setSeats(Number(e.target.value));
                    setCopied(false);
                  }}
                  onPointerUp={() => trackReceipt("seats", { seats })}
                />
                <datalist id="mk-seat-ticks">
                  {TICKS.map((t) => (
                    <option key={t} value={t} />
                  ))}
                </datalist>
                <span className="mk-seats__value mk-figures">
                  {seats} {seats === 1 ? "seat" : "seats"}
                </span>
                <div className="mk-currency" role="group" aria-label="Currency">
                  {CURRENCY_CODES.map((code) => (
                    <button
                      key={code}
                      type="button"
                      className="mk-focus"
                      aria-pressed={code === currency}
                      onClick={() => changeCurrency(code)}
                    >
                      {code}
                    </button>
                  ))}
                </div>
              </div>

              {receipt.lines.length > 0 ? (
                <div style={{ marginTop: 18 }}>
                  <p className="mk-note" style={{ marginBottom: 8 }}>
                    These are category midpoints. Change any of them to what you actually pay.
                  </p>
                  <div style={{ display: "grid", gap: 6, maxWidth: 460 }}>
                    {receipt.lines.map((line) => (
                      <div key={line.id} style={{ display: "flex", alignItems: "center", gap: 10, fontSize: 13 }}>
                        <label htmlFor={`mk-edit-${line.id}`} style={{ flex: "1 1 auto", color: "var(--os-ink-2)" }}>
                          {line.label}
                        </label>
                        <input
                          id={`mk-edit-${line.id}`}
                          className="mk-edit mk-focus"
                          type="number"
                          min={0}
                          max={999}
                          inputMode="decimal"
                          value={line.perSeat}
                          aria-label={`${line.label}, price per seat`}
                          onChange={(e) => {
                            const value = Number(e.target.value);
                            setOverrides((prev) => ({ ...prev, [line.id]: Number.isFinite(value) ? value : 0 }));
                            setCopied(false);
                            trackReceipt("edit", { id: line.id });
                          }}
                        />
                        <span style={{ color: "var(--os-ink-2)", flex: "0 0 auto" }}>per seat</span>
                      </div>
                    ))}
                  </div>
                </div>
              ) : null}
            </div>

            <div>
              {/* The answer, announced.
                  Fourteen toggles, a seat slider and a six-way currency
                  group all recompute one number, and that number had no live
                  region: a screen-reader visitor could work every control
                  correctly and never learn the result, which is the whole
                  point of the section. It is polite and it is one sentence,
                  not fourteen: the receipt itself stays a plain group. */}
              <p aria-live="polite" className="mk-sr" style={SR_ONLY}>
                {receipt.lines.length === 0
                  ? "No categories selected yet."
                  : `${receipt.toolCount} ${receipt.toolCount === 1 ? "tool" : "tools"} at ${receipt.seats} seats: ${formatMoney(receipt.oldMonthly, currency)} a month today, against ${receipt.workwrkMonthly === null ? "a quoted price" : `${formatMoney(receipt.workwrkMonthly, currency)} a month`} on WorkwrK ${receipt.workwrkTierName}.${personal ? ` ${personal}.` : ""}`}
              </p>
              <Receipt model={model} className="mk-lift" />
              <div className="mk-ctarow" style={{ marginTop: 18 }}>
                {receipt.escalate ? escalateCta : receiptCta}
                {/* Disabled until there is a receipt to copy.
                    It used to be live over an empty receipt, so a visitor
                    who pressed it before tapping a tile copied a link whose
                    share card reads "Tap the categories you pay for and the
                    receipt prints here". Concept section 9 makes the share
                    the payoff of the visitor's OWN selection, and a share
                    of nothing is the one version of it that cannot land.
                    The title says why, so the disabled state is explained
                    rather than mysterious. */}
                <button
                  type="button"
                  className="mk-replay mk-focus"
                  onClick={copy}
                  disabled={selected.length === 0}
                  title={selected.length === 0 ? "Tap a category first" : undefined}
                  style={{ height: 44, marginTop: 0 }}
                >
                  {copied ? "Link copied" : "Copy my receipt"}
                </button>
              </div>
              {shareUrl ? (
                <div style={{ marginTop: 10 }}>
                  <label htmlFor="mk-share-url" className="mk-note" style={{ display: "block", marginBottom: 4 }}>
                    Your browser would not let the page copy for you. Here is the link.
                  </label>
                  <input
                    id="mk-share-url"
                    className="mk-focus"
                    readOnly
                    value={shareUrl}
                    onFocus={(e) => e.currentTarget.select()}
                    style={{
                      width: "100%",
                      height: 36,
                      paddingInline: 10,
                      border: "1px solid var(--os-line-strong)",
                      borderRadius: "var(--os-r-sm)",
                      background: "var(--os-surface)",
                      color: "var(--os-ink)",
                      font: "inherit",
                      fontSize: 13,
                    }}
                  />
                </div>
              ) : null}
              {receipt.escalate ? (
                <p className="mk-note">
                  Above {receipt.quotedAboveSeats} seats the price is quoted rather than listed, so the receipt stops
                  guessing and we talk instead.
                </p>
              ) : personal ? (
                <p className="mk-note">{personal}, on your own numbers.</p>
              ) : null}
            </div>
          </div>
        </div>
      </section>

      <section className="mk-band" aria-labelledby="mk-price">
        <div className="mk-wrap">
          <h2 id="mk-price" className="ic-h2 mk-reveal">
            Ours is less than that.
          </h2>
          <p className="ic-line mk-reveal">
            Prices are authored per currency, never converted from a stale rate, and {currency} is what you are seeing.
          </p>
          {/* "YOUR receipt", so the link carries it. It used to be a bare
              /pricing href, which opened a page with no receipt on it while
              promising one, in the site's default currency rather than the
              one the toggle above is showing. */}
          <p className="ic-note">
            <a
              href={
                receipt.lines.length > 0
                  ? `${pricingHref}?${receiptShareQuery({ selected, seats, currency, overrides })}`
                  : pricingHref
              }
              className="ic-a mk-focus"
              data-cta="receipt-full-pricing"
            >
              {receipt.lines.length > 0 ? "See the three plans, with your receipt" : "See the three plans"}
            </a>
          </p>
        </div>
      </section>
    </>
  );
}
