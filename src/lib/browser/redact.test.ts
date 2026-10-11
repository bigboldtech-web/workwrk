// What a page shows that the model never reads (src/lib/browser/redact.ts,
// docs/plans/ai-teammates-phase4.md Decision 17): card numbers that pass
// Luhn, codes beside the words that name them, and IBANs become "[hidden]";
// an order number or a number that fails Luhn stays.

import { describe, expect, it } from "vitest";
import { HIDDEN_MARK, redactPageText } from "./redact";

describe("redactPageText", () => {
  it("hides a card number that passes Luhn, however it is grouped, and keeps one that fails", () => {
    expect(redactPageText("Card 4242 4242 4242 4242 on file")).toEqual({ text: `Card ${HIDDEN_MARK} on file`, hidden: 1 });
    expect(redactPageText("4242-4242-4242-4242")).toEqual({ text: HIDDEN_MARK, hidden: 1 });
    expect(redactPageText("4242424242424242")).toEqual({ text: HIDDEN_MARK, hidden: 1 });
    // An American Express number, 15 digits.
    expect(redactPageText("Amex 3782 822463 10005.").text).toBe(`Amex ${HIDDEN_MARK}.`);
    expect(redactPageText("Card 4242 4242 4242 4241 on file")).toEqual({ text: "Card 4242 4242 4242 4241 on file", hidden: 0 });
  });

  it("hides a code beside the word that names it, and keeps an order number", () => {
    expect(redactPageText("Your code is 482913")).toEqual({ text: `Your code is ${HIDDEN_MARK}`, hidden: 1 });
    expect(redactPageText("Your verification code: 9921").text).toBe(`Your verification code: ${HIDDEN_MARK}`);
    expect(redactPageText("OTP 55123")).toEqual({ text: `OTP ${HIDDEN_MARK}`, hidden: 1 });
    expect(redactPageText("482913 is your verification code").text).toBe(`${HIDDEN_MARK} is your verification code`);
    expect(redactPageText("Order 482913 shipped")).toEqual({ text: "Order 482913 shipped", hidden: 0 });
    // Too far from the word, or part of a longer number, is no code.
    expect(redactPageText(`Your code is in the email we sent you, and 482913 is your order.`).text).toContain("482913");
    expect(redactPageText("code 123456789012").text).toBe("code 123456789012");
  });

  // Review of Phase 4 step 1: one separator at a time, so two spaces, a run
  // of non-breaking spaces or a line break let a card number through, and a
  // number after the card made the whole row fail the check.
  it("hides a card number however its groups are spaced, across a line, or beside another number (review of Phase 4 step 1)", () => {
    expect(redactPageText("Card 4242  4242  4242  4242 on file")).toEqual({ text: `Card ${HIDDEN_MARK} on file`, hidden: 1 });
    expect(redactPageText("4242\u00a0\u00a04242\u00a0\u00a04242\u00a0\u00a04242").text).toBe(HIDDEN_MARK);
    expect(redactPageText("4242 4242\n4242 4242").text).toBe(HIDDEN_MARK);
    expect(redactPageText("4242 - 4242 - 4242 - 4242").text).toBe(HIDDEN_MARK);
    expect(redactPageText("4242\u20134242\u20134242\u20134242").text).toBe(HIDDEN_MARK);
    expect(redactPageText("Card 4242 4242 4242 4242 123").text).toBe(`Card ${HIDDEN_MARK} 123`);
    expect(redactPageText("Ref 77 4242 4242 4242 4242 today").text).toBe(`Ref 77 ${HIDDEN_MARK} today`);
    // Five spaces between groups is no card number's spacing, and a number that fails the check still stays.
    expect(redactPageText("4242     4242     4242     4242").hidden).toBe(0);
    expect(redactPageText("Card 4242  4242  4242  4241 on file").hidden).toBe(0);
  });

  it("hides an IBAN, grouped or not", () => {
    expect(redactPageText("Pay to DE89 3704 0044 0532 0130 00 today").text).toBe(`Pay to ${HIDDEN_MARK} today`);
    expect(redactPageText("GB29NWBK60161331926819").text).toBe(HIDDEN_MARK);
  });

  it("counts each thing it hid once, and leaves text with none as it was", () => {
    const r = redactPageText("Card 4242 4242 4242 4242, code 1234, IBAN GB29NWBK60161331926819.");
    expect(r.hidden).toBe(3);
    expect(r.text).not.toMatch(/4242|1234|GB29/);
    expect(redactPageText("Welcome to the reviews.")).toEqual({ text: "Welcome to the reviews.", hidden: 0 });
    expect(redactPageText("")).toEqual({ text: "", hidden: 0 });
  });

  it("reads a long page in time linear in its length", () => {
    const big = "1 ".repeat(50_000) + "code 1234 " + "9".repeat(50_000);
    const started = Date.now();
    const r = redactPageText(big);
    expect(Date.now() - started).toBeLessThan(2000);
    expect(r.text).toContain(`code ${HIDDEN_MARK}`);
  });
});
