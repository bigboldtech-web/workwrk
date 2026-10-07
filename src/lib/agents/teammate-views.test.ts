// The shapes the teammate routes answer with (teammate-views.ts): the tool
// table reads the policy as gateFor does (managers only tighten, Talk's
// "Don't ask" only per conversation, invitations always ask), the settings
// can remove a target's "Don't ask" but never set one, a stored tool list
// holds real tools only, the module map matches what teammateToolNames takes
// out, and a routine reads in the viewer's zone.

import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/prisma", () => ({ prisma: {} }));

import { LEGACY_COPY } from "./teammate-copy";
import { teammateToolNames } from "./teammate-tools";
import { ALL_TOOL_NAMES, GIVABLE_TOOLS, TOOL_MODULE, agentScheduleView, cleanToolNames, editedPersonRules, routineViewFromRow, toolSettings, type RoutineRowLike } from "./teammate-views";
import { TEAMMATE_EXCLUDED } from "./tool-policy";
import type { ToolName } from "./tool-names";

describe("the tools a teammate may be given", () => {
  it("are every tool but the excluded ones", () => {
    expect([...GIVABLE_TOOLS].sort()).toEqual(ALL_TOOL_NAMES.filter((t) => !TEAMMATE_EXCLUDED.has(t)).sort());
  });

  it("need exactly the modules teammateToolNames takes them out for", () => {
    const every = { toolNames: [...ALL_TOOL_NAMES], productSlug: null };
    const on = teammateToolNames(every, { tablesOn: true, talkOn: true });
    const missingWithout = (opts: { tablesOn: boolean; talkOn: boolean }) => {
      const left = new Set(teammateToolNames(every, opts));
      return on.filter((t) => !left.has(t)).sort();
    };
    const needing = (m: "talk" | "tables") => (Object.keys(TOOL_MODULE) as ToolName[]).filter((t) => TOOL_MODULE[t] === m).sort();
    expect(missingWithout({ tablesOn: true, talkOn: false })).toEqual(needing("talk"));
    expect(missingWithout({ tablesOn: false, talkOn: true })).toEqual(needing("tables"));
  });

  it("are stored as real tools, never an excluded one, each once, sorted", () => {
    expect(cleanToolNames(["search_tasks", "create_sprint", 42, "nope", "search_tasks", "create_task"])).toEqual(["create_task", "search_tasks"]);
  });
});

describe("toolSettings", () => {
  const rows = toolSettings({
    enabled: ["search_tasks", "create_task", "post_in_talk", "invite_person_with_role", "send_kudos"],
    agentRules: { create_task: "ask", send_kudos: "always" },
    personRules: {
      send_kudos: "always",
      "post_in_talk:conv:c1": "always",
      post_in_talk: "always",
      "create_task:outward": "always",
      invite_person_with_role: "always",
    },
    talkOn: true,
    tablesOn: false,
    targetLabels: { "conv:c1": "#general" },
  });
  const row = (name: string) => rows.find((r) => r.name === name);

  it("runs reads and never offers them a choice", () => {
    expect(row("search_tasks")).toMatchObject({ risk: "READ", enabled: true, gate: "run", canDontAsk: false, alwaysAsks: false, label: "Find tasks" });
  });

  it("lets managers tighten and never loosen", () => {
    expect(row("create_task")).toMatchObject({ risk: "INTERNAL", agentRule: "ask", gate: "ask", canDontAsk: true });
    expect(row("send_kudos")).toMatchObject({ risk: "OUTWARD", agentRule: null, personRule: "always", gate: "run" });
  });

  it("keeps Talk's Don't ask to one conversation, named as the person sees it", () => {
    expect(row("post_in_talk")).toMatchObject({
      personRule: null,
      gate: "ask",
      canDontAsk: false,
      scoped: [{ key: "post_in_talk:conv:c1", target: "conv:c1", choice: "always", label: "#general" }],
    });
    expect(row("create_task")?.scoped).toEqual([{ key: "create_task:outward", target: "outward", choice: "always", label: null }]);
  });

  it("always asks before an invitation, whatever is stored", () => {
    expect(row("invite_person_with_role")).toMatchObject({ risk: "IRREVERSIBLE", personRule: null, gate: "ask", canDontAsk: false, alwaysAsks: true });
  });

  it("says when a module is off, and never lists an excluded tool", () => {
    expect(row("create_data_table")).toMatchObject({ enabled: false, unavailable: "tables_off" });
    expect(row("read_talk")).toMatchObject({ unavailable: null });
    expect(row("create_contract")).toBeUndefined();
  });
});

describe("editedPersonRules", () => {
  const stored = { "post_in_talk:conv:c1": "always", send_kudos: "ask" };

  it("removes a target's Don't ask, and never sets one from the settings", () => {
    expect(
      editedPersonRules(stored, {
        "post_in_talk:conv:c2": "always",
        "create_task:outward": "always",
        "post_in_talk:conv:c1": null,
        send_kudos: "always",
        invite_person_with_role: "always",
        constructor: "ask" as const,
      }),
    ).toEqual({ send_kudos: "always" });
  });

  it("keeps what it was not asked to change", () => {
    expect(editedPersonRules(stored, { create_task: "ask" })).toEqual({ "post_in_talk:conv:c1": "always", send_kudos: "ask", create_task: "ask" });
  });
});

describe("routineViewFromRow", () => {
  const row: RoutineRowLike = {
    id: "r1",
    name: "Brief",
    prompt: "Brief me",
    schedule: "CRON_TZ=Asia/Kolkata 0 9 * * 1-5",
    status: "active",
    pausedReason: null,
    nextRunAt: new Date("2026-10-07T03:30:00Z"),
    lastRunAt: null,
    lastRunId: null,
    lastStatus: null,
    lastReason: null,
    createdVia: "chat",
    createdAt: new Date("2026-10-06T00:00:00Z"),
  };

  it("names the zone only when it is not the viewer's", () => {
    expect(routineViewFromRow(row, "Asia/Kolkata")).toMatchObject({ when: "Weekdays at 9:00", status: "active", nextRunAt: "2026-10-07T03:30:00.000Z", pausedText: null });
    expect(routineViewFromRow(row, "America/New_York").when).toBe("Weekdays at 9:00, Kolkata time");
  });

  it("reads a paused routine with its reason and no next run", () => {
    expect(routineViewFromRow({ ...row, status: "paused", pausedReason: "agent_removed" }, null)).toMatchObject({
      status: "paused",
      pausedReason: "agent_removed",
      pausedText: "This teammate was removed.",
      nextRunAt: null,
    });
  });

  it("says a routine came from Workspace agents (Phase 2), and nothing for any other", () => {
    expect(routineViewFromRow({ ...row, createdVia: "legacy" }, null)).toMatchObject({ createdVia: "legacy", movedVia: "Moved from Workspace agents" });
    expect(routineViewFromRow(row, null)).toMatchObject({ createdVia: "chat", movedVia: null });
    expect(routineViewFromRow({ ...row, createdVia: "settings" }, null)).toMatchObject({ createdVia: "settings", movedVia: null });
    expect(routineViewFromRow({ ...row, createdVia: "elsewhere" }, null)).toMatchObject({ createdVia: "chat", movedVia: null });
  });
});

describe("agentScheduleView (Workspace agents, Phase 2)", () => {
  const MOVED = new Date("2026-10-07T10:00:00Z");
  const base = { slug: "deal-desk", scheduleMovedAt: null, scheduleRoutineId: null, scheduleMoveReason: null };
  const href = "/agents?chat=deal-desk&settings=routines";

  it("reads a schedule never moved as none", () => {
    expect(agentScheduleView(base, null, null, "u-olivia")).toEqual({ state: null, personName: null, isYou: false, reason: null, routinesHref: href });
  });
  it("names whose routine it is now, and whether it is the viewer's", () => {
    const moved = { ...base, scheduleMovedAt: MOVED, scheduleRoutineId: "r1" };
    expect(agentScheduleView(moved, { actingForId: "u-olivia" }, "Olivia", "u-olivia")).toEqual({ state: "routine", personName: "Olivia", isYou: true, reason: null, routinesHref: href });
    expect(agentScheduleView(moved, { actingForId: "u-olivia" }, "Olivia", "u-max")).toMatchObject({ state: "routine", personName: "Olivia", isYou: false });
  });
  it("reads a routine deleted since as never moved, so the row says what is true", () => {
    expect(agentScheduleView({ ...base, scheduleMovedAt: MOVED, scheduleRoutineId: "r1" }, null, null, "u-olivia")).toMatchObject({ state: null });
  });
  it("gives each stop its reason", () => {
    for (const [reason, words] of Object.entries(LEGACY_COPY.stopReason)) {
      expect(agentScheduleView({ ...base, scheduleMovedAt: MOVED, scheduleMoveReason: reason }, null, null, "u-olivia")).toEqual({
        state: "stopped", personName: null, isYou: false, reason: words, routinesHref: href,
      });
    }
    expect(agentScheduleView({ ...base, scheduleMovedAt: MOVED, scheduleMoveReason: "from_the_future" }, null, null, "u-olivia")).toMatchObject({ state: "stopped", reason: null });
  });
  it("encodes the slug in the address", () => {
    expect(agentScheduleView({ ...base, slug: "a&b" }, null, null, "u").routinesHref).toBe("/agents?chat=a%26b&settings=routines");
  });
});
