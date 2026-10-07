// Nothing a person could do on the Agents page is lost in AI teammates
// (docs/plans/ai-teammates.md 5.1, build step 10). The page's body moved
// verbatim into workspace-agents-view.tsx (the agents table, its row menu,
// the drawer, the run detail, Add agent) and run-history-view.tsx (Run
// history), and the hub (agents-hub.tsx) draws the header around them.
//
// Each needle below is one control as the page wrote it before the move
// (read from src/app/(dashboard)/agents/page.tsx before it became a shell),
// so a control that a later edit drops fails here by name. The few changes
// the move made on purpose are pinned at the end.

import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const ROOT = fileURLToPath(new URL("../../../", import.meta.url));
const read = (rel: string) => readFileSync(path.join(ROOT, rel), "utf8");

const workspace = read("src/components/agents/workspace-agents-view.tsx");
const runs = read("src/components/agents/run-history-view.tsx");
const hub = read("src/components/agents/agents-hub.tsx");
const page = read("src/app/(dashboard)/agents/page.tsx");
const moved = workspace + runs;

const CONTROLS: Array<[string, string]> = [
  // The header: "..." and the toolbar.
  ["the ... menu's Run history", 'label: "Run history", icon: History'],
  ["Add agent, the primary for Owners and Admins", 'primary: canManage ? { label: "Add agent", icon: Plus, onClick: () => setAddOpen(true) } : undefined'],
  ["the Run history Filter toggle", "filter: { open: filterOpen, onToggle: () => setFilterOpen((o) => !o), count: activeFilters }"],
  ["the Run history Sort button", "sort: { onClick: () => setSortOpen((o) => !o), label: RUN_SORT_LABEL[sort], active: true }"],
  ["the Sort picker", 'ariaLabel="Sort runs"'],
  ["the sorts", '{ newest: "Newest first", oldest: "Oldest first" }'],
  // The agents table.
  ["the agents table", 'ariaLabel="Agents"'],
  ["the Agent column", 'label: "Agent", title: true'],
  ["the Status column", 'key: "status", label: "Status", width: "130px"'],
  ["the Runs on column", 'label: "Runs on"'],
  ["the Last run column and its link", 'label: "Last run"'],
  ["the Last run link to the run", "href={`/agents?agent=${encodeURIComponent(a.slug)}&run=${encodeURIComponent(a.lastRunId)}`}"],
  ["the Next run column", 'label: "Next run"'],
  ["a row opens the drawer", "onRowClick={(a) => setParams({ agent: a.slug, run: null })}"],
  ["the row's ... button", "label={`Actions for ${a.name}`}"],
  ["the table's load error", "Couldn&apos;t load agents ·"],
  ["the empty table", 'title="No agents yet"'],
  ["the empty table's link", '"See what agents can do"'],
  // The row menu.
  ["Open chat", '<MenuItem icon={MessageSquare} label="Open chat"'],
  ["Run now", '<MenuItem icon={Play} label="Run now"'],
  ["Pause", '<MenuItem icon={Pause} label="Pause"'],
  ["Turn on", '<MenuItem icon={Power} label="Turn on"'],
  ["Remove", '<MenuItem icon={Trash2} label="Remove" destructive'],
  ["Remove asks first", "title: `Remove ${a.name}?`"],
  // The drawer.
  ["the drawer", 'ariaLabel="Agent"'],
  ["the drawer's Copy link", 'aria-label="Copy link"'],
  ["the drawer's Close", 'aria-label="Close" title="Close · Esc"'],
  ["the drawer's Run now", '<Play className="h-4 w-4" strokeWidth={1.5} /> Run now'],
  ["the drawer's Open chat", '<MessageSquare className="h-4 w-4" strokeWidth={1.5} /> Open chat'],
  ["the drawer's Add back", '<Plus className="h-4 w-4" strokeWidth={1.5} /> Add back'],
  ["an agent that is not there", "This agent isn&apos;t here any more."],
  ["its way back", "See all agents"],
  ["What it does", "What it does"],
  ["the On switch", '<FieldRow label="On">'],
  ["the On switch's name", "aria-label={on ? `Pause ${agent.name}` : `Turn on ${agent.name}`}"],
  // The schedule is a routine now (docs/plans/ai-teammates-phase2.md step 2).
  ["the schedule", "<FieldRow label={LEGACY_COPY.scheduleLabel}>"],
  ["the schedule's link to the routines", "{s?.state === \"routine\" && s.isYou ? LEGACY_COPY.openRoutines : LEGACY_COPY.setUpRoutine}"],
  ["the instructions", 'aria-label="What to do each run"'],
  ["the instructions' Cancel", 'onClick={() => setPrompt(null)} className="inline-flex h-8 items-center rounded-md px-3 text-sm font-medium text-ink-2 hover:bg-hover hover:text-ink">Cancel</button>'],
  ["the instructions' Save", 'onClick={() => void savePrompt()} className={SECONDARY}>Save</button>'],
  ["unsaved instructions ask before closing", 'title: "Discard your changes?"'],
  ["the dirty guard", 'useDirtyGuard(dirty, { onSave: onGuardSave, id: "agent-instructions" })'],
  ["the recent runs", 'aria-label="Recent runs"'],
  ["the recent runs' load error", "Couldn&apos;t load the runs ·"],
  ["a recent run opens its detail", "aria-expanded={runId === r.id}"],
  // The run detail.
  ["the run detail's close", 'aria-label="Close the run"'],
  ["a run that is not there", "That run is not available."],
  ["the run detail's load error", "Couldn&apos;t load this run ·"],
  ["what the run did", "What it did"],
  ["the run's chat", "Open the chat"],
  // Add agent.
  ["the Add agent dialog", "Add an agent"],
  ["its search", 'aria-label="Search agents"'],
  ["its empty search", "No agents match."],
  ["its empty list", "Every agent is already added."],
  ["Add and Add back", '{a.removed ? "Add back" : "Add"}'],
  ["Done or Cancel", '{added.length ? "Done" : "Cancel"}'],
  // Run history.
  ["the runs table", 'ariaLabel="Agent runs"'],
  ["the filter panel", 'objects="runs"'],
  ["the filter search", 'placeholder: "Search fields"'],
  ["the Agent filter", '<FilterGroup label="Agent">'],
  ["a removed agent stays filterable", "label={`${a.name} (removed)`}"],
  ["the Status filter", '<FilterGroup label="Status">'],
  ["the statuses", '{ key: "succeeded", label: "Succeeded" }'],
  ["the Started filter", '<FilterGroup label="Started">'],
  ["the date range", 'label="Date range"'],
  ["Clear all", "onClearAll={() => setParams({ agentSlug: null, status: null, from: null, to: null })}"],
  ["the runs' load error", "Couldn&apos;t load the run history ·"],
  ["no runs match", "No runs match ·"],
  ["Clear filters", "Clear filters</button>"],
  ["no runs yet", "No runs yet"],
  ["the pager", 'noun: "records"'],
  ["the page sizes", "PAGE_SIZES = [25, 50, 100];"],
  ["a run opens in its agent's drawer", "onOpenRun={(r) => setParams({ agent: r.agentSlug, run: r.id })}"],
  ["the drawer renders on both tabs", "<AgentDrawer"],
];

describe("every control of the Agents page survives the move", () => {
  it.each(CONTROLS)("%s", (_what, needle) => {
    expect(moved).toContain(needle);
  });
});

describe("what the move changed on purpose", () => {
  it("leaves the page a thin shell over the hub", () => {
    expect(page).toMatch(/<Suspense fallback=\{null\}>\s*<AgentsHub \/>\s*<\/Suspense>/);
    expect(page).not.toMatch(/function AgentsInner|function RunHistory|function AgentDrawer/);
  });

  it("names the two views in the hub, where Your agents was", () => {
    expect(hub).toMatch(/TEAMMATES_PAGE\.title/);
    expect(hub).toMatch(/label=\{TEAMMATES_PAGE\.tabWorkspace\} active=\{view === "workspace"\} href="\/agents\?tab=workspace"/);
    expect(hub).toMatch(/label=\{TEAMMATES_PAGE\.tabRuns\} active=\{view === "runs"\} href="\/agents\?tab=runs"/);
    expect(hub).toMatch(/<WorkspaceAgentsView tab=\{view === "runs" \? "runs" : "agents"\} header=\{header\} \/>/);
  });

  it("opens an agent's chat as its teammate chat", () => {
    expect(workspace).toContain("router.push(`/agents?chat=${encodeURIComponent(a.slug)}`)");
    expect(workspace).not.toContain("/sidekick?agent=");
  });

  it("follows the run's own chat link", () => {
    expect(workspace).toContain("<Link href={run.chatHref}");
    expect(workspace).not.toContain("/sidekick?session=");
  });

  it("keeps the view in the address as the drawer opens and closes", () => {
    expect(workspace).toContain('if (!next.get("tab")) next.set("tab", tab === "runs" ? "runs" : "workspace");');
    expect(workspace).toContain('<Link href="/agents?tab=workspace"');
  });

  it("sets no schedule here: a schedule is a routine, set in the agent's chat (Phase 2)", () => {
    expect(workspace).not.toContain("<SchedulePicker");
    expect(workspace).not.toContain("autonomousEnabled: true");
    expect((workspace.match(/<ScheduleLine agent=\{agent\} zone=\{zone\} viewerZone=\{viewerZone\} \/>/g) ?? []).length).toBe(2);
    expect(workspace).toContain("toast(LEGACY_COPY.runNowWaiting(a.name), { action: { label: LEGACY_COPY.openChat, onClick: () => router.push(chatHref) } })");
  });

  it("names a routine's run", () => {
    expect(runs).toContain('ROUTINE: "Routine"');
  });
});
