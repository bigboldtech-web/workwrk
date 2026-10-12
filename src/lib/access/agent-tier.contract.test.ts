// The Agent tier's sentence (AGENT_TIER_BLURB) held to the code, one claim at
// a time (docs-found fixes batch 2):
//
//   "can't create Spaces"        every door that makes a Space refuses an
//                                Agent in the engine's words, Duplicate too
//   "can't delete tasks"         a List, Folder or Space that holds a task is
//                                never trashed by an Agent
//   "can't be anyone's manager"  an invitation never puts a new person under
//                                an Agent
//   "most exports are closed"    every export route is listed here as closed
//                                to Agents, Admin only, or the person's own
//                                records; a new export route fails this file
//                                until it is listed
//
// Source reads where the rule is where a route or a control is wired; the
// behaviour itself is tested beside each module.

import { describe, expect, it, vi } from "vitest";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";

vi.mock("@/lib/template-center", () => ({ SPACE_CREATE_LEVELS: new Set(["SUPER_ADMIN", "COMPANY_ADMIN", "MANAGER"]) }));
vi.mock("./flags", () => ({ accessV2Resolver: () => false }));

import { AGENT_NO_SPACES, AGENT_TIER_BLURB, agentTrashRefusal } from "./labels";
import { spaceCreateRefusal } from "./space-create";
import { containerMenuRows } from "@/lib/work/container-menu";
import { legacyIsManagerLevel } from "./legacy-levels";

const root = join(__dirname, "..", "..", "..");
const read = (p: string) => readFileSync(join(root, p), "utf8");

describe("can't create Spaces", () => {
  it("uses the engine's own words on every door", () => {
    expect(read("src/lib/access/resolve.ts")).toContain(`if (v.isAgent) return no(${JSON.stringify(AGENT_NO_SPACES)});`);
    expect(spaceCreateRefusal("AGENT")).toBe(AGENT_NO_SPACES);
    expect(spaceCreateRefusal("EMPLOYEE")).toBe("Manager-level access required to create Spaces.");
    expect(read("src/app/api/spaces/route.ts")).toContain("spaceCreateRefusal(c.accessLevel)");
    expect(read("src/app/api/template-center/[id]/apply/route.ts")).toContain("spaceCreateRefusal(accessLevel)");
  });

  it("offers an Agent no Duplicate on a Space, which would make one; a Folder or List copy stays", () => {
    const actions = (kind: "space" | "folder" | "list") =>
      containerMenuRows({ kind, role: "full", isAgent: true }).flatMap((r) => (r.kind === "row" ? [r.action] : []));
    expect(actions("space")).not.toContain("duplicate");
    expect(actions("folder")).toContain("duplicate");
    expect(actions("list")).toContain("duplicate");
    expect(containerMenuRows({ kind: "space", role: "full" }).some((r) => r.kind === "row" && r.action === "duplicate")).toBe(true);
  });
});

describe("can't delete tasks", () => {
  it("says what holds the delete, and what to do instead", () => {
    expect(agentTrashRefusal("List", 12)).toBe("This List holds 12 tasks, and an Agent can't delete tasks. Archive it instead, or ask someone else with Full access to delete it.");
    expect(agentTrashRefusal("Space", 1)).toContain("holds 1 task,");
  });

  it("sends every List, Folder and Space delete through trashContainer", () => {
    for (const p of ["src/app/api/boards/[id]/route.ts", "src/app/api/folders/[id]/route.ts", "src/app/api/spaces/[id]/route.ts"]) {
      const src = read(p);
      expect(src, p).toMatch(/trashContainer\("(board|folder|space)", id, c\)/);
      expect(src, p).not.toMatch(/moveToTrash\(/);
      expect(src, p).toContain("status: trashed.status");
    }
  });
});

describe("can't be anyone's manager", () => {
  it("the transfer dialog says where the reports go before it runs, from the server's own plan", () => {
    const dialog = read("src/app/(dashboard)/settings/members/members-shared.tsx");
    expect(dialog).toContain("/handover?to=${encodeURIComponent(pickedId)}");
    expect(dialog).toContain("reportHandoverNote(planNow,");
    expect(dialog).toContain("{reportsNote ? <p className=\"text-sm text-ink-2\">{reportsNote}</p> : null}");
    // Confirm waits for the plan of the person picked now, and stays held
    // with a Retry when that plan cannot be read (batch 3: it used to be
    // released without the note).
    expect(dialog).toContain("busy={busy || summary === null || (needsPlan && plan?.for !== planKey)}");
    expect(dialog).toContain("const planKey = `${member.id}:${recipientId}:${planTry}`;");
    expect(dialog).toContain("const planFailed = needsPlan && plan?.for === planKey && !plan.plan;");
    expect(dialog).toContain("confirmDisabled={planFailed}");
    expect(dialog).toContain("onClick={() => setPlanTry((n) => n + 1)}>Retry</button>");
    // The confirm it holds is the confirm only: Cancel stays open.
    const form = read("src/components/settings/settings-form.tsx");
    expect(form).toContain("const ready = (!typed || text.trim() === typed) && !confirmDisabled;");
    expect(form).toContain('onClick={() => onOpenChange(false)} disabled={busy}>Cancel</button>');
    const route = read("src/app/api/users/[id]/handover/route.ts");
    expect(route).toContain("return jsonSuccess({ reports: await previewReportHandover(orgId, id, to) });");
  });

  it("the Members drawer shows the server's refusal on the row that asked", () => {
    const drawer = read("src/app/(dashboard)/settings/members/member-drawer.tsx");
    // Batch 7: through refusedSave, which says every refusal as the server
    // did and only adds the Retry sentence to a Reports to another workspace counts.
    expect(drawer).toContain("setErrs((e) => ({ ...e, [key]: refused.message }));");
    expect(drawer).toContain("return { body, message: r.error };");
    expect(drawer).toContain('onChange={(tier) => askRole("MEMBER", tier, "tier")}');
    expect(drawer).toContain('error={errFor("tier")}');
  });

  it("an accepted invitation writes the manager managerOnAccept allows, never the stored one as is", () => {
    const src = read("src/app/api/auth/accept-invite/route.ts");
    // Batch 3: read inside the acceptance's transaction, under the role lock
    // taken first (rule 6's race), and live (never someone deactivated).
    const tx = src.slice(src.indexOf("if (inv.managerId) await lockOrgRoles(tx, inv.organizationId);"));
    expect(tx.length).toBeLessThan(src.length);
    expect(tx.indexOf("const managerId = await managerOnAccept(inv, tx);")).toBeGreaterThan(0);
    expect(tx.indexOf("await seatOrThrow(tx, inv.organizationId);")).toBeGreaterThan(tx.indexOf("managerOnAccept(inv, tx)"));
    expect(tx.indexOf("managerId,")).toBeGreaterThan(tx.indexOf("managerOnAccept(inv, tx)"));
    expect(src).not.toMatch(/managerId: inv\.managerId/);
    expect(read("src/lib/auth/invite-facts.server.ts")).toContain("managerCandidateIn(inv.organizationId, inv.managerId, { db, live: true })");
  });
});

// Every export an Agent could reach, and why it is closed or open. "agent":
// the route refuses an Agent (the marker is the refusal). "admin": Owner or
// Admin only, and an Agent is never either. "own": open to an Agent because
// it hands the person their own records back, which is what lets the
// sentence say "most".
type Rule = { rule: "agent" | "admin"; marker: RegExp } | { rule: "own"; why: string };

const EXPORT_ROUTES: Record<string, Rule> = {
  "src/app/api/activity/export.csv/route.ts": { rule: "agent", marker: /viewer\.isAgent/ },
  "src/app/api/analytics/export.csv/route.ts": { rule: "agent", marker: /viewer\.isAgent/ },
  "src/app/api/audit-log/export/route.ts": { rule: "admin", marker: /settingsWriteGate\(session, "audit"/ },
  "src/app/api/docs/[id]/export/route.ts": { rule: "agent", marker: /if \(viewer\.isAgent \|\| isAgentOf\(ctx\.accessLevel\)\) return NextResponse\.json\(\{ error: "Agents can't export docs\." \}, \{ status: 403 \}\)/ },
  "src/app/api/export/[type]/route.ts": {
    rule: "own",
    why: "their own timesheet weeks (scope=mine) and the meetings they attend or created; every other type needs the manager tier or an Admin",
  },
  "src/app/api/export/all/route.ts": { rule: "admin", marker: /settingsWriteGate\(session, "data"/ },
  "src/app/api/export/assets/route.ts": { rule: "agent", marker: /scope\.viewer\.isAgent/ },
  "src/app/api/export/people/route.ts": { rule: "admin", marker: /settingsWriteGate\(session, "data"/ },
  "src/app/api/export/reviews/[cycleId]/route.ts": { rule: "agent", marker: /ctx\.isAgent/ },
  "src/app/api/export/tools/route.ts": { rule: "agent", marker: /v\.isAgent/ },
  "src/app/api/forms/[id]/responses/export.csv/route.ts": { rule: "agent", marker: /viewer\?\.isAgent/ },
  "src/app/api/marketing/legacy/export/route.ts": { rule: "admin", marker: /requireCan\("manage", \{ type: "settings", page: "data" \}\)/ },
  "src/app/api/me/everything/export.csv/route.ts": { rule: "agent", marker: /viewer\.isAgent/ },
  "src/app/api/me/export/route.ts": { rule: "own", why: "Download my data: the person's own account, work and messages" },
  "src/app/api/policies/[id]/ledger/export/route.ts": { rule: "agent", marker: /level === "AGENT"/ },
  "src/app/api/policies/compliance/export/route.ts": { rule: "agent", marker: /level === "AGENT"/ },
  "src/app/api/pulse-surveys/[id]/responses/export/route.ts": { rule: "agent", marker: /accessLevel === "AGENT"\) return jsonError\("Agents can't export survey responses\.", 403\)/ },
  "src/app/api/reviews/export.csv/route.ts": { rule: "agent", marker: /ctx\.isAgent/ },
  "src/app/api/settings/matrix-export/route.ts": { rule: "admin", marker: /sessionMayManageOwnerPage/ },
  "src/app/api/skills/export/route.ts": { rule: "agent", marker: /ctx\.isAgent/ },
  "src/app/api/sop-assignments/compliance/export/route.ts": { rule: "agent", marker: /level === "AGENT"/ },
  "src/app/api/tables/[id]/export/route.ts": { rule: "agent", marker: /viewer\?\.isAgent/ },
  "src/app/api/trash/export.csv/route.ts": { rule: "agent", marker: /viewer\.isAgent/ },
  "src/app/api/users/export/route.ts": { rule: "agent", marker: /ctx\.isAgent/ },
};

// Routes whose CSV or calendar file is a branch of a list route.
const EXPORT_BRANCHES: Record<string, Rule> = {
  "src/app/api/audit/route.ts": { rule: "admin", marker: /sessionIsWorkspaceAdmin\(session\)/ },
  "src/app/api/kudos/leaderboard/route.ts": { rule: "agent", marker: /viewer\?\.isAgent/ },
  "src/app/api/kudos/route.ts": { rule: "agent", marker: /if \(isAgent \|\| !\(isAdmin/ },
  "src/app/api/talent-assessment/route.ts": { rule: "agent", marker: /ctx\.isAgent/ },
  "src/app/api/team/members-work/route.ts": { rule: "agent", marker: /ctx\.isAgent/ },
  "src/app/api/weekly-reviews/route.ts": { rule: "agent", marker: /ctx\.isAgent/ },
  "src/app/api/calendar/ics/[token]/route.ts": { rule: "own", why: "the person's own calendar feed, by their own token" },
  "src/app/api/meetings/[id]/ics/route.ts": { rule: "own", why: "Add to my calendar, for a meeting they attend or created" },
};

function routesUnder(dir: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(join(root, dir))) {
    const p = join(dir, name);
    if (statSync(join(root, p)).isDirectory()) out.push(...routesUnder(p));
    else if (name === "route.ts") out.push(relative(root, join(root, p)));
  }
  return out;
}

describe("most exports are closed", () => {
  it("lists every export route, so a new one is decided before it ships", () => {
    const found = routesUnder("src/app/api").filter((p) => /export/i.test(p.replace(/^src\/app\/api\//, "")));
    expect(found.sort()).toEqual(Object.keys(EXPORT_ROUTES).sort());
  });

  it("closes each one it says is closed", () => {
    for (const [p, r] of Object.entries({ ...EXPORT_ROUTES, ...EXPORT_BRANCHES })) {
      if (r.rule === "own") continue;
      expect(read(p), p).toMatch(r.marker);
    }
    // The manager-tier types of /api/export/[type] stay shut: an Agent is no manager.
    expect(legacyIsManagerLevel("AGENT")).toBe(false);
    const byType = read("src/app/api/export/[type]/route.ts");
    expect(byType).toContain('if (scope !== "mine" && !isManager(session)) return jsonError("Forbidden", 403);');
  });

  it("keeps the open ones to the person's own records, which is why the sentence says most, not all", () => {
    const open = Object.entries({ ...EXPORT_ROUTES, ...EXPORT_BRANCHES }).filter(([, r]) => r.rule === "own");
    expect(open.map(([p]) => p).sort()).toEqual([
      "src/app/api/calendar/ics/[token]/route.ts",
      "src/app/api/export/[type]/route.ts",
      "src/app/api/me/export/route.ts",
      "src/app/api/meetings/[id]/ics/route.ts",
    ]);
    expect(AGENT_TIER_BLURB).toMatch(/most exports are closed to them/);
  });

  it("hides the exports the browser makes itself from an Agent", () => {
    expect(read("src/components/board-view/board-table-view.tsx")).toMatch(/\{!isAgent \? \(\s*<button\s+type="button"\s+onClick=\{exportCsv\}/);
    expect(read("src/components/tables/table-editor.tsx")).toMatch(/\.\.\.\(!isAgent \? \[\{ label: "Download", icon: Download/);
    const space = read("src/app/(dashboard)/spaces/[slug]/page.tsx");
    expect(space).toContain("canExport={!isAgentOf(u.accessLevel)}");
    expect(space).toContain("{canExport ? <ListCsvExport");
    const canvas = read("src/components/canvas/canvas-editor.tsx");
    expect(canvas).toContain('const canExport = !viewer.isAgent && viewer.orgRole !== "GUEST";');
    expect(canvas).toContain("export: canExport ? { saveFileToDisk: true } : false,");
    expect(canvas).toContain("saveAsImage: canExport,");
    expect(canvas).toContain("canExport={canExport}");
    expect(read("src/components/canvas/whiteboard-canvas.tsx")).toContain('{canExport ? <button type="button" title="Export as PNG"');
  });

  // Docs-found fixes batch 5: Activity and Everything offered Export CSV to
  // an Agent (and a Guest), whose click landed on the server's 403.
  it("hides Activity's and Everything's Export CSV from an Agent and a Guest, whom those exports refuse", () => {
    const activity = read("src/app/(dashboard)/activity/activity-client.tsx");
    expect(activity).toContain("const { isAgent, isGuest } = useViewerRole();");
    expect(activity).toContain("const canExport = !isAgent && !isGuest;");
    expect(activity).toMatch(/menu: canExport \? \[\{ label: "Export CSV", onClick: \(\) => \{ window\.location\.href = `\/api\/activity\/export\.csv/);
    const everything = read("src/app/(dashboard)/everything/everything-view.tsx");
    expect(everything).toContain("const { isAgent, isGuest } = useViewerRole();");
    expect(everything).toMatch(/\.\.\.\(!isAgent && !isGuest \? \[\{ label: "Export CSV", href: `\/api\/me\/everything\/export\.csv/);
    // Each "Export CSV" in those files is behind its gate: none is offered bare.
    expect(activity.match(/label: "Export CSV"/g)).toHaveLength(1);
    expect(everything.match(/label: "Export CSV"/g)).toHaveLength(1);
    // And the routes refuse exactly those two.
    for (const route of ["src/app/api/activity/export.csv/route.ts", "src/app/api/me/everything/export.csv/route.ts"]) {
      expect(read(route)).toContain('viewer.orgRole === "GUEST" || viewer.isAgent');
    }
  });
});
