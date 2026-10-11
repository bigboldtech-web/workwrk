// What a page's fields and buttons are (src/lib/browser/classes.ts,
// docs/plans/ai-teammates-phase4.md Decisions 12 and 18): every field a
// teammate never types into is found by its type, its autocomplete tokens,
// or its name, id and label; a button is never one; a click's card says what
// it may do; and the limits are the spec's numbers.

import { describe, expect, it } from "vitest";
import { BROWSER_LIMITS } from "@/lib/plan-limits-data";
import { BROWSER_TURN_LIMITS, PAGE_LIMITS, SESSION_CAPS, SESSION_TIMES, WEB_READS, clickWarnings, fieldKindOf, isSensitiveField } from "./classes";
import type { ElementFingerprint } from "./types";

const field = (o: Partial<Parameters<typeof fieldKindOf>[0]> = {}) =>
  fieldKindOf({ tag: "input", type: "text", autocomplete: null, inputmode: null, name: null, id: null, label: null, maxLength: null, ...o });

const el = (o: Partial<ElementFingerprint> = {}): ElementFingerprint => ({ tag: "button", role: "button", name: "Go", kind: "none", type: null, formHost: null, href: null, twin: 0, twins: 1, anchor: "", at: 0, ...o });

const PAGE = { path: "/", formHasSensitive: false, downloadLink: false };

describe("fieldKindOf", () => {
  it("finds every sensitive kind by its autocomplete token", () => {
    expect(field({ autocomplete: "one-time-code" })).toBe("one_time_code");
    expect(field({ autocomplete: "cc-number" })).toBe("card_number");
    expect(field({ autocomplete: "billing cc-csc" })).toBe("card_code");
    expect(field({ autocomplete: "cc-exp" })).toBe("card_expiry");
    expect(field({ autocomplete: "cc-exp-month" })).toBe("card_expiry");
    // A password a "show password" switch made a text field.
    expect(field({ autocomplete: "current-password" })).toBe("password");
    expect(field({ type: "password" })).toBe("password");
  });

  it("finds every sensitive kind by its name, its id or its label", () => {
    expect(field({ name: "cardNumber" })).toBe("card_number");
    expect(field({ id: "cc_num" })).toBe("card_number");
    expect(field({ name: "billing_cc_number" })).toBe("card_number");
    expect(field({ label: "Credit card" })).toBe("card_number");
    expect(field({ name: "cvv" })).toBe("card_code");
    expect(field({ label: "Security code" })).toBe("card_code");
    expect(field({ name: "card_cvc" })).toBe("card_code");
    expect(field({ label: "Expiry date" })).toBe("card_expiry");
    expect(field({ name: "exp_month", tag: "select", type: null })).toBe("card_expiry");
    expect(field({ label: "IBAN" })).toBe("bank_account");
    expect(field({ name: "account_number" })).toBe("bank_account");
    expect(field({ label: "Routing number" })).toBe("bank_account");
    expect(field({ label: "Sort code" })).toBe("bank_account");
    expect(field({ inputmode: "numeric", maxLength: 6, label: "Enter the code" })).toBe("one_time_code");
    expect(field({ inputmode: "numeric", maxLength: 4, name: "pin" })).toBe("one_time_code");
    expect(field({ label: "Verification code" })).toBe("one_time_code");
    expect(field({ name: "otp" })).toBe("one_time_code");
    expect(field({ label: "Your password" })).toBe("password");
    expect(field({ name: "pwd" })).toBe("password");
    for (const k of ["password", "one_time_code", "card_number", "card_code", "card_expiry", "bank_account"] as const) expect(isSensitiveField(k), k).toBe(true);
  });

  // Review of Phase 4 step 1: whole words missed the names most sign-in
  // forms use, since "_" and letters join a word.
  it("finds a code or a bank account by any part of a name (review of Phase 4 step 1)", () => {
    for (const name of ["otp_code", "mfaCode", "totp_token", "2fa_code", "sms_code", "twoFactorCode", "two_factor", "one_time_password", "pinCode", "verification-code", "authcode", "authentication_code", "passcode1"]) {
      expect(field({ name }), name).toBe("one_time_code");
    }
    expect(field({ id: "login-otp" })).toBe("one_time_code");
    expect(field({ label: "MFA" })).toBe("one_time_code");
    for (const name of ["iban_number", "accountNumber", "account_no", "routing_number", "sortCode", "bankAccount", "swift_code", "bic", "customer_iban"]) {
      expect(field({ name }), name).toBe("bank_account");
    }
    // A code typed as numbers into a tel field or a number field, as before into inputmode numeric.
    expect(field({ type: "tel", maxLength: 6, label: "Enter the code" })).toBe("one_time_code");
    expect(field({ type: "number", maxLength: 6, name: "pin" })).toBe("one_time_code");
    // A button or a link with such a name is still no field.
    expect(field({ tag: "button", type: "submit", name: "otp_submit" })).toBe("none");
  });

  it("reads a code split into one box a digit as a one-time code (review of Phase 4 step 1)", () => {
    const box = (o: Partial<Parameters<typeof fieldKindOf>[0]> = {}) => field({ inputmode: "numeric", maxLength: 1, name: "d1", ...o });
    // Before: a box of one numeric character with no code word was text.
    expect(box({ codeBoxes: 6 })).toBe("one_time_code");
    expect(box({ codeBoxes: 4 })).toBe("one_time_code");
    expect(box({ codeBoxes: 8 })).toBe("one_time_code");
    expect(box({ type: "tel", inputmode: null, codeBoxes: 6 })).toBe("one_time_code");
    expect(box({ type: "number", inputmode: null, codeBoxes: 6 })).toBe("one_time_code");
    // Too few or too many boxes together are no code, unless their words say so.
    expect(box({ codeBoxes: 3 })).toBe("text");
    expect(box({ codeBoxes: 9 })).toBe("text");
    expect(box({ codeBoxes: 3, label: "Digit 1" })).toBe("one_time_code");
    // When the reader cannot tell how many sit together, the words decide.
    expect(box({ codeBoxes: null, label: "Digit 1 of 6" })).toBe("one_time_code");
    expect(box({ codeBoxes: undefined, name: "code-0" })).toBe("one_time_code");
    expect(box({ codeBoxes: null })).toBe("text");
    // A box of one letter, or a one-character text field, is no code.
    expect(field({ maxLength: 1, name: "initial", codeBoxes: 6 })).toBe("text");
  });

  it("reads other fields by their tag and type, and anything that is not a field as none", () => {
    expect(field()).toBe("text");
    expect(field({ type: null })).toBe("text");
    expect(field({ type: "email", name: "email" })).toBe("email");
    expect(field({ type: "search" })).toBe("search");
    expect(field({ type: "datetime-local" })).toBe("date");
    expect(field({ type: "checkbox", label: "Card number on file" })).toBe("checkbox");
    expect(field({ type: "file" })).toBe("file");
    expect(field({ type: "submit", label: "Pay with card" })).toBe("none");
    expect(field({ tag: "textarea", type: null })).toBe("textarea");
    expect(field({ tag: "select", type: null, name: "country" })).toBe("select");
    // A one-time donation amount reads as a code since review of Phase 4 step 1 ("one.?time" anywhere): a false match only asks the person.
    expect(field({ label: "One-time donation amount" })).toBe("one_time_code");
    // A button that says "Verify code" is a button, never a code field.
    expect(field({ tag: "button", type: "submit", label: "Verify code" })).toBe("none");
    expect(field({ tag: "a", type: null, label: "Forgot password?" })).toBe("none");
    for (const k of ["text", "email", "search", "number", "tel", "url", "date", "textarea", "select", "checkbox", "radio", "file", "none"] as const) expect(isSensitiveField(k), k).toBe(false);
  });
});

describe("clickWarnings", () => {
  it("says what a click may do, by whole words of its name and the page's facts", () => {
    expect(clickWarnings(el({ name: "Place order", formHost: "shop.proof.test" }), PAGE)).toEqual(["buys", "submits"]);
    expect(clickWarnings(el({ name: "Delete account" }), PAGE)).toEqual(["deletes"]);
    expect(clickWarnings(el({ name: "I agree" }), PAGE)).toEqual(["terms"]);
    expect(clickWarnings(el({ name: "Send", type: "submit" }), PAGE)).toEqual(["sends", "submits"]);
    expect(clickWarnings(el({ name: "Continue", formHost: "shop.proof.test" }), { ...PAGE, formHasSensitive: true })).toEqual(["buys", "submits"]);
    expect(clickWarnings(el({ name: "Save" }), { ...PAGE, path: "/account/security" })).toEqual(["settings"]);
    expect(clickWarnings(el({ tag: "a", role: "link", name: "Report.pdf" }), { ...PAGE, downloadLink: true })).toEqual(["download"]);
    expect(clickWarnings(el({ tag: "a", role: "link", name: "Read more" }), PAGE)).toEqual([]);
  });

  // Review of Phase 4 step 1: whole words missed "Payment", "Booking",
  // "Proceed to checkout" and "Deactivate".
  it("warns on the words a name holds in part too, and stays quiet for other words that hold them (review of Phase 4 step 1)", () => {
    for (const name of ["Payment", "Make a payment", "Pay with PayPal", "Proceed to checkout", "Check out", "Booking", "Book now", "Booking history", "Ordering", "Orders", "Transfer funds", "Withdrawal", "Upgrade now", "Renewal", "Donate", "Donation", "Subscribe", "Subscription", "Purchase", "Purchasing", "Reservation"]) {
      expect(clickWarnings(el({ tag: "a", role: "link", name }), PAGE), name).toEqual(["buys"]);
    }
    for (const name of ["Trash", "Discard changes", "Erase", "Deactivate account", "Revoke", "Revocation", "Disconnect", "Remove", "Removal", "Delete", "Deleting", "Cancellation", "Unsubscribe"]) {
      expect(clickWarnings(el({ tag: "a", role: "link", name }), PAGE), name).toEqual(["deletes"]);
    }
    // Unsubscribe is a delete, never a subscription.
    expect(clickWarnings(el({ tag: "a", role: "link", name: "Unsubscribe from this list" }), PAGE)).toEqual(["deletes"]);
    for (const name of ["Display", "Border", "Notebook", "Payroll report", "Reorder columns", "Bookmarks", "Payee list", "Read more", "Buyer's guide"]) {
      expect(clickWarnings(el({ tag: "a", role: "link", name }), PAGE), name).toEqual([]);
    }
  });

  // Phase 4 step 3: the planted page's "Confirm" on /buy-now said nothing of buying.
  it("warns that a click buys on a page whose path names buying, whatever the button says (Phase 4 step 3)", () => {
    for (const path of ["/buy-now", "/checkout", "/order", "/cart/checkout/pay"]) {
      expect(clickWarnings(el({ name: "Confirm" }), { ...PAGE, path }), path).toEqual(["buys"]);
    }
    expect(clickWarnings(el({ name: "Confirm" }), { ...PAGE, path: "/reviews" })).toEqual([]);
  });
});

describe("the computer's limits", () => {
  it("are the spec's numbers (Decisions 5, 6, 17, 22 and 23)", () => {
    expect(BROWSER_TURN_LIMITS).toEqual({ calls: 20, opens: 8, reads: 6, finds: 6, scrolls: 8, shows: 3, asks: 1, takeOvers: 1, starts: 1, perPersonPerMinute: 40 });
    expect(PAGE_LIMITS).toMatchObject({ partChars: 8000, parts: 10, elements: 120, links: 80, typeMax: 2000 });
    expect(SESSION_TIMES).toEqual({ idleMs: 300_000, waitingMs: 600_000, takeOverMs: 600_000, startMs: 60_000, staleRunMs: 1_800_000 });
    expect(SESSION_CAPS).toEqual({ personAtOnce: 1, personPerDay: 20, stepsPerSession: 300, shotsPerSession: 20, shotHours: 24, stepDays: 30, shotMaxBytes: 600_000 });
    expect([...WEB_READS].sort()).toEqual(["find_on_page", "open_page", "read_page", "scroll_page", "show_page"]);
    // Closing reads nothing a page wrote.
    expect(WEB_READS.has("close_browser" as never)).toBe(false);
  });

  it("come with Growth and above, and never with Starter", () => {
    expect(BROWSER_LIMITS.STARTER).toBeNull();
    expect(BROWSER_LIMITS.GROWTH).toEqual({ minutesPerMonth: 1000, atOnce: 2, sessionMinutes: 15, sessionsPerDay: 100 });
    expect(BROWSER_LIMITS.SCALE).toEqual({ minutesPerMonth: 5000, atOnce: 5, sessionMinutes: 30, sessionsPerDay: 400 });
    expect(BROWSER_LIMITS.ENTERPRISE).toEqual({ minutesPerMonth: 20000, atOnce: 20, sessionMinutes: 30, sessionsPerDay: 2000 });
    // Every session's minutes fit the database's CHECK (reservedMinutes BETWEEN 1 AND 120).
    for (const caps of Object.values(BROWSER_LIMITS)) if (caps) expect(caps.sessionMinutes).toBeLessThanOrEqual(120);
  });
});
