// The rows about one person's own AI teammate work (src/lib/access/
// personal-activity.ts, review round 1 of Phase 4): which they are, who reads
// them in each Activity scope, and the audit line of a browser session's end.

import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { BROWSER_TOOL_NAMES, CONNECTOR_TOOL_NAMES, SKILL_TOOL_NAMES } from "@/lib/agents/tool-names";
import {
  PERSONAL_SKILL_TYPES,
  PERSONAL_TEAMMATE_ACTIVITY_TYPES,
  WORKSPACE_TEAMMATE_ACTIVITY_TYPES,
  WRITER_PART_COPY,
  activityScopeWhere,
  browserSessionAuditSummary,
  exportWrittenAboutOthersWhere,
  isPersonalTeammateActivityType,
  isWriterPartOnly,
  myActivityWhere,
  personalRowIsAbout,
  personalRowRule,
  writerPartSentence,
} from "./personal-activity";
import { PERSONAL_ROW_IDS, ROWS, matches, type Row } from "./personal-activity.testkit";

const ids = (where: Parameters<typeof matches>[1]) => ROWS.filter((r) => matches(r, where)).map((r) => r.id);
const member = (userId: string) => ({ userId, organizationId: "org", orgRole: "MEMBER" as const });

describe("PERSONAL_TEAMMATE_ACTIVITY_TYPES", () => {
  it("holds every Google and browser tool's audit row, a person's browser rows and every connection row", () => {
    for (const t of [...CONNECTOR_TOOL_NAMES, ...BROWSER_TOOL_NAMES]) expect(isPersonalTeammateActivityType(`agent.${t}`), t).toBe(true);
    for (const t of [
      "agent.click",
      "agent.type_text",
      "agent.select_option",
      "agent.draft_email",
      "agent.send_email",
      "agent.reply_email",
      "agent.create_event",
      "agent.update_event",
      "agent.cancel_event",
      "agent.respond_to_invite",
      "teammate_browser.take_over",
      "teammate_browser.session_started",
      "teammate_browser.session_ended",
      "teammate_connection.connected",
      "teammate_connection.disconnected",
      "teammate_connection.needs_reconnect",
    ]) {
      expect(PERSONAL_TEAMMATE_ACTIVITY_TYPES, t).toContain(t);
    }
    // A teammate's other work, and the workspace's own settings, stay as they were.
    for (const t of ["agent.update_task", "agent.post_in_talk", "agent.talk_answer", ...WORKSPACE_TEAMMATE_ACTIVITY_TYPES]) expect(isPersonalTeammateActivityType(t), t).toBe(false);
  });

  it("sorts every teammate_browser and teammate_connection row the app writes, so a new one is decided", () => {
    const written = new Set<string>();
    const walk = (dir: string) => {
      for (const name of readdirSync(dir)) {
        const p = join(dir, name);
        if (statSync(p).isDirectory()) {
          if (name !== "generated" && name !== "node_modules") walk(p);
        } else if (/\.tsx?$/.test(name) && !/\.test\.tsx?$/.test(name) && !name.includes("testkit")) {
          for (const m of readFileSync(p, "utf8").matchAll(/type:\s*"(teammate_(?:browser|connection|connectors|skill)\.[a-z_]+)"/g)) written.add(m[1]);
        }
      }
    };
    walk(join(process.cwd(), "src"));
    expect(written.size).toBeGreaterThan(8);
    for (const t of written) expect([...PERSONAL_TEAMMATE_ACTIVITY_TYPES, ...WORKSPACE_TEAMMATE_ACTIVITY_TYPES], t).toContain(t);
  });
});

// Phase 5 Decision 24 (docs/plans/ai-teammates-phase5.md): every row about a
// person's own skill work is personal, about its acting person; the skills
// switch and Delete every skill are the workspace's.
describe("the skill rows (Phase 5)", () => {
  const at = new Date("2026-10-17T09:00:00Z");
  const row = (o: Partial<Row>): Row => ({
    id: "x", organizationId: "org", type: "teammate_skill.saved", description: "Saved a skill with 3 steps on exp.test", actorId: "max", actingForId: "max", actorType: "user", actorLabel: null,
    targetType: null, targetId: null, metadata: { steps: 3, sites: ["exp.test"] }, ipAddress: null, userAgent: null, severity: "info", oldValue: null, newValue: null, createdAt: at, ...o,
  });

  it("are personal, each with a writer-part sentence by type only, and agent.use_skill too", () => {
    expect([...PERSONAL_SKILL_TYPES]).toEqual(["teammate_skill.recording", "teammate_skill.saved", "teammate_skill.changed", "teammate_skill.deleted", "teammate_skill.routine"]);
    // Before: none was personal, so a manager's My team and the People team's Everyone read them.
    for (const t of PERSONAL_SKILL_TYPES) expect(isPersonalTeammateActivityType(t), t).toBe(true);
    for (const t of SKILL_TOOL_NAMES) expect(isPersonalTeammateActivityType(`agent.${t}`), t).toBe(true);
    for (const t of ["agent.fill_fields", "agent.ask_to_show_me"]) expect(isPersonalTeammateActivityType(t), t).toBe(true);
    expect(writerPartSentence("teammate_skill.recording")).toBe("Recorded another person's skill");
    expect(writerPartSentence("teammate_skill.saved")).toBe("Saved another person's skill");
    expect(writerPartSentence("teammate_skill.changed")).toBe("Changed another person's skill");
    expect(writerPartSentence("teammate_skill.deleted")).toBe("Deleted another person's skill");
    expect(writerPartSentence("teammate_skill.routine")).toBe("Made a routine from another person's skill");
    expect(writerPartSentence("agent.use_skill")).toBe("An AI teammate started a skill for another person");
    expect(writerPartSentence("agent.fill_fields")).toBe(WRITER_PART_COPY.browserAct);
  });

  it("are about their acting person: Max and Owners and Admins read them, a manager and the People team never", () => {
    const rows = [row({ id: "saved-max" }), row({ id: "recording-max", type: "teammate_skill.recording" }), row({ id: "use-max", type: "agent.use_skill" }), row({ id: "task-mia", type: "task.created", actorId: "mia", actingForId: null })];
    const found = (where: Parameters<typeof matches>[1]) => rows.filter((r) => matches(r, where)).map((r) => r.id);
    expect(found({ organizationId: "org", ...myActivityWhere("max") })).toEqual(["saved-max", "recording-max", "use-max"]);
    expect(found(activityScopeWhere(member("mia"), "team", ["max"]))).toEqual(["task-mia"]);
    expect(found(activityScopeWhere(member("pia"), "all", []))).toEqual(["task-mia"]);
    expect(found(activityScopeWhere({ userId: "ada", organizationId: "org", orgRole: "ADMIN" }, "all", []))).toEqual(["saved-max", "recording-max", "use-max", "task-mia"]);
    for (const r of rows.slice(0, 3)) {
      expect(personalRowIsAbout(r, "max"), r.id).toBe(true);
      expect(isWriterPartOnly(r, "max"), r.id).toBe(false);
    }
  });

  it("keep the skills switch and Delete every skill workspace rows", () => {
    for (const t of ["teammate_browser.skills_changed", "teammate_browser.skills_deleted_all"]) {
      expect(WORKSPACE_TEAMMATE_ACTIVITY_TYPES, t).toContain(t);
      expect(isPersonalTeammateActivityType(t), t).toBe(false);
    }
  });
});

describe("who reads a personal row", () => {
  it("Just me: the person's own rows, and the personal rows about them whoever wrote them, never one about someone else", () => {
    expect(ids({ organizationId: "org", ...myActivityWhere("max") })).toEqual(["task-max", "click-max", "takeover-max", "ended-max", "ended-max-by-mia", "mail-max", "google-off-max", "google-on-max"]);
    // Mia ended Max's browser: the row is his, not hers.
    expect(ids({ organizationId: "org", ...myActivityWhere("mia") })).toEqual(["task-mia"]);
    // Ada disconnected Max's Google: his row, and her own switch.
    expect(ids({ organizationId: "org", ...myActivityWhere("ada") })).toEqual(["switch-ada"]);
  });

  it("My team and Everyone: a manager and the People team read their people's work, never their teammate rows", () => {
    expect(ids(activityScopeWhere(member("mia"), "team", ["max", "ann"]))).toEqual(["task-max", "task-mia"]);
    expect(ids(activityScopeWhere(member("pia"), "all", []))).toEqual(["task-max", "switch-ada", "task-mia"]);
    // The person themselves, past Just me, still reads their own, and never Ann's.
    expect(ids(activityScopeWhere(member("max"), "all", []))).toEqual(["task-max", "click-max", "takeover-max", "ended-max", "ended-max-by-mia", "mail-max", "google-off-max", "google-on-max", "switch-ada", "task-mia"]);
    expect(ids(activityScopeWhere(member("max"), "all", []))).not.toContain("click-ann");
    expect(PERSONAL_ROW_IDS.every((id) => ROWS.some((r) => r.id === id))).toBe(true);
  });

  it("Owners and Admins read every row in My team and Everyone", () => {
    const admin = { userId: "ada", organizationId: "org", orgRole: "ADMIN" as const };
    expect(ids(activityScopeWhere(admin, "all", []))).toEqual(ROWS.filter((r) => r.organizationId === "org").map((r) => r.id));
    expect(ids(activityScopeWhere({ ...admin, orgRole: "OWNER" }, "team", ["max"]))).toEqual(["task-max", "click-max", "takeover-max", "mail-max", "google-off-max", "google-on-max", "switch-ada"]);
    // Just me is theirs alone, as anyone's.
    expect(ids(activityScopeWhere(admin, "my", []))).toEqual(["switch-ada"]);
  });

  it("keeps the scope's actors in actorId, where ?actorIds= narrows them", () => {
    expect(activityScopeWhere(member("mia"), "team", ["max", "max"]).actorId).toEqual({ in: ["mia", "max"] });
    expect(activityScopeWhere(member("mia"), "all", [])).toEqual({ organizationId: "org", AND: [personalRowRule("mia")] });
  });
});

describe("browserSessionAuditSummary", () => {
  it("names every site a session used with its reads and actions", () => {
    expect(browserSessionAuditSummary("Chief of Staff (for Max Smith): Closed a browser after 4 minutes", ROWS[3].metadata)).toBe(
      "Chief of Staff (for Max Smith): Closed a browser after 4 minutes. Sites: bank.example.com, 3 reads and 1 action; clinic.example.org, 2 reads and no actions.",
    );
    expect(browserSessionAuditSummary("Closed a browser after 1 minute.", { sites: [] })).toBe("Closed a browser after 1 minute. It used no site.");
  });

  it("names only hosts and counts, and nothing for a row with no site list", () => {
    const out = browserSessionAuditSummary("Closed a browser", { sites: [{ site: "bank.example.com/account?token=1", reads: 2, acts: 0 }, { site: "BANK.example.com", reads: -4, acts: 1.7 }, "x", null] });
    expect(out).toBe("Closed a browser. Sites: bank.example.com, no reads and 1 action.");
    expect(browserSessionAuditSummary("Closed a browser", null)).toBeNull();
    expect(browserSessionAuditSummary("Closed a browser", { sites: "bank.example.com" })).toBeNull();
    expect(browserSessionAuditSummary("Closed a browser", { sites: [{ site: "a.example.com", reads: 1, acts: 1 }] })).not.toMatch(/--|—|–/);
  });
});

// Review round 3 of Phase 4: round 2 read the export by Just me's where
// clause, which leaves out every personal row a person wrote about someone
// else (an Admin's Disconnect everyone, a manager's removal that ended a
// report's browser), so an Article 15 answer missed the writer's own acts.
// Review round 4: round 3 read them in the same list as the person's own,
// under one cap, so a Disconnect everyone of 10,000 connections pushed every
// row of the Admin's own out. They are now a list of their own, read by
// exportWrittenAboutOthersWhere; the main list reads myActivityWhere.
describe("exportWrittenAboutOthersWhere", () => {
  const PEOPLE = ["max", "mia", "ada", "ann", "pia"];
  const allIds = (where: Parameters<typeof matches>[1]) => ROWS.filter((r) => matches(r, where)).map((r) => r.id);

  it("holds only the personal rows the person wrote about someone else, in every workspace, and none of Just me's", () => {
    // Mia's end of Max's browser, and Ada's disconnect of his Google: theirs as writers.
    expect(allIds(exportWrittenAboutOthersWhere("mia"))).toEqual(["ended-max-by-mia"]);
    expect(allIds(exportWrittenAboutOthersWhere("ada"))).toEqual(["google-off-max"]);
    // Max and Ann wrote nothing about anyone else.
    expect(allIds(exportWrittenAboutOthersWhere("max"))).toEqual([]);
    expect(allIds(exportWrittenAboutOthersWhere("ann"))).toEqual([]);
    // Just me, the export's main list, is unchanged.
    expect(allIds(myActivityWhere("mia"))).toEqual(["task-mia"]);
    expect(allIds(myActivityWhere("ada"))).toEqual(["switch-ada"]);
    expect(allIds(myActivityWhere("max"))).toContain("other-org");
    // Every workspace: the same row in another one is found too.
    const elsewhere: Row = { ...(ROWS.find((r) => r.id === "ended-max-by-mia") as Row), id: "elsewhere", organizationId: "org-2" };
    expect(matches(elsewhere, exportWrittenAboutOthersWhere("mia"))).toBe(true);
  });

  it("finds exactly the person's own rows that isWriterPartOnly trims, never one Just me finds, and agrees with personalRowIsAbout", () => {
    for (const p of PEOPLE) {
      for (const r of ROWS) {
        const mine = matches(r, myActivityWhere(p));
        const aboutOthers = matches(r, exportWrittenAboutOthersWhere(p));
        // Only the writer's part of a row about someone else.
        expect(aboutOthers, `${p} ${r.id}`).toBe(r.actorId === p && isWriterPartOnly(r, p));
        // The two lists never hold the same row.
        expect(mine && aboutOthers, `${p} ${r.id}`).toBe(false);
        // A personal row Just me holds is about the person, whole; one it does not is never.
        if (isPersonalTeammateActivityType(r.type)) expect(personalRowIsAbout(r, p), `${p} ${r.id}`).toBe(mine);
      }
    }
  });

  it("never drops a row by a null column: a connection row with no target, or another kind, and an act for nobody", () => {
    const at = new Date("2026-10-11T09:00:00Z");
    const base: Row = {
      id: "x", organizationId: "org", type: "teammate_connection.disconnected", description: "Disconnected Google", actorId: "ada", actingForId: null, actorType: "user", actorLabel: null,
      targetType: null, targetId: null, metadata: null, ipAddress: null, userAgent: null, severity: "info", oldValue: null, newValue: null, createdAt: at,
    };
    const rows: Row[] = [
      { ...base, id: "no-target" },
      { ...base, id: "no-target-id", targetType: "user" },
      { ...base, id: "no-target-type", targetId: "max" },
      { ...base, id: "agent-target", targetType: "agent", targetId: "ada" },
      { ...base, id: "own-google", targetType: "user", targetId: "ada" },
      { ...base, id: "ended-own", type: "teammate_browser.session_ended", actingForId: null },
      { ...base, id: "ended-for-ada", type: "teammate_browser.session_ended", actingForId: "ada" },
      { ...base, id: "ended-for-max", type: "teammate_browser.session_ended", actingForId: "max" },
    ];
    const found = (where: Parameters<typeof matches>[1]) => rows.filter((r) => matches(r, where)).map((r) => r.id);
    // Every row Ada wrote is in one of her two lists, and in one only.
    expect(found(myActivityWhere("ada"))).toEqual(["own-google", "ended-own", "ended-for-ada"]);
    expect(found(exportWrittenAboutOthersWhere("ada"))).toEqual(["no-target", "no-target-id", "no-target-type", "agent-target", "ended-for-max"]);
    // About Ada, whole: her own Google, and the browser rows that act for her or for no one.
    expect(rows.filter((r) => personalRowIsAbout(r, "ada")).map((r) => r.id)).toEqual(["own-google", "ended-own", "ended-for-ada"]);
    expect(rows.filter((r) => isWriterPartOnly(r, "ada")).map((r) => r.id)).toEqual(["no-target", "no-target-id", "no-target-type", "agent-target", "ended-for-max"]);
    // Nobody else's second list holds a row Ada wrote.
    expect(found(exportWrittenAboutOthersWhere("max"))).toEqual([]);
  });

  it("reads every arm of both export reads by an index of one person's rows: actorId, actingForId or a user target", () => {
    // prisma/sql/2026-10-11-ai-teammates-phase4-activity-indexes.sql: "ActivityLog" ("actingForId", "createdAt")
    // WHERE "actingForId" IS NOT NULL, and ("targetId", "createdAt") WHERE "targetType" = 'user'; and "ActivityLog_actorId_idx".
    const byIndex = (arm: Record<string, unknown>) => arm.actorId === "mia" || arm.actingForId === "mia" || (arm.targetType === "user" && arm.targetId === "mia");
    const mine = myActivityWhere("mia").OR as Array<Record<string, unknown>>;
    const aboutOthers = exportWrittenAboutOthersWhere("mia").OR as Array<Record<string, unknown>>;
    expect([mine.length, aboutOthers.length]).toEqual([4, 2]);
    for (const arm of mine) expect(byIndex(arm), JSON.stringify(arm)).toBe(true);
    // Every arm of the rows about others names the actor.
    for (const arm of aboutOthers) expect(arm.actorId, JSON.stringify(arm)).toBe("mia");
    expect(Object.keys(myActivityWhere("mia"))).toEqual(["OR"]);
    expect(Object.keys(exportWrittenAboutOthersWhere("mia"))).toEqual(["OR"]);
  });
});

describe("writerPartSentence", () => {
  it("names the kind of action by type only, for every personal row", () => {
    expect(writerPartSentence("teammate_browser.session_ended")).toBe("Closed another person's AI teammate browser");
    expect(writerPartSentence("teammate_connection.disconnected")).toBe("Disconnected another person's Google from AI teammates");
    expect(writerPartSentence("agent.click")).toBe(WRITER_PART_COPY.browserAct);
    expect(writerPartSentence("agent.send_email")).toBe(WRITER_PART_COPY.googleAct);
    expect(writerPartSentence("teammate_browser.something_new")).toBe(WRITER_PART_COPY.other);
    for (const t of PERSONAL_TEAMMATE_ACTIVITY_TYPES) {
      const said = writerPartSentence(t);
      expect(said, t).not.toBe(WRITER_PART_COPY.other);
      expect(said, t).toMatch(/^[A-Z][A-Za-z' ]+$/);
    }
    for (const said of Object.values(WRITER_PART_COPY)) expect(said).not.toMatch(/--|\u2014|\u2013|\.example|undefined/);
  });
});
