// Agent tool registry — Phase D3.
//
// Each tool is exposed to Claude via the Anthropic tool calling
// interface. When Claude wants to use a tool, the chat endpoint
// executes the handler and feeds the result back. Tools always run
// scoped to the calling user's org — no cross-org reads or writes.
//
// Tool selection for a chat:
//   - General Sidekick session (no agent) → CROSS_TOOLS (5 tools)
//   - Agent-scoped session → CROSS_TOOLS ∪ the agent's catalog.tools
//
// We DON'T expose every WorkwrK model as a tool — only the high-value
// "create + look up" surface the user would actually delegate. Power
// users can drop to the UI for everything else.

import { prisma } from "@/lib/prisma";

export interface ToolContext {
  orgId: string;
  userId: string;
}

export interface ToolDefinition {
  name: string;
  description: string;
  // JSON Schema for the input — what Anthropic SDK calls input_schema.
  input_schema: {
    type: "object";
    properties: Record<string, unknown>;
    required?: string[];
  };
  // Handler receives the validated input and returns a JSON-serializable
  // result. Throw to indicate an error; the chat loop catches + sends
  // the error string back to Claude so it can react.
  handler: (ctx: ToolContext, input: Record<string, unknown>) => Promise<unknown>;
}

// ─────────────────────────────────────────────────────────
// Cross-product tools (available to every chat session)
// ─────────────────────────────────────────────────────────

const createTask: ToolDefinition = {
  name: "create_task",
  description:
    "Create a new task in WorkwrK Work. Use this when the user asks you to follow up, schedule, or capture a to-do. The task is assigned to the current user by default unless an assignee email is specified.",
  input_schema: {
    type: "object",
    properties: {
      title: { type: "string", description: "Short, actionable title (e.g. 'Follow up with Acme Corp')" },
      description: { type: "string", description: "Optional details, links, context" },
      priority: {
        type: "string",
        enum: ["LOW", "NORMAL", "HIGH", "URGENT"],
        description: "Defaults to NORMAL",
      },
      dueIsoDate: {
        type: "string",
        description: "Optional ISO 8601 date the task is due (YYYY-MM-DD or full datetime). Defaults to today.",
      },
      assigneeEmail: {
        type: "string",
        description: "Optional. If specified, find a user in this org by email and assign to them. Otherwise assigns to the caller.",
      },
    },
    required: ["title"],
  },
  handler: async (ctx, input) => {
    let assigneeId = ctx.userId;
    if (input.assigneeEmail) {
      const user = await prisma.user.findFirst({
        where: { email: input.assigneeEmail as string, organizationId: ctx.orgId },
        select: { id: true, firstName: true, lastName: true },
      });
      if (!user) {
        return { error: `No user with email '${input.assigneeEmail}' in this organization. Task not created.` };
      }
      assigneeId = user.id;
    }

    const date = input.dueIsoDate ? new Date(input.dueIsoDate as string) : new Date();
    const priorityMap: Record<string, "LOW" | "NORMAL" | "HIGH" | "URGENT"> = {
      LOW: "LOW", NORMAL: "NORMAL", HIGH: "HIGH", URGENT: "URGENT",
    };
    const task = await prisma.task.create({
      data: {
        organizationId: ctx.orgId,
        title: input.title as string,
        description: (input.description as string) ?? null,
        priority: priorityMap[input.priority as string] ?? "NORMAL",
        date,
        assigneeId,
      },
      select: { id: true, title: true, priority: true, date: true, assigneeId: true },
    });
    return { ok: true, task };
  },
};

const searchTasks: ToolDefinition = {
  name: "search_tasks",
  description:
    "List tasks in WorkwrK Work, optionally filtered. Use this to answer 'what's on my plate' or to find a task before updating it.",
  input_schema: {
    type: "object",
    properties: {
      status: {
        type: "string",
        enum: ["PLANNED", "IN_PROGRESS", "COMPLETED"],
        description: "Filter to a single status",
      },
      assignedToMe: { type: "boolean", description: "Only my tasks" },
      titleContains: { type: "string", description: "Case-insensitive substring match" },
      limit: { type: "integer", description: "Max rows (default 20, max 50)" },
    },
  },
  handler: async (ctx, input) => {
    const limit = Math.min(50, Number(input.limit ?? 20));
    const tasks = await prisma.task.findMany({
      where: {
        organizationId: ctx.orgId,
        ...(input.status ? { status: input.status as "PLANNED" | "IN_PROGRESS" | "COMPLETED" } : {}),
        ...(input.assignedToMe ? { assigneeId: ctx.userId } : {}),
        ...(input.titleContains ? { title: { contains: input.titleContains as string, mode: "insensitive" } } : {}),
      },
      select: { id: true, title: true, status: true, priority: true, date: true, assigneeId: true },
      orderBy: { date: "desc" },
      take: limit,
    });
    return { count: tasks.length, tasks };
  },
};

const sendKudos: ToolDefinition = {
  name: "send_kudos",
  description:
    "Send a kudos message (public recognition) to a teammate. Use this when the user wants to celebrate someone's contribution.",
  input_schema: {
    type: "object",
    properties: {
      receiverEmail: { type: "string", description: "Email of the person being recognized" },
      message: { type: "string", description: "The recognition message" },
      companyValue: { type: "string", description: "Optional company value being celebrated (e.g. 'Customer First')" },
    },
    required: ["receiverEmail", "message"],
  },
  handler: async (ctx, input) => {
    const receiver = await prisma.user.findFirst({
      where: { email: input.receiverEmail as string, organizationId: ctx.orgId },
      select: { id: true, firstName: true, lastName: true },
    });
    if (!receiver) return { error: `No user with email '${input.receiverEmail}' in this organization.` };

    const kudos = await prisma.kudos.create({
      data: {
        organizationId: ctx.orgId,
        giverId: ctx.userId,
        receiverId: receiver.id,
        message: input.message as string,
        companyValue: (input.companyValue as string) ?? null,
      },
      select: { id: true, message: true, companyValue: true },
    });
    return { ok: true, kudos, receiver: `${receiver.firstName ?? ""} ${receiver.lastName ?? ""}`.trim() };
  },
};

// ─────────────────────────────────────────────────────────
// CRM (Ria's tools)
// ─────────────────────────────────────────────────────────

const createLead: ToolDefinition = {
  name: "create_lead",
  description: "Add a new lead to WorkwrK CRM. Use when the user mentions a new prospect or wants to log inbound interest.",
  input_schema: {
    type: "object",
    properties: {
      firstName: { type: "string" },
      lastName: { type: "string" },
      email: { type: "string" },
      company: { type: "string" },
      title: { type: "string" },
      source: { type: "string", description: "e.g. 'website', 'referral', 'outbound', 'linkedin', 'event'" },
      notes: { type: "string" },
    },
    required: ["firstName"],
  },
  handler: async (ctx, input) => {
    const lead = await prisma.lead.create({
      data: {
        organizationId: ctx.orgId,
        firstName: input.firstName as string,
        lastName: (input.lastName as string) ?? null,
        email: (input.email as string) || undefined,
        company: (input.company as string) ?? null,
        title: (input.title as string) ?? null,
        source: (input.source as string) ?? null,
        notes: (input.notes as string) ?? null,
        ownerId: ctx.userId,
      },
      select: { id: true, firstName: true, lastName: true, company: true, status: true },
    });
    return { ok: true, lead };
  },
};

const createOpportunity: ToolDefinition = {
  name: "create_opportunity",
  description: "Create a new deal in WorkwrK CRM. Defaults to the first non-Won/non-Lost pipeline stage if no stage specified.",
  input_schema: {
    type: "object",
    properties: {
      name: { type: "string", description: "Deal name (e.g. 'Acme Corp · annual contract')" },
      accountName: { type: "string", description: "Optional account name to link. Will look up by name if it exists." },
      amount: { type: "number", description: "Deal value in USD" },
      expectedCloseDate: { type: "string", description: "ISO date" },
      description: { type: "string" },
    },
    required: ["name"],
  },
  handler: async (ctx, input) => {
    let accountId: string | undefined;
    if (input.accountName) {
      const account = await prisma.account.findFirst({
        where: { organizationId: ctx.orgId, name: input.accountName as string },
        select: { id: true },
      });
      accountId = account?.id;
    }

    const firstStage = await prisma.pipelineStage.findFirst({
      where: { organizationId: ctx.orgId, isWon: false, isLost: false, archivedAt: null },
      orderBy: { position: "asc" },
      select: { id: true },
    });

    const opp = await prisma.opportunity.create({
      data: {
        organizationId: ctx.orgId,
        name: input.name as string,
        accountId,
        pipelineStageId: firstStage?.id,
        amount: input.amount as number | undefined,
        currency: "USD",
        expectedCloseDate: input.expectedCloseDate ? new Date(input.expectedCloseDate as string) : null,
        description: (input.description as string) ?? null,
        ownerId: ctx.userId,
      },
      select: { id: true, name: true, amount: true, pipelineStageId: true },
    });
    return { ok: true, opportunity: opp };
  },
};

// ─────────────────────────────────────────────────────────
// ITSM (Aman's tools)
// ─────────────────────────────────────────────────────────

const createTicket: ToolDefinition = {
  name: "create_ticket",
  description: "File a new IT ticket in WorkwrK ITSM. Use when the user reports a problem or requests IT help.",
  input_schema: {
    type: "object",
    properties: {
      title: { type: "string", description: "Short summary" },
      description: { type: "string" },
      priority: {
        type: "string",
        enum: ["LOW", "NORMAL", "HIGH", "URGENT", "CRITICAL"],
      },
      category: { type: "string", description: "Access | Hardware | Software | Network | Other" },
    },
    required: ["title"],
  },
  handler: async (ctx, input) => {
    const priorityMap: Record<string, "LOW" | "NORMAL" | "HIGH" | "URGENT" | "CRITICAL"> = {
      LOW: "LOW", NORMAL: "NORMAL", HIGH: "HIGH", URGENT: "URGENT", CRITICAL: "CRITICAL",
    };
    const ticket = await prisma.ticket.create({
      data: {
        organizationId: ctx.orgId,
        title: input.title as string,
        description: (input.description as string) ?? null,
        priority: priorityMap[input.priority as string] ?? "NORMAL",
        category: (input.category as string) ?? null,
        source: "AGENT",
        requesterId: ctx.userId,
      },
      select: { id: true, title: true, status: true, priority: true },
    });
    return { ok: true, ticket };
  },
};

// ─────────────────────────────────────────────────────────
// Legal (Leila's tool)
// ─────────────────────────────────────────────────────────

const createContract: ToolDefinition = {
  name: "create_contract",
  description: "Track a new contract in WorkwrK Legal. Use when the user mentions a contract being negotiated or signed.",
  input_schema: {
    type: "object",
    properties: {
      title: { type: "string" },
      counterparty: { type: "string", description: "The other party's name" },
      type: { type: "string", description: "MSA | NDA | SOW | DPA | Order Form | ..." },
      counterpartyType: { type: "string", description: "Customer | Vendor | Partner | Investor | Employee" },
      value: { type: "number", description: "Contract value in USD" },
      expiresAt: { type: "string", description: "ISO date when the contract expires" },
    },
    required: ["title", "counterparty"],
  },
  handler: async (ctx, input) => {
    const contract = await prisma.contract.create({
      data: {
        organizationId: ctx.orgId,
        title: input.title as string,
        counterparty: input.counterparty as string,
        type: (input.type as string) ?? null,
        counterpartyType: (input.counterpartyType as string) ?? null,
        value: input.value as number | undefined,
        currency: "USD",
        expiresAt: input.expiresAt ? new Date(input.expiresAt as string) : null,
        ownerId: ctx.userId,
      },
      select: { id: true, title: true, counterparty: true, status: true },
    });
    return { ok: true, contract };
  },
};

// ─────────────────────────────────────────────────────────
// Dev (Dev's tool)
// ─────────────────────────────────────────────────────────

const createSprint: ToolDefinition = {
  name: "create_sprint",
  description: "Plan a new engineering sprint in WorkwrK Dev. Use when the user wants to capture a sprint goal + dates.",
  input_schema: {
    type: "object",
    properties: {
      name: { type: "string", description: "e.g. 'Sprint 24' or 'Q1 W3'" },
      goal: { type: "string", description: "Single sprint goal — what success looks like" },
      startDate: { type: "string", description: "ISO date" },
      endDate: { type: "string", description: "ISO date" },
      capacityPoints: { type: "integer", description: "Team capacity in story points" },
    },
    required: ["name", "startDate", "endDate"],
  },
  handler: async (ctx, input) => {
    const sprint = await prisma.sprint.create({
      data: {
        organizationId: ctx.orgId,
        name: input.name as string,
        goal: (input.goal as string) ?? null,
        startDate: new Date(input.startDate as string),
        endDate: new Date(input.endDate as string),
        capacityPoints: input.capacityPoints as number | undefined,
      },
      select: { id: true, name: true, startDate: true, endDate: true, status: true },
    });
    return { ok: true, sprint };
  },
};

// ─────────────────────────────────────────────────────────
// Marketing (Mira's tool)
// ─────────────────────────────────────────────────────────

const createCampaign: ToolDefinition = {
  name: "create_campaign",
  description: "Plan a new marketing campaign in WorkwrK Marketing.",
  input_schema: {
    type: "object",
    properties: {
      name: { type: "string" },
      description: { type: "string" },
      channel: { type: "string", description: "Email | Paid Search | Social | Outbound | Event | Content | Webinar" },
      budget: { type: "number" },
      goalMetric: { type: "string", description: "Leads | MQLs | Pipeline | Brand" },
      goalTarget: { type: "integer" },
    },
    required: ["name"],
  },
  handler: async (ctx, input) => {
    const campaign = await prisma.campaign.create({
      data: {
        organizationId: ctx.orgId,
        name: input.name as string,
        description: (input.description as string) ?? null,
        channel: (input.channel as string) ?? null,
        budget: input.budget as number | undefined,
        goalMetric: (input.goalMetric as string) ?? null,
        goalTarget: input.goalTarget as number | undefined,
        ownerId: ctx.userId,
      },
      select: { id: true, name: true, channel: true, status: true },
    });
    return { ok: true, campaign };
  },
};

// ─────────────────────────────────────────────────────────
// Helpdesk (Maya's tool)
// ─────────────────────────────────────────────────────────

const createSupportTicket: ToolDefinition = {
  name: "create_support_ticket",
  description: "File a new external customer support ticket in WorkwrK Helpdesk. Use when the user describes a customer issue or request.",
  input_schema: {
    type: "object",
    properties: {
      subject: { type: "string" },
      body: { type: "string", description: "The customer's message / what they reported" },
      customerEmail: { type: "string", description: "Customer's email — used to find-or-create their record" },
      customerName: { type: "string" },
      customerCompany: { type: "string" },
      priority: { type: "string", enum: ["LOW", "NORMAL", "HIGH", "URGENT"] },
      category: { type: "string", description: "Billing | Product | Bug | Feature Request | Onboarding" },
      slaTier: { type: "string", description: "Free | Standard | Premium | Enterprise" },
    },
    required: ["subject", "customerEmail"],
  },
  handler: async (ctx, input) => {
    // Find-or-create customer
    let customer = await prisma.supportCustomer.findUnique({
      where: { organizationId_email: { organizationId: ctx.orgId, email: input.customerEmail as string } },
    });
    if (!customer) {
      customer = await prisma.supportCustomer.create({
        data: {
          organizationId: ctx.orgId,
          email: input.customerEmail as string,
          name: (input.customerName as string) ?? null,
          companyName: (input.customerCompany as string) ?? null,
        },
      });
    }

    const slaHours: Record<string, number> = { Free: 48, Standard: 24, Premium: 8, Enterprise: 4 };
    const firstResponseDueAt = input.slaTier
      ? new Date(Date.now() + (slaHours[input.slaTier as string] ?? 24) * 60 * 60 * 1000)
      : null;

    const priorityMap: Record<string, "LOW" | "NORMAL" | "HIGH" | "URGENT"> = {
      LOW: "LOW", NORMAL: "NORMAL", HIGH: "HIGH", URGENT: "URGENT",
    };

    const ticket = await prisma.supportTicket.create({
      data: {
        organizationId: ctx.orgId,
        subject: input.subject as string,
        body: (input.body as string) ?? null,
        customerId: customer.id,
        channel: "PORTAL",
        priority: priorityMap[input.priority as string] ?? "NORMAL",
        category: (input.category as string) ?? null,
        slaTier: (input.slaTier as string) ?? null,
        firstResponseDueAt,
      },
      select: { id: true, subject: true, status: true, priority: true },
    });
    return { ok: true, ticket, customer: { email: customer.email, name: customer.name } };
  },
};

// ─────────────────────────────────────────────────────────
// CRM read + update tools (D3 Phase 2)
// ─────────────────────────────────────────────────────────

const searchLeads: ToolDefinition = {
  name: "search_leads",
  description: "Search this org's CRM leads. Use to find an existing lead before updating, or to answer 'how many leads from referrals are still open'.",
  input_schema: {
    type: "object",
    properties: {
      status: { type: "string", enum: ["NEW", "CONTACTED", "QUALIFIED", "UNQUALIFIED", "CONVERTED", "DISQUALIFIED"] },
      source: { type: "string", description: "e.g. website / referral / outbound" },
      emailContains: { type: "string" },
      nameContains: { type: "string", description: "Match against firstName OR lastName OR company" },
      assignedToMe: { type: "boolean" },
      limit: { type: "integer", description: "Max rows (default 20, max 50)" },
    },
  },
  handler: async (ctx, input) => {
    const limit = Math.min(50, Number(input.limit ?? 20));
    const nameNeedle = input.nameContains as string | undefined;
    const leads = await prisma.lead.findMany({
      where: {
        organizationId: ctx.orgId,
        ...(input.status ? { status: input.status as "NEW" | "CONTACTED" | "QUALIFIED" | "UNQUALIFIED" | "CONVERTED" | "DISQUALIFIED" } : {}),
        ...(input.source ? { source: input.source as string } : {}),
        ...(input.emailContains ? { email: { contains: input.emailContains as string, mode: "insensitive" } } : {}),
        ...(input.assignedToMe ? { ownerId: ctx.userId } : {}),
        ...(nameNeedle ? {
          OR: [
            { firstName: { contains: nameNeedle, mode: "insensitive" } },
            { lastName: { contains: nameNeedle, mode: "insensitive" } },
            { company: { contains: nameNeedle, mode: "insensitive" } },
          ],
        } : {}),
      },
      select: { id: true, firstName: true, lastName: true, email: true, company: true, status: true, score: true, source: true, createdAt: true },
      orderBy: [{ score: "desc" }, { createdAt: "desc" }],
      take: limit,
    });
    return { count: leads.length, leads };
  },
};

const updateLeadStatus: ToolDefinition = {
  name: "update_lead_status",
  description: "Move a lead to a new status. Use to qualify/disqualify a lead after a call, or mark CONVERTED after handing off to a closer.",
  input_schema: {
    type: "object",
    properties: {
      leadId: { type: "string", description: "The Lead's id" },
      status: { type: "string", enum: ["NEW", "CONTACTED", "QUALIFIED", "UNQUALIFIED", "CONVERTED", "DISQUALIFIED"] },
      notes: { type: "string", description: "Optional notes appended to the lead" },
    },
    required: ["leadId", "status"],
  },
  handler: async (ctx, input) => {
    const existing = await prisma.lead.findFirst({
      where: { id: input.leadId as string, organizationId: ctx.orgId },
      select: { id: true, notes: true },
    });
    if (!existing) return { error: "Lead not found in this org" };

    const appendedNotes = input.notes
      ? (existing.notes ? existing.notes + "\n\n" : "") + `[${new Date().toISOString().slice(0, 10)}] ${input.notes}`
      : existing.notes;

    const status = input.status as "NEW" | "CONTACTED" | "QUALIFIED" | "UNQUALIFIED" | "CONVERTED" | "DISQUALIFIED";
    const lead = await prisma.lead.update({
      where: { id: existing.id },
      data: {
        status,
        notes: appendedNotes,
        ...(status === "CONVERTED" ? { convertedAt: new Date() } : {}),
      },
      select: { id: true, firstName: true, lastName: true, status: true },
    });
    return { ok: true, lead };
  },
};

const searchOpportunities: ToolDefinition = {
  name: "search_opportunities",
  description: "Search CRM deals, optionally filtered by stage. Use to answer 'what's in the pipeline this quarter' or to find a specific deal.",
  input_schema: {
    type: "object",
    properties: {
      stageName: { type: "string", description: "Match the pipeline stage by name (case-insensitive)" },
      accountName: { type: "string" },
      isOpen: { type: "boolean", description: "Only deals that aren't Won or Lost" },
      minAmount: { type: "number" },
      limit: { type: "integer" },
    },
  },
  handler: async (ctx, input) => {
    const limit = Math.min(50, Number(input.limit ?? 20));
    const opps = await prisma.opportunity.findMany({
      where: {
        organizationId: ctx.orgId,
        ...(input.isOpen ? { closedAt: null } : {}),
        ...(input.accountName ? { account: { name: { contains: input.accountName as string, mode: "insensitive" } } } : {}),
        ...(input.stageName ? { pipelineStage: { name: { equals: input.stageName as string, mode: "insensitive" } } } : {}),
        ...(input.minAmount !== undefined ? { amount: { gte: input.minAmount as number } } : {}),
      },
      include: {
        account: { select: { name: true } },
        pipelineStage: { select: { name: true, isWon: true, isLost: true } },
      },
      orderBy: { updatedAt: "desc" },
      take: limit,
    });
    return {
      count: opps.length,
      opportunities: opps.map((o) => ({
        id: o.id, name: o.name, amount: o.amount, currency: o.currency,
        stage: o.pipelineStage?.name, accountName: o.account?.name,
        expectedCloseDate: o.expectedCloseDate, isWon: o.isWon,
      })),
    };
  },
};

const moveOpportunityStage: ToolDefinition = {
  name: "move_opportunity_stage",
  description: "Move a deal to a different pipeline stage. Use to advance a deal after a positive customer signal, or close it Won/Lost. Auto-stamps closedAt + isWon on terminal stages.",
  input_schema: {
    type: "object",
    properties: {
      opportunityId: { type: "string" },
      newStageName: { type: "string", description: "Target stage name (must exist in this org's pipeline)" },
    },
    required: ["opportunityId", "newStageName"],
  },
  handler: async (ctx, input) => {
    const opp = await prisma.opportunity.findFirst({
      where: { id: input.opportunityId as string, organizationId: ctx.orgId },
    });
    if (!opp) return { error: "Opportunity not found in this org" };

    const stage = await prisma.pipelineStage.findFirst({
      where: { organizationId: ctx.orgId, name: { equals: input.newStageName as string, mode: "insensitive" }, archivedAt: null },
    });
    if (!stage) return { error: `Stage "${input.newStageName}" not found. Use search_opportunities to see available stages.` };

    const now = new Date();
    let closedAt: Date | null | undefined;
    let isWon: boolean | null | undefined;
    if (stage.isWon) { closedAt = now; isWon = true; }
    else if (stage.isLost) { closedAt = now; isWon = false; }
    else if (opp.closedAt) { closedAt = null; isWon = null; }

    const updated = await prisma.opportunity.update({
      where: { id: opp.id },
      data: {
        pipelineStageId: stage.id,
        ...(closedAt !== undefined ? { closedAt } : {}),
        ...(isWon !== undefined ? { isWon } : {}),
      },
      select: { id: true, name: true, isWon: true, closedAt: true },
    });
    return { ok: true, opportunity: updated, stage: stage.name };
  },
};

// ─────────────────────────────────────────────────────────
// ITSM read + update tools
// ─────────────────────────────────────────────────────────

const searchTickets: ToolDefinition = {
  name: "search_tickets",
  description: "Search internal IT tickets. Use to triage the queue or find a specific ticket before updating.",
  input_schema: {
    type: "object",
    properties: {
      status: { type: "string", enum: ["OPEN", "TRIAGED", "IN_PROGRESS", "WAITING_ON_USER", "WAITING_ON_VENDOR", "RESOLVED", "CLOSED", "CANCELLED"] },
      priority: { type: "string", enum: ["LOW", "NORMAL", "HIGH", "URGENT", "CRITICAL"] },
      category: { type: "string" },
      titleContains: { type: "string" },
      assignedToMe: { type: "boolean" },
      limit: { type: "integer" },
    },
  },
  handler: async (ctx, input) => {
    const limit = Math.min(50, Number(input.limit ?? 20));
    const tickets = await prisma.ticket.findMany({
      where: {
        organizationId: ctx.orgId,
        ...(input.status ? { status: input.status as "OPEN" | "TRIAGED" | "IN_PROGRESS" | "WAITING_ON_USER" | "WAITING_ON_VENDOR" | "RESOLVED" | "CLOSED" | "CANCELLED" } : {}),
        ...(input.priority ? { priority: input.priority as "LOW" | "NORMAL" | "HIGH" | "URGENT" | "CRITICAL" } : {}),
        ...(input.category ? { category: input.category as string } : {}),
        ...(input.titleContains ? { title: { contains: input.titleContains as string, mode: "insensitive" } } : {}),
        ...(input.assignedToMe ? { assigneeId: ctx.userId } : {}),
      },
      select: { id: true, title: true, status: true, priority: true, category: true, requesterId: true, assigneeId: true, createdAt: true, dueAt: true },
      orderBy: [{ priority: "desc" }, { createdAt: "desc" }],
      take: limit,
    });
    return { count: tickets.length, tickets };
  },
};

const updateTicketStatus: ToolDefinition = {
  name: "update_ticket_status",
  description: "Triage or resolve a ticket. Sets the new status and auto-stamps acknowledgedAt/resolvedAt/closedAt. Optionally records resolution notes.",
  input_schema: {
    type: "object",
    properties: {
      ticketId: { type: "string" },
      status: { type: "string", enum: ["OPEN", "TRIAGED", "IN_PROGRESS", "WAITING_ON_USER", "WAITING_ON_VENDOR", "RESOLVED", "CLOSED", "CANCELLED"] },
      assigneeEmail: { type: "string", description: "Optional — reassign to a user by email" },
      resolutionNotes: { type: "string", description: "Required-ish when status=RESOLVED. Captures how the ticket was solved." },
    },
    required: ["ticketId", "status"],
  },
  handler: async (ctx, input) => {
    const existing = await prisma.ticket.findFirst({
      where: { id: input.ticketId as string, organizationId: ctx.orgId },
    });
    if (!existing) return { error: "Ticket not found in this org" };

    let assigneeId: string | undefined;
    if (input.assigneeEmail) {
      const u = await prisma.user.findFirst({
        where: { email: input.assigneeEmail as string, organizationId: ctx.orgId },
        select: { id: true },
      });
      if (!u) return { error: `User with email '${input.assigneeEmail}' not found in this org` };
      assigneeId = u.id;
    }

    const now = new Date();
    const status = input.status as "OPEN" | "TRIAGED" | "IN_PROGRESS" | "WAITING_ON_USER" | "WAITING_ON_VENDOR" | "RESOLVED" | "CLOSED" | "CANCELLED";
    const ticket = await prisma.ticket.update({
      where: { id: existing.id },
      data: {
        status,
        ...(assigneeId ? { assigneeId } : {}),
        ...(input.resolutionNotes ? { resolutionNotes: input.resolutionNotes as string } : {}),
        ...(status === "TRIAGED" && !existing.acknowledgedAt ? { acknowledgedAt: now } : {}),
        ...(status === "RESOLVED" && !existing.resolvedAt ? { resolvedAt: now } : {}),
        ...(status === "CLOSED" && !existing.closedAt ? { closedAt: now } : {}),
      },
      select: { id: true, title: true, status: true },
    });
    return { ok: true, ticket };
  },
};

// ─────────────────────────────────────────────────────────
// Legal read tools
// ─────────────────────────────────────────────────────────

const searchContracts: ToolDefinition = {
  name: "search_contracts",
  description: "Search the contract portfolio. Use to find a contract by counterparty or to flag what's expiring soon.",
  input_schema: {
    type: "object",
    properties: {
      counterpartyContains: { type: "string" },
      status: { type: "string", enum: ["DRAFT", "IN_REVIEW", "IN_NEGOTIATION", "AWAITING_SIGNATURE", "SIGNED", "ACTIVE", "EXPIRED", "RENEWED", "TERMINATED", "CANCELLED"] },
      expiringWithinDays: { type: "integer", description: "Only contracts expiring within N days" },
      limit: { type: "integer" },
    },
  },
  handler: async (ctx, input) => {
    const limit = Math.min(50, Number(input.limit ?? 20));
    const expWindow = input.expiringWithinDays as number | undefined;
    const expiresBefore = expWindow != null ? new Date(Date.now() + expWindow * 86400000) : null;

    const contracts = await prisma.contract.findMany({
      where: {
        organizationId: ctx.orgId,
        ...(input.counterpartyContains ? { counterparty: { contains: input.counterpartyContains as string, mode: "insensitive" } } : {}),
        ...(input.status ? { status: input.status as "DRAFT" | "IN_REVIEW" | "IN_NEGOTIATION" | "AWAITING_SIGNATURE" | "SIGNED" | "ACTIVE" | "EXPIRED" | "RENEWED" | "TERMINATED" | "CANCELLED" } : {}),
        ...(expiresBefore ? { expiresAt: { lte: expiresBefore, gte: new Date() } } : {}),
      },
      select: { id: true, title: true, counterparty: true, type: true, status: true, value: true, expiresAt: true, autoRenew: true },
      orderBy: { expiresAt: "asc" },
      take: limit,
    });
    return { count: contracts.length, contracts };
  },
};

// ─────────────────────────────────────────────────────────
// Helpdesk: apply macro to a ticket
// ─────────────────────────────────────────────────────────

const applyMacro: ToolDefinition = {
  name: "apply_macro",
  description: "Apply a canned-response macro to a Helpdesk ticket. Looks up the macro by slug, copies its body to the ticket's resolution context, optionally moves the ticket to RESOLVED when the macro is marked resolves=true. Records macro usage for analytics.",
  input_schema: {
    type: "object",
    properties: {
      ticketId: { type: "string", description: "The SupportTicket id" },
      macroSlug: { type: "string", description: "The macro's slug (e.g. 'password-reset')" },
    },
    required: ["ticketId", "macroSlug"],
  },
  handler: async (ctx, input) => {
    const ticket = await prisma.supportTicket.findFirst({
      where: { id: input.ticketId as string, organizationId: ctx.orgId },
    });
    if (!ticket) return { error: "Support ticket not found in this org" };

    const macro = await prisma.supportMacro.findFirst({
      where: { organizationId: ctx.orgId, slug: input.macroSlug as string, archivedAt: null },
    });
    if (!macro) return { error: `Macro '${input.macroSlug}' not found` };

    const now = new Date();
    const updated = await prisma.supportTicket.update({
      where: { id: ticket.id },
      data: {
        ...(macro.resolves ? { status: "RESOLVED", resolvedAt: ticket.resolvedAt ?? now } : {}),
        ...(ticket.firstResponseAt ? {} : { firstResponseAt: now }),
      },
      select: { id: true, subject: true, status: true },
    });

    await prisma.supportMacro.update({
      where: { id: macro.id },
      data: { usageCount: { increment: 1 } },
    });

    return { ok: true, ticket: updated, macro: { slug: macro.slug, body: macro.body, resolves: macro.resolves } };
  },
};

// ─────────────────────────────────────────────────────────
// Cross-product search
// ─────────────────────────────────────────────────────────

const searchKb: ToolDefinition = {
  name: "search_kb",
  description: "Search the KB articles (internal IT KB). Use to deflect a ticket — find an article that already answers the user's question.",
  input_schema: {
    type: "object",
    properties: {
      query: { type: "string", description: "Substring matched against title and body" },
      category: { type: "string" },
      onlyPublished: { type: "boolean" },
      limit: { type: "integer" },
    },
    required: ["query"],
  },
  handler: async (ctx, input) => {
    const limit = Math.min(20, Number(input.limit ?? 10));
    const q = input.query as string;
    const articles = await prisma.kbArticle.findMany({
      where: {
        organizationId: ctx.orgId,
        archivedAt: null,
        ...(input.category ? { category: input.category as string } : {}),
        ...(input.onlyPublished ? { publishedAt: { not: null } } : {}),
        OR: [
          { title: { contains: q, mode: "insensitive" } },
          { body: { contains: q, mode: "insensitive" } },
          { excerpt: { contains: q, mode: "insensitive" } },
        ],
      },
      select: { id: true, slug: true, title: true, excerpt: true, category: true, viewCount: true, publishedAt: true },
      orderBy: [{ viewCount: "desc" }, { updatedAt: "desc" }],
      take: limit,
    });
    return { count: articles.length, articles };
  },
};

const searchEmployees: ToolDefinition = {
  name: "search_employees",
  description: "Search this org's employees by name / email / role / department. Use to find a teammate to assign work to or to look up a coworker.",
  input_schema: {
    type: "object",
    properties: {
      query: { type: "string", description: "Matches firstName, lastName, email (case-insensitive substring)" },
      department: { type: "string", description: "Department name filter" },
      limit: { type: "integer" },
    },
  },
  handler: async (ctx, input) => {
    const limit = Math.min(30, Number(input.limit ?? 10));
    const q = input.query as string | undefined;
    const employees = await prisma.user.findMany({
      where: {
        organizationId: ctx.orgId,
        status: "ACTIVE",
        ...(input.department ? { department: { name: { equals: input.department as string, mode: "insensitive" } } } : {}),
        ...(q ? {
          OR: [
            { firstName: { contains: q, mode: "insensitive" } },
            { lastName: { contains: q, mode: "insensitive" } },
            { email: { contains: q, mode: "insensitive" } },
          ],
        } : {}),
      },
      select: {
        id: true, firstName: true, lastName: true, email: true, accessLevel: true,
        department: { select: { name: true } },
        role: { select: { title: true } },
      },
      orderBy: [{ firstName: "asc" }],
      take: limit,
    });
    return {
      count: employees.length,
      employees: employees.map((e) => ({
        id: e.id,
        name: `${e.firstName ?? ""} ${e.lastName ?? ""}`.trim(),
        email: e.email,
        department: e.department?.name ?? null,
        role: e.role?.title ?? null,
        accessLevel: e.accessLevel,
      })),
    };
  },
};

// ─────────────────────────────────────────────────────────
// Meetings (cross-product read)
// ─────────────────────────────────────────────────────────

const searchMeetings: ToolDefinition = {
  name: "search_meetings",
  description:
    "Search meetings on the org's calendar. Use to answer 'what's on my schedule', 'find my last 1:1 with Priya', or to pull up recent decisions/action items context.",
  input_schema: {
    type: "object",
    properties: {
      type: {
        type: "string",
        enum: ["DAILY_STANDUP", "WEEKLY_REVIEW", "ONE_ON_ONE", "QUARTERLY_REVIEW", "ANNUAL_PLANNING", "ADHOC"],
      },
      titleContains: { type: "string" },
      attendedByMe: { type: "boolean", description: "Only meetings the caller is invited to / attended" },
      upcoming: { type: "boolean", description: "Only meetings scheduled in the future" },
      withinDays: { type: "integer", description: "Window in days (past or future depending on `upcoming`)" },
      limit: { type: "integer", description: "Max rows (default 20, max 50)" },
    },
  },
  handler: async (ctx, input) => {
    const limit = Math.min(50, Number(input.limit ?? 20));
    const now = new Date();
    const windowMs = input.withinDays ? Number(input.withinDays) * 86400000 : null;

    const dateRange: { gte?: Date; lte?: Date } = {};
    if (input.upcoming) {
      dateRange.gte = now;
      if (windowMs) dateRange.lte = new Date(now.getTime() + windowMs);
    } else if (windowMs) {
      dateRange.gte = new Date(now.getTime() - windowMs);
      dateRange.lte = now;
    }

    const meetings = await prisma.meeting.findMany({
      where: {
        organizationId: ctx.orgId,
        ...(input.type ? { type: input.type as "DAILY_STANDUP" | "WEEKLY_REVIEW" | "ONE_ON_ONE" | "QUARTERLY_REVIEW" | "ANNUAL_PLANNING" | "ADHOC" } : {}),
        ...(input.titleContains ? { title: { contains: input.titleContains as string, mode: "insensitive" } } : {}),
        ...(input.attendedByMe ? { attendees: { some: { userId: ctx.userId } } } : {}),
        ...(Object.keys(dateRange).length ? { scheduledAt: dateRange } : {}),
      },
      select: {
        id: true, title: true, type: true, scheduledAt: true, duration: true, agenda: true,
        attendees: { select: { user: { select: { firstName: true, lastName: true, email: true } }, attended: true } },
      },
      orderBy: input.upcoming ? { scheduledAt: "asc" } : { scheduledAt: "desc" },
      take: limit,
    });
    return {
      count: meetings.length,
      meetings: meetings.map((m) => ({
        id: m.id, title: m.title, type: m.type, scheduledAt: m.scheduledAt, durationMin: m.duration,
        agenda: m.agenda,
        attendees: m.attendees.map((a) => `${a.user.firstName ?? ""} ${a.user.lastName ?? ""}`.trim() || a.user.email).filter(Boolean),
      })),
    };
  },
};

// ─────────────────────────────────────────────────────────
// OKRs (read)
// ─────────────────────────────────────────────────────────

const searchOkrs: ToolDefinition = {
  name: "search_okrs",
  description:
    "Search the org's OKRs (Objectives + Key Results). Use to find a specific objective, list a person's quarterly OKRs, or surface OKRs that are at risk.",
  input_schema: {
    type: "object",
    properties: {
      level: { type: "string", enum: ["COMPANY", "TEAM", "INDIVIDUAL"] },
      status: { type: "string", enum: ["ON_TRACK", "AT_RISK", "BEHIND", "COMPLETED"] },
      quarter: { type: "string", description: "e.g. 'Q2 2026'" },
      ownedByMe: { type: "boolean", description: "Only OKRs owned by the caller" },
      titleContains: { type: "string" },
      limit: { type: "integer" },
    },
  },
  handler: async (ctx, input) => {
    const limit = Math.min(50, Number(input.limit ?? 20));
    const okrs = await prisma.oKR.findMany({
      where: {
        organizationId: ctx.orgId,
        ...(input.level ? { level: input.level as string } : {}),
        ...(input.status ? { status: input.status as string } : {}),
        ...(input.quarter ? { quarter: input.quarter as string } : {}),
        ...(input.ownedByMe ? { ownerId: ctx.userId } : {}),
        ...(input.titleContains ? { title: { contains: input.titleContains as string, mode: "insensitive" } } : {}),
      },
      select: {
        id: true, title: true, level: true, status: true, progress: true, quarter: true, ownerId: true,
        keyResults: { select: { id: true, title: true, progress: true, currentValue: true, targetValue: true, unit: true } },
      },
      orderBy: [{ progress: "asc" }, { createdAt: "desc" }],
      take: limit,
    });
    return { count: okrs.length, okrs };
  },
};

// ─────────────────────────────────────────────────────────
// SOPs (read)
// ─────────────────────────────────────────────────────────

const searchSops: ToolDefinition = {
  name: "search_sops",
  description:
    "Search the org's Standard Operating Procedures. Use to find process docs the user is asking about, or to discover what's been documented for a given workflow.",
  input_schema: {
    type: "object",
    properties: {
      query: { type: "string", description: "Substring matched against title/description (case-insensitive)" },
      category: { type: "string" },
      tag: { type: "string", description: "Single tag to filter by" },
      status: { type: "string", enum: ["DRAFT", "PUBLISHED", "ARCHIVED"] },
      limit: { type: "integer" },
    },
  },
  handler: async (ctx, input) => {
    const limit = Math.min(30, Number(input.limit ?? 15));
    const q = input.query as string | undefined;
    const sops = await prisma.sOP.findMany({
      where: {
        organizationId: ctx.orgId,
        ...(input.category ? { category: input.category as string } : {}),
        ...(input.status ? { status: input.status as "DRAFT" | "PUBLISHED" | "ARCHIVED" } : {}),
        ...(input.tag ? { tags: { has: input.tag as string } } : {}),
        ...(q ? {
          OR: [
            { title: { contains: q, mode: "insensitive" } },
            { description: { contains: q, mode: "insensitive" } },
          ],
        } : {}),
      },
      select: {
        id: true, title: true, description: true, category: true, subcategory: true,
        sopType: true, tags: true, status: true, version: true, publishedAt: true, updatedAt: true,
      },
      orderBy: [{ updatedAt: "desc" }],
      take: limit,
    });
    return { count: sops.length, sops };
  },
};

// ─────────────────────────────────────────────────────────
// Legal contract update
// ─────────────────────────────────────────────────────────

const updateContract: ToolDefinition = {
  name: "update_contract",
  description:
    "Update a tracked contract — change status, capture renewal terms, push out an expiry date. Use this after a redline round, a signature, or a renewal decision. Auto-stamps signedAt on first SIGNED transition.",
  input_schema: {
    type: "object",
    properties: {
      contractId: { type: "string" },
      status: {
        type: "string",
        enum: ["DRAFT", "IN_REVIEW", "IN_NEGOTIATION", "AWAITING_SIGNATURE", "SIGNED", "ACTIVE", "EXPIRED", "RENEWED", "TERMINATED", "CANCELLED"],
      },
      value: { type: "number", description: "New contract value" },
      effectiveDate: { type: "string", description: "ISO date" },
      expiresAt: { type: "string", description: "ISO date" },
      autoRenew: { type: "boolean" },
      counterparty: { type: "string", description: "Updated counterparty name (rarely needed)" },
      description: { type: "string", description: "Updated description / notes" },
    },
    required: ["contractId"],
  },
  handler: async (ctx, input) => {
    const existing = await prisma.contract.findFirst({
      where: { id: input.contractId as string, organizationId: ctx.orgId },
    });
    if (!existing) return { error: "Contract not found in this org" };

    const now = new Date();
    const status = input.status as string | undefined;
    const signedAt = status === "SIGNED" && !existing.signedAt ? now : undefined;

    const contract = await prisma.contract.update({
      where: { id: existing.id },
      data: {
        ...(status !== undefined ? { status: status as "DRAFT" | "IN_REVIEW" | "IN_NEGOTIATION" | "AWAITING_SIGNATURE" | "SIGNED" | "ACTIVE" | "EXPIRED" | "RENEWED" | "TERMINATED" | "CANCELLED" } : {}),
        ...(input.value !== undefined ? { value: input.value as number } : {}),
        ...(input.effectiveDate !== undefined ? { effectiveDate: input.effectiveDate ? new Date(input.effectiveDate as string) : null } : {}),
        ...(input.expiresAt !== undefined ? { expiresAt: input.expiresAt ? new Date(input.expiresAt as string) : null } : {}),
        ...(input.autoRenew !== undefined ? { autoRenew: input.autoRenew as boolean } : {}),
        ...(input.counterparty !== undefined ? { counterparty: input.counterparty as string } : {}),
        ...(input.description !== undefined ? { description: input.description as string } : {}),
        ...(signedAt ? { signedAt } : {}),
      },
      select: { id: true, title: true, counterparty: true, status: true, value: true, expiresAt: true, signedAt: true },
    });
    return { ok: true, contract };
  },
};

// ─────────────────────────────────────────────────────────
// Ticket assignment (lightweight — just reassign, no status change)
// ─────────────────────────────────────────────────────────

const assignTicket: ToolDefinition = {
  name: "assign_ticket",
  description:
    "Reassign an IT ticket to a different teammate. Use when triaging — point a ticket at the right responder without changing its status. Look up the responder by email.",
  input_schema: {
    type: "object",
    properties: {
      ticketId: { type: "string" },
      assigneeEmail: { type: "string", description: "Email of the user who should own the ticket" },
    },
    required: ["ticketId", "assigneeEmail"],
  },
  handler: async (ctx, input) => {
    const ticket = await prisma.ticket.findFirst({
      where: { id: input.ticketId as string, organizationId: ctx.orgId },
    });
    if (!ticket) return { error: "Ticket not found in this org" };

    const assignee = await prisma.user.findFirst({
      where: { email: input.assigneeEmail as string, organizationId: ctx.orgId },
      select: { id: true, firstName: true, lastName: true, email: true },
    });
    if (!assignee) return { error: `User with email '${input.assigneeEmail}' not found in this org` };

    const updated = await prisma.ticket.update({
      where: { id: ticket.id },
      data: { assigneeId: assignee.id },
      select: { id: true, title: true, status: true, assigneeId: true },
    });
    return {
      ok: true,
      ticket: updated,
      assignee: { id: assignee.id, name: `${assignee.firstName ?? ""} ${assignee.lastName ?? ""}`.trim(), email: assignee.email },
    };
  },
};

// ─────────────────────────────────────────────────────────
// Registry — all tools by name
// ─────────────────────────────────────────────────────────

export const TOOLS: Record<string, ToolDefinition> = {
  // Cross-product
  create_task: createTask,
  search_tasks: searchTasks,
  send_kudos: sendKudos,
  search_employees: searchEmployees,
  search_kb: searchKb,
  search_meetings: searchMeetings,
  search_okrs: searchOkrs,
  search_sops: searchSops,
  // CRM
  create_lead: createLead,
  search_leads: searchLeads,
  update_lead_status: updateLeadStatus,
  create_opportunity: createOpportunity,
  search_opportunities: searchOpportunities,
  move_opportunity_stage: moveOpportunityStage,
  // ITSM
  create_ticket: createTicket,
  search_tickets: searchTickets,
  update_ticket_status: updateTicketStatus,
  assign_ticket: assignTicket,
  // Legal
  create_contract: createContract,
  search_contracts: searchContracts,
  update_contract: updateContract,
  // Dev
  create_sprint: createSprint,
  // Marketing
  create_campaign: createCampaign,
  // Helpdesk
  create_support_ticket: createSupportTicket,
  apply_macro: applyMacro,
};

// Tools every session can use, regardless of agent (or no agent).
// Includes cross-product search so Sidekick can look stuff up.
export const CROSS_TOOL_NAMES = ["create_task", "search_tasks", "send_kudos", "search_employees", "search_kb", "search_meetings", "search_okrs", "search_sops"];

// Tools per agent product. When a chat session is scoped to an agent,
// the agent's productSlug determines which create-tools light up in
// addition to the cross-product ones.
//
// The agent's `tools` array in the catalog (e.g. "draft-email",
// "triage-ticket") is still rendered in the UI as example actions,
// but the actual runtime tools come from this map — it's the most
// reliable bridge until every catalog slug has a real handler.
export const PRODUCT_TOOL_NAMES: Record<string, string[]> = {
  "workwrk-crm": ["create_lead", "search_leads", "update_lead_status", "create_opportunity", "search_opportunities", "move_opportunity_stage"],
  "workwrk-itsm": ["create_ticket", "search_tickets", "update_ticket_status", "assign_ticket"],
  "workwrk-contracts": ["create_contract", "search_contracts", "update_contract"],
  "workwrk-dev": ["create_sprint"],
  "workwrk-campaigns": ["create_campaign"],
  "workwrk-help": ["create_support_ticket", "apply_macro"],
};

// Resolve which tools are available to a given chat session.
//   - General Sidekick (no agent): just CROSS_TOOL_NAMES
//   - Agent: CROSS + the agent's product's tools
export function toolsForSession(opts: { agentProductSlug?: string | null }): ToolDefinition[] {
  const available = new Set<string>(CROSS_TOOL_NAMES);
  if (opts.agentProductSlug) {
    const productTools = PRODUCT_TOOL_NAMES[opts.agentProductSlug] ?? [];
    for (const name of productTools) available.add(name);
  }
  return Array.from(available).map((name) => TOOLS[name]);
}
