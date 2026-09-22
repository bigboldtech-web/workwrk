import { describe, expect, it } from "vitest";
import { pricing, stackReceipt } from "../data/pricing";
import { clock24, tuesday } from "../data/tuesday";
import {
  parseReceiptQuery,
  personalNumberLabel,
  receiptShareQuery,
  stackReceiptModel,
  stackReceiptModelFrom,
  workReceiptModel,
  workReceiptFooter,
} from "./receipt-model";
import { flags } from "../flags";

describe("the work receipt", () => {
  const model = workReceiptModel();

  it("is the task's own trail, one row per connection", () => {
    expect(model.kind).toBe("work");
    expect(model.title).toBe("ONBOARD BLUEFIN FOODS");
    expect(model.rows).toHaveLength(tuesday.receipt.lines.length);
    // 24 hour on the receipt (concept 4.1), 12 hour in the prose. The
    // fixture keeps one format and the receipt converts, so a stacked list
    // of eleven rows reads in one direction with no meridiem to infer.
    expect(model.rows[0].lead).toBe("09:02");
    expect(clock24("2:00")).toBe("14:00");
    expect(clock24("6:02")).toBe("18:02");
    expect(model.rows[0].meta).toBe("Tables");
  });

  it("joins the modules of a line that touched two blocks", () => {
    const row = model.rows.find((r) => r.lead === "09:03")!;
    expect(row.meta).toBe("Docs · Teams");
    expect(row.dot).toBe("yellow");
  });

  it("ends on the brag, in the visitor's vocabulary", () => {
    expect(model.totals).toHaveLength(1);
    expect(model.totals[0].value).toContain("0 tabs switched");
    expect(model.totals[0].value).toContain("0 status meetings");
    expect(model.totals[0].emphasis).toBe(true);
  });

  it("does not name a workspace template that does not exist", () => {
    // Both footers used to print the Tuesday workspace template, and
    // flags.tuesdayTemplateAtSignup is false: the deep link already refuses
    // to add ?template=tuesday, and both spine sentences already swap. The
    // two receipt footers were the only consumers of that flag that were
    // not reading it, on the artefact that travels furthest.
    expect(flags.tuesdayTemplateAtSignup).toBe(false);
    expect(workReceiptModel().footer).not.toContain("template");
    expect(workReceiptModel({ share: true }).footer).not.toContain("workspace");
    expect(workReceiptModel().footer).toBe(workReceiptFooter(false));
    expect(workReceiptModel({ share: true }).footer).toBe(workReceiptFooter(true));
  });

  it("carries no money and no strike-through: it is what you get, not what you keep", () => {
    for (const row of model.rows) {
      expect(row.amount).toBeUndefined();
      expect(row.struck).toBeUndefined();
    }
    expect(model.mark).toBeUndefined();
  });
});

describe("the stack receipt", () => {
  const model = stackReceiptModel({
    selected: ["task-tracker", "wiki", "team-chat", "okr-tool", "review-tool"],
    seats: 50,
    currency: "USD",
  });

  it("prints the concept's worked example line for line", () => {
    expect(model.rows.map((r) => `${r.lead} ${r.meta} ${r.amount}`)).toEqual([
      "Task tracker $12/seat $600",
      "Wiki $8/seat $400",
      "Team chat $8/seat $400",
      "OKR tool $10/seat $500",
      "Review tool $6/seat $300",
    ]);
  });

  it("totals the old stack, the new line and what the visitor keeps", () => {
    expect(model.totals.map((t) => [t.label, t.value])).toEqual([
      ["Old stack", "$2,200/mo"],
      ["WorkwrK Growth", "$400/mo"],
      ["You keep", "$1,800/mo"],
    ]);
    expect(model.totals[0].note).toBe("5 tools");
    expect(model.totals[1].note).toBe("1 tool");
    expect(model.totals.filter((t) => t.emphasis)).toHaveLength(1);
  });

  it("shows cancellation by strike-through, never by colour", () => {
    for (const row of model.rows) expect(row.struck).toBe(true);
  });

  it("signs itself with the VISITOR'S own count, not the fixture's fourteen", () => {
    // Five rows on the card, so the mark is five. A fixed 14 made the footer
    // of a shared receipt contradict the rows printed directly above it.
    expect(model.rows).toHaveLength(5);
    expect(model.mark).toBe("5 → 1");
    expect(model.footnote).toBe(pricing.listPriceFootnote);

    const three = stackReceiptModel({ selected: ["wiki", "forms", "calendar"], seats: 12, currency: "USD" });
    expect(three.mark).toBe("3 → 1");

    const all = stackReceiptModel({
      selected: pricing.categories.map((c) => c.id),
      seats: 12,
      currency: "USD",
    });
    expect(all.mark).toBe(`${pricing.categories.length} → 1`);
  });

  it("invites the visitor in rather than printing an empty slab", () => {
    const empty = stackReceiptModel({ selected: [], seats: 50 });
    expect(empty.rows).toHaveLength(0);
    // NO totals at all until there is something to compare. With nothing
    // selected the old stack is zero, so an "Old stack $0/mo" line above a
    // "WorkwrK Growth $400/mo" line told every first-time visitor, under a
    // heading that reads "Less than the tools it replaces", that we cost
    // 400 dollars a month more than what they pay now.
    expect(empty.totals).toHaveLength(0);
    // Nothing chosen is nothing to brag about: no mark rather than "0 → 1".
    expect(empty.mark).toBeUndefined();
    // And one tool consolidated into one tool is not a consolidation.
    expect(stackReceiptModel({ selected: ["wiki"], seats: 10 }).mark).toBeUndefined();
  });

  it("uses the singular for one tool", () => {
    const one = stackReceiptModel({ selected: ["wiki"], seats: 1, currency: "USD" });
    expect(one.totals[0].note).toBe("1 tool");
    expect(one.meta).toBe("1 seat");
  });

  it("says talk to sales instead of a number when the seat count is quoted", () => {
    const big = stackReceiptModel({ selected: ["wiki"], seats: 600, currency: "USD" });
    expect(big.totals.map((t) => t.value)).toContain("Talk to sales");
    expect(big.totals.some((t) => t.label === "You keep")).toBe(false);
  });

  it("tells the truth when the stack is cheaper than we are", () => {
    const model2 = stackReceiptModel({ selected: ["forms"], seats: 50, currency: "USD" });
    // Forms at 5 a seat is less than Growth at 8 a seat.
    expect(model2.totals.at(-1)!.label).toBe("You'd pay more");
    expect(model2.totals.at(-1)!.value).toBe("$150/mo");
  });

  it("follows the currency toggle through every number", () => {
    const inr = stackReceiptModel({ selected: ["task-tracker"], seats: 50, currency: "INR" });
    expect(inr.rows[0].amount).toContain("₹");
    expect(inr.totals[1].label).toBe("WorkwrK Growth");
    expect(inr.totals[1].value).toContain("₹");
  });

  it("calls a free-tier receipt what it is", () => {
    const free = stackReceiptModel({ selected: ["wiki"], seats: 5, currency: "USD" });
    expect(free.totals[1].label).toBe("WorkwrK Starter");
    expect(free.totals[1].value).toBe("$0/mo");
    expect(free.footer).toBe("Free plan, no card");
  });

  it("rebuilds the same model from a receipt already computed", () => {
    const receipt = stackReceipt({ selected: ["wiki"], seats: 50, currency: "USD" });
    expect(stackReceiptModelFrom(receipt)).toEqual(stackReceiptModel({ selected: ["wiki"], seats: 50, currency: "USD" }));
  });
});

describe("the personal number", () => {
  it("is shown only when there is something to keep", () => {
    expect(personalNumberLabel(stackReceipt({ selected: ["task-tracker"], seats: 50 }))).toBe("You'd keep $200/mo");
    expect(personalNumberLabel(stackReceipt({ selected: [], seats: 50 }))).toBeNull();
    expect(personalNumberLabel(stackReceipt({ selected: ["forms"], seats: 50 }))).toBeNull();
    expect(personalNumberLabel(stackReceipt({ selected: ["wiki"], seats: 900 }))).toBeNull();
  });
});

describe("the share link", () => {
  it("round trips through the query string", () => {
    const input = { selected: ["wiki", "team-chat"], seats: 37, currency: "GBP" as const };
    const parsed = parseReceiptQuery(new URLSearchParams(receiptShareQuery(input)));
    expect(parsed).toEqual({
      kind: "stack",
      selected: ["wiki", "team-chat"],
      seats: 37,
      currency: "GBP",
      overrides: {},
    });
  });

  it("carries the prices the visitor corrected, because they are the point of the receipt", () => {
    // Every line is editable and the page asks for the edit. A link that
    // dropped it sent list prices under the sharer's name, and the card
    // that unfurled from it stated a saving the sharer had just corrected.
    const input = {
      selected: ["wiki", "team-chat"],
      seats: 40,
      currency: "USD" as const,
      overrides: { wiki: 3.5, "team-chat": 11 },
    };
    const query = receiptShareQuery(input);
    expect(query).toContain("prices=");
    const parsed = parseReceiptQuery(new URLSearchParams(query));
    expect(parsed.overrides).toEqual({ wiki: 3.5, "team-chat": 11 });

    // And the receipt built from the link is the one that was copied.
    const shared = stackReceipt({
      selected: parsed.selected,
      seats: parsed.seats,
      currency: parsed.currency,
      overrides: parsed.overrides,
    });
    const original = stackReceipt(input);
    expect(shared.keepMonthly).toBe(original.keepMonthly);
    expect(shared.oldMonthly).toBe(original.oldMonthly);
  });

  it("drops an override for a line that is not on the receipt, or that is not a price", () => {
    const query = receiptShareQuery({
      selected: ["wiki"],
      seats: 10,
      currency: "USD",
      // One for a category that was not selected, one negative.
      overrides: { wiki: 4, "team-chat": 9, "okr-tool": -3 },
    });
    const parsed = parseReceiptQuery(new URLSearchParams(query));
    expect(parsed.overrides).toEqual({ wiki: 4 });
    expect(parseReceiptQuery(new URLSearchParams("kind=stack&tools=wiki&prices=wiki:banana")).overrides).toEqual({});
    expect(parseReceiptQuery(new URLSearchParams("kind=stack&tools=wiki&prices=wiki:99999")).overrides).toEqual({});
  });

  it("defaults to the work receipt when nothing is asked for", () => {
    const parsed = parseReceiptQuery(new URLSearchParams());
    expect(parsed.kind).toBe("work");
    expect(parsed.currency).toBe("USD");
    expect(parsed.seats).toBe(pricing.defaultSeats);
  });

  it("drops anything a stranger puts in the URL", () => {
    const parsed = parseReceiptQuery(
      new URLSearchParams("kind=stack&tools=wiki,<script>,../../etc&seats=-9&currency=XYZ"),
    );
    expect(parsed.selected).toEqual(["wiki"]);
    expect(parsed.seats).toBe(pricing.defaultSeats);
    expect(parsed.currency).toBe("USD");
  });

  it("caps an absurd seat count rather than rendering a mile-long number", () => {
    expect(parseReceiptQuery(new URLSearchParams("seats=99999999")).seats).toBe(100000);
  });
});
