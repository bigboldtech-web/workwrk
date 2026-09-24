// Intake form templates for the Template Center (Phase 5 decided addition c:
// "intake templates in the Template Center"). They ship with the product,
// like the Starter kits, and live in code rather than in the Template table:
// a Form is not a TemplateKind the database stores, and adding an enum value
// for a catalogue that never changes per workspace would be a schema change
// with no reader. Using one creates an ordinary form (POST /api/forms) the
// person then edits in the builder; nothing links it back to the template.
//
// Pure: no imports beyond the field types, so vitest pins every template's
// shape (every field id unique, every choice field has options).

import type { FormField } from "./fields";

export interface IntakeTemplate {
  id: string;
  name: string;
  tagline: string;
  description: string;
  fields: FormField[];
}

const f = (id: string, type: FormField["type"], label: string, extra: Partial<FormField> = {}): FormField => ({ id, type, label, required: false, ...extra });

export const INTAKE_TEMPLATES: readonly IntakeTemplate[] = [
  {
    id: "intake-bug-report",
    name: "Bug report",
    tagline: "What broke, where, and how bad it is",
    description: "Collect bug reports with the steps to reproduce, how severe it is and a screenshot. Point it at your engineering List so every report becomes a task.",
    fields: [
      f("summary", "short_text", "What went wrong?", { required: true, placeholder: "One line, like a task title" }),
      f("steps", "long_text", "Steps to reproduce", { placeholder: "1. Go to... 2. Click... 3. See..." }),
      f("severity", "dropdown", "How bad is it?", { required: true, options: ["Blocking my work", "Annoying, with a workaround", "Cosmetic"] }),
      f("where", "url", "Link to the page", { placeholder: "Optional" }),
      f("shots", "file", "Screenshots or recordings"),
    ],
  },
  {
    id: "intake-it-request",
    name: "IT request",
    tagline: "Hardware, software and access requests",
    description: "One door for laptops, licences and access to systems, with the urgency and who approves it.",
    fields: [
      f("kind", "select", "What do you need?", { required: true, options: ["New hardware", "Software or a licence", "Access to a system", "Something is broken"], allowOther: true }),
      f("details", "long_text", "Tell us more", { required: true }),
      f("needed-by", "date", "Needed by"),
      f("urgency", "rating", "How urgent is it?", { max: 5 }),
      f("approver", "people", "Who approves this?"),
    ],
  },
  {
    id: "intake-client",
    name: "Client intake",
    tagline: "A new client or project request",
    description: "Take in a new client request with the contact, the scope, the budget and the files they already have.",
    fields: [
      f("company", "short_text", "Company", { required: true }),
      f("contact", "short_text", "Your name", { required: true }),
      f("email", "email", "Email", { required: true }),
      f("section-scope", "section", "The project", { placeholder: "What you would like us to do" }),
      f("services", "multi_select", "Services", { options: ["Strategy", "Design", "Build", "Support"] }),
      f("budget", "dropdown", "Budget", { options: ["Under 10k", "10k to 50k", "50k to 200k", "Over 200k"] }),
      f("brief", "long_text", "The brief"),
      f("files", "file", "Anything we should read first"),
    ],
  },
  {
    id: "intake-job-application",
    name: "Job application",
    tagline: "Candidates, their CV and their availability",
    description: "Collect applications with a CV upload, the role, the notice period and how they heard about you.",
    fields: [
      f("name", "short_text", "Full name", { required: true }),
      f("email", "email", "Email", { required: true }),
      f("role", "dropdown", "Role you are applying for", { required: true, options: ["Engineering", "Design", "Sales", "Operations"], allowOther: true }),
      f("cv", "file", "CV", { required: true }),
      f("portfolio", "url", "Portfolio or profile link"),
      f("start", "date", "Earliest start date"),
      f("source", "select", "How did you hear about us?", { options: ["A friend", "Job board", "Social media", "Our website"], allowOther: true }),
    ],
  },
  {
    id: "intake-feedback",
    name: "Feedback survey",
    tagline: "How did we do?",
    description: "A short survey with a rating, what went well and what to improve. Turn on one response per person in Settings.",
    fields: [
      f("score", "rating", "How would you rate your experience?", { required: true, max: 5 }),
      f("good", "long_text", "What went well?"),
      f("better", "long_text", "What should we do better?"),
      f("contact", "checkbox", "You may contact me about my answers"),
    ],
  },
  {
    id: "intake-event",
    name: "Event registration",
    tagline: "Sign-ups with sessions and dietary needs",
    description: "Register people for an event, with the sessions they want and anything the organisers should know.",
    fields: [
      f("name", "short_text", "Name", { required: true }),
      f("email", "email", "Email", { required: true }),
      f("sessions", "multi_select", "Sessions", { options: ["Morning keynote", "Workshop A", "Workshop B", "Evening social"] }),
      f("diet", "dropdown", "Dietary needs", { options: ["None", "Vegetarian", "Vegan", "Gluten free"], allowOther: true }),
      f("guests", "number", "Guests you are bringing"),
    ],
  },
];

export const INTAKE_TEMPLATE_BY_ID: ReadonlyMap<string, IntakeTemplate> = new Map(INTAKE_TEMPLATES.map((t) => [t.id, t]));
