// The rows about one person's own AI teammate work (src/lib/access/
// personal-activity.ts, review round 1 of Phase 4): which they are, who reads
// them in each Activity scope, and the audit line of a browser session's end.

import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { BROWSER_TOOL_NAMES, CONNECTOR_TOOL_NAMES } from "@/lib/agents/tool-names";
import {
  PERSONAL_TEAMMATE_ACTIVITY_TYPES,
  WORKSPACE_TEAMMATE_ACTIVITY_TYPES,
  activityScopeWhere,
  browserSessionAuditSummary,
  isPersonalTeammateActivityType,
  myActivityWhere,
  personalRowRule,
} from "./personal-activity";
import { PERSONAL_ROW_IDS, ROWS, matches } from "./personal-activity.testkit";

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
          for (const m of readFileSync(p, "utf8").matchAll(/type:\s*"(teammate_(?:browser|connection|connectors)\.[a-z_]+)"/g)) written.add(m[1]);
        }
      }
    };
    walk(join(process.cwd(), "src"));
    expect(written.size).toBeGreaterThan(8);
    for (const t of written) expect([...PERSONAL_TEAMMATE_ACTIVITY_TYPES, ...WORKSPACE_TEAMMATE_ACTIVITY_TYPES], t).toContain(t);
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
