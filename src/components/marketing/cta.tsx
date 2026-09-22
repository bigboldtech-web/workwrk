// The CTA (marketing-concept.md 7.3, naming-canon section 3).
//
// Every call to action on the public site goes through this component, and
// that is the only reason the funnel rules can be enforced rather than
// hoped for:
//
//   * One label for one destination. "Start free" opens /signup. Never
//     "Sign up", never "Register", never "Create account".
//   * One filled button per section, because `variant="primary"` is what
//     the config flag flips, not a class someone typed.
//   * A distinct `data-cta` on every placement, so per-placement drop-off
//     is measurable without adding a listener per button.
//   * A route that exists. /signup is the auth unit's page; the link crosses
//     to the app host through appHref when NEXT_PUBLIC_APP_URL is set, which
//     is what the hard host split needs.
//
// A control with no handler is a lie, so the tracking call is the handler,
// and it is safe on a page with no analytics attached.
//
// This module is a SERVER module on purpose. It resolves the spec from the
// config, and hands three strings to the one small client component in
// cta-link.tsx. See the note at the top of that file for why.

import { primaryCta, secondaryCta, tierCta, tierCtaIsPrimary, type CtaSpec } from "./config";
import { CtaLink, type CtaSize, type CtaVariant } from "./cta-link";
import type { TierId } from "./data/pricing";
import type { ReactNode } from "react";

export type { CtaSize, CtaVariant } from "./cta-link";

export function MarketingCta({
  cta,
  variant = "primary",
  size = "default",
  children,
  className,
}: {
  cta: CtaSpec;
  variant?: CtaVariant;
  size?: CtaSize;
  /** Overrides the label. Use only when the placement needs its own words. */
  children?: ReactNode;
  className?: string;
}) {
  return (
    <CtaLink
      label={cta.label}
      href={cta.href}
      dataCta={cta.dataCta}
      variant={variant}
      size={size}
      className={className}
    >
      {children}
    </CtaLink>
  );
}

/**
 * "Start free" (or "Book a demo" when the config flag is flipped).
 *
 * `variant` exists for ONE reason, and it is the rule at the top of this
 * file: never two filled buttons in one viewport. The navigation and the
 * hero are both on screen at the first paint, and both used to ask for the
 * filled skin, so the LCP frame shipped with two blue buttons plus the one
 * inside the product frame. The hero owns the fill on its own page, so the
 * nav's copy of the same CTA asks for the ghost skin and the destination,
 * the label and the measurement id are unchanged.
 */
export function PrimaryCta({
  placement,
  template,
  label,
  variant = "primary",
  size = "default",
  children,
}: {
  placement: string;
  template?: boolean;
  label?: string;
  variant?: CtaVariant;
  size?: CtaSize;
  children?: ReactNode;
}) {
  return (
    <MarketingCta cta={primaryCta(placement, { template, label })} variant={variant} size={size}>
      {children}
    </MarketingCta>
  );
}

/** The other door, always ghost, never filled. */
export function SecondaryCta({
  placement,
  label,
  size = "default",
}: {
  placement: string;
  label?: string;
  size?: CtaSize;
}) {
  return <MarketingCta cta={secondaryCta(placement, { label })} variant="ghost" size={size} />;
}

/**
 * The per-tier button on a pricing card.
 *
 * The filled one is the recommended tier, decided in the pricing data, and
 * NOT "whichever card does not point at /demo": in demo-first mode every card
 * points at /demo, and that test left the pricing page with no primary at all.
 */
export function TierCta({ tierId, placement }: { tierId: TierId; placement: string }) {
  return <MarketingCta cta={tierCta(tierId, placement)} variant={tierCtaIsPrimary(tierId) ? "primary" : "ghost"} />;
}

/**
 * "Log in", the one label the canon allows for the verb. Always on the app
 * host.
 *
 * `quiet`, not `link`: the same text link, in ink rather than in blue. It
 * sits in the navigation, the navigation is in every viewport on the site,
 * and the site spends its one blue on the page's own button. See the note
 * beside the skin in cta-link.tsx.
 */
export function LogInLink({ placement = "nav" }: { placement?: string }) {
  return (
    <MarketingCta
      cta={{ label: "Log in", href: "/login", dataCta: `${placement}-login` }}
      variant="quiet"
    />
  );
}
