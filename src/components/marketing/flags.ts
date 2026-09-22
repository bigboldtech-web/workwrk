// The claim flags (marketing-concept.md 12 Phase 0 item 5, and the truth
// gates in 4.4, 7.6 and the risk table).
//
// The rule this file exists to enforce: a claim on the public site is a FLAG,
// not a sentence someone typed. A feature that is not live renders NOTHING,
// never a disabled promise. Flipping a flag is a code review with one obvious
// question attached: has this shipped?
//
// Every flag below is false until the evidence named beside it exists.
//
// It lives in its own module, apart from config.ts, for one practical reason:
// config.ts reads the Tuesday fixture and the pricing table at module scope,
// so a client component that wanted to hide one badge used to pull both JSON
// files into the browser with it. This module imports nothing. A client
// component can read a flag for free.

export const flags = {
  /**
   * The HERO's promise, "Import from a spreadsheet in minutes", and only
   * that one. It needs the importer reachable from a FRESH TRIAL inside a
   * few minutes, which nothing in this repo can prove while self serve
   * signup is not live, so it stays false.
   *
   * It is not a flag on whether CSV import exists. It does: there is an
   * Imports surface in the product, /api/tables/[id]/import reads a
   * spreadsheet into a table and /api/people/bulk-import reads one into a
   * people list. /compare, /faq and /features/integrations all state that
   * plainly, in the same words, without this flag. They used to disagree
   * with each other, with /compare answering "Importers: none" on the one
   * page that promises every row about us can be checked by opening ours.
   */
  csvImport: false,
  /** Competitor importers stay unmentioned until one ships. */
  competitorImporters: false,
  /** Badge slots exist in the layout and stay hidden until the listing exists. */
  g2Badge: false,
  productHuntBadge: false,
  /** Certification badges. Legal claims, not copy: only the founder flips these. */
  soc2: false,
  iso27001: false,
  hipaaBaa: false,
  pciDss: false,
  gdpr: false,
  dpdp: false,
  /** Logo wall and named case studies. Real or absent. */
  customerLogos: false,
  namedCaseStudies: false,
  /** Build-time product counters (workspaces, tasks completed, countries). Needs the query. */
  productCounters: false,
  /** Customers nav link. Hidden until a real case study exists (decision 12). */
  customersNavLink: false,
  /**
   * The /customers page itself. Hiding the nav link did not un-publish the
   * page: it answered 200 with eight invented companies and nine invented
   * counters. The page is gone until there is something true to put on it.
   */
  customersPage: false,
  /** The driveable shell. Concept phase 3, explicitly not launch-gating (decision 2). */
  sandbox: false,
  /** A REAL video file. Until one exists there is no play control of any kind (decision 15). */
  watchTuesdayVideo: false,
  /** The task connection trail as a product feature. Until then the receipt renders from the fixture. */
  connectionTrailFeature: false,
  /** The Tuesday template applied at signup. The launch gate for "Get this for your team" (7.2). */
  tuesdayTemplateAtSignup: false,
  /** The migration concierge line on the top tier. */
  migrationConcierge: false,
  /** Uptime, SLA and support-response numbers. Needs a published status page. */
  uptimeSla: false,
  /** SSO, SCIM and data-residency claims. Needs the feature reachable in a paid workspace. */
  enterpriseIdentity: false,
  /**
   * Third party connectors: Slack, Google Workspace, Microsoft 365, Zapier,
   * webhooks, an API quota. Connectors are demand driven and none ships, so
   * a comparison matrix must not tick a row for one. A procurement team
   * reads a tick in a matrix as a commitment.
   */
  thirdPartyIntegrations: false,
  /**
   * AI that recommends a promotion or a compensation change, and an
   * uncapped AI allowance. Both are commercial and both are unbuilt.
   */
  aiPeopleRecommendations: false,
  /** Running WorkwrK inside the customer's own AWS or GCP account. */
  customerHostedDeployment: false,
} as const;

export type FlagName = keyof typeof flags;

export function flagOn(name: FlagName): boolean {
  return flags[name];
}

/**
 * The certification rows a surface may render today. Empty, and a strip with
 * nothing in it renders nothing rather than an empty box.
 */
export const heldCertifications: string[] = [
  ...(flags.soc2 ? ["SOC 2 Type II"] : []),
  ...(flags.iso27001 ? ["ISO 27001"] : []),
  ...(flags.gdpr ? ["GDPR"] : []),
  ...(flags.dpdp ? ["DPDP"] : []),
  ...(flags.hipaaBaa ? ["HIPAA BAA"] : []),
  ...(flags.pciDss ? ["PCI DSS"] : []),
];
