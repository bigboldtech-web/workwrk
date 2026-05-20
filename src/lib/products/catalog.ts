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
    pathPrefix: "/tasks",
    seededTemplates: ["personal-todo", "team-sprint", "project-tracker"],
  },
  {
    slug: "workwrk-sops",
    name: "WorkwrK SOPs",
    tagline: "Process docs, versions, compliance",
    description:
      "Folder-tree SOPs, version history, role-based access, compliance assignments + acknowledgements, process runs (do-the-SOP step-by-step). Tip-tap rich editor with embeds.",
    iconKey: "BookOpen",
    hue: "teal",
    suite: "CROSS",
    tier: "CORE",
    status: "LIVE",
    defaultEnabled: true,
    displayOrder: 20,
    legacyModuleKey: "sops",
    pathPrefix: "/sops",
  },
  {
    slug: "workwrk-goals",
    name: "WorkwrK Goals",
    tagline: "OKRs + KRAs + KPIs aligned",
    description:
      "Company → team → individual OKRs with check-ins. KRA assignments + monthly KPI scorecards. Manager notes + performance scoring. Yearly goals for growth plans.",
    iconKey: "Crosshair",
    hue: "violet",
    suite: "CROSS",
    tier: "CORE",
    status: "LIVE",
    defaultEnabled: true,
    displayOrder: 30,
    legacyModuleKey: "kra-kpi",
    pathPrefix: "/okrs",
  },
  {
    slug: "workwrk-meetings",
    name: "WorkwrK Meetings",
    tagline: "1:1s, standups, retros, action items",
    description:
      "Agenda templates, collaborative notes (TipTap), attendees + action items that spawn into Tasks. AI-powered Notetaker captures transcripts and extracts decisions.",
    iconKey: "MessageSquare",
    hue: "amber",
    suite: "CROSS",
    tier: "CORE",
    status: "LIVE",
    defaultEnabled: true,
    displayOrder: 40,
    legacyModuleKey: "meetings",
    pathPrefix: "/meetings",
  },
  {
    slug: "workwrk-culture",
    name: "WorkwrK Culture",
    tagline: "Kudos, ideas, surveys, announcements",
    description:
      "Kudos feed with values + reactions, idea submission + voting, pulse surveys, broadcast announcements + acknowledgements, anonymous candor sessions, policy library.",
    iconKey: "Heart",
    hue: "pink",
    suite: "CROSS",
    tier: "CORE",
    status: "LIVE",
    defaultEnabled: true,
    displayOrder: 50,
    pathPrefix: "/kudos",
  },

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
  {
    slug: "workwrk-success",
    name: "WorkwrK Success",
    tagline: "Renewals, health scores, QBRs",
    description:
      "Account health scoring, renewal pipeline, expansion plays, NPS surveys, QBR templates. Build on top of CRM accounts.",
    iconKey: "Activity",
    hue: "teal",
    suite: "SALES",
    tier: "SUITE",
    status: "COMING_SOON",
    defaultEnabled: false,
    displayOrder: 210,
    pathPrefix: "/success",
    seededAgents: ["cara-csm"],
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
  {
    slug: "workwrk-inventory",
    name: "WorkwrK Inventory",
    tagline: "SKUs, stock, warehouses, transfers",
    description:
      "SKUs + variants, multi-warehouse stock levels, inter-warehouse transfers, cycle counts, low-stock alerts. For physical-goods businesses.",
    iconKey: "Package",
    hue: "sky",
    suite: "OPERATIONS",
    tier: "SUITE",
    status: "COMING_SOON",
    defaultEnabled: false,
    displayOrder: 320,
    pathPrefix: "/inventory",
    seededAgents: ["inko-stock-watcher"],
  },
  {
    slug: "workwrk-field-ops",
    name: "WorkwrK Field Ops",
    tagline: "Technicians, jobs, routes, dispatch",
    description:
      "Field technician scheduling, job assignment, route optimization, parts management, customer signatures. For services + repair businesses.",
    iconKey: "Wrench",
    hue: "slate",
    suite: "OPERATIONS",
    tier: "SUITE",
    status: "COMING_SOON",
    defaultEnabled: false,
    displayOrder: 330,
    pathPrefix: "/field-ops",
    seededAgents: ["fern-dispatcher"],
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
  {
    slug: "workwrk-access",
    name: "WorkwrK Access",
    tagline: "Provisioning, SoD, access reviews",
    description:
      "Joiner-Mover-Leaver flows, provisioning + deprovisioning automations, separation-of-duties, periodic access reviews. SOC2-friendly.",
    iconKey: "Shield",
    hue: "rose",
    suite: "IT",
    tier: "SUITE",
    status: "COMING_SOON",
    defaultEnabled: false,
    displayOrder: 410,
    pathPrefix: "/access",
    seededAgents: ["axel-access-reviewer"],
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
  {
    slug: "workwrk-content",
    name: "WorkwrK Content",
    tagline: "Editorial calendar, briefs, approvals",
    description:
      "Content calendar across blog/social/email, brief templates, asset library, approval flows, scheduled publishing.",
    iconKey: "FileText",
    hue: "rose",
    suite: "MARKETING",
    tier: "PLUS",
    status: "COMING_SOON",
    defaultEnabled: false,
    displayOrder: 510,
    pathPrefix: "/content",
    seededAgents: ["cora-editor"],
  },
  {
    slug: "workwrk-events",
    name: "WorkwrK Events",
    tagline: "Plan + run events, track ROI",
    description:
      "Event planning, sessions + speakers, registration forms, sponsor management, post-event ROI dashboards.",
    iconKey: "CalendarDays",
    hue: "violet",
    suite: "MARKETING",
    tier: "PLUS",
    status: "COMING_SOON",
    defaultEnabled: false,
    displayOrder: 520,
    pathPrefix: "/events",
    seededAgents: ["eva-event-planner"],
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
  {
    slug: "workwrk-incidents",
    name: "WorkwrK Incidents",
    tagline: "Oncall, incidents, postmortems",
    description:
      "On-call rotations, incident response timeline, runbook execution, blameless postmortems. PagerDuty + incident.io combined.",
    iconKey: "AlertTriangle",
    hue: "rose",
    suite: "ENGINEERING",
    tier: "SUITE",
    status: "COMING_SOON",
    defaultEnabled: false,
    displayOrder: 610,
    pathPrefix: "/incidents",
    seededAgents: ["ira-incident-commander"],
    seededIntegrations: ["pagerduty", "slack", "datadog"],
  },
  {
    slug: "workwrk-roadmap",
    name: "WorkwrK Roadmap",
    tagline: "Themes, initiatives, public changelog",
    description:
      "Product roadmap (themes + initiatives), tied to OKRs + epics, public changelog page for customer announcements.",
    iconKey: "Map",
    hue: "teal",
    suite: "ENGINEERING",
    tier: "SUITE",
    status: "COMING_SOON",
    defaultEnabled: false,
    displayOrder: 620,
    pathPrefix: "/roadmap",
    seededAgents: ["rhea-roadmap-strategist"],
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
  {
    slug: "workwrk-tax",
    name: "WorkwrK Tax",
    tagline: "Filings, jurisdictions, compliance",
    description:
      "Tax filing calendar, multi-jurisdiction tracking, compliance reminders, document hub. Lightweight bookkeeper-friendly module.",
    iconKey: "FileText",
    hue: "slate",
    suite: "FINANCE",
    tier: "SUITE",
    status: "COMING_SOON",
    defaultEnabled: false,
    displayOrder: 730,
    pathPrefix: "/tax",
    seededAgents: ["tex-tax-watcher"],
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
    name: "WorkwrK Help",
    tagline: "Customer support tickets + KB",
    description:
      "External customer support tickets, queues + SLAs, macros, CSAT surveys, integrated knowledge base. Zendesk-for-SMB.",
    iconKey: "Headphones",
    hue: "teal",
    suite: "SUPPORT",
    tier: "PLUS",
    status: "COMING_SOON",
    defaultEnabled: false,
    displayOrder: 900,
    pathPrefix: "/help",
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
  sales: ["workwrk-crm", "workwrk-success"],
  operations: [
    "workwrk-procurement",
    "workwrk-assets",
    "workwrk-inventory",
    "workwrk-field-ops",
  ],
  it: ["workwrk-itsm", "workwrk-access", "workwrk-assets"],
  marketing: ["workwrk-campaigns", "workwrk-content", "workwrk-events"],
  finance: ["workwrk-books", "workwrk-fpa", "workwrk-expense", "workwrk-tax"],
  engineering: ["workwrk-dev", "workwrk-incidents", "workwrk-roadmap"],
  legal: ["workwrk-contracts", "workwrk-privacy"],
  support: ["workwrk-help"],
  "all-in-one": PRODUCT_CATALOG.filter((p) => p.status !== "COMING_SOON" && p.status !== "DEPRECATED").map(
    (p) => p.slug,
  ),
};
