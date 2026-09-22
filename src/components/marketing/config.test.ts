import { describe, expect, it } from "vitest";
import {
  flags,
  moduleNames,
  primaryCta,
  realQuote,
  routes,
  secondaryCta,
  tierCta,
  tierNames,
  withPlacement,
} from "./config";
import { tuesday } from "./data/tuesday";

describe("the CTA contract", () => {
  it("uses one label for one destination, the canon's label", () => {
    const cta = primaryCta("hero");
    expect(cta.label).toBe("Start free");
    expect(cta.href.split("?")[0]).toBe("/signup");
    // The canon forbids these three, and this is where they would creep in.
    expect(["Sign up", "Register", "Create account"]).not.toContain(cta.label);
  });

  it("asks for the Tuesday template but does not link to it until the flag grants it", () => {
    // `template` is a request. The flag is the grant. Signup does not apply
    // the template yet, so the deep link would promise a seeded workspace
    // and open an empty one.
    expect(flags.tuesdayTemplateAtSignup).toBe(false);
    expect(primaryCta("spine", { template: true }).href.split("?")[0]).toBe(routes.signup);
    expect(primaryCta("spine", { template: true }).href).not.toContain("template=");
    // And the deep link the flag WILL unlock is the fixture's, not a
    // second string typed into the config.
    expect(routes.signupWithTemplate).toBe(tuesday.workspace.templateDeepLink);
    expect(routes.signupWithTemplate).toBe("/signup?template=tuesday");
  });

  it("gives every placement its own measurement id", () => {
    const ids = ["nav", "hero", "in-shell", "spine", "seats", "migration", "receipt", "final", "sticky"].map(
      (p) => primaryCta(p).dataCta,
    );
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("makes the other door the ghost, never a second filled button", () => {
    expect(secondaryCta("hero").label).toBe("Book a demo");
    expect(secondaryCta("hero").href.split("?")[0]).toBe(routes.demo);
  });

  it("carries the placement on the destination, not only in the consent gated event", () => {
    // A visitor who never answers the cookie banner, or answers Reject all,
    // is not measured at all, and that is the default. The destination is
    // what attributes their signup to the section that produced it.
    expect(primaryCta("hero").href).toBe("/signup?utm_content=hero-primary-trial");
    expect(secondaryCta("final").href).toBe("/demo?utm_content=final-secondary-demo");
    expect(tierCta("scale", "pricing").href).toBe("/demo?utm_content=pricing-scale-sales");
    // Every CTA's utm_content is its own data-cta, so one id joins the two
    // halves of the funnel.
    for (const p of ["hero", "nav", "sticky", "spine"]) {
      const cta = primaryCta(p);
      expect(cta.href).toContain(`utm_content=${cta.dataCta}`);
    }
  });

  it("keeps a query the destination already had", () => {
    expect(withPlacement("/signup?template=tuesday", "spine-primary-trial")).toBe(
      "/signup?template=tuesday&utm_content=spine-primary-trial",
    );
    expect(withPlacement("/demo", "")).toBe("/demo");
  });

  it("sends the quoted tier to sales and the listed tiers to the trial", () => {
    expect(tierCta("scale", "pricing").label).toBe("Talk to sales");
    expect(tierCta("scale", "pricing").href.split("?")[0]).toBe(routes.demo);
    expect(tierCta("starter", "pricing").href.split("?")[0]).toBe(routes.signup);
    expect(tierCta("growth", "pricing").href.split("?")[0]).toBe(routes.signup);
  });

  it("points every destination at a route the site will own", () => {
    for (const href of Object.values(routes)) {
      expect(href.startsWith("/")).toBe(true);
    }
  });
});

describe("the claim flags", () => {
  it("starts every unshipped claim off", () => {
    // Each of these is a sentence or a badge that is not true today. A
    // reviewer flipping one has to say what shipped.
    expect(flags.csvImport).toBe(false);
    expect(flags.soc2).toBe(false);
    expect(flags.iso27001).toBe(false);
    expect(flags.hipaaBaa).toBe(false);
    expect(flags.pciDss).toBe(false);
    expect(flags.customerLogos).toBe(false);
    expect(flags.namedCaseStudies).toBe(false);
    expect(flags.productCounters).toBe(false);
    expect(flags.g2Badge).toBe(false);
    expect(flags.productHuntBadge).toBe(false);
    expect(flags.competitorImporters).toBe(false);
  });

  it("keeps the customers nav link hidden, per the decision", () => {
    expect(flags.customersNavLink).toBe(false);
  });

  it("keeps the sandbox and the video out of the launch, per the decisions", () => {
    expect(flags.sandbox).toBe(false);
    expect(flags.watchTuesdayVideo).toBe(false);
  });

  it("records that the stop 2 mechanism and the trail have not shipped", () => {
    expect(flags.connectionTrailFeature).toBe(false);
    expect(flags.tuesdayTemplateAtSignup).toBe(false);
    // And the fixture agrees, which is what keeps the narration honest.
    expect(tuesday.stops[1].truthGate.shipped).toBe(false);
    expect(tuesday.stops[5].truthGate.shipped).toBe(false);
  });
});

describe("names", () => {
  it("reads the tier names from the pricing source, so renaming is a data change", () => {
    expect(tierNames).toEqual({ starter: "Starter", growth: "Growth", scale: "Scale" });
  });

  it("reads the module names from the fixture, and never invents a ninth", () => {
    expect(moduleNames).toHaveLength(8);
    expect(moduleNames).toContain("Talk");
    expect(moduleNames).toContain("Tables");
  });
});

describe("the one real quote", () => {
  it("keeps the login page's attribution verbatim", () => {
    expect(realQuote.name).toBe("Mohsin S.");
    expect(realQuote.title).toBe("COO · 280-person services firm");
    expect(realQuote.initials).toBe("MS");
  });

  it("keeps the customer's number, which is what the hero eyebrow borrows", () => {
    expect(realQuote.toolCount).toBe(14);
    expect(realQuote.body).toContain("14 SaaS tools");
  });

  it("carries no em dash, because no marketing copy does", () => {
    expect(/[—–―]/.test(realQuote.body)).toBe(false);
    // A SEMICOLON, NOT A FULL STOP. The source sentence on the login page
    // is one sentence joined by an em dash. Replacing the dash with a full
    // stop obeyed the punctuation rule by splitting a real person's
    // sentence in two and changing where the emphasis falls. The semicolon
    // drops the dash, adds no word that was not said, and leaves the
    // customer with the sentence they gave us.
    expect(realQuote.body).toContain("open the app now; that didn't happen");
  });
});
