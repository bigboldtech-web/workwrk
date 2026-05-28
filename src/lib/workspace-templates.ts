// Workspace templates — pre-built starter bundles users can apply
// any time to their org. Each template seeds a Doc, a Form, and a
// DataTable that match the team's typical workflow.
//
// Defined in TypeScript (not the DB) so templates ship with the
// release. New templates: append to TEMPLATES, redeploy.

export type TemplateId = "engineering" | "sales" | "marketing" | "hr" | "ops";

export interface TemplateDoc {
  title: string;
  blocks: Array<{ id: string; kind: string; [k: string]: unknown }>;
}

export interface TemplateForm {
  name: string;
  description: string;
  isPublic: boolean;
  fields: Array<{ id: string; type: string; label: string; required: boolean; options?: string[] }>;
}

export interface TemplateTable {
  name: string;
  description: string;
  columns: Array<{ id: string; type: string; label: string; options?: string[] }>;
  seedRows?: Array<Record<string, unknown>>;
}

export interface WorkspaceTemplate {
  id: TemplateId;
  name: string;
  tagline: string;
  description: string;
  iconKey: string;
  gradient: string;
  doc: TemplateDoc;
  form: TemplateForm;
  table: TemplateTable;
}

function bid() { return Math.random().toString(36).slice(2, 10); }

export const TEMPLATES: WorkspaceTemplate[] = [
  {
    id: "engineering",
    name: "Engineering team",
    tagline: "Ship code, manage incidents, run sprints",
    description: "Bootstrap your engineering workspace with a sprint planning doc, a bug-report intake form, and a tracker for open incidents.",
    iconKey: "code",
    gradient: "linear-gradient(135deg, #5559DF, #579BFC)",
    doc: {
      title: "Engineering · Sprint Plan",
      blocks: [
        { id: bid(), kind: "h1", text: "Sprint Plan" },
        { id: bid(), kind: "paragraph", text: "This is your team's living sprint plan. Update goals weekly, link tasks below, and capture decisions as they're made." },
        { id: bid(), kind: "h2", text: "Sprint goal" },
        { id: bid(), kind: "paragraph", text: "" },
        { id: bid(), kind: "h2", text: "Committed work" },
        { id: bid(), kind: "todo", text: "Define the sprint goal in one sentence", done: false },
        { id: bid(), kind: "todo", text: "Estimate top-priority tickets", done: false },
        { id: bid(), kind: "todo", text: "Identify cross-team dependencies", done: false },
        { id: bid(), kind: "h2", text: "Risks" },
        { id: bid(), kind: "callout", text: "List anything that could derail the sprint here.", tone: "warn" },
      ],
    },
    form: {
      name: "Bug Report",
      description: "Anyone in the company can file a bug. Routes to engineering triage.",
      isPublic: false,
      fields: [
        { id: bid(), type: "short_text", label: "Title", required: true },
        { id: bid(), type: "long_text", label: "Steps to reproduce", required: true },
        { id: bid(), type: "select", label: "Severity", required: true, options: ["Low", "Medium", "High", "Critical"] },
        { id: bid(), type: "email", label: "Your email (optional)", required: false },
      ],
    },
    table: {
      name: "Open Incidents",
      description: "Live tracker of production incidents — what's broken, who's on it, status.",
      columns: [
        { id: "title", type: "short_text", label: "Incident" },
        { id: "sev", type: "select", label: "Severity", options: ["P0", "P1", "P2", "P3"] },
        { id: "owner", type: "short_text", label: "Owner" },
        { id: "status", type: "select", label: "Status", options: ["Open", "Mitigating", "Resolved", "Post-mortem"] },
        { id: "started", type: "date", label: "Started" },
        { id: "rca", type: "url", label: "RCA link" },
      ],
    },
  },
  {
    id: "sales",
    name: "Sales team",
    tagline: "Pipeline, leads, prospect outreach",
    description: "A sales playbook doc, a lead-capture form for your website, and a pipeline tracker for active deals.",
    iconKey: "sales",
    gradient: "linear-gradient(135deg, #00C875, #66CCC2)",
    doc: {
      title: "Sales · Playbook",
      blocks: [
        { id: bid(), kind: "h1", text: "Sales Playbook" },
        { id: bid(), kind: "paragraph", text: "Everything reps need on day one — ICP, qualification framework, objection handling, pricing reference." },
        { id: bid(), kind: "h2", text: "Ideal Customer Profile" },
        { id: bid(), kind: "paragraph", text: "Describe who we win with most reliably." },
        { id: bid(), kind: "h2", text: "Qualification questions" },
        { id: bid(), kind: "todo", text: "What problem are they trying to solve?", done: false },
        { id: bid(), kind: "todo", text: "Who else is involved in the decision?", done: false },
        { id: bid(), kind: "todo", text: "What's the timeline?", done: false },
        { id: bid(), kind: "todo", text: "What's their budget range?", done: false },
        { id: bid(), kind: "h2", text: "Common objections" },
        { id: bid(), kind: "paragraph", text: "" },
      ],
    },
    form: {
      name: "Lead capture",
      description: "Public form embeddable on your website or in email signatures.",
      isPublic: true,
      fields: [
        { id: bid(), type: "short_text", label: "Name", required: true },
        { id: bid(), type: "email", label: "Work email", required: true },
        { id: bid(), type: "short_text", label: "Company", required: true },
        { id: bid(), type: "select", label: "Company size", required: false, options: ["1-10", "11-50", "51-200", "200-1000", "1000+"] },
        { id: bid(), type: "long_text", label: "What are you trying to solve?", required: false },
      ],
    },
    table: {
      name: "Pipeline",
      description: "Track active deals — stage, ARR, owner, expected close.",
      columns: [
        { id: "name", type: "short_text", label: "Deal" },
        { id: "stage", type: "select", label: "Stage", options: ["Discovery", "Demo", "Proposal", "Negotiation", "Closed Won", "Closed Lost"] },
        { id: "arr", type: "number", label: "ARR ($)" },
        { id: "owner", type: "short_text", label: "Owner" },
        { id: "close", type: "date", label: "Expected close" },
      ],
    },
  },
  {
    id: "marketing",
    name: "Marketing team",
    tagline: "Campaigns, content calendar, events",
    description: "A content-strategy doc, a content-request intake form, and a content calendar tracker.",
    iconKey: "megaphone",
    gradient: "linear-gradient(135deg, #FDAB3D, #FF158A)",
    doc: {
      title: "Marketing · Content Strategy",
      blocks: [
        { id: bid(), kind: "h1", text: "Content Strategy" },
        { id: bid(), kind: "paragraph", text: "Who we write for, what we publish, where it goes, and how we measure it." },
        { id: bid(), kind: "h2", text: "Audience personas" },
        { id: bid(), kind: "paragraph", text: "Describe each persona — role, pains, what they read." },
        { id: bid(), kind: "h2", text: "Content pillars" },
        { id: bid(), kind: "todo", text: "Pillar 1 — owned topic", done: false },
        { id: bid(), kind: "todo", text: "Pillar 2 — owned topic", done: false },
        { id: bid(), kind: "todo", text: "Pillar 3 — owned topic", done: false },
        { id: bid(), kind: "h2", text: "Distribution channels" },
        { id: bid(), kind: "paragraph", text: "" },
      ],
    },
    form: {
      name: "Content request",
      description: "Anyone in the company can request a blog post, case study, or landing page.",
      isPublic: false,
      fields: [
        { id: bid(), type: "short_text", label: "Title", required: true },
        { id: bid(), type: "select", label: "Type", required: true, options: ["Blog", "Case study", "Landing page", "Webinar", "Email", "Social"] },
        { id: bid(), type: "long_text", label: "What's the angle? Who's it for?", required: true },
        { id: bid(), type: "date", label: "Needed by", required: false },
      ],
    },
    table: {
      name: "Content Calendar",
      description: "Plan, schedule, and track every piece of content.",
      columns: [
        { id: "title", type: "short_text", label: "Title" },
        { id: "type", type: "select", label: "Type", options: ["Blog", "Email", "Social", "Webinar", "Case study"] },
        { id: "owner", type: "short_text", label: "Owner" },
        { id: "status", type: "select", label: "Status", options: ["Idea", "Draft", "Review", "Scheduled", "Published"] },
        { id: "publish", type: "date", label: "Publish date" },
        { id: "url", type: "url", label: "Live URL" },
      ],
    },
  },
  {
    id: "hr",
    name: "HR team",
    tagline: "Hiring, onboarding, policies",
    description: "An employee handbook doc, a candidate application form, and an open-roles tracker.",
    iconKey: "users",
    gradient: "linear-gradient(135deg, #FF158A, #A25DDC)",
    doc: {
      title: "People · Handbook",
      blocks: [
        { id: bid(), kind: "h1", text: "Employee Handbook" },
        { id: bid(), kind: "paragraph", text: "The first thing every new hire reads. Keep it short, plain, and actually useful." },
        { id: bid(), kind: "h2", text: "Our values" },
        { id: bid(), kind: "paragraph", text: "" },
        { id: bid(), kind: "h2", text: "How we work" },
        { id: bid(), kind: "todo", text: "Meeting norms", done: false },
        { id: bid(), kind: "todo", text: "Async communication", done: false },
        { id: bid(), kind: "todo", text: "Decision-making", done: false },
        { id: bid(), kind: "h2", text: "Benefits & time off" },
        { id: bid(), kind: "paragraph", text: "" },
      ],
    },
    form: {
      name: "Candidate application",
      description: "Public application form for open roles.",
      isPublic: true,
      fields: [
        { id: bid(), type: "short_text", label: "Full name", required: true },
        { id: bid(), type: "email", label: "Email", required: true },
        { id: bid(), type: "url", label: "LinkedIn or portfolio", required: false },
        { id: bid(), type: "short_text", label: "Role you're applying for", required: true },
        { id: bid(), type: "long_text", label: "Why are you a fit?", required: true },
      ],
    },
    table: {
      name: "Open Roles",
      description: "Roles we're hiring for — team, location, stage of search.",
      columns: [
        { id: "title", type: "short_text", label: "Role" },
        { id: "team", type: "short_text", label: "Team" },
        { id: "location", type: "short_text", label: "Location" },
        { id: "type", type: "select", label: "Type", options: ["Full-time", "Part-time", "Contract", "Intern"] },
        { id: "stage", type: "select", label: "Stage", options: ["Drafting", "Open", "Screening", "Interviews", "Offer", "Filled"] },
        { id: "posted", type: "date", label: "Posted" },
      ],
    },
  },
  {
    id: "ops",
    name: "Operations",
    tagline: "Vendors, procurement, supplier management",
    description: "An ops runbook doc, a supplier-onboarding form, and a vendor master list.",
    iconKey: "boxes",
    gradient: "linear-gradient(135deg, #7F5347, #FDAB3D)",
    doc: {
      title: "Ops · Runbook",
      blocks: [
        { id: bid(), kind: "h1", text: "Operations Runbook" },
        { id: bid(), kind: "paragraph", text: "Standard procedures for vendor management, procurement approvals, and asset tracking." },
        { id: bid(), kind: "h2", text: "Procurement approval thresholds" },
        { id: bid(), kind: "todo", text: "Under $500 — team lead approval", done: false },
        { id: bid(), kind: "todo", text: "$500-5K — department head approval", done: false },
        { id: bid(), kind: "todo", text: "Over $5K — finance + leadership sign-off", done: false },
        { id: bid(), kind: "h2", text: "New vendor onboarding" },
        { id: bid(), kind: "paragraph", text: "Use the supplier form. Required: W-9, COI, ACH details." },
      ],
    },
    form: {
      name: "Supplier onboarding",
      description: "Collect details for any new vendor or supplier.",
      isPublic: false,
      fields: [
        { id: bid(), type: "short_text", label: "Company name", required: true },
        { id: bid(), type: "email", label: "Primary contact email", required: true },
        { id: bid(), type: "short_text", label: "Tax ID / VAT", required: true },
        { id: bid(), type: "select", label: "Payment terms", required: false, options: ["Net 15", "Net 30", "Net 60", "On receipt"] },
        { id: bid(), type: "long_text", label: "Products / services offered", required: true },
      ],
    },
    table: {
      name: "Vendor Master",
      description: "Single source of truth for every vendor relationship.",
      columns: [
        { id: "name", type: "short_text", label: "Vendor" },
        { id: "category", type: "select", label: "Category", options: ["SaaS", "Goods", "Services", "Contractor"] },
        { id: "owner", type: "short_text", label: "Internal owner" },
        { id: "spend", type: "number", label: "Annual spend ($)" },
        { id: "renewal", type: "date", label: "Next renewal" },
        { id: "url", type: "url", label: "Vendor URL" },
      ],
    },
  },
];

export function getTemplate(id: string): WorkspaceTemplate | null {
  return TEMPLATES.find((t) => t.id === id) ?? null;
}
