import type { Metadata } from "next";
import { ArrowRight } from "lucide-react";
import {
  Section,
  Container,
  Eyebrow,
  H1,
  Button,
  CTABand,
  GradientText,
} from "@/components/marketing/primitives";

export const metadata: Metadata = {
  title: "Roadmap — WorkwrK",
  description: "What's shipped and what's coming in WorkwrK. Backlog, Next up, In progress and Done, updated as we build. Public and honest.",
  alternates: { canonical: "https://workwrk.com/roadmap" },
};

// ── The board ────────────────────────────────────────────────────────────────
type Col = "backlog" | "next" | "progress" | "done";

const COLS: readonly { key: Col; label: string; dot: string; ring: string }[] = [
  { key: "backlog", label: "Backlog", dot: "bg-slate-400", ring: "ring-slate-200" },
  { key: "next", label: "Next up", dot: "bg-violet-500", ring: "ring-violet-200" },
  { key: "progress", label: "In progress", dot: "bg-blue-500", ring: "ring-blue-200" },
  { key: "done", label: "Done", dot: "bg-emerald-500", ring: "ring-emerald-200" },
];

const AREA: Record<string, { label: string; cls: string }> = {
  canvas: { label: "Canvas", cls: "text-violet-700 bg-violet-50 border-violet-200" },
  goals: { label: "Goals", cls: "text-emerald-700 bg-emerald-50 border-emerald-200" },
  people: { label: "People", cls: "text-blue-700 bg-blue-50 border-blue-200" },
  culture: { label: "Culture", cls: "text-amber-700 bg-amber-50 border-amber-200" },
  ai: { label: "AI", cls: "text-cyan-700 bg-cyan-50 border-cyan-200" },
  tasks: { label: "Tasks", cls: "text-orange-700 bg-orange-50 border-orange-200" },
  platform: { label: "Platform", cls: "text-slate-600 bg-slate-100 border-slate-200" },
  comms: { label: "Comms", cls: "text-pink-700 bg-pink-50 border-pink-200" },
};

// Real WorkwrK state. `done` is shipped and live; the rest is directional and
// moves as we learn.
const ITEMS: readonly { col: Col; area: keyof typeof AREA & string; title: string; body: string }[] = [
  // Done
  { col: "done", area: "platform", title: "Spaces, Folders, Lists & Boards", body: "The structure the whole product hangs from." },
  { col: "done", area: "tasks", title: "Views: Table, Kanban, Calendar, Gantt", body: "Every list gets all four out of the box." },
  { col: "done", area: "tasks", title: "Tasks: types, schedule, repeat, subtasks", body: "Recurring tasks respawn with their subtasks." },
  { col: "done", area: "platform", title: "Docs & block editor", body: "Full-screen editor with version history." },
  { col: "done", area: "platform", title: "Databases: link, lookup, rollup, formulas", body: "Relational tables, saved views and a Gallery." },
  { col: "done", area: "platform", title: "Tables / Sheets engine", body: "A spreadsheet with data validation and functions." },
  { col: "done", area: "canvas", title: "Canvas: first-party whiteboard", body: "Our own engine, with autosave and version history." },
  { col: "done", area: "canvas", title: "Canvas: AI system-design diagrams", body: "Describe a system, get architecture, flow, sequence or ER." },
  { col: "done", area: "canvas", title: "Canvas: refine by chat", body: "Keep talking to edit the diagram in place." },
  { col: "done", area: "canvas", title: "Canvas: schema import & export", body: "SQL DDL and Prisma, both directions." },
  { col: "done", area: "canvas", title: "Canvas: explain & critique", body: "AI walks through, or design-reviews, a board." },
  { col: "done", area: "goals", title: "Goals / OKRs", body: "One owner, many contributors, one number." },
  { col: "done", area: "goals", title: "Goals: automated Effort panel", body: "Real hours and tasks from linked work, never self-reported." },
  { col: "done", area: "goals", title: "Goals: On track? assessment", body: "A verdict from progress, pace, check-ins and effort." },
  { col: "done", area: "people", title: "KRAs & KPIs", body: "Weighted accountabilities and metrics per role." },
  { col: "done", area: "people", title: "SOPs: four kinds + acknowledge loop", body: "Written, step, checklist and click-capture." },
  { col: "done", area: "people", title: "People, roles & org chart", body: "Departments, reporting tree and a pan-zoom chart." },
  { col: "done", area: "people", title: "Reviews & cadences", body: "KPI review loop and scheduled cadences." },
  { col: "done", area: "culture", title: "Kudos tied to company values", body: "Recognise a teammate for living a specific value." },
  { col: "done", area: "culture", title: "Mission & values everywhere", body: "A welcome moment, and values on every loading screen." },
  { col: "done", area: "platform", title: "Notifications & reminders", body: "A live bell, persistent reminders and an email pipeline." },
  { col: "done", area: "tasks", title: "Time tracking", body: "Start/stop sessions and a unified timesheet." },
  { col: "done", area: "platform", title: "Templates & Template Center", body: "Save and apply task, list and space templates." },
  { col: "done", area: "comms", title: "Talk: calls, chat, huddles", body: "A comms hub with channels, threads and reactions." },
  { col: "done", area: "ai", title: "AI Sidekick & agents", body: "A chat runtime and agents that take real actions." },
  { col: "done", area: "ai", title: "Meeting notetaker", body: "Turns a transcript into structured notes." },
  // In progress
  { col: "progress", area: "ai", title: "AI Performance Manager", body: "Per-person monthly evaluation and org ranking. In design." },
  { col: "progress", area: "platform", title: "Talk & Tables as premium modules", body: "Toggleable, entitlement-gated add-ons." },
  { col: "progress", area: "platform", title: "Sheets: Zoho-parity functions", body: "Expanding the spreadsheet function set." },
  // Next up
  { col: "next", area: "ai", title: "Performance: objective scorecard", body: "A live delivery score before the AI narrative." },
  { col: "next", area: "people", title: "Guided company setup", body: "First-run flow: mission, values, top goals, invite team." },
  { col: "next", area: "canvas", title: "Canvas: diagram from a doc or SOP", body: "Point the AI at existing content and it draws it." },
  { col: "next", area: "canvas", title: "Whole-board export (SVG / PDF)", body: "Drop a design cleanly into docs and decks." },
  { col: "next", area: "platform", title: "Automation Hub", body: "Event-driven workflows once modules emit events." },
  { col: "next", area: "goals", title: "Team performance rollup", body: "Effort and at-risk goals across a manager's reports." },
  // Backlog
  { col: "backlog", area: "platform", title: "Third-party integrations", body: "Demand-driven connectors, built after the core." },
  { col: "backlog", area: "canvas", title: "Real-time multiplayer on Canvas", body: "Co-editing over the Talk transport." },
  { col: "backlog", area: "platform", title: "Public API v1 expansion", body: "Broader coverage and webhooks." },
  { col: "backlog", area: "ai", title: "Coaching becomes real tasks", body: "Performance suggestions turn into assignable work." },
  { col: "backlog", area: "platform", title: "Marketplace for workspaces", body: "Shareable, installable workspace templates." },
  { col: "backlog", area: "platform", title: "Native mobile apps", body: "iOS and Android beyond the responsive web." },
];

export default function RoadmapPage() {
  const shipped = ITEMS.filter((i) => i.col === "done").length;
  const planned = ITEMS.length - shipped;

  return (
    <>
      <Section variant="mesh" py="lg" className="pt-10 lg:pt-14">
        <Container>
          <div className="max-w-3xl">
            <Eyebrow hue="fuchsia" className="mb-5">Roadmap</Eyebrow>
            <H1>
              What we&apos;re building <br />
              <GradientText hue="fuchsia">in public.</GradientText>
            </H1>
            <p className="mt-6 text-lg lg:text-xl text-slate-600 leading-relaxed max-w-2xl">
              Backlog to Next up to In progress to Done. Honest about what is live
              and what is still ahead. <span className="font-semibold text-slate-900">{shipped} shipped</span>,{" "}
              <span className="font-semibold text-slate-900">{planned} on the way</span>.
            </p>
            <div className="mt-8 flex flex-wrap gap-3">
              <Button href="mailto:product@workwrk.com" variant="secondary" hue="fuchsia" size="lg" rightIcon={<ArrowRight size={15} />}>
                Suggest a feature
              </Button>
              <Button href="/changelog" variant="outline" size="lg">See what shipped</Button>
            </div>
          </div>
        </Container>
      </Section>

      <section className="bg-slate-50 py-14 lg:py-20 border-y border-slate-200">
        <Container>
          <div className="grid gap-5 md:grid-cols-2 xl:grid-cols-4 items-start">
            {COLS.map((col) => {
              const cards = ITEMS.filter((i) => i.col === col.key);
              return (
                <div key={col.key} className={`rounded-2xl bg-white ring-1 ${col.ring} p-3`}>
                  <div className="flex items-center gap-2.5 px-2 py-2.5">
                    <span className={`w-2.5 h-2.5 rounded-[4px] ${col.dot}`} />
                    <h2 className="text-[15px] font-bold tracking-tight text-slate-900">{col.label}</h2>
                    <span className="ml-auto text-xs font-semibold text-slate-400 tabular-nums bg-slate-100 rounded-md px-2 py-0.5">
                      {cards.length}
                    </span>
                  </div>
                  <div className="flex flex-col gap-2.5">
                    {cards.map((item) => {
                      const a = AREA[item.area];
                      return (
                        <article key={item.title} className="rounded-xl border border-slate-200 bg-white p-3.5 hover:border-slate-300 transition-colors">
                          <h3 className="text-[14.5px] font-semibold leading-snug text-slate-900 text-balance">{item.title}</h3>
                          <p className="mt-1 text-[13px] leading-relaxed text-slate-500">{item.body}</p>
                          <div className="mt-2.5 flex items-center gap-2">
                            <span className={`text-[11px] font-semibold px-2 py-0.5 rounded-md border ${a.cls}`}>{a.label}</span>
                            {col.key === "done" && (
                              <span className="ml-auto text-[11px] font-medium text-emerald-600">Shipped</span>
                            )}
                          </div>
                        </article>
                      );
                    })}
                  </div>
                </div>
              );
            })}
          </div>
          <p className="mt-8 text-center text-sm text-slate-400">
            Everything under <span className="font-medium text-slate-500">Done</span> is live at workwrk.com today. Items past In progress are intent, not commitments, and move as we learn.
          </p>
        </Container>
      </section>

      <CTABand
        hue="fuchsia"
        title={<>Got an idea we should be <GradientText hue="amber">building</GradientText>?</>}
        body="Tell us what would move your team. Feature requests move fast when they hit a real need."
        primary={{ label: "Suggest a feature", href: "mailto:product@workwrk.com" }}
        secondary={{ label: "See changelog", href: "/changelog" }}
      />
    </>
  );
}
