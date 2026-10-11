// trashContainer: a List, Folder or Space delete for a person. Docs-found
// fixes batch 2: an Agent with Full access on a List could trash it with
// every task in it, though an Agent never deletes a task. Now an Agent's
// delete runs with keepTasks, and a container that holds tasks is refused.

import { beforeEach, describe, expect, it, vi } from "vitest";

const st = vi.hoisted(() => ({ calls: [] as Array<{ kind: string; id: string; keepTasks?: boolean }>, holds: 0, boom: null as Error | null }));

vi.mock("@/lib/trash", () => {
  class TrashHoldsTasks extends Error {
    readonly tasks: number;
    constructor(tasks: number) { super("holds"); this.tasks = tasks; }
  }
  return {
    TrashHoldsTasks,
    moveToTrash: async (kind: string, id: string, ctx: { keepTasks?: boolean }) => {
      st.calls.push({ kind, id, keepTasks: ctx.keepTasks });
      if (st.boom) throw st.boom;
      if (ctx.keepTasks && st.holds > 0) throw new TrashHoldsTasks(st.holds);
      return true;
    },
  };
});

import { trashContainer } from "./container-trash";

const actor = (accessLevel: string) => ({ organizationId: "org", userId: "u1", userName: "Uma", accessLevel });

beforeEach(() => { st.calls = []; st.holds = 0; st.boom = null; });

describe("trashContainer", () => {
  it("refuses an Agent a List that holds tasks, in plain words", async () => {
    st.holds = 7;
    expect(await trashContainer("board", "b1", actor("AGENT"))).toEqual({
      ok: false,
      status: 403,
      code: "agent_keeps_tasks",
      error: "This List holds 7 tasks, and an Agent can't delete tasks. Archive it instead, or ask someone else with Full access to delete it.",
    });
    expect(st.calls).toEqual([{ kind: "board", id: "b1", keepTasks: true }]);
    st.holds = 1;
    const folder = await trashContainer("folder", "f1", actor("AGENT"));
    expect(folder.ok ? "" : folder.error).toMatch(/^This Folder holds 1 task,/);
    const space = await trashContainer("space", "s1", actor("AGENT"));
    expect(space.ok ? "" : space.error).toMatch(/^This Space holds 1 task,/);
  });

  it("lets an Agent delete an empty one", async () => {
    expect(await trashContainer("board", "b1", actor("AGENT"))).toEqual({ ok: true, moved: true });
  });

  it("never holds anyone else to it", async () => {
    st.holds = 7;
    expect(await trashContainer("space", "s1", actor("MANAGER"))).toEqual({ ok: true, moved: true });
    expect(st.calls[0].keepTasks).toBe(false);
  });

  it("passes every other failure on to the route", async () => {
    st.boom = new Error("conflict");
    await expect(trashContainer("folder", "f1", actor("AGENT"))).rejects.toThrow("conflict");
  });
});
