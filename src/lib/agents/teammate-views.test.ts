// The shapes the teammate routes answer with (teammate-views.ts): the tool
// table reads the policy as gateFor does (managers only tighten, Talk's
// "Don't ask" only per conversation, invitations always ask), the settings
// can remove a target's "Don't ask" but never set one, a stored tool list
// holds real tools only, the module map matches what teammateToolNames takes
// out, and a routine reads in the viewer's zone.

import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/prisma", () => ({ prisma: {} }));

import { NO_PRODUCTS } from "@/lib/connectors/products";
import { LEGACY_COPY, TOOL_PICKER_NOTES } from "./teammate-copy";
import { teammateToolNames } from "./teammate-tools";
import {
  ALL_TOOL_NAMES,
  CONNECTOR_ROW_STATES,
  GIVABLE_TOOLS,
  NO_GOOGLE_ROWS,
  TOOL_CONNECTOR,
  TOOL_MODULE,
  agentScheduleView,
  cleanToolNames,
  connectorRowState,
  editedPersonRules,
  givableTools,
  routineViewFromRow,
  toolSettings,
  type RoutineRowLike,
} from "./teammate-views";
import { TEAMMATE_EXCLUDED } from "./tool-policy";
import { CONNECTOR_TOOL_NAMES, type ToolName } from "./tool-names";
import { serverTimeZone, zoneName } from "./schedule-words";

describe("the tools a teammate may be given", () => {
  it("are every tool but the excluded ones", () => {
    expect([...GIVABLE_TOOLS].sort()).toEqual(ALL_TOOL_NAMES.filter((t) => !TEAMMATE_EXCLUDED.has(t)).sort());
  });

  it("need exactly the modules teammateToolNames takes them out for", () => {
    const every = { toolNames: [...ALL_TOOL_NAMES], productSlug: null };
    const on = teammateToolNames(every, { tablesOn: true, talkOn: true, connectors: NO_PRODUCTS });
    const missingWithout = (opts: { tablesOn: boolean; talkOn: boolean }) => {
      const left = new Set(teammateToolNames(every, { ...opts, connectors: NO_PRODUCTS }));
      return on.filter((t) => !left.has(t)).sort();
    };
    const needing = (m: "talk" | "tables") => (Object.keys(TOOL_MODULE) as ToolName[]).filter((t) => TOOL_MODULE[t] === m).sort();
    expect(missingWithout({ tablesOn: true, talkOn: false })).toEqual(needing("talk"));
    expect(missingWithout({ tablesOn: false, talkOn: true })).toEqual(needing("tables"));
  });

  it("are stored as real tools, never an excluded one, each once, sorted", () => {
    expect(cleanToolNames(["search_tasks", "create_sprint", 42, "nope", "search_tasks", "create_task"])).toEqual(["create_task", "search_tasks"]);
  });

  it("hold the Google tools only for a product that is on, by the product teammateToolNames reads (Phase 3)", () => {
    expect(givableTools(NO_PRODUCTS).filter((t) => (CONNECTOR_TOOL_NAMES as readonly string[]).includes(t))).toEqual([]);
    expect(givableTools(NO_PRODUCTS)).toEqual(GIVABLE_TOOLS.filter((t) => !(CONNECTOR_TOOL_NAMES as readonly string[]).includes(t)));
    const gmailOnly = givableTools({ gmail: true, calendar: false });
    expect(gmailOnly.filter((t) => (CONNECTOR_TOOL_NAMES as readonly string[]).includes(t)).sort()).toEqual(["draft_email", "read_email", "reply_email", "search_email", "send_email"]);
    expect([...givableTools({ gmail: true, calendar: true })]).toEqual([...GIVABLE_TOOLS]);
    // The map the picker reads is the one teammateToolNames takes them out by.
    const every = { toolNames: [...ALL_TOOL_NAMES], productSlug: null };
    const offered = teammateToolNames(every, { tablesOn: true, talkOn: true, connectors: { gmail: false, calendar: true } });
    for (const t of CONNECTOR_TOOL_NAMES) expect(offered.includes(t), t).toBe(TOOL_CONNECTOR[t] === "calendar");
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
    connectors: NO_PRODUCTS,
    google: NO_GOOGLE_ROWS,
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

  it("lists no Google row while no product is on, whatever the teammate stores (Phase 3)", () => {
    const withGoogle = toolSettings({ enabled: ["search_email", "send_email", "search_tasks"], agentRules: {}, personRules: { send_email: "always" }, talkOn: true, tablesOn: true, connectors: NO_PRODUCTS, google: NO_GOOGLE_ROWS });
    for (const t of CONNECTOR_TOOL_NAMES) expect(withGoogle.find((r) => r.name === t), t).toBeUndefined();
    expect(withGoogle.map((r) => r.name)).toEqual(givableTools(NO_PRODUCTS));
  });

  it("gives a Google tool a row only for a product that is on, with the reader's own state, and no other tool one (Phase 3 step 5)", () => {
    const table = toolSettings({
      enabled: ["search_email", "send_email", "list_events", "search_tasks"],
      agentRules: {},
      personRules: {},
      talkOn: true,
      tablesOn: true,
      connectors: { gmail: true, calendar: false },
      google: { gmail: "changed", calendar: "ready" },
    });
    const at = (name: string) => table.find((r) => r.name === name);
    expect(at("search_email")).toMatchObject({ enabled: true, connector: { product: "gmail", state: "changed" } });
    expect(at("send_email")).toMatchObject({ enabled: true, alwaysAsks: true, connector: { product: "gmail", state: "changed" } });
    expect(at("draft_email")).toMatchObject({ enabled: false, connector: { product: "gmail", state: "changed" } });
    // Calendar is off here: stored or not, it has no row.
    expect(at("list_events")).toBeUndefined();
    expect(table.filter((r) => r.connector?.product === "calendar")).toEqual([]);
    for (const r of table) expect(r.connector === null, r.name).toBe(!(CONNECTOR_TOOL_NAMES as readonly string[]).includes(r.name));
  });
});

describe("a Google row's state (Phase 3 step 5)", () => {
  it("is what connectorAccess would answer a turn, each refusal its own", () => {
    expect(connectorRowState({ ok: true })).toBe("ready");
    expect(connectorRowState({ ok: false, reason: "not_connected" })).toBe("connect_first");
    expect(connectorRowState({ ok: false, reason: "needs_reconnect" })).toBe("reconnect");
    expect(connectorRowState({ ok: false, reason: "not_granted" })).toBe("not_granted");
    expect(connectorRowState({ ok: false, reason: "not_allowed" })).toBe("allow_first");
    expect(connectorRowState({ ok: false, reason: "teammate_changed" })).toBe("changed");
    // A product off, or no Google here, has no row at all (givableTools).
    expect(connectorRowState({ ok: false, reason: "workspace_off" })).toBe("connect_first");
    expect(connectorRowState({ ok: false, reason: "not_configured" })).toBe("connect_first");
  });

  it("has a line for every state, and starts at nothing connected", () => {
    expect(Object.keys(TOOL_PICKER_NOTES).filter((k) => k !== "link").sort()).toEqual([...CONNECTOR_ROW_STATES].sort());
    expect(NO_GOOGLE_ROWS).toEqual({ gmail: "connect_first", calendar: "connect_first" });
  });

  it("is never a Google row for a caller that left the products out", () => {
    expect(givableTools(undefined as never).filter((t) => (CONNECTOR_TOOL_NAMES as readonly string[]).includes(t))).toEqual([]);
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

  it("reads a schedule with no zone of its own in the server's, which it runs on (review round 1)", () => {
    const server = serverTimeZone();
    const other = /New_York|Detroit|Toronto/.test(server) ? "Asia/Tokyo" : "America/New_York";
    expect(routineViewFromRow({ ...row, schedule: "0 9 * * 1-5" }, other).when).toBe(`Weekdays at 9:00, ${zoneName(server)}`);
    expect(routineViewFromRow({ ...row, schedule: "0 9 * * 1-5" }, server).when).toBe("Weekdays at 9:00");
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
    expect(agentScheduleView(base, null, null, "u-olivia")).toEqual({ state: null, personName: null, isYou: false, reason: null, routinesHref: href, paused: false, pausedText: null });
  });
  it("names whose routine it is now, and whether it is the viewer's", () => {
    const moved = { ...base, scheduleMovedAt: MOVED, scheduleRoutineId: "r1" };
    expect(agentScheduleView(moved, { actingForId: "u-olivia" }, "Olivia", "u-olivia")).toEqual({ state: "routine", personName: "Olivia", isYou: true, reason: null, routinesHref: href, paused: false, pausedText: null });
    // A paused routine says so, with its reason (review round 1).
    expect(agentScheduleView(moved, { actingForId: "u-olivia", status: "paused", pausedReason: "person_gone" }, "Olivia", "u-max")).toMatchObject({ state: "routine", paused: true, pausedText: expect.any(String) });
    expect(agentScheduleView(moved, { actingForId: "u-olivia" }, "Olivia", "u-max")).toMatchObject({ state: "routine", personName: "Olivia", isYou: false });
  });
  it("reads a routine deleted since as never moved, so the row says what is true", () => {
    expect(agentScheduleView({ ...base, scheduleMovedAt: MOVED, scheduleRoutineId: "r1" }, null, null, "u-olivia")).toMatchObject({ state: null });
  });
  it("gives each stop its reason", () => {
    for (const [reason, words] of Object.entries(LEGACY_COPY.stopReason)) {
      expect(agentScheduleView({ ...base, scheduleMovedAt: MOVED, scheduleMoveReason: reason }, null, null, "u-olivia")).toEqual({
        state: "stopped", personName: null, isYou: false, reason: words, routinesHref: href, paused: false, pausedText: null,
      });
    }
    expect(agentScheduleView({ ...base, scheduleMovedAt: MOVED, scheduleMoveReason: "from_the_future" }, null, null, "u-olivia")).toMatchObject({ state: "stopped", reason: null });
  });
  it("encodes the slug in the address", () => {
    expect(agentScheduleView({ ...base, slug: "a&b" }, null, null, "u").routinesHref).toBe("/agents?chat=a%26b&settings=routines");
  });
});
