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
  {
    slug: "workwrk-pay",
    name: "WorkwrK Pay",
    tagline: "Payroll runs, payslips, codes",
    description:
      "Pay groups, pay runs, payslip viewer (employee + manager), earning + deduction codes, YTD totals. Partner-powered processing (Gusto/ADP) for actual disbursement.",
    iconKey: "Banknote",
    hue: "green",
    suite: "PEOPLE",
    tier: "SUITE",
    status: "COMING_SOON",
    defaultEnabled: false,
    displayOrder: 140,
    legacyModuleKey: "payroll",
    pathPrefix: "/payroll",
    seededAgents: ["devi-payroll"],
    seededIntegrations: ["gusto", "adp", "rippling"],
  },
  {
    slug: "workwrk-benefits",
    name: "WorkwrK Benefits",
    tagline: "Plans, enrollments, open enrollment",
    description:
      "Plan catalog + comparison, open enrollment wizard (life event + plan selection + dependents + beneficiary), enrollment history, contribution breakdown.",
    iconKey: "Heart",
    hue: "pink",
    suite: "PEOPLE",
    tier: "SUITE",
    status: "COMING_SOON",
    defaultEnabled: false,
    displayOrder: 150,
    legacyModuleKey: "benefits",
    pathPrefix: "/benefits",
    seededAgents: ["bea-benefits"],
    seededIntegrations: ["justworks", "gusto"],
  },

  // ─────────────────────────────────────────────
  // SALES SUITE (NEW)
  // ─────────────────────────────────────────────
  {
    slug: "workwrk-crm",
    name: "WorkwrK CRM",
    tagline: "Leads, deals, pipeline",
    description:
      "Leads, accounts, opportunities, deal pipeline (kanban by stage), 6-stage default workflow you can customize. The Salesforce-for-SMB tier. Ships with Ria the SDR agent and pre-built pipeline templates.",
    iconKey: "TrendingUp",
    hue: "green",
    suite: "SALES",
    tier: "PLUS",
    status: "LIVE",
    defaultEnabled: false,
    displayOrder: 200,
    pathPrefix: "/crm",
    seededAgents: ["ria-sdr", "dex-deal-coach"],
    seededTemplates: ["b2b-saas-pipeline", "renewal-tracker"],
    seededIntegrations: ["gmail", "outlook", "salesforce-migrate"],
  },

  // ─────────────────────────────────────────────
  // OPERATIONS SUITE
  // ─────────────────────────────────────────────
  {
    slug: "workwrk-procurement",
    name: "WorkwrK Procurement",
    tagline: "POs, vendors, approvals, contracts",
    description:
      "Purchase orders, vendor directory, procurement request forms, multi-level approval workflows, spend analytics. Coupa-lite for SMB.",
    iconKey: "ShoppingCart",
    hue: "sky",
    suite: "OPERATIONS",
    tier: "PLUS",
    status: "LIVE",
    defaultEnabled: false,
    displayOrder: 300,
    pathPrefix: "/procurement",
    seededAgents: ["nathan-sourcer", "pari-approval-router"],
  },
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
  {
    slug: "workwrk-itsm",
    name: "WorkwrK ITSM",
    tagline: "Tickets, incidents, SLAs, KB",
    description:
      "Internal IT service management for the IT team. Ticket queue (8 statuses, 5 priority tiers), incident timeline with severity (SEV1-SEV5) + lifecycle (Detected → Acknowledged → Investigating → Mitigating → Resolved → Postmortem), and an integrated knowledge base. Jira Service Management for SMB IT teams.",
    iconKey: "Headphones",
    hue: "blue",
    suite: "IT",
    tier: "PLUS",
    status: "LIVE",
    defaultEnabled: false,
    displayOrder: 400,
    pathPrefix: "/itsm",
    seededAgents: ["aman-it-tech", "indu-incident-lead"],
    seededIntegrations: ["pagerduty", "jira", "slack"],
  },

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
  {
    slug: "workwrk-dev",
    name: "WorkwrK Dev",
    tagline: "Sprints · Releases · Roadmap",
    description:
      "Engineering team workspace: sprint planning + capacity vs committed vs completed points + retro, release management with public changelog, roadmap with themes/priority/quarter/impact-score. Jira + Linear + Productboard combined.",
    iconKey: "Code",
    hue: "violet",
    suite: "ENGINEERING",
    tier: "PLUS",
    status: "LIVE",
    defaultEnabled: false,
    displayOrder: 600,
    pathPrefix: "/dev",
    seededAgents: ["dev-sprint-coach", "rhea-roadmap-strategist"],
    seededTemplates: ["scrum-sprint", "kanban-flow", "bug-triage"],
    seededIntegrations: ["github", "gitlab", "linear"],
  },

  // ─────────────────────────────────────────────
  // FINANCE SUITE
  // ─────────────────────────────────────────────
  {
    slug: "workwrk-books",
    name: "WorkwrK Books",
    tagline: "GL, AP/AR, close, reports",
    description:
      "Chart of accounts, journal entries, AP/AR, period close, financial statements. QuickBooks-online-style for SMB.",
    iconKey: "BookText",
    hue: "blue",
    suite: "FINANCE",
    tier: "SUITE",
    status: "PREVIEW",
    defaultEnabled: false,
    displayOrder: 700,
    pathPrefix: "/financials",
    seededAgents: ["booker-bookkeeper"],
    seededIntegrations: ["quickbooks", "xero", "stripe"],
  },
  {
    slug: "workwrk-fpa",
    name: "WorkwrK FP&A",
    tagline: "Budgets, plans, scenarios",
    description:
      "Driver-based modeling, rolling forecasts, scenario comparison (base/aggressive/conservative), variance analysis, workforce planning.",
    iconKey: "TrendingUp",
    hue: "violet",
    suite: "FINANCE",
    tier: "SUITE",
    status: "PREVIEW",
    defaultEnabled: false,
    displayOrder: 710,
    pathPrefix: "/planning",
    seededAgents: ["fina-fpa-analyst"],
  },
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
  {
    slug: "workwrk-contracts",
    name: "WorkwrK Legal",
    tagline: "Contracts · Privacy · IP",
    description:
      "Legal & compliance: contract lifecycle management with renewal alerts + auto-renew tracking, GDPR/CCPA privacy requests (DSARs) with auto-computed SLA timers per jurisdiction, IP portfolio (trademarks/patents/copyrights) with renewal alerts + outside counsel attribution. The General Counsel's command center.",
    iconKey: "Scale",
    hue: "violet",
    suite: "LEGAL",
    tier: "SUITE",
    status: "LIVE",
    defaultEnabled: false,
    displayOrder: 800,
    pathPrefix: "/legal",
    seededAgents: ["leila-contract-reviewer", "priva-privacy-officer", "ivan-ip-tracker"],
    seededIntegrations: ["docusign", "dropbox-sign"],
  },

  // ─────────────────────────────────────────────
  // SUPPORT SUITE (NEW)
  // ─────────────────────────────────────────────
  {
    slug: "workwrk-help",
    name: "WorkwrK Helpdesk",
    tagline: "Customer tickets · CSAT · canned responses",
    description:
      "External customer support distinct from internal ITSM. Tickets across 6 channels (Email, Chat, Phone, Portal, Social, In-app), 7-state lifecycle (NEW → OPEN → PENDING → RESOLVED → CLOSED), tier-driven SLA timers (Free 48h / Standard 24h / Premium 8h / Enterprise 4h), CSAT scores per ticket, reusable macros (canned responses) with auto-resolve flag. Zendesk-for-SMB.",
    iconKey: "Headphones",
    hue: "teal",
    suite: "SUPPORT",
    tier: "PLUS",
    status: "LIVE",
    defaultEnabled: false,
    displayOrder: 900,
    pathPrefix: "/helpdesk",
    seededAgents: ["maya-support-lead", "kai-kb-curator"],
    seededIntegrations: ["gmail", "intercom-migrate", "zendesk-migrate"],
  },
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
