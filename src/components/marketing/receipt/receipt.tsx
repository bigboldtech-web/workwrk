// The Receipt (marketing-concept.md 4.1, 9 and 12 Phase 0 item 4).
//
// One component, two receipts. The Work Receipt is what you get: the
// connections one task made in one Tuesday. The Stack Receipt is what you
// keep: the subscriptions the visitor tapped, priced at their own seat
// count. They rhyme on purpose, so the person who screenshots one
// recognises the other, and they share this markup so they cannot drift.
//
// Typography rule from spec 13.7: the clock, both receipts and the 14 to 1
// mark are tabular. Cancellation is shown by strike-through and grey, never
// by red, so red keeps its meaning inside product surfaces.
//
// Server Component. The calculator that drives the stack receipt is a later
// stage's client island; it will pass a model in, not re-implement one.

// It reads the dot colours from ../dots, NOT from the Tuesday fixture: the
// Stack Receipt renders inside the calculator island, and importing the
// fixture for four hex values would ship the whole storyboard to the
// browser with it.
import type { ReceiptModel } from "./receipt-model";
import { DOT_HEX } from "../dots";
import "../shell/marketing-shell.css";

export function Receipt({
  model,
  width,
  className,
}: {
  model: ReceiptModel;
  /** Fixed width for the shareable slab. Omit to fill the column. */
  width?: number;
  className?: string;
}) {
  return (
    <div
      className={`mk-os mk-receipt${className ? ` ${className}` : ""}`}
      style={width ? { width, maxWidth: "100%" } : undefined}
      role="group"
      aria-label={model.kind === "work" ? "Work receipt" : "Stack receipt"}
    >
      <div style={{ display: "flex", alignItems: "baseline", gap: 12 }}>
        <h3
          className="mk-label"
          style={{
            margin: 0,
            flex: "1 1 auto",
            minWidth: 0,
            letterSpacing: "0.06em",
            textTransform: "uppercase",
            color: "var(--os-ink)",
            overflow: "hidden",
            textOverflow: "ellipsis",
            whiteSpace: "nowrap",
          }}
        >
          {model.title}
        </h3>
        <span className="mk-label" style={{ color: "var(--os-ink-2)", flex: "0 0 auto" }}>
          {model.meta}
        </span>
      </div>

      <hr className="mk-receipt__rule" />

      {model.rows.length === 0 ? (
        <p style={{ margin: 0, padding: "10px 0", fontSize: 13, color: "var(--os-ink-2)" }}>
          Tap the categories you pay for and the receipt prints here.
        </p>
      ) : (
        <ol style={{ listStyle: "none", margin: 0, padding: 0 }}>
          {model.rows.map((row) => (
            <li key={row.id} className="mk-receipt__row">
              {/* The struck cell is whichever one holds the words: a clock
                  time on the work receipt is never crossed out, a cancelled
                  subscription's name always is. */}
              <span className="mk-receipt__lead mk-figures" data-struck={row.struck === true && !row.label}>
                {row.lead}
              </span>
              {row.label ? (
                <span className="mk-receipt__label" data-struck={row.struck === true}>
                  {row.label}
                </span>
              ) : (
                <span className="mk-receipt__label" aria-hidden />
              )}
              {row.meta ? <span className="mk-receipt__meta">{row.meta}</span> : null}
              {row.dot ? <span className="mk-receipt__dot" aria-hidden style={{ background: DOT_HEX[row.dot] }} /> : null}
              {row.amount ? <span className="mk-receipt__amount mk-figures">{row.amount}</span> : null}
            </li>
          ))}
        </ol>
      )}

      {/* No totals, no rule: an empty receipt is its one sentence, not a
          sentence between two hairlines with a gap where a number goes. */}
      {model.totals.length > 0 ? <hr className="mk-receipt__rule" /> : null}

      <dl style={{ margin: 0, display: "grid", gap: 4 }}>
        {model.totals.map((total) => (
          // The totals row WRAPS.
          // The work receipt's two halves are phrases, not a label and a
          // number: "1 task, 8 modules" against "0 tabs switched, 0 status
          // meetings". Held on one non-wrapping line in a 308px phone
          // column, the first half was squeezed to 40px and broke "modules"
          // across two lines mid-stem, on the artefact that is the page's
          // signature and its share image. Wrapping puts each phrase on its
          // own line instead of breaking a word.
          <div
            key={total.id}
            className="mk-receipt__total"
            style={{
              fontSize: total.emphasis ? 15 : 13,
              fontWeight: total.emphasis ? 600 : 400,
              color: total.emphasis ? "var(--os-ink)" : "var(--os-ink-2)",
            }}
          >
            <dt style={{ flex: "1 1 auto", minWidth: 0, margin: 0 }}>{total.label}</dt>
            {total.note ? (
              <dd style={{ margin: 0, flex: "0 0 auto", color: "var(--os-ink-2)", fontSize: 13, fontWeight: 400 }}>
                {total.note}
              </dd>
            ) : null}
            <dd className="mk-figures mk-receipt__total-value" style={{ margin: 0 }}>
              {total.value}
            </dd>
          </div>
        ))}
      </dl>

      <div
        style={{
          marginTop: 14,
          paddingTop: 10,
          borderTop: "1px solid var(--os-line)",
          display: "flex",
          alignItems: "center",
          gap: 10,
        }}
      >
        <span style={{ display: "inline-flex", gap: 4 }} aria-hidden>
          {(["yellow", "blue", "red", "green"] as const).map((c) => (
            <span key={c} style={{ width: 6, height: 6, borderRadius: 999, background: DOT_HEX[c] }} />
          ))}
        </span>
        <span style={{ fontSize: 12, color: "var(--os-ink-2)", flex: "1 1 auto", minWidth: 0 }}>{model.footer}</span>
        {model.mark ? (
          <span className="mk-figures" style={{ fontSize: 12, fontWeight: 600, color: "var(--os-ink)" }}>
            {model.mark}
          </span>
        ) : null}
      </div>

      {model.footnote ? (
        <p style={{ margin: "8px 0 0", fontSize: 12, lineHeight: "16px", color: "var(--os-ink-2)" }}>{model.footnote}</p>
      ) : null}
    </div>
  );
}
