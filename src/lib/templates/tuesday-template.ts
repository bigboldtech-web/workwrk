// "Tuesday: client onboarding", the template the marketing site's Tuesday
// story is about, as a real Template Center row (kind SPACE) whose payload
// carries, beside the Space and its List, a `bundle`: the job titles, the
// KRA and KPI, the step-by-step SOP, the goal, the doc and one sample task.
// src/lib/templates/apply-tuesday.ts materializes it.
//
// SEEDED FROM THE SITE'S OWN FIXTURE. Names, steps, the KRA weight, the KPI
// target and the goal come from src/components/marketing/data/tuesday.json,
// so what the site shows and what a new workspace gets cannot drift apart.
// The fixture's people (Maya, Sam, Priya) and clients (Bluefin Foods and the
// rest) are a storyboard and are NOT seeded: no invented person becomes a
// user, and the one sample task says it is a sample.
//
// Pure: no database. Shared by the signup path, the Template Center row and
// prisma/seed-templates.ts.

import fixture from "../../components/marketing/data/tuesday.json";

export const TUESDAY_TEMPLATE_KEY = "space.tuesday-client-onboarding";

/** The ?template= values /signup accepts, mapped to a template key. Anything else is ignored. */
export const SIGNUP_TEMPLATE_KEYS: Readonly<Record<string, string>> = { tuesday: TUESDAY_TEMPLATE_KEY };

export function signupTemplateKey(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const v = raw.trim().toLowerCase();
  return Object.prototype.hasOwnProperty.call(SIGNUP_TEMPLATE_KEYS, v) ? SIGNUP_TEMPLATE_KEYS[v] : null;
}

type Status = { value: string; label: string; color: string; group: "ACTIVE" | "DONE" | "CLOSED" };

// Product status colours (the same hues the built-in presets use).
const STATUSES: Status[] = [
  { value: "TO_DO", label: "NOT STARTED", color: "#71717A", group: "ACTIVE" },
  { value: "IN_PROGRESS", label: "IN PROGRESS", color: "#0073EA", group: "ACTIVE" },
  { value: "BLOCKED", label: "BLOCKED", color: "#F97316", group: "ACTIVE" },
  { value: "DONE", label: "DONE", color: "#10B981", group: "DONE" },
];

export interface TuesdayBundle {
  key: "tuesday";
  jobTitles: Array<{ title: string; department: string | null; description: string }>;
  kra: { name: string; description: string; category: string; weight: number; jobTitle: string };
  kpi: { name: string; description: string; unit: string; targetValue: number; lowerIsBetter: boolean };
  sop: {
    title: string;
    description: string;
    /** The List the SOP's run defaults to (content.spawn.boardId), by name. */
    spawnList: string;
    steps: Array<{ title: string; description: string; jobTitle: string | null; createsTask: boolean }>;
  };
  goal: { title: string; description: string };
  /**
   * `needs` marks a block that describes a piece only some applies make:
   * "sop" (the SOP, left out at the plan's SOP cap or for a non-admin) and
   * "governance" (the KRA, KPI and goal, admins only). Such a block is left
   * out of the doc whenever its piece was not made (apply-tuesday.ts).
   */
  doc: { title: string; blocks: Array<{ kind: string; text: string; tone?: string; needs?: "sop" | "governance" }> };
  sampleTask: { title: string; list: string; stepN: number };
}

export interface TuesdayPayload {
  icon: string;
  color: string;
  workflow: { statuses: Status[]; defaultView: "TABLE" };
  lists: Array<{ name: string; statuses: Status[]; defaultView: "TABLE" }>;
  bundle: TuesdayBundle;
}

const STEP_NOTES: Readonly<Record<number, string>> = {
  1: "Check the signed agreement is the final version and filed.",
  2: "Add the client to your client list with the main contact.",
  3: "Running the SOP creates this step's task on the Onboarding List, owned by whoever holds the Onboarding lead job title.",
  4: "Agree how often the client gets a report, and note it on the task.",
  5: "Finance signs off any change to the agreement before go live.",
  6: "Book the kickoff call with the client.",
  7: "Introduce the account team and hand the client over.",
};

/** The Tuesday template payload, built from the fixture. Pure. */
export function tuesdayPayload(): TuesdayPayload {
  const f = fixture;
  const listName = f.board.name;
  return {
    icon: "Briefcase",
    color: "#0073EA",
    workflow: { statuses: STATUSES, defaultView: "TABLE" },
    lists: [{ name: listName, statuses: STATUSES, defaultView: "TABLE" }],
    bundle: {
      key: "tuesday",
      jobTitles: [
        { title: f.role.title, department: f.role.department, description: f.role.boundaries.join(" ") },
        { title: "Finance", department: "Finance", description: "Signs off changes to a client agreement before go live." },
      ],
      kra: {
        name: f.kra.title,
        description: `Every client is onboarded inside ${f.sop.slaDays} days of signing.`,
        category: "Operations",
        weight: f.kra.weight,
        jobTitle: f.role.title,
      },
      kpi: {
        name: f.kpi.name,
        description: "Days from a signed agreement to the client's kickoff call. Lower is better.",
        unit: f.kpi.unit,
        targetValue: f.kpi.target,
        lowerIsBetter: f.kpi.direction === "lower-is-better",
      },
      sop: {
        // The fixture's "v4" is the story's fourth revision; a new workspace starts at its first.
        title: f.sop.title.replace(/\s+v\d+$/i, ""),
        description: `The steps from a signed agreement to a client handed over, inside ${f.sop.slaDays} days.`,
        spawnList: listName,
        steps: f.sop.steps.map((s) => ({
          title: s.title,
          description: STEP_NOTES[s.n] ?? "",
          jobTitle: s.owner || null,
          createsTask: (s as { spawnsTask?: boolean }).spawnsTask === true,
        })),
      },
      goal: {
        title: f.goal.title,
        description: `Linked to the ${f.kra.title} KRA and the ${f.board.name} List, so its Effort card shows the onboarding work.`,
      },
      doc: {
        title: "Client onboarding playbook",
        blocks: [
          { kind: "callout", text: "This Space came from the Tuesday: client onboarding template. Change anything; it is yours.", tone: "info" },
          { kind: "h2", text: "How onboarding runs here" },
          { kind: "paragraph", text: "The Client onboarding SOP holds the steps. Open it and choose Run steps to create the step's task on the Onboarding List.", needs: "sop" },
          { kind: "bullet", text: `Each step names a job title. The task goes to whoever holds that title and is available soonest.`, needs: "sop" },
          { kind: "bullet", text: "Nobody holds a title yet? The task is created unassigned, with a note saying so. Give the title to someone in People.", needs: "sop" },
          { kind: "bullet", text: `The ${f.kra.title} KRA and the ${f.kpi.name} KPI sit on the ${f.role.title} job title.`, needs: "governance" },
          { kind: "bullet", text: `The goal "${f.goal.title}" shows the work on the Onboarding List on its Effort card.`, needs: "governance" },
          { kind: "h2", text: "Notes" },
          { kind: "paragraph", text: "" },
        ],
      },
      sampleTask: { title: "Sample: onboard your next client", list: listName, stepN: 3 },
    },
  };
}

export const TUESDAY_TEMPLATE_ROW = {
  key: TUESDAY_TEMPLATE_KEY,
  kind: "SPACE" as const,
  name: fixture.workspace.templateName,
  description:
    "A client onboarding Space with its Onboarding List, a playbook doc and a sample task. Applied by a workspace admin, it also brings the step-by-step SOP, the Onboarding lead and Finance job titles, a KRA and KPI, and a company goal.",
  complexity: "INTERMEDIATE" as const,
  category: "Spaces",
  useCases: ["space-setup", "operations", "client-onboarding"],
  tags: ["built-in", "space", "tuesday"],
};
