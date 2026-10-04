import { describe, expect, it } from "vitest";
import {
  SELF_SERVE_TRIAL_DAYS,
  consoleTrialEnd,
  isTrialEndDay,
  selfServeTrialEnd,
  trialEndFromDay,
  trialEndRefusal,
  type TrialEndFacts,
} from "./trial-end";

const own = new Date("2026-10-19T12:00:00.000Z");
const stripeDate = new Date("2026-10-25T08:00:00.000Z");
const facts = (over: Partial<TrialEndFacts> = {}): TrialEndFacts => ({ status: "TRIAL", trialEndsAt: own, subscription: null, ...over });
const stripeSub = (trialEndsAt: Date | null = null) => ({ stripeSubscriptionId: "sub_1", billingMode: "PER_USER", trialEndsAt });
const lifetime = { stripeSubscriptionId: null, billingMode: "FLAT_TIER", trialEndsAt: null };
// A checkout opened and never finished: a Subscription row with only a customer id.
const abandoned = { stripeSubscriptionId: null, billingMode: "PER_USER", trialEndsAt: null };

describe("consoleTrialEnd", () => {
  it("reads a self-serve trial's own date while it is on Trial", () => {
    expect(consoleTrialEnd(facts())).toEqual({ at: own, source: "self_serve" });
    expect(consoleTrialEnd(facts({ subscription: abandoned }))).toEqual({ at: own, source: "self_serve" });
  });

  it("prefers Stripe's trial date wherever there is one", () => {
    expect(consoleTrialEnd(facts({ subscription: stripeSub(stripeDate) }))).toEqual({ at: stripeDate, source: "stripe" });
    expect(consoleTrialEnd(facts({ status: "ACTIVE", trialEndsAt: null, subscription: stripeSub(stripeDate) }))).toEqual({ at: stripeDate, source: "stripe" });
  });

  it("never shows a paying or lifetime company as a trial, though it may still read TRIAL", () => {
    expect(consoleTrialEnd(facts({ subscription: stripeSub() }))).toBeNull();
    expect(consoleTrialEnd(facts({ subscription: lifetime }))).toBeNull();
  });

  it("shows nothing off Trial, or with no date", () => {
    expect(consoleTrialEnd(facts({ status: "ACTIVE" }))).toBeNull();
    expect(consoleTrialEnd(facts({ trialEndsAt: null }))).toBeNull();
  });
});

describe("trialEndRefusal", () => {
  it("lets staff set a self-serve trial's date", () => {
    expect(trialEndRefusal(facts())).toBeNull();
    expect(trialEndRefusal(facts({ trialEndsAt: null }))).toBeNull();
    expect(trialEndRefusal(facts({ subscription: abandoned }))).toBeNull();
  });

  it("says why not for Stripe, a lifetime deal, or a company off Trial", () => {
    expect(trialEndRefusal(facts({ subscription: stripeSub() }))).toMatch(/Stripe/);
    expect(trialEndRefusal(facts({ subscription: stripeSub(stripeDate) }))).toMatch(/Stripe/);
    expect(trialEndRefusal(facts({ subscription: lifetime }))).toMatch(/lifetime/);
    expect(trialEndRefusal(facts({ status: "ACTIVE" }))).toMatch(/Trial/);
  });
});

describe("the days", () => {
  it("accepts real calendar days only", () => {
    expect(isTrialEndDay("2026-10-19")).toBe(true);
    expect(isTrialEndDay("2028-02-29")).toBe(true);
    for (const bad of ["2026-02-30", "2027-02-29", "2026-13-01", "2026-1-9", "19/10/2026", "", "2019-12-31", "2100-01-01", "2026-10-19T00:00"]) {
      expect(isTrialEndDay(bad)).toBe(false);
    }
  });

  it("stores a picked day at noon UTC, so it reads as that day across time zones", () => {
    expect(trialEndFromDay("2026-10-19").toISOString()).toBe("2026-10-19T12:00:00.000Z");
  });

  it("ends a self-serve trial the set number of days after signup", () => {
    expect(SELF_SERVE_TRIAL_DAYS).toBe(14);
    expect(selfServeTrialEnd(new Date("2026-10-05T09:30:00.000Z")).toISOString()).toBe("2026-10-19T09:30:00.000Z");
  });
});
