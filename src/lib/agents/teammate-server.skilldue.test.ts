// A skill's reminder line in the chat (teammate-server.ts messagesPage,
// docs/plans/ai-teammates-phase5.md step 5): it draws Start only while its
// skill is the viewer's own and ready, read with the line, with the skill's
// name as it is now (the run message Start sends is checked against it).
// Nothing is read when no line is a reminder. The chat's rows and the
// skills are a small table; the cards are a stand-in.

import { beforeEach, describe, expect, it, vi } from "vitest";

type Row = Record<string, unknown>;

const db = vi.hoisted(() => ({
  rows: [] as Row[],
  skills: [] as Row[],
  skillReads: [] as Row[],
}));

vi.mock("@/lib/prisma", () => ({
  prisma: {
    chatMessage: {
      findFirst: async () => null,
      // Newest first, as the page reads them.
      findMany: async () => [...db.rows].reverse(),
    },
    teammateSkill: {
      findMany: async (a: { where: { id: { in: string[] }; userId: string; status: string } }) => {
        db.skillReads.push(a.where);
        return db.skills.filter((k) => a.where.id.in.includes(String(k.id)) && k.userId === a.where.userId && k.status === a.where.status).map((k) => ({ id: k.id, name: k.name }));
      },
    },
  },
}));
vi.mock("./actions", () => ({ actionViews: async () => ({}) }));

import { messagesPage } from "./teammate-server";

const at = (n: number) => new Date(Date.UTC(2026, 9, 18, 9, n));
const line = (id: string, event: string, skillId: string | null, n: number): Row => ({
  id,
  role: "SYSTEM",
  kind: "EVENT",
  content: `line ${id}`,
  meta: { event, ...(skillId ? { skillId } : {}) },
  toolCalls: null,
  createdAt: at(n),
});

beforeEach(() => {
  db.rows = [];
  db.skills = [
    { id: "sk1", userId: "u-max", name: "Friday expenses", status: "ready" },
    { id: "sk2", userId: "u-max", name: "Payroll", status: "draft" },
    { id: "sk3", userId: "u-lea", name: "Lea's", status: "ready" },
  ];
  db.skillReads = [];
});

describe("a skill's reminder line (Phase 5 step 5)", () => {
  it("draws Start only for the viewer's own ready skill, with its name as it is now", async () => {
    db.rows = [line("m1", "skill_due", "sk1", 1), line("m2", "skill_due", "sk2", 2), line("m3", "skill_due", "sk3", 3), line("m4", "skill_due", "sk-gone", 4), line("m5", "skill_started", "sk1", 5)];
    const page = await messagesPage("chat1", "u-max", new URLSearchParams());
    const view = (id: string) => page.messages.find((m) => m.id === id) as unknown as Row;
    // Before: no line ever carried whether its skill is ready, so Start could send for a draft or a deleted skill.
    expect(view("m1")).toMatchObject({ event: "skill_due", skillId: "sk1", skillReady: true, skillName: "Friday expenses" });
    for (const id of ["m2", "m3", "m4"]) {
      expect(view(id).skillReady, id).toBeUndefined();
      expect(view(id).skillName, id).toBeUndefined();
    }
    // Only a reminder is marked, and one read covers them all, by the viewer's own id.
    expect(view("m5").skillReady).toBeUndefined();
    expect(db.skillReads).toEqual([{ id: { in: ["sk1", "sk2", "sk3", "sk-gone"] }, userId: "u-max", status: "ready" }]);
  });

  it("reads nothing when no line is a reminder", async () => {
    db.rows = [line("m1", "skill_started", "sk1", 1), line("m2", "memory_updated", null, 2)];
    await messagesPage("chat1", "u-max", new URLSearchParams());
    expect(db.skillReads).toEqual([]);
  });
});
