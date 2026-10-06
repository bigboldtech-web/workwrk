// The starter templates (templates.ts, docs/plans/ai-teammates.md 6): six of
// them, each key once, a colour the database takes, an icon the tile can
// draw, real tools a teammate may be given, at most four starters, words
// that hold the copy rule; and a card that leaves out, and names, a tool this
// workspace cannot give a teammate now.

import { describe, expect, it } from "vitest";
import { getSpaceIcon } from "@/components/layout/os/space-icon-catalog";
import { isTeammateHue } from "./hues";
import { GIVABLE_TOOLS } from "./teammate-views";
import { TEAMMATE_EXCLUDED } from "./tool-policy";
import { isToolName } from "./tool-names";
import { TEAMMATE_TEMPLATES, TEMPLATE_KEYS, isTemplateKey, templateCard, templateCards, templateFor, type TeammateTemplate } from "./templates";

// The copy rule (teammate-copy.test.ts): no em dash, no en dash, no double
// hyphen, written by code point so this file holds neither.
const BANNED = new RegExp(`[${String.fromCharCode(0x2014, 0x2013)}]|--`);

const ALL_ON = { talkOn: true, tablesOn: true };

describe("the templates", () => {
  it("are six, each key once, in the order of TEMPLATE_KEYS", () => {
    expect(TEAMMATE_TEMPLATES).toHaveLength(6);
    expect(TEAMMATE_TEMPLATES.map((t) => t.key)).toEqual([...TEMPLATE_KEYS]);
    expect(new Set(TEMPLATE_KEYS).size).toBe(6);
  });

  it("wear one of the eight colours and an icon the tile can draw", () => {
    for (const t of TEAMMATE_TEMPLATES) {
      expect(isTeammateHue(t.hue), t.key).toBe(true);
      expect(getSpaceIcon(t.avatar), `${t.key}: ${t.avatar}`).not.toBeNull();
    }
  });

  it("start with real tools a teammate may be given, each once", () => {
    const givable = new Set<string>(GIVABLE_TOOLS);
    for (const t of TEAMMATE_TEMPLATES) {
      for (const tool of t.tools) {
        expect(isToolName(tool), `${t.key}: ${tool}`).toBe(true);
        expect(TEAMMATE_EXCLUDED.has(tool), `${t.key}: ${tool}`).toBe(false);
        expect(givable.has(tool), `${t.key}: ${tool}`).toBe(true);
      }
      expect(new Set(t.tools).size, t.key).toBe(t.tools.length);
    }
  });

  it("can remember, forget and keep a routine, and none is preset to anything but the risk defaults", () => {
    for (const t of TEAMMATE_TEMPLATES) {
      expect(t.tools).toEqual(expect.arrayContaining(["remember", "forget", "create_routine"]));
      expect(Object.keys(t)).not.toContain("personRules");
      expect(Object.keys(t)).not.toContain("agentRules");
    }
  });

  it("offer one to four starters, and say everything with words that hold the copy rule", () => {
    for (const t of TEAMMATE_TEMPLATES) {
      expect(t.starters.length).toBeGreaterThanOrEqual(1);
      expect(t.starters.length).toBeLessThanOrEqual(4);
      for (const s of t.starters) expect(s.trim()).not.toBe("");
      for (const s of [t.name, t.persona, t.job, t.instructions, ...t.starters]) {
        expect(BANNED.test(s), `${t.key}: ${s}`).toBe(false);
        expect(s.trim()).not.toBe("");
      }
      // What POST /api/agents/teammates takes.
      expect(t.persona.length).toBeLessThanOrEqual(60);
      expect(t.job.length).toBeLessThanOrEqual(200);
      expect(t.instructions.length).toBeLessThanOrEqual(8000);
    }
  });

  it("are found by key, and nothing else is one", () => {
    expect(templateFor("status-reporter")?.persona).toBe("Status Reporter");
    expect(templateFor("talk-inbox-triage")).toMatchObject({ name: "Talk and inbox triage", persona: "Triage", hue: "moss", avatar: "Inbox" });
    for (const v of ["", "Status-Reporter", "constructor", null, undefined, 3]) {
      expect(isTemplateKey(v)).toBe(false);
      expect(templateFor(v as string | null)).toBeNull();
    }
  });
});

describe("templateCards", () => {
  it("offer every tool when the workspace has every module", () => {
    const cards = templateCards(ALL_ON);
    expect(cards.map((c) => c.key)).toEqual([...TEMPLATE_KEYS]);
    for (const c of cards) {
      expect(c.dropped).toEqual([]);
      expect(c.tools).toEqual([...(templateFor(c.key)?.tools ?? [])]);
    }
  });

  it("leave out the Talk tools when Talk is off, and say why", () => {
    const triage = templateCards({ talkOn: false, tablesOn: true }).find((c) => c.key === "talk-inbox-triage");
    expect(triage?.tools).toEqual(["list_my_inbox", "search_tasks", "create_task", "comment_on_task", "remember", "forget", "create_routine"]);
    expect(triage?.dropped).toEqual([
      { name: "read_talk", why: "talk_off" },
      { name: "post_in_talk", why: "talk_off" },
    ]);
    const prep = templateCards({ talkOn: false, tablesOn: true }).find((c) => c.key === "meeting-prep");
    expect(prep?.dropped).toEqual([]);
  });

  it("leave out a Tables tool when Tables is off, and a tool no teammate is given", () => {
    const made: TeammateTemplate = { ...TEAMMATE_TEMPLATES[0], tools: ["search_tasks", "create_data_table", "create_contract", "search_tasks"] };
    expect(templateCard(made, { talkOn: true, tablesOn: false })).toMatchObject({
      tools: ["search_tasks"],
      dropped: [
        { name: "create_data_table", why: "tables_off" },
        { name: "create_contract", why: "excluded" },
      ],
    });
    expect(templateCard(made, ALL_ON).tools).toEqual(["search_tasks", "create_data_table"]);
  });

  it("carry at most four starters", () => {
    const made: TeammateTemplate = { ...TEAMMATE_TEMPLATES[0], starters: ["a", "b", "c", "d", "e"] };
    expect(templateCard(made, ALL_ON).starters).toEqual(["a", "b", "c", "d"]);
  });
});
