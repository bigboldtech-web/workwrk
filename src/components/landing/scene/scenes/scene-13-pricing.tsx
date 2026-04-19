"use client";

import { Reveal } from "@/components/bento/reveal";
import { PricingPlans } from "@/components/pricing/pricing-plans";
import { Scene } from "../scene";

export function ScenePricing() {
  return (
    <Scene id="pricing">
      <Reveal>
        <div className="scene-kicker">Pricing · clean, no tricks</div>
      </Reveal>
      <Reveal>
        <h2 className="scene-headline">
          Pay for the team you have.
          <br />
          <span className="hi">Not the tools you don&apos;t use.</span>
        </h2>
      </Reveal>
      <Reveal>
        <p className="scene-sub" style={{ maxWidth: "62ch" }}>
          Two ways to pay — per active user for elastic teams, or flat-monthly
          tier pricing for predictability. All plans convert to your selected
          currency. Switch the toggle below.
        </p>
      </Reveal>

      <div style={{ marginTop: 56 }}>
        <PricingPlans defaultMode="per-user" />
      </div>
    </Scene>
  );
}
