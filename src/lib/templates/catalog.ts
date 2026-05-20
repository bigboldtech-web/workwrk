// Seeded template catalog — Phase B6.
//
// Each template is a function that creates sample data for one product
// in one org. Templates are idempotent-ish — re-applying creates another
// copy (we don't dedupe by name) so users can re-run if they delete
// the sample data. Applying a template is a single transactional
// POST /api/templates/[slug]/apply.
//
// Each template ships with:
//   - slug (unique key)
//   - name + tagline (UI labels)
//   - productSlug (which product it belongs to)
//   - apply({ orgId, userId }) → { created: { ...counts } }

import { prisma } from "@/lib/prisma";

export interface TemplateContext {
  orgId: string;
  userId: string;
}

export interface CatalogTemplate {
  slug: string;
  name: string;
  tagline: string;
  productSlug: string;
  apply: (ctx: TemplateContext) => Promise<Record<string, number>>;
}

// ─────────────────────────────────────────────────────────
// CRM — B2B SaaS pipeline starter
// ─────────────────────────────────────────────────────────

const crmB2BPipeline: CatalogTemplate = {
  slug: "crm-b2b-saas-pipeline",
  name: "B2B SaaS pipeline",
  tagline: "3 accounts · 3 leads · 3 opportunities across the funnel",
  productSlug: "workwrk-crm",
  apply: async (ctx) => {
    // Stages auto-seed via /api/crm/pipeline-stages GET, so make sure
    // they exist before we plant deals into them.
    let stages = await prisma.pipelineStage.findMany({
      where: { organizationId: ctx.orgId, archivedAt: null },
      orderBy: { position: "asc" },
    });
    if (stages.length === 0) {
      const defaults = [
        { name: "New", position: 1, probability: 10, color: "#94a3b8" },
        { name: "Qualified", position: 2, probability: 25, color: "#60a5fa" },
        { name: "Proposal", position: 3, probability: 50, color: "#a78bfa" },
        { name: "Negotiation", position: 4, probability: 75, color: "#f59e0b" },
        { name: "Closed Won", position: 5, probability: 100, color: "#10b981", isWon: true },
        { name: "Closed Lost", position: 6, probability: 0, color: "#ef4444", isLost: true },
      ];
      for (const s of defaults) {
        await prisma.pipelineStage.create({
          data: {
            organizationId: ctx.orgId,
            name: s.name,
            position: s.position,
            probability: s.probability,
            color: s.color,
            isWon: s.isWon ?? false,
            isLost: s.isLost ?? false,
          },
        });
      }
      stages = await prisma.pipelineStage.findMany({
        where: { organizationId: ctx.orgId, archivedAt: null },
        orderBy: { position: "asc" },
      });
    }

    const acmeAccount = await prisma.account.create({
      data: { organizationId: ctx.orgId, name: "Acme Corp", domain: "acme.com", industry: "Healthcare", size: "201-1000", type: "PROSPECT", ownerId: ctx.userId },
    });
    const beaconAccount = await prisma.account.create({
      data: { organizationId: ctx.orgId, name: "Beacon Industries", domain: "beacon.io", industry: "Manufacturing", size: "51-200", type: "PROSPECT", ownerId: ctx.userId },
    });
    const cosmoAccount = await prisma.account.create({
      data: { organizationId: ctx.orgId, name: "Cosmo Analytics", domain: "cosmo.ai", industry: "Technology / SaaS", size: "11-50", type: "CUSTOMER", ownerId: ctx.userId },
    });

    await prisma.lead.createMany({
      data: [
        { organizationId: ctx.orgId, firstName: "Sarah", lastName: "Chen", email: "sarah@acme.com", company: "Acme Corp", title: "VP Engineering", source: "linkedin", status: "QUALIFIED", score: 80, ownerId: ctx.userId },
        { organizationId: ctx.orgId, firstName: "Marcus", lastName: "Reeves", email: "marcus@beacon.io", company: "Beacon Industries", title: "COO", source: "referral", status: "CONTACTED", score: 60, ownerId: ctx.userId },
        { organizationId: ctx.orgId, firstName: "Priya", lastName: "Iyer", email: "priya@cosmo.ai", company: "Cosmo Analytics", title: "Head of Data", source: "website", status: "NEW", score: 40, ownerId: ctx.userId },
      ],
    });

    const newStage = stages.find((s) => s.position === 1);
    const propStage = stages.find((s) => s.position === 3);
    const negoStage = stages.find((s) => s.position === 4);

    await prisma.opportunity.create({
      data: { organizationId: ctx.orgId, name: "Acme Corp · annual contract", accountId: acmeAccount.id, pipelineStageId: negoStage?.id, amount: 84000, currency: "USD", expectedCloseDate: new Date(Date.now() + 14 * 86400000), ownerId: ctx.userId },
    });
    await prisma.opportunity.create({
      data: { organizationId: ctx.orgId, name: "Beacon · pilot to production", accountId: beaconAccount.id, pipelineStageId: propStage?.id, amount: 24000, currency: "USD", expectedCloseDate: new Date(Date.now() + 30 * 86400000), ownerId: ctx.userId },
    });
    await prisma.opportunity.create({
      data: { organizationId: ctx.orgId, name: "Cosmo Analytics · expansion", accountId: cosmoAccount.id, pipelineStageId: newStage?.id, amount: 12000, currency: "USD", expectedCloseDate: new Date(Date.now() + 60 * 86400000), ownerId: ctx.userId },
    });

    return { accounts: 3, leads: 3, opportunities: 3, stages: stages.length };
  },
};

// ─────────────────────────────────────────────────────────
// ITSM — IT helpdesk starter
// ─────────────────────────────────────────────────────────

const itsmStarter: CatalogTemplate = {
  slug: "itsm-it-helpdesk-starter",
  name: "IT helpdesk starter",
  tagline: "3 sample tickets across categories · 2 KB articles",
  productSlug: "workwrk-itsm",
  apply: async (ctx) => {
    await prisma.ticket.createMany({
      data: [
        { organizationId: ctx.orgId, title: "Can't connect to VPN", description: "VPN client errors with timeout after authentication", priority: "HIGH", category: "Network", source: "PORTAL", status: "OPEN", requesterId: ctx.userId },
        { organizationId: ctx.orgId, title: "Request: Slack workspace access for new hire", description: "New hire starts Monday — needs access to #eng and #all-hands", priority: "NORMAL", category: "Access", source: "PORTAL", status: "TRIAGED", requesterId: ctx.userId },
        { organizationId: ctx.orgId, title: "Laptop running hot under load", description: "Fan at full speed even on light tasks. Possible thermal paste issue.", priority: "LOW", category: "Hardware", source: "EMAIL", status: "WAITING_ON_VENDOR", requesterId: ctx.userId },
      ],
    });

    await prisma.kbArticle.create({
      data: {
        organizationId: ctx.orgId,
        slug: "how-to-reset-your-password-" + Date.now(),
        title: "How to reset your password",
        excerpt: "Step-by-step guide to resetting your WorkwrK password.",
        body: "## How to reset\n\n1. Go to /login\n2. Click 'Forgot password'\n3. Enter your email\n4. Check inbox for the reset link (5 minutes)\n5. Click the link, choose a new password\n\nIf you don't receive an email, check spam or contact IT.",
        category: "Access",
        authorId: ctx.userId,
        publishedAt: new Date(),
        tags: ["password", "access", "self-serve"],
      },
    });
    await prisma.kbArticle.create({
      data: {
        organizationId: ctx.orgId,
        slug: "vpn-setup-guide-" + Date.now(),
        title: "VPN setup guide (macOS + Windows)",
        excerpt: "Configure the corporate VPN on a new laptop in under 10 minutes.",
        body: "## macOS\n\n1. Download the VPN client from IT portal\n2. Run installer\n3. Open VPN client, enter your work email\n4. SSO redirect → approve\n\n## Windows\n\nSame steps, different installer (.exe). Restart required after install.",
        category: "Networking",
        authorId: ctx.userId,
        publishedAt: new Date(),
        tags: ["vpn", "setup", "onboarding"],
      },
    });

    return { tickets: 3, articles: 2 };
  },
};

// ─────────────────────────────────────────────────────────
// Marketing — Q4 campaign launch
// ─────────────────────────────────────────────────────────

const marketingQ4Launch: CatalogTemplate = {
  slug: "marketing-q4-launch",
  name: "Q4 campaign launch",
  tagline: "2 campaigns · 3 content pieces · 1 event",
  productSlug: "workwrk-campaigns",
  apply: async (ctx) => {
    const camp1 = await prisma.campaign.create({
      data: { organizationId: ctx.orgId, name: "Q4 demand gen", description: "Drive demo requests for the new analytics suite.", channel: "Paid Search", budget: 50000, currency: "USD", goalMetric: "Leads", goalTarget: 200, ownerId: ctx.userId, startDate: new Date(), endDate: new Date(Date.now() + 90 * 86400000) },
    });
    await prisma.campaign.create({
      data: { organizationId: ctx.orgId, name: "Customer expansion email series", description: "Re-engage power users with a 6-touch sequence.", channel: "Email", budget: 5000, currency: "USD", goalMetric: "Pipeline", goalTarget: 300000, ownerId: ctx.userId, startDate: new Date() },
    });

    await prisma.contentItem.createMany({
      data: [
        { organizationId: ctx.orgId, title: "How 3 Fortune-500s scaled HR with WorkwrK", type: "CASE_STUDY", channel: "Blog", status: "IN_DRAFT", ownerId: ctx.userId, authorId: ctx.userId, campaignId: camp1.id, scheduledFor: new Date(Date.now() + 7 * 86400000) },
        { organizationId: ctx.orgId, title: "5 SOPs every new hire should read in week 1", type: "BLOG_POST", channel: "Blog", status: "BRIEFED", ownerId: ctx.userId, authorId: ctx.userId, scheduledFor: new Date(Date.now() + 14 * 86400000) },
        { organizationId: ctx.orgId, title: "Webinar: Modular Work OS — the alternative to Workday", type: "WEBINAR", channel: "LinkedIn", status: "SCHEDULED", ownerId: ctx.userId, authorId: ctx.userId, campaignId: camp1.id, scheduledFor: new Date(Date.now() + 21 * 86400000) },
      ],
    });

    await prisma.eventBrief.create({
      data: { organizationId: ctx.orgId, name: "WorkwrK at SaaStr 2025", description: "Booth + 1 speaker session on AI agents in HR ops.", type: "Conference", format: "In-person", startDate: new Date(Date.now() + 75 * 86400000), endDate: new Date(Date.now() + 77 * 86400000), location: "San Francisco, CA", capacity: 5000, budget: 75000, status: "PROMOTING", ownerId: ctx.userId },
    });

    return { campaigns: 2, content: 3, events: 1 };
  },
};

// ─────────────────────────────────────────────────────────
// Dev — Sprint planning starter
// ─────────────────────────────────────────────────────────

const devSprintStarter: CatalogTemplate = {
  slug: "dev-sprint-planning-starter",
  name: "Sprint planning starter",
  tagline: "Current sprint · 3 roadmap items · 1 upcoming release",
  productSlug: "workwrk-dev",
  apply: async (ctx) => {
    const today = new Date();
    const sprintStart = new Date(today);
    sprintStart.setHours(0, 0, 0, 0);
    const sprintEnd = new Date(sprintStart.getTime() + 14 * 86400000);

    await prisma.sprint.create({
      data: { organizationId: ctx.orgId, name: "Sprint 24 · onboarding rollup", goal: "Cut new-user time-to-first-task from 3 days to 1 day.", startDate: sprintStart, endDate: sprintEnd, status: "ACTIVE", capacityPoints: 40, committedPoints: 34, completedPoints: 12 },
    });

    await prisma.roadmapItem.createMany({
      data: [
        { organizationId: ctx.orgId, title: "AI-assisted onboarding (Maya handoff to Sidekick)", description: "Maya completes day-1 plan + escalates to Sidekick for ongoing questions.", theme: "AI", priority: "P1", status: "COMMITTED", quarter: "2026-Q2", impactScore: 8, effortPoints: 21, ownerId: ctx.userId, publicVisible: false },
        { organizationId: ctx.orgId, title: "Mobile push for approvals", description: "Native push when an approval lands in your queue.", theme: "Mobile", priority: "P2", status: "EXPLORING", quarter: "2026-Q3", impactScore: 6, effortPoints: 13, ownerId: ctx.userId, publicVisible: true },
        { organizationId: ctx.orgId, title: "Bulk CSV import for People + CRM", description: "First-class import path with field mapping + dry-run preview.", theme: "Performance", priority: "P2", status: "IN_PROGRESS", quarter: "2026-Q2", impactScore: 7, effortPoints: 8, ownerId: ctx.userId, publicVisible: false },
      ],
    });

    await prisma.release.create({
      data: { organizationId: ctx.orgId, version: "v2026.6.0", name: "Onboarding 2.0", description: "Maya-led onboarding, mobile approvals, CSV import.", releaseType: "Minor", status: "IN_DEVELOPMENT", scheduledFor: new Date(today.getTime() + 30 * 86400000), isPublic: true },
    });

    return { sprints: 1, roadmapItems: 3, releases: 1 };
  },
};

// ─────────────────────────────────────────────────────────
// Legal — Contract intake starter
// ─────────────────────────────────────────────────────────

const legalContractIntake: CatalogTemplate = {
  slug: "legal-contract-intake",
  name: "Contract intake starter",
  tagline: "3 sample contracts at common stages",
  productSlug: "workwrk-contracts",
  apply: async (ctx) => {
    const now = new Date();
    const oneYear = (offset = 0) => new Date(now.getTime() + (365 + offset) * 86400000);

    await prisma.contract.createMany({
      data: [
        { organizationId: ctx.orgId, title: "Stripe — payment processing MSA", counterparty: "Stripe, Inc.", counterpartyType: "Vendor", type: "MSA", status: "ACTIVE", value: 0, currency: "USD", signedAt: now, effectiveDate: now, expiresAt: oneYear(), autoRenew: true, renewalNoticeDays: 60, ownerId: ctx.userId },
        { organizationId: ctx.orgId, title: "Acme Corp — annual subscription order form", counterparty: "Acme Corp", counterpartyType: "Customer", type: "Order Form", status: "AWAITING_SIGNATURE", value: 84000, currency: "USD", effectiveDate: now, expiresAt: oneYear(), ownerId: ctx.userId },
        { organizationId: ctx.orgId, title: "Vendor X — data processing agreement", counterparty: "Vendor X Ltd.", counterpartyType: "Vendor", type: "DPA", status: "IN_REVIEW", value: 0, currency: "USD", ownerId: ctx.userId },
      ],
    });

    return { contracts: 3 };
  },
};

// ─────────────────────────────────────────────────────────
// Helpdesk — Support starter
// ─────────────────────────────────────────────────────────

const helpdeskSupportStarter: CatalogTemplate = {
  slug: "helpdesk-support-starter",
  name: "Support starter",
  tagline: "3 canned response macros · 2 sample tickets",
  productSlug: "workwrk-help",
  apply: async (ctx) => {
    const stamp = Date.now();
    await prisma.supportMacro.createMany({
      data: [
        { organizationId: ctx.orgId, slug: "password-reset-" + stamp, title: "Password reset instructions", body: "Hi {{customer_name}},\n\nTo reset your password:\n1. Go to https://app.workwrk.com/login\n2. Click 'Forgot password'\n3. Enter your account email\n4. Check your inbox (and spam) within 5 minutes\n\nLet me know if you don't receive the email and we'll dig in together.\n\n—\n{{agent_name}}", category: "Account", resolves: false },
        { organizationId: ctx.orgId, slug: "refund-policy-" + stamp, title: "Refund policy explanation", body: "Hi {{customer_name}},\n\nThanks for reaching out. Our refund policy is:\n- Within 30 days of purchase: full refund, no questions\n- After 30 days: pro-rated based on usage\n\nI'll get this processed for you today. Could you confirm the email address on the account?", category: "Billing", resolves: false },
        { organizationId: ctx.orgId, slug: "escalation-to-engineering-" + stamp, title: "Escalation to engineering", body: "Hi {{customer_name}},\n\nThanks for the detailed report — this looks like a bug rather than a config issue. I've escalated to our engineering team and they'll have eyes on it within 1 business day.\n\nI'll keep you posted here as soon as I hear back.\n\n—\n{{agent_name}}", category: "Product", resolves: false },
      ],
    });

    // Create two sample tickets with their customers
    const cust1 = await prisma.supportCustomer.upsert({
      where: { organizationId_email: { organizationId: ctx.orgId, email: "sarah@acme.com" } },
      create: { organizationId: ctx.orgId, email: "sarah@acme.com", name: "Sarah Chen", companyName: "Acme Corp" },
      update: {},
    });
    const cust2 = await prisma.supportCustomer.upsert({
      where: { organizationId_email: { organizationId: ctx.orgId, email: "ben@startup.com" } },
      create: { organizationId: ctx.orgId, email: "ben@startup.com", name: "Ben Park", companyName: "Startup Co" },
      update: {},
    });

    await prisma.supportTicket.createMany({
      data: [
        { organizationId: ctx.orgId, subject: "Can't export data to CSV", body: "When I click Export on the People page, nothing happens. Browser console shows a 500.", customerId: cust1.id, channel: "EMAIL", priority: "HIGH", category: "Bug", slaTier: "Enterprise", status: "OPEN", firstResponseDueAt: new Date(Date.now() + 4 * 60 * 60 * 1000) },
        { organizationId: ctx.orgId, subject: "Pricing question: 75-seat plan vs Enterprise", body: "We're growing fast — is there a way to lock in pricing for the next 3 years?", customerId: cust2.id, channel: "CHAT", priority: "NORMAL", category: "Billing", slaTier: "Premium", status: "NEW", firstResponseDueAt: new Date(Date.now() + 8 * 60 * 60 * 1000) },
      ],
    });

    return { macros: 3, customers: 2, tickets: 2 };
  },
};

// ─────────────────────────────────────────────────────────
// Cross-product: Personal todo starter
// ─────────────────────────────────────────────────────────

const personalTodoStarter: CatalogTemplate = {
  slug: "work-personal-todo",
  name: "Personal todo starter",
  tagline: "5 sample tasks across this week",
  productSlug: "workwrk-work",
  apply: async (ctx) => {
    const today = new Date();
    const tomorrow = new Date(today.getTime() + 86400000);
    const inAWeek = new Date(today.getTime() + 7 * 86400000);

    await prisma.task.createMany({
      data: [
        { organizationId: ctx.orgId, title: "Review pull request #421", description: "Review the new Sidekick agent persistence logic", priority: "HIGH", date: today, assigneeId: ctx.userId, source: "MANUAL" },
        { organizationId: ctx.orgId, title: "1:1 prep — agenda for Friday", description: "Pull last week's action items + draft this week's topics", priority: "NORMAL", date: tomorrow, assigneeId: ctx.userId, source: "MANUAL" },
        { organizationId: ctx.orgId, title: "Write retrospective notes from last sprint", description: "What went well · What didn't · What we'll try next sprint", priority: "NORMAL", date: tomorrow, assigneeId: ctx.userId, source: "MANUAL" },
        { organizationId: ctx.orgId, title: "Update OKR mid-quarter check-in", description: "Confidence scores + risks for each KR", priority: "NORMAL", date: inAWeek, assigneeId: ctx.userId, source: "MANUAL" },
        { organizationId: ctx.orgId, title: "Read 'High Output Management' chapter 4", description: "Continuing the weekly book habit", priority: "LOW", date: inAWeek, assigneeId: ctx.userId, source: "MANUAL" },
      ],
    });

    return { tasks: 5 };
  },
};

// ─────────────────────────────────────────────────────────
// Registry
// ─────────────────────────────────────────────────────────

export const TEMPLATE_CATALOG: CatalogTemplate[] = [
  personalTodoStarter,
  crmB2BPipeline,
  itsmStarter,
  marketingQ4Launch,
  devSprintStarter,
  legalContractIntake,
  helpdeskSupportStarter,
];

export const TEMPLATES_BY_SLUG: Record<string, CatalogTemplate> = Object.fromEntries(
  TEMPLATE_CATALOG.map((t) => [t.slug, t]),
);

export const TEMPLATES_BY_PRODUCT: Record<string, CatalogTemplate[]> = TEMPLATE_CATALOG.reduce(
  (acc, t) => {
    (acc[t.productSlug] ??= []).push(t);
    return acc;
  },
  {} as Record<string, CatalogTemplate[]>,
);
