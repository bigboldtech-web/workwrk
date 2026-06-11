// Canonical product catalog for the Modular Work OS.
//
// One entry per installable product. The seed script (scripts/seed-products.ts)
// upserts every entry into the `Product` table on each deploy; the
// sidebar + Product Store + onboarding all read from this catalog so
// adding a new product is a one-file change.
//
// `legacyModuleKey` ties a product to the existing Organization.settings.
// enabledModules string so the sidebar can keep working for orgs that
// haven't been migrated to ProductInstallation yet.
//
// Naming convention: every slug is `workwrk-<short>` so the URL routes
// (`/store/workwrk-crm`), the seedProduct CLI (`pnpm seed crm`), and
// the agent registry (`workwrk-crm.ria`) all line up.

import type { ProductStatus, ProductSuite, ProductTier } from "@/generated/prisma";

export interface CatalogProduct {
  slug: string;
  name: string;
  tagline: string;
  description: string;
  iconKey: string;
  hue: "blue" | "green" | "amber" | "violet" | "pink" | "teal" | "sky" | "rose" | "lime" | "slate";
  suite: ProductSuite;
  tier: ProductTier;
  status: ProductStatus;
  defaultEnabled: boolean;
  displayOrder: number;
  legacyModuleKey?: string;
  pathPrefix?: string;
  /** Optional override — where to *send* the user when they click
   * the product (vs `pathPrefix` which is used for matching the
   * current URL back to a product for the sub-nav). Falls back to
   * pathPrefix when not set. */
  landingHref?: string;
  seededAgents?: string[];
  seededTemplates?: string[];
  seededIntegrations?: string[];
}

export const PRODUCT_CATALOG: CatalogProduct[] = [
  // ─────────────────────────────────────────────
  // CROSS-FUNCTIONAL CORE
  // Shipped with every org. Sidebar shows these even if not "installed"
  // because they're the universal work surface.
  // ─────────────────────────────────────────────
  {
    slug: "workwrk-work",
    name: "WorkwrK Work",
    tagline: "Tasks, calendars, day-week-Gantt",
    description:
      "The universal task spine. Tasks, lists, boards, day/week/Gantt/calendar views, drag-to-reorder, labels, comments, recurrences. Every other product builds on this.",
    iconKey: "CalendarDays",
    hue: "blue",
    suite: "CROSS",
    tier: "CORE",
    status: "LIVE",
    defaultEnabled: true,
    displayOrder: 10,
    legacyModuleKey: "tasks",
    // pathPrefix stays /tasks so the legacy calendar still resolves
    // to this product in nav matching. landingHref points users at
    // the new monday-style board surface by default.
    pathPrefix: "/tasks",
    landingHref: "/tasks/board",
    seededTemplates: ["personal-todo", "team-sprint", "project-tracker"],
  },
  // SOPs / Goals / Meetings / Whiteboards / Culture are part of every
  // org's universal workspace — features of `workwrk-work`, not
  // separate "products". They were demoted out of PRODUCT_CATALOG so
  // the Apps Panel + Product Store don't show them as standalone
  // tiles. The routes (/sops, /okrs, /meetings, /whiteboards, /kudos)
  // and sidebar entries remain — they're discovered by living inside
  // the Workspace section of the sidebar, not by browsing a catalog.
  // Agents that previously referenced these as productSlug (e.g.
  // workwrk-sops → create_sop) still resolve via PRODUCT_TOOL_NAMES
  // in src/lib/agents/tools.ts — that map is decoupled from the
  // catalog by design.

  // ─────────────────────────────────────────────
  // PEOPLE SUITE
  // ─────────────────────────────────────────────
  {
    slug: "workwrk-people",
    name: "WorkwrK People",
    tagline: "HR core: directory, time-off, timesheets",
    description:
      "Employee directory, org chart, departments, roles, time-off policies + requests, timesheets, clock-in/out with geolocation, headcount planning. The HR Workday-replacement core.",
    iconKey: "Users",
    hue: "blue",
    suite: "PEOPLE",
    tier: "CORE",
    status: "LIVE",
    defaultEnabled: true,
    displayOrder: 100,
    legacyModuleKey: "people",
    pathPrefix: "/people",
    seededAgents: ["priya-hr", "maya-onboarding"],
    seededTemplates: ["employee-directory", "headcount-plan", "time-off-calendar"],
  },
  {
    slug: "workwrk-recruit",
    name: "WorkwrK Recruit",
    tagline: "ATS: jobs, candidates, interviews",
    description:
      "Job postings, candidate pipeline (sourced → screen → interview → offer → hired), interview scheduling + scorecards, offer letter templates. Greenhouse-style ATS bundled into the platform.",
    iconKey: "Briefcase",
    hue: "violet",
    suite: "PEOPLE",
    tier: "PLUS",
    status: "LIVE",
    defaultEnabled: false,
    displayOrder: 110,
    legacyModuleKey: "recruiting",
    pathPrefix: "/recruiting",
    seededAgents: ["sam-recruiter", "nathan-sourcer"],
    seededTemplates: ["sales-pipeline", "engineering-pipeline", "interview-scorecard"],
    seededIntegrations: ["linkedin", "indeed", "google-calendar"],
  },
  {
    slug: "workwrk-perform",
    name: "WorkwrK Perform",
    tagline: "Reviews, calibration, 9-box, comp",
    description:
      "Review cycles (self + manager + peer + 360), calibration sessions, 9-box talent grid, compensation cycles + decisions + salary bands. Lattice/Pave-style performance + comp module.",
    iconKey: "Star",
    hue: "amber",
    suite: "PEOPLE",
    tier: "PLUS",
    status: "LIVE",
    defaultEnabled: false,
    displayOrder: 120,
    legacyModuleKey: "reviews",
    pathPrefix: "/reviews",
    seededAgents: ["anya-review-coach", "tara-calibrator"],
  },
  {
    slug: "workwrk-learn",
    name: "WorkwrK Learn",
    tagline: "LMS: courses, certifications, paths",
    description:
      "Course catalog with cover images + lesson player (video/text/quiz), enrollments, completion certificates, manager-assigned training, transcript per employee.",
    iconKey: "GraduationCap",
    hue: "violet",
    suite: "PEOPLE",
    tier: "PLUS",
    status: "LIVE",
    defaultEnabled: false,
    displayOrder: 130,
    legacyModuleKey: "checkins",
    pathPrefix: "/learning",
    seededAgents: ["leo-learning"],
  },

  // ─────────────────────────────────────────────
  // SALES SUITE (NEW)
  // ─────────────────────────────────────────────

  // ─────────────────────────────────────────────
  // OPERATIONS SUITE
  // ─────────────────────────────────────────────
  {
    slug: "workwrk-assets",
    name: "WorkwrK Assets",
    tagline: "IT inventory, licenses, lifecycle",
    description:
      "Asset inventory (laptops/monitors/phones/access cards), assign-to-employee, lifecycle (in-stock → assigned → returned → retired), purchase info, warranty, photos.",
    iconKey: "Package",
    hue: "amber",
    suite: "OPERATIONS",
    tier: "PLUS",
    status: "LIVE",
    defaultEnabled: false,
    displayOrder: 310,
    pathPrefix: "/assets",
    seededAgents: ["ava-asset-tracker"],
  },

  // ─────────────────────────────────────────────
  // IT SUITE (NEW)
  // ─────────────────────────────────────────────

  // ─────────────────────────────────────────────
  // MARKETING SUITE (NEW)
  // ─────────────────────────────────────────────
  {
    slug: "workwrk-campaigns",
    name: "WorkwrK Marketing",
    tagline: "Campaigns · Content · Events",
    description:
      "Marketing operations: campaign planning with budget vs spend tracking + goal attainment, content calendar across blog/email/social/video, event briefs with capacity + ROI tracking. The CMO's command center.",
    iconKey: "Megaphone",
    hue: "amber",
    suite: "MARKETING",
    tier: "PLUS",
    status: "LIVE",
    defaultEnabled: false,
    displayOrder: 500,
    pathPrefix: "/marketing",
    seededAgents: ["mira-campaign-manager", "cora-editor", "eva-event-planner"],
  },

  // ─────────────────────────────────────────────
  // ENGINEERING SUITE (NEW)
  // ─────────────────────────────────────────────

  // ─────────────────────────────────────────────
  // FINANCE SUITE
  // ─────────────────────────────────────────────
  {
    slug: "workwrk-expense",
    name: "WorkwrK Expense",
    tagline: "T&E, receipts, mileage",
    description:
      "Expense submission with OCR receipt upload, category + project allocation, approval queue, mileage calculator, reimbursement export.",
    iconKey: "Receipt",
    hue: "amber",
    suite: "FINANCE",
    tier: "PLUS",
    status: "LIVE",
    defaultEnabled: false,
    displayOrder: 720,
    pathPrefix: "/expenses",
    seededAgents: ["ex-expense-auditor"],
    seededIntegrations: ["ramp", "brex", "stripe-cards"],
  },

  // ─────────────────────────────────────────────
  // LEGAL SUITE (NEW)
  // ─────────────────────────────────────────────

  // ─────────────────────────────────────────────
  // SUPPORT SUITE (NEW)
  // ─────────────────────────────────────────────
];

// Quick lookups used by the sidebar + API.
export const PRODUCTS_BY_SLUG: Record<string, CatalogProduct> = Object.fromEntries(
  PRODUCT_CATALOG.map((p) => [p.slug, p]),
);

export const PRODUCTS_BY_LEGACY_KEY: Record<string, CatalogProduct> = Object.fromEntries(
  PRODUCT_CATALOG.filter((p) => p.legacyModuleKey).map((p) => [p.legacyModuleKey!, p]),
);

export const PRODUCTS_BY_SUITE: Record<ProductSuite, CatalogProduct[]> = PRODUCT_CATALOG.reduce(
  (acc, p) => {
    (acc[p.suite] ??= []).push(p);
    return acc;
  },
  {} as Record<ProductSuite, CatalogProduct[]>,
);

// Default install set for a brand-new org. We seed everything in
// CROSS so the empty workspace already has Work + SOPs + Goals +
// Meetings + Culture. Department-specific products are added by the
// onboarding department-router.
export const DEFAULT_INSTALLED_SLUGS: string[] = PRODUCT_CATALOG.filter(
  (p) => p.defaultEnabled,
).map((p) => p.slug);

// Routes the department-router suggests when the user picks a department
// during onboarding. The user can toggle anything; this is the default
// pre-checked set.
export const DEPARTMENT_RECOMMENDED_PRODUCTS: Record<string, string[]> = {
  hr: [
    "workwrk-people",
    "workwrk-recruit",
    "workwrk-perform",
    "workwrk-learn",
    "workwrk-pay",
    "workwrk-benefits",
  ],
  sales: ["workwrk-crm"],
  operations: ["workwrk-procurement", "workwrk-assets"],
  it: ["workwrk-itsm", "workwrk-assets"],
  marketing: ["workwrk-campaigns"],
  finance: ["workwrk-books", "workwrk-fpa", "workwrk-expense"],
  engineering: ["workwrk-dev"],
  legal: ["workwrk-contracts", "workwrk-privacy"],
  support: ["workwrk-help"],
  "all-in-one": PRODUCT_CATALOG.filter((p) => p.status !== "COMING_SOON" && p.status !== "DEPRECATED").map(
    (p) => p.slug,
  ),
};
