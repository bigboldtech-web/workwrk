// The receipt model (marketing-concept.md 4.1 and section 9).
//
// Two receipts rhyme on one component. The WORK receipt is what you get: the
// connections one task made in one day. The STACK receipt is what you keep:
// the subscriptions the visitor tapped, at their own seat count. Same
// typography, same rules, same rows, so a person who screenshots one
// recognises the other.
//
// This module owns the WORK half and re-exports the stack half from
// ./stack-model, which is the one every caller can keep importing from
// here. The split is a bundle boundary: the work receipt reads the 850 line
// Tuesday fixture, the stack receipt reads only the pricing source, and the
// calculator island needs the second without the first.
//
// It is pure: the React component and the next/og route both render exactly
// what comes out of here, which is what stops the shared image from
// drifting from the page.

import { clock24, receiptLineLabel, tuesday } from "../data/tuesday";
import { flags } from "../flags";
import type { ReceiptModel } from "./stack-model";

export type { ReceiptModel, ReceiptRow, ReceiptTotal } from "./stack-model";
export {
  stackReceiptModel,
  stackReceiptModelFrom,
  personalNumberLabel,
  receiptShareQuery,
  parseReceiptQuery,
} from "./stack-model";

/** The work receipt: the Tuesday task's connection trail, one line per connection. */
export function workReceiptModel(options?: { share?: boolean }): ReceiptModel {
  const r = tuesday.receipt;
  return {
    kind: "work",
    title: r.title,
    meta: r.meta,
    // The label goes through the truth gate, never straight from the
    // fixture: a receipt row naming a mechanism is the same claim the
    // storyboard makes in prose, and it is the half that gets shared.
    rows: r.lines.map((line, i) => ({
      id: `${line.time}-${i}`,
      // 24 hour, per concept 4.1. The fixture speaks in 12 hour time
      // because the story's narrator does; a stacked list of eleven rows
      // has no context to infer a meridiem from, so "2:00 Blocked" under
      // "11:15 Contract v2 attached" read as two in the morning.
      lead: clock24(line.time),
      label: receiptLineLabel(line),
      meta: line.modules.join(" · "),
      dot: line.dot,
    })),
    totals: [
      {
        id: "work-total",
        label: r.totals.slice(0, 2).join(" · "),
        value: r.totals.slice(2).join(" · "),
        emphasis: true,
      },
    ],
    footer: workReceiptFooter(options?.share === true),
  };
}

/**
 * The line under the work receipt.
 *
 * It named the Tuesday workspace template ("The Tuesday workspace" on the
 * shared card, "Tuesday workspace template" on the page), and that template
 * does not exist: `flags.tuesdayTemplateAtSignup` is false, the deep link
 * refuses to add ?template=tuesday because of it, and both spine sentences
 * already swap for the same reason. The two footers were the only consumers
 * of that flag that were not reading it, and they are on the artefact that
 * travels furthest, which is exactly backwards.
 *
 * With the flag off the footer says what the receipt IS: a storyboard, drawn
 * from the fixture this site and the product's own components share.
 *
 * AND THE SHARED CARD CARRIES THE DISCLAIMER, not just the page.
 *
 * It used to be the other way round, which is the invented customer gate's
 * exact target with the sign reversed. The page footer read "A storyboard,
 * not a customer" and the OG variant dropped it, and the OG variant is
 * /tuesday's og:image: a Slack or LinkedIn unfurl showed ONBOARD BLUEFIN
 * FOODS with eleven timed trail lines and four hard counters and nothing
 * saying it was a storyboard. An artefact that travels without a page
 * around it needs MORE disclosure than one that sits inside a page, not
 * less. The two other share artefacts already knew this: the home OG card
 * prints the sample workspace label and the stack receipt prints its own
 * "Typical list price" note.
 *
 * The share string is shorter than the page one because the card's footer
 * row is a single line beside a domain, not because it says less.
 */
export function workReceiptFooter(share: boolean): string {
  if (flags.tuesdayTemplateAtSignup) {
    return share ? tuesday.workspace.receiptFooterShare : tuesday.workspace.receiptFooterSite;
  }
  return share
    ? "One Tuesday. A storyboard, not a customer."
    : "One task, one Tuesday. A storyboard, not a customer.";
}
