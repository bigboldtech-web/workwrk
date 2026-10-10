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

const el = (o: Partial<ElementFingerprint> = {}): ElementFingerprint => ({ tag: "button", role: "button", name: "Go", kind: "none", type: null, formHost: null, href: null, twin: 0, ...o });

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
    // A one-time donation amount is no one-time code.
    expect(field({ label: "One-time donation amount" })).toBe("text");
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
    // Whole words only: "Booking history" neither books nor orders.
    expect(clickWarnings(el({ tag: "a", role: "link", name: "Booking history" }), PAGE)).toEqual([]);
    expect(clickWarnings(el({ tag: "a", role: "link", name: "Read more" }), PAGE)).toEqual([]);
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
