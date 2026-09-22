// The pure helpers Stage A ships that no other test file covers: the geo
// detected starting currency (decision 7), the headline A/B leaf (decision 1),
// and the measurement module's consent gate (concept 6.3).
//
// Each of these is one small function guarding a decision that is expensive to
// get wrong: a price shown in a currency the visitor cannot pay in, a hero
// with no headline because of a typo in an env var, or a click measured after
// the visitor pressed "Reject all".

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { currencyFromCountry, pricing } from "./data/pricing";
import { resolveVariant } from "./headline-variant";

describe("the geo detected starting currency", () => {
  it("falls back to the authored default when the country is unknown", () => {
    // The self hosted deployment sets none of the three country headers, so
    // this is the branch almost every real visitor takes.
    expect(currencyFromCountry(undefined)).toBe(pricing.defaultCurrency);
    expect(currencyFromCountry(null)).toBe(pricing.defaultCurrency);
    expect(currencyFromCountry("")).toBe(pricing.defaultCurrency);
  });

  it("falls back rather than guessing for a country the site does not price in", () => {
    // The wrong answer here is not "no currency", it is a price in a currency
    // the visitor cannot pay in, which is worse than the default.
    expect(currencyFromCountry("JP")).toBe(pricing.defaultCurrency);
    expect(currencyFromCountry("BR")).toBe(pricing.defaultCurrency);
    expect(currencyFromCountry("ZZ")).toBe(pricing.defaultCurrency);
  });

  it("maps each of the six offered currencies from at least one country", () => {
    expect(currencyFromCountry("US")).toBe("USD");
    expect(currencyFromCountry("IN")).toBe("INR");
    expect(currencyFromCountry("AE")).toBe("AED");
    expect(currencyFromCountry("SG")).toBe("SGD");
    expect(currencyFromCountry("GB")).toBe("GBP");
    expect(currencyFromCountry("DE")).toBe("EUR");
  });

  it("is case insensitive, because header casing is not ours to control", () => {
    expect(currencyFromCountry("in")).toBe("INR");
    expect(currencyFromCountry("gB")).toBe("GBP");
  });

  it("only ever returns a currency the pricing source actually authors a price in", () => {
    const authored = pricing.currencies.map((c) => c.code);
    for (const country of ["US", "IN", "AE", "SG", "GB", "DE", "FR", "JP", "", "ZZ"]) {
      expect(authored).toContain(currencyFromCountry(country));
    }
  });
});

describe("the hero headline A/B", () => {
  it("treats anything that is not b as the control", () => {
    // A typo in an env var must never ship an empty hero.
    expect(resolveVariant(undefined)).toBe("a");
    expect(resolveVariant("")).toBe("a");
    expect(resolveVariant("A")).toBe("a");
    expect(resolveVariant("control")).toBe("a");
    expect(resolveVariant("bb")).toBe("a");
  });

  it("accepts variant b however it is cased or padded", () => {
    expect(resolveVariant("b")).toBe("b");
    expect(resolveVariant("B")).toBe("b");
    expect(resolveVariant(" b ")).toBe("b");
  });

  it("imports nothing, so the client measurement module can read it for free", async () => {
    // The whole reason this module is a leaf: importing headline.ts instead
    // would pull config.ts, and with it the entire Tuesday fixture, into the
    // browser bundle of every page that renders a button.
    const { readFileSync } = await import("node:fs");
    const { fileURLToPath } = await import("node:url");
    const source = readFileSync(fileURLToPath(new URL("./headline-variant.ts", import.meta.url)), "utf8");
    expect(source).not.toMatch(/^\s*import\s/m);
  });
});

describe("measurement is gated on consent", () => {
  const consent = vi.hoisted(() => ({ value: null as { analytics: boolean } | null, throws: false }));

  beforeEach(() => {
    vi.resetModules();
    consent.value = null;
    consent.throws = false;
    vi.doMock("@/lib/compliance/consent-client", () => ({
      readConsentCookie: () => {
        if (consent.throws) throw new Error("cookie unreadable");
        return consent.value;
      },
    }));
    const listeners: Array<(e: Event) => void> = [];
    vi.stubGlobal("window", { dataLayer: [] as unknown[] });
    vi.stubGlobal("document", {
      dispatchEvent: (e: Event) => {
        listeners.forEach((l) => l(e));
        return true;
      },
    });
    vi.stubGlobal("CustomEvent", class {
      type: string;
      detail: unknown;
      constructor(type: string, init?: { detail?: unknown }) {
        this.type = type;
        this.detail = init?.detail;
      }
    });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.doUnmock("@/lib/compliance/consent-client");
  });

  it("measures nothing when the visitor has not been asked yet", async () => {
    const { track } = await import("./instrumentation");
    track("cta_click", { id: "hero-primary-trial" });
    expect((globalThis as unknown as { window: { dataLayer: unknown[] } }).window.dataLayer).toHaveLength(0);
  });

  it("measures nothing when the visitor rejected analytics", async () => {
    consent.value = { analytics: false };
    const { track } = await import("./instrumentation");
    track("cta_click", { id: "hero-primary-trial" });
    expect((globalThis as unknown as { window: { dataLayer: unknown[] } }).window.dataLayer).toHaveLength(0);
  });

  it("measures nothing when the consent cookie cannot be read at all", async () => {
    consent.throws = true;
    const { track } = await import("./instrumentation");
    track("cta_click", { id: "hero-primary-trial" });
    expect((globalThis as unknown as { window: { dataLayer: unknown[] } }).window.dataLayer).toHaveLength(0);
  });

  it("pushes one event carrying the placement id and the headline variant once analytics is agreed", async () => {
    consent.value = { analytics: true };
    const { track, MARKETING_EVENT } = await import("./instrumentation");
    track("stop_reached", { id: "spine-stop-2", value: 2 });
    const layer = (globalThis as unknown as { window: { dataLayer: Array<Record<string, unknown>> } }).window.dataLayer;
    expect(layer).toHaveLength(1);
    expect(layer[0]).toMatchObject({
      event: MARKETING_EVENT,
      name: "stop_reached",
      id: "spine-stop-2",
      value: 2,
      variant: "a",
    });
  });

  it("re-reads the answer per event, so rejecting mid visit stops the very next click", async () => {
    consent.value = { analytics: true };
    const { track } = await import("./instrumentation");
    track("cta_click", { id: "nav-primary-trial" });
    consent.value = { analytics: false };
    track("cta_click", { id: "final-primary-trial" });
    const layer = (globalThis as unknown as { window: { dataLayer: unknown[] } }).window.dataLayer;
    expect(layer).toHaveLength(1);
  });

  it("names a form outcome, because a submit that hit an error is not a conversion", async () => {
    consent.value = { analytics: true };
    const { trackFormSubmit } = await import("./instrumentation");
    trackFormSubmit("demo-form", "unreachable");
    const layer = (globalThis as unknown as { window: { dataLayer: Array<Record<string, unknown>> } }).window.dataLayer;
    expect(layer[0]).toMatchObject({ name: "form_submitted", detail: { outcome: "unreachable" } });
  });

  it("names the story surface and the width, so stops and beats stay separable", async () => {
    // The Tuesday is one piece of markup read two ways: six stops in the
    // pinned desktop scene, the same content as eight beats in the stacked
    // stepper. Both sets fire on a desktop scroll, which is correct; what
    // was missing was any way to tell them apart afterwards, so per stop
    // drop off was double counted and the six versus eight decision could
    // not be made from the data.
    consent.value = { analytics: true };
    vi.stubGlobal("window", {
      dataLayer: [] as unknown[],
      innerWidth: 1440,
      matchMedia: (q: string) => ({ matches: q.includes("1024") }),
    });
    const { track } = await import("./instrumentation");
    track("beat_reached", { id: "beat-3", value: 3 });
    const layer = (globalThis as unknown as { window: { dataLayer: Array<Record<string, unknown>> } }).window.dataLayer;
    expect(layer[0]).toMatchObject({ name: "beat_reached", surface: "scene", width: 1440 });
  });

  it("falls back to the stepper, and to a width of 0, rather than throwing", async () => {
    // A measurement helper must never be able to break a button, so every
    // read of the environment is defensive. The stub here has neither
    // matchMedia nor innerWidth, which is what a server-ish or locked down
    // runtime looks like.
    consent.value = { analytics: true };
    const { track } = await import("./instrumentation");
    track("cta_click", { id: "nav-primary-trial" });
    const layer = (globalThis as unknown as { window: { dataLayer: Array<Record<string, unknown>> } }).window.dataLayer;
    expect(layer[0]).toMatchObject({ surface: "stepper", width: 0 });
  });

  it("gives every CTA the data-cta attribute the concept asks for", async () => {
    const { ctaAttributes } = await import("./instrumentation");
    expect(ctaAttributes("hero-primary-trial")).toEqual({ "data-cta": "hero-primary-trial" });
  });
});
