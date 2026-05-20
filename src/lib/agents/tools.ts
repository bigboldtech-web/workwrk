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
// Registry — all tools by name
// ─────────────────────────────────────────────────────────

export const TOOLS: Record<string, ToolDefinition> = {
  create_task: createTask,
  search_tasks: searchTasks,
  send_kudos: sendKudos,
  create_lead: createLead,
  create_opportunity: createOpportunity,
  create_ticket: createTicket,
  create_contract: createContract,
  create_sprint: createSprint,
  create_campaign: createCampaign,
  create_support_ticket: createSupportTicket,
};

// Tools every session can use, regardless of agent (or no agent).
export const CROSS_TOOL_NAMES = ["create_task", "search_tasks", "send_kudos"];

// Tools per agent product. When a chat session is scoped to an agent,
// the agent's productSlug determines which create-tools light up in
// addition to the cross-product ones.
//
// The agent's `tools` array in the catalog (e.g. "draft-email",
// "triage-ticket") is still rendered in the UI as example actions,
// but the actual runtime tools come from this map — it's the most
// reliable bridge until every catalog slug has a real handler.
export const PRODUCT_TOOL_NAMES: Record<string, string[]> = {
  "workwrk-crm": ["create_lead", "create_opportunity"],
  "workwrk-itsm": ["create_ticket"],
  "workwrk-contracts": ["create_contract"],
  "workwrk-dev": ["create_sprint"],
  "workwrk-campaigns": ["create_campaign"],
  "workwrk-help": ["create_support_ticket"],
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
